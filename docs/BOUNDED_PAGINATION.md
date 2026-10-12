# Fase 0.5A — Bounded pagination e performance hardening

## Stato: IMPLEMENTED LOCAL, non pubblicato

Candidato sulla baseline Git `a089a7e477b4c8147b02a0d6b56c6307db7fa3b0`.
La produzione resta il commit `0813e721e963191b285f357789a9dddd967c6162`,
service worker v60; la cache **candidata locale** è `scorochiatu-shell-v61`.
Nessun commit, push, deploy, intervento Supabase o modifica dei dati reali.
[Baseline e semantiche consolidate](MASTER_CONTEXT.md).

## Pipeline e confine del render

`dataset completo → search → filter → sort → pagination → render pagina`.
`PAGE_SIZE = 24`, fisso su tutti i viewport. `movies` conserva l’intero dataset;
contatori, statistiche, opzioni dei filtri, Ruota, Match e logiche delle serate
non usano il subset della pagina. Storico mantiene il vincolo seen_n/seen_v,
ricerca titolo/regista e ordinamento alfabetico sull’intera selezione personale.

`paginateResults` produce `items`, `totalResults`, `pageIndex` (zero-based),
`pageSize`, `pageCount`, `hasPrevious`, `hasNext` e intervallo visualizzato.
Il renderer sostituisce le card precedenti: massimo 24 card/poster nel DOM
**della movie grid**, ultima pagina eventualmente parziale. Zero risultati:
empty state, indice interno zero, zero pagine; nessun «1 di 0».
Calendario e Match conservano i loro renderer nello stesso container.
Ricordi/cartellone sono sezioni separate, non soggette al limite delle card.

La separazione `totalResults != items.length` evita di confondere il catalogo
con le card montate. Oggi la selezione resta client-side, senza nuove query;
la UI Prev/Next e il modello di render possono essere alimentati in futuro da
un provider remoto senza riprogettare i controlli. Non sono implementati
server-side pagination, cursor, infinite scroll, Mostra altri o virtualization.
Il costo di selezione resta proporzionale al dataset; DOM bounded non garantisce
memoria totale costante (dataset e cache browser dei poster rimangono).

## UX e stato

Pager inline sopra e sotto i risultati, visibile solo con più di una pagina:
`‹ Precedente   3 di 19   Successiva ›`, secondariamente `49–72 di 436`.
Bottoni semantici, disabled nativi, target almeno 44 px, focus visibile,
`aria-controls="movieGrid"`; un unico status polite/atomic per la pagina.
Niente swipe, nuovi layer sticky o gesture.

Solo Prev/Next espliciti riportano all’inizio dei risultati, sotto header e
navbar sticky, senza scorrere all’inizio dell’intera app. L’attivazione da
tastiera sposta il focus sull’ancora risultati con preventScroll; touch/mouse
non impongono quel focus. Render automatici e clamp non chiamano scrollTo.
La navigazione volontaria esistente conserva i suoi scroll; nessuna nuova
persistenza della posizione di scroll o modifica al bootstrap Home.

Map in memoria per tab con `{criteria, pageIndex}`: Tutti, Da vedere,
Rewatch, In programma, Visti, Storico N e Storico V hanno pagine indipendenti.
I criteri Libreria restano condivisi tra i tab, la query Storico resta condivisa
N/V. Tornando a una vista con gli stessi criteri si riprende la pagina.

| Evento | Comportamento |
| --- | --- |
| Query/filtro/disponibilità/sort cambiati | Pagina 1 di tutti i tab dello scope interessato; nessuno scroll automatico |
| Reselezione dello stesso filtro/sort | Pagina conservata; Azzera filtri esplicito resetta lo scope |
| Cambio tab | Cancella ricerca pendente, conserva query/criteri e riprende la pagina del tab |
| Detail open/close, save, render equivalente | Pagina conservata |
| loadMovies/Realtime | Pagina conservata se valida; clamp all’ultima valida se il dataset si riduce |
| Logout/lock/landing/recovery | Pagine e timer azzerati; nessun localStorage aggiuntivo |

Ricerca Libreria e Storico debounced 250 ms. La query si aggiorna subito;
il render attende la pausa. Cambio contesto cancella i timer; il callback
controlla tab, view, persona, generazione Auth e autorizzazione, senza cambiare
le semantiche Auth. Prev/Next con query pendente risolve prima la selezione,
poi verifica se la pagina richiesta esiste. Svuotare il campo funziona allo
stesso modo. Nessun timer tardivo renderizza una vista/persona diversa.

## Quick win inclusi e limiti

Poster card: `loading="lazy"`, `decoding="async"`, contenitore h-48 (192 px),
object-cover e layout invariati. Nessun eager/preload o observer custom.
Home/Ruota rilasciano la movie grid e non costruiscono card nascoste;
il rientro ricostruisce solo la pagina salvata. Gli altri renderer continuano
ad aggiornare Home, cartellone, Ruota e sincronizzazione.

Indici movie-night, cache persistenti e refactoring generale sono esclusi.
Personal/Together, voti/recensioni, card disclosure, Trailer, saghe, Gestione,
movie nights, Ricordi, Match, Auth/RLS e dati DB conservano i contratti v60.

## NAV-01 resta aperto

Il ritorno involontario a Home osservato su Safari/PWA iPhone non è stato
riprodotto; root cause aperta. La paginazione affronta costi di render misurati,
non costituisce un fix dimostrato del bug. Nessuna guardia touch speculativa,
nuova gesture o correzione bootstrap. Il probe diagnostico rimane temporaneo
fuori dal prodotto (`/tmp/sc-scroll-probe.js` nella sessione di audit).

