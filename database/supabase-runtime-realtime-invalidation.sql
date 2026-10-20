-- Phase 4A5-P LOCAL CANDIDATE ONLY. No runtime/protocol activation.
-- Install before capturing the 4A4 drain checkpoint (catalog ACLs change).
-- SELECT is separately granted here, but requires the existing bootstrap RPC:
-- before 4A4 activation its EXECUTE is revoked; maintenance/legacy reveal no rows.
-- No new helper, browser writer privilege, signal relation or private provenance.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $preflight$
DECLARE r text; c record;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_publication WHERE pubname='supabase_realtime'
   AND NOT puballtables AND pubinsert AND pubupdate)
 OR EXISTS(SELECT FROM pg_catalog.pg_publication_namespace pn JOIN pg_catalog.pg_publication p
   ON p.oid=pn.pnpubid WHERE p.pubname='supabase_realtime') THEN
  RAISE EXCEPTION 'INVALIDATION_PUBLICATION_INCOMPATIBLE';
 END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_publication_rel pr JOIN pg_catalog.pg_publication p ON p.oid=pr.prpubid
   JOIN pg_catalog.pg_class published ON published.oid=pr.prrelid JOIN pg_catalog.pg_namespace n ON n.oid=published.relnamespace
   WHERE p.pubname='supabase_realtime' AND (n.nspname<>'public' OR published.relname NOT IN
    ('movies','movie_nights','votes','vetoes','swipe_sessions','swipes','domain_versions')
    OR (published.relname='domain_versions' AND (pr.prqual IS NOT NULL OR pr.prattrs IS NOT NULL)))) THEN
  RAISE EXCEPTION 'INVALIDATION_PUBLICATION_DRIFT';
 END IF;
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid='public.domain_versions'::regclass;
 IF NOT c.relrowsecurity OR c.relkind<>'r' OR c.relreplident<>'d'
 OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_catalog.pg_attribute
     WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped)
    IS DISTINCT FROM ARRAY['scope_kind','scope_id','entity_id','version','tombstone']
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_trigger WHERE tgrelid=c.oid
   AND tgname='domain_version_foundation_guard' AND tgenabled IN ('O','A')
   AND tgfoid='public.guard_domain_version_foundation()'::regprocedure)
 OR EXISTS(SELECT FROM pg_catalog.pg_policy WHERE polrelid=c.oid AND polname<>'runtime_invalidation_read_v1') THEN
  RAISE EXCEPTION 'INVALIDATION_SIGNAL_SCHEMA_DRIFT';
 END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname=r AND NOT rolsuper AND NOT rolbypassrls)
   OR pg_catalog.pg_has_role(r,c.relowner,'MEMBER')
   OR pg_catalog.has_table_privilege(r,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR pg_catalog.has_any_column_privilege(r,c.oid,'INSERT,UPDATE,REFERENCES') THEN
   RAISE EXCEPTION 'INVALIDATION_UNSAFE_ROLE_OR_WRITE_PRIVILEGE';
  END IF;
 END LOOP;
 IF pg_catalog.has_table_privilege('anon',c.oid,'SELECT') OR pg_catalog.has_any_column_privilege('anon',c.oid,'SELECT')
 OR EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) WHERE grantee=0)
 OR EXISTS(SELECT FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
   WHERE a.attrelid=c.oid AND acl.grantee=0) THEN
  RAISE EXCEPTION 'INVALIDATION_PUBLIC_OR_ANON_PRIVILEGE';
 END IF;
 IF pg_catalog.to_regprocedure('public.get_app_runtime_context(integer)') IS NULL THEN
  RAISE EXCEPTION 'INVALIDATION_BOOTSTRAP_REQUIRED';
 END IF;
END $preflight$;

DROP POLICY IF EXISTS runtime_invalidation_read_v1 ON public.domain_versions;
CREATE POLICY runtime_invalidation_read_v1 ON public.domain_versions FOR SELECT TO authenticated
USING (
 -- The uncorrelated scalar subquery resolves Auth/current membership/mode once
 -- per statement, through the frozen SECURITY DEFINER bootstrap. No config grants.
 (SELECT b->>'outcome'='OK' AND b#>>'{runtime,mode}'='target'
   AND b#>>'{runtime,activation_allowed}'='true'
  FROM (SELECT public.get_app_runtime_context(1) b) bootstrap)
 AND CASE scope_kind
  WHEN 'person_film' THEN scope_id=(SELECT auth.uid()) AND
   (tombstone OR EXISTS(SELECT FROM public.movies m WHERE m.id=entity_id))
  WHEN 'group_film' THEN scope_id=(SELECT (public.get_app_runtime_context(1)#>>'{selected_group,group_id}')::uuid)
   AND (tombstone OR EXISTS(SELECT FROM public.movies m WHERE m.id=entity_id))
  WHEN 'night' THEN scope_id=(SELECT (public.get_app_runtime_context(1)#>>'{selected_group,group_id}')::uuid)
   AND (EXISTS(SELECT FROM public.movie_nights n WHERE n.id=entity_id AND n.group_id=scope_id)
     OR (tombstone AND NOT EXISTS(SELECT FROM public.movie_nights n WHERE n.id=entity_id)))
  -- Snapshot v1 catalog_src is the entire shared catalog, including relationless
  -- content; version_src includes all content tombstones after entity removal.
  -- Access still requires a valid CURRENT Snapshot group via bootstrap above.
  WHEN 'content' THEN scope_id=entity_id AND
   (tombstone OR EXISTS(SELECT FROM public.movies m WHERE m.id=entity_id))
  ELSE false END
);
GRANT SELECT ON TABLE public.domain_versions TO authenticated;
DO $publication$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_publication_rel pr JOIN pg_catalog.pg_publication p
   ON p.oid=pr.prpubid WHERE p.pubname='supabase_realtime' AND pr.prrelid='public.domain_versions'::regclass) THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.domain_versions;
 END IF;
END $publication$;
-- Keep default replica identity (three immutable PK fields). The domain guard
-- prohibits DELETE even for operator DML. Clients use INSERT/UPDATE new rows;
-- old-row payloads and raw DELETE delivery are neither authority nor required.
COMMIT;
