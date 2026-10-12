-- Candidato locale: applicare solo dopo autorizzazione separata.
-- Solo RPC esistente, nessun backfill/cutover o modifica schema/RLS/grant.
-- Prerequisito: Individual/Rewatch v54 già applicato. Non rieseguirlo.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)') IS NULL THEN
   RAISE EXCEPTION 'manage_movie_night v54 richiesta';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.manage_movie_night(
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
     IF night.status='completed' AND (p_date IS NOT NULL OR p_time IS NOT NULL) THEN
       RAISE EXCEPTION 'IMMUTABLE_NIGHT_SCHEDULE' USING ERRCODE='22023';
     END IF;
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
 IF p_action='edit' THEN RETURN night; END IF;
 UPDATE public.movies SET
   seen_rating_together=coalesce(p_shared_rating,seen_rating_together),
   review_text_together=coalesce(p_shared_text,review_text_together),
   in_shared_list=CASE WHEN newly_completed THEN false ELSE in_shared_list END
 WHERE id=p_movie_id;
 RETURN night;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
