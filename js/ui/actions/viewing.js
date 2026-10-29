// Form di voto/recensione e visione personale/condivisa.
// Riusa store/viewing, store/nights e le etichette dello storico nei renderer.

// Intent snapshots belong to the existing forms, not to preference UI.
let personalReviewDraft = null;
let seenRatingDraft = null;
function bindRatingIntent(input, draft) {
  input.oninput = () => { draft.ratingTouched = true; };
}
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
  document.getElementById('reviewSnack').value = night.snack || '';
}

function openReviewFor(id, by, trigger) {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return TargetShell.edit(by==='both'?'setGroupEvaluation':'setMyEvaluation',id);
  const movie = movies.find(m => m.id === id);
  if (!movie || (by !== 'both' && by !== currentUser)) return;
  if (movie.surprise_by && movie.surprise_by !== currentUser) return;
  judgmentReturnFocus = {id,by,person:currentUser,epoch:authEpoch,trigger:trigger || document.activeElement};
  document.getElementById('reviewMovieId').value = id;
  const existingText = reviewTextFor(movie, by);
  const existingScore = by === 'both' ? togetherRating(movie) : personalRating(movie, by);
  const hasReview = !!existingText || existingScore !== null;
  document.getElementById('reviewText').value = existingText;
  document.getElementById('reviewBy').value = by;
  document.getElementById('reviewTextOptional').classList.remove('hidden');
  document.getElementById('reviewModalTitle').textContent = by === 'both'
    ? `${hasReview ? 'Modifica voto o recensione' : 'Voto e recensione'} ${sharedPeopleLabel()}`
    : `Il tuo giudizio ${CONFIG.PEOPLE[currentUser]?.label || currentUser}`;
  document.getElementById('reviewMovieTitle').textContent = movie.title;
  const completedNights = by === 'both' && togetherSeen(movie) ? completedNightsForMovie(id) : [];
  const reviewNight = by === 'both'
    ? (togetherSeen(movie) ? completedNights[0] : activeNightForMovie(id)) : null;
  document.getElementById('reviewNightId').value = reviewNight?.id || '';
  document.getElementById('reviewLocation').value = reviewNight?.location || '';
  document.getElementById('reviewSnack').value = reviewNight?.snack || '';
  document.getElementById('reviewLocationWrap').classList.toggle('hidden', by !== 'both');
  const nightSelect = document.getElementById('reviewNightSelect');
  nightSelect.innerHTML = completedNights.length > 1 ? completedNights.map(n =>
    `<option value="${escapeHtml(String(n.id))}">${escapeHtml(completedNightLabel({ night: n, timelineDate: nightTimelineDate(n) }))}</option>`
  ).join('') : '';
  nightSelect.value = reviewNight?.id || '';
  document.getElementById('reviewNightSelectWrap').classList.toggle('hidden', completedNights.length <= 1);
  document.getElementById('reviewRating').value = formatMovieRating(existingScore);
  personalReviewDraft = { id, by, epoch: authEpoch, initialRating: existingScore, initialText: existingText.trim(), ratingTouched: false, reviewTouched: false };
  if (by !== 'both') bindPersonalJudgment('reviewRating', personalReviewDraft, movie);
  else { document.getElementById('reviewRating').disabled=false; document.getElementById('reviewText').disabled=false; document.getElementById('reviewModal').setAttribute?.('aria-busy','false'); document.getElementById('reviewRatingJudgment').classList.add('hidden'); bindRatingIntent(document.getElementById('reviewRating'), personalReviewDraft); }
  document.getElementById('reviewRating').required = by === 'both';
  const reviewDraft = personalReviewDraft;
  document.getElementById('reviewText').oninput = () => { reviewDraft.reviewTouched = true; };
  document.getElementById('reviewRatingLabel').textContent = by === 'both' ? `Il voto ${sharedPeopleLabel()} ★` : 'Il tuo voto ★';
  document.getElementById('reviewHelp').textContent = by === 'both'
    ? (hasReview
      ? 'Le modifiche non cambiano la data della serata registrata nello storico.'
      : 'Il voto è condiviso, il testo è facoltativo. Se c’è una serata attiva, verrà segnata come conclusa.')
    : 'Il testo è indipendente dal tuo giudizio: modificarlo non cambia voto o feedback rapido.';
  document.getElementById('reviewError').classList.add('hidden');
  document.getElementById('reviewSaveButton').disabled = false;
  document.getElementById('reviewSaveButton').textContent = by === 'both' ? (hasReview ? 'Salva modifiche' : 'Salva voto') : 'Salva giudizio';
  if (!document.getElementById('detailModal').classList.contains('hidden')) closeModalNow('detailModal');
  openModal('reviewModal');
  syncReviewEditor();
  document.getElementById(by === 'both' || existingScore !== null ? 'reviewRating' : 'reviewRatingLike').focus();
}

