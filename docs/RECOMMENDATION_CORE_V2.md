# Recommendation Core 2.0 — local milestone 2

Contract: `recommendation-core-v2`. Implementation `js/recommendation/ranking-v2.js`; optional pure input bridge `ranking-v2-input.js`. Neither is loaded in index.html or the service worker. The frozen v75 core, adapter, consumer, and taste-profile-v1 files are preserved.

Optional local batch experiment: `diversityVersion:'near-relevance-v1'` constrains diversification to `config.relevanceWindow` (default .02) below the best remaining base score in the existing protection tier. Default `unbounded-v1` selection is preserved. `experiments.legacyV1` and `experiments.constrainedV1` are exported versioned presets. See [paired ranking validation](RECOMMENDATION_DIVERSITY_VALIDATION.md) for exact diagnosis, tables, sensitivity and diversity regressions; this experiment is not promoted as a new default.

## Input

`RecommendationCoreV2.recommend({profiles,candidates,context,config?,shownIds?,batchSize?})`.

- `profiles`: real `taste-profile-v1` output, exactly two opaque personal IDs and a distinct Together profile.
- `candidates`: `{id,features,inSharedList,inCatalog,completedTogether,activeNight,seenBy?,judgments?,togetherJudgment?}`. IDs are nonempty strings. Features use v75 adapter names: genres, directors, cast, runtimeMinutes, releaseYear, collectionId.
- `judgments[personId]`: optional authoritative `{rating,preference,ratingConflict,preferenceConflict}`. Rating wins over preference, including neutral; rating conflicts block fallback. Together accepts rating/ratingConflict only; preference fields are ignored.
- `context.mode`: `list` requires shared membership; `discovery` excludes catalog contents. Both exclude completed Together and active proposed/confirmed nights. Personal seen is not taste or an exclusion.
- `shownIds`: explicit session state; batch IDs are returned in `nextShownIds`. The core has no internal session, clock, randomness or I/O.
- `config`: validated finite deterministic parameters. Unknown names are rejected. Defaults are experimental, not empirical calibration. `batchSize` defaults to five.

`RecommendationCoreV2Input.fromProjection(projection, context?)` actually consumes a v75 adapter projection, calls TasteProfiles normalization/build, and supplies candidate judgments, event flags and recorded personal exposure. It performs no reads beyond the passed object. It can be used for local comparison; it is not wired to the application.

### Important profile information boundary

TasteProfiles stores direct provenance only inside feature rows. With no metadata it counts a judgment but cannot expose its movie ID/polarity. Optional candidate judgments preserve this information from the already existing projection, without changing Milestone 1. If these are omitted, the core recovers direct evidence from profile provenance where possible. `directEvidenceComplete` reports whether all personal candidate channels were explicitly supplied; it does not assert a judgment exists. No guarantee of protecting an unavailable direct negative is made on profile-only input. Supply the bridge or equivalent authoritative candidate channels for full direct protection.

## Individual scoring and support

For inferred feature rows with at least two observations, reliability is `distinct supporting movies / (distinct supporting movies + 3)`. A matching token contributes `familyWeight × profile.direction × reliability / candidateTokenCount`. Missing families are zero, never reweighted. Confidence sums the same reliability terms without direction; it is a heuristic support index, not a probability. Metadata coverage reports available base families divided by six.

Base family budgets: genre .30, director .20, cast .10, runtime .15, decade .10, collection .15. Supported genre pairs replace the genre family for that candidate instead of adding another budget. Matching actors/directors share their fixed family budget, so a long cast cannot multiply it. Evidence movie IDs are deduplicated. Correlations across other families remain a limitation; reasons must not be read as independent statistical tests.

Observed judgments use the exact polarity/intensity semantics of TasteProfiles: negative below 5.5, neutral until 7, positive from 7; negative intensity `(5.5-r)/5.5`, positive `(r-6.5)/3.5`, neutral zero, boolean preference intensity one. Observed support confidence is one for an explicit declaration, not certainty about future enjoyment. Profile conflicts suppress the affected candidate/channel conservatively. Supplied rating conflicts and preference conflicts respect precedence.

## Group score and exclusions

