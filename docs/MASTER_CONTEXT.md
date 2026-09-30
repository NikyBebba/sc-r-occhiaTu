# 🎬 sc(r)occhiaTu — MASTER PROJECT CONTEXT v2.14

Ultimo aggiornamento: 1 ottobre 2026. Documento unico di contesto e roadmap; le versioni precedenti restano nella cronologia Git.

Repo: `NikyBebba/sc-r-occhiaTu` · Deploy: `sc-r-occhia-tu.vercel.app` · Stack: HTML/Tailwind (Play CDN)/JS vanilla senza build step, Supabase (Postgres + realtime, fallback localStorage), TMDb (+OMDb opzionale), supabase-js v2 da CDN, Font Awesome CDN

Changelog v2.14: Phase 8.1 implementata — le Movie Card mostrano lo stato di visione N/V e il tasto personale "L'ho già visto"; la vecchia UI like/dislike è rimossa dalle card. Estensione: annullamento personale, voto 0–10 obbligatorio e recensione facoltativa al clic, tre recensioni distinte N/V/insieme; la migration `supabase-migration-step8.sql` è stata applicata e le cinque nuove colonne sono state verificate via REST (HTTP 200). Phase 8.2 implementata: CTA Match Live separata e prioritaria nella dashboard, navigazione libreria compatta su mobile, vista Match dedicata. Phase 19 implementata: la prossima serata è un hero in cima alla dashboard con poster, conto alla rovescia, snack e azioni esistenti. Snack personalizzato nel programma serata, riutilizzabile attraverso lo storico condiviso. Phase 20 implementata: Tonight Mode deriva dalle serate attive di oggi e valorizza il hero della serata con un'azione per la recensione insieme. Phase 21 implementata: "Il Nostro Cinema" mostra uno storico visuale delle serate concluse, una card per evento anche nei rewatch. Il flusso swipe resta invariato.

Aggiornamento successivo: l'aggiunta di un film già presente mostra un avviso e si ferma. Il confronto avviene sul titolo normalizzato prima della ricerca e sul titolo risolto o `tmdb_id` prima del salvataggio; il bulk import salta i duplicati nel riepilogo.

## Quadro rapido — dove siamo

| Area | Stato verificato nel codice | Limite attuale |
| --- | --- | --- |
| Scelta del film | Match Live a swipe, Ruota e proposta diretta; ticket PNG scaricabile | Origine del ticket solo in memoria, persa al refresh |
| Serata | `movie_nights` separa film ed evento; proposte, conferme, Tonight Mode e snack personalizzati | Le scelte rapide precedenti a `confirmed_at` non attivano retroattivamente Tonight Mode |
| Film e recensioni | Indicatori N/V/insieme, voto personale 0–10, tre testi distinti, annullamento visione; aggiunta con avviso duplicati | `votes` e campi legacy restano per compatibilità |
| Il Nostro Cinema | Una card per ogni serata completata, anche rewatch; statistiche e recensioni | I film visti prima dello storico restano nelle recensioni; nessun archivio dei PNG generati |

Verifiche locali dell'ultima revisione funzionale: `node scripts/smoke.js` **289/289 PASS**, `node scripts/verify-sw.js` **12/12 PASS**, `node --check` sui moduli JS senza errori. Migration Step 8 applicata e cinque nuove colonne `movies` verificate via REST; le fasi 8.2, 19–21, snack personalizzati e avviso duplicati non richiedono nuove migration. Il comportamento dell'ultimo ciclo non è stato ricontrollato manualmente su due telefoni o su Vercel.

Regola repository: database locali, dump e backup sono esclusi da Git. I file SQL versionati descrivono schema e migration, senza esportazioni dei dati.

## Prossimo lavoro

1. **Phase 22 — Timeline per mese**: partire dagli eventi `movie_nights` completati (`date` o `completed_at`) e mantenere separate le recensioni personali prive di una data di pubblicazione. Definire la UX del raggruppamento prima di implementare.
2. **Phase 23 — Movie Chemistry**: statistiche retrospettive solo di lettura su film, visioni e serate; nessuna nuova percentuale di compatibilità fuori da Match Live.
3. **Phase 24 — Why this movie?**: ridefinire con N e V le motivazioni utili senza riattivare il vecchio sistema asincrono `votes`.
4. **Fasi successive**: Hot Picks richiede dati TMDb aggiuntivi e una migration autorizzata; Dynamic Island, login, temi, microinterazioni e altre fasi restano pianificate sotto.

