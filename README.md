# sc(r)occhiaTu 🎬

Uno spazio cinema condiviso per N e V: scegliere un film, organizzare la serata e conservare i ricordi delle visioni.

## Cosa funziona oggi

- Watchlist comune con ricerca TMDb, metadati dei film e avviso se la locandina scelta corrisponde a un film già presente (stesso ID TMDb).
- Home con saluto personale, tre card per Match Live, Ruota e Libreria, e accessi compatti a Visti e recensioni e Calendario. Le viste sono centrate e tutti i pulsanti di uscita da Match tornano alla home, conservando la sessione.
- Serate da proporre e confermare, scelta rapida «Stasera», snack personalizzati e promemoria della prossima serata.
- Stato «visto» indipendente per N e V; voti personali e condiviso 0–10 con un decimale da tastierino, punto o virgola. Il voto N+V e la sua azione sono in oro, il pulsante personale usa il colore N/V. Il testo è facoltativo: svuotarlo e salvare conserva il voto. Luogo distinto per ogni serata e rewatch.
- «Ricordi» apre «Titoli di coda»: quattro riepiloghi (media, voto più alto, genere più visto, film aggiunti per autore), storico mensile con N+V accanto al voto e sezione «Dopo il film» per voti e recensioni. Il calendario include le scelte rapide concluse nel giorno di completamento ed esclude le annullate; i rewatch conservano eventi distinti.
- Saghe TMDb: gli altri capitoli in ordine di uscita, suggerimento dopo una nuova visione e aggiunta esplicita alla lista. Film già presenti/visti riconoscibili, sorprese protette e future uscite segnate «Al cinema / prossimamente».
- Ticket PNG da scaricare dopo la scelta, con locandina protagonista, titolo adattivo e talloncino con origine, data e snack; modalità sorpresa, veto settimanale e PWA installabile.
- Otto temi con anteprima e cambio automatico per periodo (Primavera, Estate, Autunno, Inverno, Pasqua, Halloween, Natale e Capodanno); la scelta manuale dura fino al prossimo periodo. Barra mobile con «Ricordi» e «Aggiungi» visibili, primo ingresso cinematografico, scheda film e Match Live più leggibili, e messaggi utili negli stati vuoti e negli errori. «Ricordi» apre storico, recensioni e statistiche; «Sorpresa» è un'azione secondaria accanto alla Ruota; l'importazione in blocco resta un link nel form «Aggiungi un Film». I campi su smartphone usano testo da 16 px e i controlli principali hanno target tattili da almeno 44 px.

I temi festivi hanno precedenza sulle stagioni: Natale dal 22 dicembre al 6 gennaio, Halloween dal 27 ottobre al 2 novembre, Pasqua dal Venerdì Santo a Pasquetta (quattro giorni, data calcolata ogni anno). Capodanno, nero con inserti dorati, si attiva dal 30 dicembre al 2 gennaio e ha precedenza su Natale. Il selettore permette di tornare subito ad «Automatico»; VHS e Default sono stati rimossi.

Il tono è cinematografico e leggero: «Due poltrone. Un solo telecomando.», «Che film si guarda?» e «Due sì fanno un Match». La scritta in home ha due ciak uguali; il PIN ha «Ciak, si entra», titolo «Biglietto, prego» e una battuta originale da agente segreto. Evitare di ripetere nostro/vostro/insieme quando il contesto è già chiaro.

Le modifiche condivise si sincronizzano tramite Supabase Realtime. In assenza di connessione, l'app segnala la modalità locale e usa `localStorage`.

## Avvio e struttura

L'app usa HTML, JavaScript vanilla, CSS e librerie via CDN. Non richiede un bundler. Per provarla in locale, dalla radice del repository:

```sh
python3 -m http.server 8000
```

Aprire `http://localhost:8000` nel browser. La configurazione dei servizi è in `js/config.js`; non riportare chiavi o PIN in documenti, issue o log.

| Percorso | Contenuto |
| --- | --- |
| `index.html`, `css/`, `js/` | Interfaccia e logica dell'app |
| `scripts/` | Import, manutenzione e verifiche |
| `data/movie-watchlist.json` | Lista iniziale dei titoli |
| `database/` | Schema e migration Supabase versionati |
| [`docs/MASTER_CONTEXT.md`](docs/MASTER_CONTEXT.md) | Stato corrente, decisioni e roadmap |

## Verifiche

```sh
node scripts/smoke.js
node scripts/verify-sw.js
```

Checkpoint del 5 ottobre 2026: **369/369** smoke test e **12/12** controlli del service worker, sintassi JS e diff check superati. Cache PWA **`v44`**. Chromium con fixture e screenshot ispezionati a 320/390/768 px per login, PIN, home, Ricordi e modali; pannello saghe verificato anche sopra la scheda film. Nessuna scrittura sul DB reale durante queste prove.

La [migration dei voti decimali](database/supabase-migration-step38-decimal-ratings.sql) è stata applicata dall'utente. La verifica indipendente dei tipi via OpenAPI ha restituito HTTP 401; lo stato è registrato sulla sua conferma. Le precedenti migration voto condiviso e luogo serata erano state applicate e verificate in lettura. Restano da provare dopo il deploy il tastierino nativo, i salvataggi decimali e la rimozione del solo testo su due telefoni, oltre all'aggiunta dei capitoli di una saga. Le prove browser non sostituiscono quelle con dati condivisi reali.

Per aggiornare selettivamente i metadati di film già presenti, `scripts/refresh-movie-metadata.js` accetta `--ids=<uuid>` oppure `--titles=<titolo>`. Eseguire prima `--dry-run` per confrontare i valori; solo `--apply` scrive su Supabase. Include i rating OMDb e conserva quelli già salvati quando il servizio non ne fornisce di nuovi.

## File di database

Database locali, dump e backup sono esclusi da Git tramite `.gitignore`. I file in [`database/`](database/) contengono solo lo schema e le migration necessarie a ricostruire la struttura del database; non sono esportazioni dei dati. Li teniamo versionati perché permettono di riprodurre e verificare le modifiche allo schema. La [migration Step 9](database/supabase-migration-step9.sql), applicata in Supabase, aggiunge il vincolo unico sull'ID TMDb anche per inserimenti simultanei.

## Prossimi passi

Dopo il push, verificare il nuovo frontend sui due telefoni e accettare l'aggiornamento PWA, se proposto. Provare i voti `8,3`/`8.3`, le recensioni senza testo e il pannello saghe, controllando che le modifiche arrivino sull'altro dispositivo. Confermare anche la resa di home, temi e «Titoli di coda».

Voti decimali e saghe sono implementati; non appartengono più alle idee future. Gamification, raccomandazioni avanzate, statistiche personali e l'eventuale spazio Extra restano da progettare in fasi dedicate. Per priorità, decisioni e vincoli usare il [master context](docs/MASTER_CONTEXT.md).

Specifiche aggiornate: [saghe](docs/PHASE41_SAGHE.md), [voti decimali](docs/PHASE38_DECIMAL_RATINGS.md), [Ricordi e statistiche](docs/PHASE23_MOVIE_CHEMISTRY.md), [timeline mensile](docs/PHASE22_TIMELINE.md).
