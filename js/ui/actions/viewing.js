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
  const completedNights = by === 'both' && togetherSeen(movie) ? completedNightsForMovie(id) : [];
  const reviewNight = by === 'both'
    ? (togetherSeen(movie) ? completedNights[0] : activeNightForMovie(id)) : null;
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

async function finishTogetherNightUI(id, nightId) {
  const movie = movies.find(m => m.id === id);
  const night = nightId ? activeNights().find(n => n.id === nightId && n.movie_id === id) : activeNightForMovie(id);
  if (!movie || !night) return;
  const completed = await completeNight(id, undefined, night.id);
  if (!completed) { showActionError('Non siamo riusciti a completare la serata. Riprova.'); return; }
  await loadMovies();
  if (completed) suggestSagaAfterViewing(id);
}

function addPersonalReview(id) {
  const movie = movies.find(m => m.id === id);
  if (!movie || (currentUser !== 'N' && currentUser !== 'V')) return;

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
  if (rating === null && !(by === currentUser && (by === 'N' || by === 'V') && !rawRating.trim())) {
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
    if (!viewingState(movie).together) {
      saved = await completeNight(id, location || null, reviewNightId || undefined, { sharedRating: rating, sharedText: text });
    } else {
      saved = await updateMovie(id, { review_text_together: text, seen_rating_together: rating });
      if (saved && reviewNightId) {
        const night = movieNights.find(n => String(n.id) === reviewNightId && n.movie_id === id && n.status === 'completed');
        if (night && (night.location || '') !== location) saved = await updateMovieNight(night.id, { location: location || null });
      }
    }
  } else if ((by === 'N' || by === 'V') && by === currentUser) {
    saved = await savePersonalReview(id, rating, text);
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

async function markSeenUI(id) {
  const movie = movies.find(m => m.id === id);
  if (!movie || (currentUser !== 'N' && currentUser !== 'V')) return;
  if (!document.getElementById('detailModal').classList.contains('hidden')) closeModalNow('detailModal');
  // Together e stato personale sono indipendenti: qui si salva solo il proprio flag.
  if (togetherSeen(movie)) {
    if (await markMovieSeen(id, currentUser)) await loadMovies();
    else showActionError('Non siamo riusciti a salvare. Riprova.');
    return;
  }
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
  if (raw.trim() && rating === null) {
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
  requireAppIdentity();
  const epoch = authEpoch;
  if (!document.getElementById('detailModal').classList.contains('hidden')) closeModalNow('detailModal');
  const confirmed = await showConfirmModal('Segna come non visto', 'Vuoi segnare questo film come non visto da te? Il tuo voto e la tua recensione resteranno conservati.');
  if (!confirmed || !isAppAuthorized() || epoch !== authEpoch) return;
  const undone = await undoMovieSeen(id, currentUser);
  if (undone) await loadMovies();
}

async function removePersonalRating(id) {
  requireAppIdentity();
  const epoch = authEpoch;
  if (!document.getElementById('detailModal').classList.contains('hidden')) closeModalNow('detailModal');
  if (!(await showConfirmModal('Rimuovere il tuo voto?', 'Lo stato visto del film e la recensione resteranno invariati.'))) return;
  if (!isAppAuthorized() || epoch !== authEpoch) return;
  if (await removeEvaluationData(id, currentUser, 'rating')) await loadMovies();
  else showActionError('Non siamo riusciti a rimuovere il voto.');
}
async function removePersonalText(id) {
  requireAppIdentity();
  const epoch = authEpoch;
  if (!document.getElementById('detailModal').classList.contains('hidden')) closeModalNow('detailModal');
  const movie = movies.find(m => m.id === id);
  if (!movie || !(await showConfirmModal('Rimuovere la tua recensione?', 'Il tuo voto e lo stato visto del film resteranno invariati.'))) return;
  if (!isAppAuthorized() || epoch !== authEpoch) return;
  if (await removeEvaluationData(id, currentUser, 'text')) await loadMovies();
  else showActionError('Non siamo riusciti a rimuovere la recensione.');
}

// Unico percorso di rimozione: patch limitate a voto/testo del contesto scelto.
async function removeEvaluationData(id, by, part) {
  requireAppIdentity();
  const movie = movies.find(m => m.id === id);
  if (!movie || !['rating', 'text', 'both'].includes(part)
      || !['N', 'V'].includes(currentUser) || (by !== currentUser && by !== 'both')
      || (by === 'both' && !togetherSeen(movie))
      || (movie.surprise_by && movie.surprise_by !== currentUser)) return false;
  if (by !== 'both') return savePersonalReview(id,
    part === 'text' ? personalRating(movie, by) : null, part === 'rating' ? undefined : '');
  return updateMovie(id, {
    ...(part !== 'text' ? { seen_rating_together: null } : {}),
    ...(part !== 'rating' ? { review_text_together: '' } : {})
  });
}

async function removeEvaluationUI(id, by) {
  requireAppIdentity();
  const epoch = authEpoch;
  const movie = movies.find(m => m.id === id);
  if (!movie || !['N', 'V'].includes(currentUser) || (by !== currentUser && by !== 'both')
      || (by === 'both' && !togetherSeen(movie))
      || (movie.surprise_by && movie.surprise_by !== currentUser)) return;
  const hasRating = (by === 'both' ? togetherRating(movie) : personalRating(movie, by)) !== null;
  const hasText = !!reviewTextFor(movie, by);
  if (!hasRating && !hasText) return;
  const label = by === 'both' ? sharedPeopleLabel() : CONFIG.PEOPLE[by]?.label || by;
  let part;
  if (hasRating && hasText) part = await showConfirmModal('Cosa vuoi rimuovere?',
    `Valutazione ${label}. Lo stato visto e le serate resteranno invariati.`, [
      { value: 'rating', label: 'Solo voto' }, { value: 'text', label: 'Solo recensione' },
      { value: 'both', label: 'Voto e recensione' }
    ]);
  else {
    part = hasRating ? 'rating' : 'text';
    if (!(await showConfirmModal(hasRating ? 'Rimuovere il voto?' : 'Rimuovere la recensione?',
      `Valutazione ${label}. Lo stato visto e le serate resteranno invariati.`))) return;
  }
  if (!part || !isAppAuthorized() || epoch !== authEpoch) return;
  if (await removeEvaluationData(id, by, part)) await loadMovies();
  else showActionError('Non siamo riusciti a rimuovere la valutazione. Riprova.');
}
