// Controlli della libreria: ricerca, filtri, contatori, sort e stati vuoti.
// Lo stato dei filtri e le funzioni pure restano in js/filters.js.

// ---- Ricerca: input statico FUORI da #movieGrid, MAI ricreato da render().
// Il debounce (~250ms) evita un render ad ogni tasto; il valore del campo
// resta intatto su render/resync realtime. ----
let searchDebounceTimer = null;
let historySearchDebounceTimer = null;
const resultPages = new Map();
let activeResultsPage = null;

function cancelListingSearch() {
  clearTimeout(searchDebounceTimer);
  clearTimeout(historySearchDebounceTimer);
  searchDebounceTimer = historySearchDebounceTimer = null;
}
function resetResultPages(scope) {
  cancelListingSearch();
  for (const key of resultPages.keys()) {
    if ((key.startsWith('history_') ? 'history' : 'library') === scope) resultPages.delete(key);
  }
}
function resetPaginationUI() {
  cancelListingSearch();
  resultPages.clear();
  activeResultsPage = null;
  renderResultsPager(null);
}
function resultCriteriaKey() {
  return JSON.stringify(currentTab.startsWith('history_') ? [historyQuery] : [listFilterState(), listSortKey, listSortDir]);
}
function currentResultsModel(results) {
  const criteria = resultCriteriaKey();
  const saved = resultPages.get(currentTab);
  const model = paginateResults(results, saved?.criteria === criteria ? saved.pageIndex : 0);
  resultPages.set(currentTab, { criteria, pageIndex: model.pageIndex });
  activeResultsPage = model;
  return model;
}
function renderResultsPager(model) {
  activeResultsPage = model;
  const visible = !!model && model.pageCount > 1;
  for (const position of ['Top', 'Bottom']) {
    const pager = document.getElementById('resultsPager' + position);
    if (!pager) continue;
    pager.classList.toggle('hidden', !visible);
    if (!visible) continue;
    pager.querySelector('[data-page-previous]').disabled = !model.hasPrevious;
    pager.querySelector('[data-page-next]').disabled = !model.hasNext;
    pager.querySelector('[data-page-number]').textContent = `${model.pageIndex + 1} di ${model.pageCount}`;
    pager.querySelector('[data-page-range]').textContent = `${model.rangeStart}–${model.rangeEnd} di ${model.totalResults}`;
  }
  const status = document.getElementById('resultsPageStatus');
  const message = visible ? `Pagina ${model.pageIndex + 1} di ${model.pageCount}, film ${model.rangeStart}–${model.rangeEnd} di ${model.totalResults}` : '';
  if (status && status.textContent !== message) status.textContent = message;
}
function changeResultsPage(direction, event) {
  if (!activeResultsPage || ![-1, 1].includes(direction)) return;
  // A pending query already changed the criteria: resolve it before paging.
  if (searchDebounceTimer || historySearchDebounceTimer) {
    cancelListingSearch();
    render();
  }
  const model = activeResultsPage;
  if (!model || (direction < 0 ? !model.hasPrevious : !model.hasNext)) return;
  resultPages.set(currentTab, { criteria: resultCriteriaKey(), pageIndex: model.pageIndex + direction });
  render();
  const anchor = document.getElementById('resultsStart');
  if (!anchor) return;
  // Keyboard activation moves focus out of the replaced page. Touch activation
  // does not summon focus; both paths scroll only after an explicit page change.
  if (event?.detail === 0) anchor.focus({ preventScroll: true });
  const header = document.querySelector('.site-nav');
  const destinations = document.querySelector('.destination-nav');
  const offset = (header?.getBoundingClientRect().height || 0)
    + (destinations && getComputedStyle(destinations).position === 'sticky' ? destinations.getBoundingClientRect().height : 0) + 12;
  window.scrollTo({ top: Math.max(0, window.scrollY + anchor.getBoundingClientRect().top - offset), behavior: 'auto' });
}
function scheduleListingSearch(history) {
  const tab = currentTab, view = dashboardView, person = currentUser;
  const epoch = authEpoch;
  cancelListingSearch();
  const callback = () => {
    searchDebounceTimer = historySearchDebounceTimer = null;
    if (currentTab === tab && dashboardView === view && currentUser === person && authEpoch === epoch && isAppAuthorized()) render();
  };
  if (history) historySearchDebounceTimer = setTimeout(callback, 250);
  else searchDebounceTimer = setTimeout(callback, 250);
}
function onSearchInput() {
  const input = document.getElementById('movieSearchInput');
  listQuery = (input && input.value) || '';
  resetResultPages('library');
  scheduleListingSearch(false);
}

// Contatori delle pill di stato, calcolati con i FILTRI ATTIVI: coerenti con
// ciò che la griglia mostrerebbe in ogni sezione (stesso predicato di
// filterMovies senza il vincolo di status).
function renderPillCounters() {
  const counts = statusCountsFor(movies);
  [['all', 'pillCountAll'], ['watchlist', 'pillCountWatchlist'], ['tonight', 'pillCountTonight'], ['watched', 'pillCountWatched'], ['rewatch', 'pillCountRewatch'], ['history_n', 'pillCountHistoryN'], ['history_v', 'pillCountHistoryV']]
    .forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = counts[key];
    });
}

