-- PHASE 2 LOCAL CANDIDATE. No grants to application roles, protocol activation,
-- projection writes, legacy RPC replacement, publication or live backfill.
-- Single-film commands: request-identity admission lock -> movie -> heads/events
-- -> scoped versions (stable ordering). The admission lock is NOT domain authority.
-- domain_versions is the CAS authority for all four scopes. Head revisions only
-- enforce their local structural lifecycle. The deprecated night column is unused.
-- person_film owns list/seen/personal judgment; group_film owns support,
-- suppression/effective candidacy and current group judgment; night owns event,
-- participants/captures. content owns metadata (no metadata writer in this phase).
-- Missing person/group/content version means baseline 0; existing night requires
-- an explicit version. New night=1. Changed scopes increment once, no-op never.
-- No ordinary removal deletes an aggregate/version; no tombstone is needed here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Rome-only conversion: test the offsets on either side of the local day and
-- retain only UTC candidates that round-trip exactly. A gap has zero matches;
-- a repeated hour has two. Neither is evidence for intention capture.
CREATE FUNCTION public.domain_unique_rome_instant(local_time timestamp) RETURNS timestamptz
LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER SET search_path='' AS $$
DECLARE chosen timestamptz; matches bigint;
BEGIN
 IF NOT isfinite(local_time) THEN RETURN NULL; END IF;
 WITH probes AS (
   SELECT (local_time AT TIME ZONE 'Europe/Rome') + delta AS instant
   FROM unnest(ARRAY[interval '-24 hours',interval '0 hours',interval '24 hours']) delta
 ), offsets AS (
   SELECT DISTINCT (instant AT TIME ZONE 'Europe/Rome')-(instant AT TIME ZONE 'UTC') AS utc_offset FROM probes
 ), candidates AS (
   SELECT DISTINCT (local_time AT TIME ZONE 'UTC')-utc_offset AS instant FROM offsets
 )
 SELECT count(*),min(instant) INTO matches,chosen FROM candidates
 WHERE instant AT TIME ZONE 'Europe/Rome'=local_time;
 RETURN CASE WHEN matches=1 THEN chosen END;
END $$;

