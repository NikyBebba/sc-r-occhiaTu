# Milestone 3 — TMDb Discovery retrieval (local)

**Updated public pool/quality policy:** [Discovery native refinement](DISCOVERY_NATIVE_REFINEMENT.md) supersedes the initial genre-bank table and vote-count-only selection below. Request/privacy/cache/budget contracts remain; current candidates additionally preserve average, release date and public-quality metadata.

Contract `tmdb-discovery-v1`. New modules are not loaded by index.html/service worker, and no application consumer is changed. No live API request or database operation is required by these modules or their tests.

## Retrieval and transport contract

`DiscoveryTmdb.create({transport, now?, sleep?, config?})` creates an isolated client. `load({catalog?,nights?,profiles?})` returns a candidate snapshot, never final recommendations. `markShown(ids)` explicitly records only externally shown `tmdb:<positive ID>` identifiers. `reset()` invalidates in-flight loads and resets pages/shown IDs; the public metadata cache is retained until TTL/eviction or client disposal.

Required transport signature:

```
async transport({path, query, signal, pool?})
  -> {status, body, headers?: {'retry-after': string}}
```

The transport performs a GET against the TMDb v3 base, serializes query values, returns parsed JSON and normalized headers, and must settle/cancel on signal abort. It owns authentication outside this module. No credentials/config keys are accepted, read, returned or logged here. No default live fetch transport is installed. Tests inject synthetic responses; a later runtime integration must supply the transport. `now` returns milliseconds; `sleep(ms)` is injectable for deterministic retry tests. No random jitter is used.

Snapshot: `status` READY / EMPTY / ERROR / UNAVAILABLE / STALE, `candidates`, diagnostics, request/cache statistics, page, hasMore and local lane IDs where applicable. STALE is a cancellation result and has no usable candidate snapshot. EMPTY means successful pools produced no eligible candidates (or pagination exhausted); failed pools are not presented as proof of emptiness. READY can be partial and reports failures. `partial` distinguishes pool/detail failures on normal snapshots. Superseded requests cannot commit late responses to cache, advance pages or return usable candidates.

## Public pools and privacy boundary

Queries are generated from a fixed public plan, identical for every N/V profile:

| Pool | Sort | Public filter |
|---|---|---|
| popular | popularity.desc | vote_count >=20 |
| rated | vote_average.desc | vote_count >=50 |
| genres | popularity.desc | genre IDs 18 OR 53 OR 35 OR 12 |
| pair | vote_average.desc | genre IDs 18 AND 53 |

All query metadata requests use `language=it-IT`, `include_adult=false`, `include_video=false`; original language is unrestricted. Four bounded pages are requested per load (one page for each active pool), up to three page rounds per session. Each response is capped locally at 20 raw results. Bounds/options are validated; arbitrary user query parameters cannot enter requests. Sorts and numeric genre expressions are emitted only by the public planner. The existing adapter's genre tokens are Italian labels, mapped locally from a fixed TMDb ID table.