function addReview(id, trigger) { openReviewFor(id, 'both', trigger); }

function reviewTogetherFromSeen() {
  const id = document.getElementById('seenMovieId').value;
  closeModal('seenModal');
  addReview(id);
}

async function finishTogetherNightUI(id, nightId) {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return TargetShell.edit(nightId?'completeScheduled':'completeNow',nightId||id);
  const movie = movies.find(m => m.id === id);
  const night = nightId ? activeNights().find(n => n.id === nightId && n.movie_id === id) : activeNightForMovie(id);
  if (!movie || !night || !nightIsDue(night)) return;
  const completed = await completeNight(id, undefined, night.id);
  if (!completed) { showActionError('Non siamo riusciti a completare la serata. Riprova.'); return; }
  await loadMovies();
  if (completed) suggestSagaAfterViewing(id);
}

function addPersonalReview(id, trigger) {
  const movie = movies.find(m => m.id === id);
  if (!movie || (currentUser !== 'N' && currentUser !== 'V')) return;

  openReviewFor(id, currentUser, trigger);
}

async function confirmReview() {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return Promise.resolve({outcome:'INVALID_INPUT'});
  const id = document.getElementById('reviewMovieId').value;
  const text = document.getElementById('reviewText').value.trim();
  const by = document.getElementById('reviewBy').value;
  const location = document.getElementById('reviewLocation').value.trim().slice(0, 120);
  const snack = document.getElementById('reviewSnack').value.trim();
  const reviewNightId = document.getElementById('reviewNightId').value;
  const rawRating = document.getElementById('reviewRating').value;
  const rating = parseMovieRating(rawRating);
  const error = document.getElementById('reviewError');
  const saveButton = document.getElementById('reviewSaveButton');
  error.classList.add('hidden');
  if (by === 'both' && snack.length > 80) {
    error.textContent = 'Lo snack può avere al massimo 80 caratteri.';
    error.classList.remove('hidden');
    document.getElementById('reviewSnack').focus();
    return;
  }
  if (rating === null && !(by === currentUser && (by === 'N' || by === 'V') && !rawRating.trim())) {
    error.textContent = 'Scegli un voto da 0 a 10, con al massimo un decimale (es. 8,3).';
    error.classList.remove('hidden');
    document.getElementById('reviewRating').focus();
    return;
  }
  const movie = movies.find(m => m.id === id);
  if (!movie || saveButton.disabled) return;
  const submittedDraft = personalReviewDraft, operationEpoch = authEpoch;
  const newTogetherViewing = by === 'both' && !viewingState(movie).together;
  saveButton.disabled = true;
  if (by !== 'both') { syncDraftPersonalJudgment('reviewRating', true); document.getElementById('reviewText').disabled = true; document.getElementById('reviewModal').setAttribute?.('aria-busy','true'); }
  let saved = false;
  if (by === 'both') {
    if (!viewingState(movie).together) {
      saved = await completeNight(id, location || null, reviewNightId || undefined, { sharedRating: rating, sharedText: text, snack: snack || null });
      // Complete conserva i dettagli dell'evento attivo; edit salva lo snack
      // senza cambiare il lifecycle, anche dopo la prima conclusione.
      if (saved) {
        const night = reviewNightId ? movieNights.find(n => String(n.id) === reviewNightId && n.movie_id === id && n.status === 'completed') : completedNightsForMovie(id)[0];
        if (night && (night.snack || '') !== snack) saved = await updateMovieNight(night.id, { snack: snack || null });
      }
    } else {
      const reviewChanged = rating !== togetherRating(movie) || document.getElementById('reviewText').value !== reviewTextFor(movie, 'both');
      saved = !reviewChanged || await updateMovie(id, { review_text_together: text, seen_rating_together: rating });
      if (saved && reviewNightId) {
        const night = movieNights.find(n => String(n.id) === reviewNightId && n.movie_id === id && n.status === 'completed');
        if (night) {
          const patch = {};
          if ((night.location || '') !== location) patch.location = location || null;
          if ((night.snack || '') !== snack) patch.snack = snack || null;
          if (Object.keys(patch).length) saved = await updateMovieNight(night.id, patch);
        } else saved = false;
      }
    }
  } else if ((by === 'N' || by === 'V') && by === currentUser) {
    const draft = personalReviewDraft;
    if (draft && (draft.id !== id || draft.by !== by || draft.epoch !== authEpoch)) {
      saved = false;
    } else {
      const ratingOperation = draft ? draft.ratingTouched || rating !== draft.initialRating : rating !== personalRating(movie, by);
      const reviewOperation = draft ? draft.reviewTouched || text !== draft.initialText : text !== reviewTextFor(movie, by).trim();
      saved = await withPersonalJudgmentWrite(id, () => ratingOperation ? savePersonalReview(id, rating, reviewOperation ? text : undefined)
        : draft?.preferenceTouched ? updateMovie(id, { ...draftPreferencePatch(draft, movie), ...(reviewOperation ? { ['review_text_'+by.toLowerCase()]:text } : {}) })
        : reviewOperation ? savePersonalReviewText(id, text) : true);
    }
  }
  if (by !== 'both' && (operationEpoch !== authEpoch || !isAppAuthorized())) return;
  if (by !== 'both' && submittedDraft !== personalReviewDraft) { if (saved) await loadMovies(); return; }
  saveButton.disabled = false;
  if (by !== 'both') { syncDraftPersonalJudgment('reviewRating'); document.getElementById('reviewText').disabled=false; document.getElementById('reviewModal').setAttribute?.('aria-busy','false'); }
  if (!saved) {
    const message = movieMutationErrorMessage();
    if (by !== 'both' && dbMode === 'supabase') { await loadMovies(); syncReviewEditor(); }
    error.textContent = message || 'Non siamo riusciti a salvare la recensione. Riprova.';
    error.classList.remove('hidden');
    return;
  }
  await loadMovies();
  if (operationEpoch !== authEpoch || !isAppAuthorized()) return;
  closeModal('reviewModal');
  if (newTogetherViewing) suggestSagaAfterViewing(id);
}

