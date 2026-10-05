// Form di voto/recensione e visione personale/condivisa.
// Riusa store/viewing, store/nights e le etichette dello storico nei renderer.

// ---- Visione e recensioni ----
function completedNightsForMovie(id) {
  return movieNights.filter(n => n.movie_id === id && n.status === 'completed')
    .sort((a, b) => (b.completed_at || b.created_at || '').localeCompare(a.completed_at || a.created_at || ''));
}

function selectReviewNight() {
  const id = document.getElementById('reviewMovieId').value;
  const nightId = document.getElementById('reviewNightSelect').value;
  const night = completedNightsForMovie(id).find(n => String(n.id) === nightId);
  if (!night) return;
  document.getElementById('reviewNightId').value = night.id;
  document.getElementById('reviewLocation').value = night.location || '';
}

function openReviewFor(id, by) {
  const movie = movies.find(m => m.id === id);
  if (!movie || (by !== 'both' && by !== currentUser)) return;
  if (movie.surprise_by && movie.surprise_by !== currentUser) return;
  document.getElementById('reviewMovieId').value = id;
  const existingText = reviewTextFor(movie, by);
  const existingScore = by === 'both' ? togetherRating(movie) : personalRating(movie, by);
  const hasReview = !!existingText || existingScore !== null;
  document.getElementById('reviewText').value = existingText;
  document.getElementById('reviewBy').value = by;
  document.getElementById('reviewTextOptional').classList.remove('hidden');
  document.getElementById('reviewModalTitle').textContent = by === 'both'
    ? `${hasReview ? 'Modifica voto o recensione' : 'Voto e recensione'} ${sharedPeopleLabel()}`
    : `Modifica voto ${CONFIG.PEOPLE[currentUser]?.label || currentUser}`;
  document.getElementById('reviewMovieTitle').textContent = movie.title;
  const completedNights = by === 'both' && hasReview ? completedNightsForMovie(id) : [];
  const reviewNight = by === 'both'
    ? (hasReview ? completedNights[0] : activeNightForMovie(id)) : null;
  document.getElementById('reviewNightId').value = reviewNight?.id || '';
  document.getElementById('reviewLocation').value = reviewNight?.location || '';
  document.getElementById('reviewLocationWrap').classList.toggle('hidden', by !== 'both');
  const nightSelect = document.getElementById('reviewNightSelect');
  nightSelect.innerHTML = completedNights.length > 1 ? completedNights.map(n =>
    `<option value="${escapeHtml(String(n.id))}">${escapeHtml(completedNightLabel({ night: n, timelineDate: nightTimelineDate(n) }))}</option>`
  ).join('') : '';
  nightSelect.value = reviewNight?.id || '';
  document.getElementById('reviewNightSelectWrap').classList.toggle('hidden', completedNights.length <= 1);
  document.getElementById('reviewRating').value = formatMovieRating(existingScore);
  document.getElementById('reviewRatingLabel').textContent = by === 'both' ? `Il voto ${sharedPeopleLabel()} ★` : 'Il tuo voto ★';
  document.getElementById('reviewHelp').textContent = by === 'both'
    ? (hasReview
      ? 'Le modifiche non cambiano la data della serata registrata nello storico.'
      : 'Il voto è condiviso, il testo è facoltativo. Se c’è una serata attiva, verrà segnata come conclusa.')
    : 'Il testo è facoltativo: svuotalo e salva per lasciare solo il voto. I voti dell’altra persona restano invariati.';
  document.getElementById('reviewError').classList.add('hidden');
  document.getElementById('reviewSaveButton').disabled = false;
  document.getElementById('reviewSaveButton').textContent = hasReview ? 'Salva modifiche' : 'Salva voto';
  if (!document.getElementById('detailModal').classList.contains('hidden')) closeModalNow('detailModal');
  openModal('reviewModal');
}

function addReview(id) { openReviewFor(id, 'both'); }

function reviewTogetherFromSeen() {
  const id = document.getElementById('seenMovieId').value;
  closeModal('seenModal');
  addReview(id);
}

async function finishTogetherNightUI(id) {
  const movie = movies.find(m => m.id === id);
  if (!movie || (reviewTextFor(movie, 'both') === '' && togetherRating(movie) === null) || !activeNightForMovie(id)) return;
  if (!(await updateMovie(id, { status: 'watched', watched_by: 'both' }))) return;
  const completed = await completeNight(id);
  await loadMovies();
  if (completed) suggestSagaAfterViewing(id);
}

function addPersonalReview(id) {
  const movie = movies.find(m => m.id === id);
  if (!movie || (currentUser !== 'N' && currentUser !== 'V')) return;
  if (personalRating(movie, currentUser) === null) {
    markSeenUI(id);
    return;
  }
  openReviewFor(id, currentUser);
}

