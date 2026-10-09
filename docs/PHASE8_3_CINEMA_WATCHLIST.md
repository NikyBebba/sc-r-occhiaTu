# Phase 8.3 — Film al cinema e prossimamente

Stato corrente: flag cinema implementato, migration Step 10 già applicata;
produzione v54 e candidato frontend v55 locale, cache v55.
Le viste Streaming/Cinema appartengono alla Lista. Storico v55 è autonomo
dalla Home, ha solo switch N/V e include tutti i rispettivi seen=true anche
al cinema e fuori Lista, senza filtri disponibilità/ordinamento Lista.
Ricordi conserva statistiche, Serate concluse e Dopo il film, senza Storico.
La candidatura in_shared_list resta distinta da cinema e visto personale;
nessuna modifica v55 ai predicati Ruota/Match o al modello DB.
[UX corrente](UX_NAVIGATION_MEMORIES.md).

## Posizione storica nella roadmap

Da affrontare dopo l'attuale Phase 8.2 e prima della Phase 22. È una regola
della libreria e della scelta, non una statistica o un'estensione del Match Live.

## Esperienza implementata

- Nel flusso «Aggiungi film», opzione facoltativa **«Al cinema / prossimamente»**.
  Resta selezionata mentre si sceglie il risultato TMDb nel picker.
- Il film compare nella libreria condivisa con un badge riconoscibile e resta
  ricercabile. Dalla sua scheda si può cambiare l'opzione quando diventa
  adatto a una serata a casa; non è un'informazione dedotta automaticamente
  dalla data di uscita o dalla disponibilità streaming.
- Dal checkpoint del 5 ottobre la libreria parte da **Streaming** e offre
  uno switch **Streaming / Al cinema / prossimamente**: viste disgiunte,
  card cinema ambrate e tasti Oggi/Programma uniformi. Azzera filtri conserva
  la categoria, contatori e opzioni seguono la vista. Il flag resta una scelta
  manuale e non certifica la presenza del film su un servizio streaming.
- Finché l'opzione è attiva, il film non entra nella Ruota né nelle card di
  Match Live. Il cambio deve valere anche per una sessione Match già aperta:
  il deck è salvato e non basta filtrare solo alla creazione della sessione.
  La semantica degli swipe e della Match % resta invariata.
- Il film può comunque essere proposto per una serata con data e ora tramite
  il normale flusso `movie_nights`; l'altra persona conferma come oggi.
  «Oggi» e «Programma» hanno la stessa posizione e forma delle card streaming;
  il popup chiede snack e luogo facoltativi anche per una visita spontanea al cinema. Nessuna delle due azioni passa dalla Ruota.
- Se la serata viene conclusa, il film e l'evento seguono le normali regole di
  visione, recensione e storico. Il badge del film può essere modificato senza
  riscrivere le serate precedenti.

## Modello dati

Il dato condiviso persistente è
`movies.cinema_watchlist boolean NOT NULL DEFAULT false`. Il flag rappresenta
una **scelta manuale di N/V** («teniamolo per il cinema»), non una promessa
sulla disponibilità reale. I film esistenti hanno valore `false`; l'import bulk
continua a creare film normali. Non riutilizzare `movies.status` (che descrive
watchlist/serata/visto), `platform` (provider) o `matched` (metadati trovati).

La programmazione usa `movie_nights` senza bisogno di una nuova tabella.
Il luogo vive ora nel campo già applicato `movie_nights.location`, disponibile
nel popup della programmazione e di Oggi e modificabile per ciascun evento.
Il flag del film non è una prova retrospettiva del luogo: può cambiare nel tempo.
Ticket e timeline leggono il luogo dell’evento; il flag cinema non lo sostituisce.

La nuova colonna `movies` è descritta nella migration additiva
[`database/supabase-migration-step10.sql`](../database/supabase-migration-step10.sql),
preparata dopo l'autorizzazione all'implementazione. L'utente ha applicato la
migration in Supabase; una lettura REST della colonna ha restituito HTTP 200.
Un'aggiunta tentata prima della migration non è stata salvata: va ripetuta.
Se il database rifiuta l'inserimento per colonna mancante, l'app mostra ora
un avviso invece di far comparire temporaneamente il film solo in locale.

## Verifiche

1. Checkbox e picker TMDb conservano la scelta fino al salvataggio; il film
   appare subito nella libreria su entrambi i telefoni, anche dopo reload.
2. Ruota e nuove sessioni Match escludono il flag; una sessione Match attiva
   non mostra una card diventata «al cinema» durante la sessione.
3. La programmazione con data/ora e la conferma funzionano per il film
   escluso dalla scelta casuale; cancellazione e completamento restano coerenti.
4. Disattivare il flag rimuove l’esclusione cinema dalle **nuove** scelte,
   mantenendo i requisiti di candidatura, assenza Together/eventi attivi e veto;
   un eventuale deck Match già congelato non riceve automaticamente nuovi film.
5. Import bulk, duplicati per ID TMDb, sorpresa, fallback locale e Realtime
   mantengono il comportamento esistente.

Verifiche storiche dopo l'implementazione: aggiunta attraverso picker, toggle,
esclusione da Ruota e deck Match già aperto, programmazione di una serata
cinema, filtro libreria e avviso di salvataggio fallito. Colonna verificata
sul database remoto in sola lettura; resta da verificare il flusso completo
su due telefoni dopo il deploy.

## Checkpoint storico — 5 ottobre 2026

Il flag resta invariato nel frontend di quel checkpoint (cache PWA `v44`). Il pannello saghe aggiunge i capitoli con uscita futura come `cinema_watchlist: true`; restano in libreria/programmazione ed esclusi da Ruota e Match. Smoke complessivo **369/369 PASS**, service worker **12/12 PASS**. Migration Step 10 già applicata dall'utente e verificata in sola lettura; uso condiviso dopo il deploy da ricontrollare.

## Revisione del 5 ottobre 2026

Viste Streaming/Cinema e flusso proiezioni descritti in [PROIEZIONI.md](PROIEZIONI.md).
Cache PWA `v45`, smoke **379/379 PASS**, service worker **12/12 PASS**;
Chromium a 320/390/768 px senza errori o overflow. Nessuna nuova migration.