async function markSeenUI(id) {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return Promise.resolve(Object.freeze({outcome:'INVALID_INPUT',code:'OBSERVED_SHELL_ACTION_REQUIRED'}));
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
  seenRatingDraft = { id, person: currentUser, epoch: authEpoch, initialRating: score, initialText: reviewTextFor(movie, currentUser).trim(), ratingTouched: false };
  bindPersonalJudgment('seenRating', seenRatingDraft, movie);
  document.getElementById('seenSaveButton').disabled = false;
  document.getElementById('seenReview').value = reviewTextFor(movie, currentUser);
  document.getElementById('seenRatingError').classList.add('hidden');
  openModal('seenModal');
}

async function confirmSeen() {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return Promise.resolve({outcome:'INVALID_INPUT'});
  const saveButton = document.getElementById('seenSaveButton');
  if (saveButton.disabled) return;
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
  const draft = seenRatingDraft;
  if (draft && (draft.id !== id || draft.person !== currentUser || draft.epoch !== authEpoch)) return;
  const ratingOperation = (rating !== null && (draft ? draft.ratingTouched || rating !== draft.initialRating : rating !== personalRating(movie, currentUser))) || (draft?.initialRating !== null && draft?.initialRating !== undefined && draft.ratingTouched && !raw.trim());
  const reviewOperation = reviewText !== (draft ? draft.initialText : reviewTextFor(movie, currentUser).trim());
  saveButton.disabled = true;
  syncDraftPersonalJudgment('seenRating', true);
  let saved;
  try {
    saved = await withPersonalJudgmentWrite(id, () => draft?.preferenceTouched && !ratingOperation
      ? updateMovie(id, { ['seen_'+currentUser.toLowerCase()]:true, ...draftPreferencePatch(draft,movie), ...(reviewOperation ? { ['review_text_'+currentUser.toLowerCase()]:reviewText } : {}) })
      : ratingOperation && rating === null ? updateMovie(id, { ['seen_'+currentUser.toLowerCase()]:true, ['seen_rating_'+currentUser.toLowerCase()]:null, ...(reviewOperation ? { ['review_text_'+currentUser.toLowerCase()]:reviewText } : {}) })
      : markMovieSeen(id, currentUser, ratingOperation ? rating : null, reviewOperation ? reviewText : null));
  } catch (_) { saved = false; }
  finally { saveButton.disabled = false; syncDraftPersonalJudgment('seenRating'); }
  if (!isAppAuthorized() || (draft && draft.epoch !== authEpoch)) return;
  if (draft && draft !== seenRatingDraft) { if (saved) await loadMovies(); return; }
  if (!saved) {
    error.textContent = movieMutationErrorMessage() || 'Giudizio non salvato. Controlla la connessione e riprova.';
    if (dbMode === 'supabase') await loadMovies();
    syncDraftPersonalJudgment('seenRating');
    error.classList.remove('hidden');
    return;
  }
  seenRatingDraft = null;
  closeModal('seenModal');
  await loadMovies();
  if (newViewing) suggestSagaAfterViewing(id);
}

