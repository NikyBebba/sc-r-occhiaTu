// Stato condiviso, client Supabase, mirror locale e Realtime core.
// I domini in js/store/ mantengono le API globali esistenti.

let sb = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_URL.startsWith('http') &&
    window.supabase && window.supabase.createClient) {
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { storage: authStorage, storageKey: AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: detectAuthCallback }
  });
  attachAuthListener();
}

// Colonne contenuto/visione: il client non richiede i mirror di programmazione.
// Mantenerle allineate allo schema e ai campi realmente usati dai domini.
const MOVIE_SELECT_FIELDS = [
  'id', 'title', 'added_by', 'status', 'duration', 'platform', 'poster', 'trailer_url',
  'matched', 'imdb_rating', 'rt_rating', 'metacritic_rating', 'seen_n', 'seen_v', 'in_shared_list', 'genre', 'surprise_by', 'tmdb_id', 'collection_id',
  'collection_name', 'cinema_watchlist', 'seen_rating_n', 'seen_rating_v',
  'seen_rating_together', 'review_text_n', 'review_text_v', 'review_text_together',
  'genres', 'release_year', 'director', 'overview', 'cast_names', 'created_at'
].join(',');

let movies = [];
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


function saveLocal() {
  requireAppIdentity();
  localStorage.setItem('scorochiatu_mirror_owner', authIdentity?.uid || '');
  localStorage.setItem('scorochiatu_movies', JSON.stringify(movies));
  localStorage.setItem('scorochiatu_vetoes', JSON.stringify(vetoes));
  localStorage.setItem('scorochiatu_movie_nights', JSON.stringify(movieNights));
}

function loadLocal() {
  requireAppIdentity();
  movies = JSON.parse(localStorage.getItem('scorochiatu_movies') || '[]');
  vetoes = JSON.parse(localStorage.getItem('scorochiatu_vetoes') || '[]');
  movieNights = JSON.parse(localStorage.getItem('scorochiatu_movie_nights') || '[]');
  if (!Array.isArray(movieNights)) movieNights = [];
}

// Legge tutto da Supabase. Se fallisce (o se siamo in modalità locale e nel
// periodo di "respiro") ritorna null: chi chiama usa loadLocal().
async function fetchAll() {
  requireAppIdentity();
  const epoch = authEpoch;
  if (!sb) return null;
  if (dbMode === 'local' && Date.now() - lastSupabaseFailAt < SUPABASE_RETRY_MS) return null;
  let results;
  try {
    await validateCurrentAuth();
    results = await Promise.all([
      sb.from('movies').select(MOVIE_SELECT_FIELDS).order('created_at', { ascending: false }),
      sb.from('vetoes').select('*'),
      sb.from('movie_nights').select('*').order('created_at', { ascending: false })
    ]);
    assertAuthEpoch(epoch);
  } catch (error) {
    assertAuthEpoch(epoch);
    handleDataAuthError(error);
    dbMode = 'local';
    lastSupabaseFailAt = Date.now();
    console.error('[sc(r)occhiaTu] Lettura Supabase non riuscita — conservo il mirror locale di film e serate.');
    return null;
  }
  const [moviesRes, vetoesRes, nightsRes] = results;
  for (const result of results) handleDataAuthError(result.error);
  const coreFailed = moviesRes.error || vetoesRes.error || nightsRes.error;
  if (coreFailed) {
    dbMode = 'local';
    lastSupabaseFailAt = Date.now();
    console.error('[sc(r)occhiaTu] Errore lettura Supabase — attivo modalità locale (fallback).',
      { movies: moviesRes.error, vetoes: vetoesRes.error, nights: nightsRes.error });
    return null;
  }
  dbMode = 'supabase';
  return {
    movies: moviesRes.data || [],
    vetoes: vetoesRes.data || [],
    nights: nightsRes.data || []
  };
}

function dataSignature() {
  // I vecchi like/dislike non sono rappresentati da alcuna vista corrente.
  return JSON.stringify([movies, vetoes, movieNights]);
}

async function loadMovies() {
  requireAppIdentity();
  const epoch = authEpoch;
  const remote = await fetchAll();
  assertAuthEpoch(epoch);
  if (remote) {
    movies = remote.movies;
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
  requireAppIdentity();
  const epoch = authEpoch;
  const prev = dataSignature();
  const remote = await fetchAll();
  assertAuthEpoch(epoch);
  if (remote) {
    movies = remote.movies;
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
    try { await resyncQuiet(); } catch (_) { /* Auth chiude la UI; niente fallback anonimo */ }
  }, 120);
}

// ---- Realtime: un solo canale per sessione ----
function subscribeRealtime() {
  if (realtimeChannel || !sb || !isAppAuthorized()) return;
  const channel = sb
    .channel('scorochiatu-db-changes', { config: { private: true } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'movies' }, onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vetoes' }, onDbChange);
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'movie_nights' }, onDbChange);
  realtimeChannel = channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') {
      // Anche dopo reconnect: recupera gli eventi persi, resync idempotente.
      if (isAppAuthorized()) onDbChange();
      return;
    }
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
