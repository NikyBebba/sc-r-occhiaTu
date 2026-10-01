// ============================================
// ORCHESTRATORE API — combina TMDb (primario) e OMDb (fallback)
// Espone la funzione pubblica `fetchMovieDetails` usata da bulk import
// e dai flussi di aggiunta: ordine TMDb → OMDb → notFound.
// ============================================

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
  const notFound = {
    title, genres: [], duration: null, platform: 'Streaming', poster: '', trailerUrl: '',
    matched: false, tmdb_id: null, collection_id: null, collection_name: null,
    release_year: null, director: null,
    ...emptyRatings
  };

  const tmdbDetails = await fetchTmdbDetailsByTitle(title);
  if (tmdbDetails) return tmdbDetails;

  // OMDb come seconda chance (query per titolo).
  const omdbData = await fetchOmdbByTitle(title);
  return omdbData ? omdbToDetails(omdbData, title) : notFound;
}

// Solo nella scheda: TMDb risolve l'IMDb ID del film esatto; OMDb fornisce
// Awards. La cache di sessione evita nuove chiamate a ogni riapertura.
const oscarWinsCache = new Map();
async function fetchOscarWins(tmdbId) {
  const id = Number(tmdbId);
  if (!Number.isSafeInteger(id) || id <= 0 || !tmdbConfigured() || !omdbConfigured()) return null;
  if (oscarWinsCache.has(id)) return oscarWinsCache.get(id);
  let retry = false;
  const request = (async () => {
    try {
      const response = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${CONFIG.TMDB_API_KEY}&language=it-IT`);
      if (!response.ok) { retry = true; return null; }
      const detail = await response.json();
      if (!/^tt\d+$/.test(detail.imdb_id || '')) return null;
      const omdb = await fetchOmdbByImdbId(detail.imdb_id);
      if (!omdb) { retry = true; return null; }
      return parseOscarWins(omdb?.Awards);
    } catch (_) {
      retry = true;
      return null; // premio opzionale: la scheda resta utilizzabile anche offline
    }
  })();
  oscarWinsCache.set(id, request);
  const wins = await request;
  if (retry) oscarWinsCache.delete(id); // rete assente: ritenta alla prossima apertura
  return wins;
}
