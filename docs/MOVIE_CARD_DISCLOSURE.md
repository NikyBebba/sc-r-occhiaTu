# Movie card e ricerca Storico — contratto pubblicato

## Stato corrente — IMPLEMENTED, 12 ottobre 2026

Release `91ecb9b4adeb82cefb7d5fdbd1a2e1a54bd7a248`,
`feat: redesign movie cards and add history search`, pubblicata e inclusa nella
baseline production v60 `0813e721e963191b285f357789a9dddd967c6162`.
[Baseline e verifica production](MASTER_CONTEXT.md).

Progressive disclosure; informazioni/stati/voti principali sempre visibili.
Trailer e Continua la saga restano CTA indipendenti quando disponibili.
Recensioni, Programmazione e Gestione richiudibili; Gestione compatta e
modifica/rimozione voto/recensione contestuali. Badge identità N/V/N+V coerenti
con il login, distinti dai pallini visto. Veto settimanale nel dettaglio.
Seen personali indipendenti da Together, che colora entrambi i pallini oro
senza cambiare seen_n/seen_v. Ricerca locale Storico per titolo/regista,
con switch N/V e vincolo del rispettivo seen.

Il secondo pass Gestione prevale sulle destinazioni del primo audit (veto
prima nella card, ora nel dettaglio). Il form N+V nella v60 include anche
snack/luogo della movie night Together selezionata; completamento pendente solo
quando l’orario è raggiunto. [Contratto v60](MOVIE_NIGHTS_MIDNIGHT_MEMORIES.md).
Voto/testo condivisi restano sul film, senza nuove valutazioni per evento.

## Archivio: audit e pass locali prima della pubblicazione

Redesign mirato richiesto dall’utente. Le sezioni seguenti registrano l’audit
e i pass locali, svolti prima dell’autorizzazione a commit e push. Nessuna
modifica Supabase/configurazione o intervento sui dati. Gli artefatti dell’import
Storico già presenti nella working tree restano estranei a questo lavoro.
Il secondo pass Gestione è descritto in fondo e aggiorna le destinazioni
del primo pass registrate qui sotto.
Fonte dell’audit: implementazione corrente, con MASTER_CONTEXT v2.59 e
contratti Individual/Rewatch, Phase 38 e Phase 41.

## Audit prima della modifica

`createMovieCard` in `js/ui/render/cards.js` costruisce tutte le card di Lista,
Visti e Storico. `render` in `js/ui/render.js` seleziona i film e inserisce le
card. Il poster e l’identità precedono stati, voti, rating, recensioni complete
e saga; il footer accumulava azioni senza disclosure.

