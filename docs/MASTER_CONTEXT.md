# 🎬 sc(r)occhiaTu — MASTER PROJECT CONTEXT v2.38

Ultimo aggiornamento: 5 ottobre 2026. Documento unico di contesto e roadmap; le versioni precedenti restano nella cronologia Git.

## Checkpoint corrente — 5 ottobre 2026

Versione finale del ciclo, cache PWA **`v44`**. I paragrafi successivi sono
cronologia: statuette, vecchi nomi e conteggi non descrivono la UI attuale.

- Home con due ciak uguali e copy cinematografico; ingresso persona/PIN
  con «Ciak, si entra», «Biglietto, prego» e battuta originale da agente.
- Saghe implementate: «Continua la saga» anche sulle card, ordine di uscita,
  aggiunta esplicita, dedup e sorprese protette.
- Decimali 0–10 per N/V/N+V: punto/virgola, colore personale e oro condiviso;
  testo eliminabile senza perdere il voto. Migration Phase 38 applicata
  dall'utente, conferma indipendente dei tipi OpenAPI non disponibile (401).
- Ricordi → «Titoli di coda»: quattro riepiloghi, «In numeri» con icona,
  storico N+V e «Dopo il film» senza etichette ripetute. Film aggiunti contati
  su tutta la libreria; media calcolata in decimi con arrotondamento corretto.
- **369/369 smoke PASS**, **12/12 service worker PASS**, controlli sintassi
  e diff check; browser fixture a 320/390/768 px con screenshot ispezionati,
  nessun errore JS/overflow. Tool di verifica solo fuori dal repository.
- Dopo il push e il deploy: accettare l'aggiornamento PWA sui due telefoni e
  provare decimali, rimozione del testo e saghe con sincronizzazione reale.
  Non dichiarare verificato questo passaggio prima della prova dell'utente.

README, AGENTS e specifiche Phase 22/23/38/41 allineati a questo checkpoint;
le istruzioni di sicurezza e il contratto Match restano invariati.

## Cronologia del ciclo


Rifinitura successiva — L'utente preferisce due icone del ciak alle statuette: «Luci basse, schermo acceso» è affiancata da due `fa-clapperboard` uguali. Rimossi SVG e relativo stile; Font Awesome già incluso, nessuna dipendenza. PIN spy invariato. Cache PWA `v44`.


Rifinitura home e PIN — «Luci basse, schermo acceso» ha due statuette dorate uguali ai lati (SVG nativi inline, decorativi, nessuna immagine/dipendenza esterna). Nel PIN l'eyebrow diventa «Ciak, si entra» e il titolo «Biglietto, prego». Sotto: «Accesso riservato, agente {nome}. Senza codice segreto non si passa.»; battuta originale in stile spy movie, senza attribuzione a un film. Testo dinamico per N/V con textContent; controllo PIN e sessione invariati. Cache PWA `v43`. Sintassi e diff check superati; Chromium con fixture a 320/390/768 px, due SVG identici, login/PIN/home e zero errori/overflow, screenshot ispezionati. Smoke **369/369 PASS**, service worker **12/12 PASS**.


Direzione del tono estesa a login e home — Preferenza esplicita dell'utente: cinema, leggerezza e piccole battute, senza una cornice continuamente romantica e senza seriosità. Login: «Proiezione quasi pronta», «Due poltrone. Un solo telecomando.», «Vietato spoilerare all'ingresso»; PIN «Biglietto, prego» / «Ciak, si entra». Home: «Che film si guarda?», «Popcorn pronti. Manca solo il film.», Match «Due sì fanno un Match» con pollice su, Ruota «Un giro e salta fuori il film», collegamenti «Tra un film e l'altro». Conteggi, cartellone e stati vuoti usano testi semplici e riferimenti al cinema; niente nostri/vostri/insieme ripetuti nella home. «In numeri» ha l'icona chart-bar supportata dalla versione Font Awesome dell'app. La distinzione personale/condiviso resta precisa nei voti e nei flussi, senza cambiare PIN, sessioni, conteggi o logiche Match/Ruota. Smoke **369/369 PASS**, service worker **12/12 PASS**; browser con fixture a 320/390/768 px per login, PIN, home, icona e Ricordi, senza overflow/errori JS. Nessuna migration o dipendenza, cache PWA `v42`.

Revisione Ricordi — Il modale ora si chiama «Titoli di coda»: sezioni «In numeri», «Serate concluse» e «Dopo il film». L'utente chiede un tono cinematografico e leggero, evitando di ripetere continuamente noi/nostro/insieme: le funzioni restano condivise, senza insistere sulla coppia nei testi. Otto riquadri ridotti a quattro, prima dello storico: voto medio condiviso, voto più alto (titolo del film visibile o numero di ex aequo), genere più visto e film aggiunti per autore sull'intera libreria. Rimossi i riquadri duplicati di film visti, film distinti, film votati e rewatch; il totale serate compare nell'intestazione dello storico. Storico completo, rewatch e dati invariati; `movieChemistryStats` resta come helper, senza quei riquadri in UI. Nel riepilogo recensioni ogni voto è solo «★ x/10», senza «Insieme» ripetuto; le card delle serate concluse usano N+V. Voto più alto tra le recensioni condivise visibili: zero valido, un decimale, legacy, ex aequo e sorprese protette. Media calcolata in decimi per arrotondare correttamente i valori a metà (9,1 e 0 → 4,6). Nessuna migration/dipendenza. Cache PWA `v42`; smoke **369/369 PASS**, service worker **12/12 PASS**, sintassi e diff check superati. Chromium con fixture a 320/390/768 px: quattro riepiloghi, titoli lunghi, vuoto, N+V e nessun overflow/errori JS; screenshot ispezionati. Prova su due telefoni dopo deploy ancora da fare.

Revisione voto condiviso e film aggiunti — Nelle card e nella scheda il voto condiviso, la recensione e la relativa azione usano «N+V» (etichette dei due utenti); il pulsante «Modifica voto N+V» usa lo stesso `--color-oro` del voto condiviso, sopra il pulsante personale N/V. «Vota N+V» usa lo stesso stile quando manca il voto. Titolo e campo voto del form identificano N+V; i testi descrittivi delle statistiche conservano «insieme». Corretto il widget «Film aggiunti»: conta tutti i film presenti per `added_by`, qualunque stato, inclusi cinema/prossimamente e sorprese, con zero esplicito. Prima contava solo i film già visti insieme. Un rewatch non moltiplica i film; i film eliminati non sono nel totale, quelli senza autore riconoscibile non sono attribuiti. Media e genere condivisi conservano la loro base di calcolo. Smoke **365/365 PASS**, service worker **12/12 PASS**, sintassi e diff check superati. Chromium con dati fittizi a 320/390 px per N/V: ordine, nomi, oro coerente, colori personali e cancellazione del testo senza perdere il voto, zero errori JS; screenshot ispezionati. Nessuna nuova migration o dipendenza.

Revisione voto personale — Il pulsante «Modifica voto {nome utente}» compare una sola volta nelle azioni della card, sotto il voto insieme quando presente, con dimensioni e sfondo coerenti e colore N/V. Presente anche nella scheda film; sorprese non rivelate protette. Il testo personale è facoltativo anche nelle modifiche: svuotarlo e salvare rimuove solo la recensione, conservando voto, altra persona, voto insieme e date delle serate. Testo omesso dal livello dati conserva la recensione; vuoto esplicito aggiorna anche il mirror legacy dell'autore, per evitare che il testo ricompaia. Nessuna nuova migration. Cache PWA `v41`; smoke **363/363 PASS**, service worker **12/12 PASS**.