// Empty state della griglia: istruzione concreta per la vista corrente.
// Con filtri attivi elenca quelli in gioco (query SEMPRE escapata) e li azzera.
function emptyListStateHtml() {
  const state = listFilterState();
  if (!hasActiveListFilters(state)) {
    const empty = {
      all: ['fa-film', 'Lo scaffale è ancora vuoto', 'Aggiungi un film: il cartellone parte da lì.', 'Aggiungi un film', "openAddModal()"],
      watchlist: ['fa-clapperboard', 'La lista è pronta', 'Manca il protagonista: aggiungi un film.', 'Aggiungi un film', "openAddModal()"],
      rewatch: ['fa-rotate', 'Il bis può aspettare', 'Qui trovi i film già visti separatamente, ancora da vedere insieme.', 'Vai alla lista', "setTab('watchlist')"],
      history_n: ['fa-film', 'Storico N', 'Qui trovi le visioni personali di N, anche per film in Lista.', 'Aggiungi un film', "openAddModal()"],
      history_v: ['fa-film', 'Storico V', 'Qui trovi le visioni personali di V, anche per film in Lista.', 'Aggiungi un film', "openAddModal()"],
      tonight: ['fa-calendar-plus', 'Nessuna serata in programma', 'Scegliete un film dalla lista e fissate la prossima serata.', 'Vai ai film da vedere', "setTab('watchlist')"],
      watched: ['fa-ticket', 'I titoli di coda devono ancora scorrere', 'Qui finiscono i film visti, i voti e i commenti.', 'Vai ai film da vedere', "setTab('watchlist')"]
    }[currentTab] || ['fa-film', 'Nessun film', 'Aggiungi un film alla libreria.', 'Aggiungi un film', "openAddModal()"];
    const viewLabel = state.availability === 'cinema' ? 'Al cinema / prossimamente' : 'Streaming';
    return `<div class="empty-movie-state col-span-full">
      <span class="empty-movie-icon" aria-hidden="true"><i class="fa-solid ${empty[0]}"></i></span>
      <span class="dashboard-eyebrow">${viewLabel}</span><h3>${empty[1]}</h3><p>${empty[2]}</p>
      <button onclick="${empty[4]}" class="empty-movie-action">${empty[3]} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
    </div>`;
  }
  const parts = [];
  if (state.query && String(state.query).trim()) parts.push(`"${escapeHtml(state.query)}"`);
  if (state.genre) parts.push(`genere ${escapeHtml(state.genre)}`);
  if (state.platform) parts.push(`piattaforma ${escapeHtml(state.platform)}`);
  parts.push(state.availability === 'cinema' ? 'al cinema / prossimamente' : 'streaming');
  if (state.proposer) parts.push(`proposto da ${escapeHtml(state.proposer)}`);
  return `
    <div class="empty-movie-state col-span-full">
      <span class="empty-movie-icon" aria-hidden="true"><i class="fa-solid fa-magnifying-glass"></i></span>
      <h3>Nessun film corrisponde ai filtri</h3>
      <p>${parts.join(' · ')}</p>
      <button onclick="resetListFiltersUI()" class="empty-movie-action">Azzera filtri <i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
    </div>`;
}

// ---- Collapse mobile del pannello filtri/ordinamento. Lo stato NON viene
// mai toccato da render()/resync: il pannello resta aperto/chiuso come lo
// ha lasciato l'utente. Da md in su il bottone è nascosto e il pannello
// è visibile sempre (regola CSS `hidden md:flex`). ----
let listFiltersOpen = false;
function toggleListFiltersPanel() {
  const panel = document.getElementById('listFiltersPanel');
  const chevron = document.getElementById('filtersToggleChevron');
  if (!panel) return;
  listFiltersOpen = !listFiltersOpen;
  panel.classList.toggle('hidden', !listFiltersOpen);
  if (chevron) chevron.classList.toggle('rotate-180', listFiltersOpen);
}

