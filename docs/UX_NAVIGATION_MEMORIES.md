# Navigazione persistente e Ricordi scalabili

Checkpoint: 9 ottobre 2026. Produzione **v54**, candidato frontend locale **v55**,
senza commit/push/deploy v55. Nessuna modifica v55 a DB, migration/rollback,
RLS/RPC, Auth, trasporto Realtime, Match Live o semantica candidacy/Rewatch.

## Navigazione

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

## Storico

Il widget Home Storico apre la destinazione interna `history` attraverso
`activateDestination('history')` e `setTab('history_n'/'history_v')`.
Riusa `librarySection`, `movieGrid` e `createMovieCard`: stessa struttura,
griglia responsive, card, apertura dettaglio e protezioni sorpresa della Lista.
In alto mostra soltanto lo switch **Storico N | Storico V**, oltre a titolo,
conteggio e ritorno Home. Nessun filtro Streaming/Cinema, ricerca o ordinamento
Lista. I film sono ordinati alfabeticamente per titolo.

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

## Ricordi

Ricordi non contiene Storico personale. Rimane dedicato a statistiche,
Serate concluse e Dopo il film/recensioni condivise.
Header del modale sticky; contenuto scorre all'interno. Serate concluse è un
details aperto di default, con Anno → Mese → card. Al primo caricamento con
eventi datati si aprono anno e mese più recenti; altri gruppi sono chiusi.
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
Mostra altre sopravvivono a chiusura/riapertura e rerender Realtime. showLanding
lo resetta all'uscita/lock Auth. Nessun localStorage aggiunto.
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
- service-worker.js: cache candidata v55; precache invariato.

## Verifiche locali v55

Smoke **436/436**, Auth **48/48**, RLS **40/40**, DB Individual/Rewatch **52/52**,
PWA **15/15**, Chromium Auth **18/18**, Chromium UX **24/24**, feature **39/39**,
sintassi **54/54** e `git diff --check` PASS.
Home → Storico, switch N/V, sovrapposizione, film fuori Lista, assenza filtri,
ordine alfabetico, Together oro, dettaglio/sorpresa/resync e ritorno Home
verificati a 320/390/768 px; screenshot ispezionati. Ricordi senza Storico,
accordion, focus/scroll, recensioni paginate e regressioni Match green;
UX generale anche a 1280 px. SDK/Auth simulati, PostgreSQL locale.

Le suite 20/20 UX e 400/400 Smoke erano la baseline storica v51/v52;
non descrivono il candidato corrente. Nessun collaudo v55 production attribuito.

```sh
node scripts/verify-ux-browser.cjs --playwright=/percorso/node_modules/playwright
node scripts/verify-individual-rewatch-browser.cjs --playwright=/percorso/node_modules/playwright
```

Nessun accesso Supabase live nei test. Restano da collaudare bottom nav,
safe-area nativa, aggiornamento PWA v55 e interazione condivisa sui due
telefoni dopo un futuro push/deploy autorizzato. I gruppi serate collassati
mantengono le card nel DOM; non è stata introdotta paginazione delle serate.
