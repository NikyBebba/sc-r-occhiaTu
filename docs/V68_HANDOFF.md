# Handoff v68 — checkpoint locale, 29 ottobre 2026

## Stato e prossima azione

La remediation client v68 è implementata, testata e approvata visivamente dal Product Owner. È autorizzato soltanto un checkpoint locale; nessun push/deploy. Prossimo gate: **NEW CODEX SESSION / PRE-DEPLOY REVIEW**. Prima di pubblicare, verificare commit, scope, parent, test ed artifact; ottenere autorizzazione production esplicita. Non dichiarare chiuso il cutover.

## Identità Git e build

- Parent atteso: `e002505514c7d1b2e0f3b3dc511f857c3ae52b4f` (v67).
- Messaggio checkpoint: `feat: restore product UI on target runtime`.
- Commit SHA del checkpoint: riferimento immutabile ottenibile con `git log -1 --format=%H -- docs/V68_HANDOFF.md` finché questo documento non viene aggiornato. Verificare il subject sopra e il parent. Lo SHA letterale non può essere incorporato nei propri byte nello stesso commit senza autoreferenzialità; il rapporto di completamento riporta lo SHA risolto.
- Identità candidato: `v68` / `protocol-v1-v68` / `scorochiatu-shell-v68`.
- Scope: i 38 file della remediation congelati, più questo handoff (39 file). Nessun artifact, screenshot, credenziale o file untracked estraneo incluso.

## Production e database: non ripetere la migration

Ultimo stato production attestato: client v67, commit parent sopra, deployment Vercel. Non è stata interrogata production durante questa remediation. DB già migrato e verificato **S5 / target/1**, unico runtime autorevole; forward-only dal commit S2. Nessun rollback LEGACY, recovery distruttiva o nuova migration.

**DATA_INTEGRITY = PASS**, audit production read-only del 29 ottobre 2026 09:19:50 UTC: fingerprint S0 esatti, digest applicativo S5 `ab0dd3f890fd7d3ad5a023080ae580f58ba1217048a65071bd2ea224632b6e04` preservato. 440 movies, 99 supporti attivi, 1 gruppo, 2 membership, 5 serate (3 completed / 2 cancelled), 6 partecipanti, 5 domain_versions; personal lists/intentions/command receipts vuoti secondo contratto. Rating N/V 22/21, review N/V 1/0, Together rating/review 3/3. Nessuna perdita dati dimostrata: regressione della UI, non DB. T0 del 13 ottobre distinto dal baseline S0 congelato.

Gruppo congelato: `3e916de3-fbe9-4541-bc78-264ac2cfc218`. N: `454451f2-5f6c-486b-8bf5-2a4e612418aa`; V: `2808238d-06bc-4c61-8b2c-bec3e82c1a79`.

N smoke v67 FAIL UX; V smoke PENDING. N/V esclusi dall'uso normale fino a chiusura esplicita. Dopo un futuro deployment autorizzato: smoke N, poi V; write smoke controllato e integrity check richiedono gate separati.

## Root cause e remediation

v66 aveva corretto l'adapter dell'envelope reale SDK Supabase (count/data/error/status/statusText/success), mantenendo stretta validazione TARGET. Questo fix resta preservato.

v67 aveva corretto shell e loader ma TargetShell continuava a ricostruire viste interne con presenter generici: boolean grezzi, CTA indiscriminate, card non cliccabili, gerarchia prodotto perduta. I dati restavano presenti.

v68 mantiene TargetShell come coordinatore route/lifecycle e recupera i componenti prodotto pre-TARGET con dipendenze esplicite:

- `product-context.js`: read context TARGET immutabile, formattazione e callback contestuali.
- `product-editors.js`: modali prodotto adattati a command TARGET.
- Card/poster/titolo aprono il detail modal; nested CTA isolate, focus/overlay/scroll/lifecycle ripristinati. N/V/N+V, rating zero, preference tri-state, review e saga corretti.
- Home hero/cartellone, Lista, storico personale, Together, Ricordi/stats/history, calendario mensile, Match Tinder-like e Ruota canvas/risultato riutilizzano presenter prodotto.
- Ultimo blocker corretto: ricerca In programma applicata; due eventi dello stesso film conservano identità, data, luogo ed editor corretti; proposta altrui usa Rifiuta. Coperto da test mirati, nessun nuovo command/authority.
- Cleanup Auth TARGET evita di richiamare teardown LEGACY. Nessuna modifica a Store, SQL, data model o protocol negotiation. SW cambia solo versione e precache dei due moduli nuovi.

