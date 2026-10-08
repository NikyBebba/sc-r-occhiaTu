// Dichiarazioni personali; la visione insieme deriva solo dagli eventi.
function togetherSeen(movie, nights = movieNights) {
  return !!movie && nights.some(n => n.movie_id === movie.id && n.status === 'completed');
}
function isRewatch(movie, nights = movieNights) {
  return !!movie && movie.seen_n === true && movie.seen_v === true && !togetherSeen(movie, nights);
}
function normalListEligible(movie, nights = movieNights) {
  return !!movie && (!movie.status || ['watchlist','tonight','watched'].includes(movie.status)) && !togetherSeen(movie, nights)
    && !nights.some(n => n.movie_id === movie.id && (n.status === 'proposed' || n.status === 'confirmed'))
    && movie.in_shared_list === true;
}
function choiceEligible(movie, nights = movieNights, vetoed = []) {
  return normalListEligible(movie, nights) && !movie.cinema_watchlist && !vetoed.includes(movie.id);
}
function viewingState(movie) {
  const together = togetherSeen(movie);
  return { N: movie.seen_n === true, V: movie.seen_v === true, together };
}
function personalRating(movie, person) {
  if (person !== 'N' && person !== 'V') return null;
  const value = movie[person === 'N' ? 'seen_rating_n' : 'seen_rating_v'];
  return validMovieRating(value) ? value : null;
}
function togetherRating(movie) {
  return validMovieRating(movie.seen_rating_together) ? movie.seen_rating_together : null;
}
function reviewTextFor(movie, person) {
  const field = person === 'both' ? 'review_text_together'
    : person === 'N' ? 'review_text_n' : person === 'V' ? 'review_text_v' : null;
  return field ? movie[field] || '' : '';
}
function canUndoSeen(movie, person) {
  return person === currentUser && (person === 'N' || person === 'V') && movie['seen_' + person.toLowerCase()] === true;
}
// Solo il proprietario Auth; testo omesso conserva, vuoto rimuove.
async function markMovieSeen(id, person, rating = null, reviewText = null) {
  requireAppIdentity();
  if (person !== currentUser || (person !== 'N' && person !== 'V')) return false;
  if (rating !== null && !validMovieRating(rating)) return false;
  const key = person.toLowerCase();
  return updateMovie(id, { ['seen_' + key]: true,
    ...(rating !== null ? { ['seen_rating_' + key]: rating } : {}),
    ...(typeof reviewText === 'string' ? { ['review_text_' + key]: reviewText.trim() } : {}) });
}
async function undoMovieSeen(id, person) {
  requireAppIdentity();
  const movie = movies.find(m => m.id === id);
  if (!movie || !canUndoSeen(movie, person)) return false;
  return updateMovie(id, { ['seen_' + person.toLowerCase()]: false });
}
async function savePersonalReview(id, rating, text) {
  requireAppIdentity();
  if ((currentUser !== 'N' && currentUser !== 'V') || (rating !== null && !validMovieRating(rating))) return false;
  const key = currentUser.toLowerCase();
  return updateMovie(id, { ['seen_rating_' + key]: rating,
    ...(typeof text === 'string' ? { ['review_text_' + key]: text.trim() } : {}) });
}
function hasOtherPersonalData(movie) {
  const key = currentUser === 'N' ? 'v' : 'n';
  return movie['seen_' + key] === true || movie['seen_rating_' + key] != null || !!movie['review_text_' + key];
}
function canDeleteOrChangeIdentity(movie) {
  return !!movie && !hasOtherPersonalData(movie) && !movieNights.some(n => n.movie_id === movie.id);
}
function normalizeLocalMovie(movie, previous = null) {
  const together = togetherSeen(movie);
  movie.status = activeNightForMovie(movie.id) ? 'tonight' : together ? 'watched' : 'watchlist';
}
