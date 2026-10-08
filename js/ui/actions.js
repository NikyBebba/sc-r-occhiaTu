// Libreria: aggiunta/picker TMDb, import, stato, cinema, eliminazione e retry.
// Gli altri flussi UI vivono in js/ui/actions/; API globali invariate.

// Apre il modale "Aggiungi film" precompilando "Proposto da" con l'utente loggato
function openAddModal() {
  if (currentUser) document.getElementById('addBy').value = currentUser;
  document.getElementById('addCinemaWatchlist').checked = false;
  openModal('addModal');
}

// ---- Aggiunta singola con scelta tra i risultati TMDb ----
let pendingAddedBy = null; // 'N' o 'V', tenuto in memoria durante il picker
let pendingCinemaWatchlist = false; // scelta conservata durante la ricerca/picker TMDb
let pendingAddSeen = null;
let addSeenSaving = false;
let pendingAddEpoch = null;
let pickerMode = 'add';    // 'add' = nuovo film, 'retry' = correggi film esistente
let pickerTargetId = null; // id del film da aggiornare, solo in modalità 'retry'

function showDuplicateNotice(movie) {
  if (!movie) {
    document.getElementById('duplicateMessage').textContent = 'Questo film è già presente nel catalogo. Non serve aggiungerlo di nuovo.';
    openModal('duplicateModal');
    return;
  }
  const hidden = movie.surprise_by && movie.surprise_by !== currentUser;
  document.getElementById('duplicateMessage').textContent = hidden
    ? 'Questo film è già presente nella lista come sorpresa.'
    : `“${movie.title}” è già presente nel catalogo. Non serve aggiungerlo di nuovo.`;
  openModal('duplicateModal');
}

async function initiateAddMovie() {
  const title = document.getElementById('addTitle').value.trim();
  const added_by = document.getElementById('addBy').value;
  if (!title) return;

  requireAppIdentity();
  pendingAddEpoch = authEpoch;
  pendingAddedBy = currentUser;
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
        ${knownMovieStatusHtml(findDuplicateByTmdbId(c.id, pickerMode === 'retry' ? pickerTargetId : null))}
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
async function applyResolvedDetails(details, personalSeen = null) {
  requireAppIdentity();
  if (pickerMode === 'add' && pendingAddEpoch !== null && pendingAddEpoch !== authEpoch) return false;
  if (pickerMode === 'add' && personalSeen === null) {
    pendingAddSeen = { details, person: currentUser, epoch: authEpoch, addedBy: pendingAddedBy, cinema: pendingCinemaWatchlist };
    const known = findDuplicateByTmdbId(details.tmdb_id);
    document.getElementById('addSeenKnown').innerHTML = knownMovieStatusHtml(known);
    document.getElementById('addSeenDestination').value = 'history';
    document.getElementById('addSeenRating').value = known && personalRating(known, currentUser) !== null ? formatMovieRating(personalRating(known, currentUser)) : '';
    updateAddDestinationHint();
    document.getElementById('addSeenRatingWrap').classList.add('hidden');
    document.getElementById('addSeenError').classList.add('hidden');
    document.getElementById('addSeenSave').classList.add('hidden');
    openModal('addSeenModal');
    return true;
  }
  const duplicate = findDuplicateByTmdbId(details.tmdb_id, pickerMode === 'retry' ? pickerTargetId : null);
  if (duplicate) {
    if (pickerMode === 'add') return saveResolvedExisting(duplicate, personalSeen);
    showDuplicateNotice(duplicate);
    return true;
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
    if (!(await updateMovie(pickerTargetId, patch))) { showActionError('Correzione non salvata. Il film potrebbe contenere dati protetti.'); return false; }
  } else {
    const newMovie = {
      title: details.title, added_by: currentUser, status: 'watchlist',
      in_shared_list: personalSeen?.candidate !== false,
      ...(personalSeen?.seen ? { ['seen_' + currentUser.toLowerCase()]: true } : {}),
      ...(personalSeen?.rating != null ? { ['seen_rating_' + currentUser.toLowerCase()]: personalSeen.rating } : {}),
      ...(pendingCinemaWatchlist ? { cinema_watchlist: true } : {}),
      duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl,
      matched: details.matched,
      ...genreFields, ...tmdbFields, ...ratingFields, ...metaFields, ...detailFields
    };
    const inserted = await insertMovie(newMovie);
    if (inserted === false) {
      document.getElementById('addErrorMessage').textContent = 'Il film non è stato salvato. Riprova quando la connessione è disponibile.';
      openModal('addErrorModal');
      return false;
    }
    if (!inserted) {
      await loadMovies();
      const existing = findDuplicateByTmdbId(details.tmdb_id);
      if (existing) return saveResolvedExisting(existing, personalSeen);
      showDuplicateNotice(existing);
      return !!existing;
    }
    document.getElementById('addTitle').value = '';
  }
  await loadMovies();
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
    const existing = findDuplicateByTmdbId(details.tmdb_id);
    if (existing) {
      if (!existing.in_shared_list && (!existing['seen_' + currentUser.toLowerCase()] || personalRating(existing,currentUser) !== null)) {
        if (await updateMovie(existing.id,{ in_shared_list:true })) await loadMovies();
      }
      skippedTitles.push(clean); continue;
    }
    const newMovie = {
      title: details.title, added_by: currentUser, status: 'watchlist', in_shared_list: true,
      duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl,
      matched: details.matched,
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
      const raced = findDuplicateByTmdbId(details.tmdb_id);
      if (inserted !== false && raced && !raced.in_shared_list
        && (!raced['seen_' + currentUser.toLowerCase()] || personalRating(raced,currentUser) !== null)) {
        if (await updateMovie(raced.id,{in_shared_list:true})) await loadMovies();
      }
      continue;
    }
    // insertMovie aggiorna già movies localmente (con id) per il controllo duplicati nel loop
    if (!details.matched) unmatchedTitles.push(clean);
  }

  // Report finale leggibile invece di un contatore secco: qui vedi
  // esattamente cosa è stato saltato e cosa va controllato a mano.
  let summary = `Fatto: ${titles.length - skippedTitles.length} importati.`;
  if (skippedTitles.length) summary += `<br>Già presenti (se fuori Lista e senza voto personale, candidali dalla card): ${escapeHtml(skippedTitles.join(', '))}`;
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

// API di compatibilità senza chiamanti UI: le proiezioni usano store/nights.
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
  if (!canDeleteOrChangeIdentity(movies.find(m => m.id === id))) { showActionError('Questo film non può essere eliminato: contiene dati dell’altra persona o serate, anche annullate.'); return; }
  const ok = await showConfirmModal('Rimuovere il film?', `"${title}" verrà eliminato definitivamente.`);
  if (!ok) return;
  if (!(await deleteMovie(id))) { showActionError('Questo film non può essere eliminato: contiene dati dell’altra persona, serate o non è più disponibile.'); return; }
  await loadMovies();
}

