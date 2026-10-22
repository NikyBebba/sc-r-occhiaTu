// Film: dedup TMDb, CRUD e sorpresa.
// Dipende dallo stato e dalla persistenza core di js/store.js.

// Il titolo non identifica un film: omonimi e capitoli di una saga possono
// condividere il nome. Il controllo avviene sull'ID TMDb scelto nel picker.
function findDuplicateByTmdbId(tmdbId, excludeId = null) {
  if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess();
  if (tmdbId == null) return null;
  const id = String(tmdbId);
  return movies.find(m => m.id !== excludeId && m.tmdb_id != null && String(m.tmdb_id) === id) || null;
}

// Normalize only explicit fields; never infer preference from other signals.
const PERSONAL_PREFERENCE_FIELDS = ['personal_liked_n', 'personal_liked_v',
  'personal_liked_updated_at_n', 'personal_liked_updated_at_v'];
function normalizeMoviePersonalFeedback(movie) {
  const normalized = { ...movie };
  // Canonical placement avoids a false Realtime change for legacy missing fields.
  for (const field of PERSONAL_PREFERENCE_FIELDS) delete normalized[field];
  for (const person of ['n', 'v']) {
    const key = 'personal_liked_' + person;
    normalized[key] = movie[key] === true || movie[key] === false ? movie[key] : null;
    const timestamp = movie['personal_liked_updated_at_' + person];
    normalized['personal_liked_updated_at_' + person] = typeof timestamp === 'string' ? timestamp : null;
  }
  return normalized;
}
let lastMovieMutationError = null;
function rejectMovieMutation(code) {
  lastMovieMutationError = { code };
  return false;
}
function isMovieBusinessError(error) {
  if (!error) return false;
  // Only named ownership guards bypass generic Auth handling; RLS/Auth stays fail-closed.
  const named = /\b(PERSONAL_OWNER_REQUIRED|PERSONAL_FEEDBACK_REQUIRED|PERSONAL_RATING_REQUIRED|MOVIE_PROTECTED|MOVIE_IDENTITY_PROTECTED|IMMUTABLE_ID|LEGACY_FROZEN|LEGACY_OR_SHARED_INSERT_FORBIDDEN|COMPLETED_NIGHT_REQUIRED)\b/.test(error.message || '');
  if (named) return true;
  if ((typeof isAuthFailure === 'function' && isAuthFailure(error)) || [401, 403].includes(error.status)
      || ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error.code)) return false;
  return /^(22|23)/.test(error.code || '')
    || ['PGRST204', 'PGRST202', '42703'].includes(error.code)
    || [400, 409, 422].includes(error.status);
}
function movieMutationErrorMessage() {
  const error = lastMovieMutationError;
  if (!error) return '';
  if (/PERSONAL_(FEEDBACK|RATING)_REQUIRED/.test(error.code + ' ' + (error.message || '')))
    return 'Per candidare un film già visto serve un voto o un feedback personale.';
  if (error.code === 'PERSONAL_RATING_PRESENT' || /movies_personal_feedback_[nv]_exclusive/.test(error.message || ''))
    return 'Rimuovi prima il tuo voto per dichiarare un feedback personale.';
  if (error.code === 'PERSONAL_PREFERENCE_ONLINE_REQUIRED') return 'Il feedback personale richiede la connessione.';
  if (/OWNER_REQUIRED|PROTECTED|IMMUTABLE|FROZEN|FORBIDDEN/.test(error.code + ' ' + (error.message || '')))
    return 'Questa modifica non è consentita.';
  return '';
}
function movieMutationFailed(error) {
  if (isMovieBusinessError(error)) {
    lastMovieMutationError = error;
    return false;
  }
  handleDataAuthError(error);
  lastMovieMutationError = error;
  dbMode = 'local';
  lastSupabaseFailAt = Date.now();
  return false;
}
// ---- Persistenza ----
async function insertMovie(newMovie) {
  if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess();
  requireAppIdentity();
  const operationEpoch = authEpoch;
  lastMovieMutationError = null;
  if (!sb && findDuplicateByTmdbId(newMovie.tmdb_id)) return null;
  if (['personal_liked_updated_at_n', 'personal_liked_updated_at_v'].some(k => Object.hasOwn(newMovie, k))) return rejectMovieMutation('SERVER_TIMESTAMP_REQUIRED');
  const finalMovie = { seen_n: false, seen_v: false, in_shared_list: false, ...newMovie };
  const other = currentUser === 'N' ? 'v' : 'n';
  if (finalMovie['seen_' + other] || finalMovie['seen_rating_' + other] != null || finalMovie['review_text_' + other] != null || finalMovie['personal_liked_' + other] != null) return false;
  const own = currentUser.toLowerCase();
  if (Object.hasOwn(finalMovie, 'seen_rating_' + own) && finalMovie['seen_rating_' + own] !== null && !validMovieRating(finalMovie['seen_rating_' + own])) return rejectMovieMutation('INVALID_PERSONAL_RATING');
  if (Object.hasOwn(finalMovie, 'personal_liked_' + own) && ![true, false, null].includes(finalMovie['personal_liked_' + own])) return rejectMovieMutation('INVALID_PERSONAL_PREFERENCE');
  if (!sb && (finalMovie['personal_liked_' + own] === true || finalMovie['personal_liked_' + own] === false)) return rejectMovieMutation('PERSONAL_PREFERENCE_ONLINE_REQUIRED');
  const finalFeedback = { ...finalMovie, ...(finalMovie['seen_rating_' + own] != null && validMovieRating(finalMovie['seen_rating_' + own]) ? { ['personal_liked_' + own]: null } : {}) };
  if (finalMovie.in_shared_list && finalMovie['seen_' + own] && !hasPersonalFeedback(finalFeedback, currentUser)) return rejectMovieMutation('PERSONAL_FEEDBACK_REQUIRED');
  if (sb) {
    let result;
    try { result = await sb.from('movies').insert([finalMovie]).select(typeof MOVIE_SELECT_FIELDS === 'undefined' ? '*' : MOVIE_SELECT_FIELDS); }
    catch (error) { assertAuthEpoch(operationEpoch); if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess(); return movieMutationFailed(error); }
    const { data, error } = result;
    assertAuthEpoch(operationEpoch); if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess();
    if (error && isMovieBusinessError(error)) {
      if (error.code === '23505' && newMovie.tmdb_id != null) return null;
      lastMovieMutationError = error; return false;
    }
    if (error) return movieMutationFailed(error);
    if (!data?.length) return false;
    Object.assign(finalMovie, data[0]);
  }
  if (!finalMovie.id) finalMovie.id = Date.now().toString() + Math.random();
  Object.assign(finalMovie, normalizeMoviePersonalFeedback(finalMovie));
  normalizeLocalMovie(finalMovie);
  movies.push(finalMovie); // teniamo movies aggiornato anche col DB attivo (es. dedup nel bulk)
  if (!sb) saveLocal();
  return finalMovie;
}

