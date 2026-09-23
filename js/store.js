// ============================================
// Livello dati — Supabase (con fallback localStorage)
// ============================================

let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_URL.startsWith('http')) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

let movies = [];
let votes = [];   // { id, movie_id, person, liked }
let vetoes = [];  // { id, person, movie_id, week_key }

function normalizeTitle(t) {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Ritorna il film esistente con titolo uguale (case-insensitive), o null
function findDuplicate(title) {
  const norm = normalizeTitle(title);
  return movies.find(m => normalizeTitle(m.title) === norm) || null;
}

async function loadMovies() {
  if (supabase) {
    const [moviesRes, votesRes, vetoesRes] = await Promise.all([
      supabase.from('movies').select('*').order('created_at', { ascending: false }),
      supabase.from('votes').select('*'),
      supabase.from('vetoes').select('*')
    ]);
    if (!moviesRes.error && moviesRes.data) movies = moviesRes.data;
    if (!votesRes.error && votesRes.data) votes = votesRes.data;
    if (!vetoesRes.error && vetoesRes.data) vetoes = vetoesRes.data;
  } else {
    movies = JSON.parse(localStorage.getItem('scorochiatu_movies') || '[]');
    votes = JSON.parse(localStorage.getItem('scorochiatu_votes') || '[]');
    vetoes = JSON.parse(localStorage.getItem('scorochiatu_vetoes') || '[]');
  }
  render();
}

function saveLocal() {
  if (supabase) return;
  localStorage.setItem('scorochiatu_movies', JSON.stringify(movies));
  localStorage.setItem('scorochiatu_votes', JSON.stringify(votes));
  localStorage.setItem('scorochiatu_vetoes', JSON.stringify(vetoes));
}

async function insertMovie(newMovie) {
  if (supabase) {
    await supabase.from('movies').insert([newMovie]);
  } else {
    movies.push({ id: Date.now().toString() + Math.random(), ...newMovie });
    saveLocal();
  }
}

async function updateMovie(id, patch) {
  if (supabase) {
    await supabase.from('movies').update(patch).eq('id', id);
  } else {
    const m = movies.find(x => x.id === id);
    if (m) Object.assign(m, patch);
    saveLocal();
  }
}

async function deleteMovie(id) {
  if (supabase) {
    await supabase.from('movies').delete().eq('id', id);
  } else {
    movies = movies.filter(x => x.id !== id);
    votes = votes.filter(v => v.movie_id !== id);
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
    await supabase.from('votes').upsert([{ movie_id: movieId, person, liked }], { onConflict: 'movie_id,person' });
    const { data } = await supabase.from('votes').select('*');
    if (data) votes = data;
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
    await supabase.from('vetoes').insert([{ person, movie_id: movieId, week_key: wk }]);
    const { data } = await supabase.from('vetoes').select('*');
    if (data) vetoes = data;
  } else {
    vetoes.push({ id: Date.now().toString() + Math.random(), person, movie_id: movieId, week_key: wk });
    saveLocal();
  }
  return true;
}

// ---- Serata / "Prossimo Film" ----
// "Stasera": imposta il film come pick corrente (senza data pianificata).
async function setQuickTonight(id) {
  await updateMovie(id, { status: 'tonight' });
}

// Proposta di una sera precisa: l'altra persona deve confermare.
async function proposeNight(id, person, date, time, snack) {
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
  await updateMovie(id, { night_confirmed: true });
}

// Annulla/rifiuta la serata: torna in watchlist e pulisce i campi serata.
async function cancelNight(id) {
  await updateMovie(id, {
    status: 'watchlist',
    scheduled_date: null,
    scheduled_time: null,
    snack: null,
    proposed_by: null,
    night_confirmed: false
  });
}

// Il film corrente per il box "Prossimo Film": il pick con la serata
// pianificata più vicina (o, se non c'è data, lo stato 'stasera').
function nextMoviePick() {
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
