-- SEPARATE LOCAL CANDIDATE, NOT PART OF THE ADDITIVE MIGRATION.
-- Future operator-only gate: stop old writers first; authorize independently.
-- Supply verified settings in the SAME session before execution:
-- scorochiatu.foundation_approved = 'verified-preflight'
-- scorochiatu.foundation_group_id, foundation_n_user_id, foundation_v_user_id
-- scorochiatu.foundation_completed_ids = JSON array of the THREE attested night UUIDs.
-- No example UUID is a production value. No seed/fallback identity is permitted.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $backfill$
DECLARE gid uuid; nuid uuid; vuid uuid; completed_ids uuid[]; manifest jsonb;
 name text; has_rows boolean; source_ids uuid[]; target_ids uuid[];
 foundation_tables text[] := ARRAY['groups','group_memberships','personal_list_entries','group_movie_states',
   'movie_night_participants','movie_night_intentions','domain_command_receipts','domain_versions','app_protocol_state'];
BEGIN
 -- Parameter shape and authorization precede every application lock.
 gid:=nullif(current_setting('scorochiatu.foundation_group_id',true),'')::uuid;
 nuid:=nullif(current_setting('scorochiatu.foundation_n_user_id',true),'')::uuid;
 vuid:=nullif(current_setting('scorochiatu.foundation_v_user_id',true),'')::uuid;
 manifest:=nullif(current_setting('scorochiatu.foundation_completed_ids',true),'')::jsonb;
 IF jsonb_typeof(manifest) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_VERIFIED_IDS_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(manifest) item WHERE jsonb_typeof(item)<>'string') THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_VERIFIED_IDS_REQUIRED'; END IF;
 SELECT array_agg(value::uuid ORDER BY value) INTO completed_ids FROM jsonb_array_elements_text(manifest);
 IF gid IS NULL OR nuid IS NULL OR vuid IS NULL OR nuid=vuid OR cardinality(completed_ids) IS DISTINCT FROM 3
    OR (SELECT count(DISTINCT x) FROM unnest(completed_ids) x)<>3 THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_VERIFIED_IDS_REQUIRED'; END IF;
 IF current_setting('scorochiatu.foundation_approved',true) IS DISTINCT FROM 'verified-preflight' THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_GATE_REQUIRED'; END IF;
 FOREACH name IN ARRAY foundation_tables LOOP
   IF to_regclass('public.'||name) IS NULL THEN
     RAISE EXCEPTION 'FOUNDATION_BACKFILL_MISSING_FOUNDATION: %',name; END IF;
   IF NOT EXISTS(SELECT FROM pg_catalog.pg_class WHERE oid=to_regclass('public.'||name) AND relkind='r') THEN
     RAISE EXCEPTION 'FOUNDATION_BACKFILL_INVALID_FOUNDATION: % is not a table',name; END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['foundation_valid_cycle(jsonb)','guard_personal_list_foundation()',
   'guard_group_movie_foundation()','guard_night_intention_foundation()',
   'guard_domain_version_foundation()','guard_command_receipt_foundation()'] LOOP
   IF to_regprocedure('public.'||name) IS NULL THEN
     RAISE EXCEPTION 'FOUNDATION_BACKFILL_MISSING_FOUNDATION: function %',name; END IF;
 END LOOP;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='movie_nights'
   AND column_name IN ('group_id','domain_revision','created_by_caller_id','creation_request_id',
     'selected_support_id','selected_convergence_cycle'))<>6 THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_MISSING_FOUNDATION: movie_nights extensions'; END IF;
 -- Operator backfill only, not the future command serialization mechanism.
 LOCK TABLE public.movies,public.movie_nights,public.app_members,public.groups,public.group_memberships,
   public.personal_list_entries,public.group_movie_states,public.movie_night_participants,
   public.movie_night_intentions,public.domain_command_receipts,public.domain_versions,
   public.app_protocol_state IN SHARE ROW EXCLUSIVE MODE;
 -- All data-dependent preconditions are checked under the locks, before writes.
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_attribute a
   JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='public.movies'::regclass AND a.attname='in_shared_list' AND NOT a.attisdropped
     AND a.atttypid='boolean'::regtype AND a.attnotnull AND pg_get_expr(d.adbin,d.adrelid)='false') THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_LEGACY_SOURCE_CONTRACT: boolean NOT NULL DEFAULT false required'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
   AND (tgrelid,tgname) IN (
     ('public.personal_list_entries'::regclass,'personal_list_foundation_guard'),
     ('public.group_movie_states'::regclass,'group_movie_foundation_guard'),
     ('public.movie_night_intentions'::regclass,'night_intention_foundation_guard'),
     ('public.domain_versions'::regclass,'domain_version_foundation_guard'),
     ('public.domain_command_receipts'::regclass,'command_receipt_foundation_guard')))<>5 THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_INVALID_FOUNDATION: lifecycle guards required'; END IF;
 IF NOT EXISTS(SELECT FROM public.app_members WHERE person='N' AND user_id=nuid)
    OR NOT EXISTS(SELECT FROM public.app_members WHERE person='V' AND user_id=vuid)
    OR (SELECT count(*) FROM public.app_members)<>2 THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_MAPPING_MISMATCH'; END IF;
 IF (SELECT array_agg(id ORDER BY id) FROM public.movie_nights WHERE status='completed')
    IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(completed_ids) x) THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_COMPLETED_MANIFEST_MISMATCH'; END IF;
 FOREACH name IN ARRAY foundation_tables LOOP
   EXECUTE format('SELECT EXISTS(SELECT FROM public.%I)',name) INTO has_rows;
   IF has_rows THEN RAISE EXCEPTION 'FOUNDATION_BACKFILL_EXPECTED_EMPTY: %',name; END IF;
 END LOOP;
 IF EXISTS(SELECT FROM public.movie_nights WHERE group_id IS NOT NULL OR created_by_caller_id IS NOT NULL
    OR creation_request_id IS NOT NULL OR selected_support_id IS NOT NULL OR selected_convergence_cycle IS NOT NULL
    OR domain_revision<>0) THEN RAISE EXCEPTION 'FOUNDATION_BACKFILL_NIGHT_STATE_NOT_EMPTY'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO source_ids FROM public.movies WHERE in_shared_list;
 INSERT INTO public.groups(id) VALUES(gid);
 INSERT INTO public.group_memberships(group_id,person_id) VALUES(gid,nuid),(gid,vuid);
 UPDATE public.movie_nights SET group_id=gid;
 INSERT INTO public.movie_night_participants(night_id,person_id)
   SELECT id,p FROM public.movie_nights CROSS JOIN unnest(ARRAY[nuid,vuid]) p WHERE id=ANY(completed_ids);
 INSERT INTO public.group_movie_states(group_id,movie_id,revision,autonomous_support_id,support_origin,support_state,support_recorded_at)
   SELECT gid,id,1,gen_random_uuid(),'legacy','active',now() FROM public.movies WHERE in_shared_list;
 -- recorded_at is backfill time, NOT an invented historical proposal date/author.
 INSERT INTO public.app_protocol_state(current_group_id) VALUES(gid);
 SELECT coalesce(array_agg(movie_id ORDER BY movie_id),'{}'::uuid[]) INTO target_ids
   FROM public.group_movie_states WHERE group_id=gid AND support_origin='legacy' AND support_state='active';
 IF source_ids IS DISTINCT FROM target_ids
   OR source_ids IS DISTINCT FROM (SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) FROM public.movies WHERE in_shared_list)
   OR EXISTS(SELECT FROM public.group_movie_states WHERE group_id<>gid OR support_origin IS DISTINCT FROM 'legacy'
     OR support_state IS DISTINCT FROM 'active' OR autonomous_support_id IS NULL OR proposed_by IS NOT NULL
     OR suppressed_cycle IS NOT NULL) THEN
   RAISE EXCEPTION 'FOUNDATION_BACKFILL_CANDIDACY_SET_MISMATCH'; END IF;
END $backfill$;
-- No personal intentions, suppression, satisfaction, deletes or v62 writes.
-- The legacy projection remains unchanged. Future activation needs the hard cutover.
COMMIT;
