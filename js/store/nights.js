// ============================================
// SERATE — entità movie_nights (step 2)
// Regola: 1 film = 1 contenuto, 1 serata = 1 evento. Più serate possono
// puntare allo stesso film (rewatch). Solo movie_nights possiede i dettagli
// di programmazione; movies.status conserva il ciclo di vita del film.
// ============================================

function activeNights() {
  return movieNights.filter(n => n.status === 'proposed' || n.status === 'confirmed');
}

// La serata "attiva" (proposta/confermata) più recente per un film.
function activeNightForMovie(movieId) {
  return activeNights()
    .filter(n => n.movie_id === movieId)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] || null;
}

// Adattatore di sola lettura: i nomi scheduled_* sono il contratto dei
// renderer/ticket, non una lettura del mirror su movies. Anche NULL e stringhe
// vuote dell'evento prevalgono: non recuperare dettagli obsoleti dal film.
function nightProjectionFields(night = null) {
  return {
    nightId: night?.id ?? null, scheduled_date: night?.date ?? null, scheduled_time: night?.time ?? null,
    snack: night?.snack ?? null, location: night?.location ?? null, proposed_by: night?.proposed_by ?? null,
    night_confirmed: night?.status === 'confirmed'
  };
}

function movieProjection(movie, night = activeNightForMovie(movie.id)) {
  return { ...movie, ...nightProjectionFields(night) };
}

// RPC unica: nessun DML diretto su movie_nights e nessun successo locale
// dopo un errore remoto. Il ramo senza SDK serve al mirror runtime/test locale.
async function manageMovieNight(action, id, nightId = null, details = {}) {
  requireAppIdentity();
  const epoch = authEpoch;
  const movie = movies.find(m => m.id === id);
  if (!movie) return null;
  if (sb) {
    let result;
    try {
      result = await sb.rpc('manage_movie_night', { p_action: action, p_movie_id: id, p_night_id: nightId,
        p_date: details.date ?? null, p_time: details.time ?? null, p_snack: details.snack ?? null,
        p_location: details.location ?? null, p_set_location: Object.hasOwn(details, 'location'),
        p_shared_rating: details.sharedRating ?? null, p_shared_text: details.sharedText ?? null });
    } catch (_) {
      assertAuthEpoch(epoch);
      console.error('[sc(r)occhiaTu] Serata non salvata: rete non disponibile.');
      dbMode = 'local'; lastSupabaseFailAt = Date.now(); return null;
    }
    assertAuthEpoch(epoch);
    handleDataAuthError(result.error);
    if (result.error) {
      console.error('[sc(r)occhiaTu] Serata non salvata:', result.error.message);
      return null;
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row?.id) return null;
    const index = movieNights.findIndex(n => n.id === row.id);
    if (index < 0) movieNights.unshift(row); else movieNights[index] = row;
    if (action === 'complete' || action === 'complete_now') {
      await loadMovies();
      assertAuthEpoch(epoch);
      return row;
    }
    normalizeLocalMovie(movie, { ...movie });
    if (details.sharedRating != null) movie.seen_rating_together = details.sharedRating;
    if (details.sharedText != null) movie.review_text_together = details.sharedText;
    saveLocal(); return row;
  }
  let newlyCompleted = false;
  let night = nightId ? movieNights.find(n => n.id === nightId && n.movie_id === id) : null;
  const now = new Date().toISOString();
  if (['propose','quick','complete_now'].includes(action)) {
    if (nightId || (action === 'propose' && !details.date)) return null;
    if (action === 'complete_now') night = movieNights.filter(n => n.movie_id === id && n.status === 'completed').sort((a,b) => (b.completed_at || b.created_at || '').localeCompare(a.completed_at || a.created_at || ''))[0] || null;
    if (!night) {
      newlyCompleted = action === 'complete_now';
      night = { id: Date.now().toString() + Math.random(), movie_id: id,
        date: action === 'propose' ? details.date : null,
        time: action === 'propose' ? details.time || '21:30' : null,
        snack: details.snack ?? null, location: details.location ?? null, proposed_by: currentUser,
        status: action === 'propose' ? 'proposed' : action === 'quick' ? 'confirmed' : 'completed',
        created_at: now, confirmed_at: action === 'quick' ? now : null,
        completed_at: action === 'complete_now' ? now : null };
      movieNights.unshift(night);
    }
  } else {
    if (!night) return null;
    if (action === 'edit') {
      if (!['proposed','confirmed','completed'].includes(night.status)) return null;
      if (night.status !== 'completed' && Object.hasOwn(details,'snack')) night.snack = details.snack;
    } else if (action === 'confirm') {
      if (!['proposed','confirmed'].includes(night.status) || (night.status === 'proposed' && night.proposed_by === currentUser)) return null;
      night.status = 'confirmed'; night.confirmed_at ||= now;
    } else if (action === 'cancel') {
      if (!['proposed','confirmed','cancelled'].includes(night.status)) return null;
      night.status = 'cancelled'; night.cancelled_at ||= now;
    } else if (action === 'complete') {
      if (!['proposed','confirmed','completed'].includes(night.status)) return null;
      newlyCompleted = night.status !== 'completed';
      night.status = 'completed'; night.completed_at ||= now;
    } else return null;
    if (Object.hasOwn(details,'location')) night.location = details.location;
  }
  if (details.sharedRating != null) movie.seen_rating_together = details.sharedRating;
  if (details.sharedText != null) movie.review_text_together = details.sharedText;
  normalizeLocalMovie(movie, { ...movie });
  if (newlyCompleted) movie.in_shared_list = false;
  saveLocal(); return night;
}
// Adattatori pubblici conservati; status/author/timestamp non vengono passati come patch.
async function insertMovieNight(night) {
  const action = night.status === 'proposed' ? 'propose' : night.status === 'confirmed' ? 'quick' : null;
  return action ? manageMovieNight(action, night.movie_id, null, night) : null;
}
async function updateMovieNight(id, patch) {
  const night = movieNights.find(n => n.id === id);
  if (!night || Object.keys(patch).some(k => !['snack','location'].includes(k))) return false;
  return !!(await manageMovieNight('edit', night.movie_id, id, { snack: night.snack, ...patch }));
}
async function setQuickTonight(id, snack = null, location = null) {
  return !!(await manageMovieNight('quick', id, null, { snack, location }));
}
async function proposeNight(id, person, date, time, snack, location = null) {
  requireAppIdentity();
  if (person !== currentUser) return false;
  return !!(await manageMovieNight('propose', id, null, { date, time, snack, location }));
}
async function confirmNight(id, nightId) {
  const night = nightId ? activeNights().find(n => n.id === nightId && n.movie_id === id) : activeNightForMovie(id);
  return !!night && !!(await manageMovieNight('confirm', id, night.id));
}
async function cancelNight(id, nightId) {
  const night = nightId ? activeNights().find(n => n.id === nightId && n.movie_id === id) : activeNightForMovie(id);
  return !!night && !!(await manageMovieNight('cancel', id, night.id));
}
async function completeNight(id, location = undefined, nightId = undefined, review = {}) {
  const night = nightId ? movieNights.find(n => n.id === nightId && n.movie_id === id) : activeNightForMovie(id);
  if (nightId && !night) return false;
  return !!(await manageMovieNight(night ? 'complete' : 'complete_now', id, night?.id || null,
    { ...(location !== undefined ? { location } : {}), ...review }));
}

