// Pure functions. Environment bridge only; no consumer or data-source access.
const RecommendationEngine = (() => {
  const defaults = typeof module !== 'undefined' && module.exports
    ? require('./config') : RecommendationConfig;
  const families = Object.keys(defaults.familyWeights);
  const codes = { genre: 'GENRE_RELATIVE_AFFINITY', director: 'DIRECTOR_RELATIVE_AFFINITY',
    cast: 'CAST_RELATIVE_AFFINITY', runtime: 'RUNTIME_PROFILE_EVIDENCE',
    era: 'ERA_PROFILE_EVIDENCE', collection: 'COLLECTION_RATED_AFFINITY' };
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const bound = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const text = value => typeof value === 'string' ? value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() : '';
  const tokens = values => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))].sort(compare);
  // Identifiers are opaque: validate emptiness, never rewrite a signal-map key.
  const id = value => typeof value === 'string' && value.trim() ? value
    : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  function configuration(overrides = {}) {
    const c = { ...defaults, ...overrides, familyWeights: { ...defaults.familyWeights, ...overrides.familyWeights },
      diversity: { ...defaults.diversity, ...overrides.diversity } };
    for (const [key, value] of Object.entries(c)) {
      if (typeof defaults[key] === 'number' && (!finite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))
        throw new TypeError('Invalid config: ' + key);
    }
    for (const [key, value] of Object.entries(c.diversity)) {
      if (!finite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid diversity config: ' + key);
    }
    if (!families.every(f => finite(c.familyWeights[f]) && c.familyWeights[f] >= 0)
      || Math.abs(families.reduce((s, f) => s + c.familyWeights[f], 0) - 1) > c.validationTolerance)
      throw new RangeError('Family weights must be nonnegative and sum to one');
    if (!c.modelVersion || typeof c.modelVersion !== 'string' || !c.configVersion || typeof c.configVersion !== 'string')
      throw new TypeError('Explicit model/config versions required');
    for (const key of ['ratingScale', 'featureShrinkageLambda', 'profileShrinkageLambda', 'matchHalfLifeDays',
      'outputScale', 'ratingPrecision', 'eraYears', 'millisecondsPerDay', 'validationTolerance'])
      if (c[key] <= 0) throw new RangeError('Positive config required: ' + key);
    for (const key of ['ratingWeight', 'matchWeight', 'matchSignalMagnitude', 'ratingCenterShrinkageTau',
      'togetherWeight', 'togetherAbsoluteCap', 'doubleLikeContribution', 'disagreementBeta',
      'reasonMinAffinity', 'reasonMinConfidence', 'reasonMinContribution'])
      if (c[key] < 0) throw new RangeError('Nonnegative config required: ' + key);
    if (c.seenPreferenceWeight !== 0 || c.qualityPriorWeight !== 0)
      throw new RangeError('v1 supports neutral seen history and zero quality prior only');
    if (c.supportedGroupSize !== defaults.supportedGroupSize)
      throw new RangeError('v1 requires exactly ' + defaults.supportedGroupSize + ' users');
    if (c.observedConfidence <= 0 || c.doubleNopeContribution > 0 || c.matchSignalMagnitude > 1
      || ![c.observedConfidence, c.estimatedConfidenceThreshold, c.strongNegativeConfidence,
        c.reasonMinConfidence].every(v => v >= 0 && v <= 1)) throw new RangeError('Invalid signal/confidence config');
    if (!(c.scoreMin < c.neutral && c.neutral < c.scoreMax && c.ratingMin < c.ratingMax)
      || c.ratingAnchor < c.ratingMin || c.ratingAnchor > c.ratingMax
      || c.strongNegativeScore < c.scoreMin || c.strongNegativeScore >= c.neutral)
      throw new RangeError('Invalid score/rating bounds');
    if (!Number.isInteger(c.reasonMinSupport) || c.reasonMinSupport < 1
      || !Number.isInteger(c.eraYears) || !Number.isInteger(c.ratingPrecision)
      || !['maxPerCollection', 'rerankPoolSize', 'defaultShortlistSize'].every(k => Number.isInteger(c.diversity[k]))
      || c.diversity.maxPerCollection < 1) throw new RangeError('Invalid count config');
    if (!Array.isArray(c.runtimeBoundaries) || c.runtimeBoundaries.length !== defaults.runtimeBoundaries.length
      || !c.runtimeBoundaries.every((v, i, a) => finite(v) && v > 0 && (!i || v > a[i - 1])))
      throw new RangeError('Runtime boundaries must be increasing');
    return c;
  }
  function timestamp(value) {
    // Zoned strings only: no host-timezone dependence or implicit current time.
    const n = finite(value) ? value : typeof value === 'string' && /(?:Z|[+-]\d\d:?\d\d)$/i.test(value)
      ? Date.parse(value) : NaN;
    if (!finite(n) || !finite(new Date(n).getTime())) throw new TypeError('Valid explicit zoned timestamp required');
    return n;
  }
  function validRating(value, c = defaults) {
    return finite(value) && value >= c.ratingMin && value <= c.ratingMax
      && Math.abs(value * c.ratingPrecision - Math.round(value * c.ratingPrecision)) <= c.validationTolerance;
  }
  function ratingCenter(values, config = defaults) {
    const c = configuration(config), ratings = values.filter(v => validRating(v, c));
    if (!ratings.length) return c.ratingAnchor;
    return (ratings.reduce((s, n) => s + n, 0) + c.ratingCenterShrinkageTau * c.ratingAnchor)
      / (ratings.length + c.ratingCenterShrinkageTau);
  }
  function ratingSignal(value, center, config = defaults) {
    const c = configuration(config);
    if (!validRating(value, c) || !finite(center)) throw new TypeError('Valid rating and center required');
    return bound((value - center) / c.ratingScale, -1, 1);
  }
  function normalizeFeatures(raw = {}, config = defaults) {
    const c = configuration(config);
    if (raw === null || typeof raw !== 'object') throw new TypeError('Feature object required');
    const minutes = finite(raw.runtimeMinutes) && raw.runtimeMinutes > 0 ? raw.runtimeMinutes : null;
    const year = Number.isInteger(raw.releaseYear) && raw.releaseYear > 0 ? raw.releaseYear : null;
    const directors = Array.isArray(raw.directors) ? raw.directors
      : typeof raw.directors === 'string' ? raw.directors.split(',') : [];
    const collection = Number.isSafeInteger(raw.collectionId) && raw.collectionId > 0 ? String(raw.collectionId)
      : typeof raw.collectionId === 'string' && /^[1-9]\d*$/.test(raw.collectionId) ? raw.collectionId : null;
    return { genre: tokens(raw.genres), director: tokens(directors), cast: tokens(raw.cast),
      runtime: minutes === null ? [] : [String(c.runtimeBoundaries.filter(v => minutes >= v).length)],
      era: year === null ? [] : [String(Math.floor(year / c.eraYears) * c.eraYears)],
      collection: collection === null ? [] : [collection], runtimeMinutes: minutes };
  }
  const factual = (code, movieId, extra = {}) => ({ code, kind: 'factual', evidenceMovieIds: [movieId], ...extra });
  function canonicalCandidates(candidates) {
    const map = new Map();
    for (const raw of candidates) {
      const movieId = id(raw?.movieId);
      if (movieId === null) continue;
      const row = { movieId, title: typeof raw.title === 'string' ? raw.title : '',
        inSharedList: raw.inSharedList === true, cinema: raw.cinema === true };
      if (map.has(movieId) && JSON.stringify(map.get(movieId)) !== JSON.stringify(row))
        throw new TypeError('Conflicting duplicate candidate: ' + movieId);
      map.set(movieId, row);
    }
    return [...map.values()].sort((a, b) => compare(a.movieId, b.movieId));
  }
  function eligibleCandidates(candidates, normalizedFeatures, shared = {}, constraints = {}) {
    const blocked = new Set((shared.completedMovieIds || []).map(id).filter(v => v !== null));
    for (const event of shared.events || [])
      if (['completed', 'proposed', 'confirmed'].includes(event.status)) blocked.add(id(event.movieId));
    const context = constraints.context || 'streaming';
    if (!['streaming', 'cinema', 'all'].includes(context)) throw new TypeError('Unknown content context');
    for (const key of ['minRuntimeMinutes', 'maxRuntimeMinutes'])
      if (constraints[key] != null && (!finite(constraints[key]) || constraints[key] <= 0))
        throw new TypeError('Invalid runtime constraint');
    if (constraints.minRuntimeMinutes != null && constraints.maxRuntimeMinutes != null
      && constraints.minRuntimeMinutes > constraints.maxRuntimeMinutes) throw new RangeError('Inverted runtime constraint');
    if (constraints.genres != null && (!Array.isArray(constraints.genres) || !tokens(constraints.genres).length))
      throw new TypeError('Nonempty genre constraint required');
    const requestedGenres = tokens(constraints.genres);
    const excluded = new Set((constraints.excludeMovieIds || []).map(id));
    const rows = [];
    for (const movie of canonicalCandidates(candidates)) {
      if (!movie.inSharedList || blocked.has(movie.movieId) || excluded.has(movie.movieId)) continue;
      if (context !== 'all' && movie.cinema !== (context === 'cinema')) continue;
      const f = normalizedFeatures[movie.movieId] || normalizeFeatures();
      if (requestedGenres.length && !requestedGenres.some(g => f.genre.includes(g))) continue;
      const runtimeRequested = constraints.minRuntimeMinutes != null || constraints.maxRuntimeMinutes != null;
      if (runtimeRequested && (f.runtimeMinutes === null
        || constraints.minRuntimeMinutes != null && f.runtimeMinutes < constraints.minRuntimeMinutes
        || constraints.maxRuntimeMinutes != null && f.runtimeMinutes > constraints.maxRuntimeMinutes)) continue;
      const reasons = [factual('SHARED_LIST_CANDIDATE', movie.movieId)];
      if (runtimeRequested) reasons.push(factual('RUNTIME_CONTEXT', movie.movieId,
        { runtimeMinutes: f.runtimeMinutes, constraints: { min: constraints.minRuntimeMinutes ?? null,
          max: constraints.maxRuntimeMinutes ?? null } }));
      rows.push({ ...movie, reasons });
    }
    return rows;
  }
  function canonicalRatings(rows, c) {
    const ratings = new Map();
    for (const row of rows || []) {
      const contentId = id(row?.contentId);
      if (contentId === null || !validRating(row.value, c)) continue;
      if (ratings.has(contentId) && ratings.get(contentId).value !== row.value)
        throw new TypeError('Conflicting duplicate rating: ' + contentId);
      ratings.set(contentId, { contentId, value: row.value });
    }
    return [...ratings.values()].sort((a, b) => compare(a.contentId, b.contentId));
  }
  function matchRows(rows, asOf, c) {
    const matches = new Map();
    for (const row of rows || []) {
      const contentId = id(row?.contentId), sessionId = id(row?.sessionId);
      if (contentId === null || sessionId === null || typeof row.liked !== 'boolean') continue;
      let at; try { at = timestamp(row.createdAt); } catch (_) { continue; }
      const key = JSON.stringify([sessionId, contentId]);
      const old = matches.get(key);
      if (old && old.liked !== row.liked) throw new TypeError('Conflicting duplicate session response');
      if (!old || at > old.at) matches.set(key, { contentId, sessionId, liked: row.liked, at,
        freshness: Math.pow(2, -Math.max(0, asOf - at) / (c.millisecondsPerDay * c.matchHalfLifeDays)) });
    }
    return [...matches.values()].sort((a, b) => compare(a.contentId, b.contentId)
      || compare(a.sessionId, b.sessionId) || a.at - b.at);
  }
  function buildProfile(signals = {}, normalizedFeatures, asOf, config = defaults) {
    const c = configuration(config), ratings = canonicalRatings(signals.ratings, c);
    const at = timestamp(asOf);
    const center = ratingCenter(ratings.map(r => r.value), c), direct = new Map(), observations = new Map();
    for (const r of ratings) {
      const observation = { contentId: r.contentId, signal: ratingSignal(r.value, center, c),
        mass: c.ratingWeight, source: 'rating', value: r.value };
      direct.set(r.contentId, observation);
      if (observation.mass > 0) observations.set(r.contentId, observation);
    }
    const contexts = matchRows(signals.match, at, c), grouped = new Map();
    for (const row of contexts) {
      if (!grouped.has(row.contentId)) grouped.set(row.contentId, []);
      grouped.get(row.contentId).push(row);
    }
    for (const [contentId, rows] of grouped) {
      if (direct.has(contentId)) continue;
      const freshnessSum = rows.reduce((s, r) => s + r.freshness, 0);
      const mass = c.matchWeight * Math.max(...rows.map(r => r.freshness));
      if (!mass || !freshnessSum) continue;
      observations.set(contentId, { contentId, mass, source: 'match',
        signal: rows.reduce((s, r) => s + r.freshness * (r.liked ? 1 : -1) * c.matchSignalMagnitude, 0) / freshnessSum,
        contexts: rows });
    }
    const ordered = [...observations.values()].sort((a, b) => compare(a.contentId, b.contentId));
    const stats = Object.fromEntries(families.map(f => [f, new Map()]));
    for (const o of ordered) {
      const f = normalizedFeatures[o.contentId];
      if (!f) continue;
      for (const family of families) for (const token of f[family]) {
        if (!stats[family].has(token)) stats[family].set(token, { signedMass: 0, evidenceMass: 0, support: new Map() });
        const stat = stats[family].get(token), mass = o.mass / f[family].length;
        stat.signedMass += mass * o.signal; stat.evidenceMass += mass;
        stat.support.set(o.contentId, { source: o.source, mass });
      }
    }
    return { center, direct, contexts, observations: ordered, stats,
      totalEvidenceMass: ordered.reduce((s, o) => s + o.mass, 0) };
  }
  function supportReason(code, support, extra) {
    const entries = [...support.entries()].sort((a, b) => compare(a[0], b[0]));
    return { code, kind: 'inferred', evidenceMovieIds: entries.map(([key]) => key),
      ratingSupport: entries.filter(([, s]) => s.source === 'rating').length,
      contextSupport: entries.filter(([, s]) => s.source === 'match').length,
      effectiveEvidenceMass: entries.reduce((s, [, entry]) => s + entry.mass, 0), ...extra };
  }
  function predictPersonal(movieId, profile, f, userId, config = defaults) {
    const c = configuration(config), direct = profile.direct.get(movieId);
    if (direct) {
      const internalScore = bound(c.neutral + c.outputScale * direct.signal, c.scoreMin, c.scoreMax);
      return { score: internalScore, internalScore, confidence: c.observedConfidence, state: 'observed',
        reasons: [factual('PERSONAL_RATING_OBSERVED', movieId, { userIds: [userId], value: direct.value,
          ratingSupport: 1, contextSupport: 0, effectiveEvidenceMass: direct.mass,
          strength: direct.signal, confidence: c.observedConfidence, scoreContribution: internalScore - c.neutral })] };
    }
    let delta = 0, featureConfidence = 0; const reasons = [];
    for (const family of families) {
      const affinities = [], confidences = [];
      for (const token of f[family]) {
        const st = profile.stats[family].get(token), mass = st?.evidenceMass || 0;
        const affinity = st ? st.signedMass / (mass + c.featureShrinkageLambda) : 0;
        const confidence = mass / (mass + c.featureShrinkageLambda);
        affinities.push(affinity); confidences.push(confidence);
        const contribution = c.outputScale * c.familyWeights[family] * affinity / f[family].length;
        // Entity-specific support: aggregate cast evidence cannot name an unsupported actor.
        const ratedSupport = st ? [...st.support.values()].filter(s => s.source === 'rating').length : 0;
        if (st && st.support.size >= c.reasonMinSupport && (family !== 'collection' || ratedSupport >= c.reasonMinSupport)
          && Math.abs(affinity) > c.reasonMinAffinity
          && confidence > c.reasonMinConfidence && Math.abs(contribution) >= c.reasonMinContribution) {
          reasons.push(supportReason(codes[family], st.support, { userIds: [userId], family, token,
            polarity: affinity > 0 ? 'relative_positive' : 'relative_negative', strength: affinity,
            confidence, scoreContribution: contribution }));
        }
      }
      delta += c.familyWeights[family] * mean(affinities);
      featureConfidence += c.familyWeights[family] * mean(confidences);
    }
    const confidence = bound(featureConfidence * profile.totalEvidenceMass
      / (profile.totalEvidenceMass + c.profileShrinkageLambda), 0, 1);
    const internalScore = confidence === 0 ? c.neutral
      : bound(c.neutral + c.outputScale * delta, c.scoreMin, c.scoreMax);
    const directContexts = profile.contexts.filter(r => r.contentId === movieId);
    for (const r of directContexts) if (c.matchWeight > 0 && r.freshness > 0)
      reasons.push(factual(r.liked ? 'EXPLICIT_MATCH_LIKE' : 'EXPLICIT_MATCH_NOPE', movieId,
        { userIds: [userId], contextSupport: 1, ratingSupport: 0, sessionId: r.sessionId,
          freshness: r.freshness, occurredAt: new Date(r.at).toISOString() }));
    return { score: confidence === 0 ? null : internalScore, internalScore, confidence,
      state: confidence === 0 ? 'unknown' : confidence < c.estimatedConfidenceThreshold ? 'weak' : 'estimated',
      reasons };
  }
  function sharedEvidence(movieId, sharedProfile, features, profiles, users, groupId, c) {
    const joint = predictPersonal(movieId, sharedProfile, features, groupId, c);
    const together = bound(c.togetherWeight * joint.confidence * (joint.internalScore - c.neutral),
      -c.togetherAbsoluteCap, c.togetherAbsoluteCap);
    const reasons = [];
    if (Math.abs(together) >= c.reasonMinContribution && joint.reasons.length) {
      const ids = [...new Set(joint.reasons.flatMap(r => r.evidenceMovieIds))].sort(compare);
      reasons.push({ code: 'TOGETHER_RATING_AFFINITY', kind: joint.state === 'observed' ? 'factual' : 'inferred', groupId, evidenceMovieIds: ids,
        ratingSupport: ids.length, contextSupport: 0, effectiveEvidenceMass: sharedProfile.observations
          .filter(o => ids.includes(o.contentId)).reduce((sum, o) => sum + o.mass, 0),
        confidence: joint.confidence, strength: joint.internalScore - c.neutral,
        polarity: together > 0 ? 'relative_positive' : 'relative_negative', scoreContribution: together,
        evidence: joint.reasons.map(({ userIds, ...reason }) => ({ ...reason, groupId,
          code: reason.code === 'PERSONAL_RATING_OBSERVED' ? 'TOGETHER_RATING_AFFINITY' : reason.code })) });
    }
    const sessions = new Map();
    for (const user of users) for (const row of profiles[user.id].contexts.filter(r => r.contentId === movieId)) {
      if (!sessions.has(row.sessionId)) sessions.set(row.sessionId, new Map());
      sessions.get(row.sessionId).set(user.id, row);
    }
    // Latest complete group response; ID breaks simultaneous-session ties deterministically.
    const complete = [...sessions.entries()].filter(([, rows]) => rows.size === users.length)
      .sort((a, b) => Math.max(...[...b[1].values()].map(r => r.at)) - Math.max(...[...a[1].values()].map(r => r.at))
        || compare(a[0], b[0]));
    let match = 0, freshness = 0;
    if (complete.length && users.length > 1) {
      const [sessionId, byUser] = complete[0], rows = [...byUser.values()];
      freshness = Math.min(...rows.map(r => r.freshness));
      const allLike = rows.every(r => r.liked), allNope = rows.every(r => !r.liked);
      if (allLike || allNope) {
        match = (allLike ? c.doubleLikeContribution : c.doubleNopeContribution) * freshness;
        if (match !== 0) reasons.push(factual(allLike ? 'DOUBLE_MATCH_LIKE' : 'DOUBLE_MATCH_NOPE', movieId,
          { groupId, userIds: users.map(u => u.id), sessionId, contextSupport: 1,
            ratingSupport: 0, freshness, scoreContribution: match }));
      }
    }
    return { together, match, reasons, confidence: joint.confidence, freshness: match === 0 ? 0 : freshness };
  }
  function aggregateGroup(personal, shared = {}, config = defaults) {
    const c = configuration(config);
    if (!Array.isArray(personal) || personal.length !== c.supportedGroupSize)
      throw new TypeError('v1 requires exactly ' + c.supportedGroupSize + ' personal scores');
    if (!personal.every(p => p && finite(p.internalScore) && finite(p.confidence)
        && p.internalScore >= c.scoreMin && p.internalScore <= c.scoreMax && p.confidence >= 0 && p.confidence <= 1))
      throw new TypeError('Valid personal scores/confidence required');
    const scores = personal.map(p => p.internalScore), confidence = Math.min(...personal.map(p => p.confidence));
    let base = c.neutral + confidence * (mean(scores) - c.neutral
      - c.disagreementBeta * (Math.max(...scores) - Math.min(...scores)));
    const negative = Math.min(0, ...personal.map(p => p.confidence * (p.internalScore - c.neutral)));
    if (negative < 0) base = Math.min(base, c.neutral + negative);
    let together = shared.together ?? 0, match = shared.match ?? 0;
    if (!finite(together) || !finite(match)) throw new TypeError('Finite shared contribution required');
    const sharedConfidence = shared.confidence ?? 0, sharedFreshness = shared.freshness ?? 0;
    if (![sharedConfidence, sharedFreshness].every(v => finite(v) && v >= 0 && v <= 1))
      throw new TypeError('Valid shared confidence/freshness required');
    const strongNegative = personal.some(p => p.confidence >= c.strongNegativeConfidence && p.internalScore < c.strongNegativeScore);
    if (strongNegative) { together = Math.min(0, together); match = Math.min(0, match); }
    return { score: bound(base + together + match, c.scoreMin, c.scoreMax), confidence,
      sharedEvidenceConfidence: sharedConfidence, sharedContextFreshness: sharedFreshness,
      contributions: { base, together, match }, sharedPositiveSuppressed: strongNegative };
  }
  function recommend(context, config = defaults) {
    const c = configuration(config);
    if (!context || !Array.isArray(context.users) || !Array.isArray(context.candidates))
      throw new TypeError('Users and candidates required');
    if (context.users.length !== c.supportedGroupSize)
      throw new TypeError('v1 requires exactly ' + c.supportedGroupSize + ' users');
    const users = context.users.map(u => ({ id: id(u?.id) })).sort((a, b) => compare(a.id, b.id));
    if (users.some(u => u.id === null) || new Set(users.map(u => u.id)).size !== users.length)
      throw new TypeError('Unique opaque user identifiers required');
    const at = timestamp(context.asOf), asOf = new Date(at).toISOString();
    const rawFeatures = context.contentFeatures || {}, normalized = Object.create(null);
    const ids = new Set([...Object.keys(rawFeatures), ...context.candidates.map(m => id(m?.movieId)).filter(Boolean)]);
    for (const movieId of [...ids].sort(compare)) normalized[movieId] = normalizeFeatures(
      Object.prototype.hasOwnProperty.call(rawFeatures, movieId) ? rawFeatures[movieId] : undefined, c);
    const shared = context.sharedSignals || {}, profiles = Object.create(null);
    for (const user of users) profiles[user.id] = buildProfile(
      context.personalSignals && Object.prototype.hasOwnProperty.call(context.personalSignals, user.id)
        ? context.personalSignals[user.id] : undefined, normalized, at, c);
    const joint = buildProfile({ ratings: shared.ratings }, normalized, at, c);
    const groupId = id(context.group?.id) || 'group';
    const results = eligibleCandidates(context.candidates, normalized, shared, context.constraints).map(movie => {
      const f = normalized[movie.movieId], personal = Object.create(null);
      for (const user of users) personal[user.id] = predictPersonal(movie.movieId, profiles[user.id], f, user.id, c);
      const evidence = sharedEvidence(movie.movieId, joint, f, profiles, users, groupId, c);
      const group = aggregateGroup(users.map(u => personal[u.id]), evidence, c);
      const sharedReasons = evidence.reasons.map(reason => ({ ...reason,
        scoreContribution: group.sharedPositiveSuppressed && reason.scoreContribution > 0 ? 0 : reason.scoreContribution,
        suppressed: group.sharedPositiveSuppressed && reason.scoreContribution > 0 }));
      return { movieId: movie.movieId, title: movie.title, personal, group,
        reasons: [...movie.reasons, ...users.flatMap(u => personal[u.id].reasons), ...sharedReasons],
        metadata: { modelVersion: c.modelVersion, configVersion: c.configVersion, asOf,
          evidenceProvenance: { personal: Object.fromEntries(users.map(u => [u.id, profiles[u.id].observations
            .map(o => ({ movieId: o.contentId, source: o.source, evidenceMass: o.mass }))])),
          shared: joint.observations.map(o => ({ movieId: o.contentId, source: 'together_rating', evidenceMass: o.mass })) } },
        features: f };
    });
    return results.sort(rankCompare);
  }
  const rankCompare = (a, b) => b.group.score - a.group.score
    || compare(text(a.title), text(b.title)) || compare(a.movieId, b.movieId);
  function rerank(rankedResults, size, config = defaults) {
    const c = configuration(config), requested = size ?? c.diversity.defaultShortlistSize;
    if (!Number.isInteger(requested) || requested < 0) throw new RangeError('Nonnegative integer shortlist size required');
    const unique = new Map();
    for (const row of rankedResults) {
      const previous = unique.get(row.movieId);
      if (previous && previous !== row && JSON.stringify(previous) !== JSON.stringify(row))
        throw new TypeError('Conflicting duplicate ranked result: ' + row.movieId);
      unique.set(row.movieId, row);
    }
    const pool = [...unique.values()].sort(rankCompare).slice(0, c.diversity.rerankPoolSize), selected = [];
    while (pool.length && selected.length < requested) {
      const options = [];
      for (const row of pool) {
        const sameCollection = selected.filter(s => row.features.collection.some(t => s.features.collection.includes(t))).length;
        if (sameCollection >= c.diversity.maxPerCollection) continue;
        let penalty = 0; const related = [];
        for (const prior of selected) {
          const union = new Set([...row.features.genre, ...prior.features.genre]);
          const intersection = row.features.genre.filter(t => prior.features.genre.includes(t)).length;
          const genrePenalty = union.size ? c.diversity.genrePenalty * intersection / union.size : 0;
          const directorPenalty = row.features.director.some(t => prior.features.director.includes(t)) ? c.diversity.directorPenalty : 0;
          penalty += genrePenalty + directorPenalty;
          if (genrePenalty + directorPenalty > 0) related.push(prior.movieId);
        }
        options.push({ row, penalty, related, score: row.group.score - penalty });
      }
      options.sort((a, b) => b.score - a.score || compare(text(a.row.title), text(b.row.title)) || compare(a.row.movieId, b.row.movieId));
      if (!options.length) break;
      const best = options[0];
      selected.push({ ...best.row, presentationScore: best.score, diversityAdjustment: best.penalty === 0 ? 0 : -best.penalty,
        reasons: [...best.row.reasons, factual('DIVERSITY_SELECTION', best.row.movieId,
          { relatedMovieIds: best.related, scoreContribution: 0, presentationContribution: -best.penalty })] });
      pool.splice(pool.indexOf(best.row), 1);
    }
    return selected;
  }
  return Object.freeze({ configuration, normalizeFeatures, validRating, ratingCenter, ratingSignal,
    eligibleCandidates, buildProfile, predictPersonal, aggregateGroup, recommend, rerank });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RecommendationEngine;
