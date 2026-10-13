-- Explicit Personal Preference: LOCAL CANDIDATE, live schema review required.
-- No backfill; no client integration. Do not collect preferences with old clients.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.movies IN ACCESS EXCLUSIVE MODE;
DO $pre$
BEGIN
 IF to_regprocedure('public.guard_movie_watch()') IS NULL OR
    (SELECT md5(prosrc)<> '068c195f09f6d17143f8d1989f4931d4' OR prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.guard_movie_watch()'::regprocedure) THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: guard_movie_watch definition drift'; END IF;
 IF to_regprocedure('public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)') IS NULL OR
    (SELECT md5(prosrc)<>'7a2eedc8a2f032721d4a086ef72046fb' OR NOT prosecdef FROM pg_proc WHERE oid='public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)'::regprocedure) THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: completed snack RPC definition drift'; END IF;
 IF to_regprocedure('public.app_person()') IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.movies'::regclass) THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: Auth/RLS absent'; END IF;
 IF EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.movies'::regclass AND NOT attisdropped AND attname IN ('personal_liked_n','personal_liked_v','personal_liked_updated_at_n','personal_liked_updated_at_v')) OR to_regprocedure('public.clear_personal_preference_for_rating()') IS NOT NULL THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: already installed or partial schema'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.movies'::regclass AND NOT attisdropped AND attname IN ('seen_rating_n','seen_rating_v','seen_rating_together') AND atttypid='numeric'::regtype AND atttypmod=-1 AND NOT attnotnull AND NOT EXISTS(SELECT FROM pg_attrdef d WHERE d.adrelid=attrelid AND d.adnum=attnum))<>3 OR
    (SELECT count(*) FROM pg_constraint WHERE conrelid='public.movies'::regclass AND contype='c' AND convalidated AND conname IN ('movies_seen_rating_n_decimal_check','movies_seen_rating_v_decimal_check','movies_seen_rating_together_decimal_check'))<>3 THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: decimal rating contract missing'; END IF;
 IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid='public.movies'::regclass AND NOT a.attisdropped AND a.attname IN ('seen_n','seen_v','in_shared_list') AND a.atttypid='boolean'::regtype AND a.attnotnull AND (SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum)='false')<>3 THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: seen/candidacy column contract drift'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.movies'::regclass AND NOT tgisinternal)<>1 OR NOT EXISTS(
   SELECT FROM pg_trigger WHERE tgrelid='public.movies'::regclass AND tgname='movie_watch_guard' AND tgtype=31 AND tgenabled='O' AND tgfoid='public.guard_movie_watch()'::regprocedure) THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: unexpected movies trigger/order'; END IF;
 IF EXISTS(SELECT FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE NOT has_table_privilege('authenticated','public.movies',p)) OR has_table_privilege('authenticated','public.movies','TRUNCATE') OR
    has_table_privilege('anon','public.movies','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.movie_nights','INSERT,UPDATE,DELETE') THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: table grants require review'; END IF;
 IF (SELECT md5(regexp_replace(prosrc,'[[:space:]]','','g')) FROM pg_proc WHERE oid='public.app_person()'::regprocedure AND NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']) IS DISTINCT FROM 'e596285b5bf1bc0ba5bf57a48f6e2dfb' THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: app_person definition drift'; END IF;
 IF EXISTS(SELECT FROM (VALUES ('seen_rating_n', '75da2bedb9128b405cc25df2987959ab'),('seen_rating_v', '5fc33d24d1d0786735a974e4ec0c1f08'),('seen_rating_together', '8e294a6a250209635a24484065d26074')) expected(col,hash)
   LEFT JOIN pg_constraint c ON c.conrelid='public.movies'::regclass AND c.conname='movies_'||expected.col||'_decimal_check'
   WHERE md5(pg_get_constraintdef(c.oid)) IS DISTINCT FROM expected.hash) THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: rating CHECK definition drift'; END IF;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.movies'::regclass)<>4 OR
   EXISTS(SELECT FROM pg_policy WHERE polrelid='public.movies'::regclass AND (polname NOT IN ('members_read','members_insert','members_update','members_delete') OR polroles IS DISTINCT FROM ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')])) THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: movies policy inventory drift'; END IF;
 IF EXISTS(SELECT FROM (VALUES
 ('members_read','r','((SELECTapp_person()ASapp_person)ISNOTNULL)',NULL),
 ('members_insert','a',NULL,'((SELECTapp_person()ASapp_person)ISNOTNULL)'),
 ('members_update','w','((SELECTapp_person()ASapp_person)ISNOTNULL)','((SELECTapp_person()ASapp_person)ISNOTNULL)'),
 ('members_delete','d','((SELECTapp_person()ASapp_person)ISNOTNULL)',NULL)) expected(name,cmd,qual,withcheck)
 LEFT JOIN pg_policy p ON p.polrelid='public.movies'::regclass AND p.polname=expected.name
 WHERE p.polcmd::text IS DISTINCT FROM expected.cmd OR p.polpermissive IS DISTINCT FROM true OR
 regexp_replace(replace(pg_get_expr(p.polqual,p.polrelid),'public.',''),'[[:space:]]','','g') IS DISTINCT FROM expected.qual OR
 regexp_replace(replace(pg_get_expr(p.polwithcheck,p.polrelid),'public.',''),'[[:space:]]','','g') IS DISTINCT FROM expected.withcheck) THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: movies policy definition drift'; END IF;
 IF EXISTS(SELECT FROM pg_class WHERE oid IN ('public.movie_nights'::regclass,'public.app_members'::regclass) AND NOT relrowsecurity) OR
   has_table_privilege('authenticated','public.app_members','INSERT,UPDATE,DELETE,TRUNCATE') OR NOT has_table_privilege('authenticated','public.app_members','SELECT') THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: membership/night protections missing'; END IF;
 IF (SELECT array_agg(person ORDER BY person) FROM public.app_members) IS DISTINCT FROM ARRAY['N','V'] THEN
   RAISE EXCEPTION 'PREFERENCE_PREREQUISITE: membership mapping requires review'; END IF;
END $pre$;
ALTER TABLE public.movies
 ADD COLUMN personal_liked_n boolean,
 ADD COLUMN personal_liked_v boolean,
 ADD COLUMN personal_liked_updated_at_n timestamptz,
 ADD COLUMN personal_liked_updated_at_v timestamptz,
 ADD CONSTRAINT movies_personal_feedback_n_exclusive CHECK (seen_rating_n IS NULL OR personal_liked_n IS NULL),
 ADD CONSTRAINT movies_personal_feedback_v_exclusive CHECK (seen_rating_v IS NULL OR personal_liked_v IS NULL),
 ADD CONSTRAINT movies_personal_preference_n_timestamp CHECK ((personal_liked_n IS NULL) = (personal_liked_updated_at_n IS NULL)),
 ADD CONSTRAINT movies_personal_preference_v_timestamp CHECK ((personal_liked_v IS NULL) = (personal_liked_updated_at_v IS NULL));

CREATE FUNCTION public.clear_personal_preference_for_rating() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF public.app_person() IS DISTINCT FROM TG_ARGV[0] THEN
   RAISE EXCEPTION 'PERSONAL_OWNER_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF TG_ARGV[0]='N' THEN
   NEW.personal_liked_n:=NULL; NEW.personal_liked_updated_at_n:=NULL;
 ELSIF TG_ARGV[0]='V' THEN
   NEW.personal_liked_v:=NULL; NEW.personal_liked_updated_at_v:=NULL;
 ELSE RAISE EXCEPTION 'INVALID_RATING_TRIGGER'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_personal_preference_for_rating() FROM PUBLIC, anon, authenticated;
-- PostgreSQL executes same-kind triggers by name. These exact names sort
-- before movie_watch_guard. The preflight rejects unknown baseline triggers;
-- tests assert both catalog order and UPDATE OF (including NULL -> NULL).
CREATE TRIGGER movie_personal_rating_n_before BEFORE UPDATE OF seen_rating_n ON public.movies
 FOR EACH ROW EXECUTE FUNCTION public.clear_personal_preference_for_rating('N');
CREATE TRIGGER movie_personal_rating_v_before BEFORE UPDATE OF seen_rating_v ON public.movies
 FOR EACH ROW EXECUTE FUNCTION public.clear_personal_preference_for_rating('V');

CREATE OR REPLACE FUNCTION public.guard_movie_watch() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE person text := public.app_person(); other_data boolean; together boolean; entering_list boolean;
BEGIN
 IF person IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
   other_data := CASE WHEN person='N' THEN
     OLD.seen_v OR OLD.seen_rating_v IS NOT NULL OR coalesce(OLD.review_text_v,'')<>'' OR OLD.personal_liked_v IS NOT NULL OR OLD.personal_liked_updated_at_v IS NOT NULL
   ELSE OLD.seen_n OR OLD.seen_rating_n IS NOT NULL OR coalesce(OLD.review_text_n,'')<>'' OR OLD.personal_liked_n IS NOT NULL OR OLD.personal_liked_updated_at_n IS NOT NULL END;
   IF TG_OP='DELETE' THEN
     IF other_data OR EXISTS(SELECT 1 FROM public.movie_nights WHERE movie_id=OLD.id) THEN
       RAISE EXCEPTION 'MOVIE_PROTECTED' USING ERRCODE='42501';
     END IF;
     RETURN OLD;
   END IF;
   IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'IMMUTABLE_ID' USING ERRCODE='42501'; END IF;
   IF NEW.tmdb_id IS DISTINCT FROM OLD.tmdb_id AND
      (other_data OR EXISTS(SELECT 1 FROM public.movie_nights WHERE movie_id=OLD.id)) THEN
     RAISE EXCEPTION 'MOVIE_IDENTITY_PROTECTED' USING ERRCODE='42501';
   END IF;
   IF (person='N' AND ROW(NEW.seen_v,NEW.seen_rating_v,NEW.review_text_v,NEW.personal_liked_v,NEW.personal_liked_updated_at_v) IS DISTINCT FROM ROW(OLD.seen_v,OLD.seen_rating_v,OLD.review_text_v,OLD.personal_liked_v,OLD.personal_liked_updated_at_v))
     OR (person='V' AND ROW(NEW.seen_n,NEW.seen_rating_n,NEW.review_text_n,NEW.personal_liked_n,NEW.personal_liked_updated_at_n) IS DISTINCT FROM ROW(OLD.seen_n,OLD.seen_rating_n,OLD.review_text_n,OLD.personal_liked_n,OLD.personal_liked_updated_at_n)) THEN
     RAISE EXCEPTION 'PERSONAL_OWNER_REQUIRED' USING ERRCODE='42501';
   END IF;
   IF ROW(NEW.watched_by,NEW.rating,NEW.review_by,NEW.review_text) IS DISTINCT FROM ROW(OLD.watched_by,OLD.rating,OLD.review_by,OLD.review_text) THEN
     RAISE EXCEPTION 'LEGACY_FROZEN' USING ERRCODE='42501';
   END IF;
 ELSE
   IF (person='N' AND (NEW.seen_v OR NEW.seen_rating_v IS NOT NULL OR NEW.review_text_v IS NOT NULL OR NEW.personal_liked_v IS NOT NULL OR NEW.personal_liked_updated_at_v IS NOT NULL))
     OR (person='V' AND (NEW.seen_n OR NEW.seen_rating_n IS NOT NULL OR NEW.review_text_n IS NOT NULL OR NEW.personal_liked_n IS NOT NULL OR NEW.personal_liked_updated_at_n IS NOT NULL)) THEN
     RAISE EXCEPTION 'PERSONAL_OWNER_REQUIRED' USING ERRCODE='42501';
   END IF;
   IF NEW.watched_by IS NOT NULL OR NEW.review_by IS NOT NULL OR NEW.review_text IS NOT NULL OR coalesce(NEW.rating,0)<>0
     OR NEW.seen_rating_together IS NOT NULL OR NEW.review_text_together IS NOT NULL THEN
     RAISE EXCEPTION 'LEGACY_OR_SHARED_INSERT_FORBIDDEN' USING ERRCODE='42501';
   END IF;
 END IF;
 -- Ownership above examines the raw foreign fields before normalization.
 -- UPDATE OF helpers already cleared the owner fields for rating operations.
 IF TG_OP='INSERT' THEN
   IF person='N' AND NEW.seen_rating_n IS NOT NULL THEN NEW.personal_liked_n:=NULL; END IF;
   IF person='V' AND NEW.seen_rating_v IS NOT NULL THEN NEW.personal_liked_v:=NULL; END IF;
 END IF;
 IF person='N' THEN
   IF NEW.personal_liked_n IS NULL THEN NEW.personal_liked_updated_at_n:=NULL;
   ELSIF TG_OP='INSERT' THEN NEW.personal_liked_updated_at_n:=clock_timestamp();
   ELSIF NEW.personal_liked_n IS DISTINCT FROM OLD.personal_liked_n THEN NEW.personal_liked_updated_at_n:=clock_timestamp();
   ELSE NEW.personal_liked_updated_at_n:=OLD.personal_liked_updated_at_n; END IF;
 ELSE
   IF NEW.personal_liked_v IS NULL THEN NEW.personal_liked_updated_at_v:=NULL;
   ELSIF TG_OP='INSERT' THEN NEW.personal_liked_updated_at_v:=clock_timestamp();
   ELSIF NEW.personal_liked_v IS DISTINCT FROM OLD.personal_liked_v THEN NEW.personal_liked_updated_at_v:=clock_timestamp();
   ELSE NEW.personal_liked_updated_at_v:=OLD.personal_liked_updated_at_v; END IF;
 END IF;
 together := EXISTS(SELECT 1 FROM public.movie_nights WHERE movie_id=NEW.id AND status='completed');
 IF TG_OP='UPDATE' AND NOT together AND
    ROW(NEW.seen_rating_together,NEW.review_text_together) IS DISTINCT FROM ROW(OLD.seen_rating_together,OLD.review_text_together) THEN
   RAISE EXCEPTION 'COMPLETED_NIGHT_REQUIRED' USING ERRCODE='42501';
 END IF;
 NEW.status := CASE WHEN EXISTS(SELECT 1 FROM public.movie_nights WHERE movie_id=NEW.id AND status IN ('proposed','confirmed'))
   THEN 'tonight' WHEN together THEN 'watched' ELSE 'watchlist' END;
 entering_list := NEW.in_shared_list;
 IF TG_OP='UPDATE' THEN entering_list := NEW.in_shared_list AND NOT OLD.in_shared_list; END IF;
 IF entering_list AND ((person='N' AND NEW.seen_n AND NEW.seen_rating_n IS NULL AND NEW.personal_liked_n IS NULL)
   OR (person='V' AND NEW.seen_v AND NEW.seen_rating_v IS NULL AND NEW.personal_liked_v IS NULL)) THEN
   RAISE EXCEPTION 'PERSONAL_FEEDBACK_REQUIRED' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_movie_watch() FROM PUBLIC, anon, authenticated;
DO $post$ BEGIN
 IF EXISTS(SELECT FROM public.movies WHERE personal_liked_n IS NOT NULL OR personal_liked_v IS NOT NULL OR personal_liked_updated_at_n IS NOT NULL OR personal_liked_updated_at_v IS NOT NULL) THEN
   RAISE EXCEPTION 'PREFERENCE_POSTCONDITION: unexpected initial preference'; END IF;
END $post$;
NOTIFY pgrst, 'reload schema';
COMMIT;