async function undoSeenUI(id) {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return Promise.resolve(Object.freeze({outcome:'INVALID_INPUT',code:'OBSERVED_SHELL_ACTION_REQUIRED'}));
  requireAppIdentity();
  const epoch = authEpoch;
  if (!document.getElementById('detailModal').classList.contains('hidden')) closeModalNow('detailModal');
  const confirmed = await showConfirmModal('Segna come non visto', 'Vuoi segnare questo film come non visto da te? Il tuo voto e la tua recensione resteranno conservati.');
  if (!confirmed || !isAppAuthorized() || epoch !== authEpoch) return;
  const undone = await undoMovieSeen(id, currentUser);
  if (undone) await loadMovies();
}

async function removePersonalRating(id) {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return Promise.resolve(Object.freeze({outcome:'INVALID_INPUT',code:'OBSERVED_SHELL_ACTION_REQUIRED'}));
  requireAppIdentity();
  const epoch = authEpoch;
  if (!document.getElementById('detailModal').classList.contains('hidden')) closeModalNow('detailModal');
  if (!(await showConfirmModal('Rimuovere il tuo voto?', 'Lo stato visto del film e la recensione resteranno invariati.'))) return;
  if (!isAppAuthorized() || epoch !== authEpoch) return;
  if (await removeEvaluationData(id, currentUser, 'rating')) await loadMovies();
  else showActionError('Non siamo riusciti a rimuovere il voto.');
}
async function removePersonalText(id) {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return Promise.resolve(Object.freeze({outcome:'INVALID_INPUT',code:'OBSERVED_SHELL_ACTION_REQUIRED'}));
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
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return Promise.resolve(Object.freeze({outcome:'INVALID_INPUT',code:'OBSERVED_SHELL_ACTION_REQUIRED'}));
  requireAppIdentity();
  const movie = movies.find(m => m.id === id);
  if (!movie || !['rating', 'text', 'both'].includes(part)
      || !['N', 'V'].includes(currentUser) || (by !== currentUser && by !== 'both')
      || (by === 'both' && !togetherSeen(movie))
      || (movie.surprise_by && movie.surprise_by !== currentUser)) return false;
  if (by !== 'both') return part === 'text' ? savePersonalReviewText(id, '')
    : savePersonalReview(id, null, part === 'rating' ? undefined : '');
  return updateMovie(id, {
    ...(part !== 'text' ? { seen_rating_together: null } : {}),
    ...(part !== 'rating' ? { review_text_together: '' } : {})
  });
}

