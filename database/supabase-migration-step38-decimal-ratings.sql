-- sc(r)occhiaTu — Phase 38: voti personali e insieme con un decimale.
-- Applicare nel SQL Editor Supabase prima di pubblicare il frontend.
-- Richiede le migration Step 8 e voto insieme già applicate.
-- Conserva NULL, zero e tutti i voti esistenti, senza conversioni di scala.
-- numeric senza scala + CHECK rifiuta 8.34 invece di arrotondarlo a 8.3.
BEGIN;

ALTER TABLE public.movies
  ALTER COLUMN seen_rating_n TYPE numeric USING seen_rating_n::numeric,
  ALTER COLUMN seen_rating_v TYPE numeric USING seen_rating_v::numeric,
  ALTER COLUMN seen_rating_together TYPE numeric USING seen_rating_together::numeric;

-- Nomi dedicati per rendere lo script rieseguibile; i CHECK 0–10 esistenti
-- restano attivi e vengono preservati da ALTER TYPE.
ALTER TABLE public.movies
  DROP CONSTRAINT IF EXISTS movies_seen_rating_n_decimal_check,
  DROP CONSTRAINT IF EXISTS movies_seen_rating_v_decimal_check,
  DROP CONSTRAINT IF EXISTS movies_seen_rating_together_decimal_check;

ALTER TABLE public.movies
  ADD CONSTRAINT movies_seen_rating_n_decimal_check
    CHECK (seen_rating_n BETWEEN 0 AND 10 AND seen_rating_n * 10 = trunc(seen_rating_n * 10)),
  ADD CONSTRAINT movies_seen_rating_v_decimal_check
    CHECK (seen_rating_v BETWEEN 0 AND 10 AND seen_rating_v * 10 = trunc(seen_rating_v * 10)),
  ADD CONSTRAINT movies_seen_rating_together_decimal_check
    CHECK (seen_rating_together BETWEEN 0 AND 10 AND seen_rating_together * 10 = trunc(seen_rating_together * 10));

COMMENT ON COLUMN public.movies.seen_rating_n IS 'Voto personale N 0–10, al massimo un decimale. NULL = assente; zero valido.';
COMMENT ON COLUMN public.movies.seen_rating_v IS 'Voto personale V 0–10, al massimo un decimale. NULL = assente; zero valido.';
COMMENT ON COLUMN public.movies.seen_rating_together IS 'Voto insieme 0–10, al massimo un decimale, distinto da N e V. NULL = assente; zero valido.';

NOTIFY pgrst, 'reload schema';
COMMIT;
