# Milestone 2 — ranking validation, experiment v1

Local synthetic diagnosis. No live data or network. Fixtures and hidden judgments are imported directly from the existing benchmark, not reconstructed. `validate-recommendation-diversity.cjs` asserts that the original seven-scenario report reproduces exactly the saved `RECOMMENDATION_CORE_V2_BENCHMARK.json`. That baseline file is preserved.

## Root cause

In `narrow`, Core 2.0's relevance order already has five relevant movies first. All three variants have exactly equal `ranked` (including individual estimates, Together, confidence and reasons) and equal `excluded`. Thus this particular loss is neither scoring, N/V aggregation, nor eligibility. The unbounded batch selector sums penalties against all previously selected movies, then compares the penalized score across the entire remaining pool. By slot four, genre repetition incurs .18 against candidate-12; candidate-01 pays zero despite losing approximately .12517 in model relevance. A constant novelty bonus of .02 applies to every candidate here, so it cancels and cannot explain the difference. Together and protected tiers are unchanged.

Binary relevance is hidden expected rating >=7. The following table uses the exact original fixture and config; displayed scores are rounded, full values and individual N/V estimates are in the JSON artifact. `Relevance position` is before batch diversification. Current penalties refer to the actual preceding selections in that variant.

| Variant | Relevance position | Candidate | Base relevance | Applied penalty | Final position | Hidden expected rating |
|---|---:|---|---:|---:|---:|---:|
| No diversity | 1 | candidate-00 | .216873 | 0 | 1 | 9 |
| No diversity | 2 | candidate-04 | .216873 | 0 | 2 | 9 |
| No diversity | 3 | candidate-08 | .216873 | 0 | 3 | 9 |
| No diversity | 4 | candidate-12 | .212922 | 0 | 4 | 9 |
| No diversity | 5 | candidate-16 | .209080 | 0 | 5 | 9 |
| Current unbounded | 1 | candidate-00 | .216873 | 0 | 1 | 9 |
| Current unbounded | 2 | candidate-04 | .216873 | .06 | 2 | 9 |
| Current unbounded | 3 | candidate-08 | .216873 | .12 | 3 | 9 |
| Current unbounded | 6 | candidate-01 | .087752 | 0 | 4 | 3 |
| Current unbounded | 7 | candidate-07 | .087752 | 0 | 5 | 3 |
| Constrained v1 | 1 | candidate-00 | .216873 | 0 | 1 | 9 |
| Constrained v1 | 2 | candidate-04 | .216873 | .06 | 2 | 9 |
| Constrained v1 | 3 | candidate-08 | .216873 | .12 | 3 | 9 |
| Constrained v1 | 4 | candidate-12 | .212922 | .18 | 4 | 9 |
| Constrained v1 | 5 | candidate-16 | .209080 | .24 | 5 | 9 |

NDCG@5: no diversity 1; unbounded .7227265726449519; constrained 1. Top-five summed model relevance: 1.0726201828474555 / .8261208488481215 / 1.0726201828474555. The constrained selector still computes penalties but cannot use them to replace a clearly stronger candidate.

## Versioned optional experiment

Default selection remains `diversityVersion: 'unbounded-v1'`, with existing .06 penalty and .02 novelty bonus unchanged. `Core.experiments.legacyV1` selects it explicitly. `Core.experiments.constrainedV1` supplies `{diversityVersion:'near-relevance-v1',config:{relevanceWindow:.02}}`. This is local and opt-in, not production configuration or a promoted default.

At each selection:

1. Preserve the existing inferred-negative protection tier.
2. Find the maximum remaining base relevance in the preferred tier.
3. Permit penalized selection only among rows with relevance at least that maximum minus .02.
4. Use the existing penalized ordering and deterministic tie-break inside this neighborhood.

The .02 is an experimental tolerance in internal model units, not a probability, compatibility percentage, or calibrated prediction error. Its value is an interpretable small relevance budget, not selected by maximizing seven hidden-label scores. Hidden truth is used only by the evaluation script and cannot enter the selector. Batch diagnostics expose `referenceScore` and `relevanceLoss`; tests enforce the local bound, exact ties at zero tolerance, unchanged exclusions, purity and session uniqueness. This is a per-step relevance guarantee, not a guarantee about real enjoyment or NDCG.

## All seven scenarios

| Scenario | No diversity NDCG@5 | Current NDCG@5 | Constrained NDCG@5 | Genres current → constrained | Directors current → constrained |
|---|---:|---:|---:|---:|---:|
| balanced | 1 | 1 | 1 | 3 → 1 | 5 → 5 |
| imbalanced | 1 | 1 | 1 | 3 → 1 | 5 → 5 |
| opposed | N/A | N/A | N/A | 2 → 2 | 5 → 5 |
| cold | .830420 | .830420 | .830420 | 4 → 4 | 5 → 5 |
| sparse | 1 | 1 | 1 | 2 → 2 | 4 → 5 |
| franchise | 1 | 1 | 1 | 3 → 1 | 5 → 5 |
| narrow | 1 | .722727 | 1 | 3 → 1 | 5 → 5 |

No measured NDCG/recall regression against current Core 2.0 in these seven cases. Opposed has no mutually relevant candidates, so these metrics are undefined. Zero repeated movies across paired batches for every variant/scenario. Eligibility, all personal/shared contributions, reason provenance, confidence and evidence coverage are identical across variants. All permutations reproduce identical output.

There are real diversity costs: balanced/imbalanced/franchise/narrow lose two distinct genres; franchise drops from two collections to one. Sparse gains one director. Top-five model relevance increases except opposed/cold (unchanged). These are tradeoffs, not evidence that diversity is universally harmful or that the experiment is globally superior. Balanced and narrow have identical model inputs but different hidden labels: the core cannot know which taste width is correct. A label-perfect narrow result cannot justify a universal narrow recommendation policy.

Sensitivity runs at tolerance 0, .01, .02, .04, .08 and .15 are recorded in the JSON. They are descriptive, not a parameter search to pick the best fixture score. Narrow recovery persists over a neighborhood rather than one exact threshold; larger tolerance can reintroduce the original loss. On unrelated test candidates, exact-score ties still diversify and negative exclusions remain enforced. Further generalization cannot be inferred from seven small closed-form cases. There are no confidence intervals or claims of statistical significance.

## Reproduction

```
node scripts/validate-recommendation-diversity.cjs --write
node scripts/verify-recommendation-diversity.cjs
node scripts/verify-recommendation-ranking-v2.cjs
node scripts/benchmark-recommendation-ranking-v2.cjs
node scripts/verify-recommendation-profiles.cjs
node scripts/verify-recommendation.js
git diff --check
```

`--write` stores the paired/sensitivity report only in `RECOMMENDATION_DIVERSITY_VALIDATION.json`; it does not overwrite the original benchmark. The benchmark script now exports its unchanged fixtures/metrics/run function and emits output only when invoked as a CLI, allowing the experiment to reuse its actual fixtures without duplication.
