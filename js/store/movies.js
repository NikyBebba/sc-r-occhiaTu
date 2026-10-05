// Film: dedup TMDb, CRUD, proposte legacy e sorpresa.
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
  const finalMovie = { ...newMovie };
  if (sb) {
    const { data, error } = await sb.from('movies').insert([newMovie]).select();
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
    }
    if (data && data[0]) finalMovie.id = data[0].id;
  }
  if (!finalMovie.id) finalMovie.id = Date.now().toString() + Math.random();
  movies.push(finalMovie); // teniamo movies aggiornato anche col DB attivo (es. dedup nel bulk)
  if (!sb) saveLocal();
  return finalMovie;
}

async function updateMovie(id, patch) {
  if (sb) {
    const { error } = await sb.from('movies').update(patch).eq('id', id);
    if (error) {
      console.error('[sc(r)occhiaTu] updateMovie fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
      return false;
    }
  } else {
    const m = movies.find(x => x.id === id);
    if (m) Object.assign(m, patch);
    saveLocal();
  }
  return true;
}

async function deleteMovie(id) {
  if (sb) {
    const { error } = await sb.from('movies').delete().eq('id', id);
    if (error) {
      console.error('[sc(r)occhiaTu] deleteMovie fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
  } else {
    movies = movies.filter(x => x.id !== id);
    votes = votes.filter(v => v.movie_id !== id);
    movieNights = movieNights.filter(n => n.movie_id !== id);
    saveLocal();
  }
}

// ---- Modalità sorpresa ----
async function setSurprise(id, person) {
  await updateMovie(id, { surprise_by: person });
}

async function revealSurprise(id) {
  await updateMovie(id, { surprise_by: null });
}
