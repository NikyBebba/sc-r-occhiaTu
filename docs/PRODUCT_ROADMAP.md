# Roadmap ufficiale di prodotto

Aggiornamento: 16 ottobre 2026. **Roadmap unica, stati CURRENT / TARGET APPROVED / FUTURE.**
Baseline AS-IS: [MASTER_CONTEXT](MASTER_CONTEXT.md), release v62 in produzione
al commit `a7d1f827c71e60c00aa72d6cf61f69642c80fc91`.
Principi di scalabilità: [ARCHITECTURE_VISION](ARCHITECTURE_VISION.md).

## Identità e value proposition

sc(r)occhiaTu costruisce un’esperienza centrata sull’intero ciclo sociale
della visione:

**DISCOVERY → PROPOSTA → DECISIONE CONDIVISA → PROGRAMMAZIONE → VISIONE →
VALUTAZIONE → RICORDO**.

«Cosa guardiamo?» → «Scegliamolo insieme» → «Programmiamolo» → «Guardiamolo» →
«Valutiamolo» → «Ricordiamolo».

Catalogo, watchlist e tracking personale sostengono questo percorso. Le
interazioni condivise sono un elemento differenziante centrale: la direzione
supera il solo movie tracker o un clone di Letterboxd/JustWatch. Il prodotto
resta semplice, mobile-first, personale, ludico e cinematografico, adatto a
coppie, amici, coinquilini o famiglia, senza una cornice esclusivamente romantica.
Ruota mantiene il proprio ruolo nella scelta. Surprise e Veto sono
DEPRECATED / TARGET REMOVE; restano nel runtime AS-IS fino al cleanup separato.

## Stati e ordine

- **IMPLEMENTED:** presente nella baseline; le verifiche effettive sono nei
  checkpoint AS-IS, senza estenderle automaticamente a ogni caso futuro.
- **APPROVED / NOT IMPLEMENTED:** contratto congelato e/o direzione tecnica
  approvata, senza feature live, schema nuovo o esecuzione già autorizzata.
- **PLANNED:** direzione concordata, da progettare/implementare in fasi dedicate.
- **EXPLORATORY:** possibile soluzione o funzionalità da valutare, senza impegno
  di implementazione o data di consegna.

L’ordine Fase 0–10 è la roadmap ufficiale. I vecchi numeri Phase/Step delle
specifiche sono riferimenti storici e non corrispondono a questi numeri.
Gli stati descrivono il lavoro risultante, non autorizzano SQL, migrazioni,
refactoring o nuove feature automatiche. Il prossimo passo del perimetro
Persona/Gruppo è registrato sotto; le altre fasi conservano il proprio stato.

| Fase | Direzione | Stato |
| --- | --- | --- |
| 0 | Core film stabile | IMPLEMENTED; refinement possibili |
| 1 | Discovery & Recommendation Engine | IMPLEMENTED / PARTIAL: Core v2 + primo consumer `Cosa Guardiamo?` rilasciati; discovery esteso e validazione empirica restano DEFERRED |
| 2 | Decision Engine | PLANNED |
| 3 | Competitive / Product Analysis | PLANNED, prima della grande espansione multiutente |
| 4 | Product Architecture V2 / Multiuser ready | PLANNED, progettazione prima della migrazione |
| 5 | Series & Tracking Engine | PLANNED |
| 6 | Account e profili reali | PLANNED |
| 7 | Lobby / Groups | PLANNED |
| 8 | Recommendation / Intelligence 2.0 | PLANNED |
| 9 | Community | PLANNED, dopo utenti e gruppi stabili |
| 10 | Productization | PLANNED, prima dell’apertura pubblica |

## Checkpoint Persona/Gruppo — APPROVED / NOT IMPLEMENTED

**16 ottobre 2026.** CURRENT RUNTIME FACT: la produzione resta v62, senza Lista
personale, supporti distinti della candidatura o partecipanti espliciti negli
eventi. Approvare il contratto non rende completata una feature.

