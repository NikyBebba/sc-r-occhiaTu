# Discovery refinement — local native UX

**Updated native actions and quality validation:** [Discovery native actions & diagnostics](DISCOVERY_NATIVE_ACTIONS_QUALITY.md) supersedes the single add action, display-channel selection and established-rating threshold described below. The save-confirmation race and runtime boundary remain applicable.

This document supersedes the initial Milestone 4 preview/refresh behavior. No database contract, Auth, Match, wheel or night semantics are changed. No real-data write or live TMDb test was performed.

## False failure: exact boundary

The existing picker calls `saveContent(details, relation)` and accepts relation outcome SUCCESS/ALREADY_IN_TARGET_STATE. `saveContent` resolves content by TMDb ID, creates only if absent, waits for authoritative content coverage, then calls the existing `proposeToGroup` action. The action adapter maps the server's semantic outcome into `outcome` and preserves its result. In `target-runtime.send`, successful commands call `requireAffected`; version-driven snapshot refresh/publication is asynchronous relative to returning the semantic response.

The initial Discovery implementation added an extra *immediate* predicate: fresh.input.candidates had to already contain the returned film with inSharedList=true. A confirmed command with a lagging group projection failed that predicate and was rendered as “Aggiunta non confermata”. Existing addCatalog did not impose it. This reproduces the reported symptom without inferring that every observed real failure had the same cause; no live account was queried.

`DiscoverySave` separates command confirmation from projection readiness. It stores a per-film operation and reconciles on normal runtime publications:

| State | Meaning | Permitted action |
|---|---|---|
| IDLE | No operation / not yet in list | Explicit add |
| PENDING | Existing saveContent promise pending | Disabled; no duplicate submission |
| CONFIRMED, projected=false | Semantic success; snapshot lagging | Show success + updating detail; read-only refresh |
| CONFIRMED, projected=true | Current authoritative catalog/group projection agrees | Native persisted detail; no add |
| UNCERTAIN | Transport uncertain, stale/unknown result or exception | Verify state through read-only refresh, never resend automatically |
| ERROR | Server ERROR with its error payload, or NOT_READY/RETRY_NOT_ALLOWED | Explicit retry after user decision |
| READY_TO_PROPOSE | Uncertain content creation was observed in catalog; relation was never attempted | Explicit completion via existing saveContent, which reuses the content |

An already active shared candidate is recognized before sending a command. Unknown results do not become errors just because time passed. A confirmed command is not invalidated by a missing immediate projection. An authoritative list snapshot can resolve an uncertain operation. A generic UI catch returning only outcome=ERROR without server error evidence is treated as uncertain, not a proven rejection. Closing/reopening the same card retains the operation; a late callback cannot paint another film. Disposal suppresses UI callbacks. No background retry of writer handles or new writer is introduced.

## One Movie Detail

The separate discoveryPreviewModal and its CSS/template were removed. `openExternalMovieDetail` uses the existing detailModal/detailPanel and `renderMovieDetail` template with an explicit external presentation option. This is a small presentation extension: same cover, title, genre chips, story/cast disclosures, typography, ambient poster treatment, scrolling, close/Escape, modal stack and focus trap. Stable persisted rendering is unchanged by default.

The external view model has `externalId:tmdb:<id>`, no database id. detailBody exposes data-external-id and has no data-movie-id. It has only the existing-styled add button and operation feedback, not personal states or night actions. Real TMDb average/count is attributed to TMDb; no critic/award claim is inferred. When both command and projection are confirmed, the shell opens the actual returned catalog ID via its ordinary ProductContext detail, preserving scroll and expanded story/cast. Focus returns to the shared More command if the saved card is gone.

Cards reuse recommendation-card/title/meta/reason/poster classes and the existing whole-card role=button/keyboard pattern. There is no nested Anteprima button. Statuses and actions use detail-feedback, detail-intent and movie-list-primary/detail-primary rather than a second component system.

## Single Discovery command and silent reconciliation

Scopri/Dalla Lista remain modes. In Scopri, Aggiorna is hidden: only the existing Altri suggerimenti command/icon is shown. Each advance reads the latest profiles and current catalog; shown IDs persist across input changes and batches. Publications quietly remove added films, refresh source evidence and rerank the currently displayed eligible group. If inputs change during a transport await, the returned public pool is evaluated with the newest snapshot. No technical “refresh your judgments” banner is shown. Existing click/pending/revision/abort guards remain.

Dalla Lista retains the frozen v75 scorer and its established advance-on-stale behavior. The former Milestone 4 alteration of that behavior was reverted. No bottom-nav destination or Home content is introduced.

## Cinematic public reputation policy

The old retrieval primarily sorted by popularity and vote count, dropped vote_average and full release date, and requested fixed genre banks. It could not make a meaningful public reputation assessment. The new explicit metadata preserves average/count/popularity/date/language and computes a public-only quality result. No personal signals enter TMDb requests.

Four public query banks remain bounded to four requests per page round:

| Bank | Public query |
|---|---|
| Broad established | popularity descending, at least 100 votes, average >=6 |
| Classic | release by end of asOf year−20, vote average descending, >=30 votes, average >=6.5 |
| Recent | release since start of asOf year−3 and by asOf, popularity descending, >=50 votes, average >=6.2 |
| Niche exploration | vote average descending, >=5 votes, average >=7 |

