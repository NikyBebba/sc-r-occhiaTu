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
async function buildTmdbDetails(detail, fallbackTitle) {
  let platform = 'Streaming';
  const providers = detail['watch/providers']?.results?.IT?.flatrate;
  if (providers && providers.length > 0) platform = providers[0].provider_name;

  let trailerUrl = '';
  const videos = detail.videos?.results || [];
  const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer')
    || videos.find(v => v.site === 'YouTube');
  if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;

  const omdbData = detail.imdb_id ? await fetchOmdbByImdbId(detail.imdb_id) : null;
  const genreIds = (detail.genres || []).map(g => g.id);
  const genreNames = (detail.genres || []).map(g => g.name);

  // Step 5b — regista + anno: direttore/i dai credits (crew, job Director),
  // anno da release_date (primi 4 caratteri). Nessun dato → null, mai
  // stringhe vuote né placeholder.
  const directors = ((detail.credits && detail.credits.crew) || [])
    .filter(p => p.job === 'Director' && p.department === 'Directing')
    .map(p => p.name).filter(Boolean);
  const yMatch = String(detail.release_date || '').match(/^\d{4}/);
  const releaseYear = yMatch && parseInt(yMatch[0], 10) > 0 ? parseInt(yMatch[0], 10) : null;

  return {
    tmdb_id: detail.id,
    title: detail.title || fallbackTitle,
    collection_id: detail.belongs_to_collection?.id ?? null,
    collection_name: detail.belongs_to_collection?.name || null,
    genres: genreNames,
    genre: genreIds.length ? moodFromGenres(genreIds) : null,
    duration: detail.runtime ? `${detail.runtime} min` : null,
    release_year: releaseYear,
    director: directors.length ? directors.join(', ') : null,
    platform,
    poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
    trailerUrl,
    matched: true,
    ...extractRatings(omdbData)
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
      tmdb_id: id, title: 'Errore', genres: [], genre: null, duration: null, platform: 'Streaming',
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