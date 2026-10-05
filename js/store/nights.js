// ============================================
// SERATE — entità movie_nights (step 2)
// Regola: 1 film = 1 contenuto, 1 serata = 1 evento. Più serate possono
// puntare allo stesso film (rewatch). I campi legacy scheduled_*/proposed_by/
// night_confirmed su movies restano alimentati (strategia B) perché vecchi
// dati, tab e render continuino a funzionare senza riscrittura totale.
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
function nightProjectionFields(night) {
  return {
    nightId: night.id, scheduled_date: night.date, scheduled_time: night.time,
    snack: night.snack, location: night.location, proposed_by: night.proposed_by,
    night_confirmed: night.status === 'confirmed'
  };
}

function movieProjection(movie, night = activeNightForMovie(movie.id)) {
  return night ? { ...movie, ...nightProjectionFields(night) } : { ...movie };
}

async function insertMovieNight(night) {
  if (sb) {
    const { data, error } = await sb.from('movie_nights').insert([night]).select();
    if (error) {
      console.error('[sc(r)occhiaTu] insertMovieNight fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
    if (data && data[0]) { movieNights.unshift(data[0]); saveLocal(); return data[0]; }
    return null;
  }
  const created = { id: Date.now().toString() + Math.random(), ...night, created_at: new Date().toISOString() };
  movieNights.unshift(created);
  saveLocal();
  return created;
}

async function updateMovieNight(id, patch) {
  if (sb) {
    const { error } = await sb.from('movie_nights').update(patch).eq('id', id);
    if (error) {
      console.error('[sc(r)occhiaTu] updateMovieNight fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
      return false;
    }
    return true;
  }
  const n = movieNights.find(x => x.id === id);
  if (!n) return false;
  if (n) Object.assign(n, patch);
  saveLocal();
  return true;
}

// Scelta rapida di oggi, confermata direttamente; data NULL resta il contratto.
async function setQuickTonight(id, snack = null, location = null) {
  const night = await insertMovieNight({
    movie_id: id, date: null, time: null, snack, location,
    proposed_by: currentUser, status: 'confirmed', confirmed_at: new Date().toISOString()
  });
  if (!night) return false;
  await updateMovie(id, { status: 'tonight', scheduled_date: null, scheduled_time: null,
    snack, proposed_by: null, night_confirmed: false });
  return true;
}

// La proposta programmata conserva snack e luogo sull'evento, anche nei rewatch.
async function proposeNight(id, person, date, time, snack, location = null) {
  const night = await insertMovieNight({
    movie_id: id, date, time: time || '21:30', snack, location,
    proposed_by: person, status: 'proposed'
  });
  if (!night) return false;
  await updateMovie(id, {
    status: 'tonight', scheduled_date: date, scheduled_time: time || '21:30',
    snack, proposed_by: person, night_confirmed: false
  });
  return true;
}

async function confirmNight(id, nightId) {
  const night = nightId ? activeNights().find(n => n.id === nightId && n.movie_id === id) : activeNightForMovie(id);
  if (nightId && !night) return false;
  if (night && night.status === 'proposed') {
    if (!await updateMovieNight(night.id, { status: 'confirmed', confirmed_at: new Date().toISOString() })) return false;
  }
  if (!night || activeNightForMovie(id)?.id === night.id) await updateMovie(id, { night_confirmed: true });
  return true;
}

// Annulla/rifiuta: la serata attiva passa a 'cancelled', il film torna in
// watchlist e pulisce i campi serata legacy.
async function cancelNight(id, nightId) {
  const night = nightId ? activeNights().find(n => n.id === nightId && n.movie_id === id) : activeNightForMovie(id);
  if (nightId && !night) return false;
  if (night) {
    if (!await updateMovieNight(night.id, { status: 'cancelled', cancelled_at: new Date().toISOString() })) return false;
  }
  const remaining = activeNights().filter(n => n.movie_id === id && n.id !== night?.id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
  if (remaining) return updateMovie(id, { status: 'tonight', scheduled_date: remaining.date,
    scheduled_time: remaining.time, snack: remaining.snack, proposed_by: remaining.proposed_by, night_confirmed: remaining.status === 'confirmed' });
  await updateMovie(id, {
    status: 'watchlist',
    scheduled_date: null,
    scheduled_time: null,
    snack: null,
    proposed_by: null,
    night_confirmed: false
  });
}

// Serata "avvenuta": chiamata quando il film viene recensito come visto
// insieme (by='both'), da ui.confirmReview.
async function completeNight(id, location = undefined) {
  const nights = movieNights
    .filter(n => n.movie_id === id && (n.status === 'proposed' || n.status === 'confirmed'))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const night = nights[0];
  if (night) {
    return updateMovieNight(night.id, { status: 'completed', completed_at: new Date().toISOString(), location: location === undefined ? (night.location || null) : location });
  }
  // Una recensione insieme senza programmazione è comunque una visione:
  // registriamo l'evento ora, così il luogo ha un proprietario anche qui.
  return !!(await insertMovieNight({ movie_id: id, date: null, time: null,
    snack: null, location: location || null, proposed_by: null, status: 'completed',
    completed_at: new Date().toISOString() }));
}

// Il film corrente per il box "Prossimo Film".
// 1) Serate (movie_nights): priorità a quelle con data (prossima più vicina);
//    se nessuna ha data, si usano quelle "stasera" senza data.
// 2) Fallback legacy: dati pre-step2 senza riga in movie_nights.
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

  // Dati legacy (creati prima di movie_nights): state/flag sul film.
  // I film già visti (status 'watched') non sono mai una serata da programmare:
  // il mirror scheduled_date/night_confirmed sopravvive alla recensione, quindi
  // vanno esclusi esplicitamente (il percorso principale da activeNights() è già
  // coperto perché completeNight chiude le righe movie_nights).
  const candidates = movies.filter(m =>
    m.status !== 'watched' &&
    (m.status === 'tonight' || (m.scheduled_date && (m.night_confirmed || m.proposed_by)))
  );
  if (candidates.length === 0) return null;

  const pickTime = m => {
    if (!m.scheduled_date) return NaN;
    return new Date(`${m.scheduled_date}T${m.scheduled_time || '21:30'}:00`).getTime();
  };
  const scheduled = candidates.filter(m => m.scheduled_date);
  if (scheduled.length > 0) {
    return scheduled.sort((a, b) => pickTime(a) - pickTime(b))[0];
  }
  return candidates[candidates.length - 1];
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
