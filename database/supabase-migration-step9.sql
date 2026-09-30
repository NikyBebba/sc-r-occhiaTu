-- Step 9: un film identificato da TMDb compare una sola volta nella watchlist.
-- NULL resta ammesso per i film aggiunti senza un risultato TMDb.
-- Prima di applicare, verificare che non ci siano tmdb_id duplicati:
-- SELECT tmdb_id, count(*) FROM public.movies
-- WHERE tmdb_id IS NOT NULL GROUP BY tmdb_id HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS movies_tmdb_id_unique
  ON public.movies (tmdb_id)
  WHERE tmdb_id IS NOT NULL;
