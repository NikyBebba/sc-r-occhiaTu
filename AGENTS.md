# AGENTS.md — sc(r)occhiaTu

Leggere interamente; approfondire solo le fonti pertinenti. Mantenere questo entry
point sotto 16 KB (limite 32.768 byte), senza duplicare storico/schema/inventari
o aumentare `project_doc_max_bytes` per aggirare il budget.

## Baseline e gerarchia delle fonti

- Baseline documentale: Sprint 0 pubblicato su `main`, commit
  `51d0c9545da520a46442aee27ee80adb9022c074`. Baseline applicativa attestata dal PO:
  **v76**, `3e9f64b17cdbe422aa37fa6ddcb3da6936cf7988`. Non confondere commit docs
  e release runtime; verificare lo stato Git iniziale.
- Leggere il [checkpoint corrente del MASTER_CONTEXT](docs/MASTER_CONTEXT.md#checkpoint-corrente-v76--16-novembre-2026),
  poi le specifiche necessarie. CURRENT v62/TARGET non implementato/NEXT vecchi
  sono storici: Persona/Gruppo, TARGET e Discovery sono presenti.
  Non riaprire contratti approvati né ripetere cutover per adeguarsi a testo vecchio.
- [PRODUCT_HUB](docs/PRODUCT_HUB.md): processo, epiche, privacy, triage e attivazione.
  [CODEX_DEVELOPMENT_PROTOCOL](docs/CODEX_DEVELOPMENT_PROTOCOL.md): standard adottato,
  prompt, DoR/DoD e matrice test; seguirli senza rileggere tutto il repository.
- [MASTER_BACKLOG](docs/MASTER_BACKLOG.md): ID canonici, fonti e decisioni U03/U04;
  fonte operativa fino all’attivazione Issues; poi stato/priorità/AC solo nelle Issue.
- [PRODUCT_ROADMAP](docs/PRODUCT_ROADMAP.md): unica direzione strategica;
  [ARCHITECTURE_VISION](docs/ARCHITECTURE_VISION.md): confini architetturali.
  Specifiche = contratti, non autorizzazioni. Prevalgono decisioni PO esplicite/
  checkpoint recente; non reinterpretare dati o contratti.
- `MASTER PROJECT CONTEXT.rtf`, vecchi test/conteggi/import sono storia,
  non stato operativo o nuove prove live.

## Sessioni, scope e autorizzazioni

1. Partire da PB-ID/Issue identificata, un obiettivo principale, scope/AC e vincoli.
   Prima dell'attivazione GitHub è valido un candidato locale identificato;
   non inventare numeri Issue. Un'idea approvata o READY non autorizza SQL/live,
   codice fuori scope, commit, push o deploy.
2. ANALYZE → PLAN → IMPLEMENT → TEST → REVIEW. COMMIT/PUSH/DEPLOY e applicazione
   DB sono passi distinti dalla preparazione locale, solo se autorizzati. Nessuna
   conferma ripetuta per azioni reversibili già autorizzate; fermarsi fuori scope.
3. Riusare contesto/harness/convenzioni; niente audit senza nuova evidenza,
   refactoring/astrazioni superflui o docs ridondanti. Spiegare necessità/impatti
   architetturali; non riaprire autonomamente contratti futuri.
4. Priorità dal backlog; PB-003 candidato
   principale Sprint 1, non READY né sviluppo autorizzato. Niente Issues/Projects
   automatici o beta. Walkthrough sintetico: approccio approvato, non esecuzione
   o creazione account/dataset.
5. Rispettare lo scope del turno: nessuna feature pianificata parte implicitamente.
   Report breve: AC/esito, test effettivi e limiti, stato sviluppo/test/release,
   rischi bloccanti e prossimo passo. Debito non bloccante separato, senza espandere
   il lavoro. Artefatto docs accettato può essere DONE senza attivazione operativa.

## Sicurezza, credenziali e preservazione

- Dati reali N/V, visioni, liste/supporti, candidature, giudizi, recensioni,
  partecipanti e ricevute sono da preservare. Non inventare identità, desideri,
  autori, voti o serate; non azzerare preference da cleanup/restore/reimport.
  Satisfaction solo su intenzione identificata, preesistente e pertinente:
  dubbio → preservare. L'attestazione N+V delle tre completed storiche non implica
  che ogni evento futuro comprenda tutti i membri.
- Preservare integralmente backup, file ignorati/untracked e lavoro preesistente,
  inclusi storico N, catalog audit repair e asset mascotte. Alla baseline ci sono
  **458 untracked estranei**: non importarli, modificarli, cancellarli o pubblicarli
  implicitamente. Separare il proprio delta.
- `csvbackup/` e altre copie di sicurezza restano fuori Git. CSV applicativi e
  ticket PNG non sono dump completi di schema/Auth né prove di restore. Nessun
  restore su dati correnti, cleanup o rollback distruttivo senza piano/autorizzazione.
  Il cleanup delle 32 cancelled di test a T0 è concluso: non ripeterlo.
- Nessun force push, reset distruttivo o cancellazione branch. Per commit autorizzati
  staging esplicito dei singoli file: niente `git add .`, `git add -A` o inclusione
  forzata di file ignorati. Remoto divergente o perimetro ambiguo → fermarsi prima
  del commit/push; niente pull/rebase/merge automatico nel worktree con dati estranei.
- Le chiavi TMDb/OMDb/Supabase in `js/config.js` sono REALI e client-side per scelta
  del progetto: non stamparle/copiarle in output, log, report, docs, commit message
  o prompt. Non sostituirle, rimuoverle, rigenerarle o spostare `config.js` da `js/`
  senza richiesta esplicita. Se si ritiene una credenziale non pubblicabile,
  segnalarlo PRIMA di intervenire, non cambiarla autonomamente.
- Nessuna password/PIN nel frontend: il vecchio PIN è rimosso. Password impostate
  dall'operatore in Auth; non inventare email/UUID/password, non salvare o loggare
  password/token di recovery e non introdurre service-role frontend.
- Repository pubblico: Project privato non privatizza le Issue. Niente dati tester,
  credenziali/token/dump, dati N/V o screenshot identificabili nelle Issue/allegati.
  Minimizzare/anonimizzare; feedback riservati fuori repo, solo sintesi sanitizzate
  nel backlog. Seguire la
  [privacy del Hub](docs/PRODUCT_HUB.md#privacy-e-visibilita--repository-pubblico).

## Auth, Supabase e autorità dei dati

- Auth/RLS attivi: PREPARE/CUTOVER/account/mapping e migrazioni già applicati non
  vanno rieseguiti. Non cambiare schema/colonne/tabelle, RPC, policy, grant,
  publication, Dashboard o Realtime live senza autorizzazione e verifica conseguenze.
  Non riaprire policy pubbliche: Realtime ON, Allow public access OFF. `votes` è
  legacy conservato, senza I/O applicativo/publication; niente drop/cancellazione.
- Identità autorevole da Supabase Auth verificato online e membership; UI,
  localStorage, PIN, MFA/AAL/AMR o marker locali non autorizzano un'identità.
  `app_members` è modificabile solo dall'operatore. CLI manutenzione richiedono
  JWT membro; niente fallback anonimo e niente manutenzione live come test.
- Non convertire errori Auth/RLS in fallback offline. Mirror/cache solo nel runtime
  autorizzato dopo verifica online e JWT valido; non conferiscono autorità di
  scrittura. Modalità degradata esplicita, mai successo remoto simulato. Proteggere
  session restore/Ricordami, refresh JWT, logout e guardie identità/generazione.
- Login: email normalizzata deve corrispondere all'account N/V selezionato prima
  di Auth; account visibile/editabile, autocomplete username/current-password,
  nessun vincolo numerico sulla password; Supabase determina la validità.
  Reset email solo dal mapping della persona selezionata, non dal campo editabile;
  cooldown 60s per persona, double-submit e feedback tardivo protetti.
- Recovery solo da reale evento SDK `PASSWORD_RECOVERY`, sessione valida, utente
  verificato online, membership e scadenza. Nuova password/conferma new-password;
  reload interrompe e richiede nuovo link, successo → logout locale → login.
  Dettagli e limiti: [AUTH_SUPABASE](docs/AUTH_SUPABASE.md).
- TARGET: transizioni server-authoritative, intent-based, retry-safe; snapshot
  server coerente, lock film-centric/versioni scoped. Realtime solo invalidation/
  resync, non decisioni o ricostruzione relazioni. Acquisizione contenuto e intento
  personale/gruppo espliciti, niente writer legacy per aggirare autorità.
- Preservare protocollo/CAS/ricevute/replay e operazioni pendenti/incerte.
  [PRODUCTION_PROTOCOL_HANDOFF](docs/PRODUCTION_PROTOCOL_HANDOFF.md) e
  [gate v76](docs/V76_FINAL_INTEGRATION_GATE.md) governano compatibilità/cutover:
  niente riattivazione TARGET, floor abbassato o decoder v75 dopo memorie normali.
  Recupero forward, non restore/cancellazioni per adattare dati al vecchio client.
  Modello/piano approvato non autorizza SQL.

## Contratti di dominio da non alterare implicitamente

- Film = contenuto; serata = evento `movie_nights`, anche rewatch.
  Together deriva da completed/partecipanti reali, non da `movies.status` o da
  due seen personali. Seen è esposizione, non gusto; Lista personale, candidatura
  gruppo, visione e giudizio restano distinti. L'altro giudizio personale è read-only.
  Rimuovere il proprio seen conserva giudizi, candidatura, eventi e Together.
- Rating valido domina preference TRUE/FALSE/NULL; operazione intenzionale sul
  rating cancella preference/timestamp senza resurrezione alla rimozione.
  Review indipendente; zero è voto valido, NULL assente, 0–10 con un decimale.
  Testo omesso conserva; cancellazione esplicita rimuove solo il testo pertinente.
  Rating/review N+V sono sul film; `night_memory`, snack e luogo sul singolo evento.
- Programmazione solo negli eventi, non nei mirror legacy `movies.scheduled_*`,
  snack/proposed_by/night_confirmed. Niente fallback/dual-write o reintroduzione
  di `movieNightsAvailable`; `votes`/cache legacy separati da render/core/Realtime.
  Vecchio percorso serate solo via RPC `manage_movie_night`, DML diretto revocato;
  nel TARGET usare i comandi autorevoli, non scritture dirette o bypass legacy.
- Nuova completion consuma candidatura atomicamente; retry non la consuma di nuovo.
  Oggi/Programma/annullo non cambiano implicitamente candidature o seen personali.
  Concludere solo proposed/confirmed dovute, anche oltre mezzanotte/reload;
  niente finestra arbitraria, eventi duplicati o date/orari modificati automaticamente.
  Future/completed/cancelled/skipped escluse; `skipped` è riservato, non introdurre
  scritture automatiche. Su completed normali schedule/partecipanti protetti;
  solo le retroattive consentono la modifica data prevista dal contratto CAP-1.
- Date calendario lette per componenti locali, mai `new Date('YYYY-MM-DD')`;
  niente orari inventati. `formatNightDate`: data NULL → Oggi, invalida → dato
  grezzo; snack vuoto → NULL sull'evento selezionato. `cinema_watchlist` esclude
  da Match/Ruota ma non da libreria/programmazione; preservare Streaming/Cinema.
- `core.js` frozen per Dalla Lista; Scopri usa profili/Core 2.0/retrieval separati.
  Seen/recensioni/candidature/swipe Match non sono Like o learning stabile.
  Match/Ruota indipendenti; Match % solo sessione, non compatibilità stabile
  o accuratezza recommendation.

## Contratto Match e sincronizzazione

Conservare le invarianti anche quando si toccano adapter/trasporti TARGET:

- Celebrazione solo dai dati: `pendingMatch(session, swipes, deck, movies) != null`;
  status `matched` NON prerequisito. Swipe/reconcile/resync non scrivono `matched`.
- `matched_movie_id` = ultimo match riconosciuto via **Continua**, scritto solo lì;
  `matched_at` informativo. `reconcileSession` solo `open→done` per mazzo esaurito
  senza match pendente, idempotente, condizionato a id + status open. Chiamato da
  recordSwipe e resync sui dati fetchati, non sugli swipe locali.
- `continueMatch`: `matched_movie_id=pending`, `matched_at`, status open o done
  se mazzo esaurito; condizione id + status IN(open, matched), poi re-read/resync.
  Zero righe o errore → `console.error` una volta (dedup 60s) e riallineamento,
  mai UI muta; idempotente anche se entrambi premono contemporaneamente.
- Core Realtime unico; Match/presence solo nel canale separato temporaneo
  `scorochiatu-match`. Non duplicare sottoscrizioni né legare guasti Match al core.
  Nel percorso store legacy resync debounced 120ms e render solo se dato cambia;
  nel TARGET rispettare invalidation/snapshot. Niente loop o doppi render dagli echi.

## Stack e UX

- Nome esatto **sc(r)occhiaTu**, repo `NikyBebba/sc-r-occhiaTu`, chiavi locali
  `scorochiatu_*` (inclusa `scorochiatu_movie_nights`). HTML/vanilla JS ES6/CSS,
  script classici senza bundler; Tailwind Play, Font Awesome, supabase-js v2 via
  CDN; TMDb v3 `language=it-IT`, fallback/rating OMDb, Ruota canvas 2D.
  Nessun framework/bundler/backend/auth server o nuovo servizio senza autorizzazione.
- Ordine script da `index.html`; preservare firme/handler
  pubblici e dipendenze. Non copiare un vecchio inventario v62 per riordinare TARGET.
  Anti-XSS: dati in HTML stringhe con `escapeHtml`/`jsAttrEscape`; niente input non
  escapato. Non spostare configurazione o introdurre dipendenze per tooling minore.
- Mobile-first, dark cinema/glass/indigo-sky; tono leggero/personale/ludico,
  non solo romantico né nostro/vostro ripetuti. Preservare identità/otto temi/
  componenti, touch usabile e leggibilità.
  Ruota centrale; non eliminare feature implicitamente. Sorpresa/Veto sono
  DEPRECATED/TARGET REMOVE secondo roadmap, non nuove feature da estendere o dati
  da cancellare. Non ripristinare mood picker, VHS, cult manuale o sezione Phase 24.
  Non reintrodurre le statuette Home scartate a favore dei due ciak.
- Valutare Content/User/Group/Community; N/V sono utenti: evitare hardcoding
  superfluo con soluzioni altrettanto semplici generalizzabili. Niente migrazioni/
  refactoring prematuri verso multiutente.
- Saghe/ticket/temi esistono: riusare contratti. Ticket: origine in-memory, niente
  persistenza inventata PNG/eventi. Detail modale salvo richiesta; poster-adaptive
  color solo decorativo, testo su token leggibili. Audio/haptics opt-in locali.
- Service worker: escludere API/Supabase/poster/YouTube dall'intercettazione;
  app-shell offline non significa dati remoti disponibili o offline completo.
  Non cambiare cache/versione/SW per soli docs. NAV-01 non è risolto con prova:
  niente guardie touch speculative o probe diagnostici nel prodotto.

## Test, prove e letture di dominio

Seguire la [matrice test](docs/CODEX_DEVELOPMENT_PROTOCOL.md#matrice-di-test-proporzionati):
docs → link/ID/diff; UI → browser mirato; logica → harness/negativi;
Auth/RLS/DB → identità, membership, isolamento, CAS/idempotenza, concorrenza e
preservazione rigorosi. Prima di commit autorizzato check pertinente contro
ReferenceError/regressioni, non tutte le suite per layout/docs. Niente test live
impliciti: smoke/metadati/import possono usare rete, leggere il comando.
Tooling temporaneo fuori repo; riusare script, niente nuovi runner.

Feature non testata non è completata. Distinguere TODO/implementato, fixture/locali,
pubblicato e production/device: PASS storici e deploy/HTTP non provano nuovi test
o entrambe le PWA. Nessun audit dati per leggere lo stato. JustWatch/import iniziale
non sono inventario live: niente correzioni DB per ricostruire conteggi, reimport
o serate fittizie; preservare seen N/V, Together e artefatti storici N.

Fonti da leggere per il dominio toccato:

| Dominio | Specifiche (distinguere stato e storia) |
| --- | --- |
| Persona/Gruppo | [Dominio](docs/INDIVIDUAL_WATCH_REWATCH.md), [Dati](docs/DATA_MODEL_TRANSITION.md) |
| Card/IA | [Card](docs/MOVIE_CARD_DISCLOSURE.md), [IA](docs/UX_NAVIGATION_MEMORIES.md), [Proiezioni](docs/PROIEZIONI.md) |
| Serate | [Midnight](docs/MOVIE_NIGHTS_MIDNIGHT_MEMORIES.md), [Memorie](docs/COMPLETED_NIGHTS_UNIFICATION.md), gate v76 sopra |
| Timeline/statistiche e voti | [Timeline](docs/PHASE22_TIMELINE.md), [Statistiche](docs/PHASE23_MOVIE_CHEMISTRY.md), [Decimali](docs/PHASE38_DECIMAL_RATINGS.md), [Preference](docs/PERSONAL_PREFERENCE_DB.md) |
| Saghe e pagination catalogo | [Saghe](docs/PHASE41_SAGHE.md), [Pagination](docs/BOUNDED_PAGINATION.md); U04 nel backlog governa il refinement futuro, non è implementazione |
| Recommendation | [Core stabile](docs/RECOMMENDATION_ENGINE.md), [Profili](docs/TASTE_PROFILES_V1.md), [Core 2.0](docs/RECOMMENDATION_CORE_V2.md), [Retrieval](docs/DISCOVERY_RETRIEVAL_V2.md), [Correttivo](docs/DISCOVERY_FINAL_CORRECTIVE_PASS.md) |

Storico in docs/Git; nessun cambio a contratti, permessi o impostazioni Codex.