## Vincoli e differenze deliberate

**TARGET_AUTHORITY_PRESERVED = true; LEGACY_RUNTIME_REACHED = false nei flussi TARGET testati; DB_CHANGE = false.**

Nessun writer, Store o transport LEGACY riattivato. Fixture LEGACY isolate esistono soltanto nei test storici/riferimento. Nessuna terza UI.

DELIBERATE_TARGET_CHANGE: Lista personale indipendente, Seen distinto da Together, caller distinto dalla persona osservata, candidatura distinta dall'intenzione, partecipanti espliciti, dato fuori copertura non convertito in false; comandi TARGET con guardie/CAS. Non riaprire queste decisioni per rifinire la UI.

PREEXISTING_DEBT: CDN/full offline non risolto; confetti temporanei Ruota possono proseguire circa 3 secondi dopo un cambio route. Rifiniture visuali non bloccanti rinviate dal Product Owner all'uso reale: non ampliare lo scope ora. Nessuna regressione tecnica residua identificata nel perimetro locale verificato.

## Test ed evidenze finali

- 28/28 suite Node/VM PASS; Production Shell VM 96 casi / 216 assertion PASS.
- 9/9 suite browser PASS.
- Product UI HTTP Chromium 132/132 PASS.
- WebKit 128/128 PASS più 4/4 check mirati Home.
- Eventi multipli/filtri: 22/22 PASS Chromium e 22/22 PASS WebKit.
- SDK reale 11/11 PASS; protocol browser fixture 67 casi PASS; PWA 17/17 PASS (v67→v68).
- Sintassi e git diff --check sui file già tracked PASS; console/page errors = 0 nelle esecuzioni validate. Il controllo completo staged include inoltre due righe vuote con spazi finali nel nuovo scripts/verify-product-target-http.cjs (35 e 136): nota non funzionale, preservata per mantenere byte-identico il candidato approvato.
- SQL/RLS suite non conteggiata come PASS: dipendenza locale pglite mancante anche al baseline; nessun file DB/RLS modificato.

I test browser usano HTTP locale, SDK/Auth/dati sintetici e blocco delle reti esterne; non sono smoke production. Le suite complete già concluse sono state conservate; il delta finale è coperto da test mirati.

Evidenze locali non versionate in `/tmp/sc-product-target-review/`:

- `index.html`: galleria comparativa route-by-route desktop 1440/mobile touch 390.
- `REPORT_FINALE.md`, `FILES_CHANGED.txt`, `SOURCE_FREEZE.json`, `SHA256SUMS`.
- `SCREENSHOT_INVENTORY.json`: 248 immagini inventariate più supplementi; 24 screenshot riferimento codice v62, nessun errore. Screenshot modali: preferire viewport; full-page mostra anche contenuto sotto la piega.
- `tests/`, `results.json`, `webkit/` e script focused: risultati e riproduzione.

Riferimento pre-TARGET: codice v62 `a7d1f827c71e60c00aa72d6cf61f69642c80fc91`, eseguito con fixture sintetiche, non cattura storica production. Tutte le 12 route richieste coperte desktop/mobile, più Saga e stati interattivi. **REVIEW MANUALE = PASS**, attestata dal Product Owner dopo apertura della galleria. Eventuali artifact /tmp possono non sopravvivere a una nuova macchina: non inventare evidenze se mancanti.

## Divieti ancora attivi

Nessun push, deploy, accesso/probe Supabase, modifica DB, backfill, inizializzazione, maintenance, resume o rollback autorizzato da questo checkpoint. Nessuna scrittura applicativa production. Non eseguire smoke V prima di PASS N sul futuro client pubblicato. Non ripetere boundary della migration già conclusi.

Alla ripresa: leggere questo handoff, verificare Git e identità build, svolgere la review pre-deploy senza effetti production. Consenso al checkpoint locale non autorizza la pubblicazione.
