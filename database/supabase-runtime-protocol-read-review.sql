-- REVIEW_ONLY — NOT AUTHORIZED FOR EXECUTION. Define/grant a protocol-only reader;
-- compatibility revision to audit allowlists is explicit. No bootstrap/writer grant.
-- Requires independent production pre-install gate and NEW catalog manifests.
-- Frozen B2/B3 remain historical evidence and MUST NOT be executed unchanged afterward.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $pre$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_database()<>'postgres' OR current_setting('server_version_num')<>'170006' THEN RAISE EXCEPTION 'PROTOCOL_READ_ENVIRONMENT'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname='read_app_protocol') OR (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace)<>45 THEN RAISE EXCEPTION 'PROTOCOL_READ_COLLISION'; END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc WHERE oid='public.runtime_4a4_audit()'::regprocedure AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='ab1f59393b2fc9b154314b5b9727750fcdf27d6542ba7ee857c012d0661eebff') THEN RAISE EXCEPTION 'PROTOCOL_READ_AUDIT_SOURCE_DRIFT'; END IF;
END $pre$;
CREATE FUNCTION public.read_app_protocol(p_client_protocol integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $protocol$
WITH ctx AS MATERIALIZED (SELECT auth.uid() caller),
cfg AS MATERIALIZED (SELECT * FROM public.app_protocol_state),
expected(name,privileges) AS (VALUES ('app_members','SELECT'),('movies','SELECT,INSERT,UPDATE,DELETE'),('movie_nights','SELECT'),('votes',''),('vetoes','SELECT,INSERT,DELETE'),('swipe_sessions','SELECT,INSERT'),('swipes','SELECT,INSERT'),('groups',''),('group_memberships',''),('personal_list_entries',''),('group_movie_states',''),('movie_night_participants',''),('movie_night_intentions',''),('domain_versions','SELECT'),('domain_command_receipts',''),('app_protocol_state','')),
roles AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated')),
table_access AS MATERIALIZED (
 SELECT e.name,r.rolname,p.privilege,
 pg_catalog.has_table_privilege(r.oid,('public.'||e.name)::regclass,p.privilege) actual,
 (r.rolname='authenticated' AND p.privilege=ANY(pg_catalog.string_to_array(e.privileges,','))) expected
 FROM expected e CROSS JOIN roles r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege)
), column_access AS MATERIALIZED (
 SELECT r.rolname,e.name,a.attname,p.privilege,
 pg_catalog.has_column_privilege(r.oid,a.attrelid,a.attnum,p.privilege) actual,
 (r.rolname='authenticated' AND (p.privilege=ANY(pg_catalog.string_to_array(e.privileges,',')) OR (e.name='swipe_sessions' AND p.privilege='UPDATE' AND a.attname IN ('status','matched_movie_id','matched_at')))) expected
 FROM expected e JOIN pg_catalog.pg_attribute a ON a.attrelid=('public.'||e.name)::regclass AND a.attnum>0 AND NOT a.attisdropped
 CROSS JOIN roles r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
), facade_access AS MATERIALIZED (
 SELECT pg_catalog.has_function_privilege('authenticated',p.signature,'EXECUTE') allowed
 FROM (VALUES ('public.get_app_runtime_context(integer)'),('public.get_person_group_snapshot(uuid,integer)'),('public.execute_app_command(jsonb)'),('public.execute_match_action(integer,text,jsonb)')) p(signature)
), facts AS MATERIALIZED (
 SELECT (SELECT count(*)=2 AND bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT pg_catalog.has_schema_privilege(oid,'public','CREATE') AND NOT pg_catalog.pg_has_role(oid,(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.app_protocol_state'::regclass),'MEMBER')) FROM roles)
 AND NOT EXISTS(SELECT FROM pg_catalog.pg_proc p CROSS JOIN roles r WHERE p.pronamespace='public'::regnamespace AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') AND (r.rolname='anon' OR p.oid NOT IN (
 'public.app_person()'::regprocedure,'public.read_app_protocol(integer)'::regprocedure,'public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)'::regprocedure,
 'public.get_app_runtime_context(integer)'::regprocedure,'public.get_person_group_snapshot(uuid,integer)'::regprocedure,'public.execute_app_command(jsonb)'::regprocedure,'public.execute_match_action(integer,text,jsonb)'::regprocedure))) safe_roles,
 NOT EXISTS(SELECT FROM table_access WHERE actual IS DISTINCT FROM expected)
 AND NOT EXISTS(SELECT FROM column_access WHERE actual IS DISTINCT FROM expected)
 AND pg_catalog.has_function_privilege('authenticated','public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)','EXECUTE') legacy_writable,
 NOT EXISTS(SELECT FROM table_access WHERE (privilege='SELECT' AND actual IS DISTINCT FROM expected) OR (privilege<>'SELECT' AND actual))
 AND NOT EXISTS(SELECT FROM column_access WHERE (privilege='SELECT' AND actual IS DISTINCT FROM expected) OR (privilege<>'SELECT' AND actual))
 AND NOT pg_catalog.has_function_privilege('authenticated','public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)','EXECUTE') fenced,
 (SELECT bool_and(allowed) FROM facade_access) target_granted,
 (SELECT bool_and(NOT allowed) FROM facade_access) target_denied,
 (SELECT count(*) FROM cfg) cfg_count,
 NOT EXISTS(SELECT FROM public.groups) AND NOT EXISTS(SELECT FROM public.group_memberships)
 AND NOT EXISTS(SELECT FROM public.personal_list_entries) AND NOT EXISTS(SELECT FROM public.group_movie_states)
 AND NOT EXISTS(SELECT FROM public.movie_night_participants) AND NOT EXISTS(SELECT FROM public.movie_night_intentions)
 AND NOT EXISTS(SELECT FROM public.domain_command_receipts) AND NOT EXISTS(SELECT FROM public.domain_versions)
 AND NOT EXISTS(SELECT FROM public.movie_nights WHERE group_id IS NOT NULL OR domain_revision<>0) foundation_empty,
 (SELECT count(*)=1 FROM cfg JOIN public.groups g ON g.id=cfg.current_group_id WHERE g.status='active' AND g.convergence_version=1
 AND (SELECT count(*) FROM public.group_memberships gm WHERE gm.group_id=g.id AND gm.active)=2
 AND (SELECT count(*) FROM public.group_memberships gm JOIN public.app_members a ON a.user_id=gm.person_id WHERE gm.group_id=g.id AND gm.active)=2) group_ready
), decision AS MATERIALIZED (
 SELECT CASE
 WHEN p_client_protocol IS DISTINCT FROM 1 OR (SELECT caller FROM ctx) IS NULL OR NOT EXISTS(SELECT FROM public.app_members WHERE user_id=(SELECT caller FROM ctx)) OR NOT coalesce(safe_roles,false) THEN NULL
 WHEN cfg_count=0 AND foundation_empty AND legacy_writable AND target_denied THEN 'LEGACY'
 WHEN cfg_count=0 AND foundation_empty AND fenced AND target_denied THEN 'READ_ONLY'
 WHEN cfg_count=1 AND group_ready AND fenced THEN
 (SELECT CASE WHEN mode='legacy' AND minimum_client_protocol=0 AND target_denied THEN 'READ_ONLY'
 WHEN mode='read_only' AND minimum_client_protocol=0 AND target_denied THEN 'READ_ONLY'
 WHEN mode='target' AND minimum_client_protocol=1 AND target_granted THEN 'TARGET'
 WHEN mode='read_only' AND minimum_client_protocol=1 AND target_granted THEN 'READ_ONLY' END FROM cfg)
 END mode,coalesce((SELECT minimum_client_protocol FROM cfg),0) floor FROM facts
), revision AS (
 SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
 (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database())||':'||pg_catalog.pg_postmaster_start_time()::text||':'||coalesce((SELECT xmin::text FROM public.app_protocol_state),'empty')||':'||
 (SELECT string_agg(kind||':'||oid::text||':'||stamp,',' ORDER BY kind,oid) FROM (
 SELECT 'relation' kind,oid,xmin::text stamp FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace
 UNION ALL SELECT 'function',oid,xmin::text FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace
 UNION ALL SELECT 'membership',oid,xmin::text FROM pg_catalog.pg_auth_members) s),'UTF8')),'hex') token
)
SELECT CASE WHEN d.mode IS NULL THEN jsonb_build_object('protocol_read_contract_version',1,'outcome','ERROR','code','PROTOCOL_UNAVAILABLE')
 ELSE jsonb_build_object('protocol_read_contract_version',1,'outcome','OK','mode',d.mode,'minimum_client_protocol',d.floor,'authority_epoch',r.token) END
 FROM decision d CROSS JOIN revision r;
