-- CAP-1 local candidate. Apply only after the TARGET v1 runtime is active.
-- Expand only: existing rows keep their ordinary meaning and the protocol floor stays 1.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $pre$
BEGIN
 IF to_regprocedure('public.execute_app_command(jsonb)') IS NULL
    OR to_regprocedure('public.get_person_group_snapshot(uuid,integer)') IS NULL
    OR to_regprocedure('public.get_app_runtime_context(integer)') IS NULL
    OR (SELECT mode FROM public.app_protocol_state WHERE singleton) IS DISTINCT FROM 'target'
    OR (SELECT minimum_client_protocol FROM public.app_protocol_state WHERE singleton) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'CAP1_TARGET_V1_REQUIRED';
 END IF;
END $pre$;

ALTER TABLE public.movie_nights
 ADD COLUMN retrospective boolean NOT NULL DEFAULT false,
 ADD COLUMN night_memory text,
 ADD CONSTRAINT movie_nights_cap1_shape CHECK (
   (NOT retrospective AND night_memory IS NULL)
   OR (retrospective AND status='completed' AND time IS NULL)),
 ADD CONSTRAINT movie_nights_cap1_memory_length CHECK (night_memory IS NULL OR char_length(night_memory)<=1000);
-- No backfill, new index, policy, trigger, publication or direct browser DML.

