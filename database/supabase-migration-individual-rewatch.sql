-- Candidato LOCALE. Non eseguire live senza cutover/deploy coordinato autorizzato.
BEGIN;
LOCK TABLE public.movies, public.movie_nights IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF to_regclass('app_watch_backup.checkpoint') IS NOT NULL THEN
    RAISE EXCEPTION 'Checkpoint Rewatch già presente: non rieseguire il backfill';
  END IF;
  IF (SELECT count(*) FROM public.movies) <> 94
    OR (SELECT count(*) FROM public.movies WHERE status='watchlist' AND watched_by IS NULL AND review_by IS NULL) <> 79
    OR (SELECT count(*) FROM public.movies WHERE status='watchlist' AND watched_by='N' AND review_by IS NULL) <> 12
    OR (SELECT count(*) FROM public.movies WHERE status='watched' AND watched_by='both' AND review_by='both') <> 3
    OR (SELECT count(*) FROM public.movie_nights) <> 34
    OR (SELECT count(*) FROM public.movie_nights WHERE status='completed') <> 3
    OR (SELECT count(*) FROM public.movie_nights WHERE status='cancelled') <> 31
    OR (SELECT count(DISTINCT movie_id) FROM public.movie_nights WHERE status='completed') <> 3
    OR EXISTS (SELECT 1 FROM public.movies m WHERE
      coalesce(m.status='watched' OR m.review_by='both',false) IS DISTINCT FROM
      EXISTS(SELECT 1 FROM public.movie_nights n WHERE n.movie_id=m.id AND n.status='completed'))
    OR (SELECT count(*) FROM public.movies WHERE seen_rating_n IS NOT NULL) <> 13
    OR (SELECT count(*) FROM public.movies WHERE seen_rating_v IS NOT NULL) <> 0
    OR (SELECT count(*) FROM public.movies WHERE seen_rating_together IS NOT NULL) <> 3
  THEN RAISE EXCEPTION 'Dati diversi dall audit approvato: nuovo audit richiesto'; END IF;
  IF (SELECT count(*) FROM public.app_members) <> 2
    OR (SELECT count(*) FROM public.app_members WHERE person='N') <> 1
    OR (SELECT count(*) FROM public.app_members WHERE person='V') <> 1 THEN
    RAISE EXCEPTION 'Membership Auth non valida';
  END IF;
END $$;

-- Backup operatore, fuori dal modello applicativo e dalla publication.
CREATE SCHEMA app_watch_backup;
REVOKE ALL ON SCHEMA app_watch_backup FROM PUBLIC, anon, authenticated;
CREATE TABLE app_watch_backup.checkpoint (kind text PRIMARY KEY, value jsonb NOT NULL);
REVOKE ALL ON app_watch_backup.checkpoint FROM PUBLIC, anon, authenticated;
INSERT INTO app_watch_backup.checkpoint VALUES
 ('movies_before', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.movies m)),
 ('nights', (SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM public.movie_nights n));
CREATE TABLE app_watch_backup.grants (statement text NOT NULL);
REVOKE ALL ON app_watch_backup.grants FROM PUBLIC, anon, authenticated;
INSERT INTO app_watch_backup.grants
SELECT format('GRANT %s ON TABLE public.%I TO %I%s;', privilege_type, table_name, grantee,
 CASE WHEN is_grantable='YES' THEN ' WITH GRANT OPTION' ELSE '' END)
FROM information_schema.table_privileges
WHERE table_schema='public' AND table_name IN ('movies','movie_nights') AND grantee IN ('anon','authenticated')
UNION ALL
SELECT format('GRANT %s (%I) ON TABLE public.%I TO %I%s;', privilege_type, column_name, table_name, grantee,
 CASE WHEN is_grantable='YES' THEN ' WITH GRANT OPTION' ELSE '' END)
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name IN ('movies','movie_nights') AND grantee IN ('anon','authenticated');

