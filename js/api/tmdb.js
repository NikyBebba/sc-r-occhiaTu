// ============================================
// TMDb API — poster, durata, streaming, trailer, collection, regista+anno
// (source primaria di ricerca e dettaglio)
// ============================================

// La chiave in CONFIG è reale e usata direttamente dal frontend: la guardia
// è attiva semplicemente se c'è una chiave non vuota.
function tmdbConfigured() {
  return !!(CONFIG.TMDB_API_KEY && CONFIG.TMDB_API_KEY.trim());
}

// Ricerca candidati per la scelta multipla (usata nell'aggiunta singola).
// Ritorna fino a 5 risultati grezzi con poster piccolo e anno, senza
// fare chiamate di dettaglio: quelle si fanno solo dopo che l'utente sceglie.
async function searchTmdbCandidates(title) {
  if (!tmdbConfigured()) return [];
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${CONFIG.TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=it-IT`
    );
    const data = await res.json();
    if (!data.results) return [];
    return data.results.slice(0, 5).map(r => ({
      id: r.id,
      title: r.title,
      year: r.release_date ? r.release_date.slice(0, 4) : '—',
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : ''
    }));
  } catch (err) {
    console.error('Errore ricerca TMDb:', err);
    return [];
  }
}

// Trasforma una risposta /movie/{id} nell'oggetto dettagli dell'app, incluse
// piattaforma IT, trailer e rating OMDb (più precisi per imdb_id).
// imdb_id fa parte della risposta base di TMDb, non serve append_to_response.
async function buildTmdbDetails(detail, fallbackTitle, options = {}) {
  let platform = 'Streaming';
  const providers = detail['watch/providers']?.results?.IT?.flatrate;
  if (providers && providers.length > 0) platform = providers[0].provider_name;

  let trailerUrl = '';
  const videos = detail.videos?.results || [];
  const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer')
    || videos.find(v => v.site === 'YouTube');
  if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;

  const fetchOmdb = options.fetchOmdbByImdbId
    || (typeof fetchOmdbByImdbId === 'function' ? fetchOmdbByImdbId : null);
  const ratingsExtractor = options.extractRatings
    || (typeof extractRatings === 'function' ? extractRatings : null);
  const omdbData = detail.imdb_id && fetchOmdb ? await fetchOmdb(detail.imdb_id) : null;
  const genreNames = (detail.genres || []).map(g => g.name);

  // Step 5b — regista + anno: direttore/i dai credits (crew, job Director),
  // anno da release_date (primi 4 caratteri). Nessun dato → null, mai
  // stringhe vuote né placeholder.
  const directors = ((detail.credits && detail.credits.crew) || [])
    .filter(p => p.job === 'Director' && p.department === 'Directing')
    .map(p => p.name).filter(Boolean);
  const yMatch = String(detail.release_date || '').match(/^\d{4}/);
  const releaseYear = yMatch && parseInt(yMatch[0], 10) > 0 ? parseInt(yMatch[0], 10) : null;

  // Step 7 — overview + cast (per il detail film): trama it-IT e primi 8 nomi
  // del cast in billing order (credits già in append_to_response). overview
  // vuoto/assente → null (mai stringhe vuote); cast senza membri → null (per
  // distinguere "non ricavato" da "nessun cast", mai array vuoti).
  const overview = detail.overview && detail.overview.trim() ? detail.overview : null;
  const castNames = ((detail.credits && detail.credits.cast) || [])
    .map(p => p.name).filter(Boolean).slice(0, 8);

  return {
    tmdb_id: detail.id,
    title: detail.title || fallbackTitle,
    collection_id: detail.belongs_to_collection?.id ?? null,
    collection_name: detail.belongs_to_collection?.name || null,
    genres: genreNames,
    duration: detail.runtime ? `${detail.runtime} min` : null,
    release_year: releaseYear,
    director: directors.length ? directors.join(', ') : null,
    overview,
    cast_names: castNames.length ? castNames : null,
    platform,
    poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
    trailerUrl,
    matched: true,
    ...(ratingsExtractor ? ratingsExtractor(omdbData) : {})
  };
}

// Dettaglio completo di UN film TMDb già identificato per id
// (chiamata dopo che l'utente ha scelto dal picker).
async function fetchTmdbDetailsById(id) {
  try {
    const detailRes = await fetch(
      `https://api.themoviedb.org/3/movie/${id}?api_key=${CONFIG.TMDB_API_KEY}&append_to_response=watch/providers,videos,credits&language=it-IT`
    );
    const detail = await detailRes.json();
    return await buildTmdbDetails(detail);
  } catch (err) {
    console.error('Errore dettaglio TMDb:', err);
    return {
      tmdb_id: id, title: 'Errore', genres: [], duration: null, platform: 'Streaming',
      poster: '', trailerUrl: '', matched: false,
      collection_id: null, collection_name: null, ...emptyRatings
    };
  }
}

