-- ============================================================
-- sc(r)occhiaTu — MIGRATION STEP 4: metadata generi reali
-- Esegui QUESTO FILE NEL SQL EDITOR della Dashboard Supabase
-- (il client anon non può fare DDL).
-- Idempotente: può essere eseguito più volte senza errori.
--
-- Aggiunge movies.genres text[] (generi REALI TMDb it-IT / OMDb).
-- movies.genre resta il mirror MOOD derivato (badge/stats/ruota),
-- alimentato dalla STESSA derivazione di js/genres.js.
-- ============================================================
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS genres text[];

COMMENT ON COLUMN public.movies.genres IS
  'Generi reali del film (nomi TMDb it-IT / OMDb). Fonte per filtri, ricerca e raccomandazioni future. movies.genre resta il mirror mood derivato (js/genres.js) per compatibilità UI.';