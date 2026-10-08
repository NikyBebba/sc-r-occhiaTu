-- Rollback SOLO pre-utilizzo: rifiuta qualsiasi dato cambiato dopo la migration.
-- Non autorizza un ritorno pubblico né un vecchio frontend dopo nuove scritture.
BEGIN;
LOCK TABLE public.movies, public.movie_nights IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.movies m) IS DISTINCT FROM
    (SELECT value FROM app_watch_backup.checkpoint WHERE kind='movies_after')
 OR (SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM public.movie_nights n) IS DISTINCT FROM
    (SELECT value FROM app_watch_backup.checkpoint WHERE kind='nights') THEN
   RAISE EXCEPTION 'Rollback bloccato: dati successivi al checkpoint, usare correzione compatibile';
 END IF;
END $$;
DROP TRIGGER movie_watch_guard ON public.movies;
DROP FUNCTION public.guard_movie_watch();
DROP FUNCTION public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text);
UPDATE public.movies m SET
 seen_rating_n=b.seen_rating_n,seen_rating_v=b.seen_rating_v,seen_rating_together=b.seen_rating_together,
 review_text_n=b.review_text_n,review_text_v=b.review_text_v,review_text_together=b.review_text_together
FROM jsonb_populate_recordset(NULL::public.movies,
 (SELECT value FROM app_watch_backup.checkpoint WHERE kind='movies_before')) b WHERE b.id=m.id;
DO $$ DECLARE g record; BEGIN
 FOR g IN SELECT statement FROM app_watch_backup.grants LOOP EXECUTE g.statement; END LOOP;
END $$;
-- seen_n/seen_v/in_shared_list e backup conservati. Il futuro riavvio richiede migration dedicata.
NOTIFY pgrst, 'reload schema';
COMMIT;
