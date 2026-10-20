-- Phase 4A4 LOCAL CANDIDATE. Installation defines operator boundaries only.
-- No fence/mode/grant change occurs until an operator explicitly calls apply.
-- Future order: install foundation schema; apply fence; COMMIT; capture/check
-- drain; verified foundation backfill (protocol table EMPTY); apply fence again
-- to enter maintenance; COMMIT; capture a new drain checkpoint. No live use here.
BEGIN;
CREATE FUNCTION public.runtime_4a4_audit() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; p record; role_name text; privilege text; a record;
 issues jsonb:='[]'; surfaces jsonb:='[]'; manifest_ok boolean:=true; clear boolean:=true;
 tables text[]:=ARRAY['movies','movie_nights','votes','vetoes','swipe_sessions','swipes','app_members','groups','group_memberships',
  'personal_list_entries','group_movie_states','movie_night_participants','movie_night_intentions','domain_versions','domain_command_receipts','app_protocol_state'];
 functions text[]:=ARRAY['app_cas','app_content_parameters','app_content_write','app_current_week','app_decimal','app_delete_protected',
  'app_evaluation','app_lock_relations','app_match_eligible','app_match_progress','app_person','app_phase2_effects','app_scope','app_shape','app_uuid','app_versions_wire','app_wire',
  'clear_personal_preference_for_rating','domain_bump','domain_candidate','domain_command','domain_cycle','domain_lock_movie','domain_unique_rome_instant',
  'execute_app_command','execute_match_action','foundation_valid_cycle','get_app_runtime_context','get_person_group_snapshot','guard_command_receipt_foundation',
  'guard_domain_version_foundation','guard_group_movie_foundation','guard_movie_watch','guard_night_intention_foundation','guard_personal_list_foundation',
  'manage_movie_night','snapshot_v1_night_instant','runtime_4a4_audit','runtime_4a4_apply_fence','runtime_4a4_capture_drain','runtime_4a4_verify_drain',
  'runtime_4a4_target_used','runtime_4a4_initialize_nights','runtime_4a4_activate_target','runtime_4a4_enter_maintenance'];
 safe_functions oid[]:=ARRAY[to_regprocedure('public.app_person()')::oid,to_regprocedure('public.get_app_runtime_context(integer)')::oid,
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

CREATE FUNCTION public.runtime_4a4_apply_fence() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c record; a record; audit jsonb; cfg public.app_protocol_state;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'OPERATOR_READ_COMMITTED_REQUIRED';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(473106,1); -- operator transitions only
 audit:=public.runtime_4a4_audit();IF NOT (audit->>'manifest_ok')::boolean THEN RAISE EXCEPTION 'FENCE_MANIFEST_DRIFT';END IF;
 SELECT * INTO cfg FROM public.app_protocol_state FOR UPDATE;
 IF cfg.mode='target' THEN RAISE EXCEPTION 'FENCE_REQUIRES_MAINTENANCE';END IF;
 -- Empty config is deliberately preserved for foundation backfill preconditions.
 IF cfg.mode='legacy' THEN UPDATE public.app_protocol_state SET mode='read_only';END IF;
 REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
 FOR c IN SELECT * FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m','f','S') ORDER BY relname LOOP
  IF c.relkind='S' THEN EXECUTE format('REVOKE USAGE,UPDATE ON SEQUENCE %s FROM PUBLIC,anon,authenticated',c.oid::regclass);
  ELSE
   EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE %s FROM PUBLIC,anon,authenticated',c.oid::regclass);
   IF current_setting('server_version_num')::integer>=170000 THEN EXECUTE format('REVOKE MAINTAIN ON TABLE %s FROM PUBLIC,anon,authenticated',c.oid::regclass);END IF;
   FOR a IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT (%I),UPDATE (%I),REFERENCES (%I) ON TABLE %s FROM PUBLIC,anon,authenticated',a.attname,a.attname,a.attname,c.oid::regclass);
   END LOOP;
  END IF;
 END LOOP;
 IF to_regprocedure('public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)') IS NOT NULL THEN
  REVOKE ALL ON FUNCTION public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text) FROM PUBLIC,anon,authenticated;
 END IF;
 audit:=public.runtime_4a4_audit();IF NOT (audit->>'manifest_ok')::boolean OR NOT (audit->>'legacy_clear')::boolean THEN RAISE EXCEPTION 'FENCE_INCOMPLETE';END IF;
 RETURN audit;
END $$;

