// Phase 41 — collection TMDb: consultazione e aggiunta esplicita dei capitoli.
let sagaPanel = null;

function canShowSaga(movie) {
  return !!(movie && Number.isInteger(Number(movie.collection_id)) && Number(movie.collection_id) > 0
    && (!movie.surprise_by || movie.surprise_by === currentUser));
}

function sagaButtonHtml(movie) {
  if (!canShowSaga(movie)) return '';
  return `<button type="button" onclick="openMovieSaga('${jsAttrEscape(movie.id)}')" class="saga-entry"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> Continua la saga <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`;
}

function sagaTodayKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

// Non confonde l'ordine d'uscita con l'ordine narrativo o la disponibilità streaming.
function sagaChapterStates(collection, source, library, person, today = sagaTodayKey()) {
  const reference = collection.parts.find(part => part.id === Number(source.tmdb_id));
  const after = reference?.release_date || null;
  let nextFound = false;
  return collection.parts.map(part => {
    const existing = library.find(movie => Number(movie.tmdb_id) === part.id) || null;
    const hidden = !!(existing && existing.surprise_by && existing.surprise_by !== person);
    const state = existing ? viewingState(existing) : null;
    const sourceChapter = part.id === Number(source.tmdb_id);
    const upcoming = !!(part.release_date && part.release_date > today);
    const next = !nextFound && !hidden && !sourceChapter && !upcoming && part.release_date && after
      && part.release_date > after && !(state && state.together);
    if (next) nextFound = true;
    return { part, existing, hidden, state, sourceChapter, upcoming, next: !!next };
  });
}

async function openMovieSaga(movieId) {
  const movie = movies.find(row => row.id === movieId);
  if (!currentUser || !canShowSaga(movie)) return;
  const panel = { movieId, user: currentUser, collection: null, selected: new Set(), loading: true, busy: false, message: '' };
  sagaPanel = panel;
  renderSagaPanel();
  openModal('sagaModal');
  const collection = await fetchTmdbCollection(movie.collection_id);
  if (sagaPanel !== panel || currentUser !== panel.user) return;
  panel.loading = false;
  panel.collection = collection;
  renderSagaPanel();
}

function retryMovieSaga() {
  if (sagaPanel && !sagaPanel.busy) return openMovieSaga(sagaPanel.movieId);
}

function renderSagaPanel() {
  const box = document.getElementById('sagaBody');
  if (!box || !sagaPanel) return;
  const panel = sagaPanel;
  const movie = movies.find(row => row.id === panel.movieId);
  if (currentUser !== panel.user || !canShowSaga(movie)) { closeModal('sagaModal'); return; }
  document.getElementById('sagaIntro').textContent = `La storia di “${movie.title}” può continuare.`;
  if (panel.loading) {
    box.innerHTML = '<p class="saga-notice" role="status">Cerchiamo gli altri capitoli…</p>';
    return;
  }
  if (!panel.collection) {
    box.innerHTML = '<p class="saga-notice" role="status">Non riusciamo a recuperare la saga. Controlla la connessione e riprova.</p><button type="button" class="saga-entry" onclick="retryMovieSaga()">Riprova</button>';
    return;
  }
  const chapters = sagaChapterStates(panel.collection, movie, movies, currentUser);
  chapters.filter(chapter => chapter.existing || chapter.sourceChapter).forEach(chapter => panel.selected.delete(chapter.part.id));
  const available = chapters.filter(chapter => !chapter.existing && !chapter.sourceChapter);
  const cards = chapters.map(({ part, existing, hidden, state, sourceChapter, upcoming, next }) => {
    const title = hidden ? 'Film a sorpresa' : part.title;
    const selectable = !existing && !sourceChapter;
    const status = hidden ? 'Già in lista · sorpresa' : sourceChapter ? 'Il film da cui partite'
      : state?.together ? 'Visto insieme' : existing ? 'Già in lista' : upcoming ? 'Al cinema / prossimamente' : 'Da aggiungere';
    const personal = !hidden && state && !state.together
      ? ['N', 'V'].filter(person => state[person]).map(person => 'Visto da ' + (CONFIG.PEOPLE[person]?.label || person)).join(' · ') : '';
    const year = !hidden && part.release_date ? part.release_date.slice(0, 4) : '';
    const check = selectable ? `<input type="checkbox" value="${part.id}" aria-label="Aggiungi ${escapeHtml(title)}" onchange="toggleSagaChapter(${part.id}, this.checked)"${panel.selected.has(part.id) ? ' checked' : ''}${panel.busy ? ' disabled' : ''}>` : '';
    return `<label class="saga-chapter${next ? ' is-next' : ''}${selectable ? ' is-selectable' : ''}">
      <span class="saga-poster">${!hidden && part.poster ? `<img src="${escapeHtml(part.poster)}" alt="" loading="lazy">` : `<i class="fa-solid ${hidden ? 'fa-gift' : 'fa-film'}" aria-hidden="true"></i>`}</span>
      <span class="saga-chapter-copy">${next ? '<span class="saga-next">IL PROSSIMO CAPITOLO</span>' : ''}<strong>${escapeHtml(title)}</strong><small>${escapeHtml([year, status].filter(Boolean).join(' · '))}</small>${personal ? `<small>${escapeHtml(personal)}</small>` : ''}${!hidden && !part.release_date ? '<small>Data di uscita non disponibile</small>' : ''}</span>${check}
    </label>`;
  }).join('');
  box.innerHTML = `<p class="saga-name">${escapeHtml(panel.collection.name)}</p><p class="saga-notice">Capitoli in ordine di uscita. Scegli quali aggiungere alla vostra lista.</p>
    <div class="saga-chapters">${cards || '<p class="saga-notice">Non ci sono capitoli disponibili per questa saga.</p>'}</div>
    <p id="sagaMessage" class="saga-notice" role="status">${escapeHtml(panel.message || (!available.length && chapters.length ? 'Avete già tutti i capitoli disponibili in lista.' : ''))}</p>
    ${available.length ? `<button id="sagaAddButton" type="button" class="saga-add" onclick="addSagaChapters()"${panel.busy || !panel.selected.size ? ' disabled' : ''}>${panel.busy ? 'Aggiungiamo i film…' : 'Aggiungi alla lista (' + panel.selected.size + ')'}</button>` : ''}`;
}

