# sc(r)occhiaTu 🎬

Uno spazio cinema condiviso per N e V: scegliere un film, organizzare la serata e conservare i ricordi delle visioni.

## Cosa funziona oggi

- Watchlist comune con ricerca TMDb, metadati dei film e avviso se la locandina scelta corrisponde a un film già presente (stesso ID TMDb).
- Match Live a swipe, Ruota della fortuna e proposta diretta per scegliere cosa guardare.
- Serate da proporre e confermare, scelta rapida «Stasera», snack personalizzati e promemoria della prossima serata.
- Stato «visto» indipendente per N e V, visione insieme, voti personali e voto condiviso da 0 a 10, recensioni modificabili e luogo facoltativo per ogni serata.
- «Il Nostro Cinema» con voto medio dei soli film visti insieme, recensioni e storico delle serate concluse, inclusi i rewatch.
- Ticket PNG da scaricare dopo la scelta; modalità sorpresa, veto settimanale e PWA installabile.
- Otto temi con anteprima selezionabili per dispositivo (Cinema, Cinema Noir, VHS e cinque stagionali), barra azioni mobile con Sorpresa e Aggiungi in evidenza, primo ingresso cinematografico, scheda film e Match Live più leggibili su mobile, e messaggi utili negli stati vuoti e negli errori. L'importazione in blocco resta disponibile come link secondario nel form «Aggiungi un Film».

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

Ultima verifica locale documentata: **327/327** smoke test e **12/12** controlli del service worker. «Il Nostro Cinema» calcola il voto medio solo dai voti condivisi dei film visti insieme; il luogo si modifica nella recensione scegliendo la serata, se ci sono rewatch. Le migration [voto insieme](database/supabase-migration-step-review-together.sql) e [luogo della serata](database/supabase-migration-step-night-location.sql) sono state applicate dall'utente; entrambe le colonne sono state verificate in Supabase in sola lettura (HTTP 200). La revisione grafica richiede ancora una verifica visiva su smartphone; il comportamento dell'ultimo ciclo non è stato ricontrollato manualmente su due telefoni.

Per aggiornare selettivamente i metadati di film già presenti, `scripts/refresh-movie-metadata.js` accetta `--ids=<uuid>` oppure `--titles=<titolo>`. Eseguire prima `--dry-run` per confrontare i valori; solo `--apply` scrive su Supabase. Include i rating OMDb e conserva quelli già salvati quando il servizio non ne fornisce di nuovi.

## File di database

Database locali, dump e backup sono esclusi da Git tramite `.gitignore`. I file in [`database/`](database/) contengono solo lo schema e le migration necessarie a ricostruire la struttura del database; non sono esportazioni dei dati. Li teniamo versionati perché permettono di riprodurre e verificare le modifiche allo schema. La [migration Step 9](database/supabase-migration-step9.sql), applicata in Supabase, aggiunge il vincolo unico sull'ID TMDb anche per inserimenti simultanei.

## Prossimi passi

Le Phase 8.3 «Al cinema / prossimamente», 22 «Timeline delle serate per mese» e [23 «I nostri numeri»](docs/PHASE23_MOVIE_CHEMISTRY.md) sono implementate localmente. Sono presenti anche la transizione card/scheda film (Phase 25), i suoni facoltativi (Phase 26), la vibrazione facoltativa (Phase 27), il ciak con skeleton (Phase 28) e una prima revisione della barra mobile e dei temi stagionali. Restano la revisione visiva su smartphone e la verifica dei flussi su due telefoni dopo il deploy. Per stato dettagliato, limiti e dipendenze, usare il [context unico](docs/MASTER_CONTEXT.md).
