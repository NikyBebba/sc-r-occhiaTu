// ============================================
// OMDb API — SOLO fallback + rating (IMDb, RT, Metacritic)
// ============================================

// La chiave in CONFIG è reale e usata direttamente dal frontend: la guardia
// è attiva semplicemente se c'è una chiave non vuota.
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

// Converte una risposta OMDb riuscita nell'oggetto dettagli usato dall'app.
// chiavi: title, genres, genre, duration, platform, poster, trailerUrl,
// matched, tmdb_id, collection_id, collection_name, imdbRating, rtRating,
// metacriticRating. duration restante null se Runtime è assente/N/A (mai il
// vecchio segnaposto '120 min').
function omdbToDetails(omdbData, fallbackTitle) {
  const genreNames = (omdbData.Genre || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s && s.toLowerCase() !== 'n/a');
  // Step 5b: anno dalla prima cifra di Year (gestisce range tipo
  // '1990–1994'), regista da Director. Nessun dato → null.
  const yMatch = String(omdbData.Year || '').match(/^\d{4}/);
  const releaseYear = yMatch && parseInt(yMatch[0], 10) > 0 ? parseInt(yMatch[0], 10) : null;
  return {
    title: omdbData.Title || fallbackTitle,
    genres: genreNames,
    genre: genreNames.length ? moodFromGenreNames(genreNames) : null,
    duration: omdbData.Runtime && omdbData.Runtime !== 'N/A' ? omdbData.Runtime : null,
    release_year: releaseYear,
    director: omdbData.Director && omdbData.Director !== 'N/A' ? omdbData.Director : null,
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