| Stato | Perimetro | Fonte autorevole |
| --- | --- | --- |
| COMPLETED | Audit runtime e review Product Grammar, transizioni, UX/IA e alternative tecniche conclusi; runtime v62 già rilasciato | [MASTER_CONTEXT](MASTER_CONTEXT.md) |
| APPROVED / NOT IMPLEMENTED | Product Grammar e Relation & Transition Contract congelati | [INDIVIDUAL_WATCH_REWATCH](INDIVIDUAL_WATCH_REWATCH.md#target-approved--product-grammar-e-relation--transition-contract) |
| APPROVED / NOT IMPLEMENTED | IA group-first: Persona → Lista/Visti; Gruppo → Lista/Rewatch/In programma/Together/Ricordi e strumenti esistenti; Tutti rimosso come collection primaria | [UX_NAVIGATION_MEMORIES](UX_NAVIGATION_MEMORIES.md#target-approved--ia-personagruppo) |
| APPROVED / NOT IMPLEMENTED | Contextual UX, L'ho visto anch'io diretto, Add primary save + quick action non bloccanti, Saga contestuale | [MOVIE_CARD_DISCLOSURE](MOVIE_CARD_DISCLOSURE.md#target-approved--card-detail-e-add), [PHASE41_SAGHE](PHASE41_SAGHE.md#target-approved--saga-context-contract) |
| APPROVED / NOT IMPLEMENTED | Alternativa B: relazioni con scope esplicito, modello ibrido e incrementale | [ARCHITECTURE_VISION](ARCHITECTURE_VISION.md#target-architecture-approved--alternativa-b) |
| APPROVED / NOT IMPLEMENTED | Implementation Plan e refinement finale: Auth UUID, generation monotone, satisfaction minimale, lock film-centric, versioni scoped, snapshot server e Realtime invalidation | [ARCHITECTURE_VISION](ARCHITECTURE_VISION.md#target-architecture-approved--alternativa-b), [DATA_MODEL_TRANSITION](DATA_MODEL_TRANSITION.md#satisfaction-minimale--approved-technical-contract) |
| APPROVED / NOT IMPLEMENTED | Preservazione legacy, attestazione N+V delle tre Together reali, satisfaction conservativa, autorità server e coerenza delle letture | [DATA_MODEL_TRANSITION](DATA_MODEL_TRANSITION.md#target-approved--requisiti-informativi-e-preservazione) |
| NEXT | PHASE 1 — LOCAL FOUNDATION / CANDIDATE MIGRATION; non ancora autorizzata o iniziata, nessuna operazione live implicita | Contratti sopra |
| FUTURE / DEFERRED | Multi-group completo, normalizzazione seen/giudizi, policy gruppi >2, cronologia personale, giudizi per evento, discovery esterna | Fasi/direzioni esistenti sotto |

Questo è un incremento del core e dei confini Persona/Gruppo, non l'esecuzione
integrale delle Fasi 4/6/7. Non crea una roadmap parallela né riapre Match Live,
Ruota o il Core v2 frozen. Rewatch resta WORKING NAME con membership stretta,
non la proposta «Riscoperte». La Lista personale resta distinta dalle candidature.

Sequenza autorizzativa: **scelta tecnica → consolidamento docs → Implementation
Plan → codice/database → regression → deploy controllato**. Questo checkpoint
registra anche l'approvazione del piano e del refinement finale, senza duplicarli;
la loro approvazione non autorizza l'avvio di Phase 1 o operazioni live.

## Fase 0 — Core film stabile

**IMPLEMENTED.** Libreria, storico personale, Together, Ricordi, movie nights,
Match Live, programmazione, rewatch, autenticazione, PWA e UX/mobile costituiscono
la baseline corrente. Card/ricerca Storico e lifecycle oltre mezzanotte/modifica
snack sono release concluse. Saghe, ticket, calendario, temi, audio/haptics e
voti decimali sono già presenti e non vanno riproposti come feature future.

Ulteriori refinement si valutano in fasi dedicate. PWA presente non significa
offline completo: il debito Tailwind CDN è registrato nel MASTER_CONTEXT,
non è un blocker della release v60 e non viene corretto da questa roadmap.

## Fase 1 — Discovery & Recommendation Engine

**IMPLEMENTED / PARTIAL — release v62.** Recommendation Core v2
(`stable-G4-polarity-v2`) e il primo consumer reale `Cosa Guardiamo?` sono
rilasciati. Il consumer usa Store → Adapter → Core → renderer, con candidate
pool shared-list-only. Candidate generation e ranking sono separati nel
contratto; un discovery mode fuori lista è **ARCHITECTURE-READY / DEFERRED**.
Sorgente del pool futuro, retrieval, filtri, dimensione, UX e fase restano da
decidere. La specifica frozen, il sanity check live e i limiti dei test sono in
[RECOMMENDATION_ENGINE](RECOMMENDATION_ENGINE.md).

La fase più ampia non è conclusa sul piano empirico: i test sintetici e il
sanity check read-only verificano coerenza strutturale, non predictive accuracy,
soddisfazione o qualità reale. La validazione/calibrazione con feedback reale è
futura e richiede un protocollo dedicato; non implica una ricalibrazione ora.

### Segnali CURRENT già implementati

Il Core v2 usa Personal Rating oppure, in sua assenza, Explicit Personal
Preference Like/Dislike; non li conta mai entrambi. La polarity del rating è
`<5.5` negativa, `5.5–<7` neutra e `>=7` positiva. Generi, regista, cast,
durata, epoca/anno e collection alimentano le feature affinity solo a partire
dalle osservazioni personali stabili. Together Rating contribuisce separatamente
al profilo shared. Review testuali non producono score; Seen è esposizione,
shared-list membership è candidacy e Match Live resta session-only. Nessuno di
questi elementi viene reinterpretato come Like; Dislike non è veto. Il dettaglio
tecnico è nella [specifica Recommendation](RECOMMENDATION_ENGINE.md).

### FUTURE / EXPLORATORY — non approvato come segnale

Non sono approvati ulteriori segnali stabili oltre al contratto corrente.
Disponibilità streaming e contesto della serata (incluse eventuali ipotesi su
mood o tempo disponibile) restano idee esplorative, non input del Core né una
roadmap implementativa. Il discovery fuori dalla shared list è
**ARCHITECTURE-READY / DEFERRED**; la sorgente del pool, retrieval, filtri,
dimensione, UX e fase non sono definite. Un voto assente resta distinto da zero;
Seen non dimostra una data di visione. I metadati/provider non garantiscono
copertura completa o aggiornata della disponibilità streaming.

Separare due domande:

| Ambito | Domanda |
| --- | --- |
| Personal recommendation | «Cosa potrebbe piacere a questo utente?» |
| Group recommendation | «Cosa potrebbe funzionare per questo gruppo?» |

Il modello futuro non deve basarsi esclusivamente sulle colonne N/V. La versione
privata può adattare quei dati a identità utente e contesto gruppo senza migrare
subito il DB. Cosa Guardiamo? è già consumer del Core; Ruota e Match Live restano
indipendenti e non hanno un piano approvato di integrazione/sostituzione. Il
contratto Match corrente resta valido.

## Fase 2 — Decision Engine

**PLANNED.** Evolvere il percorso discovery → proposta → shortlist → Match Live
→ scelta → programmazione, collegando raccomandazioni e decisioni esplicite.
Il modello deve poter funzionare in futuro con gruppi di più di due membri.

Possibili evoluzioni **EXPLORATORY**: suggerimenti intelligenti, filtri
contestuali, ruota pesata, esclusioni temporanee,
compatibilità tra utenti, explanation/reason del suggerimento, disponibilità
streaming e score di compatibilità. Definire le metriche prima di presentarle;
la Match % oggi resta la metrica della sessione Match Live, non uno score di
raccomandazione o community già esistente.

## Fase 3 — Competitive / Product Analysis

**PLANNED.** Prima della grande espansione multiutente svolgere un’analisi
strutturata. Competitor iniziali da analizzare: **Letterboxd, JustWatch, TV Time,
Trakt, Serializd**; individuare altri competitor pertinenti durante la fase.
Questa lista è un perimetro di ricerca, non un’analisi già effettuata.

Analizzare onboarding, discovery, watchlist, tracking, film, serie, rating,
recensioni, social, gruppi, recommendation, calendario, retention,
monetizzazione, privacy, punti forti e limiti UX/prodotto.

Produrre una matrice documentata con fonti e data di osservazione:

| FEATURE | COMPETITOR | QUALITÀ/APPROCCIO | LIMITE | RISPOSTA sc(r)occhiaTu |
| --- | --- | --- | --- | --- |
| Da analizzare nella fase | Da verificare | Evidenza osservata | Gap motivato | Scelta di prodotto da proporre |

Obiettivo: identificare USP e gap reali, evitando di copiare indiscriminatamente
feature del mercato. L’analisi dovrà validare e raffinare la roadmap prima
delle grandi trasformazioni architetturali, senza cancellare automaticamente
le feature pianificate.

## Fase 4 — Product Architecture V2 / Multiuser ready

**PLANNED.** Progettare il modello futuro prima del vero multiutente. N/V è
valido per l’app privata, senza diventare il modello definitivo del dominio.

Direzione concettuale:

```text
User → UserContentState → Content
User → GroupMembership → Group → GroupContentState / GroupViewing
```

Prima di qualsiasi migrazione produrre target data model, mapping dal modello
N/V, migration strategy, rollback strategy, compatibilità con lo storico,
impatto RLS/Auth e test strategy. N e V devono diventare i primi due utenti
storici senza perdita di dati. Le nuove feature evitano hardcoding superfluo
quando ragionevole; nessun refactoring o cambio DB automatico.
La [visione architetturale](ARCHITECTURE_VISION.md) dettaglia questi confini.

## Fase 5 — Series & Tracking Engine

**PLANNED.** Serie TV come dominio dedicato, con Series → Seasons → Episodes.
Il solo flag di tipo su un film non rappresenta il progresso episodico.

Lifecycle indicativo **EXPLORATORY**: Da vedere → Iniziata → Continua → In pari
→ Completata. Prevedere progresso personale e condiviso/lobby, episodi visti,
stagione corrente, prossimo episodio, ultima visione, pausa, abbandono,
completamento, rewatch ed eventuali voti serie/stagione.

Caso fondamentale: membri dello stesso gruppo a episodi differenti. Il modello
deve distinguere progresso personale e condiviso senza sovrascriverli a vicenda.

## Fase 6 — Account e profili reali

**PLANNED.** Evolvere le attuali identità N/V verso utenti reali. Ogni utente
potrà avere profilo, avatar, storico, watchlist, voti, recensioni, preferenze,
statistiche e taste profile. Preservare integralmente i dati storici N/V;
l’attuale Auth verificata resta il punto di partenza, senza signup introdotto ora.

## Fase 7 — Lobby / Groups

**PLANNED.** Consentire creazione e partecipazione a più gruppi: coppia,
coinquilini, amici o famiglia. Ogni lobby potrà avere membri, lista condivisa,
proposte, Match Live, recommendation, calendario, movie nights, storico
condiviso, valutazioni condivise, Ricordi e statistiche.

Uno stesso utente può appartenere a più lobby; uno stesso contenuto può avere
stati differenti in lobby differenti. Il recommendation engine dovrà poter
evolvere verso semantiche `recommend(user_id)` e `recommend(group_id)` senza
riscrittura da zero. Sono esempi concettuali, non API oggi implementate.

## Fase 8 — Recommendation / Intelligence 2.0

**PLANNED**, sostenuta da più dati e feedback effettivi. Possibili evoluzioni
**EXPLORATORY**: taste profile dinamico, similarità tra contenuti, affinità tra
utenti, affinità specifica della lobby, segnali impliciti, weighting,
explanation e feedback loop.

Distinguere «cosa piace a me» da «cosa funziona bene quando guardo qualcosa con
questo gruppo». Questa distinzione è una potenziale USP, da verificare con uso
e analisi di prodotto, senza dichiararla già un vantaggio dimostrato.

## Fase 9 — Community

**PLANNED**, solo dopo stabilità di utenti e gruppi. Possibili elementi
**EXPLORATORY**: rating community, distribuzione voti, recensioni pubbliche,
profili, liste pubbliche, following, trending e statistiche aggregate.

Restano distinti **MY RATING**, **GROUP/VIEWING RATING** e **COMMUNITY RATING**.
Una valutazione personale o condivisa non diventa automaticamente pubblica;
visibilità e aggregazioni richiedono un contratto dedicato.

## Fase 10 — Productization

**PLANNED**, prima dell’apertura pubblica: onboarding, inviti, privacy, gestione
account, sicurezza multi-tenant, RLS robusta, performance, osservabilità,
analytics, notifiche, PWA/offline hardening, eventuale app nativa/wrapper,
monetizzazione e beta pubblica. Definire requisiti e verifiche della fase;
nessuno di questi sviluppi è implicito nella release corrente.

## Idee precedenti e perimetro

Hot Picks, export .ics, giorno fisso, streak, gamification senza leaderboard,
Poster Flip, statistiche personali dedicate, Extra, citazione casuale,
wildcard TMDb e altri easter egg restano **EXPLORATORY**: non sono una roadmap
parallela né precedono automaticamente la Fase 1. Hot Picks richiede ulteriori
dati e, se necessario, una migration autorizzata. Le singole idee potranno
essere collocate nelle fasi coerenti dopo una valutazione di utilità.
Il mood picker scartato nei cicli precedenti non viene ripristinato: il mood
come possibile segnale futuro è un’ipotesi da progettare separatamente.