// Cerca il film per titolo e ne restituisce il dettaglio -> null se TMDb non
// trova nulla. È il primo passo dell'import bulk/import script: NON far
// scegliere l'utente, prendere il primo risultato è una scelta deliberata
// (i casi dubbi restano matched:false e correggibili dopo). Attraversa la
// stessa pipeline buildTmdbDetails di fetchTmdbDetailsById così metadati,
// piattaforma IT, trailer e rating restano coerenti con l'app.
async function fetchTmdbDetailsByTitle(title) {
  if (!tmdbConfigured()) return null;
  try {
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${CONFIG.TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=it-IT`
    );
    const searchData = await searchRes.json();
    if (!searchData.results || searchData.results.length === 0) return null;

    const movie = searchData.results[0];
    const detailRes = await fetch(
      `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${CONFIG.TMDB_API_KEY}&append_to_response=watch/providers,videos,credits&language=it-IT`
    );
    const detail = await detailRes.json();
    return await buildTmdbDetails(detail, title);
  } catch (err) {
    console.error('Errore TMDb:', err);
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTmdbDetails };
}

// Phase 41 — collection su richiesta; fallimenti non memorizzati e log senza URL/chiavi.
const tmdbCollectionCache = new Map();
function tmdbCollectionReleaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 100) return null;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? value : null;
}

function normalizeTmdbCollection(data) {
  if (!data || !Number.isInteger(Number(data.id)) || Number(data.id) <= 0 || !Array.isArray(data.parts)) return null;
  const seen = new Set();
  const parts = data.parts.filter(part => {
    if (!part) return false;
    const id = Number(part.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) return false;
    seen.add(id); return true;
  }).map(part => ({
    id: Number(part.id), title: part.title || part.original_title || 'Titolo non disponibile',
    release_date: tmdbCollectionReleaseDate(part.release_date),
    poster: part.poster_path ? 'https://image.tmdb.org/t/p/w200' + part.poster_path : ''
  })).sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999') || a.id - b.id);
  return { id: Number(data.id), name: data.name || 'La saga', parts };
}

async function fetchTmdbCollection(id) {
  id = Number(id);
  if (!tmdbConfigured() || !Number.isInteger(id) || id <= 0) return null;
  const cached = tmdbCollectionCache.get(id);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.data;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  try {
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => { if (controller) controller.abort(); resolve(null); }, 8000);
    });
    const request = (async () => {
      const response = await fetch(`https://api.themoviedb.org/3/collection/${id}?api_key=${CONFIG.TMDB_API_KEY}&language=it-IT`,
        controller ? { signal: controller.signal } : {});
      if (!response.ok) return null;
      const data = normalizeTmdbCollection(await response.json());
      return data && data.id === id ? data : null;
    })().catch(() => null);
    const data = await Promise.race([request, timeout]);
    if (data) tmdbCollectionCache.set(id, { data, at: Date.now() });
    return data;
  } finally { clearTimeout(timer); }
}
