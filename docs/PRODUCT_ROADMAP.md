# Roadmap ufficiale di prodotto

Aggiornamento: 12 ottobre 2026. **TO-BE**, salvo la Fase 0 già implementata.
Baseline AS-IS: [MASTER_CONTEXT](MASTER_CONTEXT.md), produzione v60 al commit
`0813e721e963191b285f357789a9dddd967c6162`.
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
- **PLANNED:** direzione concordata, da progettare/implementare in fasi dedicate.
- **EXPLORATORY:** possibile soluzione o funzionalità da valutare, senza impegno
  di implementazione o data di consegna.

L’ordine Fase 0–10 è la roadmap ufficiale. I vecchi numeri Phase/Step delle
specifiche sono riferimenti storici e non corrispondono a questi numeri.
**La prossima grande fase è la Fase 1**, che precede multiutente e serie.
Nessuna voce autorizza SQL, migrazioni, refactoring o nuove feature automatiche.

| Fase | Direzione | Stato |
| --- | --- | --- |
| 0 | Core film stabile | IMPLEMENTED; refinement possibili |
| 1 | Discovery & Recommendation Engine | Core IMPLEMENTED LOCALLY; integrazione PLANNED — priorità operativa |
| 2 | Decision Engine | PLANNED |
| 3 | Competitive / Product Analysis | PLANNED, prima della grande espansione multiutente |
| 4 | Product Architecture V2 / Multiuser ready | PLANNED, progettazione prima della migrazione |
| 5 | Series & Tracking Engine | PLANNED |
| 6 | Account e profili reali | PLANNED |
| 7 | Lobby / Groups | PLANNED |
| 8 | Recommendation / Intelligence 2.0 | PLANNED |
| 9 | Community | PLANNED, dopo utenti e gruppi stabili |
| 10 | Productization | PLANNED, prima dell’apertura pubblica |

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

**Priorità operativa corrente.** Audit AS-IS e design/simulazione completati;
[core Model B + G4 protetto](RECOMMENDATION_ENGINE.md) **IMPLEMENTED LOCALLY /
NOT YET CONSUMER-INTEGRATED**. Nessuna release del motore; produzione v61
invariata. Integrazione delle superfici **PLANNED**, progressivamente sui dati
realmente disponibili; non assumere che tutti i segnali elencati siano persistiti.

Segnali candidati **EXPLORATORY**: storico personale, voti personali, visioni
Together, voti N+V, generi, registi, cast, anno, durata, collection/saghe,
watchlist, preferenze implicite, contenuti proposti/rifiutati, disponibilità
streaming e contesto della serata; in futuro mood e tempo disponibile.
Un voto assente è distinto da zero; una dichiarazione seen non prova una data
di visione. I metadati/provider disponibili non garantiscono una copertura
completa o aggiornata della disponibilità streaming.

Separare due domande:

| Ambito | Domanda |
| --- | --- |
| Personal recommendation | «Cosa potrebbe piacere a questo utente?» |
| Group recommendation | «Cosa potrebbe funzionare per questo gruppo?» |

L’algoritmo futuro non deve basarsi esclusivamente sulle colonne N/V.
La versione privata può adattare quei dati a identità utente e contesto gruppo
senza migrare subito il DB. Cosa Guardiamo?, Ruota e Match Live
potranno progressivamente essere superfici dello stesso Recommendation/Decision
Engine. Questa convergenza è futura; il contratto Match corrente resta valido.

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