Phase 38 — L'utente conferma di aver applicato la migration dei voti decimali su Supabase. Nessuna scrittura sul database reale da questa sessione. Verifica indipendente dei tipi via OpenAPI tentata in sola lettura, ma l'endpoint risponde HTTP 401: stato registrato sulla conferma dell'utente; salvataggio reale su due telefoni da verificare dopo il deploy.

Phase 38 — Voti decimali implementati localmente: campi con tastierino decimale al posto dei menu, scala 0–10 con un decimale facoltativo, punto e virgola accettati. Card, recensioni, storico, modifica e media conservano i valori; voti personali e insieme distinti, zero e legacy preservati. Migration dei tre campi `seen_rating_*` da smallint a numeric con CHECK sui decimi preparata e verificata su PostgreSQL temporaneo, **applicata dall'utente dopo il commit della Phase 38**. Cache PWA `v40`; smoke **358/358 PASS**, service worker **12/12 PASS**. [Specifica e attivazione](PHASE38_DECIMAL_RATINGS.md).

Ripristino pulsante saghe sulle card — «Continua la saga» torna anche nelle card della libreria e dei film visti, oltre che nella scheda dettaglio e nei flussi di scelta. Resta visibile dopo i render e il passaggio a visto; assente per film senza collection nota e sorprese non rivelate. Cache PWA `v39`. Verifica di regressione sul render delle card superata; smoke **352/352 PASS**, service worker **12/12 PASS**.

Revisione Phase 18 — Ticket PNG ridisegnato nel codice locale: locandina protagonista senza distorsione, titolo adattivo in sovrimpressione, intestazione sc(r)occhiaTu, bordo pellicola e talloncino chiaro con perforazione, origine della scelta, data/ora e snack. Match senza percentuale mostra «Match Live»; un'origine assente non viene inventata. Film non programmati mostrano «Da programmare», senza ora fittizia. Poster assente: illustrazione geometrica su gradiente. Il download attende brevemente il font dell'app prima della misura dei testi. Nessuna libreria aggiunta all'app o migration; cache PWA `v36`. Smoke **332/332 PASS**, service worker **12/12 PASS** e controllo sintassi superato. PNG reali 1080×1920 generati e ispezionati con poster, fallback e testi lunghi tramite canvas nativo di verifica temporaneo (font di fallback); download su smartphone ancora da verificare.

Phase 41 — Saghe implementate nel codice locale. «Continua la saga» nelle card della lista e nella scheda film, nel risultato Ruota, nella celebrazione inline del Match e nel hero della serata apre un pannello con i capitoli TMDb in ordine di uscita. Dopo una nuova visione personale/insieme o la conclusione di una serata, il pannello viene proposto solo sul telefono che ha eseguito l'azione; modificare un voto non lo riapre e Realtime non genera suggerimenti. Primo capitolo successivo già uscito e non visto insieme evidenziato solo quando le date lo consentono. Nessun film preselezionato: aggiunta esplicita, metadati recuperati per ID, dedup e UNIQUE esistente, future uscite con `cinema_watchlist`. Film già in lista o visti riconoscibili, sorprese non rivelate protette. Collection con cache in memoria di 15 minuti, timeout, Riprova e protezione dalle risposte obsolete; salvataggi parziali ritentabili, modalità locale esplicita. Nuovo modulo `js/ui/sagas.js`, nessuna migration o dipendenza dell'app. Cache PWA `v38`; smoke **351/351 PASS**, service worker **12/12 PASS**. [Specifica e verifiche](PHASE41_SAGHE.md). Pannello verificato in Chromium a 320/390/768 px con fixture, screenshot ispezionati e zero errori JS; uso su due telefoni da verificare dopo il deploy.

Verifica utente del ciclo precedente — Ticket e temi sono stati pubblicati con push su `main` e l'utente ha confermato di averli testati prima di autorizzare la fase saghe. Le verifiche automatiche e i limiti del ciclo precedente restano documentati qui sotto.

Estensione Phase 34 — Temi automatici implementati localmente prima delle saghe, come richiesto. Cinema Noir → Estate (`cinema`) ed Estate → Inverno (`estate`), con palette conservate. Default (ex Cinema) e VHS sono rimossi dal selettore; rimossa anche la trama VHS. Nuovi temi Pasqua (salvia scura, lavanda, menta e oro tenue) e Capodanno (superfici nere e inserti dorati). Gli otto temi seguono il calendario locale del dispositivo; selezione manuale temporanea fino al prossimo cambio di periodo e pulsante «Automatico» per ripristinare subito il calendario. Ricalcolo all'ingresso, al ritorno nella pagina e ogni minuto quando visibile; la Ruota si ridisegna solo se il tema cambia e dopo l'inizializzazione dei moduli. Una festività trascorsa ad app chiusa fa comunque scadere la scelta precedente. Capodanno (30 dicembre–2 gennaio) ha precedenza su Natale (22 dicembre–6 gennaio). Cache PWA `v37`; smoke **341/341 PASS**, service worker **12/12 PASS** e controlli sintassi superati; nessuna migration o dipendenza aggiunta. Resa visiva su smartphone ancora da verificare.

Priorità richieste — Ticket, temi automatici e saghe implementati localmente. Ticket e temi testati dall'utente dopo il push; saghe da verificare nell'uso reale dopo il deploy.

Home personale e pagine centrate — Saluto dal nome utente configurato, scena di benvenuto e tre card con icone grandi per Match, Ruota e Libreria. Una sezione compatta apre direttamente Visti e recensioni e Calendario; queste viste hanno titolo e navigazione propri. La Libreria conserva i soli filtri Tutti / Da vedere / In programma, ricerca e ordinamento. Il contenitore delle pagine è ora una colonna unica centrata, senza la vecchia griglia laterale. Tutte le uscite interne da Match (`exitMatchView`, inclusi gli «Esci» e la chiusura automatica) tornano alla home, rimuovendo la presence ma conservando sessione e canale. Nessuna modifica al modello dati. Cache PWA `v35`, smoke **330/330 PASS**, service worker **12/12 PASS**; resa visiva su smartphone da verificare.

Revisione home e ricordi condivisi — Home con le tre scelte ingrandite e viste dedicate per Match, Ruota e Libreria, con ritorno alle scelte; la prossima serata resta sopra le scelte quando presente. Ruota e lista non occupano la schermata iniziale. Eliminato il collegamento duplicato «La vostra storia». Il tema è nella fila delle azioni, separato dal gruppo persona/uscita. Il calendario esclude annullate e saltate e colloca le scelte rapide concluse nel giorno locale di `completed_at`. Il voto insieme 0–10 si salva anche senza testo ed è visibile come «I ★ voto/10» in oro nelle card, nella scheda e nello storico. Le modifiche conservano la data e non concludono un rewatch attivo. Ricordi contiene solo recensioni e voti insieme; genere, proponenti e conteggio dei film votati riguardano le visioni condivise. Le statistiche individuali restano un'idea futura. Nessuna migration. Cache PWA `v34`; smoke locale **329/329 PASS**, service worker **12/12 PASS**. Verifica visiva su smartphone ancora da fare.

Navigazione essenziale — «Sorpresa» non occupa più la barra principale: resta disponibile come azione secondaria nel pannello della Ruota. La barra mobile mostra Ricordi e Aggiungi; la funzione e il flusso sorpresa restano invariati. «Ricordi» apre «Il Nostro Cinema» con storico, recensioni e statistiche, ed è leggibile anche su smartphone. Un'eventuale sezione futura per gli extra giocosi è solo un'idea, non implementata. Cache PWA `v33`.