async function updateMovie(id, patch) {
  if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess();
  requireAppIdentity();
  const operationEpoch = authEpoch;
  lastMovieMutationError = null;
  const movie = movies.find(m => m.id === id);
  if (!movie || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  const own = currentUser.toLowerCase(), other = currentUser === 'N' ? 'v' : 'n';
  if (['seen_' + other, 'seen_rating_' + other, 'review_text_' + other, 'personal_liked_' + other,
    'personal_liked_updated_at_' + other].some(k => Object.hasOwn(patch, k))) return rejectMovieMutation('PERSONAL_OWNER_REQUIRED');
  if (['personal_liked_updated_at_n', 'personal_liked_updated_at_v'].some(k => Object.hasOwn(patch, k))) return rejectMovieMutation('SERVER_TIMESTAMP_REQUIRED');
  if (Object.hasOwn(patch, 'tmdb_id') && patch.tmdb_id !== movie.tmdb_id && !canDeleteOrChangeIdentity(movie)) return rejectMovieMutation('MOVIE_IDENTITY_PROTECTED');
  if (['watched_by', 'review_by', 'rating', 'review_text', 'id'].some(k => Object.hasOwn(patch, k))) return rejectMovieMutation('LEGACY_FROZEN');
  const ratingOperation = Object.hasOwn(patch, 'seen_rating_' + own);
  const preferenceOperation = Object.hasOwn(patch, 'personal_liked_' + own);
  if (ratingOperation && patch['seen_rating_' + own] !== null && !validMovieRating(patch['seen_rating_' + own])) return rejectMovieMutation('INVALID_PERSONAL_RATING');
  if (preferenceOperation && ![true, false, null].includes(patch['personal_liked_' + own])) return rejectMovieMutation('INVALID_PERSONAL_PREFERENCE');
  if (preferenceOperation && (!sb || (typeof dbMode !== 'undefined' && dbMode === 'local'))) return rejectMovieMutation('PERSONAL_PREFERENCE_ONLINE_REQUIRED');
  if (preferenceOperation && !ratingOperation && patch['personal_liked_' + own] !== null && personalRating(movie, currentUser) !== null) return rejectMovieMutation('PERSONAL_RATING_PRESENT');
  const next = { ...movie, ...patch };
  if (ratingOperation) { next['personal_liked_' + own] = null; next['personal_liked_updated_at_' + own] = null; }
  if (patch.in_shared_list === true && !movie.in_shared_list && next['seen_' + own] && !hasPersonalFeedback(next, currentUser)) return rejectMovieMutation('PERSONAL_FEEDBACK_REQUIRED');
  // Snapshot a narrow patch before awaiting: caller mutation cannot change the request.
  const write = { ...patch };
  if (sb) {
    let result;
    try { result = await sb.from('movies').update(write).eq('id', id)
      .select(typeof MOVIE_SELECT_FIELDS === 'undefined' ? '*' : MOVIE_SELECT_FIELDS); }
    catch (error) { assertAuthEpoch(operationEpoch); if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess(); return movieMutationFailed(error); }
    assertAuthEpoch(operationEpoch); if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess();
    if (result.error) return movieMutationFailed(result.error);
    const row = result.data?.[0];
    if (!row || row.id !== id) return false;
    if ((preferenceOperation || ratingOperation && personalPreference(movie, currentUser) !== null)
        && !PERSONAL_PREFERENCE_FIELDS.every(k => Object.hasOwn(row, k))) return rejectMovieMutation('AUTHORITATIVE_FEEDBACK_RESPONSE_REQUIRED');
    const target = movies.find(m => m.id === id);
    if (target) {
      // Apply only written fields + DB-normalized owner feedback, never stale foreign fields.
      const keys = [...Object.keys(write)];
      if (ratingOperation || preferenceOperation) keys.push('personal_liked_' + own, 'personal_liked_updated_at_' + own);
      for (const key of keys) if (Object.hasOwn(row, key)) target[key] = row[key];
      if (typeof saveLocal === 'function') saveLocal();
    }
  } else {
    const previous = { ...movie };
    Object.assign(movie, write);
    if (ratingOperation) { movie['personal_liked_' + own] = null; movie['personal_liked_updated_at_' + own] = null; }
    normalizeLocalMovie(movie, previous);
    saveLocal();
  }
  return true;
}

async function deleteMovie(id) {
  if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess();
  requireAppIdentity();
  const operationEpoch = authEpoch;
  if (!canDeleteOrChangeIdentity(movies.find(m => m.id === id))) return false;
  if (sb) {
    const { data, error } = await sb.from('movies').delete().eq('id', id).select('id');
    assertAuthEpoch(operationEpoch); if (typeof assertLegacyDomainAccess === 'function') assertLegacyDomainAccess();
    if (error) return movieMutationFailed(error);
    if (!data?.length) return false;
  } else {
    movies = movies.filter(x => x.id !== id);
    movieNights = movieNights.filter(n => n.movie_id !== id);
    saveLocal();
  }
  return true;
}

// ---- Modalità sorpresa ----
async function setSurprise(id, person) {
  await updateMovie(id, { surprise_by: person });
}

async function revealSurprise(id) {
  await updateMovie(id, { surprise_by: null });
}
