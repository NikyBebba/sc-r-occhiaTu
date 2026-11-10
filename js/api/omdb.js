// ============================================
// OMDb API — SOLO fallback + rating (IMDb, RT, Metacritic)
// ============================================

// La chiave in CONFIG è reale e usata direttamente dal frontend: la guardia
// è attiva semplicemente se c'è una chiave non vuota.
function omdbConfigured() {
  return !!(CONFIG.OMDB_API_KEY && CONFIG.OMDB_API_KEY.trim());
}

const emptyRatings = { imdbRating: '', rtRating: '', metacriticRating: '' };

// Il campo Awards di OMDb contiene anche nomination e totali anonimi.
// Mostriamo solo una vittoria agli Oscar dichiarata esplicitamente.
function parseOscarWins(awards) {
  const match = String(awards || '').match(/\bWon\s+([1-9]\d*)\s+Oscars?\b/i);
  return match ? Number(match[1]) : null;
}

// Estrae i tre rating da una risposta OMDb grezza.
function extractRatings(omdbData) {
  const out = { ...emptyRatings };
  if (!omdbData||omdbData.Response==='False') return out;
  if (omdbData.imdbRating && omdbData.imdbRating !== 'N/A') out.imdbRating = omdbData.imdbRating;
  (Array.isArray(omdbData.Ratings)?omdbData.Ratings:[]).forEach(r => {
    if (r?.Value&&r.Value!=='N/A'&&r.Source === 'Rotten Tomatoes') out.rtRating = r.Value;
    if (r?.Value&&r.Value!=='N/A'&&r.Source === 'Metacritic') out.metacriticRating = r.Value;
  });
  if(!out.metacriticRating&&omdbData.Metascore&&omdbData.Metascore!=='N/A')out.metacriticRating=omdbData.Metascore;
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

// Source metadata only: positive and missing responses cached, concurrent reads shared.
const omdbRatingsCache=new Map(),omdbRatingsPending=new Map();
async function fetchOmdbByImdbId(imdbId) {
  if(!omdbConfigured()||typeof imdbId!=='string'||!/^tt\d{5,12}$/.test(imdbId))return null;
  const hit=omdbRatingsCache.get(imdbId);if(hit&&Date.now()-hit.at<(hit.data===null?300000:3600000))return hit.data;
  if(omdbRatingsPending.has(imdbId))return omdbRatingsPending.get(imdbId);
  const task=(async()=>{const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);let data=null;
    try{const response=await fetch(`https://www.omdbapi.com/?apikey=${CONFIG.OMDB_API_KEY}&i=${imdbId}`,{signal:abort.signal});
      if(response.ok!==false){const raw=await response.json();if(raw&&raw.Response!=='False'&&(!raw.imdbID||raw.imdbID===imdbId))data=raw;}
    }catch(_){}finally{clearTimeout(timer);}
    omdbRatingsCache.delete(imdbId);omdbRatingsCache.set(imdbId,{at:Date.now(),data});while(omdbRatingsCache.size>100)omdbRatingsCache.delete(omdbRatingsCache.keys().next().value);return data;
  })();omdbRatingsPending.set(imdbId,task);try{return await task;}finally{omdbRatingsPending.delete(imdbId);}
}

// Converte una risposta OMDb riuscita nell'oggetto dettagli usato dall'app.
// chiavi: title, genres, duration, platform, poster, trailerUrl,
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractRatings,fetchOmdbByImdbId };
}