Metadata remains it-IT; original language is unrestricted. Generic genre and pair affinity are evaluated locally from the resulting broad pools. All banks exclude adult/video and unreleased films; unknown release date is not assumed released. Cache keys include query date bounds. Caller-injected clock makes fixtures reproducible.

Local reputation gate accepts established titles with >=100 votes and average >=5.5; classic proxies with >=30 votes/average >=6.5/age >=20; recent proxies with >=50 votes/average >=6.2/age <=3; or niche candidates with >=5 votes/average >=7 and at least three of overview/genres/poster/runtime/directors available. A popular zero-vote title fails. Few votes can pass with other metadata evidence, but low-support niche titles are limited to the single exploratory reserve and cannot dominate the main batch. This is an empirical safeguard, not a guarantee of quality.

The public quality score uses average shrunk toward 6 with 100 pseudo-votes, support n/(n+100), logarithmically capped popularity and metadata completeness (weights .6/.2/.1/.1). It prioritizes bounded enrichment; one candidate from each available public category is considered before filling the remaining detail budget. This does not change Core 2.0's personal scoring. Core negative protections and near-relevance constraints continue to control recommendation selection. Niche reserve can be empty if compatibility/protection conditions fail.

“Classic”, “recent”, “established” and “niche” are internal proxies, not UI claims about artistic merit. Critic acclaim, awards, auteur/cult status, production independence and actual international distribution cannot be established from these fields alone. Such films are allowed through broad/international/older/low-support pools, but those labels are not fabricated. No LLM, keyword enrichment, critic source or new API is introduced.

The synthetic public-pool fixture supplies 80 raw rows: after date/reputation filtering and deduplication it retains 52 candidates, performs 8 requests (four queries plus four details), and fills a five-film batch with at most one low-support niche title. Budget remains 16 attempts including retries, concurrency two. This establishes capacity on the fixture, not live TMDb yield or predictive superiority. Release-date gating intentionally reduces unknown/future coverage.

## Evidence copy and V bias diagnosis

The previous copy loop returned the first positive feature reason. Core reasons are ordered by opaque personal IDs, followed by Together; the first available personal channel could dominate every card and Together was effectively starved. The algorithm did not actually select by an N/V preference for V. Real N/V judgment coverage was not queried, so no live attribution frequency is claimed.

`DiscoveryCopy.describe` first extracts a compact, escaped premise from TMDb overview (150 characters), with factual genre/year/director metadata as fallback. Affinity is optional. It requires positive contribution, support >=2, an actual candidate feature and a catalog evidence film with a positive effective personal rating/Like or positive shared rating. It picks the strongest feature per channel, then rotates only among channels with comparable contributions (>=.8 of the strongest) across cards. Weak N/Together evidence is not forced beside strong V evidence. Synthetic equal-evidence tests cover N, V and Together; negative/unverified reasons generate no attributed copy. No score percentage or predicted vote is shown.

## Verification

- Save coordinator: nine tests for immediate/lagging success, already-present state, uncertain-to-confirmed, true error, explicit retry, double-click/reopen, disposal and partially completed creation.
- Quality/copy: four tests including public pool/budget fixture and equal/weak/negative channel evidence.
- Retrieval suite: sixteen cases with vote_average/date fixtures and the updated public planner.
- Browser: actual index and module graph over loopback, synthetic Auth/runtime and intercepted TMDb. Tests native detail identity/layout, whole-card keyboard entry/no Anteprima, command simplification, silent input changes, late requests, all states, delayed success, uncertain outcome without resend, close/reopen while pending, actual persisted-ID transition, 320/390/768/1280 px and eight themes.
- Existing v75 core/browser, Core 2.0/diversity, TasteProfiles, Match adapter, persisted detail, list removal and night lifecycle regression tests remain applicable.

Browser visuals use the established local Tailwind shim with real project CSS and mocked posters; they do not certify CDN compilation, native Safari or real phones. Screenshots are outside the repository under /tmp/sc-discovery-ux. No service-worker release/cache bump, commit, push or deploy is included. Live confirmation of the original user's operation remains unverified; the causal race and corrected behavior are demonstrated synthetically.

## Files in this refinement

New: js/ui/discovery-save.js, js/ui/discovery-copy.js, js/recommendation/cinematic-quality.js, scripts/verify-discovery-save.cjs, scripts/verify-discovery-refinement.cjs, this document.

Updated: js/ui/discovery-view.js, js/ui/render/detail.js, js/ui/target-shell.js, js/recommendation/discovery-tmdb.js, js/recommendation/discovery-pipeline.js, index.html, css/style.css, scripts/verify-discovery-tmdb.cjs, scripts/verify-discovery-view-browser.cjs, docs/DISCOVERY_FIRST_UX.md, docs/TMDB_DISCOVERY_RETRIEVAL.md.

Final local verification: browser refinement 113 checks; save coordinator 9 tests; quality/copy 4; retrieval 16; Core 2.0 15; diversity 5; TasteProfiles 11 node:test cases plus its previous assertions; frozen v75 Core 132; v75 browser consumer 17; Match adapter 105 cases/359 assertions; persisted-detail 29 cases/151 assertions; night lifecycle 15/75; list removal 3/25. All passed, as did syntax and whitespace checks. These suites overlap in fixtures and are not a statistical sample of production behavior.
