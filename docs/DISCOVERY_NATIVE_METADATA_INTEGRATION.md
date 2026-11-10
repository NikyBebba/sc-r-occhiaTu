# Discovery v76 — Native UX e integrazione metadati

Implementato e verificato solo localmente. Nessun rilascio, commit/push, accesso o scrittura Supabase; nessuna migration modificata/applicata. I contratti Completed Nights restano intatti.

## Cause e correzioni

Il Movie Detail esterno usa già `renderMovieDetail`, ma gli veniva fornito un modello parziale e un blocco rating separato. Le due azioni personali erano adiacenti senza contenitore di layout. Ora usano `detail-menu-controls`, già presente nel dettaglio ordinario: gap 8 px, target minimo 44 px, due colonne su schermi ampi e una su mobile. Nessuna nuova regola CSS o variante Discovery.

Le card mostrano la regia reale quando disponibile, con la classe `card-director`. Card e dettaglio usano `externalRatingsHtml`: IMDb, RT, MC e TMDb condividono contenitore e gerarchia tipografica. Il numero TMDb è ammesso soltanto se finito, numerico e nell'intervallo 0–10; zero è valido, valori mancanti/invalidi non producono un numero. Le altre fonti conservano il comportamento ordinario (incluso n.d. dove previsto).

Il badge «Fuori dal catalogo» è rimosso da card e dettaglio. Il provider IT flatrate usa la posizione metadati ordinaria; in assenza compare il fallback ordinario «Streaming», che non attesta la disponibilità su un servizio specifico. Non si deduce un provider dall'assenza nel catalogo dell'app.

## Percorso dei metadati

| Campo | Causa precedente | Comportamento locale |
| --- | --- | --- |
| TMDb ID, titolo, anno, poster, generi, durata, regia, cast, trama | Già inviati se disponibili; i candidati non arricchiti potevano avere campi incompleti | Mapper comune e acquisizione dopo il recupero dei dettagli selezionati; verifica nello snapshot |
| Nome collection | Conservato solo l'ID nelle feature Discovery | Conservati ID e nome attraverso payload e snapshot |
| Provider e trailer | Scartati dall'enrichment e omessi dal payload | Stesso mapper del flusso ordinario, campi già supportati dal runtime |
| Rating IMDb/RT/MC | Non richiesti sistematicamente in Discovery | Riutilizzati quando già disponibili; nessun enrichment OMDb massivo |
| Rating TMDb | Testo separato nel dettaglio, assente nelle card | Renderer comune, fonte pubblica separata dai giudizi personali/Together |
| Record preesistente | `saveContent` applicava lo stato senza completare i metadati | Opzione esplicita Discovery per riempire solo campi mancanti, tramite `updateMetadata` |

`tmdbMetadataFromDetail` è puro e condiviso con `buildTmdbDetails`. I dettagli di enrichment richiedono anche `videos,watch/providers` nell'append già esistente: stesso numero di richieste, nessuna modifica a pool, cursori, eligibility o ranking.

Il dettaglio non arricchito viene completato alla sua apertura usando `fetchTmdbDetailsById` già esistente, senza chiamata OMDb automatica da Discovery. Le azioni native attendono la fine di questo recupero; un errore lascia disponibili i metadati già noti con feedback esplicito. Il caricamento non scrive nulla. Un dettaglio già disponibile viene riutilizzato.

La cache pubblica in memoria è limitata a 100 elementi, con TTL di un'ora e deduplicazione delle richieste in corso per ID. Le richieste di dettaglio hanno timeout di 10 secondi. L'aggiornamento esplicito dei metadati ordinari forza il recupero, evitando che il nuovo riuso della cache renda inefficace «Aggiorna informazioni da TMDb».

Costo: ricerca iniziale entro il budget esistente di 16 richieste (verificato nel browser); append aggiuntivi senza nuove richieste. L'apertura di un candidato non arricchito può aggiungere un solo GET di dettaglio, fuori dal budget del batch perché azione esplicita, senza retry automatici. Riaperture dello stesso dettaglio riusano cache/richiesta pendente.

## Acquisizione e stato autorevole

Il payload Discovery attraversa il normale mapper `metadata()` e i comandi TARGET esistenti. L'opzione `fillMissingMetadata` riguarda solo il collegamento Discovery; gli altri consumer conservano il comportamento precedente.