The group base is the minimum personal affinity. Unknown/conflict remains zero and is never filled from the peer. Inferred negative affinity with confidence below .30 is not applied to the group base. Supported inferred affinity at or below -.20 with confidence at least .30 marks `inferredProtected` for batch priority. Strong direct negative intensity at least .50 excludes the candidate (`STRONG_NEGATIVE:<personId>`). With the current rating transform this includes ratings at most 2.7 and explicit Dislike; milder explicit negatives still reduce the minimum. These thresholds require product/empirical review before integration.

Together is estimated independently. It only breaks equal personal scores and cannot add positive tie-break value when either individual affinity is negative. It never alters individual profiles or confidence. Ranking tie-break order: group base, Together, stable ID.

Returned `excluded` lists IDs, personal/Together evidence and codes: conflicting candidate, not in list, already in catalog, active night, already Together, already shown, or strong direct negative. Equivalent candidates collapse after feature normalization. Conflicting duplicates are excluded without choosing which is newer. External retrieval, provider availability, surprise/veto and existing product features are outside this module.

## Reasons, output and batches

Output includes contract/config, relevance-ordered `ranked`, `excluded`, selected `batch`, and `nextShownIds`. Each row includes separate personal results, Together, support/confidence, base score, tie-break, metadata coverage, features and structured reasons. Reasons have explicit personal/together scope; personal scope carries an opaque personId. Feature reasons contain family, token, direction, support, contribution and evidence IDs. Direct reasons contain source and candidate ID. Unknown and conflict produce explicit neutral status reasons. No UI prose or compatibility percentage is generated.

Batch presentation applies .06 penalties for each repeated collection, repeated director and genre Jaccard overlap against selected items. A .02 bonus favors no *recorded* personal exposure; it cannot prove the movie is unseen. Collection limits are soft and may repeat franchises when the pool is narrow. Confident inferred negative items have lower batch priority than unprotected ones; excluded direct negatives never enter a batch. `batch` records selection index, diversity penalty and presentation score separately from relevance. Explicit shown IDs prevent repetition across batches. A changed snapshot must be reranked by the caller.

## Verification and offline benchmark

Commands:

```
node scripts/verify-recommendation-ranking-v2.cjs
node scripts/benchmark-recommendation-ranking-v2.cjs
node scripts/verify-recommendation-profiles.cjs
node scripts/verify-recommendation.js
git diff --check
```

The benchmark calls the actual frozen adapter, builds real profiles via the new bridge, and compares against the frozen v75 core. It uses 40 synthetic training movies and 20 held-out candidates per scenario plus a known direct-negative probe. Truth remains outside both model inputs. Both models rank exactly the same candidate IDs in the common-pool quality comparison; the new negative exclusion is applied to both pools for this comparison and reported separately as a policy difference. No hidden judgment enters profile building.

Versioned results: `RECOMMENDATION_CORE_V2_BENCHMARK.json`, reproducible with `--write`. Seven scenarios cover balanced/imbalanced evidence, opposed tastes, cold start, sparse candidate metadata, franchise concentration, and narrower held-out taste. Metrics: binary relevance NDCG@5, recall@5, distinct top-five genres/directors, evidence-state coverage, cross-batch repeats, evidence reference validity, order and irrelevant-candidate stability. State coverage definitions differ and are not accuracy measures. No API calls occur.

Balanced, imbalanced and sparse scenarios have NDCG@5 = 1 for both. Opposed has no mutually relevant items, so NDCG/recall are null. Cold-start differences are arbitrary tie ordering. In franchise, v75 returns two rows due to its hard collection cap; Core 2 fills five with soft penalties, so the NDCG increase is partly a different diversity policy. Narrow deliberately penalizes diversification and yields worse quality for Core 2 (see stored numbers). This is a regression to evaluate, not a reason to tune against the fixture.

Synthetic truth is strongly genre-dependent and these seven small cases cannot demonstrate superiority or calibrated prediction. Reason verification checks references and attribution, not human usefulness. No real judgments or snapshots are used. Live evaluation, external retrieval, keyword enrichment, UX, and deployment are not authorized by this local implementation.
