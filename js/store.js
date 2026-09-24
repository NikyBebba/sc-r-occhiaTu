// ============================================
// Livello dati — Supabase (con fallback localStorage e Realtime)
// ============================================

let sb = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_URL.startsWith('http') &&
    window.supabase && window.supabase.createClient) {
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

let movies = [];
let votes = [];   // { id, movie_id, person, liked }
let vetoes = [];  // { id, person, movie_id, week_key }
let movieNights = []; // { id, movie_id, date, time, snack, proposed_by, status, ... }

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

async function insertMovie(newMovie) {
  const finalMovie = { ...newMovie };
  if (sb) {
    const { data, error } = await sb.from('movies').insert([newMovie]).select();
    if (error) {
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
    }
  } else {
    const m = movies.find(x => x.id === id);
    if (m) Object.assign(m, patch);
    saveLocal();
  }
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
  // Toggle: riclickare lo STESSO voto lo rimuove (delete della riga in votes).
  // La decisione legge lo stato in memoria (votes, già sincronizzato da
  // loadMovies/resync), non una query dedicata.
  const existing = votes.find(v => v.movie_id === movieId && v.person === person);
  const removing = existing && existing.liked === liked;

  if (sb) {
    if (removing) {
      const { error } = await sb.from('votes').delete().eq('movie_id', movieId).eq('person', person);
      if (error) {
        console.error('[sc(r)occhiaTu] rimozione voto fallita su Supabase:', error.message);
        dbMode = 'local';
        lastSupabaseFailAt = Date.now();
      }
    } else {
      const { error } = await sb.from('votes').upsert([{ movie_id: movieId, person, liked }], { onConflict: 'movie_id,person' });
      if (error) {
        console.error('[sc(r)occhiaTu] castVote fallito su Supabase:', error.message);
        dbMode = 'local';
        lastSupabaseFailAt = Date.now();
      }
    }
    const { data } = await sb.from('votes').select('*');
    if (data) { votes = data; saveLocal(); }
  } else {
    if (removing) {
      votes = votes.filter(v => !(v.movie_id === movieId && v.person === person));
    } else if (existing) {
      existing.liked = liked;
    } else {
      votes.push({ id: Date.now().toString() + Math.random(), movie_id: movieId, person, liked });
    }
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
  if (sb) {
    const { error } = await sb.from('vetoes').insert([{ person, movie_id: movieId, week_key: wk }]);
    if (error) {
      console.error('[sc(r)occhiaTu] addVeto fallito su Supabase:', error.message);
      dbMode = 'local';
      lastSupabaseFailAt = Date.now();
    }
    const { data } = await sb.from('vetoes').select('*');
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
  if (sb) {
    const { data, error } = await sb.from('movie_nights').insert([night]).select();
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
  if (sb) {
    const { error } = await sb.from('movie_nights').update(patch).eq('id', id);
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

// ============================================
// MATCH LIVE (step 6) — sessione di swipe condivisa N/V
//
// Canale PERSISTENTE e dedicato ('scorochiatu-match'), SEPARATO dal canale
// del core (movies/votes/vetoes/movie_nights). Motivo: un guasto del Match
// (tabella non pubblicata su Realtime, presence, CHANNEL_ERROR) non deve mai
// trasformarsi in CHANNEL_ERROR del canale core. La sonda cold-start verifica
// l'esistenza delle tabelle PRIMA di creare il canale; bindings match+presence
// stanno SOLO su questo canale.
//
// Il topic è una COSTANTE identica per tutti i client: presence e
// postgres_changes sono per-topic, quindi due client su topic diversi
// ('scorochiatu-match-<seq>-localesufix' dell'implementazione precedente) non
// si vedrebbero MAI. Il canale si crea UNA sola volta alla prima entrata, con
// tutti i binding registrati PRIMA di .subscribe(). Uscire dal tab NON lo
// rimuove (resta SUBSCRIBED): si fa solo untrack() della propria presence e al
// rientro un nuovo track() + refetch. Una ricreazione avviene SOLO
// dopo rimozione VERIFICATA (sb.getChannels() senza più il topic): mai due
// canali sullo stesso topic in parallelo.
//
// Lo swipe NON scrive su votes/vetoes: vive solo sulla sessione.
// Il resync segue SEMPRE l'ultima sessione per created_at, mai un id fisso.
// ============================================

let matchAvailable = false;          // abilitato solo se le tabelle esistono (sonda)
let swipeSessions = [];              // sessioni di swipe (ultima sessione letta)
let swipes = [];                     // swipe della sessione corrente
let matchChannel = null;             // canale PERSISTENTE 'scorochiatu-match' (separato dal core)
let matchResyncTimer = null;
let lobbyPresenceState = [];         // persone presenti nella lobby (una key per persona)
const MATCH_TOPIC = 'scorochiatu-match'; // topic COSTANTE, identico tra N e V (mai suffisso locale)
let matchProbeDone = false;          // sonda cold-start: una volta per sessione app
let matchLeaving = false;            // chiusura intenzionale (leave/logout)
let matchUnavailableWarnedAt = 0;    // warning "Match non disponibile" una tantum (60s)
let matchProbeTimeoutMs = 3000;      // cap della sonda cold-start
let matchChannelStatus = null;       // 'connecting' | 'subscribed' | 'error' | null
let matchEnterErrorMsg = null;       // ultimo errore reale dell'ingresso → vista "Match non disponibile"
let matchEnterErrorLogged = false;   // deduplica il console.error (UNA volta per entrata)

function saveMatchLocal() {
  localStorage.setItem('scorochiatu_swipe_sessions', JSON.stringify(swipeSessions));
  localStorage.setItem('scorochiatu_swipes', JSON.stringify(swipes));
}

function loadMatchLocal() {
  swipeSessions = JSON.parse(localStorage.getItem('scorochiatu_swipe_sessions') || '[]');
  swipes = JSON.parse(localStorage.getItem('scorochiatu_swipes') || '[]');
  if (!Array.isArray(swipeSessions)) swipeSessions = [];
  if (!Array.isArray(swipes)) swipes = [];
}

function applyMatchState(state) {
  swipeSessions = state && state.session ? [state.session] : [];
  swipes = filterSwipes(state ? state.swipes : []);
  saveMatchLocal();
}

function warnMatch(msg) {
  if (Date.now() - matchUnavailableWarnedAt > 60000) {
    console.warn('[sc(r)occhiaTu] Match: ' + msg);
    matchUnavailableWarnedAt = Date.now();
  }
}

// Ingresso Match finito male: MAI silenzioso. Espone l'errore reale — una
// console.error per ENTRATA, la vista "Match non disponibile" con il
// messaggio tecnico in piccolo. Va chiamato dal catch interno di enterMatch
// e dai catch esterni dei chiamanti (setTab/tryMatchAgain) come rete.
function reportMatchEnterError(e) {
  const msg = e && e.message ? String(e.message) : String(e);
  matchAvailable = false;
  matchEnterErrorMsg = msg;
  if (!matchEnterErrorLogged) {
    matchEnterErrorLogged = true;
    console.error('[sc(r)occhiaTu] Match non disponibile — enterMatch: ' + msg, e);
  }
  renderMatchArea();
}

// Sonda cold-start (alla prima entrata nel Match): verifica che swipe_sessions
// e swipes esistano (select id limit 1) con un cap di matchProbeTimeoutMs.
// Fallita → matchAvailable = false e nessun canale. Il canale del core non
// viene MAI toccato (la sonda riguarda solo il canale Match).
function probeMatchTables() {
  if (!sb) return Promise.resolve(false);
  const attempt = (async () => {
    try {
      const [a, b] = await Promise.all([
        sb.from('swipe_sessions').select('id').limit(1),
        sb.from('swipes').select('id').limit(1)
      ]);
      return !(a && a.error) && !(b && b.error);
    } catch (e) {
      return false;
    }
  })();
  return Promise.race([
    attempt,
    new Promise(resolve => setTimeout(() => resolve(false), matchProbeTimeoutMs))
  ]);
}

// Legge l'ULTIMA sessione per created_at (qualunque stato) + i suoi swipe.
// Il resync segue sempre l'ultima sessione, non un id fisso: se il partner ha
// chiuso e iniziato un giro nuovo, il nostro stato si aggancia al nuovo.
async function fetchLatestMatchState() {
  if (!sb || dbMode === 'local') return null;
  try {
    const sessionRes = await sb.from('swipe_sessions')
      .select('*').order('created_at', { ascending: false }).limit(1);
    if (sessionRes.error) { warnMatch('fetch session: ' + sessionRes.error.message); return null; }
    const session = (sessionRes.data && sessionRes.data[0]) || null;
    let sessionSwipes = [];
    if (session) {
      const swipesRes = await sb.from('swipes').select('*').eq('session_id', session.id);
      if (swipesRes.error) { warnMatch('fetch swipes: ' + swipesRes.error.message); return null; }
      sessionSwipes = swipesRes.data || [];
    }
    return { session, swipes: sessionSwipes };
  } catch (e) {
    warnMatch('fetchLatestMatchState: ' + e.message);
    return null;
  }
}

// All'ingresso nel Match: riprende l'attiva non scaduta, chiude+ricrea se
// scaduta, altrimenti (incluso ultima sessione done/closed) ne crea una nuova.
async function ensureActiveSession() {
  const state = await fetchLatestMatchState();
  if (!state) return null;
  applyMatchState(state);
  const active = activeSession(swipeSessions);
  if (active) {
    if (isExpired(active, swipes, Date.now())) {
      await closeSession(active.id);
      return await startNewSession();
    }
    return active;
  }
  return await startNewSession();
}

// Crea una sessione 'open' con deck congelato (veto + serate attive escluse).
// Su corsa 23505 (indice unico parziale: un'altra attiva è appena nata) si
// aggancia alla sessione attiva esistente, senza errori in UI.
async function startNewSession() {
  if (!sb || dbMode === 'local' || !matchAvailable) return null;
  const deckInfo = buildDeck(movies, {
    vetoedIds: vetoedMovieIdsThisWeek(),
    excludeIds: activeNights().map(n => n.movie_id)
  });
  const { data, error } = await sb.from('swipe_sessions')
    .insert([{ status: 'open', created_by: currentUser, seed: deckInfo.seed, deck: deckInfo.deck }])
    .select();
  if (error) {
    if (error.code === '23505') {
      const state = await fetchLatestMatchState();
      if (state && state.session && activeSession([state.session])) {
        applyMatchState(state);
        return state.session;
      }
    } else {
      warnMatch('startNewSession: ' + error.message);
    }
    return null;
  }
  const session = data && data[0];
  if (session) applyMatchState({ session, swipes: [] });
  return session;
}

// Chiude SOLO quella sessione e SOLO se attiva (open|matched): un update in
// ritardo non deve mai toccare sessioni già done/closed.
async function closeSession(id) {
  if (!sb || dbMode === 'local') return null;
  const { data, error } = await sb.from('swipe_sessions')
    .update({ status: 'closed' })
    .eq('id', id)
    .in('status', ['open', 'matched'])
    .select();
  if (error) { warnMatch('closeSession: ' + error.message); return null; }
  const row = data && data[0];
  if (row) {
    const local = swipeSessions.find(s => s.id === id);
    if (local) Object.assign(local, row);
    saveMatchLocal();
  }
  return row || null;
}

// Update condizionato allo stato: nessuna transizione se lo status corrente
// non è in allowedStatuses (un reconcile tardivo non riapre/modifica sessioni
// già chiuse o celebrate altrove).
async function updateSessionConditional(id, patch, allowedStatuses) {
  if (!sb || dbMode === 'local') return null;
  const { data, error } = await sb.from('swipe_sessions')
    .update(patch).eq('id', id).in('status', allowedStatuses).select();
  if (error) { warnMatch('update session: ' + error.message); return null; }
  const row = data && data[0];
  if (row) {
    const local = swipeSessions.find(s => s.id === id);
    if (local) Object.assign(local, row);
    saveMatchLocal();
  }
  return row || null;
}

// Upsert idempotente (ignoreDuplicates → ON CONFLICT DO NOTHING), poi refresh
// locale e reconcile sull'ULTIMA sessione. Lo swipe non tocca votes/vetoes.
async function recordSwipe(session, movieId, person, liked) {
  if (!session || !sb || dbMode === 'local') return;
  const { error } = await sb.from('swipes').upsert(
    [{ session_id: session.id, movie_id: movieId, person, liked: !!liked }],
    { onConflict: 'session_id,movie_id,person', ignoreDuplicates: true }
  );
  if (error) { warnMatch('recordSwipe: ' + error.message); return; }
  const state = await fetchLatestMatchState();
  if (!state) return;
  applyMatchState(state);
  await reconcileSession(state.session, state.swipes);
}

// CONTRACT (Match — riconoscimento dai dati):
// - Celebrazione = pendingMatch(session, swipes, deck, movies) != null (solo dati). status 'matched' non è prerequisito.
// - matched_movie_id = ultimo match RICONOSCIUTO via "Continua". Non viene scritto al momento del doppio like, solo al riconoscimento.
// - Il percorso swipe/reconcile/resync NON scrive più status 'matched'. Lo status 'matched' resta ammesso dallo schema ma inutilizzato (nessuna migration).
// - reconcileSession si occupa SOLO di 'done' (open→done se mazzo esaurito e nessun match pendente). Chiamato da recordSwipe e da resync (sullo stato fetchato, non sugli swipe locali). Idempotente, condizionato a id + status 'open'.

// Transizione SOLO per 'done' (open→done: mazzo esaurito e nessun match
// pendente). Il match NON scrive più status 'matched' né matched_movie_id:
// la celebrazione è derivata dai dati (pendingMatch ≠ null) e
// matched_movie_id si aggiorna SOLO al riconoscimento ("Continua"), così un
// reconcile in ritardo non fa gara col riconoscimento. Idempotente,
// condizionato a id + status 'open'. Chiamata da recordSwipe E dal resync
// (sullo stato fetchato, non sugli swipe locali).
async function reconcileSession(session, sessionSwipes) {
  if (!session || !matchAvailable || !sb || dbMode === 'local') return;
  const deck = Array.isArray(session.deck) ? session.deck : [];
  const pending = pendingMatch(session, sessionSwipes, deck, movies);
  if (pending !== null) return; // match da riconoscere: resta 'open', niente da scrivere
  if (currentIndex(deck, sessionSwipes, movies) >= deck.length) {
    await updateSessionConditional(session.id, { status: 'done' }, ['open']);
  }
}

// Errori del riconoscimento ("Continua"): console.error DEDUPLICATO (60s,
// stesso pattern di warnMatch), oltre al warning in badge.
let matchContinueErrLoggedAt = 0;
function reportContinueMatchError(msg) {
  warnMatch(msg);
  if (Date.now() - matchContinueErrLoggedAt > 60000) {
    matchContinueErrLoggedAt = Date.now();
    console.error('[sc(r)occhiaTu] Continua: ' + msg);
  }
}

// "Continua" = RICONOSCIMENTO del match corrente: scrive matched_movie_id
// (= il match pendente, ultimo riconosciuto) + matched_at informativo e avanza
// a 'open' (o 'done' se il mazzo è esaurito). Condizionato a id + status
// IN ('open','matched'): idempotente se entrambi premono insieme (il 2° click,
// ormai con matched_movie_id allineato, NON clobbera: il patch aggiorna
// matched_movie_id solo se esiste ancora un match pendente) e una sessione
// spenta (done/closed) non viene riaperta. Rilettura SEMPRE dopo (anche con
// update a vuoto o in errore): mai UI muta/stallata — se l'update tocca 0
// righe o fallisce, console.error (una volta) e riallineamento.
async function continueMatch(session) {
  if (!session || !matchAvailable || !sb || dbMode === 'local') return;
  const deck = Array.isArray(session.deck) ? session.deck : [];
  const pending = pendingMatch(session, swipes, deck, movies);
  const done = currentIndex(deck, swipes, movies) >= deck.length;
  const patch = { status: done ? 'done' : 'open' };
  if (pending !== null) {
    patch.matched_movie_id = pending;
    patch.matched_at = new Date().toISOString();
  }
  const updated = await updateSessionConditional(session.id, patch, ['open', 'matched']);
  if (!updated) reportContinueMatchError('update senza effetto (0 righe o errore) — ho riallineato lo stato.');
  const state = await fetchLatestMatchState();
  if (state) applyMatchState(state);
}

// Firma deterministica dello stato Match (sessione + swipe normalizzati):
// usata dalla resync per fare render SOLO se il dato è cambiato.
function matchSignature(session, sessionSwipes) {
  const s = session || null;
  const list = (sessionSwipes || [])
    .map(w => [w.movie_id, w.person, w.liked === true])
    .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  return JSON.stringify([
    s === null ? null : [
      s.id, s.status, s.matched_movie_id || null, s.matched_at || null,
      s.created_at || null, s.seed == null ? null : s.seed,
      Array.isArray(s.deck) ? s.deck : []
    ],
    list
  ]);
}

function renderMatchArea() {
  if (typeof renderMatch === 'function' && currentTab === 'match') renderMatch();
}

async function resyncMatchQuiet() {
  const prev = matchSignature(swipeSessions[0], swipes);
  const state = await fetchLatestMatchState();
  if (!state) return;
  applyMatchState(state);
  await reconcileSession(state.session, state.swipes);
  if (matchSignature(swipeSessions[0], swipes) !== prev) renderMatchArea();
}

// Debounce proprio (120ms) per il Match: MAI onDbChange/dataSignature/render()
// globale — il canale Match è isolato dal core. Fuori dal tab non si leggono
// dati (il rientro fa un refetch fresco in openMatchChannel).
function onMatchChange() {
  if (matchResyncTimer) return;
  matchResyncTimer = setTimeout(async () => {
    matchResyncTimer = null;
    if (currentTab !== 'match') return;
    try {
      await resyncMatchQuiet();
    } catch (e) {
      warnMatch('resync: ' + e.message);
    }
  }, 120);
}

// ---- Presence (canale Match): una key per persona ----
// key di config = etichetta persona (N/V), condivisa tra i tab dello stesso
// utente: le chiavi uniche di presenceState() SONO le persone presenti.
function presenceUsers(state) {
  return Object.keys(state || {}).filter(k => k && k !== '');
}

// Legge la presence del topic AGORA' — shape di presenceState() == { N:[...], V:[...] },
// con presenceUsers() sulle chiavi. Agganciata agli eventi (sync/join/leave)
// MA anche al refresh esplicito dopo SUBSCRIBED + track: mai affidarla solo
// all'evento (su supabase-js 2.x un binding 'presence' con filtro {} non è
// garantito che fuochi) e mai svuotarla dopo un sync.
function refreshLobbyPresence() {
  if (!matchChannel) return;
  try {
    const st = typeof matchChannel.presenceState === 'function'
      ? matchChannel.presenceState()
      : {};
    lobbyPresenceState = presenceUsers(st);
  } catch (e) {
    warnMatch('presence: ' + e.message);
  }
}

// Canale PERSISTENTE: gli eventi presence arrivano anche da tab non attivo.
// Aggiornano SEMPRE lobbyPresenceState, ma il render avviene solo nel Match.
function onPresenceChange() {
  refreshLobbyPresence();
  if (currentTab === 'match') renderMatchArea();
}

function trackLobbyPresence(user) {
  if (!matchChannel || !user) return Promise.resolve();
  return Promise.resolve(matchChannel.track({ user })).catch(() => {});
}

function untrackLobbyPresence() {
  if (matchChannel) Promise.resolve(matchChannel.untrack()).catch(() => {});
  lobbyPresenceState = [];
}

// Rimozione del canale con VERIFICA: prima si stacca matchChannel (mai più
// callback su un'istanza morta), poi removeChannel; il controllo su
// sb.getChannels() spetta alla ricreazione in openMatchChannel (niente topic
// doppi). Se il Match non era disponibile, azzera la sonda per la prossima.
function removeMatchChannel(channel) {
  if (matchChannel === channel) matchChannel = null;
  if (sb && channel) {
    try { sb.removeChannel(channel); } catch (e) {}
  }
  matchLeaving = false;
  lobbyPresenceState = [];
  matchChannelStatus = null;
}

// Apre (o riusa) il canale PERSISTENTE sul topic COSTANTE 'scorochiatu-match'.
// TUTTI i binding (postgres_changes su swipe_sessions+swipes, presence
// sync/join/leave) sono registrati PRIMA di .subscribe(). Nessun suffisso
// locale: N e V condividono lo stesso topic → presence e postgres_changes si
// vedono. Uscita dal tab = untrack() (leaveMatch) SENZA rimuovere il canale;
// rientro = track() + refetch dello stato. La ricreazione avviene SOLO dopo
// rimozione VERIFICATA (getChannels() senza il topic) — mai istanze parallele.
function openMatchChannel() {
  if (!sb || !matchAvailable) return null;
  if (matchChannel) {
    // Già creato: L'OBIETTIVO del rientro è riallacciare presence e stato,
    // non ricreare il canale (evita il topic duplicato per definizione).
    if (matchChannelStatus === 'subscribed') {
      const ch = matchChannel;
      trackLobbyPresence(currentUser).then(() => {
        if (matchChannel === ch && matchChannelStatus === 'subscribed') refreshLobbyPresence();
      });
      refreshLobbyPresence();
      setTimeout(() => {
        if (matchChannel === ch && matchChannelStatus === 'subscribed') refreshLobbyPresence();
      }, 60);
      fetchLatestMatchState().then(state => {
        if (matchChannel === ch && matchChannelStatus === 'subscribed' && state) {
          applyMatchState(state);
          if (currentTab === 'match') renderMatchArea();
        }
      });
    }
    return matchChannel;
  }
  // Sicurezza: prima di creare, rimuove eventuali residui dello stesso topic
  // (mai due istanze sullo stesso nome in getChannels()).
  if (sb && typeof sb.getChannels === 'function') {
    const leftovers = sb.getChannels().filter(c => c && c.name === MATCH_TOPIC);
    leftovers.forEach(c => { try { sb.removeChannel(c); } catch (e) {} });
  }
  const channel = sb
    .channel(MATCH_TOPIC, { config: { presence: { key: currentUser } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'swipe_sessions' }, onMatchChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'swipes' }, onMatchChange)
    .on('presence', { event: 'sync' }, onPresenceChange)
    .on('presence', { event: 'join' }, onPresenceChange)
    .on('presence', { event: 'leave' }, onPresenceChange);
  matchLeaving = false;
  let failureHandled = false;
  matchChannelStatus = 'connecting';
  matchChannel = channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') {
      matchLeaving = false;
      matchChannelStatus = 'subscribed';
      trackLobbyPresence(currentUser).then(() => {
        if (matchChannel === channel && matchChannelStatus === 'subscribed') refreshLobbyPresence();
      });
      // Presence popolata DA SUBITO e di nuovo a track completato: non ci si
      // affida solo all'evento sync/join (filtro presence garantito).
      refreshLobbyPresence();
      setTimeout(() => {
        if (matchChannel === channel && matchChannelStatus === 'subscribed') refreshLobbyPresence();
      }, 60);
      // Refetch dello stato: non si perdono gli eventi tra la lettura
      // iniziale (ensureActiveSession) e l'aggancio al canale.
      fetchLatestMatchState().then(state => {
        if (matchChannel === channel && matchChannelStatus === 'subscribed' && state) {
          applyMatchState(state);
          if (currentTab === 'match') renderMatchArea();
        }
      });
      return;
    }
    if (status === 'CLOSED' && matchLeaving) { matchLeaving = false; return; }
    if (matchChannel !== channel || failureHandled) return;
    failureHandled = true;
    matchAvailable = false;
    matchChannelStatus = 'error';
    warnMatch('canale non disponibile (' + status + '): ' + (err ? err.message : ''));
    setTimeout(() => removeMatchChannel(channel), 0);
    renderMatchArea();
  });
  return matchChannel;
}

// Uscita dal Match. Dal TAB: il canale PERSISTENTE resta aperto e SUBSCRIBED
// (unico per topic) — si rimuove SOLO la propria presence (untrack: l'altro
// cliente vede il leave) e si azzerano vista e lobby; al rientro openMatchChannel
// rifà il track + refetch. Con full=true (logout) il canale viene anche
// RIMOSSO con verifica. Se il Match era non disponibile (sonda/canale in
// errore), la sonda viene riletta al prossimo ingresso.
function leaveMatch(full) {
  untrackLobbyPresence();
  lobbyPresenceState = [];
  if (full && matchChannel && sb) removeMatchChannel(matchChannel);
  if (!matchAvailable) matchProbeDone = false;
}

// Ingresso nel Match: sonda una volta (prima entrata), poi sessione attiva e
// canale. dbMode 'local' o sonda fallita → matchAvailable = false, niente
// canale, il core resta intatto. Qualunque errore reale (es. una funzione di
// match.js non caricata nel browser) viene CATTURATO qui: mai ReferenceError
// non gestito, sempre console.error (una volta per entrata) + vista
// "Match non disponibile" col messaggio tecnico.
async function enterMatch() {
  matchEnterErrorMsg = null;
  matchEnterErrorLogged = false;
  try {
    if (!sb || dbMode === 'local' || !currentUser) {
      matchAvailable = false;
      renderMatchArea();
      return;
    }
    if (!matchProbeDone) {
      matchProbeDone = true;
      const ok = await probeMatchTables();
      if (!ok) {
        matchAvailable = false;
        warnMatch('non disponibile: tabelle swipe non raggiungibili (sonda fallita).');
        renderMatchArea();
        return;
      }
      matchAvailable = true;
    }
    if (!matchAvailable) { renderMatchArea(); return; }
    await ensureActiveSession();
    openMatchChannel();
    renderMatchArea();
  } catch (e) {
    reportMatchEnterError(e);
  }
}