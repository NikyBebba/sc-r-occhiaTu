# 🎬 sc(r)occhiaTu — MASTER PROJECT CONTEXT v2.11

Repo: `NikyBebba/sc-r-occhiaTu` · Deploy: `sc-r-occhia-tu.vercel.app` · Stack: HTML/Tailwind (Play CDN)/JS vanilla senza build step, Supabase (Postgres + realtime, fallback localStorage), TMDb (+OMDb opzionale), supabase-js v2 da CDN, Font Awesome CDN

**Changelog v2.11**: allineato al codice tramite audit (smoke 230/230). Terminologia sistemata (Scelta / Match Live / In programma), Match % ristretta al solo Match Live, aggiunte le feature realmente presenti, corretti stati e dipendenze delle fasi.

## Glossario (usare sempre questi termini)

- **Scelta**: il momento in cui si decide un film. Ha tre sorgenti: Match Live, Ruota, Proposta diretta.
- **Match Live**: sessione sincrona N ↔ V a swipe. Solo qui esiste il concetto di "match" e la Match %.
- **In programma**: film con una serata (`movie_nights`) proposta/confermata. Key interna del tab: `tonight` (solo label cambiata, vedi Debito tecnico).
- **Serata "Stasera"**: quick pick, serata confermata con `date: null`.
- **Prossimo Film**: la serata più vicina nel tempo (`nextMoviePick()`), con fallback sulle serate senza data.
- **Ticket**: artefatto finale della Scelta. Mostra la Match % solo se l'origine è Match Live; altrimenti un timbro d'origine ("Scelto con la Ruota", "Proposto da V", "Match Live").

## Stato attuale (funzionale, in produzione)

- Login differenziato N/V via PIN individuale, badge utente, logout.
- CRUD film, import bulk (JustWatch non ha export ufficiale → copia manuale).
- Segmented control a 6 voci: Tutti / Da Vedere / In programma / Visti e Recensioni / Calendario / Match (default: Da Vedere).
- Calendario mensile (`ui/calendar.js`): griglia mensile, riepilogo per giorno, legenda status, blocco "Senza data (Stasera)".
- Box "Prossimo Film" (countdown se la data è futura, altrimenti stampa la data), annullabile.
- Serate come entità `movie_nights` (proposed → confirmed → completed/cancelled/skipped) con mirror legacy su movies.
- Conferma serata solo sulla data specifica, non sull'aggiunta del film; il quick pick "Stasera" crea una serata già confirmed (atto unilaterale, comportamento storico).
- Tracking visto N / V / insieme (`review_by`): `'both'` ⇒ watched + serata completata; se visto da uno solo resta proponibile per rewatch.
- Voti like/dislike per utente (`votes`), badge sulla card quando entrambi hanno votato.
- Ricerca (include titolo, regista, generi), filtri (proposto da, genere, piattaforma), sort per anno, anno/regista in card (`filters.js`, step 5b, backfill 131 film).
- Generi reali da TMDb in `movies.genres text[]` (backfill script), nessun residuo di `genres.js`/mood picker.
- Ruota della fortuna con ordine casuale ad ogni sessione e filtro genere.
- Match Live completo: lobby con presence, sessioni swipe con deck seedato, match detection, replay; tabelle `swipe_sessions` + `swipes`; realtime a 2 canali; contract "riconoscimento dai dati". Non scrive su votes.
- Veto settimanale (1/persona/settimana), rimovibile solo dal proprietario, realtime su vetoes.
- Snack picker (salvato in `movie_nights.snack`) — implementato e attivo.
- Modalità sorpresa (bottone regalo in navbar, modale, `surprise_by`, blur CSS, badge "tua sorpresa") — implementata e attiva.
- Stats (modal "Il Nostro Cinema"): Film visti insieme, Voto medio, Genere più amato, Match sui gusti (da rivedere, vedi Decisioni) + timeline recensioni.
- Smoke test: **230/230 PASS**.

**Nota**: le fasi di design 0–37 (tranne quelle indicate "parziale" in tabella) non sono implementate visivamente. Il codice usa `.glass`, system-ui e colori hard-coded, non i token/nomi del piano.

## Fuori dal piano (valutate e scartate)

- ❌ Mood picker / `genres.js` (eliminati, commit a98a43d).
- ❌ Nessun altro elemento scartato attivo. Snack picker e Modalità sorpresa non sono più scartati: sono implementati.
- Nota: la variante "skip animazione, output diretto" della Ruota (Phase 15) resta un'idea futura non prioritaria. È cosa diversa dalla Modalità sorpresa già esistente.

## Decisioni prese in questo aggiornamento

