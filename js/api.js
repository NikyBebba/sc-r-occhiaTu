// ============================================
// TMDb API — poster, durata, streaming, trailer
// OMDb API — fallback titolo + rating (IMDb, RT, Metacritic)
// ============================================

// La chiave in CONFIG è reale e usa direttamente dal frontend: la guardia
// è attiva semplicemente se c'è una chiave non vuota.
function tmdbConfigured() {
  return !!(CONFIG.TMDB_API_KEY && CONFIG.TMDB_API_KEY.trim());
}

function omdbConfigured() {
  return !!(CONFIG.OMDB_API_KEY && CONFIG.OMDB_API_KEY.trim());
}

const emptyRatings = { imdbRating: '', rtRating: '', metacriticRating: '' };

// Estrae i tre rating da una risposta OMDb grezza.
function extractRatings(omdbData) {
  const out = { ...emptyRatings };
  if (!omdbData) return out;
  if (omdbData.imdbRating && omdbData.imdbRating !== 'N/A') out.imdbRating = omdbData.imdbRating;
  (omdbData.Ratings || []).forEach(r => {
    if (r.Source === 'Rotten Tomatoes') out.rtRating = r.Value;
    if (r.Source === 'Metacritic') out.metacriticRating = r.Value;
  });
  return out;
}

// Interrogata in due casi: (1) TMDb non trova il titolo (fallback completo,
// cerca per testo) e (2) TMDb l'ha trovato ma vogliamo comunque i rating
// (query per imdb_id, molto più precisa perché non dipende dal titolo).
async function fetchOmdbByTitle(title) {
  if (!omdbConfigured()) return null;
  try {
    const res = await fetch(`https://www.omdbapi.com/?apikey=${CONFIG.OMDB_API_KEY}&t=${encodeURIComponent(title)}`);
    const data = await res.json();
    return data.Response === 'False' ? null : data;
  } catch (err) {
    console.error('Errore OMDb (titolo):', err);
    return null;
  }
}

async function fetchOmdbByImdbId(imdbId) {
  if (!omdbConfigured() || !imdbId) return null;
  try {
    const res = await fetch(`https://www.omdbapi.com/?apikey=${CONFIG.OMDB_API_KEY}&i=${imdbId}`);
    const data = await res.json();
    return data.Response === 'False' ? null : data;
  } catch (err) {
    console.error('Errore OMDb (imdb_id):', err);
    return null;
  }
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

// Dettaglio completo di UN film TMDb già identificato per id
// (chiamata dopo che l'utente ha scelto dal picker). imdb_id fa parte
// della risposta base di TMDb, non serve append_to_response per averlo.
async function fetchTmdbDetailsById(id) {
  try {
    const detailRes = await fetch(
      `https://api.themoviedb.org/3/movie/${id}?api_key=${CONFIG.TMDB_API_KEY}&append_to_response=watch/providers,videos&language=it-IT`
    );
    const detail = await detailRes.json();

    let platform = 'Streaming';
    const providers = detail['watch/providers']?.results?.IT?.flatrate;
    if (providers && providers.length > 0) platform = providers[0].provider_name;

    let trailerUrl = '';
    const videos = detail.videos?.results || [];
    const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer')
      || videos.find(v => v.site === 'YouTube');
    if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;

    const omdbData = detail.imdb_id ? await fetchOmdbByImdbId(detail.imdb_id) : null;

    return {
      tmdb_id: id,
      title: detail.title,
      collection_id: detail.belongs_to_collection?.id ?? null,
      collection_name: detail.belongs_to_collection?.name || null,
      duration: detail.runtime ? `${detail.runtime} min` : '120 min',
      platform,
      poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
      trailerUrl,
      matched: true,
      ...extractRatings(omdbData)
    };
  } catch (err) {
    console.error('Errore dettaglio TMDb:', err);
    return { tmdb_id: id, title: 'Errore', duration: '120 min', platform: 'Streaming', poster: '', trailerUrl: '', matched: false, collection_id: null, collection_name: null, ...emptyRatings };
  }
}

// Recupera i dettagli di un film a partire dal titolo — usata SOLO per
// l'import bulk, dove prendere il primo risultato senza far scegliere
// l'utente è una scelta deliberata (import fatto una tantum, velocità
// conta più della precisione al 100%; i casi dubbi restano comunque
// marcati matched:false e correggibili singolarmente dopo).
// Ordine: TMDb (fonte principale, dà anche streaming IT e trailer) →
// se non trova nulla, OMDb come seconda chance → se anche questo fallisce,
// il film viene comunque salvato ma marcato matched:false, così in UI
// si vede subito quali titoli vanno controllati a mano.
async function fetchMovieDetails(title) {
  const notFound = { title, duration: '120 min', platform: 'Streaming', poster: '', trailerUrl: '', matched: false, tmdb_id: null, collection_id: null, collection_name: null, ...emptyRatings };
  if (!tmdbConfigured()) return notFound;

  try {
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${CONFIG.TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=it-IT`
    );
    const searchData = await searchRes.json();

    if (!searchData.results || searchData.results.length === 0) {
      const omdbData = await fetchOmdbByTitle(title);
      if (!omdbData) return notFound;
      return {
        title: omdbData.Title || title,
        duration: omdbData.Runtime && omdbData.Runtime !== 'N/A' ? omdbData.Runtime : '120 min',
        platform: 'Streaming',
        poster: omdbData.Poster && omdbData.Poster !== 'N/A' ? omdbData.Poster : '',
        trailerUrl: '',
        matched: true,
        tmdb_id: null,
        collection_id: null,
        collection_name: null,
        ...extractRatings(omdbData)
      };
    }

    const movie = searchData.results[0];
    const detailRes = await fetch(
      `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${CONFIG.TMDB_API_KEY}&append_to_response=watch/providers,videos&language=it-IT`
    );
    const detail = await detailRes.json();

    let platform = 'Streaming';
    const providers = detail['watch/providers']?.results?.IT?.flatrate;
    if (providers && providers.length > 0) platform = providers[0].provider_name;

    let trailerUrl = '';
    const videos = detail.videos?.results || [];
    const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer')
      || videos.find(v => v.site === 'YouTube');
    if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;

    const omdbData = detail.imdb_id ? await fetchOmdbByImdbId(detail.imdb_id) : null;

    return {
      tmdb_id: movie.id,
      title: detail.title || title,
      collection_id: detail.belongs_to_collection?.id ?? null,
      collection_name: detail.belongs_to_collection?.name || null,
      duration: detail.runtime ? `${detail.runtime} min` : '120 min',
      platform,
      poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
      trailerUrl,
      matched: true,
      ...extractRatings(omdbData)
    };
  } catch (err) {
    console.error('Errore TMDb:', err);
    const omdbData = await fetchOmdbByTitle(title);
    if (!omdbData) return notFound;
    return {
      title: omdbData.Title || title,
      duration: omdbData.Runtime && omdbData.Runtime !== 'N/A' ? omdbData.Runtime : '120 min',
      platform: 'Streaming',
      poster: omdbData.Poster && omdbData.Poster !== 'N/A' ? omdbData.Poster : '',
      trailerUrl: '',
      matched: true,
      tmdb_id: null,
      collection_id: null,
      collection_name: null,
      ...extractRatings(omdbData)
    };
  }
}
