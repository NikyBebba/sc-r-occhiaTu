# Proiezioni: oggi, programmazione e dettagli

Aggiornamento del 5 ottobre 2026, cache PWA `v45`.

## Esperienza implementata

«Oggi» sostituisce «Stasera» nelle card, nel Match e nella Ruota. Apre il popup
«Oggi si guarda» con le stesse scelte snack della programmazione, incluso snack
personalizzato e nessuno snack. Il luogo è facoltativo. Non chiede data o ora:
è una scelta rapida valida anche a pranzo. Annullare, Esc, X o backdrop non
crea eventi. Il risultato Ruota resta disponibile se si annulla il popup.

«Programma» apre «Programma la proiezione» con data, ora, snack e luogo;
«Invia proposta» crea un appuntamento da confermare dall'altro utente.

«Snack e luogo» nel hero, nelle card programmate e in «In cartellone» permette
di cambiare o rimuovere entrambi i dettagli, prima o dopo l'accettazione.
Non cambia data, ora, stato, autore, voto o recensione e non crea un altro evento.
Il luogo resta disponibile nel form voto/recensione e nello storico; concludere
rapidamente una proiezione conserva il luogo già scelto.

«In cartellone» vive sotto il hero, fuori dalla vecchia sidebar nascosta.
Mostra le altre proiezioni attive in formato compatto. Il proponente vede
l'attesa; l'altro utente può accettare o rifiutare anche mentre c'è un film per
oggi. Il hero mantiene la priorità di oggi. Il pannello non duplica l'evento
principale e resta nascosto nel Match; il calendario conserva la sua vista.
Le azioni indirizzano l'ID dell'evento, anche se due eventi riguardano lo stesso film.
Titoli di sorprese non rivelate restano nascosti.

Ticket: «Biglietto, prego», «In programma», «Il film è servito», «Vietato
spoilerare». Niente «il nostro cinema»/«serata insieme» ripetuti. Origine esplicita,
percentuale solo dal Match, data/ora senza valori inventati, snack e luogo
letti dall'evento attivo. Mancanze indicate come da decidere; nomi reali solo
quando il proponente è noto. Il PNG resta 1080×1920 con poster e fallback.

## Streaming e cinema

La libreria parte da Streaming. Lo switch offre solo Streaming e Al cinema /
prossimamente, senza dropdown «Tutti» o descrizione «Solo streaming».
I due insiemi sono disgiunti e dipendono dal flag cinema già esistente: i film
legacy senza flag restano nello streaming. Le card cinema usano bordo/fondo
ambrati e badge, con gli stessi tasti Oggi e Programma. «Sposta in Streaming» /
«Sposta al cinema / prossimamente» cambia la classificazione manuale.

Contatori, ricerca e opzioni filtro seguono la vista; il reset dei filtri
conserva la categoria. Cambiare vista pulisce la piattaforma selezionata.
Render e Realtime conservano lo switch. Ruota e Match continuano a escludere
film contrassegnati cinema, anche se la libreria mostra quella categoria.

## Dati e sincronizzazione

Nessun cambio di schema: snack e luogo usano `movie_nights.snack/location` già
esistenti. Scelta rapida: confirmed, date/time NULL, confirmed_at registrato.
Programmazione: proposed, data/ora e proposed_by. Mirror film compatibile:
la scelta rapida pulisce eventuali vecchie date e aggiorna snack. Origine ticket
solo in memoria, come prima. Realtime e refetch mantengono la sincronizzazione.

Il salvataggio fallito lascia il popup aperto con errore visibile; il bottone
è disabilitato durante la richiesta. Nessun mirror o chiusura Match se l'insert
fallisce. Il Match si chiude solo dopo conferma del popup e creazione riuscita.

## Verifiche

- Smoke: **379/379 PASS**, con regressioni su annullo, snack custom, persistenza
  del luogo, pulizia delle vecchie date, modifica/rimozione dei dettagli,
  insert fallito, viste disgiunte/contatori/switch/card, proposta accettata durante il film di oggi, eventi distinti
  dello stesso film, luogo conservato alla conclusione e testi del canvas.
- Service worker: **12/12 PASS**; controllo sintassi e diff senza errori.
- Chromium con fixture a 320×568, 390×844 e 768×844: popup, programmazione a
  pranzo, accettazione, modifica/rimozione, card e annullo; switch Streaming/Cinema,
  comandi uniformi, colori, resync e spostamento tra le due viste. Screenshot e PNG
  ispezionati; nessun errore JavaScript o overflow orizzontale.
- Nessuna scrittura sul database reale. Sincronizzazione tra due telefoni e
  download PNG su dispositivo reale restano da verificare dopo il deploy.
