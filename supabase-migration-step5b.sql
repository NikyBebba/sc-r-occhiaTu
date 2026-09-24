-- ============================================================
-- sc(r)occhiaTu — MIGRATION STEP 5B: regista + anno
-- Esegui QUESTO FILE NEL SQL EDITOR della Dashboard Supabase
-- (il client anon non può fare DDL).
-- Idempotente: può essere eseguito più volte senza errori.
--
-- Aggiunge movies.release_year (int) e movies.director (text),
-- entrambe nullable. Nessun tocco ai campi legacy.
-- ============================================================
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS release_year integer,
  ADD COLUMN IF NOT EXISTS director text;

COMMENT ON COLUMN public.movies.release_year IS
  'Anno di uscita (release_date TMDb / Year OMDb). Null se non ricavabile.';
COMMENT ON COLUMN public.movies.director IS
  'Regista/i separati da ", " (credits TMDb / Director OMDb). Null se non ricavabile.';