| Elemento originale | Condizione e comportamento reale | Destinazione finale |
| --- | --- | --- |
| Poster, titolo, autore, piattaforma/anno/durata, regista, generi | Metadati presenti; titolo/poster/meta mascherati per sorpresa altrui secondo il renderer esistente | Sempre visibili, mascheramenti esistenti conservati |
| N/V, oro Together | `viewingStatusHtml` usa `viewingState`: personali da `seen_n/v === true`, Together esclusivamente da eventi completed | Sempre visibili |
| Voti N/V | `personalRating` valido, incluso zero; indipendenti dai flag personali | Sempre visibili |
| Voto N+V | `togetherRating` valido e Together presente | Sempre visibile |
| IMDb/RT/MC | Campi disponibili secondo il predicato originale | Sempre visibili |
| Trailer | URL presente e sorpresa non nascosta; link esterno con noopener | Stesso punto sul poster, nessuna nuova copia |
| Rivela / Annulla sorpresa | Rivela per destinatario; annulla per autore | Poster, invariati |
| Correggi titolo e ricerca di nuovo | `matched === false`; `retryMatch` blocca se dati altrui o eventi | Gestione |
| Recensioni N/V/N+V | Testo presente nei rispettivi campi moderni, voto contestuale facoltativo; nessun fallback legacy | Recensioni |
| Continua la saga | `sagaButtonHtml` / `canShowSaga`: collection valida, sorgente accessibile | CTA indipendente nella posizione originale |
| Footer operativo | `status === watchlist`, `status === watched` oppure proiezione attiva | Predicato conservato per le azioni raggruppate |
| L’ho già visto / Segna come non visto | `personalWatchButtonHtml`, solo identità corrente e sorpresa accessibile; scelta esclusivamente dal proprio seen | Gestione |
| Lista / Rewatch / In gioco | `rewatchActionsHtml`: flag candidatura, entrambi seen e assenza Together per Rewatch; ricandidatura Together fuori Lista non offerta | Gestione |
| Oggi / Programma | Sorpresa accessibile e nessuna proiezione attiva oppure Rewatch; form `quickTonightUI` / `scheduleMovie` | Programmazione |
| Cinema / Prossimamente ↔ Streaming | Stesso ramo di Oggi/Programma; `toggleCinemaWatchlist` | Programmazione |
| Vieta / Togli veto | Stesso ramo originale; `normalListEligible`; rimozione solo del veto corrente dell’autore | Gestione, con etichetta leggibile oltre all’icona |
| Data/ora, proposta, snack, luogo | `projectionInfoHtml`, da `activeNightForMovie` e adattatore `movieProjection`, senza leggere programmazione legacy | Programmazione; data/ora anche nel summary chiuso |
| Accetta / Rifiuta / Annulla proposta | `projectionActionsHtml`: proposta dell’altro → accetta/rifiuta, propria → attesa/annulla; nessuna nuova azione per evento confermato | Programmazione |
| Snack e luogo | Proiezione attiva; `editNightDetailsUI` | Programmazione |
| Completa serata | Proiezione attiva; evento esplicito a `finishTogetherNightUI` | Programmazione |
| Vota / Modifica voto N+V | Proiezione attiva oppure Together; helper sopprime per sorpresa nascosta | Gestione |
| Modifica voto personale | Identità N/V, sorpresa accessibile, almeno uno tra Together/proprio seen/voto/testo; form include anche testo facoltativo | Gestione |
| Rimuovi il tuo voto / la tua recensione | Rispettivo dato personale presente; conferma e guardia Auth; rimozioni indipendenti | Gestione |
| Rimuovi film | Cestino mostrato su tutte le card; `deleteMovieConfirm` verifica `canDeleteOrChangeIdentity` prima di confermare | Gestione, rosso; medesimi blocchi e conferma |

`markSeenUI` mantiene la fix recente: con Together salva solo il proprio seen,
non richiede voto e non altera voti, recensioni, candidatura o eventi.
`undoSeenUI` conserva gli stessi dati. `removePersonalRating` omette il testo,
`removePersonalText` conserva il voto. La modifica N+V riusa `confirmReview`:
aggiorna i dati condivisi se Together esiste; altrimenti segue il completamento
serata già previsto. Nessuna di queste funzioni è stata modificata.

La card usa un listener click unico: prima escludeva button/link/campi, poi
chiamava `openMovieDetail(m.id, card)`; sorpresa altrui inerte. Ora esclude
anche details/summary e tutti i loro discendenti. Nessun preventDefault o
stopPropagation aggiunto: link, pulsanti e disclosure mantengono la propria
attivazione nativa, anche da tastiera.

## Struttura e comportamento finale

Identità, stati e voti mantengono helper, ordine e metadati originali.
Recensioni appare solo con testo salvato: singolare per una, conteggio per più.
I testi sono inizialmente limitati a due righe; il pulsante Mostra altro/meno
compare solo se la misura DOM indica un overflow effettivo. Ogni testo ha
stato indipendente e pulsante nativo con aria-expanded e autore nel nome
accessibile. Il voto contestuale è testo, non un secondo controllo.

Recensioni, Programmazione e Gestione sono `details` nativi, inizialmente
chiusi; il binding locale chiude le altre sezioni della stessa card quando
se ne apre una. Si ricreano chiusi al rerender della griglia, in coerenza con
la ricostruzione DOM corrente; nessuna nuova persistenza.
La griglia allinea le card all’inizio anziché stirarle all’altezza della più
alta. Stile, temi, colori personali e oro condiviso restano quelli esistenti.

Saga, Trailer e controlli sorpresa restano indipendenti. Il voto e la
recensione si possono aggiungere/modificare dai form esistenti in Gestione
anche quando manca la sezione Recensioni.

## Scheda grande e duplicazioni

`renderMovieDetail` resta invariato, incluso `reviewCardsHtml` usato anche
altrove. Duplica intenzionalmente identità, generi, rating, Trailer, stati,
voti, recensioni, saga, visione personale, voto condiviso/personale, rimozioni
personali, candidatura e Oggi/Programma per consentire la consultazione e le
azioni dal dettaglio. Aggiunge trama, cast e Oscar su richiesta.
Non duplica cestino, veto, cambio Cinema, retry o tutti i controlli evento
della card. Nessuna duplicazione deve essere rimossa per questo redesign.
Eventuale disclosure delle recensioni nel dettaglio richiede una scelta UX
separata e non è inclusa.