$protocol$;
REVOKE ALL ON FUNCTION public.read_app_protocol(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_app_protocol(integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.runtime_4a4_audit() RETURNS jsonb
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
  'runtime_4a4_target_used','runtime_4a4_initialize_nights','runtime_4a4_activate_target','runtime_4a4_enter_maintenance','read_app_protocol'];
 safe_functions oid[]:=ARRAY[to_regprocedure('public.read_app_protocol(integer)')::oid,to_regprocedure('public.app_person()')::oid,to_regprocedure('public.get_app_runtime_context(integer)')::oid,
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

DO $post$
DECLARE f pg_catalog.pg_proc;
BEGIN
 SELECT * INTO f FROM pg_catalog.pg_proc WHERE oid='public.read_app_protocol(integer)'::regprocedure;
 IF f.proowner<>(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.app_protocol_state'::regclass)
 OR NOT f.prosecdef OR f.provolatile<>'s' OR f.proretset OR f.prokind<>'f'
 OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR f.proargtypes<>'23'::oidvector OR f.prorettype<>'jsonb'::regtype
 OR (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace)<>46
 OR NOT pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE')
 OR EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
 WHERE a.grantee NOT IN (f.proowner,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
 THEN RAISE EXCEPTION 'PROTOCOL_READ_POSTCONDITION'; END IF;
END $post$;
COMMIT;
