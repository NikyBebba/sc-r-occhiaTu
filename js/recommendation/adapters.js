// Explicit AS-IS input only. Does not fetch, write or consult application globals.
const RecommendationAdapters = (() => {
  const engine = typeof module !== 'undefined' && module.exports ? require('./core') : RecommendationEngine;
  const identities = [{ person: 'N', rating: 'seen_rating_n', seen: 'seen_n', review: 'review_text_n' },
    { person: 'V', rating: 'seen_rating_v', seen: 'seen_v', review: 'review_text_v' }];
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function runtimeMinutes(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value !== 'string') return null;
    const hit = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:min)?$/i);
    const minutes = hit ? Number(hit[1]) : NaN;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }
  function fromMovies({ movies, movieNights = [], matchHistory = [], asOf,
    userIds = { N: 'N', V: 'V' }, groupId = 'shared', constraints = { context: 'streaming' } }) {
    if (!Array.isArray(movies) || !Array.isArray(movieNights) || !Array.isArray(matchHistory))
      throw new TypeError('Explicit arrays required');
    const byId = new Map();
    // Project first: unrelated legacy fields cannot influence duplicate resolution.
    for (const movie of movies) {
      if (movie?.id == null) continue;
      const row = { movieId: String(movie.id), title: typeof movie.title === 'string' ? movie.title : '',
        inSharedList: movie.in_shared_list === true, cinema: movie.cinema_watchlist === true,
        features: { genres: movie.genres, directors: movie.director, cast: movie.cast_names,
          runtimeMinutes: runtimeMinutes(movie.duration), releaseYear: movie.release_year, collectionId: movie.collection_id },
        ratings: identities.map(i => engine.validRating(movie[i.rating]) ? movie[i.rating] : null),
        seen: identities.map(i => movie[i.seen] === true), reviews: identities.map(i => movie[i.review] || null),
        togetherRating: engine.validRating(movie.seen_rating_together) ? movie.seen_rating_together : null,
        togetherReview: movie.review_text_together || null };
      // Compare normalized features, so token-order permutations remain equivalent.
      const signature = r => JSON.stringify({ ...r, features: engine.normalizeFeatures(r.features) });
      if (byId.has(row.movieId) && signature(byId.get(row.movieId)) !== signature(row))
        throw new TypeError('Conflicting duplicate movie: ' + row.movieId);
      byId.set(row.movieId, row);
    }
    const ordered = [...byId.values()].sort((a, b) => cmp(a.movieId, b.movieId));
    const users = identities.map(i => ({ id: userIds[i.person] }));
    if (users.some(u => typeof u.id !== 'string' || !u.id.trim()) || users[0].id === users[1].id)
      throw new TypeError('Two distinct mapped identifiers required');
    const personalSignals = Object.fromEntries(identities.map((identity, index) => [userIds[identity.person], {
      ratings: ordered.filter(r => r.ratings[index] !== null).map(r => ({ contentId: r.movieId, value: r.ratings[index] })),
      seen: ordered.filter(r => r.seen[index]).map(r => r.movieId),
      reviews: ordered.filter(r => r.reviews[index] !== null).map(r => ({ contentId: r.movieId, text: r.reviews[index] })),
      match: matchHistory.filter(r => r.person === identity.person && byId.has(String(r.movie_id)))
        .map(r => ({ contentId: String(r.movie_id), sessionId: r.session_id,
          liked: r.liked, createdAt: r.created_at }))
    }]));
    return { users, group: { id: groupId }, asOf, constraints: { ...constraints },
      candidates: ordered.map(({ movieId, title, inSharedList, cinema }) => ({ movieId, title, inSharedList, cinema })),
      contentFeatures: Object.fromEntries(ordered.map(r => [r.movieId, r.features])), personalSignals,
      sharedSignals: { ratings: ordered.filter(r => r.togetherRating !== null).map(r => ({ contentId: r.movieId, value: r.togetherRating })),
        reviews: ordered.filter(r => r.togetherReview !== null).map(r => ({ contentId: r.movieId, text: r.togetherReview })),
        events: movieNights.map(n => ({ movieId: n.movie_id == null ? null : String(n.movie_id), status: n.status })) } };
  }
  return Object.freeze({ fromMovies, runtimeMinutes });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RecommendationAdapters;
