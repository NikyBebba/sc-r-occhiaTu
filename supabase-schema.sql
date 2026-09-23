create table movies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  added_by text check (added_by in ('N', 'V')),
  status text check (status in ('watchlist', 'tonight', 'watched')) default 'watchlist',
  duration text,
  platform text,
  poster text,
  trailer_url text,
  matched boolean default true, -- false = TMDb/OMDb non hanno trovato il titolo, va verificato a mano
  imdb_rating text,
  rt_rating text,
  metacritic_rating text,
  rating integer default 0,
  scheduled_date date,
  scheduled_time time,
  snack text, -- snack abbinato alla serata programmata
  review_text text,
  review_by text check (review_by in ('N', 'V', 'both')), -- chi l'ha visto/recensito: se 'both' il film passa a 'watched', altrimenti resta in watchlist (rewatch insieme)
  watched_by text check (watched_by in ('N', 'V', 'both')), -- chi l'ha VISTO (diverso da chi scrive la recensione): se non 'both', è riproponibile per un rewatch
  genre text, -- mood/tag scelto manualmente: romantico, risata, paura, nostalgia, azione, altro
  proposed_by text check (proposed_by in ('N', 'V')), -- chi ha proposto QUESTA sera (data/ora), non chi ha aggiunto il film
  night_confirmed boolean default false, -- true quando l'altra persona ha confermato la serata proposta
  surprise_by text check (surprise_by in ('N', 'V')), -- chi l'ha scelto in modalità sorpresa, null = non è una sorpresa (o già rivelata)
  tmdb_id bigint, -- id stabile del film su TMDb (step 2): enable funzione saghe/collection, raccomandazioni, match futuri; null = aggiunto prima/fallback OMDb/non trovato
  collection_id bigint, -- se il film fa parte di una saga/collection TMDb
  collection_name text, -- nome leggibile della collection (es. "Il Signore degli Anelli")
  created_at timestamp with time zone default now()
);

create index if not exists idx_movies_tmdb_id on movies (tmdb_id);

alter table movies enable row level security;

-- Policy pubblica: chiunque abbia URL+anon key può leggere/scrivere.
-- Questo è INVARIATO rispetto a prima: la vera barriera d'accesso resta
-- il PIN lato client (vedi config.js). Se in futuro vuoi sicurezza reale,
-- va sostituita con Supabase Auth + policy legate a auth.uid().
create policy "Public Access" on movies for all using (true) with check (true);

-- ============================================
-- SERATE (step 2) — "1 film = 1 contenuto, 1 serata = 1 evento".
-- Separare la serata dal film permette di avere PIÙ serate per lo stesso
-- film (rewatch) e uno storico persistente per calendario/streak future.
-- I campi legacy scheduled_*/proposed_by/night_confirmed su movies restano
-- per compatibilità (strategia B: li alimentiamo ancora in scrittura).
-- ============================================
create table movie_nights (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references movies(id) on delete cascade,
  date date,            -- null = pick veloce "stasera" (senza data fissa)
  time text,            -- es. "21:30"
  snack text,           -- snack abbinato alla serata
  proposed_by text check (proposed_by in ('N', 'V')), -- chi ha proposto la serata
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'cancelled', 'completed', 'skipped')),
  created_at timestamp with time zone default now(),
  confirmed_at timestamp with time zone, -- quando l'altra persona ha confermato
  cancelled_at timestamp with time zone, -- quando è stata annullata/rifiutata
  completed_at timestamp with time zone  -- quando il film è stato visto insieme
);

-- status spiegato:
--   proposed   -> proposta in attesa di conferma dall'altra persona
--   confirmed  -> accettata da entrambi (o pick veloce "stasera")
--   cancelled  -> annullata prima di essere guardata
--   completed  -> serata avvenuta (film visto)
--   skipped    -> RISERVATA a future feature (streak/calendario): una serata
--                 confermata che non si è tenuta. Oggi NESSUN flusso la scrive.

create index if not exists idx_movie_nights_movie_id on movie_nights (movie_id);
create index if not exists idx_movie_nights_status on movie_nights (status);

alter table movie_nights enable row level security;
create policy "Public Access" on movie_nights for all using (true) with check (true);

-- Realtime: la pubblicazione supabase_realtime deve includere tutte le
-- tabelle sincronizzate tra i due telefoni.
alter publication supabase_realtime add table movies, votes, vetoes, movie_nights;

-- ============================================
-- Voti indipendenti per il "Match %" — ognuno vota like/dislike
-- su un film, anche a distanza, senza vedere il voto dell'altro
-- finché non hanno votato entrambi (logica gestita in UI).
-- ============================================
create table votes (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid references movies(id) on delete cascade,
  person text check (person in ('N', 'V')),
  liked boolean not null,
  created_at timestamp with time zone default now(),
  unique (movie_id, person)
);

alter table votes enable row level security;
create policy "Public Access" on votes for all using (true) with check (true);

-- ============================================
-- Veto settimanale — ogni persona può vietare 1 film a settimana
-- dalla ruota. week_key tipo '2026-W39' (calcolato lato client).
-- ============================================
create table vetoes (
  id uuid primary key default gen_random_uuid(),
  person text check (person in ('N', 'V')),
  movie_id uuid references movies(id) on delete cascade,
  week_key text not null,
  created_at timestamp with time zone default now(),
  unique (person, week_key)
);

alter table vetoes enable row level security;
create policy "Public Access" on vetoes for all using (true) with check (true);
