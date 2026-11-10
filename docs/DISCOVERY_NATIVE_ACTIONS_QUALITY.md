# Discovery — native actions and recommendation diagnostics (local)

**Aggiornamento locale:** [Six picks, information gate, collective copy and freshness](DISCOVERY_SIX_FRESHNESS.md) sostituisce le sezioni storiche qui sotto su selezione delle reason personali, cinque proposte e quality gate v1.1. Le azioni native e la riconciliazione restano valide. La diagnostica JSON rigenerata distingue ora disponibilità interna e fallback UI senza attribuzioni personali.

This refinement extends the previous native-detail work. It does not start v76 release work or the deferred memories/completed-event unification. All validation uses synthetic fixtures, not personal data or live writer RPCs.

## External actions reuse the actual local components

The standalone Aggiungi alla Lista command is gone. `ProductContext.externalDetailActions` renders the existing detail-intent-group / detail-intent-personal sections and shares `intentButton` with ordinary persisted details. Labels and classes are taken from the local application:

| Section | Exact action | Existing runtime relation |
|---|---|---|
| Per noi | Vorrei vederlo insieme | proposeToGroup |
| Per me | Voglio vederlo | addToMyList |
| Per me | L'ho già visto | recordSeen |

The first two reuse the same intent-action markup, icons, colors and geometry as persisted details. The seen label/icon already exists in personalWatchButtonHtml; the external detail uses the native personal intent geometry. No independent styling, navigation or data state is introduced. Standard Per me controls may legitimately become Voglio rivederlo/Nei tuoi Da vedere after persistence, following the existing ProductContext state rules.

An external movie remains a presentation model with data-external-id, no persisted movie ID, until an explicit native action. All three routes invoke the unchanged `saveContent(details, relation)`: resolve content by TMDb ID, create only if necessary, await authoritative catalog coverage, then execute exactly the selected existing relation. Backend support is demonstrated by the real shell/runtime synthetic integration, not inferred from a mock callback alone.

`getSource().relationState(movieId, relation)` reads the current TARGET facade: effective group candidacy for proposeToGroup; caller-owned personal list for addToMyList; caller-owned seen for recordSeen. Recommendation projection alone cannot confirm a personal list, so it is not used as a substitute. The observed person's UI scope never changes the writing caller's authority.

## Save and reconciliation boundaries

`DiscoverySave` records operations by TMDb ID AND relation. A shared confirmation cannot satisfy a personal action or vice versa. Concurrent/uncertain acquisition of the same film blocks another native action until reconciled; no second content creation is launched in parallel. Buttons keep their native labels during processing and use ordinary disabled/aria-busy plus detail-feedback. An uncertain result exposes only read-only Verifica stato; no writer retry is automatic.

SUCCESS/ALREADY_IN_TARGET_STATE confirms the command, independently of publication delay. The transition to the actual persisted Movie Detail waits for the catalog and *requested relation* to appear authoritatively. PENDING, UNCERTAIN, server ERROR and partial content acquisition retain the previous distinction. If an uncertain creation becomes visible in catalog while its relation was never attempted, the next explicit choice can finish the action through existing deduplication. A generic UI ERROR without server error evidence remains uncertain. A currently existing film opens its real detail without a new acquisition.

The successful transition uses the real returned movie ID and the normal ProductContext controls, preserving modal/story/cast/scroll context. Personal actions never call proposeToGroup, set ratings/preferences, create Together or create nights. recordSeen is exposure only. Personal N and V states remain separate. The backend, migrations, Auth, Match, wheel and night contracts are untouched.

## Reason diagnosis: five distinct layers

`scripts/diagnose-discovery-native.cjs` builds real Adapter → TasteProfiles → Core outputs and stores the synthetic-only audit in DISCOVERY_NATIVE_DIAGNOSTICS.json. Per scenario/candidate it reports observation coverage/families, separate personal affinity/confidence/support, available Core reason counts, renderable channel strengths, the chosen evidence and narrative, and a broad-vs-retrieval-shaped comparison.

