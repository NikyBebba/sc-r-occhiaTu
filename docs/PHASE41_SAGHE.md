# Phase 41 — Continuiamo la saga?

Checkpoint corrente, 9 ottobre 2026: produzione v54, frontend locale v55,
cache candidata v55. Le saghe riusano viewingStatusHtml delle card: due badge
circolari originali N/V, personali dai seen quando non Together, entrambi oro
con Together dai completed. Nessun terzo badge/SVG o testo visibile Together.
L’oro non modifica seen_n/seen_v. N+V resta valido per voti/recensioni condivisi.
Le stesse card sono consultabili nella destinazione Storico dalla Home,
con switch N/V senza filtri Lista; Ricordi non contiene Storico personale.
Nessuna modifica v55 a dati, candidature, RPC o Match Live.

La fase originale fu autorizzata dopo la verifica di ticket e temi e verificata
localmente. I risultati e i limiti di quel ciclo sono conservati sotto; lo stato
della release corrente è riportato in apertura.

## Esperienza

- Entrata discreta «Continua la saga» nelle card della libreria e dei film visti, nella scheda del film, nel risultato della Ruota, nella celebrazione inline del Match e nella prossima serata, solo per un film con collection TMDb nota e accessibile.
- Dopo una nuova visione personale, una nuova recensione insieme o la conclusione di una serata, proporre il pannello «Continuiamo la saga?». La modifica di un voto/recensione non lo riapre. Nessun suggerimento provocato dal Realtime.
- Un pannello mostra i capitoli in **ordine di uscita**, senza assumere un ordine narrativo. Evidenzia il primo capitolo successivo già uscito e non visto insieme, quando riconoscibile; i capitoli precedenti restano consultabili. Se la data del film di riferimento non è nota, non inventare quale film sia il prossimo.
- Nessun film preselezionato. L'utente sceglie quali aggiungere e conferma; il proponente è la persona corrente. I film già nel catalogo non vengono duplicati. Capitoli noti fuori Lista e non Together possono essere candidati; se visti dal proponente richiedono il suo voto all’ingresso. Mostrare gli stati N/V/Together tramite i badge comuni.
- I film con data di uscita futura sono distinguibili e vengono aggiunti con `cinema_watchlist: true`, mantenendo l'esclusione da Match/Ruota. Data assente = disponibilità sconosciuta, senza dichiarare streaming disponibile.
- Una sorpresa non rivelata nella libreria resta senza titolo, locandina e dettagli anche qui. Il film sorgente nascosto non apre il pannello.

## Dati e affidabilità

API [TMDb collection details](https://developer.themoviedb.org/reference/collection-details), `language=it-IT`, da `collection_id` già persistito. Nessuna nuova colonna, tabella, dipendenza o modifica alla logica Match. I dettagli dei capitoli si recuperano per ID soltanto al momento dell'aggiunta, usando il percorso metadati esistente.

Cache collection in memoria per 15 minuti; timeout e messaggio con Riprova, senza esporre chiavi o URL autenticati. Collection incompleta/assente e capitoli senza data gestiti esplicitamente. Una risposta tardiva non deve sovrascrivere un pannello aperto per un altro film.

Dedup per `tmdb_id` prima del dettaglio, dopo il dettaglio e tramite vincolo UNIQUE esistente. Con inserimenti simultanei, riallineare e mostrare il film già presente. Un salvataggio parziale mantiene selezionati i film falliti per ritentare; non dichiara salvato sul DB un risultato solo temporaneo in memoria. Modalità locale esplicita come nel resto dell'app.

## Verifiche storiche della fase originale

Collection IT live in sola lettura; normalizzazione, ordine di uscita, dati assenti/futuri; stati di visione e anti-spoiler/anti-XSS; aggiunta esplicita con metadati, duplicati e concorrenza; errore/retry e risposta obsoleta; flussi scelta e visione; harness completo e service worker. Resa e uso su due telefoni da verificare dopo il deploy.

Risultati del ciclo: **351/351 smoke test PASS**, **12/12 service worker PASS**, controllo sintassi JS e `git diff --check` senza errori. Collection della trilogia del Cavaliere oscuro verificata live in sola lettura; test di inserimento solo con dati locali o mock, nessuna scrittura al DB reale.

Verifica browser Chromium con HTML/CSS e moduli reali, fixture di film e collection, a **320×568, 390×844 e 768×1024**: pannello sopra la scheda film, chiusura 44×44, nessun overflow orizzontale, checkbox inizialmente vuoti, selezione che abilita l'aggiunta, sorpresa protetta, Esc che chiude solo il pannello in cima e stato di errore con Riprova. Screenshot ispezionati; zero errori JavaScript nel browser. Playwright usato soltanto in una directory temporanea, senza dipendenze nel repository. Questa verifica non sostituisce l'uso su due telefoni con dati condivisi dopo il deploy.

Correzione successiva: ripristinato «Continua la saga» anche sulle card della lista. Verifica di regressione sul mantenimento del pulsante dopo render e cambio stato, con sorprese protette: **352/352 smoke PASS**, service worker **12/12 PASS**, cache `v39`.

## Checkpoint storico — 5 ottobre 2026

Il pannello e «Continua la saga» sulle card sono inclusi nel frontend aggiornato (cache PWA `v44`). Harness complessivo **369/369 PASS**, service worker **12/12 PASS**, sintassi e diff check superati. I numeri 351/352 sopra descrivono i cicli storici della feature. Prova di aggiunta e sincronizzazione su due telefoni da fare dopo il deploy; i test di inserimento finora usano fixture/localStorage/mock. Nessuna migration aggiuntiva per le saghe.
