// ============================================
// Livello dati — Supabase (con fallback localStorage e Realtime)
// ============================================

let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_URL.startsWith('http') &&
    window.supabase && window.supabase.createClient) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

let movies = [];
let votes = [];   // { id, movie_id, person, liked }
let vetoes = [];  // { id, person, movie_id, week_key }
let movieNights = []; // { id, movie_id, date, time, snack, proposed_by, status, ... }

// Modalità di persistenza corrente. 'supabase' = DB raggiungibile e usato.
// 'local' = database degradato/non raggiungibile: usiamo il mirror in
// localStorage. Il fallback NON è silenzioso: viene loggato e segnalato in
// UI (badge). Si ritenta di tornare a Supabase a ogni azione/load.
let dbMode = supabase ? 'supabase' : 'local';

// Dopo un fallimento di Supabase non riproviamo subito: aspettiamo un po'
// (rete up/down) per non martellare un DB che non risponde.
let lastSupabaseFailAt = 0;
const SUPABASE_RETRY_MS = 15000;

// Realtime: UN solo canale per sessione, con re-sync debounced e render
// solo se il dato è davvero cambiato (niente loop su echi delle proprie
// scritture).
let realtimeChannel = null;
let resyncTimer = null;
// Se la tabella movie_nights non esiste ancora (migration non applicata)
// evito di sottoscriverla: altrimenti supabase-js tenta join ripetuti.
let movieNightsAvailable = true;

function normalizeTitle(t) {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Ritorna il film esistente con titolo uguale (case-insensitive), o null
function findDuplicate(title) {
  const norm = normalizeTitle(title);
  return movies.find(m => normalizeTitle(m.title) === norm) || null;
}

// ---- Persistenza ----

function saveLocal() {
  localStorage.setItem('scorochiatu_movies', JSON.stringify(movies));
  localStorage.setItem('scorochiatu_votes', JSON.stringify(votes));
  localStorage.setItem('scorochiatu_vetoes', JSON.stringify(vetoes));
  localStorage.setItem('scorochiatu_movie_nights', JSON.stringify(movieNights));
}

function loadLocal() {
  movies = JSON.parse(localStorage.getItem('scorochiatu_movies') || '[]');
  votes = JSON.parse(localStorage.getItem('scorochiatu_votes') || '[]');
  vetoes = JSON.parse(localStorage.getItem('scorochiatu_vetoes') || '[]');
  movieNights = JSON.parse(localStorage.getItem('scorochiatu_movie_nights') || '[]');
  if (!Array.isArray(movieNights)) movieNights = [];
}

// Legge tutto da Supabase. Se fallisce (o se siamo in modalità locale e nel
// periodo di "respiro") ritorna null: chi chiama usa loadLocal().
async function fetchAll() {
  if (!supabase) return null;
  if (dbMode === 'local' && Date.now() - lastSupabaseFailAt < SUPABASE_RETRY_MS) return null;
  const [moviesRes, votesRes, vetoesRes, nightsRes] = await Promise.all([
    supabase.from('movies').select('*').order('created_at', { ascending: false }),
    supabase.from('votes').select('*'),
    supabase.from('vetoes').select('*'),
    supabase.from('movie_nights').select('*').order('created_at', { ascending: false })
  ]);
  const coreFailed = moviesRes.error || votesRes.error || vetoesRes.error;
  if (coreFailed) {
    dbMode = 'local';
    lastSupabaseFailAt = Date.now();
    console.error('[sc(r)occhiaTu] Errore lettura Supabase — attivo modalità locale (fallback).',
      { movies: moviesRes.error, votes: votesRes.error, vetoes: vetoesRes.error, nights: nightsRes.error });
    return null;
  }
  dbMode = 'supabase';
  // movie_nights può non esistere ancora (migration non applicata) oppure
  // fallire per altri motivi: NON è fatale, senza serate il box "Prossimo
  // Film" funziona col fallback legacy sui flag del film.
  let nights = [];
  if (nightsRes.error) {
    movieNightsAvailable = false;
    if (Date.now() - (fetchAll.__lastNightsWarn || 0) > 60000) {
      console.warn('[sc(r)occhiaTu] movie_nights non disponibile:', nightsRes.error.message, '— il box usa i dati legacy.');
      fetchAll.__lastNightsWarn = Date.now();
    }
  } else {
    movieNightsAvailable = true;
    nights = nightsRes.data || [];
  }
  return {
    movies: moviesRes.data || [],
    votes: votesRes.data || [],
    vetoes: vetoesRes.data || [],
    nights
  };
}

function dataSignature() {
  return JSON.stringify([movies, votes, vetoes, movieNights]);
}

async function loadMovies() {
  const remote = await fetchAll();
  if (remote) {
    movies = remote.movies;
    votes = remote.votes;
    vetoes = remote.vetoes;
    movieNights = remote.nights;
    saveLocal(); // il localStorage è anche un mirror del DB (= fallback utile)
  } else {
    loadLocal();
  }
  render();
}

// Refresh "in silenzio" usato dal realtime: ricarica tutto e fa render SOLO
// se il dato è cambiato. Così un'azione locale (che fa già render via
// loadMovies) non produce un secondo render per l'eco della propria scrittura,
// e i burst di eventi riescono a un solo render complessivo.
async function resyncQuiet() {
  const prev = dataSignature();
  const remote = await fetchAll();
  if (remote) {
    movies = remote.movies;
    votes = remote.votes;
    vetoes = remote.vetoes;
    movieNights = remote.nights;
    saveLocal();
  } else {
    loadLocal();
  }
  if (dataSignature() !== prev) render();
}

function onDbChange() {
  if (resyncTimer) return;
  resyncTimer = setTimeout(async () => {
    resyncTimer = null;
    await resyncQuiet();
  }, 120);
}

// ---- Realtime: un solo canale per sessione ----
function subscribeRealtime() {
  if (realtimeChannel || !supabase) return;
  const channel = supabase
    .channel('scorochiatu-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'movies' }, onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vetoes' }, onDbChange);
  if (movieNightsAvailable) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'movie_nights' }, onDbChange);
  }
  realtimeChannel = channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') return;
    if (err) console.warn('[sc(r)occhiaTu] Realtime non attivo (' + status + '):', err.message);
    else console.warn('[sc(r)occhiaTu] Realtime non attivo (' + status + ')');
  });
}