async function confirmReview() {
  const id = document.getElementById('reviewMovieId').value;
  const text = document.getElementById('reviewText').value.trim();
  const by = document.getElementById('reviewBy').value;
  const location = document.getElementById('reviewLocation').value.trim().slice(0, 120);
  const reviewNightId = document.getElementById('reviewNightId').value;
  const rawRating = document.getElementById('reviewRating').value;
  const rating = parseMovieRating(rawRating);
  const error = document.getElementById('reviewError');
  const saveButton = document.getElementById('reviewSaveButton');
  error.classList.add('hidden');
  if (rating === null) {
    error.textContent = 'Scegli un voto da 0 a 10, con al massimo un decimale (es. 8,3).';
    error.classList.remove('hidden');
    document.getElementById('reviewRating').focus();
    return;
  }
  const movie = movies.find(m => m.id === id);
  if (!movie || saveButton.disabled) return;
  const newTogetherViewing = by === 'both' && !viewingState(movie).together;
  saveButton.disabled = true;
  let saved = false;
  if (by === 'both') {
    const editingTogether = !!reviewTextFor(movie, 'both') || togetherRating(movie) !== null;
    const patch = { review_text_together: text, seen_rating_together: rating, review_text: text,
      review_by: 'both', ...(editingTogether ? {} : { watched_by: 'both', status: 'watched' }) };
    // Prima di sostituire il mirror legacy, preserviamo l'eventuale recensione
    // personale storica, che altrimenti non sarebbe più riconoscibile.
    if (!sb && (movie.review_by === 'N' || movie.review_by === 'V')) {
      const key = movie.review_by.toLowerCase();
      if (!movie[`review_text_${key}`] && movie.review_text) patch[`review_text_${key}`] = movie.review_text;
      if (movie[`seen_rating_${key}`] == null && Number.isInteger(movie.rating) && movie.rating >= 1 && movie.rating <= 5) {
        patch[`seen_rating_${key}`] = movie.rating * 2;
      }
    }
    saved = await updateMovie(id, patch);
    if (saved && !editingTogether) saved = await completeNight(id, location || null);
    if (saved && editingTogether && reviewNightId) {
      const night = movieNights.find(n => String(n.id) === reviewNightId && n.movie_id === id && n.status === 'completed');
      if (night && (night.location || '') !== location) {
        saved = await updateMovieNight(night.id, { location: location || null });
      }
    } else if (saved && editingTogether && location) {
      // Recensioni legacy senza riga-serata: luogo conservato con data ignota.
      saved = !!(await insertMovieNight({ movie_id: id, date: null, time: null,
        snack: null, location, proposed_by: null, status: 'completed', completed_at: null }));
    }
  } else if ((by === 'N' || by === 'V') && by === currentUser && personalRating(movie, by) !== null) {
    saved = await markMovieSeen(id, by, rating, text);
  }
  saveButton.disabled = false;
  if (!saved) {
    error.textContent = 'Non siamo riusciti a salvare la recensione. Riprova.';
    error.classList.remove('hidden');
    return;
  }
  closeModal('reviewModal');
  await loadMovies();
  if (newTogetherViewing) suggestSagaAfterViewing(id);
}

function markSeenUI(id) {
  const movie = movies.find(m => m.id === id);
  if (!movie || (currentUser !== 'N' && currentUser !== 'V')) return;
  document.getElementById('seenMovieId').value = id;
  document.getElementById('seenTogetherButtonLabel').textContent = `Visto insieme? Vota ${sharedPeopleLabel()}`;
  const score = personalRating(movie, currentUser);
  document.getElementById('seenRating').value = formatMovieRating(score);
  document.getElementById('seenReview').value = reviewTextFor(movie, currentUser);
  document.getElementById('seenRatingError').classList.add('hidden');
  openModal('seenModal');
}

async function confirmSeen() {
  const id = document.getElementById('seenMovieId').value;
  const raw = document.getElementById('seenRating').value;
  const rating = parseMovieRating(raw);
  const error = document.getElementById('seenRatingError');
  if (rating === null) {
    error.textContent = 'Scegli un voto da 0 a 10, con al massimo un decimale (es. 8,3).';
    error.classList.remove('hidden');
    document.getElementById('seenRating').focus();
    return;
  }
  const reviewText = document.getElementById('seenReview').value.trim();
  const movie = movies.find(row => row.id === id);
  const newViewing = movie && !viewingState(movie)[currentUser];
  const saved = await markMovieSeen(id, currentUser, rating, reviewText);
  if (!saved) {
    error.textContent = 'Non siamo riusciti a salvare. Riprova.';
    error.classList.remove('hidden');
    return;
  }
  closeModal('seenModal');
  await loadMovies();
  if (newViewing) suggestSagaAfterViewing(id);
}

async function undoSeenUI(id) {
  const movie = movies.find(m => m.id === id);
  if (movie && reviewTextFor(movie, currentUser)) {
    const confirmed = await showConfirmModal('Annullare la visione?', 'Verranno rimossi anche il tuo voto e la tua recensione.');
    if (!confirmed) return;
  }
  const undone = await undoMovieSeen(id, currentUser);
  if (undone) await loadMovies();
}