Passata mobile successiva al checkpoint `ef9dba1` — Input, select e textarea usano almeno 16 px su schermi sotto 640 px per evitare lo zoom automatico su iPhone. Filtri della Ruota, apertura dei filtri della libreria, inversione ordinamento e pulsanti dei modali hanno target tattili da almeno 44 px. Le righe dello storico serate sono più leggibili; i modali rispettano l'area sicura inferiore. Il riquadro «Altre serate» compare solo se contiene serate aggiuntive rispetto alla prossima mostrata nel hero. Cache PWA `v31`. Verifica visiva su smartphone ancora da fare.

Aggiornamento navigazione — «Importa» non occupa più un posto nella barra principale: la funzione resta disponibile come link discreto nel form «Aggiungi un Film». Su mobile la barra usa tre azioni: Cinema, Sorpresa e Aggiungi. Cache PWA `v30`.

Aggiornamento recensioni — Il form permette di assegnare o modificare un voto 0–10 insieme al testo, con errori di validazione e salvataggio visibili. La recensione insieme usa `movies.seen_rating_together`, separato da `seen_rating_n/v`. Il luogo facoltativo vive su `movie_nights.location`, quindi ogni rewatch conserva il proprio. Entrambe le migration additive (`database/supabase-migration-step-review-together.sql` e `database/supabase-migration-step-night-location.sql`) sono state applicate dall'utente; le due colonne sono state verificate via REST in sola lettura (HTTP 200). I film già visti espongono l’azione per aggiungere o modificare la recensione insieme; la scheda film la espone per le serate e i film visti. Anche il form «L’ho già visto» collega direttamente alla recensione insieme. Il luogo si corregge nel form della recensione, scegliendo la serata quando esistono rewatch; lo storico lo mostra senza pulsanti di modifica. «Il Nostro Cinema» calcola il voto medio solo dai voti condivisi dei film visti insieme, includendo 0/10 e ignorando i voti personali. Una recensione nuova senza serata programmata crea un evento completato al momento del salvataggio; se una recensione legacy non ha una serata storica, l’aggiunta del luogo crea un evento senza data registrata. Modificare una recensione conserva la data della serata storica e non conclude un rewatch attivo. Cache PWA `v29`. Smoke locale **327/327 PASS**.

Aggiornamento v2.22 — Revisione UI mobile in corso: barra in due livelli con preferenze e persona sopra, azioni di supporto e pulsanti «Sorpresa»/«Aggiungi» con etichette sotto. Il selettore mostra otto atmosfere: Cinema classico, Cinema Noir, VHS e cinque temi stagionali; la scelta resta sul dispositivo (`scorochiatu_theme`). Superfici, accenti e colori della Ruota seguono il tema; VHS aggiunge una trama analogica statica. Dashboard e Ruota hanno una gerarchia visiva più netta; i comandi principali delle card raggiungono 44 px. Le sezioni vuote della libreria hanno messaggi e azioni specifiche, prima passata della Phase 29. Prima passata anche sulla Phase 12: scelta N/V e PIN con nuova scena cinematografica, focus e stato errore chiari, stessa sessione e PIN esistenti. La scheda film ora ha locandina e contenuti ordinati; Match Live mostra il progresso e limita l'altezza del poster su mobile. Prima passata Phase 30: Match non disponibile con riprova e dettagli tecnici richiudibili, avviso esplicito per dati locali con riprova manuale. Hero serata con data e countdown separati quando l'ora è nota. Cache PWA `v26`. Smoke locale **318/318 PASS**, verifica service worker **12/12 PASS**. La resa visiva e il tocco su smartphone reali restano da verificare; le altre fasi di revisione grafica non sono ancora completate.

Repo: `NikyBebba/sc-r-occhiaTu` · Deploy: `sc-r-occhia-tu.vercel.app` · Stack: HTML/Tailwind (Play CDN)/JS vanilla senza build step, Supabase (Postgres + realtime, fallback localStorage), TMDb (+OMDb opzionale), supabase-js v2 da CDN, Font Awesome CDN

Changelog v2.14: Phase 8.1 implementata — le Movie Card mostrano lo stato di visione N/V e il tasto personale "L'ho già visto"; la vecchia UI like/dislike è rimossa dalle card. Estensione: annullamento personale, voto 0–10 obbligatorio e recensione facoltativa al clic, tre recensioni distinte N/V/insieme; la migration `database/supabase-migration-step8.sql` è stata applicata e le cinque nuove colonne sono state verificate via REST (HTTP 200). Phase 8.2 implementata: CTA Match Live separata e prioritaria nella dashboard, navigazione libreria compatta su mobile, vista Match dedicata. Phase 19 implementata: la prossima serata è un hero in cima alla dashboard con poster, conto alla rovescia, snack e azioni esistenti. Snack personalizzato nel programma serata, riutilizzabile attraverso lo storico condiviso. Phase 20 implementata: Tonight Mode deriva dalle serate attive di oggi e valorizza il hero della serata con un'azione per la recensione insieme. Phase 21 implementata: "Il Nostro Cinema" mostra uno storico visuale delle serate concluse, una card per evento anche nei rewatch. Il flusso swipe resta invariato.

Aggiornamento successivo: la ricerca mostra anche film omonimi. Dopo la scelta della locandina, l'aggiunta mostra un avviso solo se l'ID TMDb è già presente; un altro film con lo stesso titolo può essere salvato. L'import dalla UI salta gli ID TMDb duplicati nel riepilogo. Per i risultati senza ID TMDb non è disponibile un identificativo persistito con cui fare un controllo affidabile. `database/supabase-migration-step9.sql` aggiunge un indice UNIQUE parziale per impedire anche i duplicati da inserimenti simultanei: **applicata in Dashboard dall'utente**. Preflight live in sola lettura prima della migration: 93 ID TMDb, zero duplicati.

Aggiustamento precedente: il risultato della Ruota apre la scheda film già esistente (trama e trailer). Una sorpresa non rivelata resta nascosta anche nel risultato; la scheda diventa accessibile dopo la rivelazione dalla lista. Stato vuoto delle serate semplificato. Smoke locale a questo punto: **292/292 PASS**.

Phase 8.3 implementata nel codice locale: opzione «Al cinema / prossimamente» all'aggiunta, badge e toggle in libreria, esclusione da Ruota e Match Live (anche su deck già aperto), programmazione consentita. **Migration Step 10 applicata dall'utente; colonna verificata via REST in sola lettura (HTTP 200).** Smoke locale a questo punto: **296/296 PASS**.

Phase 22 implementata nel codice locale: «Il Nostro Cinema» raggruppa le serate concluse per mese, con una card per evento e date derivate da `night.date` o, per i quick pick, da `completed_at` locale. Le recensioni restano senza data in una sezione separata. Cache PWA `v12`. Smoke locale: **298/298 PASS**; prova mobile su due telefoni ancora da eseguire.

Correzione libreria: filtro sempre visibile «Tutti i film, anche al cinema» / «Solo streaming». Il secondo esclude i film segnati manualmente per il cinema; non controlla la disponibilità reale sui provider. L'inserimento cinema rifiutato per colonna assente mostra un errore senza creare un film locale temporaneo. I tentativi precedenti alla migration vanno ripetuti. Cache PWA `v13`; smoke locale **300/300 PASS**.

Phase 23 implementata nel codice locale: «Il Nostro Cinema» mostra serate concluse, film distinti visti, serate di rewatch e film votati da entrambi. I primi tre conteggi derivano da `movie_nights` completate; l'ultimo dai voti personali sui film, zero incluso. Nessuna nuova percentuale di compatibilità o migration. Cache PWA `v14`; smoke locale **302/302 PASS**. [Definizioni e limiti](PHASE23_MOVIE_CHEMISTRY.md).