-- Capture ONLY AFTER the fence transaction commits. Includes virtual XIDs of
-- read-only/idle transactions: a previously admitted RPC might not yet have a
-- domain lock or real XID. Prepared transactions are refused, never terminated.
-- This is an operator-held checkpoint, not a browser credential/auth token.
CREATE FUNCTION public.runtime_4a4_capture_drain() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE audit jsonb; cfg record; vxids jsonb; db oid; catalog_stamp text; capture_xid xid8:=pg_catalog.pg_current_xact_id();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'OPERATOR_READ_COMMITTED_REQUIRED';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(473106,1);
 audit:=public.runtime_4a4_audit();IF NOT (audit->>'manifest_ok')::boolean OR NOT (audit->>'legacy_clear')::boolean THEN RAISE EXCEPTION 'FENCE_REQUIRED';END IF;
 SELECT current_group_id,mode,xmin::text stamp INTO cfg FROM public.app_protocol_state;
 IF cfg.mode IS NOT NULL AND cfg.mode<>'read_only' THEN RAISE EXCEPTION 'MAINTENANCE_REQUIRED';END IF;
 IF cfg.stamp=pg_catalog.pg_current_xact_id()::xid::text THEN RAISE EXCEPTION 'FENCE_COMMIT_REQUIRED';END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND xmin=capture_xid::xid)
 OR EXISTS(SELECT FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND xmin=capture_xid::xid) THEN RAISE EXCEPTION 'FENCE_COMMIT_REQUIRED';END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_prepared_xacts WHERE database=current_database()) THEN RAISE EXCEPTION 'PREPARED_TRANSACTION_PRESENT';END IF;
 PERFORM pg_catalog.pg_stat_clear_snapshot();
 SELECT oid INTO db FROM pg_catalog.pg_database WHERE datname=current_database();
 SELECT coalesce(jsonb_agg(l.virtualxid ORDER BY l.virtualxid),'[]') INTO vxids FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity s ON s.pid=l.pid
  WHERE s.datid=db AND l.locktype='virtualxid' AND l.mode='ExclusiveLock' AND l.granted AND l.pid<>pg_backend_pid();
 SELECT encode(sha256(convert_to(string_agg(kind||':'||oid::text||':'||stamp,',' ORDER BY kind,oid),'UTF8')),'hex') INTO catalog_stamp
 FROM (SELECT 'relation' kind,oid,xmin::text stamp FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace
  UNION ALL SELECT 'function',oid,xmin::text FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace) c;
 RETURN jsonb_build_object('checkpoint_version',1,'database_oid',db::text,'group_id',cfg.current_group_id,'protocol_stamp',cfg.stamp,
  'catalog_stamp',catalog_stamp,'capture_xid',capture_xid::text,'server_start',pg_catalog.pg_postmaster_start_time()::text,'virtual_xids',vxids);
END $$;
CREATE FUNCTION public.runtime_4a4_verify_drain(checkpoint jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE audit jsonb; cfg record; db oid; catalog_stamp text; distance numeric;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'OPERATOR_READ_COMMITTED_REQUIRED';END IF;
 audit:=public.runtime_4a4_audit();IF NOT (audit->>'manifest_ok')::boolean OR NOT (audit->>'legacy_clear')::boolean THEN RAISE EXCEPTION 'FENCE_REQUIRED';END IF;
 SELECT current_group_id,mode,xmin::text stamp INTO cfg FROM public.app_protocol_state;
 SELECT oid INTO db FROM pg_catalog.pg_database WHERE datname=current_database();
 SELECT encode(sha256(convert_to(string_agg(kind||':'||oid::text||':'||stamp,',' ORDER BY kind,oid),'UTF8')),'hex') INTO catalog_stamp
 FROM (SELECT 'relation' kind,oid,xmin::text stamp FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace
  UNION ALL SELECT 'function',oid,xmin::text FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace) c;
 IF checkpoint IS NULL OR jsonb_typeof(checkpoint) IS DISTINCT FROM 'object' OR checkpoint->'checkpoint_version' IS DISTINCT FROM '1'::jsonb OR
   checkpoint->>'database_oid' IS DISTINCT FROM db::text OR checkpoint->>'group_id' IS DISTINCT FROM cfg.current_group_id::text OR
   checkpoint->>'protocol_stamp' IS DISTINCT FROM cfg.stamp OR checkpoint->>'catalog_stamp' IS DISTINCT FROM catalog_stamp OR
   checkpoint->>'server_start' IS DISTINCT FROM pg_catalog.pg_postmaster_start_time()::text OR
   jsonb_typeof(checkpoint->'capture_xid') IS DISTINCT FROM 'string' OR (checkpoint->>'capture_xid') !~ '^[0-9]{1,20}$' OR
   jsonb_typeof(checkpoint->'virtual_xids') IS DISTINCT FROM 'array' OR
   (cfg.mode IS NOT NULL AND cfg.mode<>'read_only') THEN RAISE EXCEPTION 'DRAIN_CHECKPOINT_INVALID';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(checkpoint->'virtual_xids') x WHERE jsonb_typeof(x)<>'string') THEN RAISE EXCEPTION 'DRAIN_CHECKPOINT_INVALID';END IF;
 distance:=pg_catalog.pg_current_xact_id()::text::numeric-(checkpoint->>'capture_xid')::numeric;
 IF distance<0 OR distance>=2147483648 THEN RAISE EXCEPTION 'DRAIN_CHECKPOINT_INVALID';END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_prepared_xacts WHERE database=current_database()) THEN RAISE EXCEPTION 'PREPARED_TRANSACTION_PRESENT';END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_locks l JOIN jsonb_array_elements_text(checkpoint->'virtual_xids') x ON x=l.virtualxid
   WHERE l.locktype='virtualxid' AND l.mode='ExclusiveLock' AND l.granted) THEN RAISE EXCEPTION 'DRAIN_PENDING';END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.runtime_4a4_audit(),public.runtime_4a4_apply_fence(),public.runtime_4a4_capture_drain(),public.runtime_4a4_verify_drain(jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
