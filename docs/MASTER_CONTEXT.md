# 🎬 sc(r)occhiaTu — MASTER PROJECT CONTEXT v2.12

Repo: `NikyBebba/sc-r-occhiaTu` · Deploy: `sc-r-occhia-tu.vercel.app` · Stack: HTML/Tailwind (Play CDN)/JS vanilla senza build step, Supabase (Postgres + realtime, fallback localStorage), TMDb (+OMDb opzionale), supabase-js v2 da CDN, Font Awesome CDN

Changelog v2.12: Step 1 (Foundation), PWA, Step 2 (Core Layout, Phase 2-8) e Step 3 (Movie Detail, Phase 9/9.1/9.2) implementati e verificati in produzione. Aggiunte colonne `overview`/`cast_names`. Smoke passato da 230 a 245 test lungo il percorso. Nessuna decisione del v2.11 è stata ribaltata; qui si registra solo cosa è stato fatto e come.

---

## Glossario (usare sempre questi termini)

- **Scelta**: il momento in cui si decide un film. Ha tre sorgenti: **Match Live**, **Ruota**, **Proposta diretta**.
- **Match Live**: sessione sincrona N ↔ V a swipe. Solo qui esiste il concetto di "match" e la **Match %** (ancora da definire nella formula, vedi Note aperte).
- **In programma**: film con una serata (`movie_nights`) proposta/confermata. Key interna del tab: `tonight` (solo label cambiata).
- **Serata "Stasera"**: quick pick, serata confermata con `date: null`.
- **Prossimo Film**: la serata più vicina nel tempo (`nextMoviePick()`), con fallback sulle serate senza data.
- **Ticket**: artefatto finale della Scelta (Phase 18, non ancora implementato). Mostrerà la Match % solo se l'origine è Match Live; altrimenti un timbro d'origine.

---

## Stato attuale (funzionale, in produzione — verificato online dopo ogni step)

- Login differenziato N/V via PIN individuale, badge utente, logout
- CRUD film, import bulk (JustWatch non ha export ufficiale → copia manuale)
- **PWA**: manifest, icone (192/512/maskable/apple-touch, **provvisorie**, da sostituire con asset reale), service worker con cache app-shell versionata (`scorochiatu-shell-v2`), whitelist esplicita che esclude sempre Supabase/TMDb/OMDb/poster/YouTube dall'intercettazione, toast di aggiornamento non invasivo
- **Design system** (Foundation): token CSS (`--color-*`, `--radius-*`, `--shadow-*`, `--duration-*`, `--ease-*`, `--fs-*`), tipografia Plus Jakarta Sans, tema Cinema Classic (nero sala/rosso cinema/oro neon, accenti N blu/V rosa), temi stagionali definiti come token (non ancora applicati), `.glass-panel`/`.glass-card`, accessibilità baseline (contrasti AA, focus-visible, ARIA su modali/segmented, `prefers-reduced-motion` globale)
- **Header/nav**: filtri e azioni separati visivamente; segmented control a 6 voci (Tutti / Da Vedere / In programma / Visti e Recensioni / Calendario / Match) con **pillola animata** (`#tabIndicator`) che segue il tab attivo
- **Match CTA**: stati idle/online/live letti solo da `matchChannelStatus`/`lobbyPresenceState`/`dbMode`/`currentTab` (nessuno stato duplicato); si aggiorna a ogni render, non su ogni evento presence in tempo reale se si è fermi su un altro tab (limite noto, accettato)
- **Home CTA "Cosa guardiamo?"**: tre azioni — Ruota, Match Live, Sfoglia la lista — richiamano le funzioni esistenti, nessuna logica nuova
- **Movie Card "biglietto cinema"** (`.movie-ticket`): bordo con effetto perforato, scrim sul poster, badge paternità come person-pill, rating "holographic" quando presente; **bugfix incluso**: il footer azioni non veniva più renderizzato vuoto per status `watched`/ignoto (ora solo per `watchlist`/`tonight`, come da comportamento previsto)
- **Search & Filters** restyling su token (`.field`), stessa logica invariata (id/handler intatti)
- **Stats** (modal "Il Nostro Cinema"): Film visti insieme, Voto medio, Genere più amato, **Proposti da N/V** (sostituisce "Match sui gusti", da `movies.added_by`) + timeline recensioni; badge card "Match!/Gusti diversi" **non ancora rinominato** (resta nel debito tecnico)
- **Movie Detail** (Phase 9): modale con overview, cast (`cast_names`), meta, rating; apertura al click sull'area "morta" della card (guardia esplicita esclude bottoni/link interni); **Ambient Poster** (Phase 9.1: sfondo blur+overlay dal poster, fallback gradiente se poster assente); **Poster-adaptive colors** (Phase 9.2: colore dominante estratto via canvas nascosto con `crossOrigin="anonymous"`, verificato CORS ok su TMDb/OMDb, fallback silenzioso a bordo indigo standard se l'estrazione fallisce, mai un errore in console); sorpresa vista dall'altra persona → click sulla card resta inerte, nessuno spoiler
- Box "Prossimo Film" (countdown se la data è futura, altrimenti stampa la data), annullabile
- Serate come entità `movie_nights` (proposed → confirmed → completed/cancelled/skipped) con mirror legacy su `movies`
- Conferma serata solo sulla data specifica, non sull'aggiunta del film; il quick pick "Stasera" crea una serata già confirmed (atto unilaterale, comportamento storico)
- Tracking visto N / V / insieme (`review_by`): 'both' ⇒ watched + serata completata; se visto da uno solo resta proponibile per rewatch
- Voti like/dislike per utente (`votes`)
- Ricerca (titolo, regista, generi), filtri (proposto da, genere, piattaforma), sort per anno, anno/regista in card
- Generi reali da TMDb in `movies.genres text[]`, nessun residuo di `genres.js`/mood picker
- **`movies.overview` e `movies.cast_names text[]`** (migration step7, backfill completato: 131/131 film con `tmdb_id`, 129/131 con overview — 2 senza traduzione it-IT su TMDb — 131/131 con cast_names, 1 caso con solo 2 nomi); popolati anche per i nuovi inserimenti (app + import CLI)
- Ruota della fortuna con ordine casuale ad ogni sessione e filtro genere — **il vincitore non è ancora agganciabile a una serata** (vedi Debito tecnico, in scope per Step 4)
- **Match Live** completo: lobby con presence, sessioni swipe con deck seedato, match detection, replay; tabelle `swipe_sessions` + `swipes`; realtime a 2 canali. Non scrive su `votes`. Conta solo i match della sessione, **nessuna Match % ancora calcolata** (in scope per Step 4)
- Veto settimanale (1/persona/settimana), rimovibile solo dal proprietario, realtime su vetoes
- Snack picker (salvato in `movie_nights.snack`)
- Modalità sorpresa (bottone regalo in navbar, modale, `surprise_by`, blur CSS, badge "tua sorpresa")
- Smoke test: **245/245 PASS** (partito da 230 a inizio v2.11, +15 asserzioni lungo Step 1/PWA/Step 2/dati/Step 3)