- Film nuovo: `CONTENT_CREATE`, conferma dei campi disponibili nello snapshot online, poi l'azione richiesta.
- Film esistente/deduplicato: completa soltanto null, stringhe vuote o array vuoti con valori realmente disponibili; non sovrascrive titolo, trama, provider specifici o altri dati già valorizzati. Il fallback ordinario «Streaming» può essere sostituito da un provider IT effettivamente recuperato.
- Patch necessaria: `CONTENT_UPDATE_METADATA`, poi conferma della proiezione e azione nativa.
- Aggiornamento incerto: restituisce l'esito distinto e la patch attesa; il reconciler non conferma l'acquisizione né abilita una nuova azione prima che quella patch sia osservata. Nessun secondo salvataggio automatico.

Le tre azioni rimangono `PROPOSE_TO_GROUP`, `ADD_PERSONAL_LIST`, `RETROSPECTIVE_SEEN`. Le due personali non candidano al gruppo, non aggiungono giudizi di gusto e non creano eventi. La transizione al dettaglio persistito avviene sull'ID autorevole, conservando il contesto e i controlli ordinari.

Il trailer viene selezionato dai video YouTube realmente restituiti (trailer italiano preferito, teaser come fallback; nessuna featurette o clip generica), con chiave validata e link costruito dalla logica API comune. È omesso se assente/non valido. Il modello di presentazione mappa `trailerUrl` in `trailer_url`; il payload applica la stessa conversione per il DB. La verifica controlla che resti accessibile dal dettaglio persistito.

## Limite del rating TMDb

Il contratto persistito non ha un campo TMDb rating. Non sono introdotte colonne o valori nascosti in campi diversi. TMDb resta un metadato pubblico temporaneo, disponibile anche dopo acquisizione tramite la cache comune del renderer. Dopo reload/scadenza può non essere visualizzato finché non viene recuperato nuovamente un dettaglio; non si aggiungono chiamate automatiche per l'intera Lista.

Trailer, provider e gli altri campi supportati vengono invece verificati nel record dello snapshot. Non si considera la sola esistenza del contenuto una prova dell'importazione completa.

## Dalla Lista

Rimosso il pulsante superiore Aggiorna. Restano Scopri/Dalla Lista e Altri suggerimenti in fondo, con le regole preesistenti di rotazione e rilevamento degli input obsoleti. Il Core v75 e il suo ordinamento non cambiano; il browser confronta gli ID con l'output reale del Core.

Le spiegazioni sono solo presentazionali. Regia/cast/collection sono citati quando una reason specifica positiva corrisponde ai metadati del candidato e ha almeno due ID di evidenza distinti presenti nel catalogo. Un giudizio Together diretto positivo deve risultare dalla struttura reale della reason. Non si espongono nomi personali, diagnostiche o somiglianze fondate sul solo genere. Altrimenti: «Una proposta dalla Lista per la prossima visione.»

## Verifiche

Solo fixture sintetiche, transport mock e server HTTP loopback; nessun test di scrittura reale.

- Suite Discovery/TasteProfiles/Core 2.0, inclusi i nuovi test metadati: 106/106 PASS.
- Nuova integrazione in `verify-production-shell.cjs`, filtro `Discovery metadata`: 8 casi / 128 assert PASS. Tre azioni, contenuto nuovo ed esistente, payload, snapshot autorevole, dettaglio persistito, trailer, incertezza e nessuna duplicazione.
- Browser Discovery esteso: 276 controlli PASS, 320/390/768/1280 px, otto temi. Gap/target personali, font dei rating, quattro fonti numeriche insieme, regia, provider presente/assente, trailer presente/assente e prima/dopo acquisizione, assenza badge/Aggiorna, identità temporanea/persistita, Dalla Lista e ordine v75, errori/batch/retry e doppio click.
- Gli screenshot e le misure del browser usano il CSS reale e il subset Tailwind offline già adottato dall'harness; nessuna certificazione di Safari/dispositivi reali o CDN completo.
- Core v75: 132/132 PASS. Auth: 82/82 con SDK simulato. Filtri shell detail 29/151, Match 17/57, rimozione Lista 5/39; frontend CAP-1 PASS.
- Completed Nights: 24 casi SQL su PGlite in memoria, 13 casi UI / 93 assert, browser 104 controlli PASS. La migration è letta esclusivamente dalla fixture in memoria, mai applicata al remoto.
- La suite VM recommendation incontra il limite preesistente `MutationObserver` assente nello stub. Non è dichiarata PASS; il percorso reale Scopri/Dalla Lista è verificato nel browser.

## Preservazione

Baseline SHA-256 acquisita su 702 file. File Completed Nights, SQL preparato, decoder, adapter, editor e documentazione restano identici. Nei file condivisi vengono confrontati byte per byte i frammenti completed di HTML, ProductContext, TargetShell e suite shell. Backup e untracked dello storico N conservati; nessun reset o ripristino.
