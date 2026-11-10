-- REVIEW ONLY. Not executed remotely by the integration gate.
-- Operator read-only preflight, before backup/maintenance/migration.
BEGIN READ ONLY;
SELECT version() AS postgres_version;
SELECT mode, minimum_client_protocol FROM public.app_protocol_state WHERE singleton;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns WHERE table_schema='public' AND table_name='movie_nights'
AND column_name IN ('id','movie_id','group_id','date','time','status','retrospective','night_memory','snack','location','completed_at')
ORDER BY column_name;
SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public.movie_nights'::regclass
AND (conname='movie_nights_cap1_shape' OR pg_get_constraintdef(oid) LIKE '%night_memory%')
ORDER BY conname;
SELECT p.oid::regprocedure::text AS signature,p.prosecdef,p.proconfig,
 md5(pg_get_functiondef(p.oid)) AS definition_fingerprint,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
FROM pg_proc p WHERE p.oid IN (
 to_regprocedure('public.cap1_execute_app_command(jsonb)'),
 to_regprocedure('public.app_evaluation(uuid,text,jsonb,boolean,boolean)'),
 to_regprocedure('public.execute_app_command(jsonb)'),
 to_regprocedure('public.get_app_runtime_context(integer)'),
 to_regprocedure('public.get_app_runtime_context(integer,integer)'),
 to_regprocedure('public.read_app_protocol(integer)'),
 to_regprocedure('public.get_person_group_snapshot(uuid,integer)'),
 to_regprocedure('public.runtime_4a4_enter_maintenance()'))
ORDER BY signature;
SELECT relname,relrowsecurity,relforcerowsecurity
FROM pg_class WHERE oid IN ('public.movie_nights'::regclass,'public.movie_night_participants'::regclass);
COMMIT;