Changelog v2.13: STEP 4 completo (Phase 15 Ruota→serata, Phase 16 Match % di sessione, Phase 17 Match Reveal, Phase 18 Final Ticket Generator). Nessun campo/migration nuovo: origine del Ticket tracciata solo in-memory (`markTicketOrigin`/`ticketOriginOf`), scelta esplicita per restare nei vincoli di questo giro — da rivalutare se in futuro servirà uno storico persistito dei ticket (vedi Note aperte). Smoke passato da 245 a 262 test lungo lo step.

---

## Glossario (usare sempre questi termini)

- **Scelta**: il momento in cui si decide un film. Ha tre sorgenti: **Match Live**, **Ruota**, **Proposta diretta**.
- **Match Live**: sessione sincrona N ↔ V a swipe Tinder-like. **Questa logica è già completa e non deve essere modificata dalle nuove fasi di redesign.** Solo qui esiste il concetto di "match" e la **Match %** (agreement% di sessione, formula definita e implementata in Phase 16: film con giudizio identico / film risolti da entrambi).
- **In programma**: film con una serata (`movie_nights`) proposta/confermata. Key interna del tab: `tonight` (solo label cambiata).
- **Serata "Stasera"**: quick pick, serata confermata con `date: null`.
- **Prossimo Film**: il hero dà priorità alla serata attiva di oggi (`tonightPick()`), poi alla più vicina nel tempo (`nextMoviePick()`).
- **Ticket**: artefatto finale della Scelta (Phase 18, implementato). Mostra la Match % se l'origine è Match Live, "Scelto con la Ruota" se da Ruota, "Proposto da N/V" se da proposta diretta. Origine tracciata solo in-memory per la sessione di navigazione corrente, non persistita.

---

## Stato attuale del codice (test locale; verificare il deploy separatamente)

