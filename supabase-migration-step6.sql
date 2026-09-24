-- ============================================================
-- sc(r)occhiaTu — MIGRATION STEP 6: Match live (swipe sessions)
-- Esegui QUESTO FILE NEL SQL EDITOR della Dashboard Supabase
-- (il client anon non può fare DDL).
-- Idempotente: può essere eseguito più volte senza errori.
-- ============================================================

-- 1) SESSIONE DI SWIPE: una sessione = UN giro di swipe col proprio mazzo
--    mescolato e congelato (deck uuid[] condiviso dai due telefoni).
--    Al massimo UNA sessione attiva (open|matched) alla volta, garantita
--    dall'indice unico parziale sotto (anti-race della doppia creazione:
--    il secondo insert fallisce e il client fa refetch della riga esistente).
--    Nessun updated_at: l'ultima attività è derivata = max(created_at degli
--    swipe della sessione) oppure created_at della sessione se non ci sono
--    swipe (nessuna scrittura extra per tracciare l'attività).
CREATE TABLE IF NOT EXISTS public.swipe_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by text CHECK (created_by IN ('N','V')),
  -- seed generato dal CLIENT nell'intervallo 0..2^31-1 (colonna integer):
  -- crypto.getRandomValues + & 0x7fffffff, MAI derivato da data/day/id.
  -- Riproduce l'ordine del mazzo nei test (seed iniettato, nessuna
  -- casualità reale).
  seed integer NOT NULL,
  deck uuid[] NOT NULL DEFAULT '{}',
  -- open    = si swipe (ATTIVA: dentro l'indice unico parziale)
  -- matched = match da celebrare (ATTIVA: dentro l'indice)
  -- done    = mazzo esaurito (NON attiva, fuori dall'indice, NON riprendibile)
  -- closed  = chiusa (TTL superato, "Nuova sessione", serata creata dal match)
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','matched','done','closed')),
  matched_movie_id uuid REFERENCES public.movies(id) ON DELETE SET NULL,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.swipe_sessions IS
  'Sessione di swipe Match live: 1 sessione = 1 giro col proprio mazzo congelato. Al massimo una attiva (open|matched) per volta via indice unico parziale (1). done = mazzo esaurito, non riprendibile. closed = TTL scaduto / "Nuova sessione" / serata creata.';

-- Indice unico PARZIALE su espressione costante (1): al massimo UNA riga con
-- status IN ('open','matched') per volta. Inserire una seconda attiva fallisce
-- (anti-race sulla doppia creazione) e il client fa refetch della riga esistente.
-- NOTA: NON usare un unico su ((status)): consentirebbe una 'open' E una
-- 'matched' simultanee (valori diversi non collidono). La costante (1) fa
-- collidere TUTTE quelle attive nella stessa chiave.
CREATE UNIQUE INDEX IF NOT EXISTS swipe_sessions_single_active
  ON public.swipe_sessions ((1))
  WHERE status IN ('open','matched');

-- 2) RISPOSTE: una riga per (sessione, film, persona) — UNIQUE garantisce
--    idempotenza su doppio-tab e swipe simultaneo.
CREATE TABLE IF NOT EXISTS public.swipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.swipe_sessions(id) ON DELETE CASCADE,
  movie_id uuid NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
  person text NOT NULL CHECK (person IN ('N','V')),
  liked boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swipes_session_movie_person_unique UNIQUE (session_id, movie_id, person)
);

COMMENT ON TABLE public.swipes IS
  'Risposta swipe (N/V, liked) su un film della sessione. UNIQUE (session_id, movie_id, person) = idempotenza.';

CREATE INDEX IF NOT EXISTS idx_swipes_session_id ON public.swipes (session_id);
CREATE INDEX IF NOT EXISTS idx_swipes_movie_id ON public.swipes (movie_id);

-- 3) RLS (stesso approccio permissivo di movies/votes/vetoes/movie_nights,
--    vedi technical debt in AGENTS.md — barriera = PIN lato client).
ALTER TABLE public.swipe_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'swipe_sessions'
  ) THEN
    EXECUTE 'CREATE POLICY "public read" ON public.swipe_sessions FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY "public insert" ON public.swipe_sessions FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "public update" ON public.swipe_sessions FOR UPDATE USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "public delete" ON public.swipe_sessions FOR DELETE USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'swipes'
  ) THEN
    EXECUTE 'CREATE POLICY "public read" ON public.swipes FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY "public insert" ON public.swipes FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "public update" ON public.swipes FOR UPDATE USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "public delete" ON public.swipes FOR DELETE USING (true)';
  END IF;
END $$;

-- 4) Realtime: aggiungi le due tabelle alla pubblicazione esistente.
--    (movies/votes/vetoes/movie_nights risultano GIÀ pubblicati.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.swipe_sessions;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.swipes;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- Riavvio esplicito della subscription lato client non serve: supabase-js
-- riabilita la tabella all'avvio. Se arrivano errori "table not in
-- publication", rigenera la pubblicazione aprendo Database > Replication.