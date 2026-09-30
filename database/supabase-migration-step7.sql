-- ============================================================
-- sc(r)occhiaTu — MIGRATION STEP 7: overview + cast su movies
-- Esegui QUESTO FILE NEL SQL EDITOR della Dashboard Supabase
-- (il client anon non può fare DDL).
-- Idempotente: può essere eseguito più volte senza errori.
--
-- Aggiunge movies.overview (text) e movies.cast_names (text[]), entrambe
-- nullable. Il nome "cast_names" evita la parola riservata SQL "cast":
-- PostgREST non quoterebbe l'identificatore e quindi insert/update dal
-- client fallirebbero con errore di sintassi.
-- ============================================================
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS overview text,
  ADD COLUMN IF NOT EXISTS cast_names text[];

COMMENT ON COLUMN public.movies.overview IS
  'Trama in italiano (overview TMDb it-IT). Null se non ricavabile o traduzione assente (mai stringa vuota).';
COMMENT ON COLUMN public.movies.cast_names IS
  'Primi 8 nomi del cast in billing order (credits TMDb). Solo nomi: ruolo e foto restano fuori (minimo che basta per detail/Poster Flip). Null = non ricavato o nessun cast.';