// Controlli della libreria: ricerca, filtri, contatori, sort e stati vuoti.
// Lo stato dei filtri e le funzioni pure restano in js/filters.js.

// ---- Ricerca: input statico FUORI da #movieGrid, MAI ricreato da render().
// Il debounce (~250ms) evita un render ad ogni tasto; il valore del campo
// resta intatto su render/resync realtime. ----
let searchDebounceTimer = null;
function onSearchInput() {
  const input = document.getElementById('movieSearchInput');
  listQuery = (input && input.value) || '';
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => { searchDebounceTimer = null; render(); }, 250);
}

// Contatori delle pill di stato, calcolati con i FILTRI ATTIVI: coerenti con
// ciò che la griglia mostrerebbe in ogni sezione (stesso predicato di
// filterMovies senza il vincolo di status).
function renderPillCounters() {
  const counts = statusCountsFor(movies);
  [['all', 'pillCountAll'], ['watchlist', 'pillCountWatchlist'], ['tonight', 'pillCountTonight'], ['watched', 'pillCountWatched']]
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
  listProposer = v === 'all' ? '' : v;
  const sel = document.getElementById('proposerFilterSelect');
  if (sel) sel.value = v;
  render();
}
function setGenreListFilter(v) {
  listGenre = v === 'all' ? '' : v;
  const sel = document.getElementById('genreListFilterSelect');
  if (sel) sel.value = v;
  render();
}
function setPlatformFilter(v) {
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
  listAvailability = v;
  listPlatform = '';
  const platform = document.getElementById('platformFilterSelect');
  if (platform) platform.value = 'all';
  render();
}
function setListSortKey(v) {
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
  listSortDir = listSortDir === 'desc' ? 'asc' : 'desc';
  renderSortDirBtn();
  render();
}

// Azzera i filtri (stato + DOM) e ri-render: ricerca, dropdown (torna a "all")
// e sort (chiave "added" + direzione desc), lasciando intatti i dataset-cache.
function resetListFiltersUI() {
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
