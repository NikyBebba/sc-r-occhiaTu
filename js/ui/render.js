// Coordinamento delle viste, home e stato connessione/veto.
// I renderer di dominio in js/ui/render/ sono caricati prima di questo file.

function renderVetoInfo() {
  const el = document.getElementById('vetoInfo');
  if (!el) return;
  const used = vetoUsedThisWeek(currentUser);
  const vetoedTitles = vetoedMovieIdsThisWeek()
    .map(id => movies.find(m => m.id === id)?.title)
    .filter(Boolean);
  let html = used
    ? `<i class="fa-solid fa-ban text-rose-400"></i> Hai già usato il tuo veto questa settimana.`
    : `<i class="fa-regular fa-hand"></i> Puoi ancora vietare 1 film questa settimana.`;
  if (vetoedTitles.length) html += `<br>Esclusi dalla ruota: ${escapeHtml(vetoedTitles.join(', '))}`;
  el.innerHTML = html;
}

// Badge di stato sync: fallback visibile quando Supabase non è raggiungibile.
// Il fallback (localStorage) non deve essere silenzioso.
function renderSyncStatus() {
  const el = document.getElementById('syncBadge');
  const notice = document.getElementById('syncNotice');
  if (dbMode === 'local') {
    if (el) { el.textContent = 'modalità offline'; el.classList.remove('hidden'); }
    if (notice) {
      const message = sb
        ? 'Stai vedendo i dati salvati su questo telefono. Le modifiche fatte ora potrebbero non essere salvate o condivise.'
        : 'Stai usando solo i dati di questo telefono. Le modifiche non saranno condivise.';
      notice.innerHTML = `<i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i>
        <span>${message}</span>
        ${sb ? '<button onclick="retrySyncUI()">Riprova la connessione</button>' : ''}`;
      notice.classList.remove('hidden');
    }
  } else {
    if (el) el.classList.add('hidden');
    if (notice) notice.classList.add('hidden');
  }
  syncDestinationNavigation();
}

async function retrySyncUI() {
  if (!sb) return;
  lastSupabaseFailAt = 0;
  try { await loadMovies(); }
  catch (_) {
    dbMode = 'local';
    lastSupabaseFailAt = Date.now();
    console.error('[sc(r)occhiaTu] Riprova connessione fallita.');
    try { loadLocal(); } catch (_) { /* conserva i dati già visibili */ }
    render();
  }
}

// ---- Render principale ----
function renderDashboardHome() {
  const greeting = document.getElementById('sceltaTitle');
  const name = CONFIG.PEOPLE[currentUser]?.label || currentUser;
  if (greeting) greeting.textContent = name ? `Ciao, ${name}.` : 'Benvenuti in sala.';
  const watchlist = document.getElementById('homeWatchlistCount');
  const waiting = movies.filter(m => normalListEligible(m)).length;
  if (watchlist) watchlist.textContent = waiting
    ? `${waiting} film in attesa del ciak.` : 'La lista aspetta il primo titolo.';
  const watched = document.getElementById('homeWatchedCount');
  const seen = movies.filter(m => togetherSeen(m)).length;
  if (watched) watched.textContent = seen
    ? `${seen} ${seen === 1 ? 'film visto' : 'film visti'}.` : 'Qui finiscono i film già visti.';
}