Two concrete presentation defects were corrected:

1. Runtime, decade and collection reasons existed but the UI discarded them. If N's relevant evidence was mainly duration while V's was genre, only V could appear. All seven feature families now have checked concrete labels.
2. The .8-of-best display threshold compared raw feature magnitudes across channels even though the group score is prudential and Together has a separate tie-break. It could suppress the positive personal channel actually limiting group relevance, or a Together reason whose tie-break was applied. Display choices now also admit those actual decision-bearing channels, and suppress Together explanations when its positive tie-break was not applied.

The strongest valid feature per channel is retained. Comparable contributions (.8 of strongest), a positive binding personal channel, and an actually applied positive Together tie-break form the deterministic display set. Rotation across cards is identity-neutral; no N/V name quota or invented Together evidence exists. A binding channel is defined from Core affinity values, not from a hardcoded person. The Core scores and eligibility are unchanged.

| Synthetic scenario | Relevant observation coverage | Selected N/V/Together/fallback across six broad candidates | Retrieval-shaped result |
|---|---|---|---|
| balanced | 8 N, 8 V, 4 Together | 2 / 2 / 2 / 0 | same |
| coverage_asymmetric | 20 N Commedia, 3 V Dramma; candidates Dramma | 0 / 6 / 0 / 0 | same; N count is not pertinent support |
| metadata_family_gap | 8 N runtime, 8 V genre | 3 / 3 / 0 / 0 | runtime evidence is now renderable |
| retrieval_overlap | 8 N Commedia, 8 V Dramma | 3 / 3 / 0 / 0 | Dramma-only subset: 0 N / 3 V |

This explains mechanisms that can produce V-heavy screenshots; it does not measure the user's real N/V coverage. Seen/history size contributes no taste mass. No private snapshot was fetched. V-only copy remains correct when no relevant N/Together evidence exists.

## Description and personalization stay distinct

Cards render a short TMDb overview premise (150-character cap) separately from the optional affinity paragraph. Missing overview falls back to factual genres/year/director. The premise is never used to establish a taste relationship.

Affinity requires positive contribution, sufficient support, an actual matching feature, a catalog evidence movie and a positive effective source judgment (rating overrides preference). Runtime bands/decades/collection labels are checked against candidate metadata. Missing or unverifiable evidence yields “Affinità ancora da verificare: pochi giudizi pertinenti.” rather than an attributed liking. Structured diagnostics distinguish this nonpersonalized fallback from a genuine reason.

## Quality Gate audit and bounded correction

The existing gate and its shrinkage/popularity/completeness formula were retained. Nine representative synthetic cases are evaluated at 2026-11-09. Names identify fixture cases, not real critic, auteur, cult or award status. “Quality position” sorts the public gate/enrichment score; “batch” is a separate cold-start Discovery pipeline selection with the existing relevance/diversity/niche-reserve rules. These are deliberately not presented as the same ranking.

| Case | TMDb votes / average | Admitted now | Reason | Quality position | Cold-start batch position |
|---|---:|---|---|---:|---:|
| Pochi voti altissimi | 8 / 9.5 | yes, niche | released, rich metadata, exploratory reserve only | 5 | 5 |
| Recente poco consolidato | 55 / 8.7 | yes, recent | released, >=50 votes and >=6.2 | 3 | 1 |
| Popolare mediocre | 6000 / 5.6 | **no** | count/popularity cannot bypass minimum public average | — | — |
| Classico consolidato | 1500 / 8.2 | yes, classic | older release and supported public rating | 1 | 2 |
| Autore poco votato (hypothetical) | 35 / 7.8 | yes, classic | >=30 votes and older release, no auteur claim inferred | 4 | 3 |
| Internazionale di nicchia | 12 / 8.1 | yes, niche | original language unrestricted; low-support reserve | 6 | — |
| Senza reputazione | 0 / 10 | no | no public support despite high popularity | — | — |
| Futuro | 1000 / 8 | no | not released | — | — |
| Medio consolidato | 400 / 6.2 | yes, established | supported score above minimum | 2 | 4 |

