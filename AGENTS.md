# AGENTS.md — sc(r)occhiaTu

Progetto di riferimento (contesto permanente per le sessioni di sviluppo).

## Project purpose

Web app condivisa per **due persone, N e V**, che permette di:

- costruire una watchlist comune;
- votare i film in modo indipendente e trovare il "Match" tra i gusti;
- usare una ruota della fortuna per scegliere a caso;
- gestire veto settimanali (1 film escluso a testa a settimana);
- pianificare una serata (data/ora/snack) con proposta e conferma a due;
- recensire i film (testo + stelle 1-5, "visto da N / V / insieme");
- gestire sorprese (poster sfocato finché l'altra persona non rivela);
- vedere statistiche e storico ("Il Nostro Cinema").

La direzione del prodotto è: **un piccolo spazio condiviso per due persone
che trasforma la scelta di un film in una piccola esperienza/rituale**.

L'esperienza deve essere: semplice, mobile-first, condivisa, veloce, ludica,
cinematografica, personale.

## Nomi ufficiali

- **app name**: `sc(r)occhiaTu` (scrittura esatta, da mantenere ovunque: UI,
  documentazione, chiavi di storage locali `scorochiatu_*`).
- **repository GitHub**: `NikyBebba/sc-r-occhiaTu` (nome del repo).

## Tech stack

- HTML + **vanilla JavaScript ES6** (nessun bundler, nessun framework);
- **Tailwind CSS via CDN Play** + `css/style.css` custom;
- **Font Awesome via CDN**;
- **@supabase/supabase-js v2 via CDN** (tabelle: `movies`, `votes`, `vetoes`,
  `movie_nights`, RLS aperte, **Realtime**: postgres_changes su tutte e 4);
- **TMDb API v3** (`language=it-IT`) per ricerca, dettagli, provider, trailer;
- **OMDb API** come fallback e per rating (IMDb / RT / Metacritic);
- **localStorage** come fallback offline di Supabase (mirror + modalità
  degradata segnalata in UI tramite badge);
- **canvas 2D** per la ruota della fortuna.

NON introdurre framework/bundler/backend senza autorizzazione.

## Architecture

Flusso di caricamento dei moduli (ordine in `index.html`):

```
config → api → store → wheel → ui → main
```

- `js/config.js` — chiavi runtime (TMDb/OMDb/Supabase) + `PEOPLE` (label + PIN).
- `js/api.js` — TMDb/OMDb: ricerca candidati, dettaglio, bulk, fallback, rating.
- `js/store.js` — livello dati: Supabase (o localStorage), `movies`, `votes`,
  `vetoes`, `movie_nights`, logica serata (`setQuickTonight`, `proposeNight`,
  `confirmNight`, `cancelNight`, `completeNight`, `nextMoviePick`), match %,
  veto settimanale, sorpresa, **Realtime centralizzato**
  (`subscribeRealtime`/`unsubscribeRealtime`, un solo canale per sessione,
  resync debounced + render solo se il dato cambia) e modalità degradata
  (`dbMode` 'supabase'|'local' con badge in UI, ripristino automatico).
- `js/wheel.js` — ruota canvas: pool, draw, spin animato, confetti.
- `js/ui.js` — render, modali, tab, azioni sui film, helper anti-XSS
  (`escapeHtml`, `jsAttrEscape`), stats, timeline, badge sync.
- `js/main.js` — login (landing → persona → PIN → `sessionStorage`) e
  attivazione Realtime all'ingresso.

Stato: variabili globali (`movies`, `votes`, `vetoes`, `movieNights`,
`currentUser`, `currentTab`, `dbMode`). Ogni azione segue il ciclo:

```
azione → persistenza (Supabase/localStorage) → loadMovies() → render()
```

Le modifiche fatte dagli ALTRI telefoni arrivano via Realtime → resync
debounced (120 ms) → `resyncQuiet()` che fa render SOLO se i dati sono
cambiati (nessun loop/doppio render per gli echi delle proprie scritture).

`render()` ricostruisce il DOM e chiama: `renderScheduled`, `renderVetoInfo`,
`renderSyncStatus`, `renderNextMovieBox` (countdown ogni 30s), `drawWheel`.

## Development workflow

Ogni futura feature segue:

```
ANALYZE → PLAN → IMPLEMENT → TEST → REVIEW → COMMIT
```

## Important rules

- NON introdurre framework, backend o bundler senza autorizzazione.
- NON cambiare il data model senza verificarne le conseguenze
  (le feature future dipendono dalla semantica "serata").
- NON eliminare feature esistenti.
- NON fare refactoring architetturali importanti senza spiegarne la necessità.
- NON modificare l'identità visiva globale (dark cinema, glass, indigo/sky)
  senza richiesta.
- Mantenere **ruota** e **sorpresa** come elementi centrali dell'esperienza.
- Mobile-first: l'app si usa da smartphone, in due.
- Evitare overengineering: simple > clever.
- NON dichiarare una feature completata senza averla testata.
- Distinguere sempre tra **feature implementate** e **TODO/pianificate**.
- Prima di commitare verificare con un harness/check che non ci siano
  ReferenceError o regressioni nei flussi.

## Security/configuration rule

Le API key presenti in `js/config.js` (e referenziate in `js/api.js`) sono
**REALI** e usate direttamente dal frontend (modello client-side del progetto).

- NON inserirle in AGENTS.md, README, report, commit message, log o output.
- NON stamparle.
- NON sostituirle, rigenerarle o modificarle salvo esplicita richiesta.
- NON spostare `config.js` fuori da `js/`.
- Il PIN in `PEOPLE` è un deterrent lato client, NON è sicurezza (accettato).
- RLS Supabase: policy pubbliche per design (barriera = PIN lato client).
- Se si decide che una credenziale non possa essere pubblica, va segnalato
  PRIMA di intervenire (non agire in autonomia).

## Struttura del progetto

```
/
├── index.html
├── AGENTS.md
├── supabase-schema.sql
├── supabase-migration-step2.sql
├── js/
│   ├── config.js
│   ├── api.js
│   ├── store.js
│   ├── wheel.js
│   ├── ui.js
│   └── main.js
└── css/
    └── style.css
```

## Modello dati

- `movies(id, title, added_by, status, duration, platform, poster,
  trailer_url, matched, imdb_rating, rt_rating, metacritic_rating, rating,
  scheduled_date, scheduled_time, snack, review_text, review_by, watched_by,
  genre, proposed_by, night_confirmed, surprise_by, tmdb_id, collection_id,
  collection_name, created_at)`
  - `status`: `watchlist` | `tonight` | `watched`.
  - `tmdb_id`/`collection_id`/`collection_name` (step 2): identificativo
    stabile TMDb + saga/collection, per future feature (saghe,
    raccomandazioni). `null` per film aggiunti prima/fallback OMDb.
  - La "serata" VIVE sull'entità separata `movie_nights`. I flag legacy
    sul film (`scheduled_*`, `proposed_by`, `night_confirmed`) restano
    alimentati in scrittura per compatibilità (strategia B), così vecchi
    dati/render continuano a funzionare.
- `votes(id, movie_id FK, person, liked, unique(movie_id,person))`.
- `vetoes(id, person, movie_id FK, week_key 'YYYY-W##', unique(person,
  week_key))`.
- `movie_nights(id, movie_id FK, date, time, snack, proposed_by, status,
  created_at, confirmed_at, cancelled_at, completed_at)`
  - `status`: `proposed` | `confirmed` | `cancelled` | `completed` |
    `skipped` (quest'ultimo RISERVATO a future feature streak/calendario,
    oggi nessun flusso lo scrive).
  - Regola: **1 film = 1 contenuto, 1 serata = 1 evento** → più serate
    possono puntare allo stesso film (rewatch), storico persistente per
    calendario/streak future.
  - `date NULL` = pick veloce "Stasera" (senza data fissa).

## UX principles

- Due utenti, due telefoni: ogni azione di uno si riflette sull'altro via
  **Realtime** (postgres_changes su movies/votes/vetoes/movie_nights) con
  resync silenzioso e render solo su cambiamento reale; il refetch post-azione
  resta come rete di sicurezza.
- Dark cinema, glass cards, accent indigo/sky, ruota + confetti + sorpresa
  = cuore ludico dell'esperienza.
- Testi piccoli (`text-[10px]`) usati per info complementari: da tenere sotto
  controllo su mobile; i target tattili principali devono restare usabili.

## Feature implementate OGGI

Login PIN per persone, watchlist + aggiunta singola con picker TMDb + import
bulk + dedup titolo normalizzato, voto like/dislike + "Match %", ruota
(canvas + confetti + filtro mood), veto settimanale ISO-week (esclusione dalla
ruota), serata: "Stasera" / programmazione data-ora-snack / proposta-conferma
rifiuto-annullamento / countdown box "Prossimo Film", recensioni, sorpresa,
statistiche + timeline, fix anti-XSS su campi utente.

**Step 2 — fondazione dati condivisa**: verifica live database Supabase,
metadati TMDb persistiti (`tmdb_id`, `collection_id`, `collection_name`),
entità `movie_nights` (serata = evento separato dal film, stati
proposed/confirmed/cancelled/completed, `skipped` riservato), Realtime
centralizzato (un canale, resync debounced, no loop/doppio render), fallback
localStorage come mirror + badge "modalità offline" (visibile, non silenzioso).

## Feature pianificate (NON implementate)

Calendario mensile, export .ics, giorno fisso settimanale, saghe/collection
TMDb, streak, ticket cards, tema stagionale, audio, swipe voting, citazione
casuale, PWA, wildcard "🎲 Sorpresa TMDb" nella ruota, raccomandazioni, easter
egg. **Nessuna di queste va implementata senza una fase dedicata.**

## Vincoli tecnici

- Dipendenze via CDN (Tailwind Play, Font Awesome, supabase-js): per una futura
  PWA andranno internalizzate.
- Nessun service worker / manifest oggi.
- HTML delle card generato come stringhe: usare `escapeHtml`/`jsAttrEscape`
  per qualsiasi dato proveniente dall'utente.
- Storage locale chiavi prefisse `scorochiatu_*` (inclusa
  `scorochiatu_movie_nights`).

## Cose da NON fare senza prima chiedere

1. NON cambiare/eliminare/rinominare colonne o tabelle DB (`movies`,
   `votes`, `vetoes`, `movie_nights`) senza autorizzazione — le feature
   future (calendario/streak/collection) partono dal data model "serata"
   (film = contenuto, serata = evento in `movie_nights`).
2. NON introdurre framework/bundler/backend/auth server.
3. NON cambiare identità visiva globale o spostare ruota/sorpresa in secondo
   piano.
4. NON rimuovere/rigenerare API key o PIN; non spostare `config.js`.
5. NON implementare feature pianificate senza fase dedicata.
6. NON decidere autonomamente su punti architetturali con impatto sulle
   feature future: segnalare invece nel report.
7. NON fare push force, reset distruttivi o cancellazioni di branch.

## Stato verificato (baseline stabile)

- Guard logic `tmdbConfigured()`/`omdbConfigured()` corrette: TMDb e OMDb
  attivi con le chiavi reali in `config.js`; verificati live (ricerca,
  dettaglio, provider, trailer, rating OMDb).
- Funzioni serata in `js/store.js`: `setQuickTonight`, `proposeNight`,
  `confirmNight`, `cancelNight`, `nextMoviePick` (ora su `movie_nights`
  con mirror legacy), più `completeNight`, `subscribeRealtime`.
- Database Supabase **verificato live** (anon key + REST): `movies`,
  `votes`, `vetoes` esistenti e vuoti, CRUD OK, RLS aperte OK, Realtime già
  pubblicato su movies/votes/vetoes. `movie_nights` + `tmdb_id`/
  `collection_id`/`collection_name` presenti **nella MIGRATION** ma da
  applicare in Dashboard (il client anon non può fare DDL).
- **Test live Realtime end-to-end PASS**: insert via client reale → evento
  `postgres_changes` → resync debounced → dati aggiornati; con `movie_nights`
  assente la app resta in modalità `supabase` con warning one-time e fallback
  box legacy (`movieNightsAvailable=false` evita la sottoscrizione a una
  tabella non ancora pubblicata).
- Struttura: file sotto `js/` e `css/`, riferimenti `index.html` allineati.
- Harness Step 2: **27/27 PASS** (guards, store locale incluse serate, metadati
  TMDb live incluse collection, ui add/retry con metadati).
- 36/36 smoke-test PASS (harness Node + DOM stub + chiamate live TMDb/OMDb).