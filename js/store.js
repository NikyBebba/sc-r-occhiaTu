// Stato condiviso, client Supabase, mirror locale e Realtime core.
// I domini in js/store/ mantengono le API globali esistenti.

let sb = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_URL.startsWith('http') &&
    window.supabase && window.supabase.createClient) {
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

let movies = [];
let votes = [];   // { id, movie_id, person, liked }
let vetoes = [];  // { id, person, movie_id, week_key }
let movieNights = []; // { id, movie_id, date, time, snack, location, proposed_by, status, ... }

// Modalità di persistenza corrente. 'supabase' = DB raggiungibile e usato.
// 'local' = database degradato/non raggiungibile: usiamo il mirror in
// localStorage. Il fallback NON è silenzioso: viene loggato e segnalato in
// UI (badge). Si ritenta di tornare a Supabase a ogni azione/load.
let dbMode = sb ? 'supabase' : 'local';

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
  if (!sb) return null;
  if (dbMode === 'local' && Date.now() - lastSupabaseFailAt < SUPABASE_RETRY_MS) return null;
  const [moviesRes, votesRes, vetoesRes, nightsRes] = await Promise.all([
    sb.from('movies').select('*').order('created_at', { ascending: false }),
    sb.from('votes').select('*'),
    sb.from('vetoes').select('*'),
    sb.from('movie_nights').select('*').order('created_at', { ascending: false })
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
  if (realtimeChannel || !sb) return;
  const channel = sb
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
  if (realtimeChannel && sb) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
