// Visioni personali/condivise, voti e recensioni; protezione dai conflitti.
// Dipende dallo stato core e dai formati di js/format.js.

// Stato di visione della card. review_by recupera i film recensiti prima che
// watched_by venisse usato; watched_by accumula N e V anche senza recensione.
function viewingState(movie) {
  const together = movie.review_by === 'both' || movie.status === 'watched';
  return {
    N: together || movie.watched_by === 'N' || movie.watched_by === 'both' || movie.review_by === 'N',
    V: together || movie.watched_by === 'V' || movie.watched_by === 'both' || movie.review_by === 'V',
    together
  };
}

function personalRating(movie, person) {
  if (person !== 'N' && person !== 'V') return null;
  const value = movie[person === 'N' ? 'seen_rating_n' : 'seen_rating_v'];
  if (validMovieRating(value)) return value;
  // Le recensioni storiche avevano una scala 1–5: equivalenza visiva 2–10.
  const old = Number(movie.rating);
  return movie.review_by === person && Number.isInteger(old) && old >= 1 && old <= 5 ? old * 2 : null;
}

function togetherRating(movie) {
  const value = movie.seen_rating_together;
  if (validMovieRating(value)) return value;
  const old = Number(movie.rating);
  return movie.review_by === 'both' && Number.isInteger(old) && old >= 1 && old <= 5 ? old * 2 : null;
}

function reviewTextFor(movie, person) {
  const field = person === 'both' ? 'review_text_together'
    : person === 'N' ? 'review_text_n' : person === 'V' ? 'review_text_v' : null;
  if (!field) return '';
  return movie[field] || (movie.review_by === person ? movie.review_text || '' : '');
}

function mergedWatchedBy(movie, person) {
  if (person === 'both') return 'both';
  const seen = viewingState(movie);
  return seen[person === 'N' ? 'V' : 'N'] ? 'both' : person;
}

function canUndoSeen(movie, person) {
  if (person !== 'N' && person !== 'V') return false;
  if (viewingState(movie).together || movie.review_by === person) return false;
  return movie.watched_by === person || movie.watched_by === 'both';
}

function watchedByAfterUndo(movie, person) {
  const other = person === 'N' ? 'V' : 'N';
  return viewingState(movie)[other] ? other : null;
}

// "L'ho già visto" è idempotente e non modifica la serata.
// Testo omesso = conserva la recensione; stringa vuota = rimuove il testo.
// La condizione sul valore precedente evita di perdere il segno dell'altro
// telefono se N e V premono quasi nello stesso momento.
async function markMovieSeen(id, person, rating = null, reviewText = null) {
  if (person !== 'N' && person !== 'V') return false;
  if (rating !== null && !validMovieRating(rating)) return false;
  let movie = movies.find(m => m.id === id);
  if (!movie) return false;
  const ratingField = person === 'N' ? 'seen_rating_n' : 'seen_rating_v';
  const reviewField = person === 'N' ? 'review_text_n' : 'review_text_v';
  const hasReviewText = typeof reviewText === 'string';
  const text = hasReviewText ? reviewText.trim() : null;
  const patchFor = row => ({ watched_by: mergedWatchedBy(row, person),
    ...(rating !== null ? { [ratingField]: rating } : {}),
    ...(hasReviewText ? { [reviewField]: text,
      ...(row.review_by === person ? { review_text: text } : {}) } : {}) });
  if (rating === null && !hasReviewText && movie.watched_by === mergedWatchedBy(movie, person)) return true;

  if (!sb) {
    Object.assign(movie, patchFor(movie));
    saveLocal();
    return true;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = movie.watched_by ?? null;
    let query = sb.from('movies').update(patchFor(movie)).eq('id', id);
    query = previous === null ? query.is('watched_by', null) : query.eq('watched_by', previous);
    const { data, error } = await query.select('id');
    if (error) {
      console.error('[sc(r)occhiaTu] markMovieSeen fallita su Supabase:', error.message);
      return false;
    }
    if (data && data.length) return true;
    const latest = await sb.from('movies').select('*').eq('id', id).maybeSingle();
    if (latest.error || !latest.data) {
      console.error('[sc(r)occhiaTu] markMovieSeen: riallineamento fallito:', latest.error?.message || 'film non trovato');
      return false;
    }
    movie = latest.data;
    if (rating === null && !hasReviewText && movie.watched_by === mergedWatchedBy(movie, person)) return true;
  }
  console.error('[sc(r)occhiaTu] markMovieSeen: conflitto persistente sul film', id);
  return false;
}

// Annulla soltanto una visione segnata senza recensione. Il confronto sul
// valore precedente protegge la visione dell'altro telefono da overwrite.
async function undoMovieSeen(id, person) {
  if (person !== 'N' && person !== 'V') return false;
  let movie = movies.find(m => m.id === id);
  if (!movie || !canUndoSeen(movie, person)) return false;

  if (!sb) {
    movie.watched_by = watchedByAfterUndo(movie, person);
    movie[person === 'N' ? 'seen_rating_n' : 'seen_rating_v'] = null;
    movie[person === 'N' ? 'review_text_n' : 'review_text_v'] = null;
    saveLocal();
    return true;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = movie.watched_by;
    const ratingField = person === 'N' ? 'seen_rating_n' : 'seen_rating_v';
    const reviewField = person === 'N' ? 'review_text_n' : 'review_text_v';
    const { data, error } = await sb.from('movies')
      .update({ watched_by: watchedByAfterUndo(movie, person), [ratingField]: null, [reviewField]: null })
      .eq('id', id).eq('watched_by', previous).select('id');
    if (error) {
      console.error('[sc(r)occhiaTu] undoMovieSeen fallita su Supabase:', error.message);
      return false;
    }
    if (data && data.length) return true;
    const latest = await sb.from('movies').select('*').eq('id', id).maybeSingle();
    if (latest.error || !latest.data) {
      console.error('[sc(r)occhiaTu] undoMovieSeen: riallineamento fallito:', latest.error?.message || 'film non trovato');
      return false;
    }
    movie = latest.data;
    if (!canUndoSeen(movie, person)) return false;
  }
  console.error('[sc(r)occhiaTu] undoMovieSeen: conflitto persistente sul film', id);
  return false;
}
