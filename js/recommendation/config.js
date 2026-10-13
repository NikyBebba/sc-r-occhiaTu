// Dormant module: not loaded by index.html or the production service worker.
// These empirical defaults are not truths about the personal rating scale.
const RecommendationConfig = (() => {
  const config = {
    modelVersion: 'stable-G4-polarity-v2', configVersion: 'v2.0.0',
    supportedGroupSize: 2,
    familyWeights: { genre: .30, director: .20, cast: .10, runtime: .15, era: .10, collection: .15 },
    ratingWeight: 1, preferenceWeight: .50,
    ratingNegativeBoundary: 5.5, ratingPositiveBoundary: 7,
    ratingAbsoluteAnchor: 6.25, ratingAbsoluteScale: 3.75, relativeAdjustment: .10,
    ratingAnchor: 7, ratingCenterShrinkageTau: 12, ratingScale: 2.5,
    featureShrinkageLambda: 3, profileShrinkageLambda: 4,
    seenPreferenceWeight: 0, togetherWeight: .4, togetherAbsoluteCap: .2,
    qualityPriorWeight: 0, negativeProtectionCap: 4,
    neutral: 5, outputScale: 5, scoreMin: 0, scoreMax: 10,
    ratingMin: 0, ratingMax: 10, ratingPrecision: 10,
    observedConfidence: .95, estimatedConfidenceThreshold: .2,
    strongNegativeConfidence: .6, strongNegativeScore: 4,
    reasonMinSupport: 2, reasonMinAffinity: .01, reasonMinConfidence: .02, reasonMinContribution: .001,
    runtimeBoundaries: [100, 120, 150], eraYears: 10,
    validationTolerance: 1e-9,
    diversity: { genrePenalty: .03, directorPenalty: .03, maxPerCollection: 1,
      rerankPoolSize: 30, defaultShortlistSize: 5 }
  };
  Object.freeze(config.familyWeights); Object.freeze(config.runtimeBoundaries);
  Object.freeze(config.diversity);
  return Object.freeze(config);
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RecommendationConfig;
