# v76 Milestone 4 — local Discovery First UX

**Historical initial implementation.** Preview, refresh and save-confirmation behavior below is superseded by [Discovery native refinement](DISCOVERY_NATIVE_REFINEMENT.md). Use that document for the current local implementation and verification.

The existing `recommendations` destination in the v75 TARGET shell now mounts `DiscoveryView`. Its compact Scopri/Dalla Lista switch uses pressed buttons; Scopri is selected on every fresh entry. No bottom-navigation destination or Home markup is changed. Dalla Lista keeps the existing v75 engine, adapter, eligibility, detail action and ordering. Its refresh is explicit via Aggiorna; Altri suggerimenti advances the existing ranking. The pre-TARGET legacy consumer remains available unchanged.

## Discovery state and lifecycle

`DiscoveryView.create({root,getSource,save,onChange,onListRefresh,isCurrent,request?})` is a presentation controller with explicit session/write boundaries. It owns one bounded retrieval client and a local candidate pool. Actual TARGET integration supplies the already loaded projection, catalog/identity lookup and the existing `saveContent` callback. Ranking uses the Milestone 3 pipeline and its opt-in near-relevance-v1 configuration; the global Core 2.0 default and ranking implementation are unchanged.

Altri suggerimenti first consumes the remaining local pool and retrieves at most one further bounded pool round per click when needed. The loaded candidate set is separate from IDs actually shown. Shown IDs prevent repetitions; a pending action blocks duplicate advances. Aggiorna explicitly resets the recommendation session and rebuilds profiles, so earlier films can reappear after this intentional refresh. Realtime publications mark the snapshot dirty without silently changing its visible order. Later advances keep the captured taste snapshot until Aggiorna, but filter against the latest catalog/event snapshot to avoid newly added catalog items. Reasons are replaced with a neutral refresh message while evidence is stale. Mode changes or route/auth disposal invalidate late requests; reopening starts in Scopri.

States have separate copy for loading, results, insufficient taste evidence, empty pools, unavailable TMDb and recoverable errors. Partial metadata is disclosed even when taste evidence is insufficient. Altri suggerimenti retries errors/unavailability; Aggiorna also resets the search. Dalla Lista performs no Discovery I/O and continues to work during TMDb failure.

## Cards and explanation rules

Discovery cards reuse recommendation-card/poster styles. They show real title, year, available genre/runtime, a Fuori dal catalogo label, an Anteprima button and a short reason. No numerical score or compatibility percentage is displayed. Poster paths are limited to TMDb image paths and all inserted text is escaped.

Concrete copy requires a positive contributing FEATURE_AFFINITY reason, support >=2, an actually matching genre/genre-pair/director/cast label, and an evidence movie present in the source catalog. The cited source judgment must itself be positive: rating >=7, or explicit Like only without rating. Together copy is based only on shared rating evidence; personal names come from runtime identity. Missing/unrenderable/weak evidence uses neutral exploratory copy. Stale evidence is never presented as a current personal liking. No text or preference is inferred from seen, reviews or candidacy.

## External preview and explicit save

`discoveryPreviewModal` is a distinct dialog, not a fabricated persisted Movie Detail. It shows only metadata already obtained: poster, title, year, genres, duration, overview, directors and cast. Opening it sends no write and does not fetch OMDb. Missing overview is stated, other absent fields are omitted. Existing modal stacking, inert background, Escape/backdrop close and return-focus behavior are reused; Discovery adds focus trapping and a safe return target when saving removes the originating card.

Only the explicit Aggiungi alla Lista button invokes `save(details, 'proposeToGroup')`. The actual shell callback is its unchanged `saveContent`: TMDb deduplication, createContent only when necessary, wait for authoritative catalog publication, then the existing proposeToGroup action. Sparse metadata is accepted through that existing contract; unavailable fields are null/omitted rather than invented. There are no new SQL/RPC contracts, alternate writers, implicit personal actions or nights.

Success requires a movieId, successful/already-applied relation result, and a fresh runtime projection showing that TMDb film in the shared list. Then the external card is removed and the dialog shows Nella Lista. If content creation succeeded but the relation was not confirmed, the explicit button remains retryable; the existing runtime deduplicates content on retry. Pending submits are guarded. Obsolete modal/session responses cannot paint success on another film.

## Transport and local scope

The browser transport serializes the Milestone 3 public request descriptors and uses the existing configured client-side TMDb API key for provider authentication. It sends no Auth token, cookies, profile, ratings or person IDs. The key is never printed or copied to documentation. Fetches use credentials:omit, abort propagation and a 10-second timeout, returning normalized status/body/Retry-After to the retrieval module. Only a direct API key already used by the application's frontend is read; configuration is not changed.

This milestone changes index script loading for the new local experience. Service-worker version/precache and release packaging are deliberately not changed: this is not a deployed or offline-PWA release. A release must address asset packaging before publication. No real TMDb call, Supabase write or real-account interaction was used in verification.

## Browser verification

`scripts/verify-discovery-view-browser.cjs` serves the actual index/module graph over loopback. It reuses the existing synthetic production-session boot fixture and intercepts all external traffic. Auth/runtime read RPCs and TMDb are simulated. Initial navigation asserts no write RPC; the real v75 engine's list ordering is compared directly in the browser.

The script verifies 320/390/768/1280px, all eight real CSS themes, default mode and switch, metadata cards/preview, neutral/concrete explanations, keyboard activation, focus loop/Escape, next batches, late request after mode switch, empty/unavailable/error/partial states, retry, and list independence from TMDb. Explicit save uses an injected synthetic authoritative-state callback, checking relation intent, unconfirmed-relation retry, double-submit guard, saved-card removal and focus return. Separate existing shell VM checks exercise the real saveContent create/relation boundary and real PROPOSE_TO_GROUP action path. No live writer is used.

Browser harness uses real project CSS with the established local Tailwind utility shim; it does not validate the CDN Play compiler or claim native Safari/device coverage. Screenshots are written outside the repository to `/tmp/sc-discovery-ux`; 320/390/tablet/desktop overflow checks cover the Discovery panel across all themes. Visual inspection includes the narrow screenshot. Provider translation coverage, live latency and actual saved-data behavior require a later authorized production/device check.

The existing Recommendation consumer browser harness needed only its back-button selector corrected: baseline HTML already lacked the aria-label it queried. The test now scopes the same real button in its fixture and retains its style/dimension/focus/activation checks; product Home behavior is untouched.

Commands (paths supplied for this local environment):

```
node scripts/verify-discovery-view-browser.cjs --playwright=/tmp/sc-playwright-driver/node_modules/playwright-core --executable='/Users/nikybebba/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
node scripts/verify-recommendation-consumer-browser.cjs --playwright=/tmp/sc-playwright-driver/node_modules/playwright-core
node scripts/verify-production-shell.cjs 'content creation'
node scripts/verify-production-shell.cjs 'shell action PROPOSE_TO_GROUP'
node scripts/verify-discovery-tmdb.cjs
node scripts/verify-recommendation-ranking-v2.cjs
node scripts/verify-recommendation-profiles.cjs
node scripts/verify-recommendation.js
git diff --check
```