ALTER TABLE public.movies
 ADD COLUMN seen_n boolean NOT NULL DEFAULT false,
 ADD COLUMN seen_v boolean NOT NULL DEFAULT false,
 ADD COLUMN in_shared_list boolean NOT NULL DEFAULT false;
UPDATE public.movies SET in_shared_list=(status='watchlist');
UPDATE public.movies SET seen_n=true WHERE status='watchlist' AND watched_by='N';
-- Materializza solo fallback attribuibili; NULL è assenza, vuoto è rimozione esplicita.
UPDATE public.movies SET
 seen_rating_n=coalesce(seen_rating_n,CASE WHEN review_by='N' AND rating BETWEEN 1 AND 5 THEN rating*2 END),
 seen_rating_v=coalesce(seen_rating_v,CASE WHEN review_by='V' AND rating BETWEEN 1 AND 5 THEN rating*2 END),
 seen_rating_together=coalesce(seen_rating_together,CASE WHEN review_by='both' AND rating BETWEEN 1 AND 5 THEN rating*2 END),
 review_text_n=coalesce(review_text_n,CASE WHEN review_by='N' THEN review_text END),
 review_text_v=coalesce(review_text_v,CASE WHEN review_by='V' THEN review_text END),
 review_text_together=coalesce(review_text_together,CASE WHEN review_by='both' THEN review_text END);

CREATE FUNCTION public.guard_movie_watch() RETURNS trigger
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
REVOKE ALL ON FUNCTION public.guard_movie_watch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER movie_watch_guard BEFORE INSERT OR UPDATE OR DELETE ON public.movies
 FOR EACH ROW EXECUTE FUNCTION public.guard_movie_watch();

