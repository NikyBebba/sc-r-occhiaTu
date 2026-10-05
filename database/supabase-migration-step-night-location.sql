-- sc(r)occhiaTu — luogo facoltativo per ogni singola serata.
-- Applicare nel SQL Editor Supabase prima di distribuire il frontend aggiornato.
ALTER TABLE public.movie_nights
  ADD COLUMN IF NOT EXISTS location text;

COMMENT ON COLUMN public.movie_nights.location IS
  'Luogo facoltativo della singola visione; i rewatch possono avere luoghi diversi.';
