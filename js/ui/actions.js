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
  const ok = await showConfirmModal('Rimuovere il film?', `"${title}" verrà eliminato definitivamente.`);
  if (!ok) return;
  await deleteMovie(id);
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
