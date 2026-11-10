# Taste Profiles — taste-profile-v1

`TasteProfiles.build(projection)` is a pure, local profiling module. It does not change the frozen Recommendation Core or its consumer. The input is the existing object returned by `RecommendationAdapters.fromMovies()`.

## Input and output

The projection supplies `users[].id`, `candidates[].movieId`, `contentFeatures[movieId]`, `personalSignals[personId].ratings/preferences` (arrays of `{contentId,value}`), and `sharedSignals.ratings`. `normalizeProjection()` maps these into per-movie rows; it reads no other source. Personal IDs are opaque strings. Output has `people[id]`, `together`, and `metadataConflicts`. Each profile reports valid observation count, cold-start state, and feature rows with direction, positive/neutral/negative support, bounded intensity sums, movie IDs, per-observation provenance, and `supportInsufficient`.

## Semantics

One observation per movie and channel: valid numeric rating (0–10, one decimal) takes precedence over boolean Like/Dislike; otherwise preference is used. Rating polarity follows v75: `<5.5` negative, `5.5–<7` neutral, `>=7` positive. Intensity is bounded in [0,1]: positive `(rating-6.5)/3.5`, negative `(5.5-rating)/5.5`, neutral zero. Preference intensity is one. Feature direction is mean positive intensity minus mean negative intensity across distinct supporting movies; it is descriptive, uncalibrated and must not be treated as a probability. Neutral observations count as support but add no direction. Missing metadata creates no feature row, not a negative observation.

Genres are normalized/deduplicated; genre pairs are unordered unique pairs. Cast and directors are unique per movie and feature. Runtime bands follow v75 boundaries 100/120/150 minutes; decade and collection use their projected values. A movie contributes at most once per feature. Together ratings populate only the Together profile. Seen, reviews, events and Match are ignored.

Movie identity is `String(movieId)`; person identity is the exact opaque ID. Identical canonical duplicate rows collapse. Conflicting movie features are suppressed for all channels, while unambiguous judgments remain counted. For projection data, duplicate signal entries for the same channel/movie are canonicalized only if their values agree; disagreement excludes that channel observation. An ambiguous rating blocks preference fallback; an ambiguous preference does not invalidate an unambiguous valid rating. A conflicting Together value excludes Together only. No value is selected by input order. Fields and record arrays are normalized/sorted before comparison/output. Cold start has zero valid observations; absent features remain absent. Support below two observations is flagged, not promoted to an inferred preference.

## Metadata availability

The v75 adapter projects genres, director, cast names, duration parsed to minutes, release year, and collection ID. Decade, runtime band and genre pairs are derived by the profile module. The adapter has no keyword field. This describes schema/code availability, not populated coverage in the live dataset; live coverage is intentionally not queried.


## Verified conflict diagnostics and adapter limits

Each personal profile and Together expose sorted `conflicts` movie IDs; they contain no rating values or review text. Top-level `metadataConflicts` identifies movies whose duplicate internal rows disagree on metadata. Personal conflict lists also include metadata conflicts; Together uses the top-level metadata diagnostic. Missing data produces no conflict diagnostic. Missing metadata yields no feature evidence while a valid judgment is still counted.

The frozen v75 adapter collapses identical movie records and rejects conflicting source movies before returning a projection. `contentFeatures` has one object per movie ID: overwritten source metadata cannot be recovered by TasteProfiles. Tests therefore use the real adapter for ordinary integration, projected signal arrays for signal conflicts, and the explicit internal `normalizeProjection()` row format for duplicate metadata conflicts. Conflicting metadata suppresses the complete feature set conservatively, not just a single family.

The dedicated suite actually calls `RecommendationAdapters.fromMovies()` with synthetic movies and verifies all seven feature families, rating precedence, neutral support, preference provenance, Together separation, unchanged input, and movie-order invariance. Further tests verify identical and discordant rating duplicates, ambiguous rating plus Like, preference conflicts with and without a valid rating, isolated personal/Together conflicts, conflicting metadata with preserved judgments, simultaneous metadata/personal conflicts, and permutations including three duplicate rows. These checks establish behavior on these fixtures; they do not measure predictive quality or live data coverage.
