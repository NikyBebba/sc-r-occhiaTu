// ============================================
// UI — azioni sui film: aggiunta, picker, import, serate,
// recensioni, sorpresa, voto, veto, correzione titolo
// ============================================

// Apre il modale "Aggiungi film" precompilando "Proposto da" con l'utente loggato
function openAddModal() {
  if (currentUser) document.getElementById('addBy').value = currentUser;
  document.getElementById('addMood').value = '';
  openModal('addModal');
}

// ---- Aggiunta singola con scelta tra i risultati TMDb ----
let pendingAddedBy = null; // 'N' o 'V', tenuto in memoria durante il picker
let pendingGenre = '';     // mood scelto nel modale "Aggiungi", solo modalità 'add'
let pickerMode = 'add';    // 'add' = nuovo film, 'retry' = correggi film esistente
let pickerTargetId = null; // id del film da aggiornare, solo in modalità 'retry'

async function initiateAddMovie() {
  const title = document.getElementById('addTitle').value.trim();
  const added_by = document.getElementById('addBy').value;
  if (!title) return;

  const dup = findDuplicate(title);
  if (dup) {
    const proceed = await showConfirmModal(
      'Film già presente',
      `"${dup.title}" è già in lista (${CONFIG.PEOPLE[dup.added_by]?.label || dup.added_by}). Vuoi aggiungerlo comunque?`
    );
    if (!proceed) return;
  }

  pendingAddedBy = added_by;
  pendingGenre = document.getElementById('addMood').value;
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
    <button onclick="selectPickerCandidate(${c.id})" class="glass rounded-lg overflow-hidden border border-slate-800 hover:border-indigo-500 transition text-left">
      <div class="h-40 bg-slate-900">
        ${c.poster ? `<img src="${c.poster}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-slate-600 text-xs">Nessun poster</div>`}
      </div>
      <div class="p-2">
        <div class="text-xs font-semibold text-slate-100 leading-snug">${escapeHtml(c.title)}</div>
        <div class="text-[10px] text-slate-500">${escapeHtml(c.year)}</div>
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
  if (pickerMode === 'retry') {
    // Correzione metadati: aggiorna i generi, ma PRESERVA un mood impostato
    // a mano (genre già valorizzato); lo ricava solo se era null.
    const current = movies.find(x => x.id === pickerTargetId);
    const genre = current && current.genre != null ? current.genre : (details.genre || null);
    const patch = {
      title: details.title, duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl, matched: details.matched,
      genre,
      ...genreFields, ...tmdbFields, ...ratingFields
    };
    // Step 5b: anno/regista aggiornati SOLO se il nuovo valore è non-null:
    // mai sovrascrivere un dato esistente con null.
    if (details.release_year != null) patch.release_year = details.release_year;
    if (details.director) patch.director = details.director;
    await updateMovie(pickerTargetId, patch);
  } else {
    // Nuovo film: vince il mood scelto a mano nel modale; altrimenti quello
    // derivato dai generi TMDb/OMDb.
    const newMovie = {
      title: details.title, added_by: pendingAddedBy, status: 'watchlist',
      duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl,
      matched: details.matched, rating: 0,
      genre: pendingGenre || details.genre || null,
      ...genreFields, ...tmdbFields, ...ratingFields, ...metaFields
    };
    await insertMovie(newMovie);
    document.getElementById('addTitle').value = '';
    pendingGenre = '';
  }
  loadMovies();
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

    if (findDuplicate(clean)) { skippedTitles.push(clean); continue; }

    const details = await fetchMovieDetails(clean);
    const newMovie = {
      title: details.title, added_by, status: 'watchlist',
      duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl,
      matched: details.matched, rating: 0,
      genres: details.genres || [], genre: details.genre || null,
      tmdb_id: details.tmdb_id ?? null, collection_id: details.collection_id ?? null, collection_name: details.collection_name || null,
      release_year: details.release_year ?? null, director: details.director || null,
      imdb_rating: details.imdbRating || '', rt_rating: details.rtRating || '', metacritic_rating: details.metacriticRating || ''
    };
    await insertMovie(newMovie);
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
  randomizeSnack();
  openModal('scheduleModal');
}

const SNACKS = ['🍿 Popcorn dolce', '🍿 Popcorn salato', '🍫 Cioccolato', '🍕 Pizza', '🍦 Gelato', '🍟 Patatine'];
function randomizeSnack() {
  document.getElementById('scheduleSnack').value = SNACKS[Math.floor(Math.random() * SNACKS.length)];
}

// Propone (non fissa direttamente) una sera precisa per il film: l'altra
// persona deve confermare dal box "Prossimo Film", anche a distanza.
async function confirmSchedule() {
  const id = document.getElementById('scheduleMovieId').value;
  const date = document.getElementById('scheduleDate').value;
  const time = document.getElementById('scheduleTime').value;
  const snack = document.getElementById('scheduleSnack').value;
  if (!date) return;
  await proposeNight(id, currentUser, date, time, snack);
  closeModal('scheduleModal');
  // Match → serata: la proposta È stata creata (controllo a posteriori).
  // Solo ora la sessione di swipe si chiude; se l'utente annulla il modale
  // questa funzione non gira mai e la sessione resta attiva.
  const pending = typeof matchPendingSchedule !== 'undefined' ? matchPendingSchedule : null;
  if (pending && pending.movieId === id) {
    matchPendingSchedule = null;
    await closeSession(pending.sessionId);
    if (typeof matchNightDone === 'function') matchNightDone(id);
  }
  loadMovies();
}

// ---- Box "Prossimo Film" — pick veloce, conferma o annullo proposta ----
async function lockWheelWinner(id) {
  await setQuickTonight(id);
  document.getElementById('wheelWinner').classList.add('hidden');
  loadMovies();
}

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

async function quickTonightUI(id) {
  await setQuickTonight(id);
  loadMovies();
}

// ---- Modale recensione (sostituisce prompt() x3) ----
function addReview(id) {
  document.getElementById('reviewMovieId').value = id;
  document.getElementById('reviewText').value = '';
  document.getElementById('reviewBy').value = 'both';
  document.getElementById('reviewStars').value = '5';
  openModal('reviewModal');
}

async function confirmReview() {
  const id = document.getElementById('reviewMovieId').value;
  const text = document.getElementById('reviewText').value.trim();
  const by = document.getElementById('reviewBy').value;
  const stars = parseInt(document.getElementById('reviewStars').value) || 5;
  if (!text) return;
  // Visto insieme -> chiuso, finisce tra i Visti. Visto da uno solo -> torna
  // in watchlist, resta proponibile per un rewatch insieme (con badge).
  const newStatus = by === 'both' ? 'watched' : 'watchlist';
  await updateMovie(id, { review_text: text, review_by: by, rating: stars, status: newStatus });
  // Se l'abbiamo visto insieme, la serata (se c'era una serata attiva) è
  // avvenuta: la segnamo come completed nello storico.
  if (by === 'both') await completeNight(id);
  closeModal('reviewModal');
  loadMovies();
}

// ---- Modalità sorpresa ----
function openSurprisePicker() {
  const list = movies.filter(m => m.status === 'watchlist' && !m.surprise_by);
  const container = document.getElementById('surpriseList');
  if (list.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500 italic">Nessun film disponibile da scegliere a sorpresa.</p>`;
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

// ---- Match % — voto indipendente like/dislike ----
async function voteMovie(id, liked) {
  await castVote(id, currentUser, liked);
  loadMovies();
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