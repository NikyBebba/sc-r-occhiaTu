-- sc(r)occhiaTu — Phase 8.1: voti 0–10 e recensioni distinte.
-- Eseguire nel SQL Editor Supabase prima di pubblicare il frontend aggiornato.
-- Aggiunta non distruttiva: i campi legacy rating/review_text/review_by restano.
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS seen_rating_n smallint CHECK (seen_rating_n BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS seen_rating_v smallint CHECK (seen_rating_v BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS review_text_n text,
  ADD COLUMN IF NOT EXISTS review_text_v text,
  ADD COLUMN IF NOT EXISTS review_text_together text;

-- Conserva i dati storici nell'autore corretto prima che il nuovo client
-- scriva una recensione "insieme" nel mirror legacy review_by/review_text.
-- Il voto storico 1–5 è convertito in 2–10; zero resta NULL (non votato).
UPDATE public.movies SET
  review_text_n = COALESCE(review_text_n, CASE WHEN review_by = 'N' THEN review_text END),
  review_text_v = COALESCE(review_text_v, CASE WHEN review_by = 'V' THEN review_text END),
  review_text_together = COALESCE(review_text_together, CASE WHEN review_by = 'both' THEN review_text END),
  seen_rating_n = COALESCE(seen_rating_n, CASE WHEN review_by = 'N' AND rating BETWEEN 1 AND 5 THEN rating * 2 END),
  seen_rating_v = COALESCE(seen_rating_v, CASE WHEN review_by = 'V' AND rating BETWEEN 1 AND 5 THEN rating * 2 END)
WHERE (review_by = 'N' AND ((review_text_n IS NULL AND review_text IS NOT NULL)
      OR (seen_rating_n IS NULL AND rating BETWEEN 1 AND 5)))
   OR (review_by = 'V' AND ((review_text_v IS NULL AND review_text IS NOT NULL)
      OR (seen_rating_v IS NULL AND rating BETWEEN 1 AND 5)))
   OR (review_by = 'both' AND review_text_together IS NULL AND review_text IS NOT NULL);

COMMENT ON COLUMN public.movies.seen_rating_n IS 'Voto personale di N da 0 a 10. NULL = voto non assegnato; 0 è un voto valido.';
COMMENT ON COLUMN public.movies.seen_rating_v IS 'Voto personale di V da 0 a 10. NULL = voto non assegnato; 0 è un voto valido.';
COMMENT ON COLUMN public.movies.review_text_n IS 'Recensione personale di N, facoltativa e distinta da V e dalla recensione insieme.';
COMMENT ON COLUMN public.movies.review_text_v IS 'Recensione personale di V, facoltativa e distinta da N e dalla recensione insieme.';
COMMENT ON COLUMN public.movies.review_text_together IS 'Recensione della visione insieme, distinta dalle recensioni personali.';