CREATE FUNCTION public.domain_cycle(g uuid, m uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN count(*)=2 AND bool_and(coalesce(p.active,false)) THEN
   jsonb_build_object('version',max(gr.convergence_version),'members',
     jsonb_agg(jsonb_build_object('person_id',gm.person_id,'generation',p.generation) ORDER BY gm.person_id)) END
 FROM public.group_memberships gm JOIN public.groups gr ON gr.id=gm.group_id AND gr.status='active'
 JOIN public.app_protocol_state cfg ON cfg.current_group_id=gr.id
 LEFT JOIN public.personal_list_entries p ON p.person_id=gm.person_id AND p.movie_id=m
 WHERE gm.group_id=g AND gm.active
$$;

CREATE FUNCTION public.domain_candidate(g uuid, m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(s.support_state='active',false) OR
   (public.domain_cycle(g,m) IS NOT NULL AND public.domain_cycle(g,m) IS DISTINCT FROM s.suppressed_cycle)
 FROM (SELECT 1) dummy LEFT JOIN public.group_movie_states s ON s.group_id=g AND s.movie_id=m
$$;

CREATE FUNCTION public.domain_lock_movie(m uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM id FROM public.movies WHERE id=m FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 -- Fixed table order; UUID order within each table. All commands use this pattern.
 PERFORM person_id FROM public.personal_list_entries WHERE movie_id=m ORDER BY person_id FOR UPDATE;
 PERFORM group_id FROM public.group_movie_states WHERE movie_id=m ORDER BY group_id FOR UPDATE;
 PERFORM id FROM public.movie_nights WHERE movie_id=m ORDER BY id FOR UPDATE;
 PERFORM i.night_id FROM public.movie_night_intentions i JOIN public.movie_nights n ON n.id=i.night_id
   WHERE n.movie_id=m ORDER BY i.night_id,i.person_id FOR UPDATE OF i;
 PERFORM p.night_id FROM public.movie_night_participants p JOIN public.movie_nights n ON n.id=p.night_id
   WHERE n.movie_id=m ORDER BY p.night_id,p.person_id FOR UPDATE OF p;
 PERFORM v.entity_id FROM public.domain_versions v WHERE
   (v.entity_id=m AND v.scope_kind IN ('content','person_film','group_film')) OR
   (v.scope_kind='night' AND v.entity_id IN (SELECT id FROM public.movie_nights WHERE movie_id=m))
   ORDER BY v.scope_kind,v.scope_id,v.entity_id FOR UPDATE;
END $$;

CREATE FUNCTION public.domain_bump(k text, s uuid, e uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r bigint;
BEGIN
 INSERT INTO public.domain_versions(scope_kind,scope_id,entity_id,version) VALUES(k,s,e,1)
 ON CONFLICT(scope_kind,scope_id,entity_id) DO UPDATE SET version=public.domain_versions.version+1
 RETURNING version INTO r;
 RETURN jsonb_build_object('scope_kind',k,'scope_id',s,'entity_id',e,'version',r);
END $$;

CREATE FUNCTION public.domain_command(request_id uuid, kind text, movie_id uuid,
 group_id uuid DEFAULT NULL, expected_revision bigint DEFAULT NULL, parameters jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
<<cmd>>
DECLARE
 caller uuid:=auth.uid(); legacy text; fingerprint text; prior public.domain_command_receipts;
 p jsonb:=parameters; allowed text[]; key text; scope_kind text; scope_id uuid; entity uuid;
 current_version bigint; changed boolean:=false; changed_people uuid[]:='{}'; changed_groups uuid[]:='{}';
 affected jsonb:='[]'; result jsonb; head public.personal_list_entries; state public.group_movie_states;
 event record; old_event record; nid uuid; who uuid; g uuid; cycle jsonb; is_tombstone boolean;
 before_groups jsonb:='{}'; before_group jsonb; after_group jsonb; participant_ids uuid[];
 val jsonb; field text; old_val jsonb; date_value date; time_value text; future_start timestamptz;
 selected_support uuid; selected_cycle jsonb; row_ref record; new_revision bigint; has_rows boolean;
BEGIN
 -- All helper functions and this entry point remain operator-only in Phase 2.
 -- Even operator tests must carry a real synthetic Auth subject/membership.
 IF caller IS NULL OR NOT EXISTS(SELECT FROM public.app_members a WHERE a.user_id=caller) THEN
   RETURN jsonb_build_object('outcome','FORBIDDEN'); END IF;
 IF group_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.group_memberships gm JOIN public.groups gr ON gr.id=gm.group_id
   WHERE gm.group_id=domain_command.group_id AND gm.person_id=caller AND gm.active AND gr.status='active') THEN
   RETURN jsonb_build_object('outcome','FORBIDDEN'); END IF;
 legacy:=public.app_person();
 IF request_id IS NULL OR movie_id IS NULL OR kind IS NULL OR p IS NULL OR jsonb_typeof(p)<>'object' THEN
   RETURN jsonb_build_object('outcome','VALIDATION_ERROR'); END IF;
 allowed:=CASE
   WHEN kind IN ('ADD_PERSONAL_LIST','REMOVE_PERSONAL_LIST','RETROSPECTIVE_SEEN','REMOVE_PERSONAL_SEEN','PROPOSE_TO_GROUP','WITHDRAW_GROUP_CANDIDACY') THEN ARRAY[]::text[]
   WHEN kind='NEW_PERSONAL_VIEWING' THEN ARRAY['generation']
   WHEN kind IN ('PERSONAL_PREFERENCE','PERSONAL_RATING','PERSONAL_REVIEW','TOGETHER_RATING','TOGETHER_REVIEW') THEN ARRAY['value']
   WHEN kind IN ('SCHEDULE_NIGHT','QUICK_NIGHT') THEN ARRAY['date','time','snack','location','select_candidate','expected_candidate_revision']
   WHEN kind='COMPLETE_NOW' THEN ARRAY['participants','snack','location','select_candidate','expected_candidate_revision']
   WHEN kind IN ('CONFIRM_NIGHT','CANCEL_NIGHT') THEN ARRAY['night_id']
   WHEN kind='EDIT_NIGHT' THEN ARRAY['night_id','date','time','snack','location']
   WHEN kind='COMPLETE_NIGHT' THEN ARRAY['night_id','participants'] END;
 IF allowed IS NULL OR EXISTS(SELECT FROM jsonb_object_keys(p) x WHERE NOT x=ANY(allowed)) THEN
   RETURN jsonb_build_object('outcome','VALIDATION_ERROR'); END IF;
 FOREACH key IN ARRAY ARRAY['date','time','snack','location','night_id'] LOOP
   IF p ? key AND p->key<>'null'::jsonb AND jsonb_typeof(p->key)<>'string' THEN
     RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF length(coalesce(p->>'snack',''))>80 OR length(coalesce(p->>'location',''))>120 THEN
   RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 IF p ? 'expected_candidate_revision' AND (jsonb_typeof(p->'expected_candidate_revision')<>'number'
   OR (p->>'expected_candidate_revision') !~ '^[0-9]+$') THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 IF (kind IN ('PROPOSE_TO_GROUP','WITHDRAW_GROUP_CANDIDACY','TOGETHER_RATING','TOGETHER_REVIEW') OR kind LIKE '%NIGHT' OR kind='COMPLETE_NOW')
   AND group_id IS NULL THEN RETURN jsonb_build_object('outcome','VALIDATION_ERROR'); END IF;
 IF NOT (kind IN ('PROPOSE_TO_GROUP','WITHDRAW_GROUP_CANDIDACY','TOGETHER_RATING','TOGETHER_REVIEW') OR kind LIKE '%NIGHT' OR kind='COMPLETE_NOW')
   AND group_id IS NOT NULL THEN RETURN jsonb_build_object('outcome','VALIDATION_ERROR'); END IF;
 IF p ? 'participants' THEN
   IF jsonb_typeof(p->'participants')<>'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   SELECT array_agg(x::uuid ORDER BY x::uuid) INTO participant_ids FROM jsonb_array_elements_text(p->'participants') x;
   IF coalesce(cardinality(participant_ids),0)<1 OR array_position(participant_ids,NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(participant_ids) x)<>cardinality(participant_ids) THEN
     RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   p:=jsonb_set(p,'{participants}',to_jsonb(participant_ids));
 END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('kind',kind,'movie',movie_id,'group',group_id,
   'expected',expected_revision,'parameters',p)::text,'UTF8')),'hex');
 -- Per-request admission serializes duplicates, including different movie targets.
 -- Hash collisions only serialize unrelated requests; receipts still compare exact IDs.
 PERFORM pg_advisory_xact_lock(hashtextextended(caller::text||':'||request_id::text,0));
 IF NOT EXISTS(SELECT FROM public.app_members a WHERE a.user_id=caller) OR
   (group_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.group_memberships gm JOIN public.groups gr ON gr.id=gm.group_id
     WHERE gm.group_id=domain_command.group_id AND gm.person_id=caller AND gm.active AND gr.status='active')) THEN
   RETURN jsonb_build_object('outcome','FORBIDDEN'); END IF;
 SELECT * INTO prior FROM public.domain_command_receipts r WHERE r.caller_id=caller AND r.request_id=domain_command.request_id;
 IF FOUND THEN
   IF prior.command_kind<>kind OR prior.payload_fingerprint<>fingerprint THEN
     RETURN jsonb_build_object('outcome','REQUEST_ID_REUSE'); END IF;
   RETURN prior.result||jsonb_build_object('replayed',true);
 END IF;
 PERFORM public.domain_lock_movie(movie_id);
 IF NOT EXISTS(SELECT FROM public.app_members a WHERE a.user_id=caller) THEN RETURN jsonb_build_object('outcome','FORBIDDEN'); END IF;
 legacy:=public.app_person();
 -- Membership is rechecked after waiting for the movie lock. Administration of
 -- memberships is deferred; target administration must use the same root protocol.
 IF group_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.group_memberships gm JOIN public.groups gr ON gr.id=gm.group_id
   WHERE gm.group_id=domain_command.group_id AND gm.person_id=caller AND gm.active AND gr.status='active') THEN
   RETURN jsonb_build_object('outcome','FORBIDDEN'); END IF;
 FOR g IN SELECT gr.id FROM public.groups gr WHERE gr.status='active' ORDER BY gr.id LOOP
   SELECT to_jsonb(s) INTO val FROM public.group_movie_states s WHERE s.group_id=g AND s.movie_id=domain_command.movie_id;
   before_groups:=before_groups||jsonb_build_object(g::text,jsonb_build_object('head',val,'cycle',public.domain_cycle(g,movie_id),
     'candidate',public.domain_candidate(g,movie_id),'active_nights',(SELECT count(*) FROM public.movie_nights n
       WHERE n.group_id=g AND n.movie_id=domain_command.movie_id AND n.status IN ('proposed','confirmed'))));
 END LOOP;
 IF kind IN ('SCHEDULE_NIGHT','QUICK_NIGHT','COMPLETE_NOW') THEN
   IF expected_revision IS NOT NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 ELSIF kind IN ('CONFIRM_NIGHT','CANCEL_NIGHT','EDIT_NIGHT','COMPLETE_NIGHT') THEN
   nid:=(p->>'night_id')::uuid;
   SELECT n.id,n.movie_id,n.group_id,n.date,n.time,n.snack,n.location,n.proposed_by,n.status,n.confirmed_at,n.cancelled_at,
     n.completed_at,n.created_by_caller_id,n.selected_support_id,n.selected_convergence_cycle INTO event
     FROM public.movie_nights n WHERE n.id=nid AND n.movie_id=domain_command.movie_id AND n.group_id=domain_command.group_id;
   IF NOT FOUND THEN RETURN jsonb_build_object('outcome','VALIDATION_ERROR'); END IF;
   scope_kind:='night'; scope_id:=group_id; entity:=nid;
 ELSE
   scope_kind:=CASE WHEN group_id IS NULL THEN 'person_film' ELSE 'group_film' END;
   scope_id:=coalesce(group_id,caller); entity:=movie_id;
 END IF;
 IF scope_kind IS NOT NULL THEN
   SELECT v.version,v.tombstone INTO current_version,is_tombstone FROM public.domain_versions v WHERE v.scope_kind=cmd.scope_kind
     AND v.scope_id=cmd.scope_id AND v.entity_id=entity;
   IF NOT FOUND AND scope_kind='night' THEN RAISE EXCEPTION 'NIGHT_VERSION_MISSING'; END IF;
   IF is_tombstone THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   current_version:=coalesce(current_version,0);
   IF expected_revision IS NULL OR expected_revision<0 THEN RETURN jsonb_build_object('outcome','VALIDATION_ERROR'); END IF;
   IF expected_revision<>current_version THEN RETURN jsonb_build_object('outcome','STALE','revision',current_version); END IF;
 END IF;
 SELECT * INTO head FROM public.personal_list_entries l WHERE l.person_id=caller AND l.movie_id=domain_command.movie_id;
 SELECT * INTO state FROM public.group_movie_states s WHERE s.group_id=domain_command.group_id AND s.movie_id=domain_command.movie_id;
 IF kind IN ('ADD_PERSONAL_LIST','REMOVE_PERSONAL_LIST') THEN
   IF kind='ADD_PERSONAL_LIST' AND NOT coalesce(head.active,false) THEN
     INSERT INTO public.personal_list_entries(person_id,movie_id,active,generation,revision,activated_at)
       VALUES(caller,movie_id,true,1,1,clock_timestamp()) ON CONFLICT ON CONSTRAINT personal_list_entries_pkey DO UPDATE
       SET active=true,generation=personal_list_entries.generation+1,revision=personal_list_entries.revision+1,
         activated_at=clock_timestamp(),ended_at=NULL,end_reason=NULL;
     changed:=true;
   ELSIF kind='REMOVE_PERSONAL_LIST' AND head.active THEN
     UPDATE public.personal_list_entries l SET active=false,revision=l.revision+1,ended_at=clock_timestamp(),end_reason='removed'
       WHERE l.person_id=caller AND l.movie_id=domain_command.movie_id;
     changed:=true;
   END IF;
   IF changed THEN changed_people:=array_append(changed_people,caller); END IF;
 ELSIF kind IN ('PROPOSE_TO_GROUP','WITHDRAW_GROUP_CANDIDACY') THEN
   cycle:=public.domain_cycle(group_id,movie_id);
   IF kind='PROPOSE_TO_GROUP' THEN
     INSERT INTO public.group_movie_states(group_id,movie_id,revision,autonomous_support_id,support_origin,support_state,proposed_by,support_recorded_at)
       VALUES(group_id,movie_id,1,gen_random_uuid(),'explicit','active',caller,clock_timestamp())
       ON CONFLICT ON CONSTRAINT group_movie_states_pkey DO UPDATE SET revision=group_movie_states.revision+1,
         autonomous_support_id=EXCLUDED.autonomous_support_id,support_origin='explicit',support_state='active',
         proposed_by=caller,support_recorded_at=EXCLUDED.support_recorded_at,support_ended_at=NULL;
   ELSIF kind='WITHDRAW_GROUP_CANDIDACY' AND public.domain_candidate(group_id,movie_id) THEN
     INSERT INTO public.group_movie_states(group_id,movie_id,revision,suppressed_cycle,suppression_reason,suppressed_at)
       VALUES(group_id,movie_id,1,cycle,CASE WHEN cycle IS NOT NULL THEN 'withdrawn' END,CASE WHEN cycle IS NOT NULL THEN clock_timestamp() END)
       ON CONFLICT ON CONSTRAINT group_movie_states_pkey DO UPDATE SET revision=group_movie_states.revision+1,
         support_state=CASE WHEN group_movie_states.support_state='active' THEN 'withdrawn' ELSE group_movie_states.support_state END,
         support_ended_at=CASE WHEN group_movie_states.support_state='active' THEN clock_timestamp() ELSE group_movie_states.support_ended_at END,
         suppressed_cycle=coalesce(cycle,group_movie_states.suppressed_cycle),
         suppression_reason=CASE WHEN cycle IS NOT NULL THEN 'withdrawn' ELSE group_movie_states.suppression_reason END,
         suppressed_at=CASE WHEN cycle IS NOT NULL THEN clock_timestamp() ELSE group_movie_states.suppressed_at END;
   END IF;
 ELSIF kind IN ('SCHEDULE_NIGHT','QUICK_NIGHT','COMPLETE_NOW') THEN
   IF p ? 'select_candidate' AND jsonb_typeof(p->'select_candidate')<>'boolean' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   IF coalesce((p->>'select_candidate')::boolean,false) THEN
     SELECT coalesce((SELECT v.version FROM public.domain_versions v WHERE v.scope_kind='group_film' AND v.scope_id=domain_command.group_id AND v.entity_id=domain_command.movie_id),0) INTO new_revision;
     IF NOT p ? 'expected_candidate_revision' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
     IF (p->>'expected_candidate_revision')::bigint IS DISTINCT FROM new_revision THEN RETURN jsonb_build_object('outcome','STALE'); END IF;
     IF NOT public.domain_candidate(group_id,movie_id) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
     selected_support:=CASE WHEN state.support_state='active' THEN state.autonomous_support_id END;
     cycle:=public.domain_cycle(group_id,movie_id);
     selected_cycle:=CASE WHEN cycle IS DISTINCT FROM state.suppressed_cycle THEN cycle END;
   ELSIF p ? 'expected_candidate_revision' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   date_value:=(p->>'date')::date; time_value:=p->>'time';
   IF kind='SCHEDULE_NIGHT' AND date_value IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   IF kind<>'SCHEDULE_NIGHT' AND (p ? 'date' OR p ? 'time') THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   IF time_value IS NOT NULL AND time_value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   INSERT INTO public.movie_nights AS n(movie_id,group_id,date,time,snack,location,proposed_by,status,confirmed_at,created_by_caller_id,
     creation_request_id,selected_support_id,selected_convergence_cycle)
     VALUES(movie_id,group_id,date_value,time_value,p->>'snack',p->>'location',legacy,
       CASE WHEN kind='QUICK_NIGHT' THEN 'confirmed' ELSE 'proposed' END,
       CASE WHEN kind='QUICK_NIGHT' THEN clock_timestamp() END,caller,request_id,selected_support,selected_cycle)
       RETURNING n.id,n.movie_id,n.group_id,n.date,n.time,n.snack,n.location,n.proposed_by,n.status,n.confirmed_at,n.cancelled_at,
         n.completed_at,n.created_by_caller_id,n.selected_support_id,n.selected_convergence_cycle INTO event;
   nid:=event.id; changed:=true;
   -- Calendar fields use the existing installation's explicit Europe/Rome zone.
   -- No time supplied -> no reliable future instant -> preserve intentions.
   IF kind='SCHEDULE_NIGHT' AND time_value IS NOT NULL THEN
     future_start:=public.domain_unique_rome_instant(date_value+time_value::time);
     IF future_start>clock_timestamp() THEN
       INSERT INTO public.movie_night_intentions(night_id,person_id,movie_id,generation)
         SELECT nid,l.person_id,movie_id,l.generation FROM public.personal_list_entries l
         JOIN public.group_memberships gm ON gm.group_id=domain_command.group_id AND gm.person_id=l.person_id AND gm.active
         WHERE l.movie_id=domain_command.movie_id AND l.active;
     END IF;
   END IF;
 END IF;
 IF kind IN ('CONFIRM_NIGHT','CANCEL_NIGHT','EDIT_NIGHT') THEN
   old_event:=event;
   IF kind='CONFIRM_NIGHT' THEN
     IF event.status NOT IN ('proposed','confirmed') THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
     IF event.status='proposed' AND (event.created_by_caller_id=caller OR
       (event.created_by_caller_id IS NULL AND event.proposed_by=legacy)) THEN RETURN jsonb_build_object('outcome','FORBIDDEN'); END IF;
     event.status:='confirmed'; event.confirmed_at:=coalesce(event.confirmed_at,clock_timestamp());
   ELSIF kind='CANCEL_NIGHT' THEN
     IF event.status NOT IN ('proposed','confirmed','cancelled') THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
     event.status:='cancelled'; event.cancelled_at:=coalesce(event.cancelled_at,clock_timestamp());
   ELSE
     IF event.status NOT IN ('proposed','confirmed','completed') OR (event.status='completed' AND (p ? 'date' OR p ? 'time')) THEN
       RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
     IF p ? 'date' THEN event.date:=(p->>'date')::date; END IF;
     IF p ? 'time' THEN event.time:=p->>'time'; END IF;
     IF event.time IS NOT NULL AND event.time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
     IF p ? 'snack' THEN event.snack:=p->>'snack'; END IF;
     IF p ? 'location' THEN event.location:=p->>'location'; END IF;
   END IF;
   changed:=event IS DISTINCT FROM old_event;
   IF changed THEN
     UPDATE public.movie_nights n SET date=event.date,time=event.time,snack=event.snack,location=event.location,
       status=event.status,confirmed_at=event.confirmed_at,cancelled_at=event.cancelled_at WHERE n.id=nid;
     IF ROW(event.date,event.time) IS DISTINCT FROM ROW(old_event.date,old_event.time) THEN
       UPDATE public.movie_night_intentions i SET invalidated_at=clock_timestamp() WHERE i.night_id=nid AND i.invalidated_at IS NULL;
     END IF;
   END IF;
 END IF;
 IF kind IN ('COMPLETE_NIGHT','COMPLETE_NOW') THEN
   IF participant_ids IS NULL OR EXISTS(SELECT FROM unnest(participant_ids) x WHERE NOT EXISTS(
     SELECT FROM public.group_memberships gm WHERE gm.group_id=domain_command.group_id AND gm.person_id=x AND gm.active)) THEN
     RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   IF event.status='completed' THEN
     -- New requests cannot amend/recomplete historical participation.
     IF participant_ids IS DISTINCT FROM (SELECT array_agg(pp.person_id ORDER BY pp.person_id) FROM public.movie_night_participants pp WHERE pp.night_id=nid) THEN
       RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   ELSIF event.status IN ('proposed','confirmed') THEN
     UPDATE public.movie_nights n SET status='completed',completed_at=clock_timestamp() WHERE n.id=nid
       RETURNING n.id,n.movie_id,n.group_id,n.date,n.time,n.snack,n.location,n.proposed_by,n.status,n.confirmed_at,n.cancelled_at,
         n.completed_at,n.created_by_caller_id,n.selected_support_id,n.selected_convergence_cycle INTO event;
     INSERT INTO public.movie_night_participants(night_id,person_id) SELECT nid,x FROM unnest(participant_ids) x;
     IF kind='COMPLETE_NIGHT' THEN
       FOR row_ref IN SELECT i.* FROM public.movie_night_intentions i WHERE i.night_id=nid AND i.invalidated_at IS NULL AND i.person_id=ANY(participant_ids) ORDER BY i.person_id LOOP
         UPDATE public.personal_list_entries l SET active=false,revision=l.revision+1,ended_at=clock_timestamp(),end_reason='satisfied'
           WHERE l.person_id=row_ref.person_id AND l.movie_id=domain_command.movie_id AND l.active AND l.generation=row_ref.generation;
         IF FOUND THEN changed_people:=array_append(changed_people,row_ref.person_id); END IF;
       END LOOP;
     END IF;
     -- Identity comparison deliberately preserves later proposals and cycles.
     IF event.selected_support_id IS NOT NULL AND state.support_state='active' AND state.autonomous_support_id=event.selected_support_id THEN
       UPDATE public.group_movie_states s SET revision=s.revision+1,support_state='consumed',support_ended_at=clock_timestamp()
         WHERE s.group_id=domain_command.group_id AND s.movie_id=domain_command.movie_id;
     END IF;
     IF event.selected_convergence_cycle IS NOT NULL THEN
       -- Preserve an old suppression if the selected cycle is no longer current;
       -- it cannot reactivate because its generations never recur.
       IF public.domain_cycle(group_id,movie_id)=event.selected_convergence_cycle THEN
         INSERT INTO public.group_movie_states(group_id,movie_id,revision,suppressed_cycle,suppression_reason,suppressed_at)
           VALUES(group_id,movie_id,1,event.selected_convergence_cycle,'consumed',clock_timestamp())
           ON CONFLICT ON CONSTRAINT group_movie_states_pkey DO UPDATE SET revision=group_movie_states.revision+1,
             suppressed_cycle=EXCLUDED.suppressed_cycle,suppression_reason='consumed',suppressed_at=EXCLUDED.suppressed_at;
       END IF;
     END IF;
     changed:=true;
   ELSE RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 END IF;
 IF kind IN ('RETROSPECTIVE_SEEN','REMOVE_PERSONAL_SEEN','NEW_PERSONAL_VIEWING') THEN
   field:='seen_'||lower(legacy); val:=to_jsonb(kind<>'REMOVE_PERSONAL_SEEN');
   EXECUTE format('SELECT to_jsonb(%I) FROM public.movies WHERE id=$1',field) INTO old_val USING movie_id;
   IF old_val IS DISTINCT FROM val THEN
     EXECUTE format('UPDATE public.movies SET %I=$1 WHERE id=$2',field) USING (val#>>'{}')::boolean,movie_id;
     changed:=true;
   END IF;
   IF kind='NEW_PERSONAL_VIEWING' AND p ? 'generation' THEN
     IF jsonb_typeof(p->'generation')<>'number' OR (p->>'generation') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
     UPDATE public.personal_list_entries l SET active=false,revision=l.revision+1,ended_at=clock_timestamp(),end_reason='satisfied'
       WHERE l.person_id=caller AND l.movie_id=domain_command.movie_id AND l.active AND l.generation=(p->>'generation')::bigint;
     IF FOUND THEN changed:=true; END IF;
   END IF;
   IF changed THEN changed_people:=array_append(changed_people,caller); END IF;
 END IF;
 IF kind IN ('PERSONAL_PREFERENCE','PERSONAL_RATING','PERSONAL_REVIEW','TOGETHER_RATING','TOGETHER_REVIEW') THEN
   IF NOT p ? 'value' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   val:=p->'value';
   IF kind LIKE 'TOGETHER_%' AND group_id IS DISTINCT FROM (SELECT c.current_group_id FROM public.app_protocol_state c) THEN
     RETURN jsonb_build_object('outcome','FORBIDDEN'); END IF;
   IF kind LIKE '%RATING' AND val<>'null'::jsonb AND (jsonb_typeof(val)<>'number' OR (val#>>'{}')::numeric NOT BETWEEN 0 AND 10 OR trunc((val#>>'{}')::numeric*10)<>(val#>>'{}')::numeric*10) THEN
     RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   IF kind LIKE '%REVIEW' AND val<>'null'::jsonb AND jsonb_typeof(val)<>'string' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   IF kind='PERSONAL_PREFERENCE' AND val<>'null'::jsonb AND jsonb_typeof(val)<>'boolean' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   field:=CASE kind WHEN 'PERSONAL_PREFERENCE' THEN 'personal_liked_'||lower(legacy)
     WHEN 'PERSONAL_RATING' THEN 'seen_rating_'||lower(legacy) WHEN 'PERSONAL_REVIEW' THEN 'review_text_'||lower(legacy)
     WHEN 'TOGETHER_RATING' THEN 'seen_rating_together' ELSE 'review_text_together' END;
   EXECUTE format('SELECT to_jsonb(%I) FROM public.movies WHERE id=$1',field) INTO old_val USING movie_id;
   changed:=coalesce(old_val,'null'::jsonb) IS DISTINCT FROM val;
   IF kind='PERSONAL_RATING' THEN
     EXECUTE format('SELECT %I IS NOT NULL FROM public.movies WHERE id=$1','personal_liked_'||lower(legacy)) INTO has_rows USING movie_id;
     changed:=changed OR has_rows;
   END IF;
   IF changed THEN
     EXECUTE format('UPDATE public.movies SET %I=$1::%s WHERE id=$2',field,
       CASE WHEN kind LIKE '%RATING' THEN 'numeric' WHEN kind='PERSONAL_PREFERENCE' THEN 'boolean' ELSE 'text' END)
       USING val#>>'{}',movie_id;
     IF group_id IS NULL THEN changed_people:=array_append(changed_people,caller); ELSE changed_groups:=array_append(changed_groups,group_id); END IF;
   END IF;
 END IF;
 IF nid IS NOT NULL THEN
   IF length(coalesce(event.snack,''))>80 OR length(coalesce(event.location,''))>120 THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
   IF changed THEN affected:=affected||jsonb_build_array(public.domain_bump('night',group_id,nid)); END IF;
 END IF;
 -- Derived candidacy/visibility changes are scoped group aggregate changes,
 -- even when no autonomous support exists. No projection write to movies occurs.
 FOR g IN SELECT gr.id FROM public.groups gr WHERE gr.status='active' ORDER BY gr.id LOOP
   SELECT to_jsonb(s) INTO val FROM public.group_movie_states s WHERE s.group_id=g AND s.movie_id=domain_command.movie_id;
   after_group:=jsonb_build_object('head',val,'cycle',public.domain_cycle(g,movie_id),'candidate',public.domain_candidate(g,movie_id),
     'active_nights',(SELECT count(*) FROM public.movie_nights n WHERE n.group_id=g AND n.movie_id=domain_command.movie_id AND n.status IN ('proposed','confirmed')));
   before_group:=before_groups->g::text;
   IF after_group IS DISTINCT FROM before_group THEN changed_groups:=array_append(changed_groups,g); END IF;
 END LOOP;
 FOR who IN SELECT DISTINCT x FROM unnest(changed_people) x ORDER BY x LOOP
   affected:=affected||jsonb_build_array(public.domain_bump('person_film',who,movie_id)); END LOOP;
 FOR g IN SELECT DISTINCT x FROM unnest(changed_groups) x ORDER BY x LOOP
   affected:=affected||jsonb_build_array(public.domain_bump('group_film',g,movie_id)); END LOOP;
 result:=jsonb_build_object('outcome',CASE WHEN changed OR jsonb_array_length(affected)>0 THEN 'SUCCESS' ELSE 'ALREADY_IN_TARGET_STATE' END,
   'night_id',nid,'affected_versions',affected,'replayed',false);
 INSERT INTO public.domain_command_receipts(caller_id,request_id,command_kind,payload_fingerprint,result_status,result,affected_versions,movie_id,group_id,night_id)
   VALUES(caller,request_id,kind,fingerprint,lower(result->>'outcome'),result,affected,movie_id,group_id,nid);
 RETURN result;
EXCEPTION
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR check_violation OR SQLSTATE '22023' THEN
   RETURN jsonb_build_object('outcome','VALIDATION_ERROR');
 WHEN insufficient_privilege THEN RETURN jsonb_build_object('outcome','FORBIDDEN');
 WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN RETURN jsonb_build_object('outcome','TRANSIENT_FAILURE');
END $$;

REVOKE ALL ON FUNCTION public.domain_unique_rome_instant(timestamp),
 public.domain_cycle(uuid,uuid),public.domain_candidate(uuid,uuid),
 public.domain_lock_movie(uuid),public.domain_bump(text,uuid,uuid),
 public.domain_command(uuid,text,uuid,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
-- No runtime exposure. Granting/activation is a separate, authorized hard cutover.
COMMIT;
