# Navigazione persistente e Ricordi scalabili

Stato corrente: **IMPLEMENTED in produzione v62**; navigazione e Ricordi
restano invariati nella release `a7d1f827c71e60c00aa72d6cf61f69642c80fc91`.
[Baseline ufficiale](MASTER_CONTEXT.md); navigazione e ownership conservate.
Ricerca Storico e card: [contratto pubblicato](MOVIE_CARD_DISCLOSURE.md).
Ricordi/lifecycle/snack: [contratto v60](MOVIE_NIGHTS_MIDNIGHT_MEMORIES.md).
Le verifiche v55 in fondo sono un archivio locale, non lo stato di pubblicazione.

## TARGET APPROVED — IA Persona/Gruppo

**APPROVED / NOT IMPLEMENTED — 16 ottobre 2026.** Fonte autorevole della IA
congelata per il perimetro corrente. Le sezioni CURRENT v62 sotto descrivono la
navigazione ancora in uso; la Lista personale e la nuova IA non sono live.
[Grammatica/transizioni](INDIVIDUAL_WATCH_REWATCH.md#target-approved--product-grammar-e-relation--transition-contract),
[card/Add](MOVIE_CARD_DISCLOSURE.md#target-approved--card-detail-e-add),
[Saga](PHASE41_SAGHE.md#target-approved--saga-context-contract) e
[roadmap unica](PRODUCT_ROADMAP.md#checkpoint-personagruppo--approved--not-implemented)
completano questo contratto; nessun nuovo schema o Implementation Plan qui.

### Scope e raccolte

sc(r)occhiaTu resta **GROUP-FIRST**. Persona è secondaria e riusa/evolve l'accesso
Storico, senza una nuova dashboard. Persona e gruppo specifico sono scope:
N/V è soltanto l'installazione corrente. La Lista personale segue la persona
anche fra gruppi; la membership in un gruppo non attribuisce tutte le visioni.
Account system, group switcher e politiche per gruppi >2 sono DEFERRED.

| Scope / raccolta | Domanda e appartenenza |
| --- | --- |
| Persona selezionata → Lista | Che cosa desidera guardare/riguardare? Intenzione corrente, anche su film visti o Together |
| Persona selezionata → Visti | Quali film ha registrato nel proprio percorso? Memoria personale, non tutta l'exposure |
| Gruppo specifico → Lista | Quali candidature restano da scegliere? Candidature valide senza evento attivo |
| Gruppo → Rewatch [WORKING NAME] | Familiarità personale comune senza Together; nel gruppo N/V richiede i due Personal Seen |
| Gruppo → In programma | Eventi attivi, anche senza candidatura precedente e con proposte in attesa |
| Gruppo → Visti e recensioni / Together | Film con esperienze reali del gruppo e giudizio corrente sul film |
| Gruppo → Ricordi | Eventi conclusi distinti, inclusi rewatch, date/dettagli e riepiloghi |
| Gruppo → Match, Ruota, Recommendation | Strumenti decisionali esistenti, senza assorbire Liste personali o ridisegnare Match/Ruota |

**Tutti viene rimosso come collection primaria TARGET**, non convertito in unione
Persona+Gruppo o catalogo tecnico. Ricerca/dettaglio possono recuperare contenuti
fuori dalle raccolte ordinarie. Relationless != DELETE; nessun cleanup implicito.

Lo scope può rendere sufficiente la label Lista; azioni che attraversano gli
scope devono indicare la destinazione. Consultare Lista/Visti altrui non consente
di modificarli: «anche nella mia Lista» e «L'ho visto anch'io» agiscono su chi
esegue il comando. Non mostrare badge permanenti di tutte le appartenenze.

### Coesistenza e processo operativo

Ogni raccolta risponde a una domanda diversa: Lista personale + Visti, Lista
personale + Lista gruppo, Visti + Together e Lista personale + Together sono
sovrapposizioni intenzionali. La candidatura non promuove né consuma la Lista
personale. Rewatch può coesistere con candidatura, senza crearla.

Nello scope gruppo, evento attivo significa spostamento **visivo** dalla Lista
a In programma. Lo stesso film è nascosto anche dalla raccolta UX Rewatch,
pur potendone conservare la membership semantica. Annullo dell'ultimo evento:
ritorno solo con candidatura ancora valida. Completion → Together/Ricordi,
senza aggiungere Visti personali. Regole di ritiro, consumo e satisfaction nel
contratto di [dominio](INDIVIDUAL_WATCH_REWATCH.md#target-approved--product-grammar-e-relation--transition-contract).
Il feedback usa esiti semplici («torna in Lista»), non supporto/provenienza/
convergenza come terminologia da imparare.

Together esclude da Rewatch anche con nuova intenzione o ricandidatura. Un film
già Together può essere riproposto da Visti e recensioni, ma rimane escluso dai
pool Match/Ruota correnti. Nome definitivo di Rewatch UI-level, non blocker.
La proposta eterogenea «Riscoperte» non è approvata.

### Contextual UX congelata

- Nei Visti altrui, «L'ho visto anch'io» è azione diretta di memoria propria:
  nessun giudizio, Lista, candidatura, Together o Saga automatica. Primary save
  concluso prima di eventuali azioni secondarie.
- Visti personali e Together restano separati; quando Together è noto ma manca
  il visto personale, l'azione indica l'aggiunta al proprio percorso, non «mai visto».
- Card: PRIMARY, CONTEXTUAL, DISCLOSURE, DETAIL e SYSTEM FEEDBACK dipendono
  dalla superficie; nessuna card universale con tutte le relazioni. Identità N/V
  non sostituisce il verbo che distingue memoria, intenzione e giudizio.
- Persona/Lista dà priorità all'intenzione; Persona/Visti alla memoria;
  Gruppo/Lista a scelta/programmazione; In programma all'evento; Together a
  memoria/giudizio del gruppo. Gestione non nasconde le principali azioni quotidiane.
- Convergenza, uscita dalla Lista e ritiro ricevono feedback comprensibile dopo
  il successo, senza badge permanenti di origine o reinserimento automatico.
- L'esperienza resta mobile-first, con progressive disclosure, target accessibili,
  focus e contesto preservati. Il dettaglio è neutro, non un pannello di pulsanti.

## Navigazione — CURRENT RUNTIME FACT v62

Fase 0.5A, introdotta in v61 e inclusa in v62: [bounded pagination](BOUNDED_PAGINATION.md)
nelle liste e nello Storico, 24 card, pager sopra/sotto, pagine indipendenti per
tab; ricerca Storico debounced 250 ms. Prev/Next scorre all’inizio dei risultati
sotto header/nav, senza scroll applicativo nei rerender automatici. La
navigazione volontaria esistente conserva il proprio comportamento di scroll;
il cambio tab ripristina la pagina a criteri invariati. NAV-01 resta **OPEN**,
non riprodotto nel harness; paginazione non dimostrata come fix.

Un solo nav responsive con Home, Match, Ruota, Lista, Ricordi: fisso in basso
sotto 768 px nelle viste interne, integrato visivamente sotto l'header sticky
da 768 px. Nella Home mobile barra e relativo spazio riservato sono rimossi;
Ricordi è una destinazione esplicita tra i collegamenti della dashboard,
con lo stesso activateDestination('memories') della barra. La visibilità segue
la pagina sottostante al modale, senza variazioni di spazio/scroll durante
apertura e chiusura; il focus ritorna all'accesso usato.
Tema e Aggiungi restano nell'header insieme a identità/logout; Calendario
resta nel collegamento Home. Anche Storico è una destinazione autonoma dalla
Home, senza voce aggiuntiva nella bottom nav. Storico e Calendario non vengono
etichettati come Lista attiva.
Altezza dell'header misurata dopo aggiornamento badge e al resize per evitare
sovrapposizioni desktop. Bottom nav con spazio riservato e safe-area.

aria-current e indicatore di colore/bordo identificano la destinazione attiva;
Match disabilitato offline. Reselezionare la stessa destinazione scorre a inizio
vista, senza ripetere enterMatch, track o creare subscription. Gli altri
passaggi delegano a openDashboardHome/openWheelView/setTab; il tab Lista già
selezionato conserva la sottovista. Ricordi apre il modale senza lasciare Match.

## Storico — CURRENT RUNTIME FACT v62

Il widget Home Storico apre la destinazione interna `history` attraverso
`activateDestination('history')` e `setTab('history_n'/'history_v')`.
Riusa `librarySection`, `movieGrid` e `createMovieCard`: stessa struttura,
griglia responsive, card, apertura dettaglio e protezioni sorpresa della Lista.
In alto mostra switch **Storico N | Storico V**, titolo, conteggio, ritorno Home
e ricerca locale per titolo/regista. Nessun filtro Streaming/Cinema o
ordinamento Lista; i film sono alfabetici. La query è condivisa tra switch,
conservata in memoria durante render e azzerata alla landing/logout; non genera
fetch per tasto e filtra sempre dopo il seen personale selezionato.

N usa esclusivamente `seen_n === true`, V `seen_v === true`; le due collezioni
possono sovrapporsi e ignorano `in_shared_list`, filtri Lista e Together.
Gli stati Together non inseriscono automaticamente un film negli Storici.
La selezione vive nello stato UI esistente, senza nuova persistenza o tabella.
Il resync aggiorna la stessa griglia mantenendo la vista corrente.
Torna alla home usa `openDashboardHome()` come le altre destinazioni interne.

Le azioni inverse della card/dettaglio hanno lo stesso layout: icona Font
Awesome e testo centrati come unico gruppo, stessa altezza, font e gap.
“L’ho già visto” conserva l’occhio; “Segna come non visto” usa l’occhio barrato.
I colori restano quelli delle rispettive azioni.

**Segna come non visto** è l’azione della card/dettaglio, non un annullamento
della navigazione: chiede conferma e rimuove soltanto il proprio seen,
conservando voto, recensione, candidatura, eventi e Together.
I due badge N/V originali sono spenti/colorati secondo i seen quando non
Together. Con Together diventano entrambi oro, dai completed, senza cambiare
i booleani. Nessun terzo indicatore; N+V resta per dati/azioni condivisi.

## Ricordi — CURRENT RUNTIME FACT v62

Ricordi non contiene Storico personale. Rimane dedicato a statistiche,
Serate concluse e Dopo il film/recensioni condivise.
Header del modale sticky; contenuto scorre all'interno. Serate concluse è un
details chiuso di default, con Anno → Mese → card. A ogni nuova apertura
sono chiusi In numeri, Serate concluse, Dopo il film, anni/mesi, gruppo senza
data e singoli testi; nessuna apertura automatica dell’ultimo anno/mese.
Ogni gruppo mostra il numero di eventi, inclusi rewatch. Data non registrata
è separata e chiusa. Se non ci sono eventi, rimane il messaggio esistente.
Regole night.date/completed_at, annullate escluse, protezione sorpresa,
film rimossi, voti N+V e formule dei quattro riepiloghi sono conservati.

Dopo il film è chiuso di default, senza gruppi alfabetici o date inventate.
Stesso ordinamento per titolo e stessi voti/testi condivisi; 10 elementi generati
inizialmente, Mostra altre ne aggiunge 10. Le righe con solo voto non hanno
controlli vuoti; il testo completo usa un details per film. Recensioni personali
restano nelle card/scheda, senza fusioni o cambi al modello dati.

Lo stato vive soltanto in memoria: sezioni aperte, anno/mese, testi e limite
Mostra altre mantengono i comportamenti previsti durante i rerender dello
stesso modal. Le aperture manuali sono preservate solo nella stessa apertura;
una nuova apertura azzera le disclosure, e showLanding resetta all’uscita/lock
Auth. Nessun localStorage aggiunto. Snack solo visualizzato nelle card Ricordi:
si modifica dal form N+V sull’evento selezionato, anche nei rewatch.
Prima di ricreare il contenuto si acquisisce lo stato DOM perché toggle è
asincrono; eventi di nodi già rimossi sono ignorati. Focus ripristinato tramite
ID stabili senza scroll automatico. Mostra altre porta focus al primo elemento
aggiunto. Il modale rende inerte appRoot, confina Tab/Shift+Tab e restituisce
focus al trigger alla chiusura; Esc usa lo stack modali esistente.

## Componenti

- index.html e css/style.css: nav, safe-area, dettagli e modale.
- js/ui/navigation.js e js/ui/render.js: destinazione attiva e handler esistenti.
- js/ui/render/memories.js: stato temporaneo, gruppi e rendering limitato.
- js/ui/modals.js e js/main.js: focus/inert e reset della presentazione.
- js/ui/render/cards.js e js/ui/sagas.js: indicatori originali condivisi; stato Together dorato sui due badge.
- service-worker.js: cache production v62; dipendenze API escluse dall’intercettazione.

## Archivio: verifiche locali v55 prima della pubblicazione

Smoke **436/436**, Auth **48/48**, RLS **40/40**, DB Individual/Rewatch **52/52**,
PWA **15/15**, Chromium Auth **18/18**, Chromium UX **24/24**, feature **39/39**,
sintassi **54/54** e `git diff --check` PASS.
Home → Storico, switch N/V, sovrapposizione, film fuori Lista, assenza filtri,
ordine alfabetico, Together oro, dettaglio/sorpresa/resync e ritorno Home
verificati a 320/390/768 px; screenshot ispezionati. Ricordi senza Storico,
accordion, focus/scroll, recensioni paginate e regressioni Match green;
UX generale anche a 1280 px. SDK/Auth simulati, PostgreSQL locale.

Le suite 20/20 UX e 400/400 Smoke erano la baseline storica v51/v52;
non descrivono la release corrente. Nessun collaudo v55 production attribuito.

```sh
node scripts/verify-ux-browser.cjs --playwright=/percorso/node_modules/playwright
node scripts/verify-individual-rewatch-browser.cjs --playwright=/percorso/node_modules/playwright
```

Nessun accesso Supabase live nei test. Restano da collaudare bottom nav,
safe-area nativa, aggiornamento PWA v55 e interazione condivisa sui due
telefoni dopo un futuro push/deploy autorizzato. I gruppi serate collassati
mantengono le card nel DOM; non è stata introdotta paginazione delle serate.
