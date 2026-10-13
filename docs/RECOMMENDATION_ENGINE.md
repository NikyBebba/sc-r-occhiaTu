# Recommendation Engine v1 — pure core

**IMPLEMENTED LOCALLY / NOT YET CONSUMER-INTEGRATED:** checkpoint di
implementazione STEP 3 della Fase 1. STEP 3B consolida il codice in Git,
senza integrazione consumer o release runtime.
Produzione invariata: runtime v61, baseline repository
`c0037f8b979c0ef866eba02fc191c3becf53ba28`. I nuovi moduli non sono caricati
da `index.html` e non sono nella cache PWA. Nessun deploy in STEP 3B.
Home/Cosa Guardiamo?, Ruota, Match Live e tutti gli altri consumer restano AS-IS.

## Moduli e API

- [config](../js/recommendation/config.js): default immutabili e versionati.
- [core](../js/recommendation/core.js): funzioni pure, indipendenti dal modello N/V.
- [adapters](../js/recommendation/adapters.js): traduzione esplicita dello schema corrente.
- [test sintetici](../scripts/verify-recommendation.js): nessun export personale.

Le API principali sono `RecommendationEngine.recommend(context, config)` e
`RecommendationEngine.rerank(rankedResults, size, config)`. CommonJS per i test;
script classici, nell'ordine config/core/adapters, per un eventuale caricamento
futuro. Nessun bundler o dipendenza nuova. Il core non legge DOM, storage,
Supabase, globali UI, orologio corrente, randomness o API esterne.

```js
const context = {
  users: [{ id: 'user-a' }, { id: 'user-b' }],
  group: { id: 'group-a' },
  asOf: '2026-01-15T00:00:00Z',
  candidates: [{ movieId: 'film-a', title: 'Film sintetico',
    inSharedList: true, cinema: false }],
  contentFeatures: { 'film-a': { genres: ['Dramma'], directors: ['Regista'],
    cast: ['Attore'], runtimeMinutes: 110, releaseYear: 2005, collectionId: null } },
  personalSignals: { 'user-a': { ratings: [], match: [], seen: [] }, 'user-b': {} },
  sharedSignals: { ratings: [], events: [], completedMovieIds: [] },
  constraints: { context: 'streaming', maxRuntimeMinutes: 120 }
};
const ranked = RecommendationEngine.recommend(context, RecommendationConfig);
const shortlist = RecommendationEngine.rerank(ranked, 5, RecommendationConfig);
```

La v1 richiede **esattamente due utenti**, entrambi con ID opachi: zero, uno o
più di due sono rifiutati anche da `aggregateGroup`. `supportedGroupSize=2` non
può essere cambiato per aggirare questo contratto. ID non vuoti sono preservati
esattamente, senza normalizzazione testuale che perda le chiavi dei segnali.
`contentFeatures` comprende anche lo storico non candidato. Rating:
`{contentId, value}`. Match: `{contentId, sessionId, liked, createdAt}`;
`liked` booleano e timestamp esplicito con timezone. Eventi:
`{movieId, status}`. `asOf` è obbligatorio: timestamp zonato o millisecondi epoch
validi. Nessun fallback a Date.now. Timestamp Match invalidi non creano evidenza;
date future hanno freshness limitata a uno. Il chiamante deve selezionare i dati
appropriati alla data di una valutazione storica.

Output: `movieId`, `title`, `personal[userId]`, `group`, `reasons`, `metadata` e
feature normalizzate per il reranking. Metadata include model/config version,
asOf normalizzato UTC e provenance delle osservazioni deduplicate. Nessuna azione
di persistenza o programmazione. Le funzioni di normalizzazione/profile/group
sono esportate anche per test numerici; `buildProfile` richiede feature già
normalizzate e asOf esplicito.

## Eligibility

Shared list → no Together completed → no proposed/confirmed → contesto →
constraint espliciti → dedup → suitability → ranking. Movie ID duplicati
equivalenti collassano; duplicati conflittuali sono rifiutati, senza scegliere
in base all'ordine di input. Contesto iniziale `streaming`; anche `cinema`/`all`.

Seen personale, anche di entrambi, non esclude. Cancelled/skipped non sono
dislike. Generi richiesti: OR sui nomi normalizzati; durata: min/max inclusivi.
Se un constraint richiede un metadato mancante, il candidato è escluso: non viene
dichiarato compatibile. `excludeMovieIds` è un'esclusione esplicita del chiamante,
non una derivazione dal vecchio Veto. Nessuna availability verificata promessa.

Surprise e Veto sono **DEPRECATED / TARGET REMOVE**, ma rimangono nel runtime
AS-IS; l'adapter non li espone. Il core non usa `choiceEligible()`. Match Nope
resta un feedback contestuale distinto e non è un'esclusione permanente.

## Personal Model B

Genre/director/cast normalizzati testualmente e deduplicati, senza ID personali
canonici inventati. Registi multipli supportati; cast limitato ai nomi ricevuti,
senza otto osservazioni per otto attori. Runtime valido nei bucket <100,
100–119, 120–149, >=150; era per decennio; collection con ID TMDb positivo.
Missing: affinity/confidence zero, nessuna rinormalizzazione delle altre famiglie.

Centro = `(sum(rating) + tau * anchor) / (n + tau)`; zero rating è valido.
Signal = clamp di `(rating - center) / scale` in [-1,+1]. Anchor 7 e tau 12
sono **parametri empirici iniziali**, non verità sul gradimento o sulla scala.
Un segnale sotto il centro significa relativo sotto riferimento, non "detestato".
Nessun rating usa l'anchor internamente senza creare massa.