## Ricerca Storico

Campo statico sotto lo switch N/V, label accessibile e placeholder
«Cerca nello storico…». `historyMoviesFor` filtra localmente titolo e regista
con query normalizzata case-insensitive, sempre dopo il vincolo del seen
personale selezionato. Mantiene ordine alfabetico, indipendenza dai filtri
Lista e membership non derivata da Together. Query condivisa tra switch N/V,
vuoto ripristina l’intero storico selezionato; messaggio specifico con zero
risultati. Il campo non viene ricreato da render, mantiene focus/valore;
stato solo in memoria, azzerato alla landing/logout. Nessun fetch per tasto.

## Verifiche

- Nuova suite `verify-movie-cards-browser.cjs`: **34/34**, Chromium a
  320/390/768 px, HTML/CSS/moduli reali, Auth sintetica, mirror locale.
  Recensioni assenti/singola/N+V, clamp reale, espansione individuale e tastiera,
  esclusività accordion, bubbling di testo/summary/pulsante, link Trailer,
  dispatch saga, click neutro, Together con seen N/V mancante, coesistenza,
  tutti i voti visibili, modifica personale/condivisa, rimozioni separate,
  programmazione e summary, ricerca titolo/regista/N/V/zero risultati/query
  vuota/cambio persona e assenza richieste dal filtro. Zero pageerror.
- Suite Individual/Rewatch aggiornata solo per aprire la sezione contenente
  l’azione prima di usarla: **39/39**.
- UX browser **24/24**, Auth **82/82**, PWA **18/18**.
- Fix personale/Together **23/23**, scritture simulate.
- Smoke **436/436**, incluse letture TMDb/OMDb; nessuna scrittura remota.
- Sintassi JS e `git diff --check` verificati a conclusione.

Confronto locale con renderer precedente all’intervento sulla stessa fixture Scary
Movie (4247), testi sintetici e Together completed: altezza card chiusa
**589,5 contro 1360,5 px a 320**, **589,5 contro 1288,5 a 390**,
**590,2 contro 1303,2 a 768**. Riduzione circa 54–57%, senza cambiare il poster.
Misure di fixture, non dei dati remoti di produzione. Screenshot mobile
ispezionati; prova finale dell’utente sul proprio browser ancora da fare.
Cache service worker resta v59: nessuna release/deploy preparata in questa
fase locale. Nessuna dipendenza aggiunta al repository.


## Secondo pass — Gestione compatta, 12 ottobre 2026

Struttura generale del primo pass approvata e conservata. Questo intervento
riguarda Gestione e soltanto gli adeguamenti necessari alle rimozioni e al veto.

### Veto: audit e spostamento

Prima del secondo pass, le sole chiamate UI a `vetoMovie`/`unvetoMovie` erano
in `cardOperationsHtml`; il dettaglio non le offriva. Rimosse entrambe dalla
card e rese disponibili nella scheda grande con `detailVetoActionHtml`:
sorpresa accessibile, normale eleggibilità Lista, nessun evento attivo o
Together; undo soltanto per il veto della persona corrente. La logica in
store/choices resta invariata. Le azioni UI attendono il refetch e aggiornano
solo il controllo veto se la scheda è ancora aperta sullo stesso film,
rendendo disponibile subito
l’azione opposta. Non viene creata alcuna nuova superficie o modello dati.

### Struttura finale

- Stato visto: un solo controllo personale, auto-width, stesso helper/azione.
- Lista: stato compatto ed eventuale azione di candidatura già esistente;
  variante `compact` di `rewatchActionsHtml`, default nel dettaglio invariato.
- Valutazioni: riga della sola persona corrente, quindi N+V quando il contesto
  condiviso è disponibile. Ogni riga ha modifica e, soltanto se c’è un dato
  rimovibile, cestino. Icone con aria-label/title, colori personali/oro,
  target di 44×44 px e focus visibile. Nessuna ripetizione di voti o testi.
- Rimuovi film: controllo rosso distinto, separatore e label completa in fondo.