function render() {
  if (!isAppAuthorized()) { showLanding(); return; }
  finishInitialLoading();
  renderDashboardHome();
  renderAvailabilitySwitch();
  syncListFilterSelects();
  if (typeof renderSagaPanel === 'function' && !document.getElementById('sagaModal').classList.contains('hidden')) renderSagaPanel();
  renderPillCounters();
  const statsModal = document.getElementById('statsModal');
  if (statsModal && !statsModal.classList.contains('hidden')) renderStats();
  // Match Live ha un ingresso dedicato nella dashboard, disponibile online.
  const tabMatch = document.getElementById('tabMatch');
  if (tabMatch) tabMatch.classList.toggle('hidden', dbMode !== 'supabase');
  const inMatch = currentTab === 'match';
  const inHome = dashboardView === 'home' && !inMatch;
  const inWheel = dashboardView === 'wheel' && !inMatch;
  const inHistory = dashboardView === 'history';
  const inLibrary = !inHome && !inWheel;
  const historyFilms = inHistory ? movies.filter(m => m[currentTab === 'history_v' ? 'seen_v' : 'seen_n'] === true)
    .sort((a,b) => String(a.title || '').localeCompare(String(b.title || ''), 'it')) : [];
  const historySwitch = document.getElementById('historySwitch');
  if (historySwitch) historySwitch.classList.toggle('!hidden', !inHistory);
  ['N','V'].forEach(person => document.getElementById('historySwitch'+person)?.setAttribute('aria-pressed', String(currentTab === 'history_'+person.toLowerCase())));
  const sceltaCta = document.getElementById('sceltaCta');
  if (sceltaCta) {
    sceltaCta.classList.toggle('hidden', !inHome);
    sceltaCta.classList.toggle('is-home', inHome);
  }
  const sidebar = document.getElementById('dashboardSidebar');
  if (sidebar) {
    sidebar.classList.toggle('!hidden', !inWheel);
  }
  const library = document.getElementById('librarySection');
  if (library) {
    library.classList.toggle('!hidden', !inLibrary);
  }
  const libraryBack = document.getElementById('libraryBack');
  if (libraryBack) libraryBack.classList.toggle('hidden', inMatch);
  const matchHeader = document.getElementById('matchViewHeader');
  if (matchHeader) {
    matchHeader.classList.toggle('hidden', !inMatch);
    matchHeader.classList.toggle('flex', inMatch);
  }
  const libraryHeader = document.getElementById('libraryHeader');
  if (libraryHeader) libraryHeader.classList.toggle('!hidden', inMatch);
  const librarySelect = document.getElementById('libraryViewSelect');
  const filmLibrary = LIBRARY_TABS.includes(currentTab);
  if (librarySelect) librarySelect.classList.toggle('!hidden', !filmLibrary);
  const segControl = document.getElementById('segControl');
  if (segControl) segControl.classList.toggle('!hidden', !filmLibrary);
  const pageTitle = document.getElementById('libraryPageTitle');
  if (pageTitle) pageTitle.textContent = currentTab === 'calendar' ? 'Calendario'
    : inHistory ? 'Storico' : currentTab === 'watched' ? 'Visti e recensioni' : 'Libreria';
  const pageEyebrow = document.getElementById('libraryPageEyebrow');
  if (pageEyebrow) pageEyebrow.textContent = currentTab === 'calendar' ? 'IL CARTELLONE'
    : inHistory ? 'LE VISIONI PERSONALI' : currentTab === 'watched' ? 'DOPO LA PROIEZIONE' : 'LO SCAFFALE DEI FILM';
  const libraryCount = document.getElementById('libraryCount');
  if (libraryCount) libraryCount.textContent = currentTab === 'calendar' ? ''
    : `${inHistory ? historyFilms.length : filterMoviesByState(movies, currentTab === 'all' ? null : currentTab).length} film`;
  const libraryTools = document.getElementById('libraryTools');
  if (libraryTools) libraryTools.classList.toggle('!hidden', inMatch || inHistory || currentTab === 'calendar');
  renderMatchCta();
  // Pillola animata: riposiziona l'indicatore sotto il tab attivo ad ogni
  // render (copre anche il primo render post-login e i resync Realtime).
  updateTabIndicator();

  // Nel tab Match il pannello filtri/ricerca della LISTA è un input inerte
  // (la vista Match non lo usa): lo nascondiamo con ...!hidden che vince su
  // `md:flex` del pannello, così il blocco resta nascosto anche da md in su.
  // Il Calendario invece lo tiene visibile (stesso comportamento inerte ma
  // pattern storico). Lo stato di collapse su mobile NON è toccato: al ritorno
  // il pannello resta come l'utente l'ha lasciato (regola render non tocca
  // listFiltersOpen).
  const listFilterBlock = document.getElementById('listFiltersBlock');
  if (listFilterBlock) listFilterBlock.classList.toggle('!hidden', currentTab === 'match' || inHistory);

  // Vista Match: il pannello filtri/ricerca della LISTA è ignorato (il Match
  // ha il suo stato). La vista occupa #movieGrid con early-return.
  if (currentTab === 'match') {
    renderMatch();
    renderScheduled();
    renderVetoInfo();
    renderSyncStatus();
    renderNextMovieBox();
    if (!countdownTimer) countdownTimer = setInterval(() => { renderNextMovieBox(); renderScheduled(); }, 30000);
    syncGenreFilterOptions();
    syncListFilterSelects();
    drawWheel();
    return;
  }

  // Vista Calendario: il mese occupa la colonna destra, colonna sinistra
  // invariata. I filtri della LISTA sono ignorati (il calendario ha il suo
  // stato), ma le pill continuano a mostrare i contatori coi filtri attivi.
  if (currentTab === 'calendar') {
    renderCalendar();
    renderScheduled();
    renderVetoInfo();
    renderSyncStatus();
    renderNextMovieBox();
    if (!countdownTimer) countdownTimer = setInterval(() => { renderNextMovieBox(); renderScheduled(); }, 30000);
    syncGenreFilterOptions();
    syncListFilterSelects();
    drawWheel();
    return;
  }

  const grid = document.getElementById('movieGrid');
  grid.innerHTML = '';

  // currentTab: 'all' = tutti, 'tonight' = film con eventi attivi; le altre
  // viste usano il ciclo del film. Pipeline: filtri (filters.js) + sort null-last.
  const statusFilter = currentTab === 'all' ? null : currentTab;
  const filtered = inHistory ? historyFilms : sortMovies(filterMoviesByState(movies, statusFilter), listSortKey, listSortDir);
  if (filtered.length === 0) {
    grid.innerHTML = inHistory ? '<p class="col-span-full text-sm text-slate-400">Le visioni personali compariranno qui. Puoi aggiungere un film scegliendo Solo Storico.</p>' : emptyListStateHtml();
  }

  const vetoedIds = vetoedMovieIdsThisWeek();

  filtered.forEach(m => {
    grid.appendChild(createMovieCard(m, vetoedIds));
  });

  renderScheduled();
  renderVetoInfo();
  renderSyncStatus();
  renderNextMovieBox();
  if (!countdownTimer) countdownTimer = setInterval(() => { renderNextMovieBox(); renderScheduled(); }, 30000);
  syncGenreFilterOptions();
  syncListFilterSelects();
  drawWheel();
}
