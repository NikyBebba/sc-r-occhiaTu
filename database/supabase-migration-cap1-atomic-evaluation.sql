-- v72: optional Together judgment in the existing CAP-1 transaction.
-- Apply after cap1_target_v2; no table, policy, ACL, protocol or snapshot changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $pre$
BEGIN
 IF to_regprocedure('public.cap1_execute_app_command(jsonb)') IS NULL
    OR to_regprocedure('public.app_evaluation(uuid,text,jsonb,boolean,boolean)') IS NULL
    OR (SELECT mode FROM public.app_protocol_state WHERE singleton) IS DISTINCT FROM 'target'
    OR (SELECT minimum_client_protocol FROM public.app_protocol_state WHERE singleton) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'CAP1_TARGET_V2_REQUIRED';
 END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.cap1_execute_app_command(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE
 caller uuid:=auth.uid(); rid uuid; kind text; target jsonb; params jsonb; versions jsonb;
 movie_id uuid; group_id uuid; night_id uuid; cfg jsonb; prior public.domain_command_receipts;
 fingerprint text; participants uuid[]; required_people uuid[]; item jsonb; stale jsonb;
 declared_date date; date_text text; memory_text text; snack_text text; location_text text;
 old_night public.movie_nights; changed boolean; affected jsonb:='[]'::jsonb; reply jsonb;
 expected_kind text; expected_entity uuid; updated_rows integer; evaluation jsonb;
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
 PERFORM public.app_shape(params,ARRAY['date','participants'],ARRAY['night_memory','location','snack','evaluation','client_snapshot_contract_version']);
   IF params ? 'evaluation' THEN
     evaluation:=params->'evaluation';
     IF jsonb_typeof(evaluation)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
     PERFORM public.app_shape(evaluation,'{}',ARRAY['rating','review']);
   END IF;
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
   -- app_evaluation is the existing Together validator/writer. A validation or
   -- constraint error rolls back the night and participant inserts as well.
   IF evaluation IS NOT NULL THEN
     PERFORM public.app_evaluation(movie_id,cfg#>>'{caller,legacy_person}',evaluation,true);
   END IF;
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

COMMIT;
