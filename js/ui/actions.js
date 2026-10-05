// ============================================
// UI — azioni sui film: aggiunta, picker, import, serate,
// recensioni, sorpresa, voto, veto, correzione titolo
// ============================================

// Apre il modale "Aggiungi film" precompilando "Proposto da" con l'utente loggato
function openAddModal() {
  if (currentUser) document.getElementById('addBy').value = currentUser;
  document.getElementById('addCinemaWatchlist').checked = false;
  openModal('addModal');
}

// ---- Aggiunta singola con scelta tra i risultati TMDb ----
let pendingAddedBy = null; // 'N' o 'V', tenuto in memoria durante il picker
let pendingCinemaWatchlist = false; // scelta conservata durante la ricerca/picker TMDb
let pickerMode = 'add';    // 'add' = nuovo film, 'retry' = correggi film esistente
let pickerTargetId = null; // id del film da aggiornare, solo in modalità 'retry'

function showDuplicateNotice(movie) {
  if (!movie) {
    document.getElementById('duplicateMessage').textContent = 'Questo film è già presente nella lista. Non serve aggiungerlo di nuovo.';
    openModal('duplicateModal');
    return;
  }
  const hidden = movie.surprise_by && movie.surprise_by !== currentUser;
  document.getElementById('duplicateMessage').textContent = hidden
    ? 'Questo film è già presente nella lista come sorpresa.'
    : `“${movie.title}” è già presente nella lista. Non serve aggiungerlo di nuovo.`;
  openModal('duplicateModal');
}

async function initiateAddMovie() {
  const title = document.getElementById('addTitle').value.trim();
  const added_by = document.getElementById('addBy').value;
  if (!title) return;

  pendingAddedBy = added_by;
  pendingCinemaWatchlist = document.getElementById('addCinemaWatchlist').checked;
  pickerMode = 'add';

  const searchBtn = document.getElementById('addSaveBtn');
  searchBtn.disabled = true; searchBtn.textContent = 'Cerco…';
  await runTmdbSearchAndOpenPicker(title);
  searchBtn.disabled = false; searchBtn.textContent = 'Cerca';
  closeModal('addModal');
}

// Condivisa tra "Aggiungi film" e "Correggi titolo": lancia la ricerca
// e apre il picker, o salva direttamente se non ci sono candidati.
async function runTmdbSearchAndOpenPicker(title) {
  const candidates = await searchTmdbCandidates(title);

  if (candidates.length === 0) {
    const details = await fetchMovieDetails(title);
    await applyResolvedDetails(details);
    return;
  }

  document.getElementById('pickerResults').innerHTML = candidates.map(c => `
    <button onclick="selectPickerCandidate(${c.id})" class="glass-card rounded-lg overflow-hidden border border-slate-800 hover:border-indigo-500 transition text-left">
      <div class="h-40 bg-slate-900">
        ${c.poster ? `<img src="${c.poster}" alt="${escapeHtml(c.title)}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-slate-400 text-xs">Nessun poster</div>`}
      </div>
      <div class="p-2">
        <div class="text-xs font-semibold text-slate-100 leading-snug">${escapeHtml(c.title)}</div>
        <div class="text-[10px] text-slate-400">${escapeHtml(c.year)}</div>
        ${findDuplicateByTmdbId(c.id, pickerMode === 'retry' ? pickerTargetId : null) ? '<div class="text-[10px] font-bold text-amber-300 mt-1">Già in lista</div>' : ''}
      </div>
    </button>
  `).join('');
  document.getElementById('pickerNoneBtn').onclick = async () => {
    closeModal('pickerModal');
    const details = await fetchMovieDetails(title);
    await applyResolvedDetails(details);
  };
  openModal('pickerModal');
}

async function selectPickerCandidate(tmdbId) {
  closeModal('pickerModal');
  const details = await fetchTmdbDetailsById(tmdbId);
  await applyResolvedDetails(details);
}

