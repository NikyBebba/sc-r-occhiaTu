-- ============================================================
-- sc(r)occhiaTu — MIGRATION STEP 2: shared data foundation
-- Esegui QUESTO FILE NEL SQL EDITOR della Dashboard Supabase
-- (il client anon non può fare DDL).
-- Idempotente: può essere eseguito più volte senza errori.
-- ============================================================

-- 1) Colonne metadati TMDb su movies (identificatore stabile per
--    future function: saghe/collection, raccomandazioni, PWA).
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS tmdb_id bigint,
  ADD COLUMN IF NOT EXISTS collection_id bigint,
  ADD COLUMN IF NOT EXISTS collection_name text;

CREATE INDEX IF NOT EXISTS idx_movies_tmdb_id ON public.movies (tmdb_id);

-- 2) Entità SERATA (independente dal film: più serate per lo stesso
--    film, storico persistente per calendario/streak future).
--    "Fatto: 1 film = 1 contenuto, 1 serata = 1 evento nel calendario
--    delle due persone" (il review invece resta su movies).
CREATE TABLE IF NOT EXISTS public.movie_nights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id uuid NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
  date date,
  time text,
  snack text,
  proposed_by text CHECK (proposed_by IN ('N','V')),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','confirmed','cancelled','completed','skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz
);

COMMENT ON TABLE public.movie_nights IS
  'Serata: evento proposto/confermato/annullato/guardato. date NULL = pick veloce "stasera". status skipped riservato a future feature (streak), oggi non scritto dall app.';

CREATE INDEX IF NOT EXISTS idx_movie_nights_movie_id ON public.movie_nights (movie_id);
CREATE INDEX IF NOT EXISTS idx_movie_nights_status ON public.movie_nights (status);

-- 3) RLS (stesso approccio permissivo di movies/votes/vetoes, vedi
--    technical debt in AGENTS.md — barriera = PIN lato client).
ALTER TABLE public.movie_nights ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movie_nights'
  ) THEN
    EXECUTE 'CREATE POLICY "public read" ON public.movie_nights FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY "public insert" ON public.movie_nights FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "public update" ON public.movie_nights FOR UPDATE USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "public delete" ON public.movie_nights FOR DELETE USING (true)';
  END IF;
END $$;

-- 4) Realtime: aggiungi movie_nights alla pubblicazione esistente.
--    (movies/votes/vetoes risultano GIÀ pubblicati, verificato live:
--    le subscription su quelle tabelle rispondono "SUBSCRIBED".)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.movie_nights;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- Riavvio esplicito della subscription lato client non serve: supabase-js
-- riabilita la tabella all'avvio. Se arrivano errori "table not in
-- publication", rigenera la pubblicazione aprendo Database > Replication.