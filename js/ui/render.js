// ============================================
// UI — render: griglia film, box "Prossimo Film", statistiche
// ============================================

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
  if (!el) return;
  if (dbMode === 'local') {
    el.textContent = 'modalità offline';
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ---- Box "Prossimo Film" — il pick corrente (via ruota, match o proposta
// con data), con countdown, conferma/annulla a seconda dello stato ----
let countdownTimer = null;
function renderNextMovieBox() {
  const box = document.getElementById('nextMovieBox');
  if (!box) return;
  const pick = nextMoviePick();

  if (!pick) {
    box.innerHTML = `<p class="text-xs text-slate-400 italic">Nessun film scelto per la prossima serata: gira la ruota, fate match o proponete una sera.</p>`;
    return;
  }

  const pending = pick.proposed_by && !pick.night_confirmed;
  let countdownHtml = '';
  if (pick.scheduled_date) {
    const when = new Date(`${pick.scheduled_date}T${pick.scheduled_time || '21:30'}:00`);
    const diff = when.getTime() - Date.now();
    if (diff > 0) {
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      countdownHtml = `⏳ tra ${days > 0 ? days + 'g ' : ''}${hours}h ${mins}m`;
    } else {
      countdownHtml = '📅 ' + escapeHtml(formatNightDate(pick.scheduled_date, pick.scheduled_time));
    }
  } else {
    countdownHtml = '🎬 stasera';
  }

  let actionsHtml = '';
  if (pending && pick.proposed_by === currentUser) {
    actionsHtml = `<div class="text-[11px] text-amber-400 mt-2">In attesa che ${CONFIG.PEOPLE[pick.proposed_by === 'N' ? 'V' : 'N']?.label || '...'} confermi</div>
      <button onclick="cancelNightUI('${pick.id}', '${jsAttrEscape(pick.title)}')" class="mt-2 w-full py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 rounded text-xs">Annulla proposta</button>`;
  } else if (pending && pick.proposed_by !== currentUser) {
    actionsHtml = `<div class="text-[11px] text-indigo-300 mt-1">Proposto da ${CONFIG.PEOPLE[pick.proposed_by]?.label || pick.proposed_by}</div>
      <div class="flex gap-2 mt-2">
        <button onclick="cancelNightUI('${pick.id}', '${jsAttrEscape(pick.title)}')" class="flex-1 py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 rounded text-xs">Rifiuta</button>
        <button onclick="confirmNightUI('${pick.id}')" class="flex-1 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 rounded text-xs font-medium">Conferma</button>
      </div>`;
  } else {
    actionsHtml = `<button onclick="cancelNightUI('${pick.id}', '${jsAttrEscape(pick.title)}')" class="mt-2 w-full py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 rounded text-xs">Annulla</button>`;
  }

  box.innerHTML = `
    <div class="p-3 bg-slate-900/80 rounded-xl border ${pending ? 'border-amber-500/40' : 'border-indigo-500/40'}">
      <div class="flex gap-3">
        <img src="${pick.poster || 'https://via.placeholder.com/60x90/1e293b/64748b?text=?'}" alt="${escapeHtml(pick.title)}" class="w-12 h-16 object-cover rounded">
        <div class="flex-1">
          <div class="font-bold text-slate-100 text-sm">${escapeHtml(pick.title)}</div>
          <div class="text-[11px] text-slate-400">${countdownHtml}${pick.snack ? ' • ' + escapeHtml(pick.snack) : ''}</div>
        </div>
      </div>
      ${actionsHtml}
    </div>
  `;
}

// Chip generi reali della card: massimo 3, dedup, null-safe, sempre escapati.
// Un film senza generi (o con value corrotto) non mostra chip: mai "undefined".
function genreChips(m) {
  const gs = Array.isArray(m && m.genres) ? m.genres : [];
  const uniq = [];
  gs.forEach(g => { if (g && typeof g === 'string' && uniq.indexOf(g) === -1) uniq.push(g); });
  return uniq.slice(0, 3).map(g =>
    `<span class="px-1.5 py-0.5 bg-slate-800/80 border border-slate-700/60 rounded text-[10px] text-slate-300">${escapeHtml(g)}</span>`
  ).join('');
}

// ---- Il Nostro Cinema — statistiche + timeline recensioni ----
function renderStats() {
  const watched = movies.filter(m => m.status === 'watched');
  const totalWatched = watched.length;
  const avgRating = totalWatched
    ? (watched.reduce((s, m) => s + (m.rating || 0), 0) / totalWatched).toFixed(1)
    : '—';

  // Genere "più amato": conta le occorrenze dei generi REALI su tutti i film.
  // Un film multi-genere contribuisce a ogni genere (come i dropdown filtri);
  // il valore mostrato è il COUNT del genere in testa, mai una somma di film.
  const genreCounts = {};
  movies.forEach(m => (m.genres || []).forEach(g => {
    if (g && typeof g === 'string') genreCounts[g] = (genreCounts[g] || 0) + 1;
  }));
  const topGenres = Object.keys(genreCounts)
    .sort((a, b) => genreCounts[b] - genreCounts[a] || a.localeCompare(b));
  const topGenre = topGenres[0];
  const topGenreValue = topGenre ? `${topGenre} (${genreCounts[topGenre]})` : '—';

  // "Proposti da N / V": conta i film per persona che li ha AGGIUNTI
  // (movies.added_by). NON è un giudizio sui gusti — il Match % è la sessione
  // swipe N↔V nel tab Match e la card resta la fonte per i gusti a coppia.
  const proposers = Object.keys(CONFIG.PEOPLE || {})
    .map(p => {
      const n = movies.filter(m => m.added_by === p).length;
      const label = CONFIG.PEOPLE[p]?.label || p;
      return n ? `${label} ${n}` : null;
    })
    .filter(Boolean)
    .join(' · ');
  const proposersValue = movies.length ? (proposers || '—') : '—';

  const cards = [
    { icon: 'fa-clapperboard', iconClass: 'text-rose-400', label: 'Film visti insieme', value: totalWatched },
    { icon: 'fa-star', iconClass: 'text-amber-400', label: 'Voto medio', value: avgRating === '—' ? '—' : `⭐ ${avgRating}` },
    { icon: 'fa-tags', iconClass: 'text-sky-400', label: 'Genere più amato', value: topGenreValue },
    { icon: 'fa-users', iconClass: 'text-indigo-400', label: 'Proposti da', value: proposersValue }
  ];
  document.getElementById('statsGrid').innerHTML = cards.map(c => `
    <div class="glass-card rounded-xl p-4 text-center">
      <div class="mx-auto w-11 h-11 flex items-center justify-center rounded-lg bg-slate-900/70 border border-slate-800 ${c.iconClass} text-lg">
        <i class="fa-solid ${c.icon}"></i>
      </div>
      <div class="text-xl font-bold text-cinema-testo-1 mt-2">${escapeHtml(c.value)}</div>
      <div class="text-[10px] text-cinema-testo-3 mt-0.5">${c.label}</div>
    </div>
  `).join('');

  const reviewed = watched.filter(m => m.review_text)
    .sort((a, b) => new Date(b.scheduled_date || b.created_at) - new Date(a.scheduled_date || a.created_at));
  const timeline = document.getElementById('reviewTimeline');
  if (reviewed.length === 0) {
    timeline.innerHTML = `<p class="text-xs text-slate-400 italic">Ancora nessuna recensione.</p>`;
  } else {
    timeline.innerHTML = reviewed.map(m => `
      <div class="timeline-item">
        <div class="text-sm font-bold text-slate-100">${escapeHtml(m.title)}</div>
        <div class="text-[10px] text-slate-400">${m.scheduled_date || ''} • ${'⭐'.repeat(m.rating || 0)} • ${m.review_by === 'both' ? 'Insieme' : (CONFIG.PEOPLE[m.review_by]?.label || m.review_by)}</div>
        <div class="text-xs text-slate-300 italic mt-1">"${escapeHtml(m.review_text)}"</div>
      </div>
    `).join('');
  }
}

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

// Empty state della griglia. Senza filtri: il messaggio storico. Con filtri
// attivi: elenca quelli in gioco (la query SEMPRE escapata) e "Azzera filtri".
function emptyListStateHtml() {
  const state = listFilterState();
  if (!hasActiveListFilters(state)) {
    return `<div class="col-span-full py-12 text-center text-slate-400 text-sm">Nessun film in questa sezione.</div>`;
  }
  const parts = [];
  if (state.query && String(state.query).trim()) parts.push(`"${escapeHtml(state.query)}"`);
  if (state.genre) parts.push(`genere ${escapeHtml(state.genre)}`);
  if (state.platform) parts.push(`piattaforma ${escapeHtml(state.platform)}`);
  if (state.proposer) parts.push(`proposto da ${escapeHtml(state.proposer)}`);
  return `
    <div class="col-span-full py-12 text-center text-slate-400 text-sm space-y-3">
      <p>Nessun film corrisponde ai filtri.</p>
      <p class="text-slate-400 text-xs">${parts.join(' · ')}</p>
      <button onclick="resetListFiltersUI()" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition">Azzera filtri</button>
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
  const opts = deriveFilterOptions(movies);
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

// ---- Render principale ----
function render() {
  renderPillCounters();
  // La pill "Match" è visibile SOLO in modalità Supabase (nessun counter).
  const tabMatch = document.getElementById('tabMatch');
  if (tabMatch) tabMatch.classList.toggle('hidden', dbMode !== 'supabase');
  // Stato live della pill (idle/online/live): leggere matchChannelStatus e
  // lobbyPresenceState, mai introdurre un secondo stato.
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
  if (listFilterBlock) listFilterBlock.classList.toggle('!hidden', currentTab === 'match');

  // Vista Match: si comporta come il Calendario — il pannello filtri/ricerca
  // della LISTA è ignorato (il Match ha il suo stato), le pill continuano a
  // mostrare i contatori. La vista occupa #movieGrid con early-return.
  if (currentTab === 'match') {
    renderMatch();
    renderScheduled();
    renderVetoInfo();
    renderSyncStatus();
    renderNextMovieBox();
    if (!countdownTimer) countdownTimer = setInterval(renderNextMovieBox, 30000);
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
    if (!countdownTimer) countdownTimer = setInterval(renderNextMovieBox, 30000);
    syncGenreFilterOptions();
    syncListFilterSelects();
    drawWheel();
    return;
  }

  const grid = document.getElementById('movieGrid');
  grid.innerHTML = '';

  // currentTab: 'all' = nessun vincolo di status; altrimenti mappa 1:1 sul
  // valore di movies.status. Pipeline: filtri puri (filters.js) + sort null-last.
  const statusFilter = currentTab === 'all' ? null : currentTab;
  const filtered = sortMovies(filterMoviesByState(movies, statusFilter), listSortKey, listSortDir);
  if (filtered.length === 0) {
    grid.innerHTML = emptyListStateHtml();
  }

  const vetoedIds = vetoedMovieIdsThisWeek();

  filtered.forEach(m => {
    const isSurpriseHidden = m.surprise_by && m.surprise_by !== currentUser;
    const poster = m.poster || 'https://via.placeholder.com/300x450/1e293b/64748b?text=No+Cover';
    const isVetoed = vetoedIds.includes(m.id);
    // Meta-blocco "{anno} • {durata}" (step 5b): anno e durata includono
    // SOLO valori non-null, mai un "•" isolato.
    const metaParts = [m.platform || 'Streaming'];
    if (m.release_year) metaParts.push(String(m.release_year));
    if (m.duration) metaParts.push(m.duration);
    const card = document.createElement('div');
    card.className = "glass-card rounded-xl overflow-hidden border border-slate-800 flex flex-col justify-between" + (isVetoed ? ' card-vetoed' : '');

    const votesObj = getVotesForMovie(m.id);
    const bothVoted = votesObj.N !== undefined && votesObj.V !== undefined;
    const matchHtml = bothVoted
      ? (votesObj.N === votesObj.V
          ? `<span class="match-yes text-[10px] font-bold"><i class="fa-solid fa-heart"></i> Match!</span>`
          : `<span class="match-no text-[10px] font-bold"><i class="fa-solid fa-heart-crack"></i> Gusti diversi</span>`)
      : '';

    card.innerHTML = `
      <div class="relative h-48 bg-slate-900 overflow-hidden">
        <img src="${poster}" alt="${escapeHtml(m.title)}" class="w-full h-full object-cover ${isSurpriseHidden ? 'surprise-blur' : ''}">
        ${isSurpriseHidden ? `
          <div class="surprise-overlay bg-black/40">
            <div class="text-2xl">🎁</div>
            <div class="text-xs text-slate-100 font-semibold">Sorpresa di ${CONFIG.PEOPLE[m.surprise_by]?.label || m.surprise_by}</div>
            <button onclick="revealSurpriseUI('${m.id}')" class="mt-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-medium">Rivela</button>
          </div>
        ` : ''}
        <div class="absolute top-2 right-2 flex flex-col gap-1 items-end">
          ${personBadge(m.added_by)}
          ${m.matched === false ? `<span class="badge bg-amber-700/90" title="Nessun riscontro trovato su TMDb/OMDb, titolo forse errato"><i class="fa-solid fa-triangle-exclamation"></i> verifica</span>` : ''}
          ${m.surprise_by === currentUser ? `<div class="flex items-center gap-1">
            <span class="badge bg-indigo-600/90">🎁 tua sorpresa</span>
            <button onclick="revealSurpriseUI('${m.id}')" class="px-1.5 py-0.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-300 rounded text-[10px] transition" title="Annulla la sorpresa">Annulla sorpresa</button>
          </div>` : ''}
          ${isVetoed ? `<span class="badge bg-rose-700/90">vietato</span>` : ''}
        </div>
        ${!isSurpriseHidden ? `<div class="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-slate-300 backdrop-blur">
          <i class="fa-solid fa-tv text-indigo-400"></i> ${metaParts.map(escapeHtml).join(' • ')}
        </div>` : ''}
        ${(m.trailer_url && !isSurpriseHidden) ? `<a href="${m.trailer_url}" target="_blank" rel="noopener" class="absolute bottom-2 right-2 px-2 py-1 bg-red-600/80 hover:bg-red-500 rounded text-[10px] text-white backdrop-blur"><i class="fa-solid fa-play"></i> Trailer</a>` : ''}
      </div>
      <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-bold text-slate-100 text-base leading-snug">${isSurpriseHidden ? '???' : escapeHtml(m.title)}</h3>
            <button onclick="deleteMovieConfirm('${m.id}', '${jsAttrEscape(m.title)}')" class="text-slate-400 hover:text-rose-400 transition shrink-0" title="Rimuovi">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
          ${m.director ? `<div class="mt-1 text-[10px] text-slate-400 truncate" title="${escapeHtml(m.director)}"><i class="fa-solid fa-user mr-1"></i>${escapeHtml(m.director)}</div>` : ''}
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            ${genreChips(m)}
            ${m.status === 'tonight' && currentTab === 'all' ? `<span class="badge bg-sky-700/90">in programma</span>` : ''}
            ${m.status === 'tonight' && currentTab === 'tonight' ? `<span class="badge bg-indigo-600/90"><i class="fa-regular fa-clock"></i> ${escapeHtml(formatNightDate(m.scheduled_date, m.scheduled_time))}</span>` : ''}
            ${matchHtml}
            ${(m.review_by && m.review_by !== 'both' && m.status !== 'watched') ? `<span class="text-[10px] text-amber-400"><i class="fa-solid fa-eye"></i> già visto da ${CONFIG.PEOPLE[m.review_by]?.label || m.review_by} — rewatch insieme?</span>` : ''}
          </div>
          ${m.matched === false ? `<button onclick="retryMatch('${m.id}', '${jsAttrEscape(m.title)}')" class="mt-1 text-[10px] text-amber-400 hover:text-amber-300 underline">Correggi titolo e ricerca di nuovo</button>` : ''}
          ${(m.imdb_rating || m.rt_rating || m.metacritic_rating) ? `
            <div class="flex gap-2 mt-1 text-[10px] text-slate-400">
              ${m.imdb_rating ? `<span><i class="fa-solid fa-star text-amber-400"></i> IMDb ${m.imdb_rating}</span>` : ''}
              ${m.rt_rating ? `<span class="text-rose-400">RT ${m.rt_rating}</span>` : ''}
              ${m.metacritic_rating ? `<span class="text-emerald-400">MC ${m.metacritic_rating}</span>` : ''}
            </div>
          ` : ''}
          ${m.review_text ? `
            <div class="mt-2 p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 text-xs text-slate-300 italic">
              "${escapeHtml(m.review_text)}"
              <div class="text-[10px] text-indigo-400 mt-1 not-italic font-semibold">
                ${'⭐'.repeat(m.rating)} — ${m.review_by === 'both' ? 'Insieme' : (CONFIG.PEOPLE[m.review_by]?.label || m.review_by)}
              </div>
            </div>
          ` : ''}
        </div>
        <div class="flex flex-col gap-2 pt-2 border-t border-slate-800/80 text-xs">
          ${(m.status === 'watchlist' || m.status === 'tonight') ? `
            <div class="flex items-center gap-2">
              <button onclick="voteMovie('${m.id}', true)" aria-label="Mi piace" class="px-2 py-1 rounded ${votesObj[currentUser] === true ? 'bg-emerald-600/60 text-white' : 'bg-slate-800 text-slate-400 hover:text-emerald-300'}"><i class="fa-solid fa-thumbs-up"></i></button>
              <button onclick="voteMovie('${m.id}', false)" aria-label="Non mi piace" class="px-2 py-1 rounded ${votesObj[currentUser] === false ? 'bg-rose-600/60 text-white' : 'bg-slate-800 text-slate-400 hover:text-rose-300'}"><i class="fa-solid fa-thumbs-down"></i></button>
              <span class="text-[10px] text-slate-400">voto tuo</span>
            </div>
          ` : ''}
          ${m.status === 'watchlist' ? `
            <div class="flex gap-2">
              <button onclick="quickTonightUI('${m.id}')" class="flex-1 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded font-medium">Stasera</button>
              <button onclick="scheduleMovie('${m.id}')" aria-label="Programma la serata" class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"><i class="fa-solid fa-calendar"></i></button>
              ${!isVetoed
                ? `<button onclick="vetoMovie('${m.id}', '${jsAttrEscape(m.title)}')" aria-label="Vieta questa settimana" class="px-2 py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-300 rounded" title="Vieta questa settimana"><i class="fa-solid fa-ban"></i></button>`
                : (vetoForMovieThisWeek(m.id) && vetoForMovieThisWeek(m.id).person === currentUser
                  ? `<button onclick="unvetoMovie('${m.id}')" aria-label="Togli il veto" class="px-2 py-1.5 bg-rose-900/50 hover:bg-rose-900/80 text-rose-300 rounded" title="Togli il veto"><i class="fa-solid fa-rotate-left"></i></button>`
                  : '')}
            </div>
          ` : ''}
          ${m.status === 'tonight' ? `
            <button onclick="addReview('${m.id}')" class="flex-1 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded font-medium">Visto & Recensione</button>
          ` : ''}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  renderScheduled();
  renderVetoInfo();
  renderSyncStatus();
  renderNextMovieBox();
  if (!countdownTimer) countdownTimer = setInterval(renderNextMovieBox, 30000);
  syncGenreFilterOptions();
  syncListFilterSelects();
  drawWheel();
}

function renderScheduled() {
  const container = document.getElementById('scheduledList');
  container.innerHTML = '';
  // Dedup: il box "Prossimo Film" mostra già la serata corrente (da movie_nights).
  // Qui restano le ALTRE serate datate. I film legacy (scheduled_date senza riga
  // movie_nights, usati dal fallback del box) non si escludono. I film già visti
  // (status 'watched') non sono più "programmati": esclusi.
  const pick = nextMoviePick();
  const pickId = (pick && activeNights().length > 0) ? pick.id : null;
  const scheduled = movies.filter(m => m.scheduled_date && m.status !== 'watched' && m.id !== pickId);
  if (scheduled.length === 0) {
    const anyDated = movies.some(m => m.scheduled_date && m.status !== 'watched');
    container.innerHTML = anyDated ? '' : `<p class="text-xs text-slate-400 italic">Nessun film programmato.</p>`;
    return;
  }
  scheduled.forEach(m => {
    container.innerHTML += `
      <div class="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs flex justify-between items-center">
        <div>
          <div class="font-bold text-slate-200">${escapeHtml(m.title)}</div>
          <div class="text-slate-400 text-[10px]"><i class="fa-regular fa-clock"></i> ${escapeHtml(formatNightDate(m.scheduled_date, m.scheduled_time))} ${m.snack ? '• ' + escapeHtml(m.snack) : ''}</div>
        </div>
        <span class="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-medium">${escapeHtml(m.platform || '')}</span>
      </div>
    `;
  });
}