Un film mai dichiarato visto senza valutazione personale continua a usare
L’ho già visto come percorso d’ingresso, come prima. Il personale è comunque
modificabile senza seen quando Together o i propri dati lo rendono pertinente.
Senza dati personali ma con Together, la riga personale offre aggiunta senza
cestino; resta distinta da N+V. Non compare una riga modificabile dell’altro
utente. La modifica N+V su serata attiva conserva il flusso preesistente;
la rimozione condivisa è disponibile esclusivamente con Together completed.

### Modifica e rimozione

Modifica richiama `addPersonalReview`/`addReview`: stesso form, campi e guardie.
Il form review e la scheda grande non sono ridisegnati. La sola aggiunta al
contenuto della scheda è il veto.

Il cestino usa `removeEvaluationUI`. Con entrambi i dati, il modal generico
mostra Cosa vuoi rimuovere? e Solo voto / Solo recensione / Voto e recensione,
oltre ad Annulla. La scelta è l’atto di conferma. Con un solo dato si usa la
conferma binaria esistente; con nessun dato non si offre un cestino.
La terza opzione facoltativa di `showConfirmModal` mantiene il contratto
booleano delle altre chiamate. Escape, X, backdrop e Annulla risolvono senza
scrivere. Focus iniziale su Annulla, tab confinato, ritorno al controllo
originario se ancora presente; target conferma almeno 44 px.

`removeEvaluationData` è il percorso comune anche delle rimozioni personali
preesistenti del dettaglio. Riusa `savePersonalReview` e `updateMovie`; legge
il dato corrente dopo la conferma e aggiorna solo voto/testo del contesto:
solo voto omette il testo, solo testo conserva il voto, entrambi azzerano
esclusivamente quei due campi. Protezioni Auth/epoch, ownership, sorpresa e
Together condiviso verificati. Nessuna patch a seen, candidatura, status,
film identity o eventi; nessuna chiamata alle RPC serata.

### Verifiche del secondo pass

- Browser card/Storico **77/77** a 320/390/768 px: aggiunte 43 verifiche per
  Gestione compatta, rimozioni N/N+V separate/insieme, dati singoli e zero,
  annullo/tastiera, target, film distinto, Scary Movie 4247, Il codice da Vinci
  591, ingresso senza valutazione, personale mancante con Together, ownership V
  e veto/undo nel dettaglio. HTML/CSS/moduli reali, Auth e dati sintetici.
- Nuova `scripts/verify-evaluation-removal.js` **22/22**: patch esatte sui
  moduli reali e SDK sintetico, nessun dato estraneo modificato, membership
  preservata, annullo, cambio epoch, contesto non autorizzato e helper legacy.
- Individual/Rewatch **39/39**, UX **24/24**, Auth **82/82**, PWA **18/18**,
  fix personale/Together **23/23**, smoke **436/436**. Aggiornate soltanto le
  aspettative intenzionalmente superate: azioni card compatte e veto nel dettaglio.
- Sintassi e diff check PASS; screenshot mobile ispezionati.

Nessuna modifica a Recensioni, Programmazione, Trailer, saga, ricerca Storico
o filtro centrale dei click. Nessuna nuova dipendenza dell’app, intervento
Supabase, modifica dati remoti/import, migration, commit, push o deploy.
Nessuna decisione bloccante; resta la verifica visiva locale dell’utente.


## Rifiniture finali e autorizzazione alla pubblicazione Git

Valutazioni riusa il componente `auth-person-initial` del login in una
variante compatta: N/V colorati con lettera bianca, N+V oro con testo scuro.
Nessun riuso dei pallini Visto da. Badge a sinistra e azioni a destra,
centrati verticalmente; pulsanti 44×44 px, gap orizzontale 8 px e gap tra
le righe 8 px. Incremento di altezza limitato allo spazio tra le righe.

Suite browser finale **80/80** a 320/390/768 px: verificate anche geometrie,
colori, accessibilità, separazione dei badge di identità dallo stato visto,
target e gap, sia per N sia per V. Le rimozioni restano **22/22** e la smoke
suite **436/436**. Nessuna modifica funzionale aggiuntiva nelle rifiniture.

Il 12 ottobre 2026 l’utente autorizza il commit dell’intero lavoro con messaggio
`feat: redesign movie cards and add history search` e il push su origin/main.
Inclusione limitata a implementazione, test pertinenti e questo documento;
artefatti dell’import Storico completamente esclusi. Nessun nuovo intervento
Supabase, migration o modifica ai dati. Verifiche locali distinte dal collaudo
hosted e da qualsiasi deployment automatico della piattaforma.
