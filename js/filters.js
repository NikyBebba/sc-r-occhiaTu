// ============================================
// FILTERS — logica pura di ricerca, filtri e sort della pagina
// principale (step 5a). DOM-free: testata da scripts/smoke.js con
// oggetti canned. Lo STATO dei filtri vive QUI in variabili globali
// (come durationFilter/genreFilter in wheel.js) e NON viene
// toccato da render(): così sopravvive ai resync realtime.
//
// Regole:
// - ricerca: titolo + generi reali (movies.genres) + regista (movies.director),
//   case/accent-insensitive, token AND; l'eventuale titolo originale NON è in
//   movies (non ricercato).
// - sort: null-last sempre (indipendente dalla direzione); 'year' usa
//   movies.release_year (step 5b): 0/assente/corrotto trattato come null.
// - opzioni dropdown: derivate dai dati (added_by, genres, platform) con
//   conteggio, ordinate per conteggio poi nome.
// ============================================

// Durata stringa → minuti interi (null se non ricavabile).
// Supporta '126 min' (TMDb/OMDb), 'N/A' assente, numeri nudi.
// Condivisa con wheel.js (sort pagina + bucket durata ruota).
function parseDurationMinutes(d) {
  if (d === null || d === undefined || d === '') return null;
  const n = parseInt(String(d), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---- Stato dei filtri della pagina (default: ordine dati = più recenti) ----
let listQuery = '';       // testo ricerca (title + genres)
let listProposer = '';    // '' = tutti, altrimenti 'N' | 'V' (movies.added_by)
let listGenre = '';       // '' = tutti, altrimenti un genere reale da movies.genres
let listPlatform = '';    // '' = tutti, altrimenti movies.platform
let listAvailability = 'streaming'; // due viste distinte: 'streaming' | 'cinema'
let listSortKey = 'added'; // title | year | duration | rating | imdb | added | proposer
let listSortDir = 'desc';  // asc | desc

function listFilterState() {
  return { query: listQuery, proposer: listProposer, genre: listGenre, platform: listPlatform, availability: listAvailability };
}

function resetListFilters() {
  listQuery = '';
  listProposer = '';
  listGenre = '';
  listPlatform = '';
  listSortKey = 'added';
  listSortDir = 'desc';
}

function hasActiveListFilters(state) {
  return Boolean((state && state.query && String(state.query).trim()) || (state && state.proposer) || (state && state.genre) || (state && state.platform));
}

// ---- Normalizzazione ricerca (maiuscole, accenti, spazi) ----
// '  Pïù SFUMÀTO ' → 'piu sfumato' (NFD + rimozione segni diacritici).
function normalizeSearch(s) {
  return String(s == null ? '' : s)
    .trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Testo ricercabile di un film: titolo + generi reali + regista.
function movieSearchText(m) {
  return [m && m.title, (m.genres || []).join(' '), m && m.director].filter(Boolean).join(' ');
}

// Predicato singolo: applica disponibilità manuale, ricerca, proposer, genere e piattaforma.
function matchFilters(m, { query, proposer, genre, platform, availability } = {}) {
  if (availability === 'streaming' && m.cinema_watchlist) return false;
  if (availability === 'cinema' && !m.cinema_watchlist) return false;
  if (proposer && m.added_by !== proposer) return false;
  if (genre && !(Array.isArray(m.genres) && m.genres.includes(genre))) return false;
  if (platform && m.platform !== platform) return false;
  const q = normalizeSearch(query);
  if (q) {
    const tokens = q.split(/\s+/);
    const hay = normalizeSearch(movieSearchText(m));
    if (!tokens.every(t => hay.includes(t))) return false;
  }
  return true;
}

// Filtra la lista per status + filtri attivi. status null/undefined = tutti.
function filterMovies(list, { status, query, proposer, genre, platform, availability } = {}) {
  return list.filter(m => {
    if (status && m.status !== status) return false;
    return matchFilters(m, { query, proposer, genre, platform, availability });
  });
}

// Contatori per pill di stato, calcolati coi filtri attivi (coerenti con la
// vista: lo stesso predicato di filterMovies senza il vincolo di status).
function statusCounts(list, filters) {
  const counts = { all: 0, watchlist: 0, tonight: 0, watched: 0 };
  list.forEach(m => {
    if (!matchFilters(m, filters)) return;
    counts.all++;
    if (m.status === 'watchlist') counts.watchlist++;
    else if (m.status === 'tonight') counts.tonight++;
    else if (m.status === 'watched') counts.watched++;
  });
  return counts;
}

// ---- Sort (null-last sempre, direzione-indipendente) ----

function sortKeyValue(m, key) {
  switch (key) {
    case 'title': return (m.title || '').toLowerCase();
    case 'duration': return parseDurationMinutes(m.duration);
    case 'rating': {
      const scores = ['N', 'V'].map(person => personalRating(m, person)).filter(value => value !== null);
      if (scores.length) return scores.reduce((sum, value) => sum + value, 0) / scores.length;
      return null;
    }
    case 'imdb': {
      const n = parseFloat(String(m.imdb_rating || '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'added': return m.created_at || null; // ISO → confronto stringhe cronologico
    case 'proposer': return m.added_by || null;
    case 'year': {
      const n = Number(m && m.release_year);
      return Number.isFinite(n) && n > 0 ? n : null; // 0/assente/corrotto → null
    }
    default: return null;
  }
}

function sortMovies(list, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const va = sortKeyValue(a, key);
    const vb = sortKeyValue(b, key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;  // null in fondo, in entrambe le direzioni
    if (vb == null) return -1;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return 0;
  });
}

// ---- Opzioni dinamiche dropdown (conteggio, poi nome) ----

function deriveFilterOptions(list) {
  const propCounts = {};
  const genreCounts = {};
  const platCounts = {};
  list.forEach(m => {
    if (m.added_by) propCounts[m.added_by] = (propCounts[m.added_by] || 0) + 1;
    (m.genres || []).forEach(g => { if (g) genreCounts[g] = (genreCounts[g] || 0) + 1; });
    if (m.platform) platCounts[m.platform] = (platCounts[m.platform] || 0) + 1;
  });
  const byCount = o => Object.entries(o)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
  return { proposers: byCount(propCounts), genres: byCount(genreCounts), platforms: byCount(platCounts) };
}

// ---- Wrapper "pronti per la vista" (stato globale) ----

function filterMoviesByState(list, statusFilter) {
  if (statusFilter === 'tonight') {
    const scheduledIds = new Set(activeNights().map(n => n.movie_id));
    return filterMovies(list, listFilterState()).filter(m => scheduledIds.has(m.id));
  }
  const filtered = filterMovies(list, listFilterState());
  if (statusFilter === 'watchlist') return filtered.filter(m => normalListEligible(m));
  if (statusFilter === 'history_n') return filtered.filter(m => m.seen_n === true);
  if (statusFilter === 'history_v') return filtered.filter(m => m.seen_v === true);
  if (statusFilter === 'rewatch') return filtered.filter(m => isRewatch(m));
  if (statusFilter === 'watched') return filtered.filter(m => togetherSeen(m));
  return filtered;
}

function statusCountsFor(list) {
  const counts = statusCounts(list, listFilterState());
  counts.watchlist = filterMoviesByState(list, 'watchlist').length;
  counts.watched = filterMoviesByState(list, 'watched').length;
  counts.history_n = filterMoviesByState(list, 'history_n').length;
  counts.history_v = filterMoviesByState(list, 'history_v').length;
  counts.rewatch = filterMoviesByState(list, 'rewatch').length;
  counts.tonight = filterMoviesByState(list, 'tonight').length;
  return counts;
}
