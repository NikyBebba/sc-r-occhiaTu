# v76 locale — Ratings Consistency & Native Action Layout

Correzione locale, senza rilascio né Milestone 5. Nessuna modifica a database, RPC, snapshot, migration o giudizi. Supera, per il solo recupero dei rating e il layout Per me, il comportamento descritto nel precedente report Native Metadata Integration.

## Causa

- TMDb `vote_average` era già mantenuto dall'enrichment Discovery e dal mapper comune, ma il dettaglio ordinario non avviava alcun recupero all'apertura. Dopo reload/scadenza cache non aveva quindi il voto TMDb, che non è una colonna persistita.
- Discovery passava un fetch OMDb disabilitato al dettaglio non arricchito. Se il candidato era già arricchito, saltava interamente il recupero, anche quando IMDb/RT/MC mancavano. Il dettaglio TMDb non equivale a valutazioni OMDb già risolte.
- Il renderer usava i tre campi persistiti senza considerare i rating appena recuperati in cache. Non bastava quindi chiamare una fonte: i risultati dovevano arrivare allo stesso componente.
- Il layout personale usava `detail-menu-controls`, una griglia con colonne estese. Non era la famiglia di layout dei comandi Guardiamolo/Pianifica.

## Percorso unificato all'apertura

`tmdbMetadataFromDetail` conserva anche l'IMDb ID pubblico restituito da TMDb. `fetchTmdbDetailsById` riusa il dettaglio in cache e completa i rating attraverso l'esistente `fetchOmdbByImdbId` ed `extractRatings`.

| Situazione | Comportamento |
| --- | --- |
| Discovery già arricchita con IMDb ID | Riutilizza TMDb; richiede soltanto OMDb se non già risolto |
| Discovery non arricchita | Flusso normale di dettaglio TMDb, poi OMDb per IMDb ID |
| Film ordinario con TMDb ID | Apertura esplicita del dettaglio: stesso flusso, nessuna scrittura |
| Film appena acquisito | Rating disponibili inclusi nei campi supportati dell'acquisizione; stessa cache usata dal dettaglio persistito |
| Riapertura con cache valida | Nessuna nuova richiesta alle fonti |
| Riapertura dopo scadenza | Recupero delle fonti scadute, con richieste concorrenti deduplicate |
| IMDb ID assente nel dettaglio TMDb | Nessun tentativo ambiguo per titolo; restano i valori noti o n.d. |

L'estrazione mantiene n.d. per valori assenti/N/A. Il Metascore di OMDb è usato come fallback quando la voce Metacritic non è presente nell'array Ratings. Una fonte parziale non elimina le altre fonti disponibili.

## Rendering e acquisizione

`externalRatingsHtml` mantiene markup, classi, font, colori e spaziature preesistenti. Legge il voto TMDb valido e i rating OMDb risolti dalla cache comune. Una lettura OMDb recente prevale sui tre valori persistiti eventualmente obsoleti; se non restituisce un valore, il componente mostra n.d. I giudizi personali e Together non sono mai usati come fallback di una fonte esterna.

Il dettaglio ordinario richiama il loader soltanto all'apertura. Il completamento aggiorna esclusivamente il blocco delle fonti esterne: niente rerender di azioni, focus o giudizi e nessun comando runtime. Una risposta tardiva non aggiorna una scheda chiusa, un altro film o un contesto non più valido. Le pubblicazioni snapshot e i render ordinari non avviano richieste.

Discovery usa lo stesso completamento anche quando il dettaglio cinematografico è già presente. Le azioni esplicite mantengono il flusso di acquisizione/stato già verificato. IMDb/RT/MC vengono trasferiti dai dettagli disponibili attraverso i campi esistenti; TMDb rimane un metadato pubblico temporaneo, recuperabile alla riapertura. Nessuna colonna nuova e nessun aggiornamento automatico del catalogo: la sola apertura della scheda scrive esclusivamente nelle cache in memoria.

## Cache e costo

- TMDb: cache esistente, 100 dettagli, TTL un'ora, richieste pendenti condivise per ID.
- OMDb: cache in memoria per IMDb ID, 100 risposte; TTL un'ora per risposta valida, cinque minuti per indisponibilità/risposta negativa. Anche l'assenza dei voti viene memorizzata, evitando richieste a ogni riapertura.
- Gli aggiornamenti della sola fonte OMDb non rinnovano indefinitamente l'età del dettaglio TMDb. Il riuso di metadata Discovery scaduti non deve ripopolare il cache come se fossero appena recuperati.
- Timeout preesistente TMDb 10 secondi; OMDb limitato a otto secondi. Nessun retry automatico della fonte a ogni render.
- Costo sul film selezionato: zero richieste se tutto è valido; una OMDb se TMDb/IMDb ID sono già disponibili; altrimenti un dettaglio TMDb e una OMDb. Non vengono caricati i rating di tutte le card o dell'intero catalogo.
- La strategia Retrieval 2.0, il ranking e il budget dei batch non cambiano.

## Layout personale

Stesso contenitore `movie-list-actions detail-choice-actions` del dettaglio nativo, con azioni personali `movie-list-secondary` e colori semantici già presenti. Il contenitore condiviso diventa flex con wrapping, gap 8 px e larghezza a contenuto; i pulsanti hanno minimo 44 px e padding 10 px verticale / 8 px orizzontale. Non ci sono colonne metà contenitore o regole specifiche Discovery. La stessa struttura è applicata al comando personale del dettaglio ordinario. Colori, etichette e intenzioni restano invariati.

## Test locali

Nuova suite: `node --test scripts/verify-ratings-consistency.cjs` — 10/10 PASS. Esegue le API e il renderer reali con fetch sintetico e orologio controllabile: due fonti di rete effettivamente chiamate, enrichment già disponibile, tre rating presenti/assenti, acquisizione/riapertura, scadenza, richieste concorrenti, assenza IMDb ID, nessun I/O durante render, cache negativa e risposte UI obsolete.

Suite Discovery/profili/Core 2.0 e rating: 116/116 PASS. Core v75 132/132; Auth 82/82 con SDK simulato. Integrazione acquisizione 8 casi/128 assert; Movie Detail 32 casi/238 assert; rimozione Lista 5 casi/39 assert.

Browser HTTP locale con transport TMDb/OMDb simulati: 293 controlli PASS, 320/390/768/1280 px, otto temi. Controlla i quattro valori, parità del componente, rating ordinari caricati all'apertura, riapertura/render senza richieste aggiuntive, coerenza dopo acquisizione e dimensioni/wrapping delle azioni personali. Screenshot temporanei in `/tmp/sc-discovery-ux`. Harness con CSS reale e subset Tailwind offline: non equivale a certificazione Safari/dispositivi fisici o del CDN completo.

Completed Nights: codice/migration e test preesistenti preservati; regressioni 13 casi/93 assert UI e 24 casi SQL in PGlite in memoria PASS. Nessun accesso al Supabase remoto.

## Limiti e preservazione

Le fonti possono non offrire RT/MC/IMDb per un titolo: n.d. resta corretto. Senza TMDb ID sul record non viene avviata una ricerca per titolo per inventare un abbinamento. Se manca l'IMDb ID nella risposta TMDb, non si forza OMDb. La fonte può essere indisponibile o soggetta ai limiti della chiave esistente; non si promette copertura completa.

Baseline hash di 704 file. Nessuna modifica al lavoro Completed Nights, alla migration preparata, a Core 2.0, Match Live, Ruota, serate, ricordi, backup o untracked dello storico N. Nessun commit, push, deploy o nuova funzionalità infrastrutturale.