TMDb documents discover filters, AND/OR genre syntax and sort/page parameters in [Discover Movie](https://developer.themoviedb.org/reference/discover-movie). These controls create a bounded public retrieval surface, not a guarantee of Italian translations, distribution availability or catalogue completeness.

Privacy is deliberate: no rating, profile ID, review, evidence film ID or personally chosen genre query reaches the transport. The module snapshots profiles locally and labels results `supported` if both profiles have positive supported single-genre evidence; `combination` if both support a matching genre pair; otherwise `exploration`. Together remains a ranking signal only. Enrichment priorities use public vote count, popularity and stable TMDb ID, never personal scores. Thus even detail-request IDs do not change with N/V inputs. This sacrifices retrieval personalization: niche interests not covered by the public banks rely on broad pools. Personalized TMDb queries would transmit interest-derived filters and are not implemented under this privacy contract.

## Eligibility and deduplication

`catalog` is an explicit in-memory array with `tmdb_id` or `tmdbId`, title/original_title and release_year (or features.releaseYear). Every recognized catalog TMDb ID is excluded, independent of list membership or personal seen. `nights` may additionally provide tmdb_id/tmdbId with completed/proposed/confirmed status; recognized IDs are blocked. A night with only movie_id is already covered when its content exists in catalog; missing identity mappings cannot establish an exclusion and are not guessed.

Matching normalized title/original title AND known year flags `POSSIBLE_DUPLICATE`; the result is quarantined rather than merged or written. Remakes with different years remain distinct. Equivalent results collapse by TMDb ID and record all source pools. Discordant duplicate payloads are quarantined deterministically. Invalid IDs, missing title, explicit adult/video flags and insufficient public vote counts are filtered. Metadata remains descriptive; public quality thresholds never mean N/V liked a film.

Temporary identity `tmdb:<id>` is separate from catalog IDs, with `tmdbId` retained for identity resolution. Each external candidate has `inCatalog:false`, `inSharedList:false`, `seenBy:[]`, `exposure:'UNKNOWN'`. Empty seenBy records no known exposure; it is not proof of never having seen the film. No personal state, candidacy, judgment or Together event is created.

## Limited enrichment

Up to four eligible candidates per load receive `/movie/{id}?language=it-IT&append_to_response=credits`. [TMDb append_to_response](https://developer.themoviedb.org/docs/append-to-response) permits this single-request detail/credits retrieval. Detail parsing reuses the existing data semantics (Director credits, first eight billing-ordered cast names, runtime, year, collection); it does not invoke the existing `buildTmdbDetails` path because that path can automatically query OMDb. No provider, video, keyword or OMDb requests occur here.

Genre/year features are available before enrichment; directors/cast/runtime/collection are missing until obtained. Detail failures retain the discover candidate with a diagnostic, except explicit adult/video or invalid identity/title rejects the candidate. Missing malformed nested metadata stays missing. The engine can rank sparse candidates and report evidence uncertainty. No mass catalog enrichment or persistence exists.

## Budget, cache, retries and session

Default maximum 16 transport attempts per load, concurrency two across the client, at most one retry per job. Each uncached job reserves its worst-case attempt allowance before scheduling; this deliberately conservative accounting means unused retry reservations do not automatically become extra jobs. Four query jobs plus four detail jobs reserve at most 16 attempts. Config permits at most 40 attempts, concurrency four, two retries, three pages, ten details. Partial budget exhaustion is diagnosed, not a hidden unbounded fallback.

Instance-local cache: five-minute query TTL, one-hour detail TTL, 100-entry FIFO/refresh-on-write bound. It stores cloned public responses only; no profile, user identity, catalog or judgments are cached. Reset does not serialize anything to storage. TTL/cache limits are injectable and tested. Cache hits consume no transport budget. Enrichment and raw query responses share the bounded cache but have distinct TTLs.

Network exceptions, 429 and 5xx retry only within allowance. Numeric seconds and HTTP-date `Retry-After` are honored per request; fallback is deterministic 250ms exponential backoff. Delays longer than 30 seconds are not shortened: no retry is attempted in that load, and the required delay is exposed diagnostically. 401/403 are unavailable and never retried; other permanent HTTP errors and malformed top-level responses are errors. [TMDb rate-limiting guidance](https://developer.themoviedb.org/docs/rate-limiting) requires respecting 429 and describes limits as variable. This client does not claim a provider-guaranteed rate quota or install a global cross-tab rate limiter.

Page state advances only when all active query pools succeed; successful pages remain cached when a failed pool is retried. Ended pools are skipped. Changing catalog or profiles should be accompanied by reset when starting a new session. markShown is explicit: merely retrieving/ranking a candidate does not mean it was shown. `hasMore` refers to bounded source pages, not a promise that another eligible film exists.

## Explicit Core 2.0 bridge

`DiscoveryPipeline.rank({retrieval,profiles,shownIds?,batchSize?,explorationSize?})` is a separate synchronous operation. It invokes unchanged Core 2.0 with discovery context and the opt-in `near-relevance-v1` preset. The Core default remains unbounded-v1. It accepts only READY/EMPTY snapshots.

The pipeline exposes its relevance ranking/exclusions, selects a batch, and reserves up to one distinct exploratory slot by default. The exploratory candidate must already be admitted by Core, be in the broad local lane, have no negative personal affinity or inferred protection, and remain within .02 of the best overall relevance. If none qualifies, the batch uses ordinary relevance selection. The reserve is best effort, not a percentage or compulsory low-relevance recommendation. Primary and exploratory selections are disjoint, tagged with selectionLane, total bounded by batchSize, and share nextShownIds. No personal-negative exclusion is bypassed. There are no UI strings, writes or automatic list additions.

## Verification and limitations

```
node scripts/verify-discovery-tmdb.cjs
node scripts/verify-recommendation-ranking-v2.cjs
node scripts/verify-recommendation-diversity.cjs
node scripts/verify-recommendation-profiles.cjs
node scripts/verify-recommendation.js
git diff --check
```

Sixteen synthetic tests cover public planner/filter validation, ID/title-year/catalog/event eligibility, duplicates/conflicts, bounded pagination, detail parsing, cache TTL/eviction/clone isolation, limited requests/concurrency, retry/date/429/failures, superseded queries and details, transport privacy/profile-independence, deterministic snapshots and real Core compatibility with a protected exploratory reserve.

No live TMDb service, latency, authentication configuration or recommendation quality is validated by these tests. Italian coverage is best effort; no automatic language fallback is fetched. The fixed public genre banks are intentionally limited. An uncooperative transport that ignores abort can hold concurrency slots until it settles; transport cancellation/timeouts belong to the injected implementation. Cache and shown/page state are per instance/tab only. No deployment, UI wiring, database change or subsequent milestone is included.