// Il film corrente per il box "Prossimo Film".
// 1) Serate (movie_nights): priorità a quelle con data (prossima più vicina);
//    se nessuna ha data, si usano quelle "stasera" senza data.
// Senza evento attivo non esiste una proiezione, anche con mirror legacy.
function nextMoviePick() {
  const active = activeNights();
  const dated = active.filter(n => n.date);
  const bucket = dated.length ? dated : active;

  const sorted = bucket
    .map(n => ({ n, t: n.date ? new Date(`${n.date}T${n.time || '21:30'}:00`).getTime() : NaN }))
    .sort((a, b) => (Number.isNaN(a.t) ? 1 : Number.isNaN(b.t) ? -1 : a.t - b.t))
    .map(x => x.n);

  for (const night of sorted) {
    const m = movies.find(x => x.id === night.movie_id);
    if (m) {
      return { id: m.id, title: m.title, poster: m.poster, ...nightProjectionFields(night) };
    }
  }

  return null;
}

function localDateKey(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Tonight Mode si deriva soltanto dalle serate attive di oggi. Per i quick
// pick senza data conta il momento della conferma, non la data di creazione.
function tonightPick(now = new Date()) {
  const today = localDateKey(now);
  const matches = activeNights().filter(n =>
    n.date === today || (n.date == null && n.status === 'confirmed' && n.confirmed_at
      && localDateKey(new Date(n.confirmed_at)) === today));
  matches.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'confirmed' ? -1 : 1;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  for (const night of matches) {
    const m = movies.find(movie => movie.id === night.movie_id);
    if (!m) continue;
    return { id: m.id, title: m.title, poster: m.poster, ...nightProjectionFields(night) };
  }
  return null;
}
