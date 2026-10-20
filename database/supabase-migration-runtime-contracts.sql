-- Phase 4A2 LOCAL/DORMANT candidate only. Requires the committed foundation.
-- Bootstrap only: no command engine, seeds, protocol activation or runtime grants.
BEGIN;
DO $prerequisites$
BEGIN
 IF pg_catalog.to_regclass('public.app_protocol_state') IS NULL
    OR pg_catalog.to_regclass('public.groups') IS NULL
    OR pg_catalog.to_regclass('public.group_memberships') IS NULL
    OR pg_catalog.to_regclass('public.app_members') IS NULL
    OR pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
   RAISE EXCEPTION 'RUNTIME_CONTRACT_PREREQUISITE: foundation and Auth required';
 END IF;
END $prerequisites$;

CREATE FUNCTION public.get_app_runtime_context(p_client_protocol integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $bootstrap$
WITH
ctx AS MATERIALIZED (SELECT auth.uid() caller_id, p_client_protocol client_protocol),
cfg AS MATERIALIZED (
 SELECT singleton,current_group_id,minimum_client_protocol,mode FROM public.app_protocol_state
),
member AS MATERIALIZED (
 SELECT a.person FROM public.app_members a CROSS JOIN ctx c
 WHERE a.user_id=c.caller_id AND a.person IN ('N','V')
),
gate AS MATERIALIZED (
 SELECT c.*,CASE
  WHEN c.caller_id IS NULL THEN 'UNAUTHENTICATED'
  WHEN NOT EXISTS(SELECT FROM member) THEN 'MEMBERSHIP_REQUIRED'
  WHEN (SELECT pg_catalog.count(*) FROM cfg)<>1
    OR EXISTS(SELECT FROM cfg WHERE singleton IS DISTINCT FROM true
      OR minimum_client_protocol IS NULL OR minimum_client_protocol<0
      OR mode IS NULL OR mode NOT IN ('legacy','read_only','target')) THEN 'FOUNDATION_NOT_READY'
  WHEN NOT EXISTS(SELECT FROM cfg JOIN public.groups g ON g.id=cfg.current_group_id WHERE g.status='active') THEN 'NO_ACTIVE_GROUP'
  WHEN NOT EXISTS(SELECT FROM cfg JOIN public.group_memberships gm ON gm.group_id=cfg.current_group_id
    WHERE gm.person_id=c.caller_id AND gm.active) THEN 'NO_ACTIVE_GROUP'
  WHEN c.client_protocol IS DISTINCT FROM 1
    OR EXISTS(SELECT FROM cfg WHERE minimum_client_protocol>c.client_protocol) THEN 'PROTOCOL_UNSUPPORTED'
  WHEN EXISTS(SELECT FROM cfg WHERE mode='read_only') THEN 'MAINTENANCE'
 END error FROM ctx c
)
SELECT CASE WHEN g.error IS NOT NULL THEN
 pg_catalog.jsonb_build_object('bootstrap_contract_version',1,'outcome','ERROR',
   'error',pg_catalog.jsonb_build_object('code',g.error))
ELSE pg_catalog.jsonb_build_object(
 'bootstrap_contract_version',1,'outcome','OK',
 'caller',pg_catalog.jsonb_build_object('person_id',g.caller_id,'legacy_person',(SELECT person FROM member)),
 'selected_group',pg_catalog.jsonb_build_object('group_id',(SELECT current_group_id FROM cfg)),
 'protocol',pg_catalog.jsonb_build_object('client_protocol',g.client_protocol,'supported_protocol',1,
   'minimum_client_protocol',(SELECT minimum_client_protocol FROM cfg),'snapshot_contract_version',1),
 'runtime',pg_catalog.jsonb_build_object('mode',(SELECT mode FROM cfg),
   'activation_allowed',(SELECT mode='target' FROM cfg))) END
FROM gate g;
$bootstrap$;

REVOKE ALL ON FUNCTION public.get_app_runtime_context(integer) FROM PUBLIC,anon,authenticated;
COMMIT;