Massa divisa fra token di ogni famiglia. Token affinity = signedMass /
`(evidenceMass + lambda)`; confidence token = evidenceMass / stesso denominatore.
Score = 5 + 5 × somma delle affinità medie pesate per famiglia. Confidence =
confidence feature pesata × totalMass / `(totalMass + profileLambda)`.
**Compatibility index, non prossimo voto previsto. Confidence euristica, non
probabilità calibrata.** Score/confidence bounded, missing non premiato.

Rating diretto del candidato: stato `observed`, confidence 0,95 configurata,
reason factual con valore originale. Prediction: `weak` sotto 0,2, altrimenti
`estimated`; soglia configurabile. Confidence zero: `unknown`, score pubblico
null e internalScore 5. Seen e testi delle recensioni non producono gusto.

Match è opzionale. Rating prevale sullo stesso contenuto. Swipe deduplicati per
sessione/contenuto, poi collassati per contenuto: signal medio pesato per
freshness, massa massima matchWeight × freshness massima, non somma illimitata.
Conflitti nella stessa risposta o rating duplicati differenti sono errori di
input. I support ID sono contenuti distinti. Nessun CSV nel prodotto.

## G4 protetto e shared evidence

Confidence bilanciata = minimo personale. Base = 5 + confidence bilanciata ×
`(media score interni - 5 - beta * range)`. Nessuna media pesata per confidence.
Negative evidence = min di zero e `confidence * (score - 5)` di ogni utente;
se negativa, base limitata superiormente a 5 + negative evidence.
Simmetria rispetto all'identità degli utenti; nessun peso maggiore per più dati.

Together ha un profilo distinto con la stessa normalizzazione dei rating; non
trasferisce voti a utenti. Completed è esposizione/eligibility, non gradimento.
Contributo = togetherWeight × confidence condivisa × delta score, con cap.
Accordo Match: ultima sessione con risposte di tutti gli utenti forniti;
timestamp ultimo e ID sessione come tie-break. All Like/All Nope contribuiscono
separatamente, divergenti zero. Questo contributo diretto si aggiunge all'evidenza
contestuale personale: due livelli intenzionali e dichiarati, non due rating.

Forte negativo: confidence >=0,6 e score interno <4; Together/Match positivi
sono soppressi, quelli negativi conservati. Reasons riportano contributo applicato
zero e `suppressed` quando necessario. Nessuna esclusione/Veto implicita.
Group confidence è il minimo personale; `sharedEvidenceConfidence` riferisce
affinità Together, `sharedContextFreshness` la recency dell'accordo Match:
freshness non è confidence di gusto. Aggregazione per due utenti opachi;
semantiche per un utente o gruppi maggiori richiedono un futuro modello validato.

## Config e reasons

Model `B-G4-protected-v1`, config `v1.0.0`. Tutti i pesi, soglie e bucket vivono
in config. Famiglie 0,30/0,20/0,10/0,15/0,10/0,15; rating 1; Match 0,25,
magnitude 0,5, half-life 14 giorni; scale 2,5; lambda feature/profile 3/4;
Together 0,4, cap 0,2; Double Like +0,03, Double Nope -0,04; beta 0,5.
Seen e quality prior zero: valori nonzero rifiutati in questa v1. Nessun parsing
quality necessario, nessun rating esterno aumenta score o confidence.
Modifiche future ai parametri devono aggiornare esplicitamente configVersion.

Reasons strutturate factual/inferred, persona/gruppo, token, polarity relativa,
support ID unici, rating/context support, massa, strength, confidence e contributo.
Affinità nominali richiedono supporto attribuibile al singolo token su almeno due
contenuti, affinity >0,01, confidence >0,02 e contributo assoluto >=0,001.
Collection **rated** richiede almeno due contenuti con rating, non soli Match.
Nessun nome attore dedotto dalla famiglia cast aggregata. Nessuna promessa di
"genere preferito", "scelta sicura" o "vi piacerà". Rating osservati e constraint
possono avere reason factual con un solo contenuto; Together diretto è factual.

## Reranking e adapter

Ranking stabile: group score decrescente, titolo normalizzato, movie ID;
nessun altro tie-break di gusto implicito. Reranking separato sui primi 30,
ordinamento suitability ricostruito prima del limite del pool, anche se l'input
è permutato. Duplicati equivalenti collassano; risultati duplicati conflittuali
sono rifiutati. Greedy deterministico: overlap generi ×0,03, regista ripetuto ×0,03, cap una
collection, default cinque. `group.score` invariato; `presentationScore`,
`diversityAdjustment` e reason `DIVERSITY_SELECTION` separati. Pool insufficiente
o cap impediscono cinque: meno elementi, senza duplicazione o rilassamento.
Nessun novelty bonus/exploration slot automatico.

`RecommendationAdapters.fromMovies({movies, movieNights, matchHistory?, asOf,
userIds?, groupId?, constraints?})` traduce N/V; mapping di default N/V, sostituibile
con ID opachi. Dataset completo per profili, candidatura per eligibility. Seen
personali/review preservate come descrizione, non preferenza. Non legge globali
e non fa I/O. Nessuna migration USER/GROUP né modifica Auth/RLS.

## Verifica

`node scripts/verify-recommendation.js`: fixture sintetiche, formule numeriche,
rating zero, cold start, cast mass, Match, shared, eligibility, reasons nominali,
diversity, input congelati, permutazioni e invarianti. I probe personali restano
temporanei fuori repository. Lo snapshot storico STEP 2 produce 90 candidati e
la stessa top 10/shortlist cinque, senza differenze materiali di scoring; reasons
più rigorose per token e freshness separata dalla confidence.

La produzione rimane v61. NAV-01 OPEN/non riprodotto e debito Tailwind offline
invariati; nessun fix attribuito al motore. Roadmap Fase 1 continua con futura
integrazione Cosa Guardiamo?, poi Ruota, poi creazione nuovi deck Match.