Decisione Phase 24: la sezione «Why this movie?» e il flag cult manuale sono scartati. Nel dettaglio del film compare solo un'indicazione discreta degli **Oscar vinti** se OMDb li dichiara esplicitamente in `Awards` (`Won N Oscars`); candidature e totali anonimi non diventano badge. L'IMDb ID viene risolto dal TMDb ID all'apertura della scheda, con cache in memoria e nuovo tentativo dopo errori di rete; nessuna migration. Altri premi e fonti esterne potranno essere valutati in una fase futura. Cache PWA `v15`; smoke locale **306/306 PASS**. Il percorso live completo TMDb→OMDb è stato tentato, ma OMDb è andato in timeout; letture dirette precedenti del campo `Awards` hanno confermato il formato di vittorie e nomination.

Phase 25, primo intervento: apertura e chiusura della scheda film con transizione condivisa dalla card della libreria, tramite View Transitions API. Senza supporto, con movimento ridotto o se la card è stata ricostruita, il modale usa l'apertura/chiusura immediata esistente. La scheda aperta dalla Ruota resta immediata. Nessuna migration. Cache PWA `v16`; smoke locale **307/307 PASS**; resa visiva da verificare su smartphone/browser reali.

Phase 27 — Haptic Manager implementata localmente: pulsante nel pannello Ruota disponibile solo se il browser espone `navigator.vibrate`, preferenza opt-in salvata sul singolo dispositivo (`scorochiatu_haptics`), segnali brevi per swipe Match registrato, avvio Ruota e risultato. Nessuna vibrazione con pagina nascosta; API assente o errore di vibrazione restano silenziosi. Nessuna migration. Cache PWA `v17`; smoke locale **308/308 PASS**; sensazione tattile da verificare su un telefono compatibile.

Phase 26 — Audio Manager implementata localmente: pulsante opt-in nel pannello Ruota, preferenza del singolo dispositivo (`scorochiatu_audio`), note sintetizzate con Web Audio API a volume contenuto per Like/Nope registrati, avvio/esito Ruota e Match Reveal. Il contesto audio nasce solo dopo l'attivazione; viene sospeso quando i suoni sono spenti e ripreso al riavvio. Browser senza API e pagina nascosta restano silenziosi. Nessuna libreria, asset audio o migration. Cache PWA `v18`; smoke locale **309/309 PASS**; ascolto e volume da verificare su telefoni reali.

Phase 28 — Ciak Loader e skeleton implementata localmente: al primo ingresso, dopo 160 ms di attesa, un ciak compare sotto la navbar e due sagome di movie card nella libreria. Il render cancella sempre il timer e rimuove lo stato `aria-busy`, così una risposta rapida non produce flash tardivi; il movimento ridotto usa la regola globale già presente. Una lettura iniziale che rigetta usa il mirror locale e termina il caricamento. Nessuna migration. Cache PWA `v19`; smoke locale **310/310 PASS**; resa visiva da verificare su smartphone.

## Quadro rapido — dove siamo

| Area | Stato verificato nel codice | Limite attuale |
| --- | --- | --- |
| Scelta del film | Match Live a swipe, Ruota e proposta diretta; ticket PNG scaricabile | Origine del ticket solo in memoria, persa al refresh |
| Serata | `movie_nights` separa film ed evento; proposte, conferme, Tonight Mode e snack personalizzati | Le scelte rapide precedenti a `confirmed_at` non attivano retroattivamente Tonight Mode |
| Film e recensioni | Indicatori N/V/insieme, voti personali e condiviso 0–10, tre testi distinti, luogo facoltativo per serata; aggiunta con avviso duplicati | La recensione insieme è un testo per film; il luogo resta per evento |
| Il Nostro Cinema | Serate concluse per mese, una card per evento anche nei rewatch; voto medio dei soli film visti insieme | Nessun archivio dei PNG generati |

Verifiche locali dell'ultima revisione: `node scripts/smoke.js` **369/369 PASS**, `node scripts/verify-sw.js` **12/12 PASS**, `node --check` sui moduli JS modificati senza errori. Le migration Step 8, Step 9, Step 10, voto condiviso e luogo per serata sono state applicate; le due nuove colonne sono state verificate via REST in sola lettura (HTTP 200). Il comportamento dell'ultimo ciclo non è stato ricontrollato manualmente su due telefoni o su Vercel.

Regola repository: database locali, dump e backup sono esclusi da Git. I file SQL in `database/` descrivono schema e migration, senza esportazioni dei dati.

## Criterio per le prossime idee

Tono UI: cinematografico, giocoso, personale e leggero, per tutta l'app (inclusi login e home). Il prodotto non deve sembrare esclusivamente romantico o troppo serio; usare piccoli riferimenti a sala, ciak, titoli di coda, poltrone e popcorn senza battute forzate. Evitare l'insistenza continua su «noi», «nostro» e «insieme»: la condivisione è già evidente dalle azioni e dai voti N/V/N+V. Per Ricordi usare «Titoli di coda», «In numeri» con icona, «Serate concluse», «Dopo il film». Conservare «insieme» o «condiviso» solo dove distingue davvero i flussi di visione/voto, mantenendo chiari comandi ed errori.

L'utente apprezza aggiunte come «Continua la saga», il ticket più curato e le atmosfere automatiche: funzioni che collegano scelta, film, serata e ricordo e rendono l'app personale e piacevole da usare in due. Per le prossime proposte privilegiare azioni utili nel momento giusto, pochi passaggi e una cura visiva coerente. Conservare le azioni apprezzate anche nelle card, dove sono facilmente scopribili; evitare di nasconderle durante le rifiniture.

## Prossimo lavoro