- Login differenziato N/V via PIN individuale, badge utente, logout
- CRUD film, import bulk (JustWatch non ha export ufficiale → copia manuale); l'aggiunta singola blocca con avviso i film già presenti anche se TMDb restituisce un alias, l'import salta i duplicati nel riepilogo
- **PWA**: manifest, icone (192/512/maskable/apple-touch, **provvisorie**, da sostituire con asset reale), service worker con cache app-shell versionata (`scorochiatu-shell-v9`, bump per l'avviso duplicati), whitelist esplicita che esclude sempre Supabase/TMDb/OMDb/poster/YouTube dall'intercettazione, toast di aggiornamento non invasivo
- **Design system** (Foundation): token CSS (`--color-*`, `--radius-*`, `--shadow-*`, `--duration-*`, `--ease-*`, `--fs-*`), tipografia Plus Jakarta Sans, tema Cinema Classic (nero sala/rosso cinema/oro neon, accenti N blu/V rosa), temi stagionali definiti come token (non ancora applicati), `.glass-panel`/`.glass-card`, accessibilità baseline (contrasti AA, focus-visible, ARIA su modali/segmented, `prefers-reduced-motion` globale)
- **Header/nav**: la dashboard ospita una CTA Match Live autonoma; la libreria ha cinque viste in un selettore nativo su mobile e nel segmented control su desktop. Match occupa la larghezza disponibile con ritorno alla vista precedente.
- **Match CTA**: stati idle/online/live letti solo da `matchChannelStatus`/`lobbyPresenceState`/`dbMode`/`currentTab` (nessuno stato duplicato); si aggiorna a ogni render, non su ogni evento presence in tempo reale se si è fermi su un altro tab (limite noto, accettato)
- **Home CTA "Cosa guardiamo?"**: Match Live apre la sua vista dedicata; Ruota e Sfoglia la lista portano alle rispettive sezioni, senza nuovi stati di scelta
- **Movie Card "biglietto cinema"** (`.movie-ticket`): bordo con effetto perforato, scrim sul poster, badge paternità come person-pill, rating "holographic" quando presente; **bugfix incluso**: il footer azioni non viene renderizzato vuoto per status `watched`/ignoto (ora solo per `watchlist`/`tonight`). Phase 8.1: indicatori N/V neutri, blu/rosa per visioni singole o separate, oro per la visione insieme; tasto "L'ho già visto" per chi non ha ancora segnato la visione, con annullamento personale se premuto per errore. Le recensioni continuano a segnare la visione; i voti 👍/👎 legacy non compaiono più sulle card.
- **Search & Filters** restyling su token (`.field`), stessa logica invariata (id/handler intatti)
- **Il Nostro Cinema**: storico visuale delle serate concluse da `movie_nights` (una card per evento, rewatch distinti, nessun falso timbro d'origine), più statistiche Film visti insieme, Voto medio, Genere più amato, **Proposti da N/V** e timeline recensioni; il vecchio badge card "Match!/Gusti diversi" è stato rimosso nella Phase 8.1
- **Movie Detail** (Phase 9): modale con overview, cast (`cast_names`), meta, rating; apertura al click sull'area "morta" della card (guardia esplicita esclude bottoni/link interni); **Ambient Poster** (Phase 9.1: sfondo blur+overlay dal poster, fallback gradiente se poster assente); **Poster-adaptive colors** (Phase 9.2: colore dominante estratto via canvas nascosto con `crossOrigin="anonymous"`, verificato CORS ok su TMDb/OMDb, fallback silenzioso a bordo indigo standard se l'estrazione fallisce, mai un errore in console); sorpresa vista dall'altra persona → click sulla card resta inerte, nessuno spoiler
- **Ruota → programmabile** (Phase 15): il vincitore mostra i bottoni "Stasera"/"Programma" (riuso di `quickTonightUI`/`scheduleMovie`, nessun aggancio automatico); `lockWheelWinner` risolto/rimosso in questo giro (dead code non più presente)
- **Match % di sessione** (Phase 16): `sessionAgreement(swipes, moviesList)` in `match.js` — agreement% = film con giudizio identico (doppio-like O doppio-dislike) / film risolti da entrambi; soglia 3 risposte per un dato "attendibile" (sotto soglia mostrato comunque con nota), placeholder "…%" se denominatore 0, nessuna % su sessione `closed`; calcolo client-side, nessuna migration, nessuna modifica a `votes`
- **Match Reveal** (Phase 17): celebrazione full-screen con tear CSS-only e coriandoli (`fireConfetti()`, già esistente), si riapre per sessione nuova sullo stesso film o per un secondo match nella stessa sessione, non si riapre su semplice re-render/resync; reset esplicito allo "Esci"
- **Final Ticket Generator** (Phase 18): `js/ui/ticket.js`, export PNG 1080×1920 via canvas nativo (nessuna libreria), poster con `crossOrigin="anonymous"` (stesso pattern di Phase 9.2), fallback a gradiente se poster assente/CORS fallito; timbro per origine — Match Live → Match %, Ruota → "Scelto con la Ruota", proposta diretta → "Proposto da N/V"; **origine tracciata solo in-memory** per la sessione di navigazione corrente (`markTicketOrigin`/`ticketOriginOf`), nessun campo persistito su `movie_nights`
- Hero "La nostra serata" in cima alla dashboard (poster, countdown con ora valida, snack, conferma/rifiuto/annullamento secondo lo stato); se esiste una serata attiva di oggi assume lo stato Tonight Mode e offre "Recensione insieme" per la serata confermata. Nascosto se non c'è una serata o nelle viste Match/Calendario
- Serate come entità `movie_nights` (proposed → confirmed → completed/cancelled/skipped) con mirror legacy su `movies`
- Conferma serata solo sulla data specifica, non sull'aggiunta del film; il quick pick "Stasera" crea una serata già confirmed (atto unilaterale, comportamento storico)
- Tracking visto N / V / insieme: `watched_by` e le recensioni storiche alimentano gli indicatori; la visione insieme porta il film a `watched` e completa la serata, mentre le visioni singole restano proponibili per rewatch
- `votes` legacy: mantenuti temporaneamente per compatibilità/migrazione, ma non più rappresentati nella UI delle Movie Card e non usati per il nuovo modello di stato di visione. `movies.watched_by` accumula chi ha visto il film; `review_by`/`review_text`/`rating` restano come fallback storico. L'estensione usa `seen_rating_n/v` (0–10, zero valido) e `review_text_n/v/together` (tre testi indipendenti), tutti nullable. Migration additiva Step 8 applicata in Dashboard; disponibilità delle nuove colonne verificata via REST.
- Ricerca (titolo, regista, generi), filtri (proposto da, genere, piattaforma), sort per anno, anno/regista in card
- Generi reali da TMDb in `movies.genres text[]`, nessun residuo di `genres.js`/mood picker
- **`movies.overview` e `movies.cast_names text[]`** (migration step7, backfill completato: 131/131 film con `tmdb_id`, 129/131 con overview — 2 senza traduzione it-IT su TMDb — 131/131 con cast_names, 1 caso con solo 2 nomi); popolati anche per i nuovi inserimenti (app + import CLI)
- Ruota della fortuna con ordine casuale ad ogni sessione e filtro genere; il vincitore può essere scelto per "Stasera" o "Programma" (Phase 15)
- **Match Live** completo: lobby con presence, sessioni swipe Tinder-like con deck seedato, match detection, replay; tabelle `swipe_sessions` + `swipes`; realtime a 2 canali. Non scrive su `votes`. **Non modificare questa logica nel redesign: i pollici non entrano nel Match Live, che continua a usare esclusivamente lo swipe.**
- Veto settimanale (1/persona/settimana), rimovibile solo dal proprietario, realtime su vetoes
- Snack picker con opzione personalizzata (salvata in `movie_nights.snack`; gli snack già usati tornano fra le scelte su entrambi i telefoni, senza nuova tabella)
- Modalità sorpresa (bottone regalo in navbar, modale, `surprise_by`, blur CSS, badge "tua sorpresa")
- Smoke test locale: **289/289 PASS** (230 a inizio v2.11 → 245 dopo Step 3 → 262 dopo Step 4 → 268 dopo Phase 8.1 → 274 con annullamento, voti 0–10 e recensioni distinte → 277 con Phase 8.2 → 280 con Phase 19 → 282 con snack personalizzati → 284 con Tonight Mode → 286 con lo storico delle serate → 289 con l'avviso duplicati)

---

## Fuori dal piano (valutate e scartate)

- ❌ Mood picker / `genres.js` (eliminati, commit a98a43d)
- ❌ Nessun altro elemento scartato attivo (Snack picker e Modalità sorpresa sono implementati, non scartati)
- Nota: la variante "skip animazione, output diretto" della Ruota (Phase 15) resta un'idea futura non prioritaria

---

## Decisioni prese e già applicate

1. **Match % solo per Match Live.** Il widget stats "Match sui gusti" è stato sostituito con "Proposti da N/V" (`movies.added_by`). Il vecchio badge card "Match!/Gusti diversi" derivato da `votes` è stato rimosso nella Phase 8.1 insieme alla vecchia UX asincrona.
2. **Ruota → programmabile.** Fatto (Phase 15): il vincitore mostra le azioni "Stasera"/"Programma", `lockWheelWinner` non più dead code.
3. **Tonight Mode.** Implementato: si attiva solo con una serata attiva di oggi (`date = oggi` o quick pick "Stasera" con `confirmed_at` di oggi). I quick pick nuovi scrivono `confirmed_at` al momento della scelta.
4. **Phase 24 da ridefinire**, senza dipendenza dalla vecchia logica `votes`/match asincrono.
5. **Overview/cast salvati come colonne** (non fetch on demand), per servire sia Phase 9 sia la futura Phase 36 (Poster Flip) senza rifare il lavoro. Fatto: migration step7 + backfill.
6. **Detail come modale** (non drawer, non pagina a sé), coerente con gli altri modali esistenti. Fatto: Phase 9.
7. **Sorpresa nel dettaglio**: per l'altra persona il click sulla card resta inerte, nessuna apertura del modale. Fatto.
8. **Colore estratto dal poster (Phase 9.2) solo decorativo perimetrale** (bordo/glow); il testo resta sempre su `--color-testo-1`, mai colorato dinamicamente. Fatto.
9. **Match %: formula definita e implementata** (Phase 16): giudizio identico (like+like o dislike+dislike) / risolti da entrambi. Include volontariamente i doppio-dislike ("gusti in comune", non solo "cosa piace a entrambi") — scelta di prodotto esplicita, non solo tecnica.
10. **Origine del Ticket: solo in-memory, Option A.** Nessun campo `origin` persistito su `movie_nights`: lo storico Phase 21 rappresenta le serate concluse senza inventare l'origine dei PNG. Se in futuro servirà un archivio dei ticket generati, rivalutare persistenza di file e origine con una fase dedicata.

---

## Ordine di implementazione — 9 Step

### ✅ STEP 1 — Foundation (COMPLETO)
- Phase 0 — Typography (Plus Jakarta Sans, pesi 300–800) ✅
- Phase 1.1 — Design Tokens (CSS variables) ✅
- Phase 1.2 — Cinema Classic ✅
- Phase 1.3 — Palette temi stagionali — token definiti in `[data-theme]`, **applicazione ancora da fare in Step 7**
- Phase 13 — Glassmorphism (`.glass-panel`, `.glass-card`) ✅ (`.glass` mantenuto come alias retrocompatibile)
- Phase 31 — Accessibility baseline ✅

### ✅ PWA (COMPLETA)
- `manifest.json`, icone (**provvisorie**), service worker con whitelist esplicita, cache versionata (`v9` per aggiornare l'avviso duplicati), toast di aggiornamento ✅
- Verificato: nessuna richiesta Supabase/TMDb/OMDb/poster/YouTube passa mai dalla cache (nessun `respondWith` su quei domini)

### STEP 2 — Core Layout (Phase 8.2 implementata)
- Phase 2 — Architettura header/nav (filtri ≠ azioni) ✅
- Phase 3 — Logo + Match Live CTA ✅ (stati idle/online/live da fonte unica)
- Phase 4 — Segmented Control con pillola animata ✅
- Phase 5 — Search & Filters restyling ✅ (logica invariata)
- Phase 6 — Home CTA "Cosa Guardiamo?" ✅
- Phase 7 — Statistics Widgets ✅ (nuovo 4° widget "Proposti da N/V")
- Phase 8 — Movie Card / Cinema Ticket ✅ (+ bugfix footer vuoto su watched/ignoto)
- **Phase 8.1 — Movie Card Viewing Status** ✅: sostituiti 👍/👎 e i badge derivati dal vecchio voto asincrono con due indicatori N/V. N sempre a sinistra, V sempre a destra: neutri se nessuno ha visto; N blu se visto da N; V rosa se visto da V; blu+rosa se visti separatamente; entrambi oro se visto insieme. "L'ho già visto" richiede un voto personale 0–10 e offre una recensione facoltativa; l'annullamento rimuove i dati personali segnati. Una recensione aggiunta dopo conserva il voto. N, V e insieme hanno tre testi distinti; la recensione insieme non chiede un secondo voto. Match Live invariato. Migration Step 8 applicata e nuove colonne verificate via REST.
- **Phase 8.2 — Dashboard & Navigation Redesign** ✅ nel codice: "Cosa guardiamo?" occupa l'inizio della dashboard con Match Live come CTA principale e Ruota/Libreria come ingressi separati. Le cinque viste della libreria usano un select nativo su mobile e il segmented control su desktop; Match non è più una pill. Entrando nel Match la sidebar si nasconde, la vista usa tutta la larghezza e un pulsante torna al tab precedente. Restano invariati store, ruota, swipe, serate e tracking visto.

### ✅ STEP 3 — Movie Detail (COMPLETO)
- Phase 9 — Detail modale ✅
- Phase 9.1 — Ambient Poster ✅
- Phase 9.2 — Poster-adaptive colors ✅
- Dati: `overview`/`cast_names` su `movies`, migration step7 + backfill completati ✅

### ✅ STEP 4 — Core Experience (COMPLETO)
- Phase 15 — Ruota → serata ✅ (bottoni Stasera/Programma sul vincitore, riuso funzioni esistenti, nessun aggancio automatico)
- Phase 16 — Match % di sessione ✅ (`sessionAgreement()`, client-side, nessuna migration)
- Phase 17 — Match Reveal ✅ (full-screen, tear CSS-only, coriandoli riusati, reset esplicito allo Esci)
- Phase 18 — Final Ticket Generator ✅ (canvas nativo 1080×1920, tre timbri d'origine, origine solo in-memory)

### STEP 5 — Home Intelligence
- Phase 19 — Hero "Prossimo Film / La nostra serata" ✅: usa `nextMoviePick()` (con priorità alla serata di oggi in Phase 20) e le azioni serata già esistenti; nessuna nuova migration. La CTA di scelta resta il primo elemento quando non c'è una serata.
- Phase 20 — Tonight Mode ✅ nel codice: serata attiva datata oggi o quick pick confermato oggi; il hero mostra prima la serata odierna con atmosfera oro e azione "Recensione insieme" se confermata. Nessuna migration.
- Phase 21 — "Il Nostro Cinema" ✅ nel codice: il modal unisce storico visuale delle serate completate, statistiche e recensioni. Le card hanno stile biglietto ma non pretendono di essere PNG archiviati; l'origine dei ticket resta in-memory. Nessuna migration.
- Phase 22 — Movie Timeline (per mese) — embrionale: esiste timeline recensioni, non per mese
- Phase 23 — Movie Chemistry (statistiche retrospettive, sola lettura, niente indici di compatibilità %)
- Phase 24 — "Why this movie?" — da ridefinire senza dipendenza dalla vecchia logica `votes`/match asincrono

### STEP 6 — Cinematic UX
- Phase 10 — Hot Picks. **Dipendenza:** servono `popularità`, `vote_average`, data uscita completa, oggi non salvati (nuova migration se si vuole procedere)
- Phase 11 — Dynamic Island — allineare a "serata in programma" e alla Tonight
- Phase 12 — Login Experience (12.1-12.5)
- Phase 14 — Film Grain
- Phase 25 — Shared Element Transitions

### STEP 7 — Themes
- Phase 32 — Cinema Mode
- Phase 33 — VHS Mode
- Phase 34 — Seasonal Polish (applica i token di Phase 1.3 già definiti)

### STEP 8 — Micro-interactions
- Phase 26 — Audio Manager
- Phase 27 — Haptic Manager
- Phase 28 — Ciak Loader (+ skeleton)
- Phase 29 — Empty States
- Phase 30 — Error States

### STEP 9 — Future
- Phase 35 — Lightweight Gamification (Awards, no leaderboard)
- Phase 36 — Poster Flip (dati `cast_names`/`overview` ora pronti da Step 3)
- Phase 37 — Advanced Recommendation

---

## Architettura concettuale di riferimento

```
                     sc(r)occhiaTu
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       LIBRARY            SCELTA          TONIGHT
          │                │                │
   Search / Filters   ┌────┼─────┐      Serata di oggi
          │           │    │     │           │
      Movie Cards  Match  Ruota  Proposta    │
       (dettaglio) Live          diretta     │
          │           └────┬─────┘           │
          │                │                 │
          └────────────────┼─────────────────┘
                           │
                    IN PROGRAMMA (movie_nights)
                           │
                      🎟️ TICKET
          (Match % se Match Live · "Scelto con la Ruota" se Ruota
                 · "Proposto da N/V" se diretta — origine in-memory)
                           │
                 ┌─────────┴─────────┐
                 │                   │
             Condividi        Il nostro cinema
                                     │
                                Timeline / History
```

---

## Debito tecnico / pulizia

- Origine del Ticket (Match Live/Ruota/diretta) tracciata solo in-memory (`markTicketOrigin`/`ticketOriginOf`), persa al refresh/nuova sessione di navigazione — lo storico Phase 21 mostra serate concluse senza attribuire un'origine non salvata
- Colonna legacy `movies.genre` (ex mood) non più letta/scritta: valutare drop in una migration
- Doppio livello `movie_nights` + mirror legacy su `movies` (`night_confirmed`, `scheduled_*`): tenere finché serve, poi dismettere
- `AGENTS.md` obsoleto: non allineato a questo documento, da aggiornare insieme
- Icone PWA **provvisorie** (generate via script, non un asset di design reale) — da sostituire quando disponibile
- `via.placeholder.com` (fallback poster) risulta irraggiungibile dall'ambiente di sviluppo — non blocca nulla oggi (il dettaglio usa un gradiente CSS quando manca il poster), ma va verificato in un contesto reale prima di contarci altrove

---

## Decisioni definitive v2.14

- **Match Live non si modifica**: resta Tinder-like a swipe ed è l’unico luogo in cui avviene il match tra N e V.
- **Niente Match asincrono**: la vecchia UX like/dislike sulle Movie Card viene eliminata.
- **Movie Card = stato di visione**: due indicatori N/V, con oro per la visione insieme.
- **Dashboard = nuova architettura**: Library e Match Live non devono più convivere nello stesso menu orizzontale sovraccarico.
- **`votes` non viene droppato in questa fase**: resta legacy finché non viene verificato che nessuna funzione futura ne dipenda.

## Note aperte per iterazioni future

- Ruota (Phase 15): variante "skip animazione, output diretto" (non prioritaria)
- Dati TMDb non salvati oggi: popolarità, vote_average, data uscita completa, piattaforme multiple (solo la prima flatrate IT) — servono per Phase 10 (Hot Picks)
- Limite noto sul Match CTA: lo stato online/live si aggiorna a ogni render, non su ogni evento di presence in tempo reale se si resta fermi su un altro tab (accettato, non bloccante)
- Se in futuro servirà un archivio dei PNG esatti dei ticket generati, definire la persistenza dei file e dell'origine; lo storico attuale conserva solo gli eventi `movie_nights` (vedi Decisioni #10).