---

## Fuori dal piano (valutate e scartate)

- ❌ Mood picker / `genres.js` (eliminati, commit a98a43d)
- ❌ Nessun altro elemento scartato attivo (Snack picker e Modalità sorpresa sono implementati, non scartati)
- Nota: la variante "skip animazione, output diretto" della Ruota (Phase 15) resta un'idea futura non prioritaria

---

## Decisioni prese e già applicate

1. **Match % solo per Match Live.** Il widget stats "Match sui gusti" è stato sostituito con "Proposti da N/V" (`movies.added_by`), fatto in Step 2. Il badge card "Match!/Gusti diversi" (da `votes`) **resta invariato per ora** — la rinomina in "Piace a entrambi/Gusti diversi" non è stata fatta, resta nel debito tecnico.
2. **Ruota → programmabile.** Deciso, **non ancora implementato**: il vincitore della ruota dovrà mostrare le azioni "Stasera"/"Programma" (stesso flusso della card). In scope per Step 4 (Phase 15).
3. **Tonight Mode.** Deciso: si attiva solo con una serata di oggi (`date = oggi` o quick pick "Stasera" con `confirmed_at` di oggi). **Non ancora implementato** (Phase 20, Step 5).
4. **Phase 24 fattibile**, dati pronti (`votes`), non ancora implementata (Step 5).
5. **Overview/cast salvati come colonne** (non fetch on demand), per servire sia Phase 9 sia la futura Phase 36 (Poster Flip) senza rifare il lavoro. Fatto: migration step7 + backfill.
6. **Detail come modale** (non drawer, non pagina a sé), coerente con gli altri modali esistenti. Fatto: Phase 9.
7. **Sorpresa nel dettaglio**: per l'altra persona il click sulla card resta inerte, nessuna apertura del modale. Fatto.
8. **Colore estratto dal poster (Phase 9.2) solo decorativo perimetrale** (bordo/glow); il testo resta sempre su `--color-testo-1`, mai colorato dinamicamente. Fatto.

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
- `manifest.json`, icone (**provvisorie**), service worker con whitelist esplicita, cache versionata (`v2` dopo bump), toast di aggiornamento ✅
- Verificato: nessuna richiesta Supabase/TMDb/OMDb/poster/YouTube passa mai dalla cache (nessun `respondWith` su quei domini)

