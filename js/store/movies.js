// Film: dedup TMDb, CRUD e sorpresa.
// Dipende dallo stato e dalla persistenza core di js/store.js.

// Il titolo non identifica un film: omonimi e capitoli di una saga possono
// condividere il nome. Il controllo avviene sull'ID TMDb scelto nel picker.
function findDuplicateByTmdbId(tmdbId, excludeId = null) {
  if (tmdbId == null) return null;
  const id = String(tmdbId);
  return movies.find(m => m.id !== excludeId && m.tmdb_id != null && String(m.tmdb_id) === id) || null;
}

// ---- Persistenza ----
async function insertMovie(newMovie) {
  requireAppIdentity();
  const operationEpoch = authEpoch;
  if (!sb && findDuplicateByTmdbId(newMovie.tmdb_id)) return null;
  const finalMovie = { seen_n: false, seen_v: false, in_shared_list: false, ...newMovie };
  const other = currentUser === 'N' ? 'v' : 'n';
  if (finalMovie['seen_' + other] || finalMovie['seen_rating_' + other] != null || finalMovie['review_text_' + other] != null) return false;
  if (finalMovie.in_shared_list && finalMovie['seen_' + currentUser.toLowerCase()] && personalRating(finalMovie, currentUser) === null) return false;
  if (sb) {
    const { data, error } = await sb.from('movies').insert([finalMovie]).select('id');
    assertAuthEpoch(operationEpoch);
    handleDataAuthError(error);
    if (error) {
      // Il vincolo UNIQUE sull'ID TMDb può vincere la corsa fra due telefoni:
      // in quel caso non creare una copia solo nel mirror locale.
      if (error.code === '23505' && newMovie.tmdb_id != null) return null;
      // Migration cinema assente: non fingere il salvataggio in locale per poi
      // perdere il film al successivo refetch dal database.
      if ((error.code === '42703' || error.code === 'PGRST204') && newMovie.cinema_watchlist) {
        console.error('[sc(r)occhiaTu] Campo cinema non disponibile nel database:', error.message);
        return false;
      }
      console.error('[sc(r)occhiaTu] insertMovie fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
      return false;
    }
    if (!data?.length) return false;
    finalMovie.id = data[0].id;
  }
  if (!finalMovie.id) finalMovie.id = Date.now().toString() + Math.random();
  normalizeLocalMovie(finalMovie);
  movies.push(finalMovie); // teniamo movies aggiornato anche col DB attivo (es. dedup nel bulk)
  if (!sb) saveLocal();
  return finalMovie;
}

async function updateMovie(id, patch) {
  requireAppIdentity();
  const operationEpoch = authEpoch;
  const movie = movies.find(m => m.id === id);
  if (!movie) return false;
  const other = currentUser === 'N' ? 'v' : 'n';
  if (['seen_' + other, 'seen_rating_' + other, 'review_text_' + other].some(k => Object.hasOwn(patch,k) && patch[k] !== movie[k])) return false;
  if (Object.hasOwn(patch,'tmdb_id') && patch.tmdb_id !== movie.tmdb_id && !canDeleteOrChangeIdentity(movie)) return false;
  if (['watched_by','review_by','rating','review_text','id'].some(k => Object.hasOwn(patch,k))) return false;
  if (patch.in_shared_list === true && !movie.in_shared_list) {
    const next = { ...movie, ...patch };
    if (next['seen_' + currentUser.toLowerCase()] && personalRating(next, currentUser) === null) return false;
  }
  if (sb) {
    const { data, error } = await sb.from('movies').update(patch).eq('id', id).select('id');
    assertAuthEpoch(operationEpoch);
    handleDataAuthError(error);
    if (error) {
      console.error('[sc(r)occhiaTu] updateMovie fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
      return false;
    }
    if (!data?.length) return false;
  } else {
    const m = movies.find(x => x.id === id);
    if (m) { const previous = { ...m }; Object.assign(m, patch); normalizeLocalMovie(m, previous); }
    saveLocal();
  }
  return true;
}

async function deleteMovie(id) {
  requireAppIdentity();
  const operationEpoch = authEpoch;
  if (!canDeleteOrChangeIdentity(movies.find(m => m.id === id))) return false;
  if (sb) {
    const { data, error } = await sb.from('movies').delete().eq('id', id).select('id');
    assertAuthEpoch(operationEpoch);
    handleDataAuthError(error);
    if (error) {
      console.error('[sc(r)occhiaTu] deleteMovie fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
      return false;
    }
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
