// Pure functions. Environment bridge only; no consumer or data-source access.
const RecommendationEngine = (() => {
  const defaults = typeof module !== 'undefined' && module.exports
    ? require('./config') : RecommendationConfig;
  const families = Object.keys(defaults.familyWeights);
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
    for (const key of ['matchWeight','matchSignalMagnitude','matchHalfLifeDays','doubleLikeContribution','doubleNopeContribution','disagreementBeta'])
      if (Object.prototype.hasOwnProperty.call(overrides,key)) throw new TypeError('Removed stable config: '+key);
    for (const key of Object.keys(overrides))
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) throw new TypeError('Unknown stable config: ' + key);
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
    for (const key of ['ratingScale', 'featureShrinkageLambda', 'profileShrinkageLambda', 'ratingAbsoluteScale',
      'outputScale', 'ratingPrecision', 'eraYears', 'validationTolerance'])
      if (c[key] <= 0) throw new RangeError('Positive config required: ' + key);
    for (const key of ['ratingWeight', 'preferenceWeight', 'relativeAdjustment', 'ratingCenterShrinkageTau',
      'togetherWeight', 'togetherAbsoluteCap',
      'reasonMinAffinity', 'reasonMinConfidence', 'reasonMinContribution'])
      if (c[key] < 0) throw new RangeError('Nonnegative config required: ' + key);
    if (c.seenPreferenceWeight !== 0 || c.qualityPriorWeight !== 0)
      throw new RangeError('Stable model supports neutral seen history and zero quality prior only');
    if (c.supportedGroupSize !== defaults.supportedGroupSize)
      throw new RangeError('Stable model requires exactly ' + defaults.supportedGroupSize + ' users');
    if (c.observedConfidence <= 0 || ![c.observedConfidence, c.estimatedConfidenceThreshold, c.strongNegativeConfidence,
        c.reasonMinConfidence].every(v => v >= 0 && v <= 1)) throw new RangeError('Invalid signal/confidence config');
    if (!(c.scoreMin < c.neutral && c.neutral < c.scoreMax && c.ratingMin < c.ratingMax)
      || c.ratingAnchor < c.ratingMin || c.ratingAnchor > c.ratingMax
      || c.strongNegativeScore < c.scoreMin || c.strongNegativeScore >= c.neutral)
      throw new RangeError('Invalid score/rating bounds');
    if (c.ratingNegativeBoundary !== 5.5 || c.ratingPositiveBoundary !== 7
      || c.negativeProtectionCap < c.scoreMin || c.negativeProtectionCap >= c.neutral)
      throw new RangeError('Invalid semantic polarity/protection bounds');
    if (!Number.isInteger(c.reasonMinSupport) || c.reasonMinSupport < 1
      || !Number.isInteger(c.eraYears) || !Number.isInteger(c.ratingPrecision)
      || !['maxPerCollection', 'rerankPoolSize', 'defaultShortlistSize'].every(k => Number.isInteger(c.diversity[k]))
      || c.diversity.maxPerCollection < 1) throw new RangeError('Invalid count config');
    if (!Array.isArray(c.runtimeBoundaries) || c.runtimeBoundaries.length !== defaults.runtimeBoundaries.length
      || !c.runtimeBoundaries.every((v, i, a) => finite(v) && v > 0 && (!i || v > a[i - 1])))
      throw new RangeError('Runtime boundaries must be increasing');
    return c;
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
  function ratingPolarity(value, config = defaults) {
    const c = configuration(config);
    if (!validRating(value,c)) throw new TypeError('Valid rating required');
    return value < c.ratingNegativeBoundary ? 'NEGATIVE' : value < c.ratingPositiveBoundary ? 'NEUTRAL' : 'POSITIVE';
  }
  function relativeRatingAffinity(value, center, config = defaults) {
    const c = configuration(config);
    if (!validRating(value,c) || !finite(center)) throw new TypeError('Valid rating and center required');
    return bound((value-center)/c.ratingScale,-1,1);
  }
  function ratingSignal(value, center, config = defaults) {
    const c = configuration(config), polarity=ratingPolarity(value,c);
    const relative=relativeRatingAffinity(value,center,c);
    if (polarity==='NEUTRAL') return 0;
    const absolute=bound((value-c.ratingAbsoluteAnchor)/c.ratingAbsoluteScale,-1,1);
    const signal=absolute+c.relativeAdjustment*relative;
    return polarity==='POSITIVE' ? bound(signal,0,1) : bound(signal,-1,0);
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
  function buildProfile(signals = {}, normalizedFeatures, asOf, config = defaults) {
    // asOf remains an optional compatibility argument; stable learning has no clock.
    const c=configuration(config), ratings=canonicalRatings(signals.ratings,c);
    const center=ratingCenter(ratings.map(r=>r.value),c), direct=new Map(), observations=new Map();
    for (const r of ratings) {
      const polarity=ratingPolarity(r.value,c);
      const observation={contentId:r.contentId, signal:ratingSignal(r.value,center,c), mass:c.ratingWeight,
        source:'rating', value:r.value, absolutePolarity:polarity,
        relativeRatingAffinity:relativeRatingAffinity(r.value,center,c),
        provenance:'PERSONAL_RATING_'+polarity, observationReliability:c.observedConfidence};
      direct.set(r.contentId,observation);
      if(observation.mass>0) observations.set(r.contentId,observation);
    }
    const preferences=new Map();
    for(const row of signals.preferences || []) {
      const contentId=id(row?.contentId);
      if(contentId===null || direct.has(contentId) || typeof row.value!=='boolean') continue;
      if(preferences.has(contentId) && preferences.get(contentId)!==row.value) throw new TypeError('Conflicting duplicate preference');
      preferences.set(contentId,row.value);
    }
    for(const [contentId,value] of [...preferences].sort((a,b)=>compare(a[0],b[0]))) {
      const observation={contentId,signal:value?1:-1,mass:c.preferenceWeight,source:'preference',value,
        absolutePolarity:value?'POSITIVE':'NEGATIVE',relativeRatingAffinity:null,
        provenance:value?'EXPLICIT_LIKE':'EXPLICIT_DISLIKE',observationReliability:c.observedConfidence};
      direct.set(contentId,observation);
      if(observation.mass>0) observations.set(contentId,observation);
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
    return { center, direct, observations: ordered, stats,
      totalEvidenceMass: ordered.reduce((s, o) => s + o.mass, 0) };
  }
  function supportReason(code, support, extra) {
    const entries = [...support.entries()].sort((a, b) => compare(a[0], b[0]));
    return { code, kind: 'inferred', evidenceMovieIds: entries.map(([key]) => key),
      ratingSupport: entries.filter(([, s]) => s.source === 'rating').length,
      preferenceSupport: entries.filter(([, s]) => s.source === 'preference').length,
      effectiveEvidenceMass: entries.reduce((s, [, entry]) => s + entry.mass, 0), ...extra };
  }
  function predictPersonal(movieId, profile, f, userId, config = defaults) {
    const c = configuration(config), direct = profile.direct.get(movieId);
    if (direct) {
      const richness=direct.mass;
      const factor=direct.source==='preference' ? richness/(richness+c.featureShrinkageLambda) : 1;
      const internalScore=bound(c.neutral+c.outputScale*direct.signal*factor,c.scoreMin,c.scoreMax);
      const confidence=c.observedConfidence*factor;
      return {score:internalScore,compatibilityIndex:internalScore,internalScore,confidence,
        predictionConfidence:confidence,state:'OBSERVED',provenance:direct.provenance,
        observedRating:direct.source==='rating'?direct.value:null,
        observedPreference:direct.source==='preference'?direct.value:null,
        absolutePolarity:direct.absolutePolarity,relativeRatingAffinity:direct.relativeRatingAffinity,
        stableSignal:direct.signal,observationReliability:direct.observationReliability,informationRichness:richness,
        reasons:[factual(direct.provenance,movieId,{userIds:[userId],observedValue:direct.value,
          ratingSupport:direct.source==='rating'?1:0,preferenceSupport:direct.source==='preference'?1:0,
          effectiveEvidenceMass:richness,absolutePolarity:direct.absolutePolarity,
          relativeRatingAffinity:direct.relativeRatingAffinity,strength:direct.signal,confidence,
          scoreContribution:internalScore-c.neutral})]};
    }
    let delta = 0, featureConfidence = 0; const reasons = [], contributingSupport = new Map();
    for (const family of families) {
      const affinities = [], confidences = [];
      for (const token of f[family]) {
        const st = profile.stats[family].get(token), mass = st?.evidenceMass || 0;
        const affinity = st ? st.signedMass / (mass + c.featureShrinkageLambda) : 0;
        const confidence = mass / (mass + c.featureShrinkageLambda);
        affinities.push(affinity); confidences.push(confidence);
        const contribution = c.outputScale * c.familyWeights[family] * affinity / f[family].length;
        if (st && contribution !== 0 && c.familyWeights[family] > 0)
          for (const [key, support] of st.support) contributingSupport.set(key, { ...support, mass: profile.direct.get(key)?.mass ?? support.mass });
        // Entity-specific support: aggregate cast evidence cannot name an unsupported actor.
        if (st && st.support.size >= c.reasonMinSupport
          && Math.abs(affinity) > c.reasonMinAffinity
          && confidence > c.reasonMinConfidence && Math.abs(contribution) >= c.reasonMinContribution) {
          reasons.push(supportReason('FEATURE_AFFINITY', st.support, { userIds: [userId], family, token,
            polarity: affinity > 0 ? 'inferred_positive' : 'inferred_negative', strength: affinity,
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
    if (!reasons.length && Math.abs(internalScore-c.neutral) >= c.reasonMinContribution && contributingSupport.size)
      reasons.push(supportReason('FEATURE_AFFINITY',contributingSupport,{userIds:[userId],strength:delta,confidence,
        scoreContribution:internalScore-c.neutral,aggregateOnly:true}));
    const state=confidence===0?'UNKNOWN':confidence<c.estimatedConfidenceThreshold?'LOW_EVIDENCE':'INFERRED';
    const publicScore=state==='UNKNOWN'||state==='LOW_EVIDENCE'?null:internalScore;
    return {score:publicScore,compatibilityIndex:publicScore,internalScore,confidence,predictionConfidence:confidence,
      state,provenance:state==='INFERRED'?'FEATURE_AFFINITY':state,observedRating:null,observedPreference:null,
      absolutePolarity:null,relativeRatingAffinity:null,stableSignal:delta,
      observationReliability:null,informationRichness:profile.totalEvidenceMass,
      reasons:[...reasons,...(state==='INFERRED'?[]:[{code:state,kind:'status',evidenceMovieIds:[],scoreContribution:0}])]};
  }
  function sharedEvidence(movieId, sharedProfile, features, groupId, config = defaults) {
    const c=configuration(config), joint=predictPersonal(movieId,sharedProfile,features,groupId,c);
    const together=bound(c.togetherWeight*joint.confidence*(joint.internalScore-c.neutral),-c.togetherAbsoluteCap,c.togetherAbsoluteCap);
    const evidence=joint.reasons.filter(r=>r.evidenceMovieIds.length);
    const reasons=evidence.length && (joint.state==='OBSERVED'||Math.abs(together)>=c.reasonMinContribution)
      ? [{code:'TOGETHER_RATING',kind:joint.state==='OBSERVED'?'factual':'inferred',groupId,
        evidenceMovieIds:[...new Set(evidence.flatMap(r=>r.evidenceMovieIds))].sort(compare),
        confidence:joint.confidence,scoreContribution:together,
        evidence:evidence.map(({userIds,...r})=>({...r,groupId,code:'TOGETHER_RATING'}))}] : [];
    return {together,reasons,confidence:joint.confidence};
  }
  function aggregateGroup(personal, shared = {}, config = defaults) {
    const c=configuration(config);
    if(!Array.isArray(personal)||personal.length!==c.supportedGroupSize) throw new TypeError('Requires exactly 2 personal scores');
    if(!personal.every(p=>p&&finite(p.internalScore)&&finite(p.confidence)&&p.internalScore>=c.scoreMin&&p.internalScore<=c.scoreMax&&p.confidence>=0&&p.confidence<=1)) throw new TypeError('Valid personal scores/confidence required');
    const confidence=Math.min(...personal.map(p=>p.confidence));
    const base=c.neutral+confidence*(Math.min(...personal.map(p=>p.internalScore))-c.neutral);
    let together=shared.together??0;
    const sharedConfidence=shared.confidence??0;
    if(!finite(together)) throw new TypeError('Finite shared contribution required');
    if(!finite(sharedConfidence)||sharedConfidence<0||sharedConfidence>1) throw new TypeError('Valid shared confidence required');
    const protectedUsers=personal.filter(p=>p.state==='OBSERVED'
      ? p.absolutePolarity==='NEGATIVE' && p.observationReliability>=c.strongNegativeConfidence
      : p.state==='INFERRED' && p.internalScore<c.strongNegativeScore && p.confidence>=c.strongNegativeConfidence);
    const suppressed=protectedUsers.length>0 && together>0;
    if(suppressed) together=0;
    const beforeProtection=bound(base+together,c.scoreMin,c.scoreMax);
    const score=protectedUsers.length?Math.min(beforeProtection,c.negativeProtectionCap):beforeProtection;
    return {score,confidence,groupConfidence:confidence,sharedEvidenceConfidence:sharedConfidence,
      contributions:{base,together,negativeProtection:score-beforeProtection},
      negativeProtectionApplied:protectedUsers.length>0&&(suppressed||score<beforeProtection),
      sharedPositiveSuppressed:suppressed};
  }
  function recommend(context, config = defaults) {
    const c = configuration(config);
    if (!context || !Array.isArray(context.users) || !Array.isArray(context.candidates))
      throw new TypeError('Users and candidates required');
    if (context.users.length !== c.supportedGroupSize)
      throw new TypeError('Stable model requires exactly ' + c.supportedGroupSize + ' users');
    const users = context.users.map(u => ({ id: id(u?.id) })).sort((a, b) => compare(a.id, b.id));
    if (users.some(u => u.id === null) || new Set(users.map(u => u.id)).size !== users.length)
      throw new TypeError('Unique opaque user identifiers required');
    const at = undefined;
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
      const evidence = sharedEvidence(movie.movieId, joint, f, groupId, c);
      const group = aggregateGroup(users.map(u => personal[u.id]), evidence, c);
      const sharedReasons = evidence.reasons.map(reason => ({ ...reason,
        scoreContribution: group.sharedPositiveSuppressed && reason.scoreContribution > 0 ? 0 : reason.scoreContribution,
        suppressed: group.sharedPositiveSuppressed && reason.scoreContribution > 0 }));
      return { movieId: movie.movieId, title: movie.title, personal, group,
        reasons: [...movie.reasons, ...users.flatMap(u => personal[u.id].reasons), ...sharedReasons, ...(group.negativeProtectionApplied ? [{code:'NEGATIVE_PROTECTION',kind:'model',evidenceMovieIds:[movie.movieId],scoreContribution:group.contributions.negativeProtection,sharedPositiveSuppressed:group.sharedPositiveSuppressed}] : [])],
        metadata: { modelVersion: c.modelVersion, configVersion: c.configVersion,
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
  return Object.freeze({ configuration, normalizeFeatures, validRating, ratingCenter, ratingSignal, ratingPolarity, relativeRatingAffinity, sharedEvidence,
    eligibleCandidates, buildProfile, predictPersonal, aggregateGroup, recommend, rerank });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RecommendationEngine;