- **Match % solo per Match Live.** Nel codice oggi il Live conta solo i match ("X match in questa sessione"); la % da definire in Phase 16 (es. accordo sugli swipe della sessione). La % asincrona su votes non ha senso.
- Widget stats "Match sui gusti" → da sostituire, sostituto ancora aperto. Default provvisorio: **"Proposti da N / da V"** (dati già disponibili, era nel piano originale). Alternativa: "In programma" (numero di serate future).
- Badge card "Match!/Gusti diversi" → decidere: tenere come etichetta qualitativa senza %, oppure rimuovere per non confonderlo col Match Live (consigliato: rinominare in "Piace a entrambi / Gusti diversi").
- **Ruota → programmabile** (deciso). Il vincitore mostra le azioni "Stasera" e "Programma" (stesso flusso di card/Match Live: `setQuickTonight` / modale programmazione → `movie_nights`). Nessun aggancio automatico: la Ruota propone, la serata la crea l'utente. `lockWheelWinner` va o riusato per questo o rimosso.
- **Tonight Mode** (deciso). Si attiva solo se esiste una serata per il giorno stesso: `date` = oggi, oppure quick pick "Stasera" (`date: null`). Attenzione: un quick pick senza data non ha scadenza, quindi vale come "oggi" solo se `confirmed_at` è di oggi; altrimenti è una serata vecchia e non attiva la Tonight. L'hero "Prossimo Film" resta indipendente e mostra sempre la serata più vicina.
- **Phase 24 fattibile**: "piace a N / piace a V" si appoggia su `votes`, che esiste già.

## Ordine di implementazione — 9 Step

### 🔴 STEP 1 — Foundation

- **Phase 0** — Typography (Plus Jakarta Sans, pesi 300–800) — non iniziata (oggi system-ui).
- **Phase 1.1** — Design Tokens (CSS variables; oggi colori hard-coded) — non iniziata.
- **Phase 1.2** — Cinema Classic (Nero Sala / Rosso Cinema / Oro Neon, accenti N blu / V rosa).
- **Phase 1.3** — Palette temi stagionali (solo definizione token, applicazione in Step 7).
- **Phase 13** — Glassmorphism system (`.glass-panel`, `.glass-card`) — *parziale*: esiste `.glass`; allineare nomi o migrare.
- **Phase 31** — Accessibility baseline (contrast, focus, ARIA, prefers-reduced-motion).

Tutto il resto dipende da questi token: va chiuso per primo.

> **→ PWA (subito dopo Step 1)**
>
> manifest.json, icone multi-dimensione, theme-color, service worker minimo, installabile.
> - Il SW non deve mettere in cache chiamate Supabase né realtime (supabase-js fa fetch diretti).
> - Cache versionata, invalidata a ogni deploy Vercel (es. versione nel nome cache), altrimenti restano versioni vecchie.
> - Tailwind Play CDN e altre CDN: decidere se cacharle o lasciarle network-first.

### 🔴 STEP 2 — Core Layout

- **Phase 2** — Architettura header/nav (filtri ≠ azioni).
- **Phase 3** — Logo + Match Live CTA (gradiente, pulse-glow, stato online/offline) — oggi il Match è solo una pill. Lo stato online/offline legge da un'unica fonte: `lobbyPresenceState` / `matchChannelStatus` (già unica, non duplicare).
- **Phase 4** — Segmented Control: 6 voci (Tutti / Da Vedere / In programma / Visti e Recensioni / Calendario / Match), pillola animata — funzionale, manca solo la parte visiva.
- **Phase 5** — Search & Filters — funzionale (live search, proposto da, genere, piattaforma, regista, sort anno); manca restyling.
- **Phase 6** — Home CTA "Cosa Guardiamo?" — non iniziata.
- **Phase 7** — Statistics Widgets (4 quadranti) — *parziale*: esistono 4 widget ma diversi dal piano originale; sostituire "Match sui gusti" (vedi Decisioni).
- **Phase 8** — Movie Card / Cinema Ticket (bordo perforato, badge paternità, poster overlay, rating holographic, tutti gli stati 8.5) — card funzionale, restyling da fare.

### 🔴 STEP 3 — Movie Detail

- **Phase 9** — Detail page/drawer/modal.
- **Phase 9.1** — Ambient Poster.
- **Phase 9.2** — Poster-adaptive colors.

> Nota dati: overview e cast non sono salvati. Se servono, aggiungere colonne oppure fetch on demand da TMDb.

### 🔴 STEP 4 — Core Experience

- **Phase 15** — Ruota della Fortuna (spin/fast/slow/stop/winner) — logica funzionale; da fare: aggancio vincitore → serata (vedi Decisioni).
- **Phase 16** — Match Live — funzionale (presence, swipe, deck, match detection). Da fare: calcolo Match % di sessione (solo qui), lato visivo.
- **Phase 17** — Match Reveal (full-screen, tear, coriandoli, N+V, poster reveal) — solo Match Live.
- **Phase 18** — Final Ticket Generator (export high-res, formato Stories) — Match % solo se origine Match Live, altrimenti timbro d'origine.