Priorità aggiornata: pubblicare il frontend aggiornato (migration Phase 38 applicata dall'utente), poi verificare tastierino, voti senza recensione e salvataggi sui due telefoni insieme alle saghe. Ticket e temi sono già stati testati dall'utente dopo il push. Poi riprendere gli altri step della roadmap. Resta aperta la revisione UI/UX mobile delle viste principali: verificare disposizione e temi su smartphone, poi rifinire gli stati d'errore e la serata senza cambiare i loro flussi dati. I controlli su due telefoni e gli interventi tecnici successivi restano attività separate.

### Cose da sistemare prima dei prossimi step

Ticket e temi automatici sono **implementati e testati dall'utente dopo il push**. Le saghe sono **implementate e verificate localmente, da provare su due telefoni dopo il deploy**.

1. **Ticket PNG più accattivante — revisione della Phase 18, implementata localmente.** Il ticket giudicato troppo spoglio ora ha locandina a copertura, titolo adattivo, intestazione del brand, cornice pellicola, talloncino chiaro perforato e due sedute stilizzate. Origine, data/ora e snack hanno aree separate; testi lunghi limitati con ellissi e poster mancante con fallback grafico. Conservati export PNG e origine solo in-memory. PNG verificati con poster reale, Match, Ruota, proposta diretta, titolo lungo e parola senza spazi. Restano la valutazione estetica dell'utente e la prova del download su smartphone.
2. **Saghe — Phase 41 implementata localmente.** [Specifica](PHASE41_SAGHE.md). Le collection TMDb note aprono il pannello «Continuiamo la saga?» con ordine di uscita, prossimo capitolo riconoscibile, stato già in lista/visto e selezione esplicita dei capitoli da aggiungere. Suggerimento dopo una nuova visione, senza ripetizioni nelle modifiche e senza trigger da Realtime. Metadati completi recuperati per ID, dedup anche in concorrenza, futuri segnati per il cinema, sorprese protette; errori/retry e salvataggi parziali visibili. Nessuna modifica allo schema. Prova reale su due telefoni ancora da fare.
3. **Temi automatici per periodo — estensione della Phase 34, implementata localmente.** Nomi e palette: Estate (`cinema`, ex Cinema Noir), Inverno (`estate`, ex Estate), Primavera, Autunno, Halloween, Natale, Pasqua e Capodanno. Default (`classic`, ex Cinema) e VHS rimossi; Capodanno usa nero e oro. Il calendario usa il giorno locale del dispositivo, senza richieste di rete. Le finestre concordate con l'utente sono inclusive:
   - **Capodanno:** 30 dicembre–2 gennaio, con precedenza su Natale.
   - **Natale:** 22 dicembre–6 gennaio, esclusi i quattro giorni di Capodanno.
   - **Halloween:** 27 ottobre–2 novembre.
   - **Pasqua:** Venerdì Santo–Pasquetta, quattro giorni (da due giorni prima a un giorno dopo la domenica di Pasqua). Data calcolata annualmente con l'[algoritmo gregoriano USNO](https://aa.usno.navy.mil/faq/easter).
   - **Stagioni:** Primavera marzo–maggio, Estate giugno–agosto, Autunno settembre–novembre, Inverno dicembre–febbraio; le festività hanno precedenza. Default non è più selezionabile; una data non valida usa Inverno come fallback.
   - **Ordine del selettore:** Primavera, Estate, Autunno, Inverno, poi Pasqua, Halloween, Natale, Capodanno. Nessuna intestazione o scritta per distinguere stagioni e festività; solo ordine delle card. Simboli identificativi: germoglio, sole, foglia, fiocco di neve, uovo, fantasma, albero e calici; anche il pulsante nella barra mostra il simbolo del tema attivo.
   - **Scelta manuale:** locale e temporanea fino al successivo periodo; salvata in `scorochiatu_theme_override` con identificativo del periodo. Il vecchio `scorochiatu_theme` resta come mirror del tema attivo e non blocca l'automatismo, inclusi vecchi valori VHS/Default. Capodanno attraversa il 1° gennaio come unico periodo; Natale prima e dopo Capodanno sono periodi separati; rientrare dopo una festività trascorsa fa scadere una scelta della stagione precedente. «Automatico» ripristina subito il calendario.
   - **Verifiche:** date limite, anno bisestile, Pasqua mobile anche tra marzo/aprile, scadenza manuale, storage assente/corrotto, inizializzazione in head, cambio a mezzanotte e ritorno nella pagina. Palette Pasqua/Capodanno e selettore restano da provare visivamente su smartphone.

1. **Phase 8.3 — Film al cinema e prossimamente**: [specifica e stato](PHASE8_3_CINEMA_WATCHLIST.md). Implementata localmente; migration Step 10 applicata, verificare su due telefoni dopo il deploy.
2. **Phase 22 — Timeline per mese**: [specifica e stato](PHASE22_TIMELINE.md). Implementata localmente; verificare il modale su smartphone dopo il deploy.
3. **Phase 23 — Ricordi**: [definizioni e revisione](PHASE23_MOVIE_CHEMISTRY.md). Riepilogo compatto a quattro riquadri, da verificare su due telefoni dopo il deploy.
4. **Scheda film — Oscar vinti**: implementata localmente con lettura OMDb su richiesta. Verificare su due telefoni dopo il deploy; nessuna sezione «Why this movie?».
5. **Phase 25 — Transizione card/scheda**: implementata localmente con fallback immediato; verificare apertura e chiusura su smartphone dopo il deploy.
6. **Phase 27 — Vibrazione facoltativa**: implementata localmente; provare toggle, swipe e Ruota su un telefono con Vibration API dopo il deploy.
7. **Phase 26 — Suoni facoltativi**: implementata localmente; verificare ascolto e volume su telefono dopo il deploy.
8. **Phase 28 — Ciak e skeleton**: implementata localmente; verificare il primo ingresso con rete lenta su smartphone dopo il deploy.
9. **Fasi successive**: Hot Picks richiede dati TMDb aggiuntivi e una migration autorizzata; altre microinterazioni e la verifica visiva dei temi su smartphone restano da valutare.

Changelog v2.13: STEP 4 completo (Phase 15 Ruota→serata, Phase 16 Match % di sessione, Phase 17 Match Reveal, Phase 18 Final Ticket Generator). Nessun campo/migration nuovo: origine del Ticket tracciata solo in-memory (`markTicketOrigin`/`ticketOriginOf`), scelta esplicita per restare nei vincoli di questo giro — da rivalutare se in futuro servirà uno storico persistito dei ticket (vedi Note aperte). Smoke passato da 245 a 262 test lungo lo step.

---

## Glossario (usare sempre questi termini)

- **Scelta**: il momento in cui si decide un film. Ha tre sorgenti: **Match Live**, **Ruota**, **Proposta diretta**.
- **Match Live**: sessione sincrona N ↔ V a swipe Tinder-like. **Questa logica è già completa e non deve essere modificata dalle nuove fasi di redesign.** Solo qui esiste il concetto di "match" e la **Match %** (agreement% di sessione, formula definita e implementata in Phase 16: film con giudizio identico / film risolti da entrambi).
- **In programma**: film con una serata (`movie_nights`) proposta/confermata. Key interna del tab: `tonight` (solo label cambiata).
- **Serata "Stasera"**: quick pick, serata confermata con `date: null`.
- **Prossimo Film**: il hero dà priorità alla serata attiva di oggi (`tonightPick()`), poi alla più vicina nel tempo (`nextMoviePick()`).
- **Ticket**: artefatto finale della Scelta (Phase 18, implementato). Mostra la Match % se l'origine è Match Live, "Scelto con la Ruota" se da Ruota, "Proposto da N/V" se da proposta diretta. Origine tracciata solo in-memory per la sessione di navigazione corrente, non persistita.

---

## Stato attuale del codice (test locale; verificare il deploy separatamente)

- Login differenziato N/V via PIN individuale, badge utente, logout
- CRUD film, import bulk (JustWatch non ha export ufficiale → copia manuale); l'aggiunta singola cerca anche titoli omonimi e blocca con avviso soltanto l'ID TMDb già presente, l'import dalla UI salta gli ID duplicati nel riepilogo
- **PWA**: manifest, icone (192/512/maskable/apple-touch, **provvisorie**, da sostituire con asset reale), service worker con cache app-shell versionata (`scorochiatu-shell-v44`), whitelist esplicita che esclude sempre Supabase/TMDb/OMDb/poster/YouTube dall'intercettazione, toast di aggiornamento non invasivo
- **Design system** (Foundation): token CSS (`--color-*`, `--radius-*`, `--shadow-*`, `--duration-*`, `--ease-*`, `--fs-*`), tipografia Plus Jakarta Sans, otto temi con anteprima e calendario automatico locale (Estate, Inverno, Primavera, Autunno, Halloween, Natale, Pasqua e Capodanno), scelta manuale temporanea, `.glass-panel`/`.glass-card`, accessibilità baseline (focus-visible, ARIA su modali/segmented, `prefers-reduced-motion` globale). Le varianti cromatiche seguono le superfici principali e la Ruota; verifica visiva su smartphone ancora da fare.
- **Header/nav**: barra mobile con marca e gruppo persona/uscita sopra, tema/Ricordi/Aggiungi sotto. «Ricordi» apre «Il Nostro Cinema» e ha testo visibile anche su mobile. «Sorpresa» è un'azione secondaria nel pannello Ruota; «Importa» è un link nel form di aggiunta singola. La home ospita tre scelte ingrandite per Match, Ruota e Libreria, aperte in viste dedicate; la libreria filtra Tutti / Da vedere / In programma, mentre Calendario e Visti e recensioni hanno accessi dalla home e viste dedicate. Match e Libreria occupano la larghezza disponibile; ogni modalità permette di tornare alle scelte.
- **Match CTA**: stati idle/online/live letti solo da `matchChannelStatus`/`lobbyPresenceState`/`dbMode`/`currentTab` (nessuno stato duplicato); si aggiorna a ogni render, non su ogni evento presence in tempo reale se si è fermi su un altro tab (limite noto, accettato)
- **Home CTA "Cosa guardiamo?"**: Match Live apre la sua vista dedicata; Ruota e Sfoglia la lista portano alle rispettive sezioni, senza nuovi stati di scelta
- **Movie Card "biglietto cinema"** (`.movie-ticket`): bordo con effetto perforato, scrim sul poster, badge paternità come person-pill, rating "holographic" quando presente. Il footer su `watched` ora offre «Modifica recensione insieme»; lo status ignoto non mostra un footer vuoto. Gli indicatori N/V sono neutri, blu/rosa per visioni singole o separate, oro per la visione insieme. «L'ho già visto» apre il voto personale e collega alla recensione insieme. I voti 👍/👎 legacy non compaiono più sulle card.
- **Search & Filters** restyling su token (`.field`), stessa logica invariata (id/handler intatti)
- **Ricordi / Titoli di coda**: quattro riepiloghi (voto medio, voto più alto, genere più visto e film aggiunti N/V), poi storico visuale delle serate concluse da `movie_nights` raggruppato per mese, con una card per evento e N+V accanto al voto; infine voti/recensioni condivisi senza etichetta ripetuta per riga. Media con zero e fallback legacy, senza voti personali; voto massimo tra i condivisi visibili con titolo o numero di ex aequo. Film aggiunti su tutta la libreria corrente, senza raddoppio dai rewatch. Nessun nuovo conteggio o data scritta sul database.
- **Movie Detail** (Phase 9): modale con overview, cast (`cast_names`), meta, rating e Oscar vinti verificati da OMDb su richiesta; apertura al click sull'area "morta" della card (guardia esplicita esclude bottoni/link interni); **Ambient Poster** (Phase 9.1: sfondo blur+overlay dal poster, fallback gradiente se poster assente); **Poster-adaptive colors** (Phase 9.2: colore dominante estratto via canvas nascosto con `crossOrigin="anonymous"`, verificato CORS ok su TMDb/OMDb, fallback silenzioso a bordo indigo standard se l'estrazione fallisce, mai un errore in console); sorpresa vista dall'altra persona → click sulla card resta inerte, nessuno spoiler
- **Ruota → programmabile** (Phase 15): il vincitore mostra i bottoni "Stasera"/"Programma" (riuso di `quickTonightUI`/`scheduleMovie`, nessun aggancio automatico) e l'accesso alla scheda film con trama/trailer; per una sorpresa ancora nascosta invita prima alla rivelazione dalla lista. `lockWheelWinner` risolto/rimosso in questo giro (dead code non più presente)
- **Match % di sessione** (Phase 16): `sessionAgreement(swipes, moviesList)` in `match.js` — agreement% = film con giudizio identico (doppio-like O doppio-dislike) / film risolti da entrambi; soglia 3 risposte per un dato "attendibile" (sotto soglia mostrato comunque con nota), placeholder "…%" se denominatore 0, nessuna % su sessione `closed`; calcolo client-side, nessuna migration, nessuna modifica a `votes`
- **Match Reveal** (Phase 17): celebrazione full-screen con tear CSS-only e coriandoli (`fireConfetti()`, già esistente), si riapre per sessione nuova sullo stesso film o per un secondo match nella stessa sessione, non si riapre su semplice re-render/resync; reset esplicito allo "Esci"
- **Final Ticket Generator** (Phase 18, composizione grafica rivista nel ciclo v2.27): `js/ui/ticket.js`, export PNG 1080×1920 via canvas nativo (nessuna libreria), poster con `crossOrigin="anonymous"` (stesso pattern di Phase 9.2), fallback a gradiente se poster assente/CORS fallito; timbro per origine — Match Live → Match %, Ruota → "Scelto con la Ruota", proposta diretta → "Proposto da N/V"; **origine tracciata solo in-memory** per la sessione di navigazione corrente (`markTicketOrigin`/`ticketOriginOf`), nessun campo persistito su `movie_nights`
- Hero della prossima proiezione in cima alla dashboard (poster, countdown con ora valida, snack, conferma/rifiuto/annullamento secondo lo stato); se esiste una serata attiva di oggi assume lo stato Tonight Mode e offre «Voto N+V» o «Segna serata vista» per la serata confermata. Nascosto se non c'è una serata o nelle viste Match/Calendario
- Serate come entità `movie_nights` (proposed → confirmed → completed/cancelled/skipped) con mirror legacy su `movies`
- Conferma serata solo sulla data specifica, non sull'aggiunta del film; il quick pick "Stasera" crea una serata già confirmed (atto unilaterale, comportamento storico)
- Tracking visto N / V / insieme: `watched_by` e le recensioni alimentano gli indicatori; la visione insieme porta il film a `watched` e completa la serata, mentre le visioni singole restano proponibili per rewatch
- `votes` legacy: mantenuti per compatibilità, ma non rappresentati nella UI delle Movie Card né usati per il nuovo stato di visione. `movies.watched_by` accumula chi ha visto il film; `review_by`/`review_text`/`rating` restano come fallback storico. `seen_rating_n/v` sono i voti personali; `seen_rating_together` è il voto condiviso, tutti numeric 0–10 con un decimale e zero valido (migration Phase 38 applicata dall'utente). `review_text_n/v/together` sono tre testi indipendenti. Il luogo facoltativo sta in `movie_nights.location`, distinto per ogni rewatch; si modifica dal form della recensione scegliendo la serata. Le migration aggiuntive sono applicate e le colonne verificate via REST.
- **Saghe (Phase 41)**: `js/ui/sagas.js` gestisce collection su richiesta, capitoli in ordine di uscita, suggerimento dopo nuova visione e aggiunta esplicita; nessuna nuova tabella/colonna.
- Ricerca (titolo, regista, generi), filtri (disponibilità manuale cinema, proposto da, genere, piattaforma), sort per anno, anno/regista in card
- Generi reali da TMDb in `movies.genres text[]`, nessun residuo di `genres.js`/mood picker
- **`movies.overview` e `movies.cast_names text[]`** (migration step7, backfill completato: 131/131 film con `tmdb_id`, 129/131 con overview — 2 senza traduzione it-IT su TMDb — 131/131 con cast_names, 1 caso con solo 2 nomi); popolati anche per i nuovi inserimenti (app + import CLI)
- Ruota della fortuna con ordine casuale ad ogni sessione e filtro genere; il vincitore può essere scelto per "Stasera" o "Programma" (Phase 15)
- **Match Live** completo: lobby con presence, sessioni swipe Tinder-like con deck seedato, match detection, replay; tabelle `swipe_sessions` + `swipes`; realtime a 2 canali. Non scrive su `votes`. **Non modificare questa logica nel redesign: i voti legacy delle card non entrano nel Match Live, che continua a usare gli swipe. Il pollice decorativo nella home non cambia i flussi.**
- Veto settimanale (1/persona/settimana), rimovibile solo dal proprietario, realtime su vetoes
- Snack picker con opzione personalizzata (salvata in `movie_nights.snack`; gli snack già usati tornano fra le scelte su entrambi i telefoni, senza nuova tabella)
- Modalità sorpresa (azione secondaria nella Ruota, modale, `surprise_by`, blur CSS, badge "tua sorpresa")
- Smoke test locale corrente: **369/369 PASS**; `scripts/verify-sw.js`: **12/12 PASS**. Il percorso storico dei test precedenti resta nella cronologia Git.

---

## Fuori dal piano (valutate e scartate)

- ❌ Mood picker / `genres.js` (eliminati, commit a98a43d)
- ❌ Nessun altro elemento scartato attivo (Snack picker e Modalità sorpresa sono implementati, non scartati)
- Nota: la variante "skip animazione, output diretto" della Ruota (Phase 15) resta un'idea futura non prioritaria

---

## Decisioni prese e già applicate

1. **Match % solo per Match Live.** Il widget stats "Match sui gusti" è stato sostituito dal conteggio per autore (`movies.added_by`), ora "Film aggiunti" sull'intera libreria corrente. Il vecchio badge card "Match!/Gusti diversi" derivato da `votes` è stato rimosso nella Phase 8.1 insieme alla vecchia UX asincrona.
2. **Ruota → programmabile.** Fatto (Phase 15): il vincitore mostra le azioni "Stasera"/"Programma", `lockWheelWinner` non più dead code.
3. **Tonight Mode.** Implementato: si attiva solo con una serata attiva di oggi (`date = oggi` o quick pick "Stasera" con `confirmed_at` di oggi). I quick pick nuovi scrivono `confirmed_at` al momento della scelta.
4. **Phase 24 scartata**: il dettaglio mostra solo gli Oscar vinti verificabili; il flag cult manuale non viene introdotto.
5. **Overview/cast salvati come colonne** (non fetch on demand), per servire sia Phase 9 sia la futura Phase 36 (Poster Flip) senza rifare il lavoro. Fatto: migration step7 + backfill.
6. **Detail come modale** (non drawer, non pagina a sé), coerente con gli altri modali esistenti. Fatto: Phase 9.
7. **Sorpresa nel dettaglio**: per l'altra persona il click sulla card resta inerte, nessuna apertura del modale. Fatto.
8. **Colore estratto dal poster (Phase 9.2) solo decorativo perimetrale** (bordo/glow); il testo resta sempre su `--color-testo-1`, mai colorato dinamicamente. Fatto.
9. **Match %: formula definita e implementata** (Phase 16): giudizio identico (like+like o dislike+dislike) / risolti da entrambi. Include volontariamente i doppio-dislike ("gusti in comune", non solo "cosa piace a entrambi") — scelta di prodotto esplicita, non solo tecnica.
10. **Origine del Ticket: solo in-memory, Option A.** Nessun campo `origin` persistito su `movie_nights`: lo storico Phase 21 rappresenta le serate concluse senza inventare l'origine dei PNG. Se in futuro servirà un archivio dei ticket generati, rivalutare persistenza di file e origine con una fase dedicata.

---

## Ordine di implementazione — 9 Step

### ✅ STEP 1 — Foundation (COMPLETO)
- Phase 0 — Typography (Plus Jakarta Sans, pesi 300–800) ✅
- Phase 1.1 — Design Tokens (CSS variables) ✅
- Phase 1.2 — Cinema Classic ✅
- Phase 1.3 — Palette temi stagionali — token definiti in `[data-theme]`, ora selezionabili dal controllo nella barra; rifinitura visiva dei singoli componenti ancora in corso
- Phase 13 — Glassmorphism (`.glass-panel`, `.glass-card`) ✅ (`.glass` mantenuto come alias retrocompatibile)
- Phase 31 — Accessibility baseline ✅

### ✅ PWA (COMPLETA)
- `manifest.json`, icone (**provvisorie**), service worker con whitelist esplicita, cache versionata (`v44` al checkpoint corrente), toast di aggiornamento ✅
- Verificato: nessuna richiesta Supabase/TMDb/OMDb/poster/YouTube passa mai dalla cache (nessun `respondWith` su quei domini)

### STEP 2 — Core Layout (Phase 8.2 implementata)
- Phase 2 — Architettura header/nav (filtri ≠ azioni) ✅
- Phase 3 — Logo + Match Live CTA ✅ (stati idle/online/live da fonte unica)
- Phase 4 — Segmented Control con pillola animata ✅
- Phase 5 — Search & Filters restyling ✅ (logica invariata)
- Phase 6 — Home CTA "Cosa Guardiamo?" ✅
- Phase 7 — Statistics Widgets ✅ (4° widget ora "Film aggiunti", su tutta la libreria corrente)
- Phase 8 — Movie Card / Cinema Ticket ✅ (+ bugfix footer vuoto su watched/ignoto)
- **Phase 8.1 — Movie Card Viewing Status** ✅: sostituiti 👍/👎 e i badge derivati dal vecchio voto asincrono con due indicatori N/V. N sempre a sinistra, V sempre a destra: neutri se nessuno ha visto; N blu se visto da N; V rosa se visto da V; blu+rosa se visti separatamente; entrambi oro se visto insieme. «L'ho già visto» richiede un voto personale 0–10 e offre una recensione facoltativa; l'annullamento rimuove i dati personali segnati. N, V e insieme hanno tre testi distinti; il form della recensione permette di modificare voto e testo, con voto condiviso distinto dai personali. Match Live invariato. Migration Step 8 e migration del voto condiviso applicate, colonne verificate via REST.
- **Phase 8.2 — Dashboard & Navigation Redesign** ✅ nel codice: "Cosa guardiamo?" occupa l'inizio della dashboard con Match Live come CTA principale e Ruota/Libreria come ingressi separati. Le cinque viste della libreria usano un select nativo su mobile e il segmented control su desktop; Match non è più una pill. Entrando nel Match la sidebar si nasconde, la vista usa tutta la larghezza e un pulsante torna al tab precedente. Restano invariati store, ruota, swipe, serate e tracking visto.
- **Phase 8.3 — Film al cinema e prossimamente** ✅ nel codice locale: badge e opzione manuale all'aggiunta, libreria e programmazione sì, Ruota e Match Live no. Filtro libreria «Tutti» / «Solo streaming» basato sul flag manuale. [Specifiche e stato del deploy](PHASE8_3_CINEMA_WATCHLIST.md); migration Step 10 applicata in Supabase.

### ✅ STEP 3 — Movie Detail (COMPLETO)
- Phase 9 — Detail modale ✅
- Phase 9.1 — Ambient Poster ✅
- Phase 9.2 — Poster-adaptive colors ✅
- Dati: `overview`/`cast_names` su `movies`, migration step7 + backfill completati ✅

### ✅ STEP 4 — Core Experience (COMPLETO)
- Phase 15 — Ruota → serata ✅ (bottoni Stasera/Programma sul vincitore, riuso funzioni esistenti, nessun aggancio automatico)
- Phase 16 — Match % di sessione ✅ (`sessionAgreement()`, client-side, nessuna migration)
- Phase 17 — Match Reveal ✅ (full-screen, tear CSS-only, coriandoli riusati, reset esplicito allo Esci)
- Phase 18 — Final Ticket Generator ✅ (canvas nativo 1080×1920, origine solo in-memory; revisione grafica v2.27 implementata, valutazione estetica e download mobile da verificare)

### STEP 5 — Home Intelligence
- Phase 19 — Hero "Prossimo Film / La nostra serata" ✅: usa `nextMoviePick()` (con priorità alla serata di oggi in Phase 20) e le azioni serata già esistenti; nessuna nuova migration. La CTA di scelta resta il primo elemento quando non c'è una serata.
- Phase 20 — Tonight Mode ✅ nel codice: serata attiva datata oggi o quick pick confermato oggi; il hero mostra prima la serata odierna con atmosfera oro e azione "Recensione insieme" se confermata. Nessuna migration.
- Phase 21 — "Il Nostro Cinema" ✅ nel codice: il modal unisce storico visuale delle serate completate, statistiche e recensioni. Le card hanno stile biglietto ma non pretendono di essere PNG archiviati; l'origine dei ticket resta in-memory. Nessuna migration.
- Phase 22 — Movie Timeline (per mese) ✅ nel codice locale: gruppi per mese da serate completate, recensioni separate senza data; nessuna migration
- Phase 23 — I nostri numeri ✅ nel codice locale: quattro conteggi retrospettivi da serate completate e voti condivisi, senza nuova percentuale di compatibilità
- Phase 24 — «Why this movie?» scartata; nessuna nuova sezione. Oscar vinti nel dettaglio film ✅ nel codice locale; altri premi solo dopo verifica di fonti future.

### STEP 6 — Cinematic UX
- Phase 10 — Hot Picks. **Dipendenza:** servono `popularità`, `vote_average`, data uscita completa, oggi non salvati (nuova migration se si vuole procedere)
- Phase 11 — Dynamic Island — allineare a "serata in programma" e alla Tonight
- Phase 12 — Login Experience (prima passata visuale scelta N/V e PIN completata; altre rifiniture da verificare su smartphone)
- Phase 14 — Film Grain
- Phase 25 — Shared Element Transitions (card libreria ↔ scheda film ✅ nel codice locale; altri passaggi non definiti)

### STEP 7 — Themes
- Phase 32 — Cinema Mode (palette ex Cinema Noir ora denominata Estate; ID `cinema` conservato, verifica visiva su smartphone da fare)
- Phase 33 — VHS Mode rimossa su richiesta dell'utente nel ciclo v2.28; sostituita da Pasqua, senza trama analogica
- Phase 34 — Seasonal Polish (prima applicazione dei token e selettore completati; rifinitura visiva su tutte le viste ancora da fare)
- Estensione Phase 34 — Temi automatici, nomi concordati, Pasqua al posto di VHS e Capodanno nero/oro al posto di Default: implementati localmente, calendario e preferenze verificati; prova visiva su smartphone da fare (vedi «Cose da sistemare prima dei prossimi step»).

### STEP 8 — Micro-interactions
- Phase 26 — Audio Manager ✅ nel codice locale (opt-in per dispositivo; Match e Ruota)
- Phase 27 — Haptic Manager ✅ nel codice locale (opt-in per dispositivo; Match e Ruota)
- Phase 28 — Ciak Loader (+ skeleton) ✅ nel codice locale (primo caricamento della libreria)
- Phase 29 — Empty States (prima passata nelle viste della libreria e nei risultati dei filtri; altre viste da rifinire)
- Phase 30 — Error States (prima passata su Match, errore aggiunta e connessione locale; altre azioni da rifinire)

### STEP 9 — Future
- Phase 35 — Lightweight Gamification (Awards, no leaderboard)
- Phase 36 — Poster Flip (dati `cast_names`/`overview` ora pronti da Step 3)
- Phase 37 — Advanced Recommendation
- Phase 38 — Voti decimali da tastierino ✅ nel codice locale: punto/virgola, una cifra decimale, voto personale/condiviso, statistiche e fallback legacy verificati. Migration `seen_rating_n/v/together` da smallint a numeric **applicata dall'utente**; verifica dei salvataggi sui due telefoni dopo deploy. [Specifiche e verifiche](PHASE38_DECIMAL_RATINGS.md).
- Phase 39 — Spazio «Extra» (**idea, non implementata**): eventuale sezione compatta per le funzioni giocose usate di rado, a partire dalla Sorpresa; decidere contenuti e posizione dopo la verifica dell'uso reale. La Ruota resta centrale nella scelta del film.
- Phase 40 — Statistiche personali (**idea, non implementata**): sezione dedicata ai voti, alle visioni e alle recensioni del singolo, distinta da Ricordi; definire metriche e navigazione in una fase dedicata.
- Phase 41 — Suggerimenti saghe ✅ nel codice locale: capitoli in ordine di uscita, aggiunta esplicita e dedup, futuri per il cinema, sorprese protette; verifica reale su due telefoni da fare. [Specifica](PHASE41_SAGHE.md).

---

## Architettura concettuale di riferimento

```
                     sc(r)occhiaTu
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       LIBRARY            SCELTA          TONIGHT
          │                │                │
   Search / Filters   ┌────┼─────┐      Serata di oggi
          │           │    │     │           │
      Movie Cards  Match  Ruota  Proposta    │
       (dettaglio) Live          diretta     │
          │           └────┬─────┘           │
          │                │                 │
          └────────────────┼─────────────────┘
                           │
                    IN PROGRAMMA (movie_nights)
                           │
                      🎟️ TICKET
          (Match % se Match Live · "Scelto con la Ruota" se Ruota
                 · "Proposto da N/V" se diretta — origine in-memory)
                           │
                 ┌─────────┴─────────┐
                 │                   │
             Condividi        Il nostro cinema
                                     │
                                Timeline / History
```

---

## Debito tecnico / pulizia

- Origine del Ticket (Match Live/Ruota/diretta) tracciata solo in-memory (`markTicketOrigin`/`ticketOriginOf`), persa al refresh/nuova sessione di navigazione — lo storico Phase 21 mostra serate concluse senza attribuire un'origine non salvata
- Colonna legacy `movies.genre` (ex mood) non più letta/scritta: valutare drop in una migration
- Doppio livello `movie_nights` + mirror legacy su `movies` (`night_confirmed`, `scheduled_*`): tenere finché serve, poi dismettere
- `AGENTS.md` obsoleto: non allineato a questo documento, da aggiornare insieme
- Icone PWA **provvisorie** (generate via script, non un asset di design reale) — da sostituire quando disponibile
- `via.placeholder.com` (fallback poster) risulta irraggiungibile dall'ambiente di sviluppo — non blocca nulla oggi (il dettaglio usa un gradiente CSS quando manca il poster), ma va verificato in un contesto reale prima di contarci altrove

---

## Decisioni definitive v2.14

- **Match Live non si modifica**: resta Tinder-like a swipe ed è l’unico luogo in cui avviene il match tra N e V.
- **Niente Match asincrono**: la vecchia UX like/dislike sulle Movie Card viene eliminata.
- **Movie Card = stato di visione**: due indicatori N/V, con oro per la visione insieme.
- **Dashboard = nuova architettura**: Library e Match Live non devono più convivere nello stesso menu orizzontale sovraccarico.
- **`votes` non viene droppato in questa fase**: resta legacy finché non viene verificato che nessuna funzione futura ne dipenda.

## Note aperte per iterazioni future

- Ruota (Phase 15): variante "skip animazione, output diretto" (non prioritaria)
- Dati TMDb non salvati oggi: popolarità, vote_average, data uscita completa, piattaforme multiple (solo la prima flatrate IT) — servono per Phase 10 (Hot Picks)
- Limite noto sul Match CTA: lo stato online/live si aggiorna a ogni render, non su ogni evento di presence in tempo reale se si resta fermi su un altro tab (accettato, non bloccante)
- Se in futuro servirà un archivio dei PNG esatti dei ticket generati, definire la persistenza dei file e dell'origine; lo storico attuale conserva solo gli eventi `movie_nights` (vedi Decisioni #10).
