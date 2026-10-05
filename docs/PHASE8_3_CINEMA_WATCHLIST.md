# Phase 8.3 — Film al cinema e prossimamente

Stato: **implementata nel codice locale; migration Step 10 applicata dall'utente e colonna verificata via REST** · 1 ottobre 2026

## Posizione nella roadmap

Da affrontare dopo l'attuale Phase 8.2 e prima della Phase 22. È una regola
della libreria e della scelta, non una statistica o un'estensione del Match Live.

## Esperienza proposta

- Nel flusso «Aggiungi film», opzione facoltativa **«Al cinema / prossimamente»**.
  Resta selezionata mentre si sceglie il risultato TMDb nel picker.
- Il film compare nella libreria condivisa con un badge riconoscibile e resta
  ricercabile. Dalla sua scheda si può cambiare l'opzione quando diventa
  adatto a una serata a casa; non è un'informazione dedotta automaticamente
  dalla data di uscita o dalla disponibilità streaming.
- La libreria parte da «Tutti i film, anche al cinema» e offre «Solo streaming»,
  che esclude i film contrassegnati per il cinema. Il filtro usa solo questa
  scelta manuale: non certifica la presenza del film su un servizio streaming.
- Finché l'opzione è attiva, il film non entra nella Ruota né nelle card di
  Match Live. Il cambio deve valere anche per una sessione Match già aperta:
  il deck è salvato e non basta filtrare solo alla creazione della sessione.
  La semantica degli swipe e della Match % resta invariata.
- Il film può comunque essere proposto per una serata con data e ora tramite
  il normale flusso `movie_nights`; l'altra persona conferma come oggi.
  «Programma» è l'azione principale, ma «Stasera» resta disponibile per una
  visita spontanea al cinema. Nessuna delle due azioni passa dalla Ruota.
- Se la serata viene conclusa, il film e l'evento seguono le normali regole di
  visione, recensione e storico. Il badge del film può essere modificato senza
  riscrivere le serate precedenti.

## Modello dati proposto

Serve un dato condiviso e persistente sul film, ad esempio
`movies.cinema_watchlist boolean NOT NULL DEFAULT false`. Il flag rappresenta
una **scelta manuale di N/V** («teniamolo per il cinema»), non una promessa
sulla disponibilità reale. I film esistenti hanno valore `false`; l'import bulk
continua a creare film normali. Non riutilizzare `movies.status` (che descrive
watchlist/serata/visto), `platform` (provider) o `matched` (metadati trovati).

La programmazione usa `movie_nights` senza bisogno di una nuova tabella. Se si
vuole ricordare nello storico **dove** si è svolta la serata, serve invece un
campo separato sull'evento, per esempio `movie_nights.venue`; il flag del film
non può essere usato come prova retrospettiva, perché può cambiare nel tempo.
Questo è un punto da decidere prima di estendere ticket e timeline.

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
4. Disattivare il flag rende di nuovo il film eleggibile alle **nuove** scelte;
   un eventuale deck Match già congelato non riceve automaticamente nuovi film.
5. Import bulk, duplicati per ID TMDb, sorpresa, fallback locale e Realtime
   mantengono il comportamento esistente.

Smoke locale dopo l'implementazione: aggiunta attraverso picker, toggle,
esclusione da Ruota e deck Match già aperto, programmazione di una serata
cinema, filtro libreria e avviso di salvataggio fallito. Colonna verificata
sul database remoto in sola lettura; resta da verificare il flusso completo
su due telefoni dopo il deploy.

## Checkpoint corrente — 5 ottobre 2026

Il flag resta invariato nel frontend corrente (cache PWA `v44`). Il pannello saghe aggiunge i capitoli con uscita futura come `cinema_watchlist: true`; restano in libreria/programmazione ed esclusi da Ruota e Match. Smoke complessivo **369/369 PASS**, service worker **12/12 PASS**. Migration Step 10 già applicata dall'utente e verificata in sola lettura; uso condiviso dopo il deploy da ricontrollare.
