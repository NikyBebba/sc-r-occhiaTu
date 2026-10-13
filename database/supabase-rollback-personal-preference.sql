-- PRE-USE ONLY. Never drop after real preferences have existed, even if cleared.
-- Operator must independently confirm pre-use and retain a verified backup.
-- In this session ONLY, set scorochiatu.preference_rollback_pre_use_confirmed=yes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.movies IN ACCESS EXCLUSIVE MODE;
DO $pre$ BEGIN
 IF current_setting('scorochiatu.preference_rollback_pre_use_confirmed',true) IS DISTINCT FROM 'yes' THEN
   RAISE EXCEPTION 'PRE_USE_CONFIRMATION_REQUIRED'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.guard_movie_watch()'::regprocedure) IS DISTINCT FROM 'eb020c52de06995b9c463615d17ea193' THEN
   RAISE EXCEPTION 'PREFERENCE_ROLLBACK: guard drift'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.clear_personal_preference_for_rating()')) IS DISTINCT FROM 'f8f12f86aba2ec1e80aa70a5b5a98f8d' OR
    (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.movies'::regclass AND NOT tgisinternal)<>3 OR
    (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.movies'::regclass AND tgname IN ('movie_personal_rating_n_before','movie_personal_rating_v_before') AND tgtype=19 AND tgenabled='O' AND tgfoid=to_regprocedure('public.clear_personal_preference_for_rating()'))<>2 THEN
   RAISE EXCEPTION 'PREFERENCE_ROLLBACK: helper/trigger drift'; END IF;
 IF EXISTS(SELECT FROM public.movies WHERE personal_liked_n IS NOT NULL OR personal_liked_v IS NOT NULL OR personal_liked_updated_at_n IS NOT NULL OR personal_liked_updated_at_v IS NOT NULL) THEN
   RAISE EXCEPTION 'PREFERENCE_DATA_PRESENT_DO_NOT_DROP'; END IF;
END $pre$;
DROP TRIGGER movie_personal_rating_n_before ON public.movies;
DROP TRIGGER movie_personal_rating_v_before ON public.movies;
DROP FUNCTION public.clear_personal_preference_for_rating();
CREATE OR REPLACE FUNCTION public.guard_movie_watch() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE person text := public.app_person(); other_data boolean; together boolean; entering_list boolean;
BEGIN
 IF person IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
   other_data := CASE WHEN person='N' THEN
     OLD.seen_v OR OLD.seen_rating_v IS NOT NULL OR coalesce(OLD.review_text_v,'')<>''
   ELSE OLD.seen_n OR OLD.seen_rating_n IS NOT NULL OR coalesce(OLD.review_text_n,'')<>'' END;
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
   IF (person='N' AND ROW(NEW.seen_v,NEW.seen_rating_v,NEW.review_text_v) IS DISTINCT FROM ROW(OLD.seen_v,OLD.seen_rating_v,OLD.review_text_v))
     OR (person='V' AND ROW(NEW.seen_n,NEW.seen_rating_n,NEW.review_text_n) IS DISTINCT FROM ROW(OLD.seen_n,OLD.seen_rating_n,OLD.review_text_n)) THEN
     RAISE EXCEPTION 'PERSONAL_OWNER_REQUIRED' USING ERRCODE='42501';
   END IF;
   IF ROW(NEW.watched_by,NEW.rating,NEW.review_by,NEW.review_text) IS DISTINCT FROM ROW(OLD.watched_by,OLD.rating,OLD.review_by,OLD.review_text) THEN
     RAISE EXCEPTION 'LEGACY_FROZEN' USING ERRCODE='42501';
   END IF;
 ELSE
   IF (person='N' AND (NEW.seen_v OR NEW.seen_rating_v IS NOT NULL OR NEW.review_text_v IS NOT NULL))
     OR (person='V' AND (NEW.seen_n OR NEW.seen_rating_n IS NOT NULL OR NEW.review_text_n IS NOT NULL)) THEN
     RAISE EXCEPTION 'PERSONAL_OWNER_REQUIRED' USING ERRCODE='42501';
   END IF;
   IF NEW.watched_by IS NOT NULL OR NEW.review_by IS NOT NULL OR NEW.review_text IS NOT NULL OR coalesce(NEW.rating,0)<>0
     OR NEW.seen_rating_together IS NOT NULL OR NEW.review_text_together IS NOT NULL THEN
     RAISE EXCEPTION 'LEGACY_OR_SHARED_INSERT_FORBIDDEN' USING ERRCODE='42501';
   END IF;
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
 IF entering_list AND ((person='N' AND NEW.seen_n AND NEW.seen_rating_n IS NULL)
   OR (person='V' AND NEW.seen_v AND NEW.seen_rating_v IS NULL)) THEN
   RAISE EXCEPTION 'PERSONAL_RATING_REQUIRED' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
ALTER TABLE public.movies
 DROP CONSTRAINT movies_personal_feedback_n_exclusive,
 DROP CONSTRAINT movies_personal_feedback_v_exclusive,
 DROP CONSTRAINT movies_personal_preference_n_timestamp,
 DROP CONSTRAINT movies_personal_preference_v_timestamp,
 DROP COLUMN personal_liked_n,
 DROP COLUMN personal_liked_v,
 DROP COLUMN personal_liked_updated_at_n,
 DROP COLUMN personal_liked_updated_at_v;
NOTIFY pgrst, 'reload schema';
COMMIT;