-- An explicit two-argument bootstrap negotiates snapshot 2. The one-argument
-- v69 function remains byte-identical and still advertises snapshot 1.
CREATE FUNCTION public.get_app_runtime_context(p_client_protocol integer,p_snapshot_contract_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb;
BEGIN
 b:=public.get_app_runtime_context(p_client_protocol);
 IF b->>'outcome'<>'OK' THEN RETURN b; END IF;
 IF p_snapshot_contract_version IS DISTINCT FROM 2 THEN
   RETURN jsonb_build_object('bootstrap_contract_version',1,'outcome','ERROR','error',jsonb_build_object('code','PROTOCOL_UNSUPPORTED'));
 END IF;
 RETURN jsonb_set(b,'{protocol,snapshot_contract_version}','2'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_app_runtime_context(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_runtime_context(integer,integer) TO authenticated;

-- The original writer is retained under a private name. Existing intents still
-- execute its exact body; only CAP-1 intents enter the new implementation.
ALTER FUNCTION public.execute_app_command(jsonb) RENAME TO execute_app_command_base_v1;
REVOKE ALL ON FUNCTION public.execute_app_command_base_v1(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.cap1_execute_app_command(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE
 caller uuid:=auth.uid(); rid uuid; kind text; target jsonb; params jsonb; versions jsonb;
 movie_id uuid; group_id uuid; night_id uuid; cfg jsonb; prior public.domain_command_receipts;
 fingerprint text; participants uuid[]; required_people uuid[]; item jsonb; stale jsonb;
 declared_date date; date_text text; memory_text text; snack_text text; location_text text;
 old_night public.movie_nights; changed boolean; affected jsonb:='[]'::jsonb; reply jsonb;
 expected_kind text; expected_entity uuid; updated_rows integer;
BEGIN
 PERFORM public.app_shape(p_request,ARRAY['protocol_version','request_id','intent','target','expected_versions','parameters']);
 rid:=public.app_uuid(p_request->'request_id');
 IF p_request->'protocol_version'<>'1'::jsonb THEN RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED' USING ERRCODE='22023';END IF;
 kind:=p_request->>'intent';
 IF kind NOT IN ('RECORD_PAST_TOGETHER','EDIT_PAST_TOGETHER') THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 target:=p_request->'target';params:=p_request->'parameters';versions:=p_request->'expected_versions';
 PERFORM public.app_shape(target,ARRAY['movie_id','group_id','night_id']);
 movie_id:=public.app_uuid(target->'movie_id');group_id:=public.app_uuid(target->'group_id');
 IF kind='RECORD_PAST_TOGETHER' THEN
   IF target->'night_id'<>'null'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 PERFORM public.app_shape(params,ARRAY['date','participants'],ARRAY['night_memory','location','snack','client_snapshot_contract_version']);
 ELSE
   night_id:=public.app_uuid(target->'night_id');
   PERFORM public.app_shape(params,'{}',ARRAY['date','night_memory','location','snack','client_snapshot_contract_version']);
 END IF;
 IF params->'client_snapshot_contract_version' IS DISTINCT FROM '2'::jsonb THEN
   RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(versions)<>'array' OR jsonb_array_length(versions)<>1 THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 item:=versions->0;
 PERFORM public.app_shape(item,ARRAY['scope_kind','scope_id','entity_id','version']);
 expected_kind:=CASE WHEN kind='RECORD_PAST_TOGETHER' THEN 'group_film' ELSE 'night' END;
 expected_entity:=CASE WHEN kind='RECORD_PAST_TOGETHER' THEN movie_id ELSE night_id END;
 IF item->>'scope_kind'<>expected_kind
   OR public.app_uuid(item->'scope_id')<>group_id
   OR public.app_uuid(item->'entity_id')<>expected_entity THEN
   RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 PERFORM public.app_decimal(item->'version');
 FOREACH date_text IN ARRAY ARRAY['date','night_memory','location','snack'] LOOP
   IF params ? date_text AND params->date_text<>'null'::jsonb AND jsonb_typeof(params->date_text)<>'string' THEN
     RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 END LOOP;
 IF params ? 'date' THEN
   date_text:=params->>'date';
   IF date_text IS NOT NULL THEN
     IF date_text !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
     declared_date:=date_text::date;
     IF to_char(declared_date,'YYYY-MM-DD')<>date_text OR declared_date>(statement_timestamp() AT TIME ZONE 'Europe/Rome')::date THEN
       RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
   END IF;
 END IF;
 memory_text:=params->>'night_memory';snack_text:=params->>'snack';location_text:=params->>'location';
 IF char_length(coalesce(memory_text,''))>1000 OR char_length(coalesce(snack_text,''))>80
   OR char_length(coalesce(location_text,''))>120 THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 IF kind='RECORD_PAST_TOGETHER' THEN
   IF jsonb_typeof(params->'participants')<>'array' OR jsonb_array_length(params->'participants')<>2 THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
   SELECT array_agg(public.app_uuid(x) ORDER BY public.app_uuid(x)) INTO participants FROM jsonb_array_elements(params->'participants') x;
   IF participants[1]=participants[2] THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
   params:=jsonb_set(params,'{participants}',to_jsonb(participants));
 END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('kind',kind,'target',target,'expected_versions',versions,'parameters',params)::text,'UTF8')),'hex');
 cfg:=public.get_app_runtime_context(1);
 IF cfg->>'outcome'<>'OK' OR NOT coalesce((cfg#>>'{runtime,activation_allowed}')::boolean,false)
   OR group_id::text<>cfg#>>'{selected_group,group_id}' OR caller IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller::text||':'||rid::text,0));
 SELECT * INTO prior FROM public.domain_command_receipts WHERE caller_id=caller AND request_id=rid;
 IF FOUND THEN
   IF prior.command_kind<>kind OR prior.payload_fingerprint<>fingerprint THEN RETURN public.app_wire(jsonb_build_object('outcome','REQUEST_ID_REUSE'),rid,movie_id);END IF;
   RETURN prior.result||jsonb_build_object('replayed',true);
 END IF;
 PERFORM m.id FROM public.movies AS m WHERE m.id=movie_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='22023';END IF;
 PERFORM public.app_lock_relations(movie_id);
 cfg:=public.get_app_runtime_context(1);
 IF cfg->>'outcome'<>'OK' OR NOT coalesce((cfg#>>'{runtime,activation_allowed}')::boolean,false)
   OR group_id::text<>cfg#>>'{selected_group,group_id}' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='22023';END IF;
 IF kind='RECORD_PAST_TOGETHER' THEN
   SELECT array_agg(gm.person_id ORDER BY gm.person_id) INTO required_people
   FROM public.group_memberships gm JOIN public.app_members a ON a.user_id=gm.person_id
   WHERE gm.group_id=group_id AND gm.active AND a.person IN ('N','V');
   IF coalesce(cardinality(required_people),0)<>2 OR participants IS DISTINCT FROM required_people THEN
     RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 ELSE
   SELECT n.* INTO old_night FROM public.movie_nights AS n
     WHERE n.id=night_id AND n.movie_id=movie_id AND n.group_id=group_id FOR UPDATE OF n;
   IF NOT FOUND OR NOT old_night.retrospective OR old_night.status<>'completed' THEN
     RAISE EXCEPTION 'IMMUTABLE_COMPLETION' USING ERRCODE='22023';END IF;
 END IF;
 stale:=public.app_cas(versions,expected_kind,group_id,expected_entity);
 IF stale IS NOT NULL THEN RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','STALE','current_versions',jsonb_build_array(stale));END IF;
 IF kind='RECORD_PAST_TOGETHER' THEN
   INSERT INTO public.movie_nights(movie_id,group_id,date,time,snack,location,proposed_by,status,completed_at,
     created_by_caller_id,creation_request_id,retrospective,night_memory)
     VALUES(movie_id,group_id,declared_date,NULL,snack_text,location_text,cfg#>>'{caller,legacy_person}',
       'completed',clock_timestamp(),caller,rid,true,memory_text) RETURNING id INTO night_id;
   INSERT INTO public.movie_night_participants(night_id,person_id) SELECT night_id,x FROM unnest(participants) x;
   affected:=affected||jsonb_build_array(public.domain_bump('night',group_id,night_id));
   affected:=affected||jsonb_build_array(public.domain_bump('group_film',group_id,movie_id));
 ELSE
   changed:=(params ? 'date' AND old_night.date IS DISTINCT FROM declared_date)
     OR (params ? 'night_memory' AND old_night.night_memory IS DISTINCT FROM memory_text)
     OR (params ? 'snack' AND old_night.snack IS DISTINCT FROM snack_text)
     OR (params ? 'location' AND old_night.location IS DISTINCT FROM location_text);
   IF changed THEN
     UPDATE public.movie_nights AS n SET date=CASE WHEN params ? 'date' THEN declared_date ELSE n.date END,
       night_memory=CASE WHEN params ? 'night_memory' THEN memory_text ELSE n.night_memory END,
       snack=CASE WHEN params ? 'snack' THEN snack_text ELSE n.snack END,
       location=CASE WHEN params ? 'location' THEN location_text ELSE n.location END
       WHERE n.id=night_id AND n.movie_id=movie_id AND n.group_id=group_id;
     GET DIAGNOSTICS updated_rows=ROW_COUNT;
     IF updated_rows<>1 THEN RAISE EXCEPTION 'IMMUTABLE_COMPLETION' USING ERRCODE='22023';END IF;
     affected:=affected||jsonb_build_array(public.domain_bump('night',group_id,night_id));
   END IF;
 END IF;
 reply:=jsonb_build_object('protocol_version',1,'request_id',rid,
   'outcome',CASE WHEN jsonb_array_length(affected)>0 THEN 'SUCCESS' ELSE 'ALREADY_IN_TARGET_STATE' END,
   'replayed',false,'result',jsonb_build_object('movie_id',movie_id,'night_id',night_id),
   'affected_versions',public.app_versions_wire(affected));
 INSERT INTO public.domain_command_receipts(caller_id,request_id,command_kind,payload_fingerprint,result_status,result,affected_versions,movie_id,group_id,night_id)
   VALUES(caller,rid,kind,fingerprint,lower(reply->>'outcome'),reply,reply->'affected_versions',movie_id,group_id,night_id);
 RETURN reply;
EXCEPTION
 WHEN SQLSTATE '22023' THEN RETURN public.app_wire(jsonb_build_object('outcome',CASE WHEN SQLERRM=ANY(ARRAY[
   'VALIDATION_ERROR','PROTOCOL_UNSUPPORTED','FORBIDDEN','CONTENT_NOT_FOUND','IMMUTABLE_COMPLETION','MISSING_EXPECTED_VERSION','NIGHT_VERSION_MISSING'])
   THEN SQLERRM ELSE 'VALIDATION_ERROR' END),rid,movie_id);
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN
   RETURN public.app_wire(jsonb_build_object('outcome','VALIDATION_ERROR'),rid,movie_id);
 WHEN unique_violation THEN RETURN public.app_wire(jsonb_build_object('outcome','CONFLICT'),rid,movie_id);
 WHEN foreign_key_violation THEN RETURN public.app_wire(jsonb_build_object('outcome','CONTENT_NOT_FOUND'),rid,movie_id);
 WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN RETURN public.app_wire(jsonb_build_object('outcome','TRANSIENT_FAILURE'),rid,movie_id);
END $$;
REVOKE ALL ON FUNCTION public.cap1_execute_app_command(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.execute_app_command(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_request->>'intent' IN ('RECORD_PAST_TOGETHER','EDIT_PAST_TOGETHER') THEN
   RETURN public.cap1_execute_app_command(p_request);
 END IF;
 RETURN public.execute_app_command_base_v1(p_request);
END $$;
REVOKE ALL ON FUNCTION public.execute_app_command(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_app_command(jsonb) TO authenticated;
DO $acl$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN
   REVOKE ALL ON FUNCTION public.get_app_runtime_context(integer,integer),
     public.execute_app_command_base_v1(jsonb),public.cap1_execute_app_command(jsonb) FROM service_role;
 END IF;
END $acl$;
GRANT EXECUTE ON FUNCTION public.execute_app_command(jsonb) TO service_role;

-- Both projections are signed separately; v1 retains its exact JSON keys.
CREATE OR REPLACE FUNCTION public.get_person_group_snapshot(p_group_id uuid, p_contract_version integer DEFAULT 1) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET DateStyle='ISO, YMD' AS $$
WITH
ctx AS MATERIALIZED (
 SELECT auth.uid() caller, statement_timestamp() as_of, p_group_id gid, p_contract_version cv
),
cfg AS MATERIALIZED (SELECT current_group_id FROM public.app_protocol_state),
gate AS MATERIALIZED (
 SELECT c.*, CASE
  WHEN caller IS NULL THEN 'UNAUTHENTICATED'
  WHEN NOT EXISTS(SELECT FROM public.app_members a WHERE a.user_id=c.caller) THEN 'FORBIDDEN'
  WHEN cv NOT IN (1,2) THEN 'UNSUPPORTED_CONTRACT'
  WHEN gid IS NULL THEN 'INVALID_GROUP'
  WHEN NOT EXISTS(SELECT FROM cfg WHERE current_group_id IS NOT NULL) THEN 'FOUNDATION_NOT_READY'
  WHEN NOT EXISTS(SELECT FROM public.groups g JOIN public.group_memberships gm ON gm.group_id=g.id
    WHERE g.id=c.gid AND g.status='active' AND gm.person_id=c.caller AND gm.active) THEN 'FORBIDDEN'
  WHEN gid IS DISTINCT FROM (SELECT current_group_id FROM cfg) THEN 'UNSUPPORTED_GROUP'
  WHEN EXISTS(SELECT FROM public.movie_nights WHERE group_id IS NULL) THEN 'FOUNDATION_NOT_READY'
 END error FROM ctx c
),
members AS MATERIALIZED (
 SELECT gm.person_id,a.person legacy_person FROM public.group_memberships gm
 CROSS JOIN gate c LEFT JOIN public.app_members a ON a.user_id=gm.person_id
 WHERE c.error IS NULL AND gm.group_id=c.gid AND gm.active
),
catalog_src AS MATERIALIZED (SELECT m.* FROM public.movies m CROSS JOIN gate c WHERE c.error IS NULL),
nights_src AS MATERIALIZED (
 SELECT n.id,n.movie_id,n.group_id,n.status,n.date,n.time,n.snack,n.location,n.proposed_by,
 n.created_by_caller_id,n.created_at,n.confirmed_at,n.cancelled_at,n.completed_at,n.retrospective,n.night_memory
 FROM public.movie_nights n CROSS JOIN gate c WHERE c.error IS NULL AND n.group_id=c.gid
),
participants_src AS MATERIALIZED (
 SELECT p.night_id,p.person_id FROM public.movie_night_participants p JOIN nights_src n ON n.id=p.night_id
),
temporal AS MATERIALIZED (
 SELECT c.as_of,(c.as_of AT TIME ZONE 'Europe/Rome')::date local_date,
 to_char(c.as_of AT TIME ZONE 'Europe/Rome','IYYY-"W"IW') week_key,
 least(((c.as_of AT TIME ZONE 'Europe/Rome')::date+1)::timestamp AT TIME ZONE 'Europe/Rome',
   (SELECT min(t.instant) FROM nights_src n CROSS JOIN LATERAL
     (SELECT public.snapshot_v1_night_instant(n.date,n.time) instant) t
     WHERE n.status IN ('proposed','confirmed') AND t.instant>c.as_of)) next_at
 FROM ctx c
),
veto_src AS MATERIALIZED (
 SELECT v.id,v.movie_id,v.person,v.week_key,a.user_id person_id
 FROM public.vetoes v CROSS JOIN temporal t CROSS JOIN gate c
 LEFT JOIN public.app_members a ON a.person=v.person
 WHERE c.error IS NULL AND v.week_key=t.week_key
),
people_ids AS MATERIALIZED (
 SELECT person_id FROM members UNION SELECT person_id FROM participants_src
 UNION SELECT n.created_by_caller_id FROM nights_src n WHERE n.created_by_caller_id IS NOT NULL
 UNION SELECT a.user_id FROM public.app_members a WHERE a.person IN (
   SELECT added_by FROM catalog_src UNION SELECT surprise_by FROM catalog_src UNION SELECT proposed_by FROM nights_src)
 UNION SELECT person_id FROM veto_src WHERE person_id IS NOT NULL
),
people_rows AS MATERIALIZED (
 SELECT p.person_id,jsonb_build_object('person_id',p.person_id,'legacy_person',a.person,
 'personal_readable',EXISTS(SELECT FROM members m WHERE m.person_id=p.person_id)) doc
 FROM people_ids p LEFT JOIN public.app_members a ON a.user_id=p.person_id
),
catalog_rows AS MATERIALIZED (
 SELECT m.id,jsonb_build_object('movie_id',m.id,'title',m.title,'added_by_person_id',a.user_id,
 'created_at',CASE WHEN m.created_at IS NOT NULL THEN to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'duration',m.duration,'platform',m.platform,'poster',m.poster,'trailer_url',m.trailer_url,
 'metadata_matched',m.matched,'imdb_rating',m.imdb_rating,'rt_rating',m.rt_rating,'metacritic_rating',m.metacritic_rating,
 'tmdb_id',m.tmdb_id::text,'collection_id',m.collection_id::text,'collection_name',m.collection_name,
 'director',m.director,'overview',m.overview,'release_year',m.release_year,'genres',m.genres,'cast_names',m.cast_names,
 'cinema_watchlist',m.cinema_watchlist,'surprise_by_person_id',s.user_id) doc
 FROM catalog_src m LEFT JOIN public.app_members a ON a.person=m.added_by
 LEFT JOIN public.app_members s ON s.person=m.surprise_by
),
personal_grid AS MATERIALIZED (
 SELECT p.person_id,m.id movie_id,
 CASE p.legacy_person WHEN 'N' THEN m.seen_n WHEN 'V' THEN m.seen_v END seen,
 coalesce(l.active,false) list_active,CASE WHEN p.person_id=c.caller THEN l.generation::text END generation,
 CASE p.legacy_person
  WHEN 'N' THEN jsonb_build_object('rating',m.seen_rating_n,'preference',m.personal_liked_n,'review',m.review_text_n)
  WHEN 'V' THEN jsonb_build_object('rating',m.seen_rating_v,'preference',m.personal_liked_v,'review',m.review_text_v) END judgment
 FROM members p CROSS JOIN catalog_src m CROSS JOIN ctx c
 LEFT JOIN public.personal_list_entries l ON l.person_id=p.person_id AND l.movie_id=m.id
),
personal_rows AS MATERIALIZED (
 SELECT p.person_id,jsonb_build_object('person_id',p.person_id,
 'states',coalesce((SELECT jsonb_agg(jsonb_build_object('movie_id',x.movie_id,'seen',x.seen,
   'list',jsonb_build_object('active',x.list_active,'generation',x.generation),'judgment',x.judgment) ORDER BY x.movie_id)
   FROM personal_grid x WHERE x.person_id=p.person_id),'[]'::jsonb),
 'collections',jsonb_build_object('list_movie_ids',coalesce((SELECT jsonb_agg(x.movie_id ORDER BY x.movie_id) FROM personal_grid x
   WHERE x.person_id=p.person_id AND x.list_active),'[]'::jsonb),
 'seen_movie_ids',coalesce((SELECT jsonb_agg(x.movie_id ORDER BY x.movie_id) FROM personal_grid x
   WHERE x.person_id=p.person_id AND x.seen),'[]'::jsonb))) doc FROM members p
),
night_sets AS MATERIALIZED (
 SELECT movie_id,
 coalesce(jsonb_agg(id ORDER BY id) FILTER(WHERE status IN ('proposed','confirmed')),'[]'::jsonb) active_ids,
 coalesce(jsonb_agg(id ORDER BY id) FILTER(WHERE status='completed'),'[]'::jsonb) completed_ids
 FROM nights_src GROUP BY movie_id
),
candidate AS MATERIALIZED (
 SELECT m.id,public.domain_candidate(c.gid,m.id) effective FROM catalog_src m CROSS JOIN ctx c
),
group_values AS MATERIALIZED (
 SELECT m.id,ca.effective,coalesce(n.active_ids,'[]'::jsonb) active_ids,coalesce(n.completed_ids,'[]'::jsonb) completed_ids,
 CASE WHEN (SELECT count(*) FROM members)=2 AND (SELECT count(legacy_person) FROM members)=2 THEN
   m.seen_n AND m.seen_v AND jsonb_array_length(coalesce(n.completed_ids,'[]'::jsonb))=0 END rewatch,
 ca.effective AND jsonb_array_length(coalesce(n.active_ids,'[]'::jsonb))=0
 AND jsonb_array_length(coalesce(n.completed_ids,'[]'::jsonb))=0 AND NOT m.cinema_watchlist
 AND (m.status IS NULL OR m.status IN ('watchlist','tonight','watched'))
 AND NOT EXISTS(SELECT FROM veto_src v WHERE v.movie_id=m.id) eligible
 FROM catalog_src m JOIN candidate ca ON ca.id=m.id LEFT JOIN night_sets n ON n.movie_id=m.id
),
group_rows AS MATERIALIZED (
 SELECT id,jsonb_build_object('movie_id',id,'effective_candidacy',effective,
 'list_visible',effective AND jsonb_array_length(active_ids)=0,'active_night_ids',active_ids,'completed_night_ids',completed_ids,
 'rewatch_semantic',rewatch,'rewatch_visible',coalesce(rewatch,false) AND jsonb_array_length(active_ids)=0,
 'eligibility',jsonb_build_object('match_base',eligible,'ruota_base',eligible)) doc FROM group_values
),
judgment_rows AS MATERIALIZED (
 SELECT id,jsonb_build_object('movie_id',id,'rating',seen_rating_together,'review',review_text_together) doc FROM catalog_src
 WHERE seen_rating_together IS NOT NULL OR review_text_together IS NOT NULL
),
night_rows AS MATERIALIZED (
 SELECT n.id,jsonb_build_object('night_id',n.id,'movie_id',n.movie_id,'status',n.status,'date',n.date,'time',n.time,
 'snack',n.snack,'location',n.location,'proposed_by_person_id',coalesce(n.created_by_caller_id,a.user_id),
 'created_at',CASE WHEN n.created_at IS NOT NULL THEN to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'confirmed_at',CASE WHEN n.confirmed_at IS NOT NULL THEN to_char(n.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'cancelled_at',CASE WHEN n.cancelled_at IS NOT NULL THEN to_char(n.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'completed_at',CASE WHEN (SELECT cv FROM ctx)=1 AND n.retrospective AND n.date IS NULL THEN NULL
 WHEN n.completed_at IS NOT NULL THEN to_char(n.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END)
 || CASE WHEN (SELECT cv FROM ctx)=2 THEN jsonb_build_object('retrospective',n.retrospective,'night_memory',n.night_memory) ELSE '{}'::jsonb END doc
 FROM nights_src n LEFT JOIN public.app_members a ON a.person=n.proposed_by
),
exposure_values AS MATERIALIZED (
 SELECT person_id,movie_id,bool_or(personal_seen) personal_seen,bool_or(together) together FROM (
  SELECT person_id,movie_id,true personal_seen,false together FROM personal_grid WHERE seen
  UNION ALL SELECT p.person_id,n.movie_id,false,true FROM participants_src p JOIN nights_src n ON n.id=p.night_id WHERE n.status='completed'
 ) e GROUP BY person_id,movie_id
),
exposure_rows AS MATERIALIZED (
 SELECT person_id,movie_id,jsonb_build_object('person_id',person_id,'movie_id',movie_id,'sources',
 to_jsonb(array_remove(ARRAY[CASE WHEN personal_seen THEN 'PERSONAL_SEEN' END,
 CASE WHEN together THEN 'SELECTED_GROUP_TOGETHER' END],NULL))) doc FROM exposure_values
),
version_src AS MATERIALIZED (
 SELECT v.* FROM public.domain_versions v CROSS JOIN gate c WHERE c.error IS NULL AND (
  (v.scope_kind='person_film' AND v.scope_id IN (SELECT person_id FROM members)
   AND (v.entity_id IN (SELECT id FROM catalog_src) OR v.tombstone)) OR
  (v.scope_kind='group_film' AND v.scope_id=c.gid AND (v.entity_id IN (SELECT id FROM catalog_src) OR v.tombstone)) OR
  (v.scope_kind='content' AND v.scope_id=v.entity_id AND (v.entity_id IN (SELECT id FROM catalog_src) OR v.tombstone)) OR
  (v.scope_kind='night' AND v.scope_id=c.gid AND (v.entity_id IN (SELECT id FROM nights_src) OR v.tombstone)))
),
version_rows AS MATERIALIZED (
 SELECT scope_kind,scope_id,entity_id,jsonb_build_object('scope_kind',scope_kind,'scope_id',scope_id,
 'entity_id',entity_id,'version',version::text,'tombstone',tombstone) doc FROM version_src
),
unavailable AS MATERIALIZED (
 SELECT n.id FROM nights_src n CROSS JOIN ctx c WHERE NOT EXISTS(SELECT FROM version_src v
 WHERE v.scope_kind='night' AND v.scope_id=c.gid AND v.entity_id=n.id)
),
validation AS MATERIALIZED (
 SELECT
 NOT EXISTS(SELECT FROM veto_src v WHERE v.movie_id IS NULL OR v.person_id IS NULL
   OR NOT EXISTS(SELECT FROM catalog_src m WHERE m.id=v.movie_id)
   OR NOT EXISTS(SELECT FROM members p WHERE p.person_id=v.person_id))
 AND NOT EXISTS(SELECT FROM catalog_src m WHERE m.surprise_by IS NOT NULL AND NOT EXISTS(
   SELECT FROM public.app_members a WHERE a.person=m.surprise_by))
 AND NOT EXISTS(SELECT FROM nights_src n WHERE NOT EXISTS(SELECT FROM catalog_src m WHERE m.id=n.movie_id)
   OR (n.status='completed' AND NOT EXISTS(SELECT FROM participants_src p WHERE p.night_id=n.id)))
 AND NOT EXISTS(SELECT FROM participants_src p JOIN nights_src n ON n.id=p.night_id WHERE n.status<>'completed')
 AND NOT EXISTS(SELECT FROM version_src v WHERE v.tombstone AND (
   (v.scope_kind='night' AND EXISTS(SELECT FROM nights_src n WHERE n.id=v.entity_id)) OR
   (v.scope_kind IN ('content','group_film','person_film') AND EXISTS(SELECT FROM catalog_src m WHERE m.id=v.entity_id))))
 AND NOT EXISTS(SELECT FROM version_src v WHERE v.scope_kind='night' AND v.version<1)
 AND (SELECT count(*) FROM personal_grid)=(SELECT count(*) FROM members)*(SELECT count(*) FROM catalog_src)
 AND (SELECT count(*) FROM group_rows)=(SELECT count(*) FROM catalog_src)
 AND (SELECT count(*) FROM catalog_rows)=(SELECT count(*) FROM catalog_src)
 AND (SELECT count(*) FROM night_rows)=(SELECT count(*) FROM nights_src)
 AND (SELECT count(*) FROM personal_rows)=(SELECT count(*) FROM members)
 AND (SELECT count(*) FROM people_rows)=(SELECT count(*) FROM people_ids)
 -- PKs/FKs on the source tables establish these identities; verify projected
 -- cardinality as well so a later join cannot silently multiply/drop entities.
 AND (SELECT count(*)=count(DISTINCT id) FROM catalog_rows)
 AND (SELECT count(*)=count(DISTINCT person_id) FROM people_rows)
 AND (SELECT count(*)=count(DISTINCT (person_id,movie_id)) FROM personal_grid)
 AND (SELECT count(*)=count(DISTINCT id) FROM group_rows)
 AND (SELECT count(*)=count(DISTINCT (scope_kind,scope_id,entity_id)) FROM version_src)
 AND NOT EXISTS(SELECT FROM participants_src p WHERE NOT EXISTS(SELECT FROM people_ids x WHERE x.person_id=p.person_id))
 AS valid
),
arrays AS MATERIALIZED (
 SELECT
 coalesce((SELECT jsonb_agg(doc ORDER BY id) FROM catalog_rows),'[]'::jsonb) catalog,
 coalesce((SELECT jsonb_agg(doc ORDER BY person_id) FROM people_rows),'[]'::jsonb) people,
 coalesce((SELECT jsonb_agg(doc ORDER BY person_id) FROM personal_rows),'[]'::jsonb) personal,
 coalesce((SELECT jsonb_agg(doc ORDER BY id) FROM group_rows),'[]'::jsonb) states,
 coalesce((SELECT jsonb_agg(doc ORDER BY id) FROM judgment_rows),'[]'::jsonb) judgments,
 coalesce((SELECT jsonb_agg(doc ORDER BY id) FROM night_rows),'[]'::jsonb) nights,
 coalesce((SELECT jsonb_agg(jsonb_build_object('night_id',night_id,'person_id',person_id) ORDER BY night_id,person_id) FROM participants_src),'[]'::jsonb) participants,
 coalesce((SELECT jsonb_agg(doc ORDER BY person_id,movie_id) FROM exposure_rows),'[]'::jsonb) exposure,
 coalesce((SELECT jsonb_agg(jsonb_build_object('veto_id',id,'person_id',person_id,'movie_id',movie_id,'week_key',week_key) ORDER BY id) FROM veto_src),'[]'::jsonb) vetoes,
 coalesce((SELECT jsonb_agg(doc ORDER BY scope_kind COLLATE "C",scope_id,entity_id) FROM version_rows),'[]'::jsonb) entries,
 coalesce((SELECT jsonb_agg(id ORDER BY id) FROM unavailable),'[]'::jsonb) unavailable_ids
),
document AS MATERIALIZED (
 SELECT jsonb_build_object('contract_version',c.cv,'outcome','OK','caller',jsonb_build_object('person_id',c.caller),
 'selected_group',jsonb_build_object('group_id',c.gid,'member_person_ids',coalesce((SELECT jsonb_agg(person_id ORDER BY person_id) FROM members),'[]'::jsonb)),
 'temporal',jsonb_build_object('as_of',to_char(t.as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'timezone','Europe/Rome','local_date',t.local_date,'week_key',t.week_key,
 'next_temporal_invalidation_at',to_char(t.next_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
 'coverage',jsonb_build_object('complete',true,'catalog','FULL_APP_CATALOG',
 'personal_person_ids',coalesce((SELECT jsonb_agg(person_id ORDER BY person_id) FROM members),'[]'::jsonb),'group_id',c.gid,
 'nights','ALL_SELECTED_GROUP','participants','ALL_RETURNED_NIGHTS','veto_week_key',t.week_key,
 'versions','COVERED_SCOPES_AND_RETAINED_MARKERS','counts',jsonb_build_object(
 'catalog',(SELECT count(*) FROM catalog_src),'people',(SELECT count(*) FROM people_ids),
 'personal_views',(SELECT count(*) FROM members),'personal_states',(SELECT count(*) FROM personal_grid),
 'group_states',(SELECT count(*) FROM group_rows),'group_judgments',(SELECT count(*) FROM judgment_rows),
 'nights',(SELECT count(*) FROM nights_src),'participants',(SELECT count(*) FROM participants_src),
 'exposure',(SELECT count(*) FROM exposure_rows),'vetoes',(SELECT count(*) FROM veto_src),
 'version_entries',(SELECT count(*) FROM version_src),'night_tokens_unavailable',(SELECT count(*) FROM unavailable))),
 'catalog',a.catalog,'people',a.people,'personal',a.personal,
 'group',jsonb_build_object('states',a.states,'judgments',a.judgments,'collections',jsonb_build_object(
 'list_movie_ids',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM group_rows WHERE (doc->>'list_visible')::boolean),'[]'::jsonb),
 'scheduled_night_ids',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM nights_src WHERE status IN ('proposed','confirmed')),'[]'::jsonb),
 'together_movie_ids',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM group_values WHERE jsonb_array_length(completed_ids)>0),'[]'::jsonb),
 'rewatch_movie_ids',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM group_rows WHERE (doc->>'rewatch_visible')::boolean),'[]'::jsonb))),
 'nights',a.nights,'participants',a.participants,'exposure',a.exposure,'vetoes',a.vetoes,
 'versions',jsonb_build_object('defaults',jsonb_build_object('person_film','0','group_film','0','content','0','night',NULL),
 'entries',a.entries,'unavailable_night_ids',a.unavailable_ids)) doc
 FROM gate c CROSS JOIN temporal t CROSS JOIN arrays a CROSS JOIN validation v WHERE c.error IS NULL AND v.valid
),
signed AS MATERIALIZED (
 SELECT doc||jsonb_build_object('payload_signature',jsonb_build_object('algorithm','sha256-pg-jsonb-text-v1',
 'value',encode(sha256(convert_to((doc #- '{temporal,as_of}' #- '{temporal,next_temporal_invalidation_at}')::text,'UTF8')),'hex'))) doc FROM document
),
checked AS MATERIALIZED (
 SELECT s.doc,octet_length(convert_to(s.doc::text,'UTF8')) bytes,
 jsonb_array_length(s.doc->'catalog')=(SELECT count(*) FROM catalog_src)
 AND jsonb_array_length(s.doc->'people')=(SELECT count(*) FROM people_ids)
 AND jsonb_array_length(s.doc->'personal')=(SELECT count(*) FROM members)
 AND jsonb_array_length(s.doc->'group'->'states')=(SELECT count(*) FROM catalog_src)
 AND jsonb_array_length(s.doc->'group'->'judgments')=(SELECT count(*) FROM judgment_rows)
 AND jsonb_array_length(s.doc->'nights')=(SELECT count(*) FROM nights_src)
 AND jsonb_array_length(s.doc->'participants')=(SELECT count(*) FROM participants_src)
 AND jsonb_array_length(s.doc->'exposure')=(SELECT count(*) FROM exposure_values)
 AND jsonb_array_length(s.doc->'vetoes')=(SELECT count(*) FROM veto_src)
 AND jsonb_array_length(s.doc->'versions'->'entries')=(SELECT count(*) FROM version_src)
 AND jsonb_array_length(s.doc->'versions'->'unavailable_night_ids')=(SELECT count(*) FROM unavailable)
 AND (SELECT coalesce(sum(jsonb_array_length(p->'states')),0) FROM jsonb_array_elements(s.doc->'personal') p)=(SELECT count(*) FROM personal_grid)
 AS serialized_complete FROM signed s
)
SELECT CASE WHEN g.error IS NOT NULL THEN jsonb_build_object('contract_version',g.cv,'outcome','ERROR','error',jsonb_build_object('code',g.error))
 WHEN NOT v.valid OR NOT coalesce(c.serialized_complete,false) THEN jsonb_build_object('contract_version',g.cv,'outcome','ERROR','error',jsonb_build_object('code','SNAPSHOT_DATA_INVALID'))
 WHEN c.bytes>16777216 THEN jsonb_build_object('contract_version',g.cv,'outcome','ERROR','error',jsonb_build_object('code','SNAPSHOT_TOO_LARGE'))
 ELSE c.doc END
FROM gate g CROSS JOIN validation v LEFT JOIN checked c ON true
$$;



-- The operator audit must recognize the private base/helper and the new
-- authenticated bootstrap facade without widening either writer ACL.
CREATE OR REPLACE FUNCTION public.runtime_4a4_audit() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; p record; role_name text; privilege text; a record;
 issues jsonb:='[]'; surfaces jsonb:='[]'; manifest_ok boolean:=true; clear boolean:=true;
 tables text[]:=ARRAY['movies','movie_nights','votes','vetoes','swipe_sessions','swipes','app_members','groups','group_memberships',
  'personal_list_entries','group_movie_states','movie_night_participants','movie_night_intentions','domain_versions','domain_command_receipts','app_protocol_state'];
 functions text[]:=ARRAY['app_cas','app_content_parameters','app_content_write','app_current_week','app_decimal','app_delete_protected',
  'app_evaluation','app_lock_relations','app_match_eligible','app_match_progress','app_person','app_phase2_effects','app_scope','app_shape','app_uuid','app_versions_wire','app_wire',
  'clear_personal_preference_for_rating','domain_bump','domain_candidate','domain_command','domain_cycle','domain_lock_movie','domain_unique_rome_instant',
  'execute_app_command','execute_app_command_base_v1','cap1_execute_app_command','execute_match_action','foundation_valid_cycle','get_app_runtime_context','get_person_group_snapshot','guard_command_receipt_foundation',
  'guard_domain_version_foundation','guard_group_movie_foundation','guard_movie_watch','guard_night_intention_foundation','guard_personal_list_foundation',
  'manage_movie_night','snapshot_v1_night_instant','runtime_4a4_audit','runtime_4a4_apply_fence','runtime_4a4_capture_drain','runtime_4a4_verify_drain',
  'runtime_4a4_target_used','runtime_4a4_initialize_nights','runtime_4a4_activate_target','runtime_4a4_enter_maintenance','read_app_protocol'];
 safe_functions oid[]:=ARRAY[to_regprocedure('public.read_app_protocol(integer)')::oid,to_regprocedure('public.app_person()')::oid,to_regprocedure('public.get_app_runtime_context(integer)')::oid,to_regprocedure('public.get_app_runtime_context(integer,integer)')::oid,
  to_regprocedure('public.get_person_group_snapshot(uuid,integer)')::oid,to_regprocedure('public.execute_app_command(jsonb)')::oid,
  to_regprocedure('public.execute_match_action(integer,text,jsonb)')::oid];
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'OPERATOR_READ_COMMITTED_REQUIRED';END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname=role_name AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls) THEN
   manifest_ok:=false;issues:=issues||jsonb_build_array('UNSAFE_OR_MISSING_BROWSER_ROLE:'||role_name);END IF;
  IF pg_catalog.has_schema_privilege(role_name,'public','CREATE') THEN clear:=false;issues:=issues||jsonb_build_array('SCHEMA_CREATE:'||role_name);END IF;
 END LOOP;
 FOREACH role_name IN ARRAY tables LOOP
  IF role_name NOT IN ('votes','vetoes') AND to_regclass('public.'||role_name) IS NULL THEN manifest_ok:=false;issues:=issues||jsonb_build_array('MISSING_TABLE:'||role_name);END IF;
 END LOOP;
 -- Before foundation backfill, runtime functions may not be installed yet.
 -- Once configuration exists, the frozen runtime/helper graph must be complete.
 IF EXISTS(SELECT FROM public.app_protocol_state) THEN
  FOREACH role_name IN ARRAY functions LOOP
   IF role_name NOT LIKE 'runtime_4a4_%' AND role_name<>'manage_movie_night'
    AND NOT EXISTS(SELECT FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname=role_name) THEN
    manifest_ok:=false;issues:=issues||jsonb_build_array('MISSING_FUNCTION:'||role_name);END IF;
  END LOOP;
 END IF;
 FOR c IN SELECT * FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m','f','S') ORDER BY relname LOOP
  IF c.relkind<>'S' AND NOT c.relname=ANY(tables) THEN manifest_ok:=false;issues:=issues||jsonb_build_array('UNKNOWN_RELATION:'||c.relname);END IF;
  FOR a IN SELECT * FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) LOOP
   IF a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','MAINTAIN') THEN clear:=false;
    surfaces:=surfaces||jsonb_build_array(jsonb_build_object('object',c.oid::regclass::text,'role','PUBLIC','privilege',a.privilege_type,'source','ACL'));END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF pg_catalog.pg_has_role(role_name,c.relowner,'MEMBER') THEN manifest_ok:=false;issues:=issues||jsonb_build_array('BROWSER_OWNER_MEMBERSHIP:'||c.relname||':'||role_name);END IF;
   FOREACH privilege IN ARRAY (CASE WHEN c.relkind='S' THEN ARRAY['USAGE','UPDATE'] ELSE ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']||CASE WHEN current_setting('server_version_num')::integer>=170000 THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END END) LOOP
    IF (CASE WHEN c.relkind='S' THEN pg_catalog.has_sequence_privilege(role_name,c.oid,privilege) ELSE pg_catalog.has_table_privilege(role_name,c.oid,privilege) END) THEN
     clear:=false;surfaces:=surfaces||jsonb_build_array(jsonb_build_object('object',c.oid::regclass::text,'role',role_name,'privilege',privilege,'source','EFFECTIVE'));END IF;
   END LOOP;
   IF c.relkind<>'S' THEN
    FOR p IN SELECT attnum,attname FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped LOOP
     FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
      IF pg_catalog.has_column_privilege(role_name,c.oid,p.attnum,privilege) THEN clear:=false;
       surfaces:=surfaces||jsonb_build_array(jsonb_build_object('object',c.oid::regclass::text,'column',p.attname,'role',role_name,'privilege',privilege,'source','EFFECTIVE_COLUMN'));END IF;
     END LOOP;
     IF EXISTS(SELECT FROM pg_catalog.pg_attribute z CROSS JOIN LATERAL pg_catalog.aclexplode(z.attacl) acl
       WHERE z.attrelid=c.oid AND z.attnum=p.attnum AND acl.grantee=0 AND acl.privilege_type IN ('INSERT','UPDATE','REFERENCES')) THEN clear:=false;issues:=issues||jsonb_build_array('PUBLIC_COLUMN_WRITE:'||c.relname||'.'||p.attname);END IF;
    END LOOP;
   END IF;
  END LOOP;
 END LOOP;
 FOR p IN SELECT * FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid LOOP
  IF NOT p.proname=ANY(functions) THEN manifest_ok:=false;issues:=issues||jsonb_build_array('UNKNOWN_FUNCTION:'||p.oid::regprocedure::text);END IF;
  IF EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') THEN
   clear:=false;surfaces:=surfaces||jsonb_build_array(jsonb_build_object('object',p.oid::regprocedure::text,'role','PUBLIC','privilege','EXECUTE','source','ACL'));END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF pg_catalog.pg_has_role(role_name,p.proowner,'MEMBER') THEN manifest_ok:=false;issues:=issues||jsonb_build_array('BROWSER_FUNCTION_OWNER:'||p.proname);END IF;
   IF pg_catalog.has_function_privilege(role_name,p.oid,'EXECUTE') THEN
    surfaces:=surfaces||jsonb_build_array(jsonb_build_object('object',p.oid::regprocedure::text,'role',role_name,'privilege','EXECUTE','source','EFFECTIVE'));
    IF role_name='anon' OR NOT coalesce(p.oid=ANY(safe_functions),false) THEN clear:=false;END IF;
   END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('manifest_ok',manifest_ok,'legacy_clear',clear,'issues',issues,'surfaces',surfaces);
END $$;

COMMIT;
