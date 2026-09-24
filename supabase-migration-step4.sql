-- ============================================================
-- sc(r)occhiaTu — MIGRATION STEP 4: metadata generi reali
-- Esegui QUESTO FILE NEL SQL EDITOR della Dashboard Supabase
-- (il client anon non può fare DDL).
-- Idempotente: può essere eseguito più volte senza errori.
--
-- Aggiunge movies.genres text[] (generi REALI TMDb it-IT / OMDb).
-- movies.genre resta la colonna legacy del vecchio sistema mood: oggi non
-- viene più scritta né letta dai flussi (UI/CLI usano solo genres).
-- ============================================================
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS genres text[];

COMMENT ON COLUMN public.movies.genres IS
  'Generi reali del film (nomi TMDb it-IT / OMDb). Fonte per filtri, ruota, ricerca e raccomandazioni future. movies.genre è la colonna legacy del mood, oggi non più scritta né letta.';