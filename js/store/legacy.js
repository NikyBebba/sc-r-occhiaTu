// API votes dormienti, senza chiamanti UI e senza I/O remoto.
// Tabella conservata per rollback, negata dalla RLS. Cache separata dal core.
let votes = [];

function saveLegacyVotes() {
  requireAppIdentity();
  localStorage.setItem('scorochiatu_votes', JSON.stringify(votes));
}

function readLegacyVotesMirror() {
  try {
    const cached = JSON.parse(localStorage.getItem('scorochiatu_votes') || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch (_) { return []; }
}

async function fetchLegacyVotes() {
  requireAppIdentity();
  if (sb) return [];
  return readLegacyVotesMirror();
}

function getVotesForMovie(movieId) {
  const out = {};
  votes.filter(v => v.movie_id === movieId).forEach(v => { out[v.person] = v.liked; });
  return out;
}

// Firma mantenuta per compatibilità; nessun accesso applicativo alla tabella.
// Il toggle locale serve soltanto alle fixture/vecchie API isolate.
async function castVote(movieId, person, liked) {
  requireAppIdentity();
  if (sb) return false;
  const existing = votes.find(v => v.movie_id === movieId && v.person === person);
  if (existing && existing.liked === liked) {
    votes = votes.filter(v => !(v.movie_id === movieId && v.person === person));
  } else if (existing) {
    existing.liked = liked;
  } else {
    votes.push({ id: Date.now().toString() + Math.random(), movie_id: movieId, person, liked });
  }
  saveLegacyVotes();
}

// Nessuna proposta film legacy: la programmazione vive solo in store/nights.