// Applica i dettagli risolti: inserisce un nuovo film (modalità 'add')
// o aggiorna un film esistente (modalità 'retry', da "correggi titolo").
async function applyResolvedDetails(details) {
  const duplicate = findDuplicateByTmdbId(details.tmdb_id, pickerMode === 'retry' ? pickerTargetId : null);
  if (duplicate) {
    showDuplicateNotice(duplicate);
    return false;
  }
  const ratingFields = {
    imdb_rating: details.imdbRating || '', rt_rating: details.rtRating || '', metacritic_rating: details.metacriticRating || ''
  };
  const tmdbFields = {
    tmdb_id: details.tmdb_id ?? null, collection_id: details.collection_id ?? null, collection_name: details.collection_name || null
  };
  const genreFields = {
    genres: details.genres || []
  };
  // Step 5b — anno + regista per i film nuovi (valore o null).
  const metaFields = {
    release_year: details.release_year ?? null,
    director: details.director || null
  };
  // Step 7 — overview + cast (trama it-IT e primi 8 nomi del cast) per il detail film.
  const detailFields = {
    overview: details.overview || null,
    cast_names: details.cast_names || null
  };
  if (pickerMode === 'retry') {
    const patch = {
      title: details.title, duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl, matched: details.matched,
      ...genreFields, ...tmdbFields, ...ratingFields
    };
    // Step 5b: anno/regista aggiornati SOLO se il nuovo valore è non-null:
    // mai sovrascrivere un dato esistente con null.
    if (details.release_year != null) patch.release_year = details.release_year;
    if (details.director) patch.director = details.director;
    // Step 7: stessa regola — overview/cast scritti SOLO se non-null
    // (in retry la sorgente è TMDb, quindi raramente null; comunque mai
    // sovrascrivere un dato esistente con null).
    if (details.overview) patch.overview = details.overview;
    if (details.cast_names && details.cast_names.length) patch.cast_names = details.cast_names;
    await updateMovie(pickerTargetId, patch);
  } else {
    const newMovie = {
      title: details.title, added_by: pendingAddedBy, status: 'watchlist',
      ...(pendingCinemaWatchlist ? { cinema_watchlist: true } : {}),
      duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl,
      matched: details.matched, rating: 0,
      ...genreFields, ...tmdbFields, ...ratingFields, ...metaFields, ...detailFields
    };
    const inserted = await insertMovie(newMovie);
    if (inserted === false) {
      document.getElementById('addErrorMessage').textContent = 'Il film non è stato salvato: la lista cinema non è ancora disponibile sul database condiviso. Riprova più tardi.';
      openModal('addErrorModal');
      return false;
    }
    if (!inserted) {
      await loadMovies();
      showDuplicateNotice(findDuplicateByTmdbId(details.tmdb_id));
      return false;
    }
    document.getElementById('addTitle').value = '';
  }
  loadMovies();
  return true;
}

// ---- Import massivo con contatore di progresso ----
async function bulkImportMovies() {
  const text = document.getElementById('importText').value.trim();
  const added_by = document.getElementById('importAddedBy').value;
  if (!text) return;

  const titles = text.split('\n').map(t => t.trim()).filter(Boolean);
  const progressEl = document.getElementById('importProgress');
  const btn = document.getElementById('importSaveBtn');
  btn.disabled = true;
  const skippedTitles = [];
  const unmatchedTitles = [];

  for (let i = 0; i < titles.length; i++) {
    const clean = titles[i].replace(/^[\d.\-*\s]+/, '').trim();
    progressEl.innerHTML = `Importo ${i + 1}/${titles.length}: ${escapeHtml(clean)}`;
    progressEl.classList.remove('hidden');

    const details = await fetchMovieDetails(clean);
    if (findDuplicateByTmdbId(details.tmdb_id)) { skippedTitles.push(clean); continue; }
    const newMovie = {
      title: details.title, added_by, status: 'watchlist',
      duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl,
      matched: details.matched, rating: 0,
      genres: details.genres || [],
      tmdb_id: details.tmdb_id ?? null, collection_id: details.collection_id ?? null, collection_name: details.collection_name || null,
      release_year: details.release_year ?? null, director: details.director || null,
      overview: details.overview || null, cast_names: details.cast_names || null,
      imdb_rating: details.imdbRating || '', rt_rating: details.rtRating || '', metacritic_rating: details.metacriticRating || ''
    };
    const inserted = await insertMovie(newMovie);
    if (!inserted) {
      skippedTitles.push(clean);
      await loadMovies();
      continue;
    }
    // insertMovie aggiorna già movies localmente (con id) per il controllo duplicati nel loop
    if (!details.matched) unmatchedTitles.push(clean);
  }

  // Report finale leggibile invece di un contatore secco: qui vedi
  // esattamente cosa è stato saltato e cosa va controllato a mano.
  let summary = `Fatto: ${titles.length - skippedTitles.length} importati.`;
  if (skippedTitles.length) summary += `<br>Già presenti (saltati): ${escapeHtml(skippedTitles.join(', '))}`;
  if (unmatchedTitles.length) summary += `<br>⚠️ Da verificare (nessun riscontro trovato): ${escapeHtml(unmatchedTitles.join(', '))}`;
  progressEl.innerHTML = summary;
  btn.disabled = false;
  setTimeout(() => {
    closeModal('importModal');
    document.getElementById('importText').value = '';
    progressEl.classList.add('hidden');
    loadMovies();
  }, unmatchedTitles.length || skippedTitles.length ? 3500 : 900);
}