The audit found one admission inconsistency: establishedMin=5.5 admitted the 5.6 blockbuster and ranked its public score second, despite the public established query already requiring >=6. This was corrected to 6 locally. `cinematic-quality-v1.1` exposes the experimental establishedMin parameter; the audit reruns the unchanged formula with 5.5 for comparison. It also rejects impossible calendar dates (e.g. 2020-02-31). No other threshold or score weight was retuned to fit these samples.

Low-vote titles remain eligible via metadata and rating evidence but cannot dominate the main batch; their high raw average is shrunk toward 6 with 100 pseudo-votes. Public popularity is capped/logarithmic and only one score term. Critic acclaim, awards, independence and cult/auteur status remain unknown. The report does not fabricate them from TMDb user votes.

The final Core ranking still represents personal compatibility. Public quality primarily gates admission and prioritizes detail enrichment; cold-start Core ties can have a different order from quality scores. The international niche fixture is eligible but misses this batch because only one low-support reserve is available. That is a documented coverage tradeoff, not evidence the film is poor. Quality of real recommendations or universal superiority cannot be inferred from nine cases.

## Verification and scope

Commands:

```
node scripts/verify-discovery-save.cjs
node scripts/verify-discovery-native-diagnostics.cjs
node scripts/diagnose-discovery-native.cjs --write
node scripts/verify-discovery-refinement.cjs
node scripts/verify-production-shell.cjs 'Discovery native acquisition'
node scripts/verify-discovery-view-browser.cjs --playwright=/tmp/sc-playwright-driver/node_modules/playwright-core --executable='/Users/nikybebba/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
```

The real shell integration runs all three acquisition relations for callers N and V while observing the other person, asserting only CONTENT_CREATE plus the requested intent, correct caller state, no peer changes, no taste and no Together. Browser tests cover all native labels/44px touch targets, keyboard/modal behavior, error/uncertain/delayed confirmation, double-click, close/reopen, both personal actions and real persisted identity, Dalla Lista ordering, 320/390/768/1280 px and eight themes. All server state, API transport and account data in those tests are synthetic. The previous local Tailwind shim remains the browser harness boundary; native Safari, CDN compilation and real devices are not certified.

No backend blocker was found. No new RPC, migration, live write, commit, push, deploy or release packaging is included. Milestone 1 and the deferred completed-event/memories work are preserved.

## Changed files and final results

Presentation/integration: js/ui/product-context.js, js/ui/target-shell.js, js/ui/discovery-view.js, js/ui/discovery-save.js, js/ui/discovery-copy.js. Public policy: js/recommendation/cinematic-quality.js. Tests: scripts/verify-production-shell.cjs, scripts/verify-discovery-save.cjs, scripts/verify-discovery-refinement.cjs, scripts/verify-discovery-view-browser.cjs. New diagnostics: scripts/diagnose-discovery-native.cjs, scripts/verify-discovery-native-diagnostics.cjs, docs/DISCOVERY_NATIVE_DIAGNOSTICS.json. Documentation: this file and the supersession note in docs/DISCOVERY_NATIVE_REFINEMENT.md.

Final PASS results: browser 137 checks; save coordinator 13 tests; diagnostics 3; quality/copy 4; retrieval 16; native acquisitions 6 cases/60 assertions (both callers, observed peer); persisted details 29/151; list removal 3/25; frozen v75 Core 132; frozen consumer browser 17; Match adapter 105/359; Core 2.0 15; diversity 5; TasteProfiles 11 node:test cases plus its earlier assertions. The saved diagnostic JSON reproduces the JSON-normalized audit output exactly. Syntax and whitespace checks pass. Counts overlap in fixture coverage and do not establish live predictive quality.
