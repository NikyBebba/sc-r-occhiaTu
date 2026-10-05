-- sc(r)occhiaTu — voto condiviso della recensione insieme, indipendente da N e V.
-- Applicare nel SQL Editor Supabase prima di distribuire il frontend aggiornato.
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS seen_rating_together smallint
    CHECK (seen_rating_together BETWEEN 0 AND 10);

-- Le vecchie recensioni insieme con voto legacy 1–5 restano leggibili anche
-- senza backfill; qui vengono migrate una sola volta alla scala 0–10.
UPDATE public.movies
SET seen_rating_together = rating * 2
WHERE seen_rating_together IS NULL
  AND review_by = 'both'
  AND rating BETWEEN 1 AND 5;

COMMENT ON COLUMN public.movies.seen_rating_together IS
  'Voto condiviso N+V da 0 a 10 della recensione insieme. NULL = non assegnato; distinto dai voti personali.';
