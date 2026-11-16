# Product Hub — Sprint 0

**Consolidamento locale dopo Product Owner Review (U03).** Struttura Hub con correzioni A/B/C/D, otto epiche, quattro campi/sei viste e workflow leggero approvati; protocollo iniziale adottato. Pubblicazione e attivazione restano separate e non autorizzate. Nessuna configurazione remota applicata. Baseline produzione fornita dal PO: v76, `3e9f64b17cdbe422aa37fa6ddcb3da6936cf7988`; HEAD coincide. Non è stato eseguito un nuovo controllo production/DB/device.

[Master Backlog](MASTER_BACKLOG.md) contiene riconciliazione e criteri candidati; [Codex Protocol](CODEX_DEVELOPMENT_PROTOCOL.md) contiene prompt, Definition of Ready/Done e test. La [roadmap](PRODUCT_ROADMAP.md) resta l'unica fonte della direzione strategica; [MASTER_CONTEXT](MASTER_CONTEXT.md) dello stato rilasciato e [ARCHITECTURE_VISION](ARCHITECTURE_VISION.md) dei confini architetturali. Questo Hub governa il processo, senza creare una seconda specifica funzionale.

## Risultato e limiti dell'evidenza

Il repository contiene molti checkpoint che si dichiarano ancora «locali/non rilasciati». Il commit v76 li include: ciò dimostra inclusione nel sorgente e, con l'attestazione iniziale PO, baseline rilasciata; non prova da solo applicazione SQL, restore riuscito o collaudo di entrambi i telefoni. I risultati PASS dei gate sono evidenze storiche, non test rieseguiti in Sprint 0.

Nella riconciliazione iniziale, la ricerca read-only GitHub `repo:NikyBebba/sc-r-occhiaTu is:issue` tramite connettore, limite 100, ha restituito **0 Issue** (aperte/chiuse, senza filtro stato). Nessuna Issue da importare o duplicato remoto osservato. La storia Git è stata consultata fino ai cicli iniziali di UI/saghe; non sono stati modificati ref remoti.

Il master backlog distingue contenitori futuri e componenti DONE: PB-003 non coincide con pagination catalogo v61 o cursori Discovery v76; PB-020 non rende mancante la timeline condivisa già esistente; PB-021 non equipara ricordo evento a rating evento; PB-031 non richiede ricostruire la foundation Persona/Gruppo già nel runtime.

## Mappa delle epiche

Le otto epiche sono classificazione approvata dal PO (U03), non otto impegni di delivery. Tipo Epic nei singoli PB indica che servirà ulteriore slicing solo all'avvicinarsi dell'implementazione.

| Epic | PBI | Outcome e confini | Livelli |
| --- | --- | --- | --- |
| E1 UX, Catalogo e Ricerca | PB-001–009 | Trovare/esplorare e agire con chiarezza; riuso saghe e navigazione v76 | Content, User, Group |
| E2 Discovery, Recommendation e Decision | PB-010–017 | Validare utilità e aiutare la scelta; Match/Ruota restano distinti | Content, User, Group |
| E3 Ricordi, Statistiche ed Engagement | PB-018–026 | Memorie affidabili e ritorno all'uso, senza inventare visioni | User, Group |
| E4 Strategia e Competitive Analysis | PB-027–030 | Segmento/USP e gap verificati prima dell'espansione | Tutti; ricerca Community |
| E5 Multiutente e Piattaforma | PB-031–040 | Crescita con isolamento e conservazione N/V | Content, User, Group, Community futura |
| E6 Engineering e Processo | PB-041–046 | Release sostenibili e integrità | Trasversale |
| E7 Beta Testing e Feedback | PB-047–048 | Apprendere da esterni con accesso controllato | User, Group; dati privati |
| E8 Developer Experience e Workflow | PB-049–051 | Ridurre ripetizioni e mantenere decisioni tracciabili | Trasversale |

Community non è requisito implicito di ogni feature: per E1–E3 valutare impatto e registrare «nessuna esposizione pubblica» quando appropriato.

## Proposta GitHub Projects

