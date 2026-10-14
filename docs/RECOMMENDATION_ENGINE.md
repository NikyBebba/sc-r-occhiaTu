# Recommendation Engine v2 — stable preference core

**CURRENT — IMPLEMENTED + RELEASED + PRODUCTION v62.** Il Core v2
`stable-G4-polarity-v2 / v2.0.0` è semanticamente frozen ed è il motore runtime
del primo consumer `Cosa Guardiamo?`. Release SHA
`a7d1f827c71e60c00aa72d6cf61f69642c80fc91`; cache/service worker v62. Ruota e
Match Live restano indipendenti. Il DB Preference è live; i client precedenti a
v62 devono aggiornarsi prima di modificare preference. Le preference live già
esistenti sono dati reali e non vanno azzerate da cleanup, restore o reimport.

Checkpoint storico: STEP 3B `635f17e2b2e03c5386f0b0e446aeb3e4923ee474`, originale
STEP 3 `c0037f8b979c0ef866eba02fc191c3becf53ba28`. Model B/G4 v1 con learning
Match è una baseline storica superata, disponibile in Git per il confronto.

## HISTORICAL — T0 e separazione architetturale al checkpoint pre-consumer

T0: **2026-10-13 08:30:34.517453 UTC**. Cleanup concluso manualmente dall'utente,
audit 14/14 PASS: eliminate 12 sessioni, 32 swipe e 32 cancelled di test;
conservate tre completed, rating/review/seen reali. Non reimportare quei dati.
[Checkpoint T0](MASTER_CONTEXT.md#data-cleanup-pre-recommendation--concluso--baseline-t0).

Post-T0 Match è REAL SESSION DECISION DATA, non stable taste. I dati vengono
preservati dal runtime e dal DB; il Recommendation adapter non li proietta e il
Core non li legge. Nessun decay/freshness/session agreement nel modello stabile.
Personal Like + Match Nope e Personal Dislike + Match Like sono stati validi.

Stable personal learning → profili individuali → Couple Recommendation →
compatibilità/ranking → consumer Cosa Guardiamo? v62 → eventuali nuovi deck
Match → scelta della sessione → visione → eventuale feedback stabile esplicito.
Un deck già attivo non viene mutato dal Core. Session Context Model è fuori scope.
User-centric profiles e composizione di gruppi rimangono
[DEFERRED / ARCHITECTURE-READY](ARCHITECTURE_VISION.md): applicazione/adapter N/V,
learning parametrizzato per ID opaco e aggregation distinta, nessuna migration multi-user.

## Source of truth

| Dato | Personal stable taste | Shared taste | Altri usi |
|---|---|---|---|
| Personal Rating | sì, observation primaria | no | feedback, non richiede Seen |
| Explicit Personal Preference | sì, solo senza rating | no | TRUE/FALSE/NULL; nessun rating sintetico |
| Seen N/V | no | no | esposizione, massa gusto zero |
| Personal Review | no scoring | no | testo, nessun NLP |
| Shared list | no | no | candidate pool primaria |
| Completed Together | no | no | esposizione/eligibility |
| Together Rating | no | sì | canale/profilo distinto |
| Together Review | no | no scoring | testo |
| Match Like/Nope, Double Like/Nope, disagreement | no | no | session history preservata fuori Core |
| proposed/confirmed | no | no | esclusione operativa |
| cancelled/skipped | no | no | eventi; non esclusione o dislike |
| legacy votes/vetoes | no | no | esclusi dal Core, runtime preservato |

## API e adapter

[config](../js/recommendation/config.js), [core](../js/recommendation/core.js),
[adapter](../js/recommendation/adapters.js). Pure functions; niente I/O, DOM,
storage, Supabase, globali applicativi, current time o randomness. CommonJS nei
test e script classici config/core/adapters per un futuro consumer; nessun bundler.

`recommend(context, config)` e `rerank(results, size, config)` restano invariati.
`buildProfile(signals, normalizedFeatures, ignoredAsOf, config)` conserva il terzo
argomento per compatibilità ma non lo consuma. `asOf` non è più richiesto né
restituito nei metadata: la selezione di uno snapshot storico è responsabilità
del chiamante, non un decay del gusto. Profile learning non dipende da due utenti;
recommend/aggregateGroup mantengono esattamente due ID distinti opachi.

```js
const context = {
  users: [{ id: 'user-a' }, { id: 'user-b' }], group: { id: 'group-a' },
  candidates: [{ movieId: 'film-a', title: 'Sintetico', inSharedList: true, cinema: false }],
  contentFeatures: { 'film-a': { genres: ['Dramma'], directors: ['Regista'],
    cast: ['Attore'], runtimeMinutes: 110, releaseYear: 2005, collectionId: null } },
  personalSignals: { 'user-a': { ratings: [], preferences: [{contentId:'film-a',value:false}] }, 'user-b': {} },
  sharedSignals: { ratings: [], events: [], completedMovieIds: [] }, constraints: {context:'streaming'}
};
const ranked = RecommendationEngine.recommend(context);
const shortlist = RecommendationEngine.rerank(ranked, 5);
```

Adapter `fromMovies({movies, movieNights?, userIds?, groupId?, constraints?})` usa
l'intero catalogo per imparare, candidatura per filtrare. Mappa `seen_rating_n/v`,
`personal_liked_n/v`, Together rating, feature ed eventi. FALSE preservato;
missing/NULL/valori non booleani = nessuna preference. Non deriva preference da
rating/Seen/testo/Match. Con rating valido ignora una preference anche incoerente.
Reviews/Seen sono descrizione non scoring. Timestamp preference non necessario:
nessun decay. ID opachi, token/dataset ordinati, duplicati equivalenti deduplicati,
conflitti di rating/candidate/preference effettiva rifiutati. Preference storiche
conflittuali sul contenuto rated vengono ignorate perché non attive.

## Observation e rating transform

Una sola observation effettiva user/movie: valid rating > manual preference >
unknown. Rating 0 valido; numeric finito 0–10 con al massimo un decimale.
DB/store cancellano preference con save/edit/remove rating; il Core non conserva
vecchie preference da ripristinare: lo snapshot dopo rimozione contiene NULL.

Polarità definitiva: `<5.5 NEGATIVE`, `>=5.5 && <7 NEUTRAL`, `>=7 POSITIVE`.
Non materializzata nel DB; derivata deterministicamente anche sui boundary
5.0/5.4/5.5/6.0/6.5/6.9/7.0/8.0/9.5 e zero/dieci.

```
center = (sumRatings + 12*7)/(nRatings+12)
relativeRatingAffinity = clamp((rating-center)/2.5,-1,1)
absoluteSignal = clamp((rating-6.25)/3.75,-1,1)
stableSignal = 0                        se NEUTRAL
             = absoluteSignal+.10*relative altrimenti
POSITIVE: clamp(stableSignal,0,1); NEGATIVE: clamp(stableSignal,-1,0)
```

F1 risolto: 19×9.5 + 8 → center 8.515625, relativo -0.20625, polarità POSITIVE,
stableSignal 0.4460416667, compatibility index 7.2302083333; vecchio indice 3.96875.
Nessuna negative protection generata da quel rating sotto media.

Preference TRUE/FALSE = direzione +1/-1, massa .50. Rating massa 1. Nessun decay.
Neutral rating conserva massa/conoscenza pur avendo direzione zero. Valori osservati
non trasformati in altri voti. `observedRating`, `observedPreference`,
`absolutePolarity`, `relativeRatingAffinity`, `stableSignal` e `provenance` separati.
`score` è alias compatibile di `compatibilityIndex`, **non voto previsto**.
Rating diretto: indice `5+5*stableSignal`, confidence .95.
Preference diretta: indice `5+5*direction*(.50/(.50+3))`, confidence
`.95*(.50/(.50+3))`; Like 5.7142857, Dislike 4.2857143, confidence .1357143.
Sono indici del modello, non rating sintetici 5.7/4.3 dell'utente.

## Feature inference e confidence

Famiglie invariate: genre .30, director .20, cast .10, runtime .15, era .10,
collection .15. Token normalizzati/deduplicati; runtime <100/100–119/120–149/≥150,
era per decennio, collection TMDb positiva. Missing non rinormalizza i pesi.
Ogni observation distribuisce massa sui token della famiglia, senza moltiplicarla
per numero di attori. Supporto da rating/preference personali esclusivamente.

Affinity token = signedMass/(evidenceMass+3); confidence token = mass/(mass+3).
Indice interno = 5+5×somma delle affinità medie pesate. Confidence predittiva =
confidence feature pesata × totalMass/(totalMass+4). Nessuno shrinkage supplementare
sulla direzione della preference prima di accumularla. Singola observation produce
confidenza inferita bassa intenzionale; crescita/supporto pertinente sono testati.

Reliability dell'observation esplicita: .95 euristico sia rating sia preference;
information richness: massa 1/.50. Confidence predittiva e group confidence sono
campi distinti da reliability e richness, non probabilità calibrate.
Stati: OBSERVED per declaration diretta; UNKNOWN senza supporto pertinente,
score/compatibilityIndex NULL e confidence 0; LOW_EVIDENCE se confidence >0 ma <.2,
indice pubblico NULL, interno disponibile; INFERRED se confidence ≥.2.
Rating 6 è OBSERVED/NEUTRAL, observedRating=6, indice=5, confidence>0: non Unknown.

## Shared Together e least misery

Together Rating costruisce un profilo separato, con la stessa trasformazione dei
rating. Non distribuito nei profili N/V. Contributo = `.40*cShared*(indexShared-5)`,
limitato a ±.20. Completed alone/testo non generano taste/confidence.

Base = `5 + min(cN,cV)*(min(indexN,indexV)-5)`. Nessuna media ponderata dalla
quantità di dati. Più observation aumenta conoscenza, non peso politico. Swap
N/V produce risultati di coppia equivalenti. Mutual-upside non implementato.
Group confidence = min personale; sharedEvidenceConfidence separata.

Protezione moderata **provisional**: cap suitability a 4 quando esiste negative
direct observation con absolute polarity NEGATIVE e reliability ≥.6, oppure
prediction INFERRED con indice <4 e confidence ≥.6. Per direct categorical il
criterio è reliability della dichiarazione, non finta ricchezza quantitativa.
Together positivo viene soppresso, negativo conservato. `negativeProtectionApplied`
è vero solo se il cap o la soppressione ha effetto; contributi/suppressed tracciati.
Un Dislike diretto può quindi limitare a 4 anche con peer Unknown; group confidence
resta zero. Scelta conservativa esplicita da validare, non un veto o esclusione.

## Eligibility, reasons e diversity

Shared list obbligatoria. Completed/proposed/confirmed esclusi; Seen di N/V/entrambi,
cancelled/skipped e Dislike non esclusi. Constraint espliciti genre OR, durata
inclusiva, contesto streaming/cinema/all, excludeMovieIds. Metadato mancante richiesto
→ esclusione; niente fallback fuori Lista o rilassamento. Empty pool → empty result.
Surprise/Veto/external quality non modificano questo Core; runtime preservato.

Reasons: PERSONAL_RATING_POSITIVE/NEUTRAL/NEGATIVE, EXPLICIT_LIKE/DISLIKE,
TOGETHER_RATING, FEATURE_AFFINITY, UNKNOWN, LOW_EVIDENCE, NEGATIVE_PROTECTION;
anche SHARED_LIST_CANDIDATE, RUNTIME_CONTEXT e DIVERSITY_SELECTION pertinenti.
Factual/inferred/status/model, IDs/supporto unici, rating/preference support,
massa e contributo. UNKNOWN/LOW_EVIDENCE sono stato, non finta evidenza.
Nomi di feature solo con supporto per token ≥2, affinity >.01, confidence >.02,
contributo ≥.001. Sotto questi limiti resta eventuale provenance aggregata senza
claim nominali, così un contributo reale non perde attribuzione. Collection può
usare rating **o** preference, mai Match/Seen. Shared suppression: contributo
applicato zero e flag, senza reason cosmetiche o Match reasons.

Ranking: suitability decrescente, titolo normalizzato, ID. Diversity invariata:
finestra iniziale 30, genere/regista penalty .03/.03, una entry per collection,
shortlist default 5. `group.score` invariato; presentationScore separato.
**Limiti noti:** finestra iniziale soltanto; collection cap può lasciare meno di
cinque, senza espansione/relaxation automatica. Nessun redesign in Phase 5.

## Config baseline sperimentale e verifica

Model `stable-G4-polarity-v2`, config `v2.0.0`. Parametri sopra configurabili salvo
soglie semantiche prodotto 5.5/7; override dei vecchi parametri Match rifiutati,
nessun parametro Match attivo. Pesi, transform, confidence, Together e cap restano
baseline sperimentali, non calibrati definitivamente. Modifiche richiedono versioning.

`node scripts/verify-recommendation.js`: 132 controlli, inclusi I1–I14, boundary/F1,
unknown/neutral, no double counting, Match getter mai letto, density/swap,
purity, determinismo, eligibility, supporto, shrinkage e diversity.
`node scripts/verify-recommendation-calibration.js`: seed **20261013**, baseline v1
letta da Git al checkpoint STEP 3B, 437 film sintetici/48 candidati, 20 rating N,
7 V, 3 Together; progressioni preference N 0/25/50/100/200, V 0/5/10/20/20.
Nessun dato personale live o export. Confronta overlap, Spearman, coverage pubblica,
confidence media, swap e Match invariance; la coverage v1 includeva anche weak
scores, quindi non è confrontabile come qualità della previsione.

| Preference N/V | Top10 overlap v1/v2 | Spearman | Coverage v2 N/V su 48 | Mean confidence v2 N/V |
|---|---:|---:|---|---|
| 0/0 | 3/10 | .218 | 38/5 | .289/.108 |
| 25/5 | 2/10 | -.453 | 41/10 | .398/.142 |
| 50/10 | 1/10 | -.478 | 41/21 | .467/.181 |
| 100/20 | 1/10 | -.308 | 41/41 | .541/.241 |
| 200/20 | 1/10 | -.308 | 41/41 | .612/.241 |

Match changes e swap producono output di coppia IDENTICAL in tutti gli scenari.
I cambiamenti di ranking sono delta semantici documentati, non ottimizzati per
una metrica sintetica. Questi test dimostrano coerenza, invarianti, matematica,
regressioni e determinismo; **non** predictive accuracy, soddisfazione o qualità
reale. Serviranno feedback post-rollout e validazione consumer separata.

NAV-01 OPEN/non riprodotto e debito Tailwind offline restano invariati.
La Phase 6 integra ora Cosa Guardiamo? come primo consumer; generazione deck
Match resta separata e Session Context Model fuori scope, da valutare solo se
giustificato.

## CURRENT — consumer Cosa Guardiamo? (release v62)

La vista `Cosa guardiamo?` è il primo consumer runtime del modello
`stable-G4-polarity-v2 / v2.0.0`. Il percorso è Store già pronto →
`RecommendationAdapters.fromMovies` → `RecommendationEngine.recommend` e
`RecommendationEngine.rerank` → renderer consumer. L’adapter riceve N, V,
Together, feature ed eventi dalla memoria Store corrente; nessun fetch/cache
separato e nessun dato Match/legacy.

I candidati provengono soltanto da `in_shared_list`; `context: all` mantiene
Streaming e Cinema disponibili, senza filtri consumer preesistenti da trasferire.
Core esclude completed e serate proposed/confirmed. Seen, Dislike, cancelled e
skipped non diventano esclusioni o segnali positivi. Gli output sono mostrati
nell’ordine prodotto dal Core, in batch deterministici da cinque; Altri
suggerimenti invoca di nuovo il Core escludendo gli ID già presentati. UNKNOWN,
LOW_EVIDENCE, INFERRED e OBSERVED hanno presentazioni distinte; non si mostrano
score grezzi, percentuali o `5/10` sintetici. Le reason UI sono proiezioni delle
reason strutturate restituite dal Core.

Aprire la vista o premere Aggiorna ricalcola. Mentre la vista resta aperta,
Realtime conserva l’ordine visibile e segnala dati cambiati; l’utente aggiorna
esplicitamente. Recensioni testuali non invalidano il ranking. Errori Core sono
isolati alla vista, senza algoritmo alternativo. Benchmark sintetico a 437 film
misura separatamente adapter, profili, recommend, diversity e DOM render; non
dimostra qualità predittiva reale. Le prove browser Chromium/WebKit usano fixture
sintetiche.

La lista precache di `service-worker.js` include i moduli recommendation e v62 è
la cache in produzione. `index.html` e service worker sono stati rilasciati
insieme per evitare shell/moduli disallineati. Il sanity check live è stato
eseguito solo con GET, senza mutation: 437 movies, 91 shared-list, 3 completed,
preference N=1/V=0 allo snapshot. Il ranking è risultato strutturalmente
coerente; neutral, Unknown e negative protection non sono stati esercitati dai
candidati live e restano coperti dai test sintetici. Il controllo fairness
inizialmente segnalato dal verificatore non costituiva evidenza di bug Core.
Nessuna ricalibrazione è stata richiesta. Questo controllo, come i test
sintetici, non dimostra qualità predittiva reale.

Il pulsante “Torna alla home” della vista recommendation ora riusa integralmente
il testo e il pattern `dashboard-back` degli altri pulsanti equivalenti. Il
shell v62 precache include
`/js/recommendation/config.js`, `/js/recommendation/core.js`,
`/js/recommendation/adapters.js` e `/js/ui/recommendations.js`. Recommendation
rimane non integrato in Match Live,
Ruota o altre superfici.