### 🔴 STEP 5 — Home Intelligence

- **Phase 19** — Hero "Prossimo Film / La nostra serata" — *parziale*: esiste il box "Prossimo Film". Si mostra quando esiste una serata in programma (non serve un match). Può partire subito, non dipende da Ticket/Reveal.
- **Phase 20** — Tonight Mode (UI minimale, poster dominante, countdown) — attivazione con serata di oggi (vedi Decisioni).
- **Phase 21** — "Il nostro cinema" (storico visuale ticket) — oggi "Il Nostro Cinema" è il modal stats; definire il rapporto tra i due.
- **Phase 22** — Movie Timeline (grouping per mese) — embrionale: esiste timeline recensioni, non per mese.
- **Phase 23** — Movie Chemistry (statistiche retrospettive, sola lettura). Solo dati descrittivi (visti insieme, generi ricorrenti, chi propone di più), niente indici di compatibilità %.
- **Phase 24** — "Why this movie?" (rule-based: piace a N/V da votes, simile a visti, piattaforma, rating).

### 🟠 STEP 6 — Cinematic UX

- **Phase 10** — Hot Picks (Story, badge Trending/New/High Rated/N+V). Dipendenza: servono popularità, `vote_average`, data uscita completa, oggi non salvati.
- **Phase 11** — Dynamic Island (stato sessione/match/serata) — allineare a "serata in programma" e alla Tonight.
- **Phase 12** — Login Experience (12.1 profile → 12.2 marquee → 12.3 neon → 12.4 citazione → 12.5 lights).
- **Phase 14** — Film Grain.
- **Phase 25** — Shared Element Transitions.

### 🟡 STEP 7 — Themes

- **Phase 32** — Cinema Mode.
- **Phase 33** — VHS Mode.
- **Phase 34** — Seasonal Polish.

### 🟡 STEP 8 — Micro-interactions

- **Phase 26** — Audio Manager.
- **Phase 27** — Haptic Manager.
- **Phase 28** — Ciak Loader (+ skeleton).
- **Phase 29** — Empty States.
- **Phase 30** — Error States.

### 🟢 STEP 9 — Future

- **Phase 35** — Lightweight Gamification (Awards, no leaderboard).
- **Phase 36** — Poster Flip (richiede cast/overview, vedi Step 3).
- **Phase 37** — Advanced Recommendation.

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
                   Live          diretta     │
          │           └────┬─────┘           │
          │                │                 │
          └────────────────┼─────────────────┘
                           │
                    IN PROGRAMMA (movie_nights)
                           │
                      🎟️ TICKET
                  (Match % solo se origine Match Live)
                           │
                 ┌─────────┴─────────┐
                 │                   │
             Condividi        Il nostro cinema
                                     │
                                Timeline / History
```

- Segmented Control = "cosa voglio vedere nella libreria?"
- Search/Filters = "quale film sto cercando?"
- Cosa Guardiamo? = "facciamo una Scelta"
- Match Live = "stiamo scegliendo insieme, in sincrono"
- In programma = "abbiamo deciso, prossime serate"
- Tonight = "la serata è oggi"
- Il nostro cinema = "cosa abbiamo fatto finora"

## Debito tecnico / pulizia

- `lockWheelWinner(id)` (`actions.js`): codice morto, usarlo (aggancio ruota) o rimuoverlo.
- Commento obsoleto in `navigation.js:2` (cita ancora "Stasera"); key interna `tonight` resta per compatibilità, valutare rename in `scheduled`.
- Colonna `movies.watched_by` mai usata; colonna legacy `movies.genre` (ex mood) non più letta/scritta: valutare drop in una migration.
- Doppio livello `movie_nights` + mirror legacy su movies (`night_confirmed`, `scheduled_*`): tenere finché serve, poi dismettere.
- AGENTS.md obsoleto (calendario e ticket come pianificati; non cita `filters.js`, `match.js`, `ui/calendar.js`, `ui/match.js`, migration step4/5b/6): allinearlo insieme a questo documento.
- `scripts/smoke.js` (~189 KB): ok, ma monitorare la manutenibilità.

## Note aperte per iterazioni future

- Ruota (Phase 15): variante "skip animazione, output diretto" (non prioritaria).
- Dati TMDb non salvati oggi: overview, cast, popolarità, `vote_average`, data uscita completa, piattaforme multiple (solo la prima flatrate IT). Da estendere se servono per Step 3, 6, 9.
- Definire la formula della Match % di sessione del Match Live prima di Phase 16/17/18.