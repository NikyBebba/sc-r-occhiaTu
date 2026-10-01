# Phase 22 — Timeline delle serate per mese

Stato: **implementata nel codice locale; verifica mobile su due telefoni da eseguire** · 1 ottobre 2026

## Obiettivo

Rendere «Il Nostro Cinema» una memoria leggibile delle serate condivise. La timeline
racconta gli eventi `movie_nights` completati, inclusi i rewatch, senza ricavare
una cronologia fittizia dai campi del film.

## Fonte e regola della data

Ogni elemento rappresenta **una riga `movie_nights` con `status = completed`**.
Il mese della serata si ricava così:

1. `night.date`, se è una data calendario valida `YYYY-MM-DD`: è la data
   programmata della serata e rimane il riferimento anche se la visione viene
   registrata in un giorno successivo;
2. altrimenti `night.completed_at`, convertito nel giorno locale del dispositivo:
   è il momento in cui è stata registrata la conclusione, non una data di visione
   accertata;
3. se entrambi mancano o sono invalidi, sezione «Data non registrata».

`created_at`, `confirmed_at`, `movies.scheduled_date` e `movies.created_at` non
sono date della visione e non entrano nel raggruppamento. A parità di giorno,
l'ordine è per `completed_at` decrescente se disponibile, poi per ID stabile.
Le date `YYYY-MM-DD` vanno lette per componenti locali, senza
`new Date('YYYY-MM-DD')`.

## Interfaccia

- Mantenere «Il Nostro Cinema» nel modale attuale. Sostituire la griglia piatta
  «Le nostre serate» con gruppi mensili dal più recente al meno recente. Ogni
  intestazione mostra mese, anno e numero di serate; sotto, le card biglietto
  già esistenti. «Data non registrata» resta in fondo.
- Nelle card mostrare la data della serata. Se la data viene da
  `completed_at`, usare una dicitura esplicita come «Registrata il 24 ott».
  Mostrare snack solo se presente. Il conteggio generale resta il numero di
  eventi completati, non il numero di film distinti.
- Sul telefono i gruppi scorrono verticalmente nel modale. Nessun filtro o
  paginazione in questa fase: sono due persone e il volume attuale è piccolo.
  Conservare i comportamenti di apertura, chiusura e focus del modale.
- Se non esistono serate completate, mostrare un invito semplice ad aspettare
  la prima serata conclusa.

## Recensioni e privacy della sorpresa

Le recensioni personali sono salvate sul film senza `reviewed_at`. Restano in
una sezione separata «Recensioni», fuori dai gruppi mensili, senza data e senza
pretendere un ordine cronologico. La vecchia ordinazione basata su
`scheduled_date`/`created_at` va eliminata perché descrive altro. N, V e
«Insieme» rimangono distinti.

Se un film è ancora una sorpresa per chi guarda, la timeline usa il titolo
generico e non mostra poster o recensioni che rivelino il film. Va mantenuta
la stessa protezione dell'attuale storico. Se il film collegato è stato rimosso,
la serata resta visibile come «Film non disponibile» finché la riga esiste.

## Confini tecnici

La Phase 22 è una modifica di sola lettura e presentazione in `js/ui/render.js`,
`index.html` e, se serve, `css/style.css`. Nessuna migration, nessuna modifica a
Match Live, Ruota, `votes`, flussi serata o regole Realtime. La selezione degli
eventi e la scelta del mese dovrebbero stare in funzioni pure, così i casi di
date e fusi orari si possono verificare senza DOM.

## Criteri di verifica

1. Due serate completate sullo stesso film producono due card e un conteggio 2.
2. Una serata datata usa il mese di `night.date`, anche se `completed_at` è nel
   mese dopo; una quick «Stasera» senza `date` usa il mese locale di
   `completed_at`, con etichetta «Registrata il…».
3. Date assenti o invalide finiscono in «Data non registrata»; non spostano
   silenziosamente la serata al mese di creazione.
4. Recensioni senza timestamp restano leggibili ma non compaiono sotto un mese.
5. Sorpresa, film rimosso, stato vuoto, stringhe utente con HTML e render dopo
   resync continuano a funzionare. Eseguire smoke test, check JS e controllo
   mobile manuale del modale; il test locale non sostituisce la prova su due
   telefoni.

Smoke locale dopo l'implementazione: raggruppamento per mese, priorità a
`night.date`, fallback locale a `completed_at`, sezione senza data e rewatch
verificati. La prova manuale su due telefoni resta da fare dopo il deploy.

## Dopo la Phase 22

La Phase 23 può aggiungere statistiche retrospettive calcolate sugli stessi
eventi, con denominatori espliciti. La Phase 24 richiede una decisione di
prodotto sulle motivazioni da mostrare; non deve riusare il vecchio `votes`.