async function removeEvaluationUI(id, by) {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return TargetShell.edit(by==='both'?'setGroupEvaluation':'setMyEvaluation',id);
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

// One complete editor; the lock is retained independently of modal lifecycle.
const personalPreferencePending = new Set();
let judgmentReturnFocus = null;
function reviewEditorClosed() {
  const target = judgmentReturnFocus;
  judgmentReturnFocus = null;
  personalReviewDraft = null;
  if (!target || target.epoch !== authEpoch || target.person !== currentUser || !isAppAuthorized()) return;
  const replacement = [...document.querySelectorAll('[data-judgment-movie]')].find(el =>
    el.dataset.judgmentMovie === target.id && el.dataset.judgmentContext === target.by && el.getClientRects().length && !el.closest('[inert]'));
  const fallback = document.getElementById('libraryBack');
  const focus = target.trigger?.isConnected && target.trigger.getClientRects().length && !target.trigger.closest('[inert]') ? target.trigger
    : replacement || (fallback?.getClientRects().length && !fallback.closest('[inert]') ? fallback : null);
  focus?.focus({preventScroll:true});
}
function syncReviewEditor() {
  const draft = personalReviewDraft;
  if (!draft || document.getElementById('reviewModal').classList.contains('hidden')) return;
  if (!isAppAuthorized() || draft.epoch !== authEpoch || (draft.by !== 'both' && draft.by !== currentUser)) { closeModal('reviewModal'); return; }
  if (draft.by === 'both') return;
  const movie = movies.find(m=>m.id===draft.id);
  if (!movie) { closeModal('reviewModal'); return; }
  if (!draft.ratingTouched) { draft.initialRating = personalRating(movie,currentUser); document.getElementById('reviewRating').value = formatMovieRating(draft.initialRating); }
  if (!draft.preferenceTouched && !draft.ratingTouched) draft.preference = personalPreference(movie,currentUser);
  if (!draft.reviewTouched) { draft.initialText = reviewTextFor(movie,currentUser).trim(); document.getElementById('reviewText').value = draft.initialText; }
  const pending = personalPreferencePending.has(currentUser+':'+draft.id);
  syncDraftPersonalJudgment('reviewRating',pending);
  document.getElementById('reviewSaveButton').disabled = pending;
  document.getElementById('reviewText').disabled = pending;
  document.getElementById('reviewModal').setAttribute?.('aria-busy',String(pending));
}

// Shared draft grammar for Seen/Add/candidacy/personal review. No persistence here.
const personalJudgmentDrafts = new Map();
function bindPersonalJudgment(inputId, draft, movie = null, context = null) {
  draft.presentation = context;
  const input = document.getElementById(inputId), host = document.getElementById(inputId + 'Judgment');
  draft.movieId = movie?.id || draft.id;
  draft.preference = (context ? context.personalRating(movie, context.callerLabel) : personalRating(movie || {}, currentUser)) === null ? (context ? context.personalPreference(movie, context.callerLabel) : personalPreference(movie, currentUser)) : null;
  draft.preferenceTouched = false;
  personalJudgmentDrafts.set(inputId, draft);
  host.classList.remove('hidden');
  host.classList.add('personal-judgment-form');
  host.classList.toggle('auth-person-v', (context ? context.callerLabel : currentUser) === 'V');
  host.innerHTML = `<p id="${inputId}JudgmentLabel">Il tuo giudizio (facoltativo)</p><div class="personal-preference-options">
    <button type="button" id="${inputId}Like" aria-pressed="false" onclick="chooseDraftPersonalPreference('${inputId}', true)"><i class="fa-solid fa-thumbs-up" aria-hidden="true"></i> Mi è piaciuto</button>
    <button type="button" id="${inputId}Dislike" aria-pressed="false" onclick="chooseDraftPersonalPreference('${inputId}', false)"><i class="fa-solid fa-thumbs-down" aria-hidden="true"></i> Non mi è piaciuto</button></div><p id="${inputId}JudgmentHelp">Oppure, un voto da 0 a 10.</p>`;
  input.oninput = () => { draft.ratingTouched = true; if (parseMovieRating(input.value) !== null) { draft.preference = null; draft.preferenceTouched = false; } syncDraftPersonalJudgment(inputId); };
  syncDraftPersonalJudgment(inputId);
}
function syncDraftPersonalJudgment(inputId, pending = false) {
  const draft = personalJudgmentDrafts.get(inputId);
  if (!draft) return;
  const context = draft.presentation;
  pending = pending || (!context && personalPreferencePending.has(currentUser+':'+draft.movieId));
  const latest=context ? context.getMovie(draft.movieId) : movies.find(m=>m.id===draft.movieId);
  const input = document.getElementById(inputId), persisted = (draft.initialRating !== null && draft.initialRating !== undefined) || (latest && (context ? context.personalRating(latest,context.callerLabel) : personalRating(latest,currentUser))!==null);
  const hasDraftRating = parseMovieRating(input.value) !== null;
  for (const [suffix,value] of [['Like',true],['Dislike',false]]) {
    const button = document.getElementById(inputId+suffix);
    button.disabled = pending || persisted;
    button.setAttribute?.('aria-pressed', String(!hasDraftRating && draft.preference === value));
  }
  input.disabled = pending;
  document.getElementById(inputId+'JudgmentLabel').textContent = draft.judgmentRequired ? 'Il tuo giudizio' : 'Il tuo giudizio (facoltativo)';
  document.getElementById(inputId+'JudgmentHelp').textContent = persisted
    ? 'Per usare il giudizio rapido, rimuovi prima il voto e salva. La recensione resta indipendente.'
    : hasDraftRating ? 'Il voto è il tuo giudizio. Il feedback rapido non verrà salvato.' : 'Oppure, un voto da 0 a 10. Premi di nuovo la scelta per rimuoverla.';
}
function chooseDraftPersonalPreference(inputId, value) {
  const draft = personalJudgmentDrafts.get(inputId);
  const input = document.getElementById(inputId);
  if (!draft || (draft.presentation && !draft.presentation.current()) || input.disabled || (draft.initialRating !== null && draft.initialRating !== undefined)) return;
  draft.preference = draft.preference === value ? null : value;
  draft.preferenceTouched = true;
  draft.ratingTouched = false; // Final preference intent must not send UPDATE OF rating NULL.
  input.value = '';
  syncDraftPersonalJudgment(inputId);
}
function draftPreferencePatch(draft) {
  if (!draft?.preferenceTouched) return {};
  // An explicit preference remains online-only, even when combined with Seen/review/candidacy.
  return { ['personal_liked_'+currentUser.toLowerCase()]: draft.preference };
}
// All personal form writes share the movie/person lock; existing store APIs stay authoritative.
async function withPersonalJudgmentWrite(id, operation) {
  const key=currentUser+':'+id;
  if(personalPreferencePending.has(key)) return false;
  personalPreferencePending.add(key);
  try { return await operation(); }
  catch (_) { return false; }
  finally { personalPreferencePending.delete(key); }
}