// ---- Correggi titolo non trovato e ricerca di nuovo (TMDb/OMDb) ----
function retryMatch(id, currentTitle) {
  if (!canDeleteOrChangeIdentity(movies.find(m => m.id === id))) { showActionError('Il titolo non può essere cambiato: contiene dati dell’altra persona o serate.'); return; }
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

function showActionError(message) {
  document.getElementById('addErrorModalTitle').textContent = 'Operazione non riuscita';
  document.getElementById('addErrorMessage').textContent = message;
  openModal('addErrorModal');
}
function chooseAddSeenYes() {
  if (!pendingAddSeen || addSeenSaving) return;
  document.getElementById('addSeenRatingWrap').classList.remove('hidden');
  document.getElementById('addSeenSave').classList.remove('hidden');
  document.getElementById('addSeenRating').focus();
}
async function confirmAddSeen(seen) {
  const pending = pendingAddSeen;
  if (!pending || addSeenSaving) return;
  requireAppIdentity();
  if (pending.person !== currentUser || pending.epoch !== authEpoch) return;
  const candidate = !seen || document.getElementById('addSeenDestination').value === 'list';
  const raw = document.getElementById('addSeenRating').value.trim();
  const known = findDuplicateByTmdbId(pending.details.tmdb_id);
  const rating = seen ? (raw ? parseMovieRating(raw) : null) : (known ? personalRating(known, currentUser) : null);
  const ownSeen = seen || known?.['seen_' + currentUser.toLowerCase()] === true;
  const required = candidate && !known?.in_shared_list && ownSeen;
  const error = document.getElementById('addSeenError');
  if ((seen && raw && rating === null) || (required && rating === null)) {
    error.textContent = required ? 'Per candidare un film che hai già visto serve il tuo voto, da 0 a 10.' : 'Inserisci un voto da 0 a 10, con al massimo un decimale.';
    error.classList.remove('hidden');
    if (!seen) { chooseAddSeenYes(); document.getElementById('addSeenDestination').value = 'list'; updateAddDestinationHint(); }
    return;
  }
  addSeenSaving = true;
  try {
    pickerMode = 'add'; pendingAddedBy = pending.addedBy; pendingCinemaWatchlist = pending.cinema;
    const saved = await applyResolvedDetails(pending.details, { seen, rating, candidate });
    assertAuthEpoch(pending.epoch);
    if (saved) closeModal('addSeenModal');
    else { error.textContent = 'Non siamo riusciti a salvare. Riprova.'; error.classList.remove('hidden'); }
  } finally { addSeenSaving = false; }
}
function updateAddDestinationHint() {
  const known = pendingAddSeen && findDuplicateByTmdbId(pendingAddSeen.details.tmdb_id);
  const list = document.getElementById('addSeenDestination').value === 'list';
  document.getElementById('addSeenHint').textContent = known?.in_shared_list
    ? 'È già in Lista: registri soltanto la tua visione. Il voto è facoltativo.'
    : list ? 'Per aggiungerlo alla Lista serve il tuo voto.' : 'Fuori dalla Lista. Il voto è facoltativo.';
}
async function saveResolvedExisting(movie, personal) {
  const patch = {};
  if (personal?.seen) patch['seen_' + currentUser.toLowerCase()] = true;
  if (personal?.rating != null) patch['seen_rating_' + currentUser.toLowerCase()] = personal.rating;
  if (personal?.candidate !== false) patch.in_shared_list = true;
  if (!Object.keys(patch).length) { showDuplicateNotice(movie); return true; }
  const saved = await updateMovie(movie.id, patch);
  if (saved) await loadMovies();
  return saved;
}
let pendingListCandidate = null;
async function toggleSharedList(id) {
  requireAppIdentity();
  const movie = movies.find(m => m.id === id);
  if (!movie) return false;
  if (!movie.in_shared_list && movie['seen_' + currentUser.toLowerCase()] && personalRating(movie,currentUser) === null) {
    pendingListCandidate = { id, person: currentUser, epoch: authEpoch };
    document.getElementById('listCandidateRating').value = '';
    document.getElementById('listCandidateError').textContent = '';
    closeModal('detailModal');
    openModal('listCandidateModal');
    return false;
  }
  const saved = await updateMovie(id, { in_shared_list: !movie.in_shared_list });
  if (saved) { await loadMovies(); refreshWatchDetail(id); }
  else showActionError('Non siamo riusciti a cambiare la Lista. Riprova.');
  return saved;
}
let listCandidateSaving = false;
async function confirmListCandidate() {
  const pending = pendingListCandidate;
  if (!pending || listCandidateSaving) return;
  requireAppIdentity();
  if (pending.person !== currentUser || pending.epoch !== authEpoch) return;
  const rating = parseMovieRating(document.getElementById('listCandidateRating').value);
  const error = document.getElementById('listCandidateError');
  if (rating === null) { error.textContent = 'Serve un voto da 0 a 10, con al massimo un decimale.'; return; }
  listCandidateSaving = true;
  try {
    const saved = await updateMovie(pending.id, { in_shared_list: true, ['seen_rating_' + currentUser.toLowerCase()]: rating });
    assertAuthEpoch(pending.epoch);
    if (!saved) { error.textContent = 'Candidatura non salvata. Riprova.'; return; }
    await loadMovies();
    assertAuthEpoch(pending.epoch);
    pendingListCandidate = null;
    closeModal('listCandidateModal');
  } finally { listCandidateSaving = false; }
}
function refreshWatchDetail(id) {
  const detail = document.getElementById('detailBody');
  if (!document.getElementById('detailModal').classList.contains('hidden') && detail.dataset.movieId === String(id)) {
    const updated = movies.find(m => m.id === id);
    if (updated) renderMovieDetail(updated);
  }
}

function resetWatchForms() {
  pendingListCandidate = null;
  pendingAddSeen = null;
  pendingAddedBy = null;
  pendingAddEpoch = null;
  pendingCinemaWatchlist = false;
  pickerMode = 'add';
  pickerTargetId = null;
  ['seenMovieId','reviewMovieId','reviewNightId','scheduleMovieId','retryMovieId'].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });
}