### ✅ STEP 2 — Core Layout (COMPLETO)
- Phase 2 — Architettura header/nav (filtri ≠ azioni) ✅
- Phase 3 — Logo + Match Live CTA ✅ (stati idle/online/live da fonte unica)
- Phase 4 — Segmented Control con pillola animata ✅
- Phase 5 — Search & Filters restyling ✅ (logica invariata)
- Phase 6 — Home CTA "Cosa Guardiamo?" ✅
- Phase 7 — Statistics Widgets ✅ (nuovo 4° widget "Proposti da N/V")
- Phase 8 — Movie Card / Cinema Ticket ✅ (+ bugfix footer vuoto su watched/ignoto)

### ✅ STEP 3 — Movie Detail (COMPLETO)
- Phase 9 — Detail modale ✅
- Phase 9.1 — Ambient Poster ✅
- Phase 9.2 — Poster-adaptive colors ✅
- Dati: `overview`/`cast_names` su `movies`, migration step7 + backfill completati ✅

### 🔴 STEP 4 — Core Experience (PROSSIMO)
- Phase 15 — Ruota della Fortuna (spin/fast/slow/stop/winner) — logica funzionale; **da fare: aggancio vincitore → serata** (bottoni Stasera/Programma sul vincitore, stesso flusso di card/Match Live; nessun aggancio automatico, `lockWheelWinner` da riusare o rimuovere)
- Phase 16 — Match Live — funzionale; **da fare: definire e calcolare la Match % di sessione** (solo qui, non su `votes`), lato visivo
- Phase 17 — Match Reveal (full-screen, tear, coriandoli, N+V, poster reveal) — solo Match Live
- Phase 18 — Final Ticket Generator (export high-res, formato Stories) — Match % solo se origine Match Live, altrimenti timbro d'origine

### STEP 5 — Home Intelligence
- Phase 19 — Hero "Prossimo Film / La nostra serata" — parziale: esiste il box "Prossimo Film". Può partire subito, non dipende da Ticket/Reveal
- Phase 20 — Tonight Mode — attivazione con serata di oggi (decisione presa, da implementare)
- Phase 21 — "Il nostro cinema" (storico visuale ticket) — oggi "Il Nostro Cinema" è il modal stats; definire il rapporto tra i due
- Phase 22 — Movie Timeline (per mese) — embrionale: esiste timeline recensioni, non per mese
- Phase 23 — Movie Chemistry (statistiche retrospettive, sola lettura, niente indici di compatibilità %)
- Phase 24 — "Why this movie?" (rule-based, dati già pronti su `votes`)

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
                      🎟️ TICKET  (Step 4, non ancora fatto)
                  (Match % solo se origine Match Live)
                           │
                 ┌─────────┴─────────┐
                 │                   │
             Condividi        Il nostro cinema
                                     │
                                Timeline / History
```

---

## Debito tecnico / pulizia

- `lockWheelWinner(id)` (`actions.js`): codice morto — **da risolvere in Step 4** (aggancio ruota→serata)
- Badge card "Match!/Gusti diversi" non rinominato in "Piace a entrambi" — resta ambiguo rispetto a Match Live, valutare in un prossimo giro
- Commento obsoleto in `navigation.js:2` (cita ancora "Stasera"); key interna `tonight` resta per compatibilità
- Colonna `movies.watched_by` mai usata; colonna legacy `movies.genre` (ex mood) non più letta/scritta: valutare drop in una migration
- Doppio livello `movie_nights` + mirror legacy su `movies` (`night_confirmed`, `scheduled_*`): tenere finché serve, poi dismettere
- `AGENTS.md` obsoleto: non allineato a questo documento, da aggiornare insieme
- Icone PWA **provvisorie** (generate via script, non un asset di design reale) — da sostituire quando disponibile
- `via.placeholder.com` (fallback poster) risulta irraggiungibile dall'ambiente di sviluppo — non blocca nulla oggi (il dettaglio usa un gradiente CSS quando manca il poster), ma va verificato in un contesto reale prima di contarci altrove

---

## Note aperte per iterazioni future

- Ruota (Phase 15): variante "skip animazione, output diretto" (non prioritaria)
- Dati TMDb non salvati oggi: popolarità, vote_average, data uscita completa, piattaforme multiple (solo la prima flatrate IT) — servono per Phase 10 (Hot Picks)
- **Definire la formula della Match % di sessione** del Match Live prima di Phase 16/17/18 (es. % di swipe in accordo sulla sessione corrente) — priorità per l'apertura di Step 4
- Limite noto sul Match CTA: lo stato online/live si aggiorna a ogni render, non su ogni evento di presence in tempo reale se si resta fermi su un altro tab (accettato, non bloccante)