Un solo Project **sc(r)occhiaTu — Product Hub**, dedicato alle Issue di `NikyBebba/sc-r-occhiaTu`, con ownership a livello **account personale o organizzazione**, non repository-scoped. Per l’attuale repository personale il candidato naturale è l’account NikyBebba; un’eventuale ownership organizzativa va verificata sul contesto di attivazione, senza trasferire il repository o creare un’organizzazione per questo scopo. Project proposto **privato**; repository applicativo **pubblico**. La riservatezza del Project non si estende alle Issue pubbliche. Configurazione solo dopo autorizzazione distinta; niente contenuti personali nei titoli. [GitHub: creazione/ownership](https://docs.github.com/en/issues/planning-and-tracking-with-projects/creating-projects/creating-a-project), [visibilità](https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/managing-visibility-of-your-projects).

Campi minimi: **Status** (single select), **Priority** (P0–P3), **Iteration** (iteration; intervalli da configurare solo con planning concordato), **Epic** (single select E1–E8). Non duplicare Title, Assignees, Labels, Issue number, Repository, Milestone o linked PR nativi. PB-ID nel titolo `[PB-003] …` e nel corpo; issue number rimane identità GitHub. Release Version nel milestone nativo `vNN`, creato solo per una release concordata. AC, dipendenze `blocked by #…`, fonti e release evidence nel corpo. `Iteration` assegnata solo quando lo sprint ha capacità e intervallo concordati; inizialmente gli item restano senza assegnazione. Se il setup richiede date/durata iniziali per il campo iteration, rimandarne la configurazione anziché inventare scadenze; rimane uno dei quattro campi previsti. Un eventuale supporto nativo sub-issue è facoltativo, non requisito della proposta.

Status esatti: **IDEA → BACKLOG → READY → IN PROGRESS → IN REVIEW → DONE**. Retrocessione ammessa se scope/evidenze cambiano. Label `blocked` con motivo e sblocco richiesto; stato resta il più aderente (READY/IN PROGRESS). Label `decision:deprecated`, Issue chiusa come non pianificata, motivazione e successore; **non DONE**. Decision PROPOSED/EXPLORATORY tramite label; APPROVED nel corpo con fonte PO. Tipo tramite label `type:feature`, `type:bug`, `type:ux`, `type:debt`, `type:spike`, `type:feedback`. Niente catalogo di decine di label preventive. `released` / `release-verified` solo con evidenza; il milestone da solo non prova pubblicazione.

| Vista | Layout | Selezione | Raggruppamento/ordinamento |
| --- | --- | --- | --- |
| Product Backlog | Table | Issue aperte, non deprecated | Epic; Priority, poi posizione PO |
| Sprint Board | Board | Iteration corrente; esclude deprecated | Status, swimlane Epic se utile |
| Roadmap | Table iniziale; timeline quando configurabile | Contenitori Epic/Feature approvati | Epic; timeline sull’Iteration solo dopo intervalli concordati, senza campi date aggiuntivi |
| Idea Inbox | Table | Status IDEA, non deprecated | Decision label, Epic |
| Done / Release History | Table | Status DONE, non deprecated | Milestone; released/verified visibili |
| Beta Feedback | Table | type:feedback, anche chiusi per consultazione | Status; link all'Issue canonica nel corpo |

Questi sono predicati di configurazione, non sintassi di filtro API garantita. Verifica solo documentale: la timeline richiede campi data o iteration; con date non ancora concordate la vista **Roadmap** resta tabellare. Nessun quinto campo per ottenere una timeline anticipata. Il raggruppamento per label non è supportato nella roadmap: Idea Inbox può filtrare la decision label e raggruppare per Epic/Status, senza duplicare Decision in un campo. Al setup verificare filtri equivalenti, ordinamenti/raggruppamenti, disponibilità di swimlane e date iteration nel proprio account. [GitHub: limiti e configurazione roadmap](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout). Non è stato verificato un Project reale: i connettori disponibili non espongono operazioni Projects; questo non blocca il consolidamento. Nessun campo/automazione/servizio aggiuntivo.

Nessuna nuova automazione: assegnazione iniziale manuale IDEA, oppure stato locale già accettato per l’import storico documentale. La chiusura Issue **non** imposta indiscriminatamente DONE (duplicati/deprecated non sono consegne). Nessuna creazione automatica da ogni riga; primo gruppo minimo nel piano di attivazione sotto, poi import selettivo dopo triage. I contenitori strategici possono restare nei docs finché non servono operativamente.

## Privacy e visibilita — repository pubblico

Vincolo PO/U03: **Project privato e Issue pubbliche hanno visibilità indipendenti**. Non cambiare la visibilità del repository. Tutti i contenuti destinati a Issue/commenti/allegati pubblici devono essere minimizzati e anonimizzati prima della pubblicazione: niente nomi/contatti o altri dati riconoscibili dei tester, credenziali/token/dump, dati privati N/V o screenshot con dati personali. Anche una coorte pseudonima o una combinazione di device/data/caso può identificare una persona: omettere quanto non necessario.

Canale riservato previsto: raccolta assistita dal PO in un file locale riservato **fuori dal repository e da cartelle pubblicamente sincronizzate**, accessibile soltanto a PO e persone autorizzate. È una modalità organizzativa da predisporre prima dell’esperimento, non un nuovo servizio/infrastruttura; nessun file di feedback o dataset operativo viene creato in questa sessione. Concordare uso/conservazione delle note con i partecipanti. Non usare draft di Project o Issue pubbliche come archivio dei feedback riservati.

Il PO/facilitatore conserva l’evidenza riservata soltanto dove previsto e trasferisce al backlog esclusivamente sintesi tecniche sanitizzate e riproduzioni con dati sintetici; alle Issue non si allegano originali riservati né link che li rendano accessibili. La classificazione e il collegamento a un PB/Issue non approvano una nuova feature. Nessun invio di messaggi o invito ai tester è autorizzato ora.

## Artefatti accettati e attivazione — PB-047–051

| PBI | Scope iniziale verificato e accettato dal PO | Lifecycle / Implementation | Attivazione distinta |
| --- | --- | --- | --- |
| PB-047 | Piano Closed Beta, scenari e gate disponibili | BACKLOG / PARTIAL | Beta non eseguita né autorizzata; walkthrough solo prossimo esperimento candidato |
| PB-048 | Processo acquisizione/organizzazione, classi e canale riservato definiti nel Hub e template | DONE / IMPLEMENTED nello scope documentale iniziale | Nessuna raccolta esterna operativa; release N/A |
| PB-049 | Protocollo e prompt riusabile, letture/test proporzionati | DONE / IMPLEMENTED nello scope iniziale | Standard operativo iniziale adottato; nessun permesso remoto implicito, release N/A |
| PB-050 | Sei template locali e DoR/DoD completi | DONE / IMPLEMENTED nello scope iniziale | Non ancora pubblicati su GitHub; release N/A |
| PB-051 | Classificazione/dedup/triage e decisioni PO definiti | DONE / IMPLEMENTED nello scope iniziale | Processo accettato, nessun feedback esterno triagiato qui; release N/A |

Dipendenze bloccanti iniziali: **PB-050 → PB-049**, **PB-048 → PB-050**, **PB-051 → PB-050** (freccia = dipende da). PB-048 e PB-051 hanno un collegamento informativo reciproco e possono evolvere parallelamente: nessuna attende il completamento dell’altra. PB-050 fornisce template/DoR/DoD, PB-051 disciplina classificazione/dedup/triage, PB-048 acquisizione/organizzazione. Nessun ciclo nel sottografo direttamente interessato. PB-046 conserva un residuo più ampio di debito: slice Sprint 0 accettato, iniziativa PARTIAL/BACKLOG.

Un artefatto documentale accettato può essere DONE anche se il processo evolverà. Non assegnare DONE all’iniziativa beta o ad altri contenitori per sola approvazione del modello.

## Scrum leggero e triage — PB-048/051

Workflow Scrum-inspired leggero approvato in U03. PO mantiene ordine e decisioni; Codex propone scope, dipendenze, costo relativo e test; PO valida obiettivo sprint. Sprint = un incremento coerente e capacità concordata, senza deadline arbitrarie. Planning breve, aggiornamento asincrono se cambia rischio/scope, review sul risultato, retro con una sola miglioria operativa. Nessun daily obbligatorio o ruolo aggiuntivo.

Triage al planning o quando arriva un feedback rilevante:

1. Acquisire e organizzare il feedback (PB-048) nel canale riservato quando necessario, con fonte/data/versione/device solo se utili, atteso/osservato e impatto. Prima di riportarlo in una Issue pubblica minimizzare/anonimizzare secondo le regole privacy sopra. Il tester non deve esportare il suo DB. Classificazione/dedup/triage (PB-051) usa il template PB-050; il rinvio tra processi è informativo, non dipendenza circolare.
2. Cercare PB-ID, termini equivalenti e Issue aperte/chiuse, più registro scartati. Se stessa causa/outcome, collegare al canonico e aggiungere evidenza: non creare una feature gemella. Se causa ignota, collegamento «possibly related», non dedup definitivo.
3. Bug = violazione del comportamento concordato; UX = frizione senza violazione; Feature = nuova capacità; Debt = rischio/costo interno; Spike = incertezza che richiede risposta. Feedback mantiene fonte e classificazione, l'Issue di delivery contiene la soluzione e i test.
4. P0 sicurezza/perdita dati attiva: fermare il flusso interessato e segnalare subito. P1 blocco core o prerequisito, P2 miglioramento utile, P3 esperimento. Frequenza, gravità, workaround, evidenza e costo spiegano l'ordine, non uno score artificiale.
5. PO registra decisione APPROVED / EXPLORATORY / DEPRECATED, motivo e data. READY è lifecycle dopo DoR, non alternativa a EXPLORATORY/DEPRECATED. Un'idea Codex è PROPOSED finché il PO decide.
6. Feedback può chiudersi come collegato a #canonico senza dichiarare il bug risolto; registrare esito di triage e Issue di delivery. Nuova Issue solo se non c'è equivalente, outcome comprensibile e priorità motivata. Non inviare messaggi ai tester senza autorizzazione.

Formato decisione: `data | PB/Issue | autore (PO/Codex) | fonte/evidenza | decisione | motivazione | cosa sostituisce | implementazione/release`. Il registro qui sotto vale per Sprint 0; dopo l'attivazione, decisioni operative nel thread della Issue, strategiche nei docs pertinenti con backlink. Nessun log parallelo obbligatorio.

## Closed Beta — PB-047

**Piano accettato dal PO; iniziativa PB-047 PARTIAL/BACKLOG.** Nessun account, invito, progetto hosting o servizio viene creato ora. La v76 privata a due non è automaticamente sicura per tester esterni.

Primo approccio **APPROVED dal PO (U03)**: walkthrough moderato con dati sintetici e isolati, prossimo esperimento candidato **da pianificare, non da eseguire in questa sessione** (P-02, provenienza Codex conservata). Osserva comprensibilità di ricerca, intenzioni personali/gruppo, Discovery/scelta e ricordi tramite scenari dimostrativi; raccoglie feedback qualitativi strutturati e distingue problemi osservati da feature request. Nessun account esterno sul Supabase di produzione, accesso ai dati N/V o costruzione di dataset/ambiente operativo ora. Il template può essere compilato dal facilitatore con sintesi sanitizzate; le note non pubblicabili restano nel canale riservato previsto sopra. Nessun feedback si converte automaticamente in Issue o feature approvata.

Gli scenari della tabella sono un repertorio: nel walkthrough osservare solo quelli rappresentabili con dati dimostrativi; non eseguire inviti, revoche, scritture reali o prove di isolamento su produzione. I gate seguenti riguardano **solo la futura beta autenticata**, non l’esecuzione implicita del walkthrough. Beta con account esterni non autorizzata: resta dipendente da PB-040/031/032/033 (scope adeguato), PB-042, verifica release e assistenza.

Per la futura beta autenticata, proposta di coorte iniziale: 2–3 piccoli gruppi volontari (coppia/amici/famiglia), poche persone per gruppo, abitudini di visione e device Safari/Android differenti, almeno un utente poco tecnico; numerosità proposta, non risultato statisticamente rappresentativo. Se prodotto resta a due, iniziare solo con gruppi di due e dichiarare il limite; gruppi >2 richiedono policy decisione dedicate. Escludere chi richiede esposizione pubblica o tracking serie già completo. Età adulta per la prima coorte è proposta organizzativa, non valutazione legale.

Prima degli inviti: ambiente/dataset separato da N/V, account individuali, membership assegnate con accesso minimo, inviti nominali/scadenti/revocabili e procedura assistita di uscita/cancellazione. Non condividere account N/V né trattare etichette UI o filtri client come isolamento. Test negativi cross-group/cross-user su letture, scritture, Realtime, cache/sessione, uscita e revoca; chiarire chi amministra accessi. Anche un ambiente beta separato richiede isolamento tra tester. Backup e restore esercitati su copia isolata; consent/privacy, scopi e durata conservazione decisi prima di raccogliere dati. Nessun dump o credenziale in GitHub.

| Scenario | Osservazione richiesta | Confine da verificare |
| --- | --- | --- |
| Primo accesso/invito e ritorno | Comprende persona e gruppo senza guida? | Solo membership autorizzate |
| Cerca un film/una saga | Trova titolo corretto senza falsa disponibilità? | Ricerca distinta da persistenza |
| Salva personale e propone al gruppo | Distingue le due intenzioni? | Nessuna relazione implicita |
| Scopri / Dalla Lista | Quali suggerimenti considera, scarta e perché? | Nessuna percentuale di accuratezza inventata |
| Decide con Match o Ruota | Riesce a concordare e programmare? | Strumenti attuali preservati |
| Conclude e rivede un film | Comprende seen, Together, rewatch e ricordo? | Un evento non sovrascrive giudizi personali |
| Rientro/errore rete/aggiornamento PWA | Sa recuperare senza duplicare azioni? | Nessun comando autorevole offline |
| Revoca/uscita e altro gruppo | Non vede più dati non autorizzati? | Test assistito isolato prima del reale |

Raccolta iniziale prevista: template Feedback come schema tramite facilitatore PO; note non pubblicabili nel canale locale riservato sopra, solo sintesi tecniche anonimizzate nelle future Issue del repository pubblico. Nessun accesso diretto al Project richiesto ai tester e nessun account GitHub obbligatorio. Classi: bug, UX, feature request, qualitativo, miglioramento, altro/da triage. Un feedback può alimentare PB-010 senza cambiare il ranking.

Misure minime, con partecipazione volontaria e raccolta manuale iniziale: completamento scenario assistito/non assistito, punto di abbandono, errori osservati, chiarezza personale/gruppo, suggerimenti utili su valutati (denominatore dichiarato), ritorno volontario e motivazione. Non installare analytics per raccogliere dati già ottenibili con osservazione breve. Separare soddisfazione individuale da decisione condivisa; campione piccolo dà segnali qualitativi, non predictive accuracy.

Entry gate della futura beta autenticata: isolamento e negativi superati, accessi revocabili, istruzioni/supporto, recovery/backup verificati, build/device supportati e privacy review chiusi. Stop: sospetto leak, perdita dati, scritture duplicate non recuperabili, impossibilità revoca; preservare evidenze minime e sospendere onboarding. Exit: scenari core percorribili, nessun incidente aperto di sicurezza/integrità, problemi ad alto impatto risolti o decisione esplicita PO, feedback triagiati e sintesi per coorte. PO decide iterare/allargare/fermarsi; nessuna apertura pubblica automatica. A fine coorte eliminare o conservare solo quanto concordato, con revoca accessi verificata. Non fissare una durata fittizia: fissare la finestra con i tester quando i prerequisiti saranno soddisfatti.

## Sprint 1 — candidato principale approvato, planning aperto

PB-003 è il **candidato principale approvato dal PO per il prossimo Sprint Planning**, resta BACKLOG: approvazione della candidatura non equivale a READY né ad autorizzazione di sviluppo. Obiettivo candidato: rendere la ricerca di aggiunta fruibile oltre i primi cinque titoli, con una sola Issue principale per sessione. Capacità non ancora concordata: **nessun PBI impegnato**. Le taglie sono relative e non equivalgono a giorni.

| Candidato | Taglia/dipendenze | Scope pronto da raffinare | Verifica proporzionata |
| --- | --- | --- | --- |
| PB-003 | M; contratto chiamanti da controllare | Paginazione picker esplicita, dedup e query obsolete; preservare ricerca automatica strict/import | Test helper con fixture; browser picker/aggiunta simulata, errori/doppio click/focus; check sintassi/SW se grafo cambia |
| PB-005, solo incremento legato a PB-003 | S; dopo contratto PB-003 | Caricamento, pagina successiva, vuoto/errore, titolo/anno, touch/focus. Evitare redesign generale | Browser 320/390, tastiera e ritorno focus; nessuna suite DB se writers invariati |
| PB-001, refinement separato | S; effetti approvati in U04, dettaglio interazione da raffinare | Tre azioni distinte Persona/Gruppo; visto anche per capitolo esterno tramite acquisizione autorevole, niente Together; multipla da valutare | Riproduzione con fixture saga catalogo/esterno; se nuovo writer/acquisizione, test confini intent e retry |
| PB-002, solo copy delle superfici toccate | S; insieme ai candidati sopra | Elenco copy approvato nella Issue; niente cleanup globale | Revisione diff e browser delle superfici |

Ordine di planning: refinement PB-003, eventuale incremento PB-005 strettamente collegato e PB-002 limitato a copy/azioni coinvolte. PB-001 resta refinement separato, con effetti approvati in U04 e dettaglio interazione da raffinare; non blocca PB-003 né comporta impegno di delivery. PB-004 è uno spike di copertura collection/franchise successivo, **non** prerequisito della ricerca film e non va sommato automaticamente allo sprint. PB-006/007/008/009 fuori impegno salvo evidenza concreta.

Rischi: `searchTmdbCandidates` è usato anche da percorsi diversi dal picker; non alterare matching strict/import per ottenere pagination UI. `openSaga`/pill usano contesto TARGET e binding: non richiamare writer legacy. Non confondere franchise MCU con una singola collection TMDb. Ogni modifica del confine di scrittura innalza il livello di test e richiede il contratto esistente; non autorizza SQL/live.

Sprint 2 proposto: ricerca UX, PB-010 con feedback strutturati e refinement Discovery guidati dai risultati, PB-013 solo se giustificato. Non richiede già tester esterni: N/V e walkthrough sintetici possono avviare apprendimento. Sprint 3 proposto: PB-027 → 028 → 029 con slice PB-030. Sequenza da validare, nessuna deadline; poi Decision Engine, espansione multiutente/gruppi, serie e community secondo evidenze e roadmap.

## Decisioni recepite e punti aperti

Review PO U03 recepita: struttura Hub con correzioni A/B/C/D, otto epiche, quattro campi/sei viste, workflow leggero e protocollo iniziale approvati; walkthrough sintetico scelto; PB-003 candidato principale al planning. Non richiedere nuovamente queste approvazioni.

Nessun impedimento bloccante al consolidamento documentale. Restano per le fasi successive: owner/accesso effettivo Projects e verifica UI in attivazione; capacità/intervalli e DoR PB-003 nel planning; dettaglio interazione PB-001 prima del relativo delivery, mantenendo gli effetti approvati in U04. Questi punti non autorizzano nuovi audit o operazioni remote. Priorità della coda lunga ancora proposte. Baseline v76 invariata; nessun controllo live/PWA/restore rieseguito.

## Piano di attivazione Product Hub — sessione separata

1. Prerequisiti: diff locale revisionato, eventuale commit/push documentale esplicitamente autorizzato; account GitHub del proprietario con permessi di creazione/admin Project e scrittura Issue nel repository. Verificare accesso Projects separatamente dai permessi del connettore repository; in assenza usare la UI con accesso autorizzato, senza introdurre servizi. Owner personale candidato NikyBebba; alternativa organizzativa solo se già pertinente e autorizzata.
2. Dopo autorizzazione: creare **un** Project privato con il nome approvato, dedicato alle Issue del repository pubblico. Configurare Status/Priority/Iteration/Epic e sei viste sopra, con Roadmap tabellare finché mancano intervalli concordati. Verificare filtri, accessi e visibilità senza modificare il repository. Nessuna automazione/importazione totale.
3. Primo gruppo minimo di Issue candidate: **PB-003** BACKLOG (candidato al planning, non READY); **PB-049/050/051** come checkpoint storici documentali già DONE, con fonte U03 e release N/A, senza riaprire gli artefatti. PB-048 può essere collegato dal registro locale e importato solo quando serve, senza perdere il suo DONE iniziale. Non creare automaticamente PB-001/002/005 o tutte le 51 righe; selezione ulteriore al planning/triage.
4. Per ogni Issue autorizzata: corpo con AC/scope/fonti/dipendenze/evidenze, contenuto sanitizzato, PB-ID conservato; associare al Project e stato locale corretto. Dopo import, stato/priorità/AC vivono nelle Issue; docs restano strategia e mapping. Per dati riservati nessuna Issue pubblica con originali.
5. Autorizzazioni remote ancora necessarie: commit/push documentale; creazione del Project, configurazione/accessi/viste e delle sole Issue/label concordate, collegamento al repository. Nessuna di queste operazioni è effettuata o autorizzata dalla presente review. Beta, dataset, Supabase, deploy e sviluppo PB-003 restano fuori scope anche dall’attivazione Hub, salvo successiva istruzione distinta.

## Registro delle fonti

Lettura iniziale: inventario documenti e intestazioni → roadmap/master/architettura → specifiche pertinenti → sorgenti minimi e Git. Non sono stati esposti config/credenziali o dump/backup, né eseguiti audit dei dati o utilizzati backup per operazioni. I documenti untracked sono stati consultati soltanto nelle sezioni di stato, senza considerarli release.

| Ref | Fonte e uso |
| --- | --- |
| U01 | Prompt PO di questa sessione, baseline PB-001–046 e proposta sprint; nessuna attribuzione a PO delle opportunità Codex |
| U02 | Prompt PO iniziale, PB-047–051, separazione dimensioni, deliverable/vincoli Sprint 0 e baseline v76 |
| U03 | Richiesta PO «Sprint 0 — Final Consolidation After Product Owner Review»: approvazioni, correzioni A/B/C/D, walkthrough sintetico candidato e PB-003 candidato al planning; nessuna attivazione/sviluppo autorizzati |
| U04 | Ultime precisazioni PO prima della pubblicazione: PB-001 azioni Saga distinte e visto su capitolo esterno, niente Together/multipla ancora da valutare; PB-002 legacy mirato; PB-006 revisione organica UX/UI; PB-025 solo recupero Oscar. Priorità e candidatura PB-003 invariate, nessuno sviluppo o pubblicazione autorizzati |
| GH-DOC | Verifica documentale su GitHub Docs: creazione/ownership Project, visibilità e limiti roadmap, link nella sezione Projects; nessuna verifica di account o Project reale |
| G01 | `git log` e HEAD `3e9f64b`; v76 Discovery/memorie, b1c3f51 v75 loader, a7ba234 v74 UX, 515551f v73 autocomplete, f612b15/2ac5b2c v72/v71 CAP-1, 7fcb3d1 icone, 4234022 intenzioni; foundation da d7f7237 a 6382e20; precedenti v62/v61/Auth/saghe preservati in Git |
| S01 | [Roadmap](PRODUCT_ROADMAP.md): direzioni 0–10 e idee precedenti, mood picker scartato, Sorpresa/Veto deprecated |
| S02 | [Architecture](ARCHITECTURE_VISION.md), [Data transition](DATA_MODEL_TRANSITION.md), [Individual/Rewatch](INDIVIDUAL_WATCH_REWATCH.md): confini e contratti storici vs espansione |
| S03 | [Saghe](PHASE41_SAGHE.md): ordine uscita, next chapter, contesto e dedup già richiesti/implementati |
| S04 | [UX Navigation](UX_NAVIGATION_MEMORIES.md), [Card disclosure](MOVIE_CARD_DISCLOSURE.md): IA, card, contextual Add; status pre-v76 storici |
| S05 | [Bounded pagination](BOUNDED_PAGINATION.md), [Cinema](PHASE8_3_CINEMA_WATCHLIST.md), [Proiezioni](PROIEZIONI.md): pagination catalogo, NAV-01, filtro cinema e lifecycle |
| S06 | [Recommendation stable core](RECOMMENDATION_ENGINE.md), [Preference](PERSONAL_PREFERENCE_DB.md), [Decimal ratings](PHASE38_DECIMAL_RATINGS.md): rating/preference/review, Core frozen e limiti empirici |
| S07 | [Taste Profiles](TASTE_PROFILES_V1.md), [Core 2.0](RECOMMENDATION_CORE_V2.md), [Diversity validation](RECOMMENDATION_DIVERSITY_VALIDATION.md) e benchmark JSON associati: profili/ranking sintetici distinti dal Core stabile |
| S08 | [Retrieval originario](TMDB_DISCOVERY_RETRIEVAL.md) → [First UX](DISCOVERY_FIRST_UX.md) → [Native refinement](DISCOVERY_NATIVE_REFINEMENT.md) → [Actions quality](DISCOVERY_NATIVE_ACTIONS_QUALITY.md) → [Six freshness](DISCOVERY_SIX_FRESHNESS.md) → [Retrieval 2.0](DISCOVERY_RETRIEVAL_V2.md) → [Final corrective](DISCOVERY_FINAL_CORRECTIVE_PASS.md); [Metadata](DISCOVERY_NATIVE_METADATA_INTEGRATION.md), [Ratings layout](RATINGS_CONSISTENCY_NATIVE_LAYOUT.md): evoluzione inclusa in v76, i precedenti limiti locali non sono prova di mancata inclusione finale |
| S09 | [Timeline](PHASE22_TIMELINE.md), [Statistics](PHASE23_MOVIE_CHEMISTRY.md): mensile/shared già esistenti, niente date personali inventate |
| S10 | [Midnight/memories](MOVIE_NIGHTS_MIDNIGHT_MEMORIES.md), [Completed unification](COMPLETED_NIGHTS_UNIFICATION.md): memoria evento distinta da review film; CAP-1 nel gate v76 |
| S11 | [Master context](MASTER_CONTEXT.md), sezioni Fuori dal piano, Decisioni, Archivio Step 1–9, Debito e Note aperte: idee storiche e scarti; storia non automaticamente priorità |
| S12 | [Auth](AUTH_SUPABASE.md), [Protocol handoff](PRODUCTION_PROTOCOL_HANDOFF.md), [v68 handoff](V68_HANDOFF.md): autorità, protocollo, precedente attestazione target/1, recovery; nessun cutover da rieseguire |
| S13 | [v76 gate](V76_FINAL_INTEGRATION_GATE.md), [release inventory](V76_RELEASE_INVENTORY.json), `service-worker.js`, `index.html`: scope release/versioni e verifiche storiche locali; non prova nuova esecuzione production |
| S14 | Untracked preesistenti `IMPORT_HISTORY_N*.md`, `CATALOG_AUDIT_V2_REPAIR.md`: stato locale/import e proposta repair, non nuova attività autorizzata. File e dati preservati; nessun dettaglio privato copiato |
| C01 | `js/ui/sagas.js` sagaChapterStates/renderSagaPanel; `js/ui/target-shell.js` openSaga/bindSaga; `js/ui/render/cards.js` targetPersonalTokenHtml; `js/ui/product-context.js` personalStatusHtml: pill propria → stato → recordSeen già disponibile sui capitoli noti |
| C02 | `js/api/tmdb.js` searchTmdbCandidates, `js/ui/product-editors.js` addCatalog, `js/ui/target-shell.js` search: cap cinque nella ricerca di aggiunta; nessun contratto pagination del picker |
| C03 | `js/ui/target-shell.js` navigate/filtered, `js/ui/product-context.js`, `js/runtime/*`, `js/snapshot/*` tramite inventario Git: superfici Persona/Gruppo e flussi già nel sorgente |
| C04 | Commit v75 loader, commit icone 7fcb3d1, asset nel grafo `index.html`; `icon & mascotte/` preesistente untracked non analizzato né modificato |

## Registro decisioni Sprint 0

D01–D07 conservano la proposta/review iniziale; D08–D12 registrano l’esito PO e prevalgono sugli stati IN REVIEW/PROPOSED precedenti per il solo scope accettato.

| ID | Autore/fonte | Decisione e conseguenza |
| --- | --- | --- |
| D01 | PO/U02, 16-11-2026 | v76 è baseline produzione. Precedenti CURRENT v62 ora archivio; nessun nuovo esito live attribuito |
| D02 | Codex, riconciliazione G01/C01–03 | Foundation/IA/Discovery presenti: PB contenitori PARTIAL, non riproporre sviluppi conclusi; nuova interpretazione, non nuova feature PO |
| D03 | PO/U01–02 | 51 ID conservati, priorità da validare e solo proposta locale; nessuna Issue/Project/commit/push/deploy/SQL |
| D04 | Fonti S01/S11 | Mood picker/Why this movie/cult/VHS e rimozione target Surprise/Veto conservano decisioni originarie; il codice legacy presente non revoca lo scarto |
| D05 | Codex/PROPOSED | Quattro campi Project e fonte operativa unica nelle Issue dopo import; meno duplicazioni e nessuna automazione massiva |
| D06 | PO/U02 + Codex proposta esecutiva | Sprint 0 artefatti IN REVIEW; readiness/completion non equivalgono a rilascio. Protocollo/template non richiedono deploy per essere accettati |
| D07 | Codex/PROPOSED (origine) | Walkthrough sintetico prima della beta autenticata per apprendere senza esporre N/V; decisione successiva D11 |
| D08 | PO/U03 — correzione A | PB-048 e PB-051 dipendono da PB-050; reciproco collegamento informativo, evoluzione parallela; nessun ciclo nel sottografo interessato |
| D09 | PO/U03 — correzione B | PB-048–051 DONE per scope iniziale documentale accettato e verificato; PB-047 PARTIAL/BACKLOG, piano accettato senza beta; PB-046 residuo aperto |
| D10 | PO/U03 — correzioni C/D | Modello unico Project approvato, ownership account/org e proposta privata; repository pubblico, Issue non privatizzate dal Project; sanitizzazione e canale locale riservato obbligatori |
| D11 | PO/U03 | Walkthrough sintetico moderato approvato come prossimo esperimento candidato, P-02 passa da PROPOSED a APPROVED conservando origine Codex; esecuzione non autorizzata |
| D12 | PO/U03 | PB-003 candidato principale al planning, BACKLOG/non READY, capacità ignota; PB-005 eventuale UX collegata, PB-001 separato, PB-002 solo superfici coinvolte. Nessun codice/remote/commit/push/deploy |

## Checklist di completamento Sprint 0

- 51/51 PBI presenti con ID/fonte/tipo/decisione/implementazione/lifecycle/dipendenze/AC candidati; registro recuperi e dedup nel backlog.
- Opportunità Codex con provenienza esplicita: P-01 PROPOSED, P-02 APPROVED dopo U03; scarti e parti DONE distinti dai residui.
- Configurazione Project/viste, triage, piano beta, protocollo, prompt, sei template e DoR/DoD disponibili localmente.
- Sprint 1 senza impegni arbitrari, dipendenze e sole decisioni PO sopra.
- Verifica documentale di link/ID/template/diff e preservazione file; nessuna suite runtime necessaria per modifiche esclusivamente documentali.

**Consolidamento dopo review PO completato localmente**: modello e artefatti iniziali accettati come sopra, applicazione GitHub non effettuata. Prossimo passo: review del diff locale, eventuale commit/push documentale autorizzato, poi sessione separata di Product Hub Activation. Non iniziare Sprint 1.

## Issue candidate — esempi concreti per il primo import selettivo

I tre esempi seguenti sono **BACKLOG, priorità proposta**; non creati su GitHub. PB-003 è candidato principale approvato al planning (U03), non READY. I criteri rimanenti dei 51 PBI sono nel Master Backlog. Prima del READY, l'Issue contiene eventuali decisioni qui ancora pendenti; nessun titolo candidato implica implementazione autorizzata.

### [PB-003] Sfogliare più risultati nella ricerca di aggiunta

Tipo Feature, E1, P1 proposta, stima M. Obiettivo: trovare il titolo giusto oltre i primi cinque. Corrente: `searchTmdbCandidates` tronca la prima risposta; atteso: avanzamento esplicito sui risultati della query in corso. Fonte: U01/C02. Dipendenze: contratto picker/query; nessun prerequisito multiutente.

Scope: ricerca interattiva di aggiunta e relativi stati. Fuori scope: import/auto-matching strict, Discovery, franchise MCU, nuovi writer, modifica metadati live. Vincolo: acquisizione esplicita tramite pipeline corrente, niente scritture esplorando.

- [ ] Una query con più di cinque risultati rende accessibili i successivi senza duplicati; fine dei risultati distinta da errore di rete.
- [ ] Cambiare query resetta pagine/selezione e ignora risposte obsolete; retry non raddoppia risultati o invii.
- [ ] Il picker mantiene focus, stato loading/empty/error, target tattili e leggibilità 320/390 px.
- [ ] Selezionare un film continua ad aprire il percorso corrente; nessun effetto personale/gruppo prima dell'intento esplicito.
- [ ] Percorsi strict/import preservati con fixture dei chiamanti; test async/query e browser picker eseguiti, nessun dato reale toccato.

Release NOT RELEASED; package/versioning solo in futuro rilascio autorizzato. Evidenza da produrre: test mirati e dimostrazione della query sintetica con titolo oltre posizione cinque.

### [PB-001] Raffinare le azioni contestuali del pannello Saga

Refinement separato, E1, P2 proposta invariata. Fonte autorevole: U04 e riga PB-001 nel [Master Backlog](MASTER_BACKLOG.md). Effetti approvati: «L’ho visto», «Voglio vederlo» (Lista personale) e «Proponi al gruppo» distinti; visto anche su capitolo assente dal DB tramite acquisizione autorevole, senza candidatura o giudizio impliciti; Together escluso. Selezione multipla solo ipotesi da valutare. Riutilizzare il percorso esistente e raffinare il dettaglio dell’interazione prima del READY; nessuna nuova scelta tra effetti già approvati e nessun impegno di sviluppo/Sprint 1. I criteri candidati sono mantenuti nella sola riga canonica PB-001 per evitarne duplicazione.

### [PB-010] Raccogliere feedback sulla pertinenza delle proposte

Tipo Spike, E2, P1 proposta, stima S/M. Obiettivo: verificare utilità percepita prima di calibrare. Fonti S06/S07/U01. Dipendenze documentali iniziali PB-048/051 soddisfatte nello scope accettato; futura coorte esterna attende PB-047/040. Il walkthrough sintetico candidato è l’approccio scelto dal PO (U03); questo spike non autorizza raccolta o nuove sessioni di test ora.

- [ ] Protocollo registra versione, contesto dichiarato, titoli valutati e denominatore delle risposte; nessuna raccolta in background.
- [ ] Feedback distingue pertinenza personale, utilità condivisa e novità; motivazioni qualitative non trasformate automaticamente in Like/Dislike.
- [ ] Sintesi riporta campione e limiti, differenzia bug UX da ipotesi di ranking e collega eventuali Issue canoniche.
- [ ] Nessuna modifica a formule, pesi, DB o analytics come parte dello spike.

Test: verificare completezza dello schema con esempi sintetici senza dati N/V; release N/A. Criterio di uscita: evidenza sufficiente per decidere prossimo esperimento, oppure insufficienza esplicita, senza soglie di successo arbitrarie.


## Checkpoint storico della preparazione iniziale — delta e verifica

Elenco per review, corrispondente al perimetro annunciato prima delle modifiche:

- Aggiornati `AGENTS.md`, `MASTER_CONTEXT.md`, `PRODUCT_ROADMAP.md`, `ARCHITECTURE_VISION.md`: checkpoint v76 e lettura corrente sopra lo storico conservato.
- Aggiornati `RECOMMENDATION_ENGINE.md`, `PHASE41_SAGHE.md`, `UX_NAVIGATION_MEMORIES.md`: avvertenze di versione mirate, evitando di riscrivere contratti e risultati storici.
- Creati `MASTER_BACKLOG.md`, questo `PRODUCT_HUB.md` e `CODEX_DEVELOPMENT_PROTOCOL.md`: rispettivamente riconciliazione, processo/board/beta/fonti, protocollo/DoR/DoD/prompt.
- Creati sei template Markdown nativi in `.github/ISSUE_TEMPLATE/`: Feature, Bug, UX Improvement, Technical Debt, Research/Spike, Feedback. Nessuna GitHub Action o dipendenza.

**16 file: 9 creati e 7 aggiornati.** Verifica locale mirata: 51 ID PB + 29 H + 2 P univoci e in sequenza; sei template con campi richiesti; link/anchor locali risolti; sezioni originarie dei sette file aggiornati preservate integralmente; diff limitato alla documentazione; nessun file staged e tutti gli untracked preesistenti ancora presenti con lo stesso stato Git. `git diff --check` PASS. Il controllo di presenza/stato degli untracked non è un audit del loro contenuto. Nessun codice, database o remoto modificato; nessuna suite applicativa eseguita per questo delta documentale.


## Esito del refinement dopo review PO

Delta di questa sessione: Master Backlog (dipendenze/stati e decisione P-02), Hub (A/B/C/D, walkthrough, planning/attivazione), Protocollo (adozione/DoD/privacy); soli richiami correnti in AGENTS, roadmap e master context allineati per non lasciare «adozione pendente». Il template Feedback esplicita la visibilità pubblica; gli altri cinque restano invariati. Fonti e contratti storici preservati, nessun nuovo documento.

Controlli locali: ID/classificazioni/riferimenti, sottografo dipendenze PB-048–051 senza cicli, stati documentali accettati distinti da operatività, link/anchor e sei template, diff/whitespace e preservazione dei file estranei. Nessuna nuova riconciliazione dei 51 PBI né suite applicativa/browser/DB/live; nessun account, dataset o ambiente creato. Le capacità Projects sono state consultate solo nella documentazione ufficiale: accessi e setup reale restano da verificare in attivazione. Stop agli artefatti locali, nessun commit/push/deploy/Supabase o scrittura GitHub.


Ultime precisazioni PO (U04): consolidamento approvato; PB-001/002/006/025 aggiornati nel Master Backlog, senza nuovi PBI/Issue o variazioni di priorità. PB-003 resta candidato principale Sprint 1. Il recupero Oscar è l’unico refinement approvato dentro PB-025; le altre idee non vengono attivate. Nessuna implementazione o pubblicazione effettuata: pacchetto locale pronto per la successiva pubblicazione documentale autorizzata, dopo i check di coerenza.