function toggleSagaChapter(id, checked) {
  if (!sagaPanel || sagaPanel.busy) return;
  const part = sagaPanel.collection?.parts.find(row => row.id === Number(id));
  if (!part || findDuplicateByTmdbId(id)) return;
  if (checked) sagaPanel.selected.add(Number(id));
  else sagaPanel.selected.delete(Number(id));
  // Aggiorna solo il pulsante: il checkbox mantiene focus e stato.
  const button = document.getElementById('sagaAddButton');
  if (button) {
    button.disabled = !sagaPanel.selected.size;
    button.textContent = 'Aggiungi alla lista (' + sagaPanel.selected.size + ')';
  }
}

async function addSagaChapters() {
  const panel = sagaPanel;
  if (!panel || panel.busy || !panel.collection || !panel.selected.size || currentUser !== panel.user) return;
  panel.busy = true;
  panel.message = '';
  renderSagaPanel();
  let added = 0, duplicates = 0, failed = 0;
  const selected = [...panel.selected];
  try {
    for (const id of selected) {
      if (currentUser !== panel.user) break;
      const part = panel.collection.parts.find(row => row.id === id);
      if (!part) continue;
      if (findDuplicateByTmdbId(id)) { panel.selected.delete(id); duplicates++; continue; }
      try {
        const details = await fetchTmdbDetailsById(id);
        if (currentUser !== panel.user) break;
        if (!details.matched || Number(details.tmdb_id) !== id) { failed++; continue; }
        if (findDuplicateByTmdbId(id)) { panel.selected.delete(id); duplicates++; continue; }
        const shared = !!sb;
        const inserted = await insertMovie({ title: details.title, added_by: panel.user, status: 'watchlist',
          ...(part.release_date && part.release_date > sagaTodayKey() ? { cinema_watchlist: true } : {}),
          tmdb_id: id, collection_id: details.collection_id ?? panel.collection.id,
          collection_name: details.collection_name || panel.collection.name,
          duration: details.duration, platform: details.platform, poster: details.poster,
          trailer_url: details.trailerUrl, matched: details.matched, rating: 0,
          genres: details.genres || [], release_year: details.release_year ?? null, director: details.director || null,
          overview: details.overview || null, cast_names: details.cast_names || null,
          imdb_rating: details.imdbRating || '', rt_rating: details.rtRating || '', metacritic_rating: details.metacriticRating || '' });
        await loadMovies();
        if (inserted && (!shared || dbMode === 'supabase') && movies.some(row => row.id === inserted.id && Number(row.tmdb_id) === id)) {
          added++; panel.selected.delete(id);
        } else if (!inserted && findDuplicateByTmdbId(id)) {
          duplicates++; panel.selected.delete(id);
        } else { failed++; }
      } catch (_) { failed++; }
    }
  } finally {
    panel.busy = false;
    panel.message = [added ? `${added} ${added === 1 ? 'film aggiunto' : 'film aggiunti'}${dbMode === 'local' ? ' su questo telefono (modalità locale)' : ' alla lista'}.` : '',
      duplicates ? `${duplicates} già in lista.` : '', failed ? `${failed} non salvati. Puoi riprovare quelli rimasti selezionati.` : ''].filter(Boolean).join(' ');
    if (sagaPanel === panel && currentUser === panel.user) renderSagaPanel();
  }
}

// Nessuna apertura da render/Realtime: soltanto dopo un gesto di visione riuscito.
function suggestSagaAfterViewing(id) {
  if (modalStackTop() || !currentUser) return;
  const movie = movies.find(row => row.id === id);
  if (canShowSaga(movie)) void openMovieSaga(id);
}