async function updateStatus(id, newStatus) {
  await updateMovie(id, { status: newStatus });
  loadMovies();
}

async function toggleCinemaWatchlist(id) {
  const movie = movies.find(m => m.id === id);
  if (!movie) return;
  if (await updateMovie(id, { cinema_watchlist: !movie.cinema_watchlist })) await loadMovies();
}

async function deleteMovieConfirm(id, title) {
  const ok = await showConfirmModal('Rimuovere il film?', `"${title}" verrà eliminato definitivamente.`);
  if (!ok) return;
  await deleteMovie(id);
  loadMovies();
}

// ---- Modale programmazione (sostituisce prompt()) ----
function scheduleMovie(id) {
  document.getElementById('scheduleMovieId').value = id;
  document.getElementById('scheduleDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('scheduleTime').value = '21:30';
  document.getElementById('scheduleCustomSnack').value = '';
  document.getElementById('scheduleSnackError').classList.add('hidden');
  syncSnackOptions();
  randomizeSnack();
  openModal('scheduleModal');
}

const SNACKS = ['🍿 Popcorn dolce', '🍿 Popcorn salato', '🍫 Cioccolato', '🍕 Pizza', '🍦 Gelato', '🍟 Patatine'];
const CUSTOM_SNACK = '__custom_snack__';

// Gli snack già usati sono condivisi attraverso movie_nights (e il mirror
// legacy movies.snack), senza aggiungere una tabella o uno storage separato.
function snackChoices() {
  const seen = new Set();
  return [...SNACKS, ...movieNights.map(n => n.snack), ...movies.map(m => m.snack)]
    .filter(value => typeof value === 'string' && value.trim() && value.trim() !== CUSTOM_SNACK)
    .map(value => value.trim())
    .filter(value => {
      const key = value.toLocaleLowerCase('it');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function syncSnackOptions() {
  const select = document.getElementById('scheduleSnack');
  const selected = select.value;
  select.innerHTML = snackChoices().map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')
    + `<option value="${CUSTOM_SNACK}">＋ Aggiungi uno snack…</option>`;
  if (selected === CUSTOM_SNACK || snackChoices().includes(selected)) select.value = selected;
  toggleCustomSnack(false);
}

function toggleCustomSnack(shouldFocus = true) {
  const custom = document.getElementById('scheduleSnack').value === CUSTOM_SNACK;
  const input = document.getElementById('scheduleCustomSnack');
  input.classList.toggle('hidden', !custom);
  document.getElementById('scheduleSnackError').classList.add('hidden');
  if (custom && shouldFocus) input.focus();
}

function randomizeSnack() {
  const choices = snackChoices();
  document.getElementById('scheduleSnack').value = choices[Math.floor(Math.random() * choices.length)];
  toggleCustomSnack(false);
}

// Propone (non fissa direttamente) una sera precisa per il film: l'altra
// persona deve confermare dal box "Prossimo Film", anche a distanza.
async function confirmSchedule() {
  const id = document.getElementById('scheduleMovieId').value;
  const date = document.getElementById('scheduleDate').value;
  const time = document.getElementById('scheduleTime').value;
  if (!date) return;
  const selectedSnack = document.getElementById('scheduleSnack').value;
  const snack = selectedSnack === CUSTOM_SNACK
    ? document.getElementById('scheduleCustomSnack').value.trim()
    : selectedSnack;
  if (selectedSnack === CUSTOM_SNACK && (!snack || snack.length > 80)) {
    const error = document.getElementById('scheduleSnackError');
    error.textContent = snack ? 'Lo snack può avere al massimo 80 caratteri.' : 'Scrivi uno snack prima di confermare.';
    error.classList.remove('hidden');
    return;
  }
  // Match → serata: l'hook scatta solo se si viene dal tab Match con pending
  // attivo per QUESTO film. Il pending va letto PRIMA di closeModal (che lo
  // azzera sempre, anche su annullo), e la sessione si chiude solo se la
  // serata È stata davvero creata (controllo a posteriori, mai all'apertura).
  const pending = typeof matchPendingSchedule !== 'undefined' ? matchPendingSchedule : null;
  const fromMatch = !!(pending && pending.movieId === id && currentTab === 'match');
  // Step4 phase18 — origine "Programma": se il winner della ruota ha messo
  // wheelScheduleFor = id (phase15) è un pick dalla Ruota, altrimenti è una
  // proposta diretta dalla card. Flags in-memory (ticketOrigin), MAI persistiti.
  const fromWheel = typeof wheelScheduleFor !== 'undefined' && wheelScheduleFor === id;
  await proposeNight(id, currentUser, date, time, snack);
  closeModal('scheduleModal');
  // Step4 phase15 — ruota programmabile: "Programma" dal vincitore chiude il
  // box ruota al confirm. Guard sul classList: se il box è già nascosto
  // (flusso normale da card/modale) non succede nulla, nessun effetto.
  const wheelBox = document.getElementById('wheelWinner');
  if (wheelBox && !wheelBox.classList.contains('hidden')) wheelBox.classList.add('hidden');
  if (!fromMatch && typeof markTicketOrigin === 'function') {
    if (fromWheel) wheelScheduleFor = null;
    markTicketOrigin(id, fromWheel ? 'wheel' : 'manual');
  }
  if (fromMatch && activeNightForMovie(id)) {
    await closeSession(pending.sessionId);
    if (typeof matchNightDone === 'function') matchNightDone(id);
    if (typeof markTicketOrigin === 'function') markTicketOrigin(id, 'match');
  }
  loadMovies();
}

// ---- Box "Prossimo Film" — pick veloce, conferma o annullo proposta ----
// (lockWheelWinner rimosso in Phase 15: dead code, lo stesso flusso è coperto
// da quickTonightUI + closeWheelWinner per "Stasera" e dal confirm di
// scheduleMovie per "Programma".)
async function confirmNightUI(id) {
  await confirmNight(id);
  loadMovies();
}

async function cancelNightUI(id, title) {
  const ok = await showConfirmModal('Annullare la serata?', `"${title}" tornerà semplicemente in watchlist.`);
  if (!ok) return;
  await cancelNight(id);
  loadMovies();
}

// "Stasera" — pick veloce senza data. origin: 'manual' (default, dalla card)
// o 'wheel' (winner della ruota, phase18): decide se il ticket mostrerà
// "Proposto da N/V" o "Scelto con la Ruota".
async function quickTonightUI(id, origin) {
  await setQuickTonight(id);
  if (typeof markTicketOrigin === 'function') markTicketOrigin(id, origin || 'manual');
  loadMovies();
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
  document.getElementById('reviewTextOptional').classList.toggle('hidden', by !== 'both');
  document.getElementById('reviewModalTitle').textContent = by === 'both'
    ? (hasReview ? 'Modifica voto o recensione insieme' : 'Voto e recensione insieme')
    : (existingText ? 'Modifica la tua recensione' : 'La tua recensione');
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
  document.getElementById('reviewRating').value = existingScore === null ? '' : String(existingScore);
  document.getElementById('reviewRatingLabel').textContent = by === 'both' ? 'Il vostro voto ★' : 'Il tuo voto ★';
  document.getElementById('reviewHelp').textContent = by === 'both'
    ? (hasReview
      ? 'Le modifiche non cambiano la data della serata registrata nello storico.'
      : 'Il voto è condiviso, il testo è facoltativo. Se c’è una serata attiva, verrà segnata come conclusa.')
    : 'Puoi aggiornare il tuo voto e la tua recensione senza cambiare quelli dell’altra persona.';
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
  await completeNight(id);
  await loadMovies();
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
  const rating = Number(rawRating);
  const error = document.getElementById('reviewError');
  const saveButton = document.getElementById('reviewSaveButton');
  error.classList.add('hidden');
  if (rawRating === '' || !Number.isInteger(rating) || rating < 0 || rating > 10) {
    error.textContent = 'Scegli un voto da 0 a 10.';
    error.classList.remove('hidden');
    document.getElementById('reviewRating').focus();
    return;
  }
  if (!text && by !== 'both') {
    error.textContent = 'Scrivi la recensione prima di salvarla.';
    error.classList.remove('hidden');
    document.getElementById('reviewText').focus();
    return;
  }
  const movie = movies.find(m => m.id === id);
  if (!movie || saveButton.disabled) return;
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
}

// ---- Modalità sorpresa ----
function openSurprisePicker() {
  const list = movies.filter(m => m.status === 'watchlist' && !m.surprise_by);
  const container = document.getElementById('surpriseList');
  if (list.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 italic">Nessun film disponibile da scegliere a sorpresa.</p>`;
  } else {
    container.innerHTML = list.map(m => `
      <button onclick="pickSurprise('${m.id}')" class="w-full text-left p-3 bg-slate-900/80 rounded-lg border border-slate-800 hover:border-indigo-500 transition text-sm text-slate-200">
        ${escapeHtml(m.title)}
      </button>
    `).join('');
  }
  openModal('surpriseModal');
}

async function pickSurprise(id) {
  await setSurprise(id, currentUser);
  closeModal('surpriseModal');
  loadMovies();
}

async function revealSurpriseUI(id) {
  await revealSurprise(id);
  loadMovies();
}

function markSeenUI(id) {
  const movie = movies.find(m => m.id === id);
  if (!movie || (currentUser !== 'N' && currentUser !== 'V')) return;
  document.getElementById('seenMovieId').value = id;
  const score = personalRating(movie, currentUser);
  document.getElementById('seenRating').value = score === null ? '' : String(score);
  document.getElementById('seenReview').value = reviewTextFor(movie, currentUser);
  document.getElementById('seenRatingError').classList.add('hidden');
  openModal('seenModal');
}

async function confirmSeen() {
  const id = document.getElementById('seenMovieId').value;
  const raw = document.getElementById('seenRating').value;
  const rating = Number(raw);
  const error = document.getElementById('seenRatingError');
  if (raw === '' || !Number.isInteger(rating) || rating < 0 || rating > 10) {
    error.textContent = 'Scegli un voto da 0 a 10.';
    error.classList.remove('hidden');
    return;
  }
  const reviewText = document.getElementById('seenReview').value.trim();
  const saved = await markMovieSeen(id, currentUser, rating, reviewText);
  if (!saved) {
    error.textContent = 'Non siamo riusciti a salvare. Riprova.';
    error.classList.remove('hidden');
    return;
  }
  closeModal('seenModal');
  await loadMovies();
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

// ---- Veto settimanale ----
async function vetoMovie(id, title) {
  const ok = await addVeto(currentUser, id);
  if (!ok) {
    await showConfirmModal('Veto già usato', 'Hai già usato il tuo veto per questa settimana.');
    return;
  }
  loadMovies();
}

// Toglie il veto: nessuna conferma (azione reversibile, come il voto).
async function unvetoMovie(id) {
  const v = vetoForMovieThisWeek(id);
  if (!v || v.person !== currentUser) return;
  await removeVeto(currentUser, id); // 0 righe o errore => nothing to do (già rimosso)
  loadMovies();
}

// ---- Correggi titolo non trovato e ricerca di nuovo (TMDb/OMDb) ----
function retryMatch(id, currentTitle) {
  document.getElementById('retryMovieId').value = id;
  document.getElementById('retryTitle').value = currentTitle;
  openModal('retryModal');
}

async function confirmRetryMatch() {
  const id = document.getElementById('retryMovieId').value;
  const newTitle = document.getElementById('retryTitle').value.trim();
  if (!newTitle) return;

  pickerMode = 'retry';
  pickerTargetId = id;

  const btn = document.getElementById('retrySearchBtn');
  btn.disabled = true; btn.textContent = 'Cerco…';
  await runTmdbSearchAndOpenPicker(newTitle);
  btn.disabled = false; btn.textContent = 'Cerca';
  closeModal('retryModal');
}
