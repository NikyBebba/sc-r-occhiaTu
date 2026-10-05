// API votes dormienti, senza chiamanti UI e senza I/O al caricamento.
// Il core non legge né scrive questa cache; conservata per rollback.
let votes = [];

function saveLegacyVotes() {
  localStorage.setItem('scorochiatu_votes', JSON.stringify(votes));
}
// votes non alimenta Match Live, visioni, rating decimali o statistiche.

function readLegacyVotesMirror() {
  try {
    const cached = JSON.parse(localStorage.getItem('scorochiatu_votes') || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch (_) { return []; }
}

// Lettura opzionale per le API di compatibilità. Un guasto alla tabella
// dismessa non deve degradare film/serate; il mirror non viene cancellato.
async function fetchLegacyVotes() {
  try {
    const result = await sb.from('votes').select('*');
    if (!result.error && Array.isArray(result.data)) return result.data;
  } catch (_) { /* stessa compatibilità per query rifiutata/errore di rete */ }
  if (Date.now() - (fetchLegacyVotes.lastWarnAt || 0) > 60000) {
    console.warn('[sc(r)occhiaTu] votes legacy non disponibili — conservo il mirror; film e serate restano indipendenti.');
    fetchLegacyVotes.lastWarnAt = Date.now();
  }
  if (Array.isArray(votes) && votes.length) return votes;
  return readLegacyVotesMirror();
}

// ---- Like/dislike asincroni dismessi dalla UI ----
function getVotesForMovie(movieId) {
  const out = {};
  votes.filter(v => v.movie_id === movieId).forEach(v => { out[v.person] = v.liked; });
  return out;
}

async function castVote(movieId, person, liked) {
  // Toggle: riclickare lo STESSO voto lo rimuove (delete della riga in votes).
  // La decisione legge lo snapshot delle API legacy, indipendente dal core.
  const existing = votes.find(v => v.movie_id === movieId && v.person === person);
  const removing = existing && existing.liked === liked;

  if (sb) {
    if (removing) {
      const { error } = await sb.from('votes').delete().eq('movie_id', movieId).eq('person', person);
      if (error) {
        console.error('[sc(r)occhiaTu] rimozione voto fallita su Supabase:', error.message);
      }
    } else {
      const { error } = await sb.from('votes').upsert([{ movie_id: movieId, person, liked }], { onConflict: 'movie_id,person' });
      if (error) {
        console.error('[sc(r)occhiaTu] castVote fallito su Supabase:', error.message);
      }
    }
    const { data } = await sb.from('votes').select('*');
    if (data) { votes = data; saveLegacyVotes(); }
  } else {
    if (removing) {
      votes = votes.filter(v => !(v.movie_id === movieId && v.person === person));
    } else if (existing) {
      existing.liked = liked;
    } else {
      votes.push({ id: Date.now().toString() + Math.random(), movie_id: movieId, person, liked });
    }
    saveLegacyVotes();
  }
}

// Nessuna proposta film legacy: la programmazione vive solo in store/nights.