// ---- Dropdown filtri (propositori/generi/piattaforme) + sort. ----
// Pattern di syncGenreFilterOptions: le opzioni vengono ricostruite SOLO se
// cambiano (cache sul dataset), la scelta dell'utente è preservata e torna
// a "all" se l'opzione scelta sparisce. I valori testuali passano SEMPRE da
// escapeHtml/jsAttrEscape (es. generi con apostrofi tipo O'Brien).
function refreshSelectOptions(sel, cacheAttr, options, allLabel) {
  const key = options.map(o => o.value + ':' + o.count).join('|');
  if (sel.dataset[cacheAttr] === key) return sel.value;
  sel.dataset[cacheAttr] = key;
  const chosen = sel.value;
  const stillExists = chosen === 'all' || options.some(o => o.value === chosen);
  sel.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>`
    + options.map(o => `<option value="${jsAttrEscape(o.value)}">${escapeHtml(o.value)} (${o.count})</option>`).join('');
  sel.value = stillExists ? chosen : 'all';
  return sel.value;
}
function syncListFilterSelects() {
  if (!document.getElementById('listFiltersPanel')) return;
  const opts = deriveFilterOptions(filterMovies(movies, { availability: listAvailability }));
  const proposerSel = document.getElementById('proposerFilterSelect');
  if (proposerSel) {
    const eff = refreshSelectOptions(proposerSel, 'listProposerOptions', opts.proposers, '👤 Tutti i propositori');
    if (eff !== listProposer) listProposer = eff && eff !== 'all' ? eff : '';
  }
  const genreSel = document.getElementById('genreListFilterSelect');
  if (genreSel) {
    const eff = refreshSelectOptions(genreSel, 'listGenreOptions', opts.genres, '🎞️ Tutti i generi');
    if (eff !== listGenre) listGenre = eff && eff !== 'all' ? eff : '';
  }
  const platformSel = document.getElementById('platformFilterSelect');
  if (platformSel) {
    const eff = refreshSelectOptions(platformSel, 'listPlatformOptions', opts.platforms, '📺 Tutte le piattaforme');
    if (eff !== listPlatform) listPlatform = eff && eff !== 'all' ? eff : '';
  }
}
function setProposerFilter(v) {
  if (listProposer !== (v === 'all' ? '' : v)) resetResultPages('library');
  listProposer = v === 'all' ? '' : v;
  const sel = document.getElementById('proposerFilterSelect');
  if (sel) sel.value = v;
  render();
}
function setGenreListFilter(v) {
  if (listGenre !== (v === 'all' ? '' : v)) resetResultPages('library');
  listGenre = v === 'all' ? '' : v;
  const sel = document.getElementById('genreListFilterSelect');
  if (sel) sel.value = v;
  render();
}
function setPlatformFilter(v) {
  if (listPlatform !== (v === 'all' ? '' : v)) resetResultPages('library');
  listPlatform = v === 'all' ? '' : v;
  const sel = document.getElementById('platformFilterSelect');
  if (sel) sel.value = v;
  render();
}
function renderAvailabilitySwitch() {
  for (const [mode, id] of [['streaming', 'availabilityStreaming'], ['cinema', 'availabilityCinema']]) {
    const button = document.getElementById(id);
    if (button) button.setAttribute('aria-pressed', String(listAvailability === mode));
  }
}
function setAvailabilityFilter(v) {
  if (v !== 'streaming' && v !== 'cinema') return;
  if (v !== listAvailability || listPlatform) resetResultPages('library');
  listAvailability = v;
  listPlatform = '';
  const platform = document.getElementById('platformFilterSelect');
  if (platform) platform.value = 'all';
  render();
}
function setListSortKey(v) {
  if (listSortKey !== (v || 'added')) resetResultPages('library');
  listSortKey = v || 'added';
  const sel = document.getElementById('sortKeySelect');
  if (sel) sel.value = listSortKey;
  render();
}

// ---- Ordine del sort: toggle direzione (asc/desc). L'icona del bottone
// segue lo stato; mai ricreata da render(). ----
function renderSortDirBtn() {
  const icon = document.getElementById('sortDirIcon');
  const btn = document.getElementById('sortDirBtn');
  if (icon) icon.className = listSortDir === 'desc' ? 'fa-solid fa-arrow-down-a-z' : 'fa-solid fa-arrow-up-a-z';
  if (btn) btn.title = listSortDir === 'desc' ? 'Decrescente' : 'Crescente';
}
function toggleListSortDir() {
  resetResultPages('library');
  listSortDir = listSortDir === 'desc' ? 'asc' : 'desc';
  renderSortDirBtn();
  render();
}

// Azzera i filtri (stato + DOM) e ri-render: ricerca, dropdown (torna a "all")
// e sort (chiave "added" + direzione desc), lasciando intatti i dataset-cache.
function resetListFiltersUI() {
  resetResultPages('library');
  resetListFilters();
  const input = document.getElementById('movieSearchInput');
  if (input) input.value = '';
  ['proposerFilterSelect', 'genreListFilterSelect', 'platformFilterSelect'].forEach(id => {
    const s = document.getElementById(id);
    if (s) s.value = 'all';
  });
  const sortSel = document.getElementById('sortKeySelect');
  if (sortSel) sortSel.value = 'added';
  renderSortDirBtn();
  render();
}

// Ricerca Storico indipendente dai filtri Lista, solo sui film già caricati.
let historyQuery = '';
function onHistorySearchInput() {
  historyQuery = document.getElementById('historySearchInput')?.value || '';
  resetResultPages('history');
  scheduleListingSearch(true);
}
function resetHistorySearch() {
  resetResultPages('history');
  historyQuery = '';
  const input = document.getElementById('historySearchInput');
  if (input) input.value = '';
}
function historyMoviesFor(person, query = historyQuery) {
  const needle = String(query).trim().toLocaleLowerCase('it');
  return movies.filter(movie => movie[person === 'V' ? 'seen_v' : 'seen_n'] === true
    && (!needle || [movie.title, movie.director].some(value => String(value || '').toLocaleLowerCase('it').includes(needle))))
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'it'));
}