-- Un solo ingresso per tutti gli eventi. Parametri espliciti, nessun patch arbitrario.
CREATE FUNCTION public.manage_movie_night(
 p_action text, p_movie_id uuid, p_night_id uuid DEFAULT NULL,
 p_date date DEFAULT NULL, p_time text DEFAULT NULL, p_snack text DEFAULT NULL,
 p_location text DEFAULT NULL, p_set_location boolean DEFAULT false,
 p_shared_rating numeric DEFAULT NULL, p_shared_text text DEFAULT NULL
) RETURNS public.movie_nights
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person text := public.app_person(); night public.movie_nights; film public.movies; newly_completed boolean := false;
BEGIN
 IF person IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('propose','quick','complete_now','confirm','cancel','complete','edit') THEN
   RAISE EXCEPTION 'INVALID_NIGHT_ACTION' USING ERRCODE='22023'; END IF;
 IF length(coalesce(p_snack,''))>80 OR length(coalesce(p_location,''))>120 THEN
   RAISE EXCEPTION 'INVALID_NIGHT_DETAILS' USING ERRCODE='22023'; END IF;
 IF p_time IS NOT NULL AND p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
   RAISE EXCEPTION 'INVALID_NIGHT_TIME' USING ERRCODE='22023'; END IF;
 IF p_shared_rating IS NOT NULL AND NOT (p_shared_rating BETWEEN 0 AND 10 AND p_shared_rating*10=trunc(p_shared_rating*10)) THEN
   RAISE EXCEPTION 'INVALID_RATING' USING ERRCODE='22023'; END IF;
 SELECT * INTO film FROM public.movies WHERE id=p_movie_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MOVIE_NOT_FOUND' USING ERRCODE='22023'; END IF;
 IF p_action IN ('propose','quick','complete_now') THEN
   IF p_night_id IS NOT NULL THEN RAISE EXCEPTION 'UNEXPECTED_NIGHT_ID' USING ERRCODE='22023'; END IF;
   IF p_action='propose' AND p_date IS NULL THEN RAISE EXCEPTION 'DATE_REQUIRED' USING ERRCODE='22023'; END IF;
   -- Retry d'una conclusione non programmata: mai creare una seconda prima visione.
   IF p_action='complete_now' THEN
     SELECT * INTO night FROM public.movie_nights WHERE movie_id=p_movie_id AND status='completed' ORDER BY created_at DESC LIMIT 1;
   END IF;
   IF night.id IS NULL THEN
     newly_completed := p_action='complete_now';
     INSERT INTO public.movie_nights(movie_id,date,time,snack,location,proposed_by,status,confirmed_at,completed_at)
     VALUES(p_movie_id,CASE WHEN p_action='propose' THEN p_date END,
       CASE WHEN p_action='propose' THEN coalesce(p_time,'21:30') END,p_snack,p_location,person,
       CASE p_action WHEN 'propose' THEN 'proposed' WHEN 'quick' THEN 'confirmed' ELSE 'completed' END,
       CASE WHEN p_action='quick' THEN now() END,CASE WHEN p_action='complete_now' THEN now() END) RETURNING * INTO night;
   END IF;
 ELSE
   SELECT * INTO night FROM public.movie_nights WHERE id=p_night_id AND movie_id=p_movie_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'NIGHT_NOT_FOUND' USING ERRCODE='22023'; END IF;
   IF p_action='edit' THEN
     IF night.status='cancelled' OR night.status='skipped' THEN RAISE EXCEPTION 'NIGHT_CLOSED' USING ERRCODE='22023'; END IF;
     IF night.status='completed' AND p_snack IS DISTINCT FROM night.snack THEN RAISE EXCEPTION 'COMPLETED_SNACK_FROZEN' USING ERRCODE='22023'; END IF;
     UPDATE public.movie_nights SET snack=p_snack, location=CASE WHEN p_set_location THEN p_location ELSE location END WHERE id=night.id RETURNING * INTO night;
   ELSIF p_action='confirm' THEN
     IF night.status NOT IN ('proposed','confirmed') THEN RAISE EXCEPTION 'NIGHT_CLOSED' USING ERRCODE='22023'; END IF;
     IF night.status='proposed' AND night.proposed_by=person THEN RAISE EXCEPTION 'OTHER_MEMBER_REQUIRED' USING ERRCODE='42501'; END IF;
     UPDATE public.movie_nights SET status='confirmed',confirmed_at=coalesce(confirmed_at,now()) WHERE id=night.id RETURNING * INTO night;
   ELSIF p_action='cancel' THEN
     IF night.status NOT IN ('proposed','confirmed','cancelled') THEN RAISE EXCEPTION 'NIGHT_CLOSED' USING ERRCODE='22023'; END IF;
     UPDATE public.movie_nights SET status='cancelled',cancelled_at=coalesce(cancelled_at,now()) WHERE id=night.id RETURNING * INTO night;
   ELSE
     IF night.status NOT IN ('proposed','confirmed','completed') THEN RAISE EXCEPTION 'NIGHT_CLOSED' USING ERRCODE='22023'; END IF;
     newly_completed := night.status <> 'completed';
     UPDATE public.movie_nights SET status='completed',completed_at=coalesce(completed_at,now()),
       location=CASE WHEN p_set_location THEN p_location ELSE location END WHERE id=night.id RETURNING * INTO night;
   END IF;
 END IF;
 IF (p_shared_rating IS NOT NULL OR p_shared_text IS NOT NULL) AND p_action NOT IN ('complete','complete_now') THEN
   RAISE EXCEPTION 'UNEXPECTED_SHARED_REVIEW' USING ERRCODE='22023'; END IF;
 UPDATE public.movies SET
   seen_rating_together=coalesce(p_shared_rating,seen_rating_together),
   review_text_together=coalesce(p_shared_text,review_text_together),
   in_shared_list=CASE WHEN newly_completed THEN false ELSE in_shared_list END
 WHERE id=p_movie_id;
 RETURN night;
END $$;
REVOKE ALL ON FUNCTION public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text) TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.movie_nights FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE ON public.movies FROM PUBLIC, anon, authenticated;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='movie_nights' LOOP
   EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON public.movie_nights FROM PUBLIC, anon, authenticated',c.column_name,c.column_name);
 END LOOP;
END $$;
INSERT INTO app_watch_backup.checkpoint VALUES
 ('movies_after',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.movies m));
NOTIFY pgrst, 'reload schema';
COMMIT;