La suite Chromium usa touch/flick CDP verticali/diagonali, rilascio vicino a
header/navbar e rerender durante touch sulle viste Tutti, Da vedere, In programma,
Storico N/V a 320/390/768. Verifica view/tab/pagina e assenza di detail involontari.
WebKit verifica wheel/rerender agli stessi viewport: **non simula un flick
Safari iOS/PWA equivalente**. Necessario collaudo reale iPhone dopo un eventuale
deploy autorizzato, senza dichiarare NAV-01 risolto.

## Verifiche riproducibili

- `node scripts/verify-pagination.js`: helper puro, limiti 0/1–24/25/multipli,
  ultima parziale, clamp, disgiunzione/duplicati, pipeline globale e stato.
- `node scripts/verify-pagination-browser.cjs --playwright=/path/to/playwright`:
  fixture 436 film/100 serate, SDK/Auth/Realtime sintetici, nessun I/O Supabase.
  `SC_ENGINE=webkit` seleziona WebKit; `SC_TAILWIND=/local/tailwind.js` consente
  di servire dal harness lo stesso script CDN per test isolati dalla rete.
- Gate esistente: card/Storico, Individual/Rewatch, Personal/Together,
  rimozioni valutazioni, UX, Auth e browser, RLS/PostgreSQL locale, midnight,
  snack, PWA, smoke, syntax e diff. Le suite che richiedevano tutte le card nel
  DOM ora navigano le pagine; le verifiche funzionali restano attive.

Il debito Tailwind offline preesistente rimane non bloccante e separato:
non è stato corretto qui e non indica un malfunzionamento online della v60.

## Benchmark implementazione — 436 film, 24/pagina

Stessa fixture dell’audit/prototipo: 436 film, 100 serate, poster SVG locali
300×450, rete esterna bloccata, Auth sintetica. Mediane render sincrono di
12 campioni (pagina iniziale/intermedia/ultima piena); quattro cambi pagina.
Chromium ha un warm-up esplicito di 12 render per viewport; WebKit misura il
primo pass. Misure desktop headless, non frame rate/LCP o device iPhone reale.

| Viewport | Chromium prima → dopo (ms) | WebKit prima → dopo (ms) | Cambio pagina Chromium / WebKit (ms) |
| --- | --- | --- | --- |
| 320 | 65,8 → 10,2 | 305,5 → 31 | 8,9 / 28 |
| 390 | 63,2 → 8,2 | 310 → 30 | 7,5 / 29 |
| 768 | 61,9 → 7,5 | 303,5 → 30 | 7 / 26 |

DOM griglia seconda pagina: **26.804 → 1.618 elementi** (−94%);
card/poster **436 → 24** (−94,5%), senza accumulo ai cambi pagina.
88 listener addEventListener e 226 handler inline nel campione paginato,
contro 1.600/3.442 nel riferimento completo. I contenuti delle card modificano
il conteggio di elementi/listener, non il limite di cardinalità.
Chromium: zero long task nei 12 render per viewport (baseline 12/12);
WebKit non espone Long Task API nel harness: dato non disponibile, non zero.
Chromium 4× CPU, 390 px: mediana **30,7 ms**, contro 258–286 ms dell’audit.

Confronto prototipo 24: Chromium 7,85/7,8/7,75 ms e WebKit 29/29,5/27 ms.
L’implementazione a 320 è più lenta in Chromium: 10,2 ms (+30%; primo pass
senza warm-up 11,9 ms). A 390/768 è vicina al prototipo; WebKit 30–31 ms.
Il risultato a 320 va dichiarato, senza attribuirlo a una causa non misurata;
non giustifica introdurre cache/indici o allargare questo intervento.
Ricerca/filtro/sort, **incluso render**, mediane Chromium 6,2–8,6 ms;
WebKit 25–29 ms. Il debounce Storico comprime nove input in un solo render
finale, con pausa intenzionale 250 ms. Home monta zero card della movie grid.

Risultati e harness di benchmark restano in `/tmp/sc-pagination-implemented*`,
fuori dal repository; non contengono dati o credenziali reali.

## Gate finale locale

| Suite | Esito |
| --- | --- |
| Pagination pura | 34/34 |
| Pagination browser Chromium / WebKit | 41/41 per motore, 320/390/768 |
| Movie cards / Storico browser | 80/80 |
| Individual/Rewatch DB locale / browser | 65/65 e 39/39 |
| Personal/Together / rimozioni valutazioni | 23/23 e 22/22 |
| UX browser | 24/24 |
| Auth / Auth browser | 82/82 e 43/43 |
| RLS PostgreSQL locale | 40/40 |
| Midnight in Europe/Rome, UTC, America/Los_Angeles / browser | 12/12 per fuso e 19/19 |
| Snack SDK/mirror / browser | 14/14 e 25/25 |
| PWA / smoke | 18/18 e 436/436 |
| Syntax / link relativi / diff check | 65 file, 73 link validi, PASS |

Tutte le scritture di test sono simulate o su PostgreSQL locale; smoke usa le
letture TMDb/OMDb esistenti, nessun test Auth o scrittura Supabase live.
I 441 artefatti import mantengono gli hash della snapshot pre-task e restano
non tracciati. PRODUCT_ROADMAP e i documenti PHASE storici non sono modificati.