function unsubscribeRealtime() {
  if (realtimeChannel && supabase) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

async function insertMovie(newMovie) {
  const finalMovie = { ...newMovie };
  if (supabase) {
    const { data, error } = await supabase.from('movies').insert([newMovie]).select();
    if (error) {
      console.error('[sc(r)occhiaTu] insertMovie fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
    if (data && data[0]) finalMovie.id = data[0].id;
  }
  if (!finalMovie.id) finalMovie.id = Date.now().toString() + Math.random();
  movies.push(finalMovie); // teniamo movies aggiornato anche col DB attivo (es. dedup nel bulk)
  if (!supabase) saveLocal();
  return finalMovie;
}

async function updateMovie(id, patch) {
  if (supabase) {
    const { error } = await supabase.from('movies').update(patch).eq('id', id);
    if (error) {
      console.error('[sc(r)occhiaTu] updateMovie fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
  } else {
    const m = movies.find(x => x.id === id);
    if (m) Object.assign(m, patch);
    saveLocal();
  }
}

async function deleteMovie(id) {
  if (supabase) {
    const { error } = await supabase.from('movies').delete().eq('id', id);
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

// ---- Proposte in app (un film proposto da uno, da accettare dall'altro) ----
async function proposeMovie(movieData, proposedBy) {
  await insertMovie({ ...movieData, status: 'proposal', proposed_by: proposedBy, added_by: proposedBy });
}

async function acceptProposal(id) {
  await updateMovie(id, { status: 'watchlist' });
}

async function rejectProposal(id) {
  await deleteMovie(id);
}

// ---- Modalità sorpresa ----
async function setSurprise(id, person) {
  await updateMovie(id, { surprise_by: person });
}

async function revealSurprise(id) {
  await updateMovie(id, { surprise_by: null });
}

// ---- Match % — voto indipendente like/dislike per film ----
function getVotesForMovie(movieId) {
  const out = {};
  votes.filter(v => v.movie_id === movieId).forEach(v => { out[v.person] = v.liked; });
  return out;
}

async function castVote(movieId, person, liked) {
  if (supabase) {
    const { error } = await supabase.from('votes').upsert([{ movie_id: movieId, person, liked }], { onConflict: 'movie_id,person' });
    if (error) {
      console.error('[sc(r)occhiaTu] castVote fallito su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
    const { data } = await supabase.from('votes').select('*');
    if (data) { votes = data; saveLocal(); }
  } else {
    const existing = votes.find(v => v.movie_id === movieId && v.person === person);
    if (existing) existing.liked = liked;
    else votes.push({ id: Date.now().toString() + Math.random(), movie_id: movieId, person, liked });
    saveLocal();
  }
}

// ---- Veto settimanale (1 a testa per settimana) ----
function currentWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function vetoUsedThisWeek(person) {
  const wk = currentWeekKey();
  return vetoes.some(v => v.person === person && v.week_key === wk);
}

function vetoedMovieIdsThisWeek() {
  const wk = currentWeekKey();
  return vetoes.filter(v => v.week_key === wk).map(v => v.movie_id);
}

async function addVeto(person, movieId) {
  const wk = currentWeekKey();
  if (vetoUsedThisWeek(person)) return false;
  if (supabase) {
    const { error } = await supabase.from('vetoes').insert([{ person, movie_id: movieId, week_key: wk }]);
    if (error) {
      console.error('[sc(r)occhiaTu] addVeto fallito su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
    const { data } = await supabase.from('vetoes').select('*');
    if (data) { vetoes = data; saveLocal(); }
  } else {
    vetoes.push({ id: Date.now().toString() + Math.random(), person, movie_id: movieId, week_key: wk });
    saveLocal();
  }
  return true;
}

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

async function insertMovieNight(night) {
  if (supabase) {
    const { data, error } = await supabase.from('movie_nights').insert([night]).select();
    if (error) {
      console.error('[sc(r)occhiaTu] insertMovieNight fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
    if (data && data[0]) { movieNights.unshift(data[0]); saveLocal(); }
    return;
  }
  movieNights.unshift({ id: Date.now().toString() + Math.random(), ...night, created_at: new Date().toISOString() });
  saveLocal();
}

async function updateMovieNight(id, patch) {
  if (supabase) {
    const { error } = await supabase.from('movie_nights').update(patch).eq('id', id);
    if (error) {
      console.error('[sc(r)occhiaTu] updateMovieNight fallita su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
    return;
  }
  const n = movieNights.find(x => x.id === id);
  if (n) Object.assign(n, patch);
  saveLocal();
}

// "Stasera": pick veloce senza data fissa. Crea una serata già 'confirmed'
// (atto unilaterale, come prima: nessuna conferma richiesta) con date=null
// così il box continua a mostrare "🎬 stasera". Legacy mirror: status tonight,
// senza proposed_by né night_confirmed (pending del box = false → un solo
// pulsante "Annulla").
async function setQuickTonight(id) {
  await insertMovieNight({
    movie_id: id, date: null, time: null, snack: null,
    proposed_by: currentUser, status: 'confirmed'
  });
  await updateMovie(id, { status: 'tonight', proposed_by: null, night_confirmed: false });
}

// Proposta di una sera precisa: l'altra persona deve confermare.
async function proposeNight(id, person, date, time, snack) {
  await insertMovieNight({
    movie_id: id, date, time: time || '21:30', snack,
    proposed_by: person, status: 'proposed'
  });
  await updateMovie(id, {
    status: 'tonight',
    scheduled_date: date,
    scheduled_time: time || '21:30',
    snack,
    proposed_by: person,
    night_confirmed: false
  });
}

async function confirmNight(id) {
  const night = activeNightForMovie(id);
  if (night && night.status === 'proposed') {
    await updateMovieNight(night.id, { status: 'confirmed', confirmed_at: new Date().toISOString() });
  }
  await updateMovie(id, { night_confirmed: true });
}

// Annulla/rifiuta: la serata attiva passa a 'cancelled', il film torna in
// watchlist e pulisce i campi serata legacy.
async function cancelNight(id) {
  const night = activeNightForMovie(id);
  if (night) {
    await updateMovieNight(night.id, { status: 'cancelled', cancelled_at: new Date().toISOString() });
  }
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
async function completeNight(id) {
  const nights = movieNights
    .filter(n => n.movie_id === id && (n.status === 'proposed' || n.status === 'confirmed'))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const night = nights[0];
  if (night) {
    await updateMovieNight(night.id, { status: 'completed', completed_at: new Date().toISOString() });
  }
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
      return {
        id: m.id,
        nightId: night.id,
        title: m.title,
        poster: m.poster,
        snack: night.snack,
        scheduled_date: night.date,
        scheduled_time: night.time,
        proposed_by: night.proposed_by,
        night_confirmed: night.status === 'confirmed'
      };
    }
  }

  // Dati legacy (creati prima di movie_nights): state/flag sul film.
  const candidates = movies.filter(m =>
    m.status === 'tonight' ||
    (m.scheduled_date && (m.night_confirmed || m.proposed_by))
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