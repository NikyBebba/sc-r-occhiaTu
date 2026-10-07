# AGENTS.md — sc(r)occhiaTu

Istruzioni permanenti per le sessioni di sviluppo. Checkpoint: 8 ottobre 2026 (Auth/RLS production-verified).
Prima di progettare una fase leggere [docs/MASTER_CONTEXT.md](docs/MASTER_CONTEXT.md):
è la fonte dello stato corrente, delle decisioni UX e della roadmap. Le sezioni
storiche del master context descrivono cicli precedenti, non lo stato finale.
Per modelli e flussi specifici consultare anche le specifiche Phase 22/23/38/41.
Vincoli, sicurezza e contratto Match di questo file restano applicabili.

## Project purpose

Web app condivisa per **due persone, N e V**, che permette di:

- costruire una watchlist comune;
- votare i film in modo indipendente e trovare il "Match" tra i gusti;
- usare una ruota della fortuna per scegliere a caso;
- gestire veto settimanali (1 film escluso a testa a settimana);
- pianificare una serata (data/ora/snack) con proposta e conferma a due;
- segnare visioni N/V/condivise, votare 0–10 con un decimale e recensire con testo facoltativo;
- gestire sorprese (poster sfocato finché l'altra persona non rivela);
- consultare «Ricordi» / «Titoli di coda», storico mensile e quattro riepiloghi;
- consultare gli altri capitoli di una saga TMDb e aggiungerli esplicitamente.

La direzione del prodotto è: **un piccolo spazio condiviso per due persone
che trasforma la scelta di un film in una piccola esperienza/rituale**.

L'esperienza deve essere: semplice, mobile-first, condivisa, veloce, ludica,
cinematografica, personale. Il tono deve essere leggero e giocoso, con riferimenti
al cinema; evitare di ripetere nostro/vostro/insieme quando non aggiunge significato.
Non impostare l'app come esclusivamente romantica o troppo seria. Mantenere
chiare le distinzioni tra voto personale e condiviso e i messaggi d'errore.

## Nomi ufficiali

- **app name**: `sc(r)occhiaTu` (scrittura esatta, da mantenere ovunque: UI,
  documentazione, chiavi di storage locali `scorochiatu_*`).
- **repository GitHub**: `NikyBebba/sc-r-occhiaTu` (nome del repo).

## Tech stack

- HTML + **vanilla JavaScript ES6** (nessun bundler, nessun framework);
- **Tailwind CSS via CDN Play** + `css/style.css` custom;
- **Font Awesome via CDN**;
- **@supabase/supabase-js v2 via CDN** (tabelle: `movies`, `votes`, `vetoes`,
  `movie_nights`, `app_members`, Auth + RLS attivi e verificati in produzione, **Realtime core**: movies/vetoes/movie_nights;
  votes resta nel DB; API dormienti isolate, nessun I/O nel core);
- **TMDb API v3** (`language=it-IT`) per ricerca, dettagli, provider, trailer;
- **OMDb API** come fallback e per rating (IMDb / RT / Metacritic);
- **localStorage** come mirror offline di Supabase solo dopo verifica Auth online nel runtime e con JWT valido (mirror + modalità
  degradata segnalata in UI tramite badge);
- **canvas 2D** per la ruota della fortuna.

NON introdurre framework/bundler/backend senza autorizzazione.

## Architecture

Flusso di caricamento dei moduli (ordine in `index.html`):

```
theme (head) → config → format → haptics → audio → api(omdb+tmdb → index) → auth → store + store/{movies,viewing,legacy,choices,nights,match} → match → filters → wheel → ui(modals+navigation+actions e domini+sagas+render e domini+calendar+match+ticket+loading) → main
```

- `js/config.js` — chiavi runtime (TMDb/OMDb/Supabase) + `PEOPLE` (label) e `AUTH_EMAILS` (email account, ancora vuote). Nessuna password/PIN.
- `js/auth.js` — verifica online Auth/app_members, storage token Ricordami, refresh JWT, guardie identità/generazione, logout e distinzione offline/Auth.
- `js/format.js` — helper DOM-free dei voti decimali (validazione, parsing punto/virgola, formato italiano) e delle date: `formatNightDate(date, time)` (data serata
  leggibile "24 ott · 21:30", senza `new Date('YYYY-MM-DD')`, fallback al dato
  grezzo, mai orari inventati, `date NULL` → "Oggi").
- `js/api/omdb.js` — OMDb: `omdbConfigured`, `extractRatings`, `fetchOmdbByTitle`,
  `fetchOmdbByImdbId`, `omdbToDetails`, `emptyRatings`.
- `js/api/tmdb.js` — TMDb: `tmdbConfigured`, `searchTmdbCandidates`,
  `buildTmdbDetails(detail, fallbackTitle)`, `fetchTmdbDetailsById`,
  `fetchTmdbDetailsByTitle`.
- `js/api/index.js` — orchestratore `fetchMovieDetails` (TMDb → OMDb → notFound).
- `js/store.js` — client, stato globale, letture Supabase/localStorage,
  mirror, fallback e **Realtime core centralizzato**. I domini estratti
  conservano le API globali: `store/movies.js` (CRUD, dedup e sorpresa),
  `store/viewing.js` (visioni, voti e recensioni), `store/legacy.js`
  (API votes dormienti, cache separata), `store/choices.js` (veto),
  `store/nights.js` (serate, pick e adattatori proiezione),
  `store/match.js` (sessioni/swipe, canale Match e presence).
  (`subscribeRealtime`/`unsubscribeRealtime`: il canale del CORE è unico;
  il Match "live" usa un canale separato e temporaneo `scorochiatu-match`,
  per isolare i guasti dal core — i binding match+presence stanno SOLO lì;
  resync debounced + render solo se il dato cambia) e modalità degradata
  (`dbMode` 'supabase'|'local' con badge in UI, ripristino automatico).
  - **CONTRACT Match (riconoscimento dai dati)**: la celebrazione è derivata
    ESCLUSIVAMENTE dai dati (`pendingMatch(session, swipes, deck, movies)`
    != null); lo status `'matched'` NON è un prerequisito e il percorso
    swipe/reconcile/resync NON lo scrive più (resta ammesso dallo schema ma
    inutilizzato, nessuna migration). `matched_movie_id` = ultimo match
    RICONOSCIUTO via "Continua" (scritto solo in quel momento, con
    `matched_at` informativo). `reconcileSession` resta per la sola transizione
    `open→done` (mazzo esaurito, nessun match pendente), idempotente,
    condizionato a id+status `'open'`; chiamato da recordSwipe E dal resync
    (sullo stato fetchato, non sugli swipe locali). "Continua"
    (`continueMatch`): update `matched_movie_id=pending`, `matched_at`,
    status `'open'` (o `'done'` se mazzo esaurito), condizionato a id+status
    `IN('open','matched')`, poi re-read + riallineamento; 0 righe o errore →
    `console.error` una volta (dedup 60s) + riallineamento, mai UI muta;
    idempotente se entrambi premono insieme.
- `js/wheel.js` — ruota canvas: pool, draw, spin animato, confetti.
- `js/ui/modals.js` — `openModal`/`closeModal`/`showConfirmModal` + helper
  anti-XSS `escapeHtml`/`jsAttrEscape` + costanti visuali (`personBadge`).
- `js/ui/navigation.js` — tab (state + switch).
- `js/ui/actions.js` — libreria: aggiunta/picker TMDb, import, stato, cinema,
  eliminazione e retry; `actions/nights.js` gestisce programmazione/Oggi,
  snack/luogo e modifiche, `actions/viewing.js` voti/recensioni/visioni,
  `actions/choices.js` sorpresa e veto. Firme e handler HTML invariati.
- `js/ui/render.js` — coordinatore `render`, home, veto e connessione;
  `render/cards.js` costruisce le card e i frammenti voto condivisi,
  `render/memories.js` storico/statistiche, `render/library.js` controlli
  ricerca/filtri/sort, `render/projections.js` hero/countdown/cartellone,
  `render/detail.js` scheda e transizioni. I domini render si caricano prima
  del coordinatore; `drawWheel` resta invocata dal render.
- `js/ui/sagas.js` — collection TMDb su richiesta, ordine di uscita, suggerimento
  dopo nuova visione, aggiunta esplicita con dedup, retry e protezione sorpresa.
- `js/ui/ticket.js` — ticket PNG via canvas nativo, poster e talloncino; origine
  solo in memoria, nessun nuovo campo DB.
- `js/theme.js` — otto temi automatici per stagioni/festività; override manuale
  locale fino al cambio di periodo (finestre e precedenze nel master context).
- `js/audio.js` / `js/haptics.js` — preferenze locali opt-in per suoni/vibrazioni;
  `js/ui/loading.js` — ciak loader e skeleton iniziali.
- `js/main.js` — login (landing → persona → PIN → Supabase Auth verificato) e
  attivazione Realtime all'ingresso.
- `scripts/import-movies.js` — import/aggiornamento massivo dei film da
  `data/movie-watchlist.json` (match TMDb prudente + alias documentati +
  fallback OMDb, idempotente, `--dry-run` e `--limit=N`, non tocca
  titoli/status/voti/recensioni/serate). Serve anche da verifica live del DB.
- `scripts/smoke.js` — harness smoke-test (`node scripts/smoke.js`): carica
  tutti i moduli con DOM stub, verifica guardie/load, serate su `movie_nights`,
  vote/veto/sorpresa/recensione, metadati TMDb live, anti-XSS. Atteso green.
- `scripts/audit-data-model.js` — audit solo GET paginati (`--live`) o fixture
  (`--file=...`), output aggregato senza ID/titoli/credenziali. Distingue legacy
  senza eventi, mirror divergenti/chiusi, multi-eventi e date mancanti; non migra.
- `data/movie-watchlist.json` — lista ufficiale titoli (source of truth), N: 116
  + V: 15 = 131.

Stato core: variabili globali (`movies`, `vetoes`, `movieNights`,
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

Le API key presenti in `js/config.js` (e referenziate in `js/api/index.js`) sono
**REALI** e usate direttamente dal frontend (modello client-side del progetto).

- NON inserirle in AGENTS.md, README, report, commit message, log o output.
- NON stamparle.
- NON sostituirle, rigenerarle o modificarle salvo esplicita richiesta.
- NON spostare `config.js` fuori da `js/`.
- Il vecchio PIN client-side è rimosso su richiesta esplicita. Non reinserire PIN/password nel frontend o usare storage/UI per autorizzare identità.
- Supabase Auth/RLS: **attivi e production-verified**. PREPARE/CUTOVER/account/mapping applicati dall’utente; Realtime ON e Allow public access OFF, publication delle sole cinque tabelle attive. Non rieseguire migration né riaprire policy pubbliche. [Stato e rollback](docs/AUTH_SUPABASE.md); fermarsi prima di SQL/live o deploy non autorizzati.
- Non convertire errori Auth/RLS in fallback offline; app_members è modificabile solo dall’operatore. Non introdurre service-role frontend.
- Se si decide che una credenziale non possa essere pubblica, va segnalato
  PRIMA di intervenire (non agire in autonomia).

## Struttura del progetto

```text
/
├── index.html, AGENTS.md, README.md
├── manifest.json, service-worker.js, icons/
├── database/                    # schema e migration, nessun dump
├── data/movie-watchlist.json    # lista iniziale ufficiale
├── docs/                       # MASTER_CONTEXT e specifiche delle fasi
├── scripts/                    # import, metadati, smoke, verify-sw
├── js/
│   ├── config.js, auth.js, format.js, theme.js, audio.js, haptics.js
│   ├── store.js, match.js, filters.js, wheel.js, main.js
│   ├── store/{movies,viewing,legacy,choices,nights,match}.js
│   ├── api/{omdb,tmdb,index}.js
│   └── ui/
│       ├── {modals,navigation,actions,sagas,render,calendar,match,ticket,loading}.js
│       ├── actions/{nights,viewing,choices}.js
│       └── render/{cards,memories,library,projections,detail}.js
└── css/style.css
```

## Modello dati

- `app_members(user_id UUID FK auth.users, person UNIQUE N/V)`: migration locale,
  mapping amministrativo; membro legge solo se stesso, nessuna scrittura client.

- `movies(id, title, added_by, status, duration, platform, poster,
  trailer_url, matched, imdb_rating, rt_rating, metacritic_rating, rating,
  scheduled_date, scheduled_time, snack, review_text, review_by, watched_by,
  genre, proposed_by, night_confirmed, surprise_by, tmdb_id, collection_id,
  collection_name, cinema_watchlist, seen_rating_n, seen_rating_v,
  seen_rating_together, review_text_n, review_text_v, review_text_together,
  genres, release_year, director, overview, cast_names, created_at)`
  - `status`: `watchlist` | `tonight` | `watched`.
  - `tmdb_id`/`collection_id`/`collection_name` (step 2): identificativo
    stabile TMDb + saga/collection, usati dal pannello saghe e disponibili
    per future raccomandazioni. `null` per film aggiunti prima/fallback OMDb.
  - `seen_rating_n/v/together`: numeric 0–10 con al massimo un decimale;
    NULL = assente, zero valido. Migration Phase 38 applicata dall'utente;
    verifica indipendente dei tipi OpenAPI non riuscita (HTTP 401), non
    dichiarare test di scrittura reale che non sono stati eseguiti.
  - Testi N/V/condiviso distinti e facoltativi; stringa vuota esplicita rimuove
    solo il testo, preservando voto e dati degli altri autori. Testo omesso nel
    livello dati conserva la recensione; non far riapparire il mirror legacy.
  - `cinema_watchlist` esclude da Ruota e Match; libreria e programmazione restano.
    Due viste separate Streaming/Cinema (Streaming iniziale), switch senza dropdown;
    Azzera filtri conserva la vista, card cinema ambrate e azioni Oggi/Programma uniformi.
  - La programmazione vive **solo in `movie_nights`**. Colonne legacy
    `scheduled_date/time`, `snack`, `proposed_by`, `night_confirmed` sul film
    restano nel DB per rollback, ma NON leggere/scrivere né riattivare fallback
    applicativi. `MOVIE_SELECT_FIELDS` seleziona solo contenuto e visioni.
    I nomi scheduled_* nelle API renderer/ticket sono adattatori degli eventi.
    `movies.status` conserva il ciclo film esistente per visioni/Ruota/Match;
    filtro e contatore In programma dipendono dagli eventi attivi.
- `votes(id, movie_id FK, person, liked, unique(movie_id,person))`: like/dislike
  dismessi dalla UI, distinti dai voti decimali e dal Match Live. API dormienti
  in store/legacy.js, nessun I/O remoto; cache separata. Il core non legge,
  scrive o ripulisce questo snapshot/cache e non lo include in render/Realtime.
  Non droppare/cancellare colonne/tabelle/dati legacy. Un rollback a frontend
  precedenti richiede riallineare i mirror dalle nuove serate; non inventare dati.
- `vetoes(id, person, movie_id FK, week_key 'YYYY-W##', unique(person,
  week_key))`.
- `movie_nights(id, movie_id FK, date, time, snack, proposed_by, status,
  location, created_at, confirmed_at, cancelled_at, completed_at)`
  - `status`: `proposed` | `confirmed` | `cancelled` | `completed` |
    `skipped` (quest'ultimo RISERVATO a future feature streak/calendario,
    oggi nessun flusso lo scrive).
  - Regola: **1 film = 1 contenuto, 1 serata = 1 evento** → più serate
    possono puntare allo stesso film (rewatch), storico persistente per
    calendario/streak future.
  - `date NULL` = pick veloce "Oggi" (senza data fissa).

## UX principles

- Due utenti, due telefoni: ogni azione di uno si riflette sull'altro via
  **Realtime core** (postgres_changes su movies/vetoes/movie_nights) con
  resync silenzioso e render solo su cambiamento reale; il refetch post-azione
  resta come rete di sicurezza.
- Dark cinema, glass cards, accent indigo/sky, ruota + confetti + sorpresa
  = cuore ludico dell'esperienza.
- Testi piccoli (`text-[10px]`) usati per info complementari: da tenere sotto
  controllo su mobile; i target tattili principali devono restare usabili.

## Feature implementate al checkpoint corrente

Login persona/PIN, home Match/Ruota/Libreria, watchlist con picker TMDb,
import bulk, dedup per ID e UNIQUE, Match Live a swipe con presence e Match %,
Ruota canvas con filtri e confetti, veto settimanale, sorprese, serate con
proposta/conferma e rewatch, popup «Oggi» con snack/luogo facoltativi e modificabili,
proposte «In cartellone» accettabili anche durante il film di oggi, calendario mensile,
voti personali/condivisi 0–10 con decimali e recensioni facoltative,
«Titoli di coda» con riepiloghi e storico, saghe TMDb, ticket PNG,
temi automatici, PWA, audio/haptics opt-in e ciak loader.
Il voto condiviso e la sua azione usano N+V in oro; il pulsante personale segue
quello condiviso nel colore N/V. «Film aggiunti» conta l'intera libreria per autore.
Le metriche di compatibilità restano esclusiva di Match Live.

Le verifiche locali non sostituiscono il test condiviso su due telefoni dopo
il deploy. Ticket e temi erano già stati provati dall'utente dopo il push precedente.

**Step 2 — fondazione dati condivisa**: verifica live database Supabase,
metadati TMDb persistiti (`tmdb_id`, `collection_id`, `collection_name`),
entità `movie_nights` (serata = evento separato dal film, stati
proposed/confirmed/cancelled/completed, `skipped` riservato), Realtime
centralizzato (un canale, resync debounced, no loop/doppio render), fallback
localStorage come mirror + badge "modalità offline" (visibile, non silenzioso).

**Step 2.5 — moduli + watchlist reale**: refactoring strutturale senza
cambio di comportamento (`js/api.js` → `js/api/{omdb,tmdb,index}.js`,
`js/ui.js` → `js/ui/{modals,navigation,actions,render}.js`, nomi API pubblici
invariati, ordine script in `index.html` allineato) e import della watchlist
ufficiale in Supabase da `data/movie-watchlist.json` via
`scripts/import-movies.js` (matching TMDb prudente su title/original_title +
bonus sottotitolo-prefisso + alias documentati, fallback OMDb, idempotente).

## Feature pianificate (NON implementate)

Hot Picks (richiede ulteriori dati e migration autorizzata), export .ics, giorno fisso
settimanale, streak, gamification senza leaderboard, Poster Flip,
raccomandazioni avanzate, statistiche personali, eventuale spazio Extra,
citazione casuale, wildcard TMDb nella Ruota ed easter egg.
**Nessuna va implementata senza una fase dedicata.** Non riproporre come
future saghe, ticket, calendario, audio, temi, PWA o voti decimali: sono presenti.
Per le priorità precise leggere il master context aggiornato.

## Vincoli tecnici

- Dipendenze ancora via CDN (Tailwind Play, Font Awesome, supabase-js).
- PWA presente: manifest e service worker, cache corrente `v50`; domini API,
  Supabase, poster e YouTube sempre esclusi dall'intercettazione. Le icone PWA
  sono provvisorie; non confondere l'app-shell offline con dati remoti disponibili.
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
4. NON rimuovere/rigenerare API key senza autorizzazione; non spostare `config.js`. PIN nuovi impostati manualmente in Auth, mai nel codice.
5. NON implementare feature pianificate senza fase dedicata.
6. NON decidere autonomamente su punti architetturali con impatto sulle
   feature future: segnalare invece nel report.
7. NON fare push force, reset distruttivi o cancellazioni di branch.

## Baseline storica (Step 2/2.5, non un nuovo test live)

- Guard logic `tmdbConfigured()`/`omdbConfigured()` corrette: TMDb e OMDb
  attivi con le chiavi reali in `config.js`; verificati live (ricerca,
  dettaglio, provider, trailer, rating OMDb).
- Funzioni serata in `js/store.js`: `setQuickTonight`, `proposeNight`,
  `confirmNight`, `cancelNight`, `nextMoviePick` (ora su `movie_nights`
  con mirror legacy), più `completeNight`, `subscribeRealtime`.
- Database Supabase **verificato live** (anon key + REST): `movies`,
  `votes`, `vetoes` esistenti, CRUD OK, RLS aperte OK, Realtime già
  pubblicato su movies/votes/vetoes. `movie_nights` + `tmdb_id`/
  `collection_id`/`collection_name` **applicati in Dashboard**. **Watchlist
  131 film importata** (N: 116 + V: 15, `--dry-run` poi inserimento reale):
  tmdb_id 100%, collection 22 titoli, 0 duplicati, idempotente (2° run: 0
  insert, 131 already existing, 0 metadata update).
- **Test live Realtime end-to-end PASS**: insert via client reale → evento
  `postgres_changes` → resync debounced → dati aggiornati; con `movie_nights`
  assente la app resta in modalità `supabase` con warning one-time e fallback
  box legacy (`movieNightsAvailable=false` evita la sottoscrizione a una
  tabella non ancora pubblicata).
- Struttura **modulare**: `js/api/{index,omdb,tmdb}.js` e
  `js/ui/{actions,modals,navigation,render}.js` (f.To `js/api.js`/`js/ui.js`
  rimossi), ordine script in `index.html` allineato, `store.js`/`config.js`
  centralizzati.
- Harness smoke alla baseline Step 2/2.5 (`scripts/smoke.js`): **32/32 PASS** (guards + load, serate
  su `movie_nights`, vote/veto/sorpresa/recensione, metadati TMDb live
  incluse collection+aliasing titoli IT, ui add/retry, anti-XSS).
- `node --check` OK su tutti i moduli `js/**/*.js` + `scripts/`.

## Auth/RLS production-verified — 8 ottobre 2026

- Migrazione conclusa; l’utente conferma su entrambi i dispositivi login N/V,
  dati, persistenza sessione, Realtime, Match Live e logout PASS.
- Commit funzionale `2bd43a6458733d479b32c790a6da5982f425dbce`, pubblicato su origin/main e
  https://sc-r-occhia-tu.vercel.app; SW v50. Verificati dall’agente 45 file
  runtime identici, landing/gate mobile e SW installato, nessuna richiesta Supabase.
- Cutover e policy RLS/realtime.messages confermati dall’utente; Realtime ON,
  public access OFF; publication movies/movie_nights/swipe_sessions/swipes/vetoes.
  votes conservata senza accesso applicativo né publication. Non ripetere cutover.
- Test hosted dichiarati dall’utente distinti da fixture locali; non attribuire
  a questo collaudo casi negativi/offline/refresh specifici non riportati.
- Limiti: due membri, verifica online all’ingresso, mirror solo nel runtime
  autorizzato con JWT valido; sessionStorage/autofill dipendono dal browser,
  logout locale lascia indipendente l’altro client. CSV non sono backup completo.
- Le sezioni sotto sono cronologia. Il presente ciclo modifica solo documenti;
  non autorizza ulteriori modifiche funzionali, DB o impostazioni live.

## Storico: candidato Auth completo — 8 ottobre 2026

- Email reali N/V configurate su autorizzazione dell’utente; nessun PIN/password,
  UUID reale o secret aggiunto. Checkpoint Git locale pre-cutover autorizzato.
- Smoke 400/400, Auth 43/43 (inclusa config runtime), RLS locale 40/40,
  PWA 15/15, Chromium Auth 18/18; 345 API e 144 scenari DOM conservati.
  Programmazione/cinema/Ricordi 320/390/768, recensioni N/V 320/390 green.
- Candidato pronto al cutover coordinato. Test hosted e due dispositivi restano
  necessari dopo attivazione. Nessuna modifica Supabase live, push o deploy.
- I checkpoint precedenti sono storici: email mancanti/commit vietato erano
  vincoli precedenti, superati dall’autorizzazione corrente. Resta vietato
  eseguire cutover, modificare Realtime live o pubblicare senza autorizzazione.

## Storico: aggiornamento locale publication — 8 ottobre 2026

- Cutover salva membership votes in app_security_backup.auth_publication,
  poi la rimuove solo dalla publication, preservando tabella e dati.
- Rollback ripristina la membership originaria; nessuna modifica alle altre
  tabelle pubblicate. Publication assente/FOR ALL TABLES blocca l'operazione.
- RLS locale 40/40, Auth 42/42, PWA 15/15, sintassi e diff check PASS.
  Nessun intervento live, commit/push/deploy o modifica frontend/Match.

## Storico: checkpoint Auth pre-cutover — 7 ottobre 2026

- PREPARE completato manualmente dall'utente: due account Auth confermati e
  due mapping N/V verificati via SQL. Non ripetere PREPARE/creazione account.
  Nessuna verifica o modifica Supabase live dall'agente in questo ciclo.
- Email reali ancora da chiarire: EMAIL_N/EMAIL_V sono segnaposto; AUTH_EMAILS
  resta vuoto. Non inventare email/UUID/password né dichiarare pronto il deploy.
- Auth solo da sessione verificata/app_members; Ricordami, refresh JWT,
  logout locale e separazione offline/Auth. Corrette risposte getSession
  obsolete e AuthSessionMissingError senza status HTTP. Match e UI invariati.
- Cache v50; smoke 400/400, PWA 15/15, Auth 42/42, RLS locale 32/32,
  Chromium Auth 18/18; 345 API/144 scenari DOM conservati. Browser domini
  a larghezze mobile green. SDK/DB simulati, niente login/subscription live.
- Cutover/rollback SQL solo preparati. [Sequenza](docs/AUTH_SUPABASE.md):
  completare email → verifiche Dashboard → finestra → SQL cutover →
  Realtime pubblico disabilitato → deploy autorizzato → update PWA/test N/V.
  Non fare commit/push/deploy o interventi live in questa preparazione locale.
- Backup CLI abbandonato/ripulito; CSV applicativi salvati dall'utente,
  csvbackup/ esclusa da Git: preservare file e non usarli come dump schema/Auth.
- CLI manutenzione richiedono JWT membro; niente fallback anonimo/service-role
  frontend. Non eseguire manutenzione live come test di questa fase.

## Checkpoint precedente — 5 ottobre 2026

- Consolidation & Architecture: domini estratti incrementalmente da store,
  actions e render; stato globale e API esistenti conservati, nessuna modifica
  ad autenticazione/schema/UX. Mappa e dipendenze nel master context.
- Cleanup applicativo: movie_nights unica fonte di programmazione, nessun
  fallback/dual-write dei dettagli sui film. votes dormiente separato dal core.
  [Inventario e rollback](docs/DATA_MODEL_TRANSITION.md). Test reali della
  transizione v47 superati sui due client, confermati dall'utente.
  Il cleanup v48 resta locale, senza push/deploy, SQL o scritture DB reali.
- Audit storico v47: 94 film (93 watchlist, 1 watched), 30 serate
  (29 cancelled, 1 completed), 1 voto legacy; non un nuovo conteggio live.
  Le differenze mirror/eventi sono attese dopo il congelamento v48: non
  ripristinare automaticamente dual-write né considerarle guasti dell'app.
- `node scripts/smoke.js`: **400/400 PASS**; service worker **15/15 PASS**,
  sintassi completa e diff check, cache PWA `v48`.
- Confronto v47: 344 API mantenute (rimosse solo le tre proposte film obsolete),
  144 scenari DOM identici sui dati coerenti; flag soli/stale testati separatamente.
  Chromium proiezioni/cinema/Ricordi a 320/390/768 px, recensioni N/V
  a 320/390 px, zero errori JS/overflow, screenshot ispezionati.
- movie_nights è necessario: errori REST o query rifiutate usano il mirror
  locale degli eventi con badge offline, mai il legacy film. Realtime core
  include sempre movie_nights. Non reintrodurre movieNightsAvailable.
- Baseline browser precedente: Chromium con fixture a 320/390/768 px per login/PIN/home, voti e Ricordi;
  pannello saghe anche a 320×568. Screenshot ispezionati, zero errori JS e
  nessun overflow orizzontale. Tool di verifica solo in directory temporanee.
- Migration Phase 38 applicata dall'utente; nessuna scrittura reale nei test
  del ciclo corrente. Tastierino e sincronizzazione su due telefoni da provare
  dopo il deploy, incluse aggiunte saghe e cancellazione del testo recensito.
- Home: due ciak ai lati della scritta; PIN: «Ciak, si entra», «Biglietto, prego»
  e battuta originale da agente. Non reintrodurre le statuette scartate.
