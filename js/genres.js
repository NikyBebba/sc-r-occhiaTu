// ============================================
// GENRES — mappa TMDb/OMDb → mood + derivazione pura
// Condivisa da: API (browser), ruota/filtri, backfill CLI (scripts/
// backfill-genres.js la carica via fs) e smoke. Nessuna dipendenza da DOM.
//
// Modello: movies.genres = generi REALI (nomi TMDb it-IT / OMDb, text[]);
// movies.genre = mirror MOOD derivato (badge, stats, ruota). La derivazione
// vive QUI così backfill, api e UI restano allineate.
// ============================================

// Mappa per ID TMDb (stabile tra lingue). Priorità mood in MOOD_PRIORITY.
// Gli id non elencati (futuri/nicchia) cadono in 'altro' per fallback.
const TMDB_GENRE_MOOD = {
  // azione
  28: 'azione', 12: 'azione', 80: 'azione', 37: 'azione', 10752: 'azione',
  // risata
  35: 'risata', 16: 'risata', 10751: 'risata',
  // paura
  27: 'paura', 53: 'paura', 9648: 'paura',
  // romantico
  10749: 'romantico',
  // nostalgia (Drama / History)
  18: 'nostalgia', 36: 'nostalgia',
  // altro (categorizzati ma senza preferenza: Fantasy, Science Fiction, ...)
  14: 'altro', 878: 'altro', 99: 'altro', 10402: 'altro', 10770: 'altro'
};

// Nomi genere → mood. Chiavi normalizzate (lowercase). Copre i nomi EN di
// OMDb e i nomi it-IT di TMDb, così va bene anche per il fallback e per la
// derivazione locale senza TMDb. Nomi non noti → 'altro'.
const GENRE_MOOD_BY_NAME = {
  // azione
  action: 'azione', adventure: 'azione', crime: 'azione', western: 'azione', war: 'azione',
  azione: 'azione', avventura: 'azione', crimine: 'azione', guerra: 'azione',
  // risata
  comedy: 'risata', animation: 'risata', family: 'risata',
  commedia: 'risata', animazione: 'risata', famiglia: 'risata',
  // paura
  horror: 'paura', thriller: 'paura', mystery: 'paura',
  orrore: 'paura', mistero: 'paura', giallo: 'paura',
  // romantico
  romance: 'romantico', romantico: 'romantico',
  // nostalgia (Drama / History)
  drama: 'nostalgia', history: 'nostalgia', dramma: 'nostalgia', storia: 'nostalgia',
  // altro (categorizzati ma senza preferenza)
  fantasy: 'altro', 'sci-fi': 'altro', 'science fiction': 'altro', scifi: 'altro', sciencefiction: 'altro',
  fantascienza: 'altro', documentary: 'altro', documentario: 'altro',
  music: 'altro', musical: 'altro', musica: 'altro',
  'film-noir': 'altro', 'film tv': 'altro', biography: 'altro', sport: 'altro'
};

// Ordine di preferenza per i film con più generi: a parità di presenza si
// vince il primo mood della lista. 'altro' è sempre l'ultima risorsa.
const MOOD_PRIORITY = ['paura', 'romantico', 'risata', 'azione', 'nostalgia', 'altro'];

function normalizeGenreName(n) {
  return String(n || '').trim().toLowerCase();
}

// Mood di un film a partire dagli ID TMDb dei suoi generi.
// Priorità esplicita (MOOD_PRIORITY), NON l'ordine della lista TMDb.
// Es.: [27, 18] (horror+drama) → 'paura'; [18, 35] (drama+comedy) → 'risata'.
function moodFromGenres(genreIds) {
  const moods = new Set((genreIds || []).map(id => TMDB_GENRE_MOOD[id] || 'altro'));
  for (const mood of MOOD_PRIORITY) {
    if (moods.has(mood)) return mood;
  }
  return 'altro';
}

// Mood di un film a partire dai NOMI dei generi (OMDb EN, o TMDb it-IT
// quando non abbiamo gli id). Stessa logica di priorità.
function moodFromGenreNames(genreNames) {
  const moods = new Set((genreNames || []).map(n => GENRE_MOOD_BY_NAME[normalizeGenreName(n)] || 'altro'));
  for (const mood of MOOD_PRIORITY) {
    if (moods.has(mood)) return mood;
  }
  return 'altro';
}