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
  RLS aperte);
- **TMDb API v3** (`language=it-IT`) per ricerca, dettagli, provider, trailer;
- **OMDb API** come fallback e per rating (IMDb / RT / Metacritic);
- **localStorage** come fallback offline di Supabase;
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
  `vetoes`, logica serata (`setQuickTonight`, `proposeNight`, `confirmNight`,
  `cancelNight`, `nextMoviePick`), match %, veto settimanale, sorpresa.
- `js/wheel.js` — ruota canvas: pool, draw, spin animato, confetti.
- `js/ui.js` — render, modali, tab, azioni sui film, helper anti-XSS
  (`escapeHtml`, `jsAttrEscape`), stats, timeline.
- `js/main.js` — login (landing → persona → PIN → `sessionStorage`).

Stato: variabili globali (`movies`, `votes`, `vetoes`, `currentUser`,
`currentTab`). Ogni azione segue il ciclo:

```
azione → persistenza (Supabase/localStorage) → loadMovies() → render()
```

`render()` ricostruisce il DOM e chiama: `renderScheduled`, `renderVetoInfo`,
`renderNextMovieBox` (countdown ogni 30s), `drawWheel`.

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
  genre, proposed_by, night_confirmed, surprise_by, created_at)`
  - `status`: `watchlist` | `tonight` | `watched`.
  - La "serata" vive su flag del film (`scheduled_*`, `proposed_by`,
    `night_confirmed`, `status`), NON è un'entità separata.
- `votes(id, movie_id FK, person, liked, unique(movie_id,person))`.
- `vetoes(id, person, movie_id FK, week_key 'YYYY-W##', unique(person,
  week_key))`.

## UX principles

- Due utenti, due telefoni: ogni azione deve riflettersi per entrambi
  (oggi tramite refetch dopo azioni; realtime pianificato ma NON ancora
  implementato).
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
- Storage locale chiavi prefisse `scorochiatu_*`.

## Cose da NON fare senza prima chiedere

1. NON cambiare/eliminare/rinominare colonne o tabelle DB (`movies`, `votes`,
   `vetoes`) — le feature future (calendario/streak/collection) partiranno da
   una decisione sul data model "serata".
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
- Funzioni serata ripristinate in `js/store.js`: `setQuickTonight`,
  `proposeNight`, `confirmNight`, `cancelNight`, `nextMoviePick`.
- Struttura: file sotto `js/` e `css/`, riferimenti `index.html` allineati.
- 36/36 smoke-test PASS (harness Node + DOM stub + chiamate live TMDb/OMDb).