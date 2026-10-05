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

// ---- Hero della proiezione — usa il pick corrente senza nuovi stati ----
let countdownTimer = null;
function nextMovieTimeLabel(pick, now = Date.now()) {
  if (!pick.scheduled_date) return '🎬 Oggi';
  const dateLabel = formatNightDate(pick.scheduled_date, pick.scheduled_time);
  // Senza ora precisa non si può calcolare un countdown attendibile.
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(pick.scheduled_time || '')) return '📅 ' + dateLabel;
  const when = new Date(`${pick.scheduled_date}T${pick.scheduled_time.slice(0, 5)}:00`);
  const diff = when.getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return '📅 ' + dateLabel;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `⏳ tra ${days > 0 ? days + 'g ' : ''}${hours}h ${mins}m`;
}

function renderNextMovieBox() {
  const box = document.getElementById('nextMovieBox');
  if (!box) return;
  const hero = document.getElementById('nextMovieHero');
  const tonight = tonightPick();
  const rawPick = tonight || nextMoviePick();
  const sourceMovie = movies.find(m => m.id === rawPick?.id);
  const pick = rawPick && sourceMovie?.surprise_by && sourceMovie.surprise_by !== currentUser
    ? { ...rawPick, title: 'Film a sorpresa', poster: null } : rawPick;
  if (hero) {
    hero.classList.toggle('hidden', !pick || currentTab === 'match' || (dashboardView === 'library' && currentTab === 'calendar'));
    hero.classList.toggle('is-tonight', !!tonight);
  }
  if (!pick) {
    box.innerHTML = '';
    return;
  }

  const pending = pick.proposed_by && !pick.night_confirmed;
  const countdown = nextMovieTimeLabel(pick);
  const countdownHtml = escapeHtml(countdown);
  const dateHtml = pick.scheduled_date ? escapeHtml(formatNightDate(pick.scheduled_date, pick.scheduled_time)) : '';
  const safeId = jsAttrEscape(pick.id);
  const safeTitle = jsAttrEscape(pick.title);
  const nightTarget = pick.nightId ? `, '${jsAttrEscape(pick.nightId)}'` : '';
  const pickMovie = movies.find(m => m.id === pick.id) || {};
  const hasTogetherReview = !!reviewTextFor(pickMovie, 'both') || togetherRating(pickMovie) !== null;

  let actionsHtml = '';
  if (pending && pick.proposed_by === currentUser) {
    actionsHtml = `<p class="text-sm text-amber-200">In attesa che ${escapeHtml(CONFIG.PEOPLE[pick.proposed_by === 'N' ? 'V' : 'N']?.label || '...')} confermi</p>
      <button onclick="cancelNightUI('${safeId}', '${safeTitle}'${nightTarget})" class="next-movie-action next-movie-secondary">Annulla proposta</button>`;
  } else if (pending && pick.proposed_by !== currentUser) {
    actionsHtml = `<p class="text-sm text-sky-200">Proposto da ${escapeHtml(CONFIG.PEOPLE[pick.proposed_by]?.label || pick.proposed_by)}</p>
      <button onclick="confirmNightUI('${safeId}'${nightTarget})" class="next-movie-action next-movie-primary">Accetta proposta</button>
      <button onclick="cancelNightUI('${safeId}', '${safeTitle}'${nightTarget})" class="next-movie-action next-movie-secondary">Rifiuta</button>`;
  } else {
    actionsHtml = `${tonight ? `<button onclick="${hasTogetherReview ? 'finishTogetherNightUI' : 'addReview'}('${safeId}')" class="next-movie-action next-movie-primary">${hasTogetherReview ? 'Segna come visto' : `Voto ${sharedPeopleLabel()}`}</button>` : ''}
      <button onclick="cancelNightUI('${safeId}', '${safeTitle}'${nightTarget})" class="next-movie-action next-movie-secondary">Annulla proiezione</button>`;
  }

  if (pick.nightId) actionsHtml += `<button onclick="editNightDetailsUI('${safeId}'${nightTarget})" class="next-movie-action next-movie-secondary">Snack e luogo</button>`;

  // Step4 phase18 — ticket per la proposta DIRETTA: il bottone appare SOLO se
  // l'origine è stata marcata in-memory come 'manual' in QUESTA sessione di
  // navigazione (markTicketOrigin in quickTonightUI/confirmSchedule della
  // card). Match Live e Ruota hanno il proprio bottone Ticket nelle loro viste
  // (% o timbro dedicato); qui mai un'% inventata.
  if (typeof ticketOriginOf === 'function' && ticketOriginOf(pick.id) === 'manual') {
    actionsHtml += `<button onclick="downloadTicket('${safeId}', 'manual')" class="next-movie-action next-movie-secondary">🎟️ Ticket</button>`;
  }

  box.innerHTML = `
    <div class="next-movie-content${pending ? ' is-pending' : ''}">
      <div class="next-movie-poster">
        ${pick.poster ? `<img src="${escapeHtml(pick.poster)}" alt="Locandina di ${escapeHtml(pick.title)}">` : '<i class="fa-solid fa-film" aria-hidden="true"></i>'}
      </div>
      <div class="next-movie-info">
        <p class="dashboard-eyebrow next-movie-status"><i class="fa-solid ${pending ? 'fa-hourglass-half' : tonight ? 'fa-star' : 'fa-ticket'}" aria-hidden="true"></i>${tonight ? (pending ? 'OGGI · PROPOSTA' : 'OGGI SI GUARDA') : (pending ? 'PROPOSTA DI PROIEZIONE' : 'IN PROGRAMMA')}</p>
        <h2>${escapeHtml(pick.title)}</h2>
        <div class="next-movie-timing"><p class="next-movie-date">${countdownHtml}</p>${dateHtml && countdown.startsWith('⏳') ? `<p class="next-movie-when"><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${dateHtml}</p>` : ''}</div>
        ${pick.snack ? `<p class="next-movie-snack">🍿 ${escapeHtml(pick.snack)}</p>` : ''}
        ${pick.location ? `<p class="next-movie-snack"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(pick.location)}</p>` : ''}
        <div class="next-movie-actions">${actionsHtml}</div>
        ${sagaButtonHtml(pickMovie)}
      </div>
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

function sharedPeopleLabel() {
  return ['N', 'V'].map(person => CONFIG.PEOPLE[person]?.label || person).join('+');
}

function sharedVoteButtonHtml(movie) {
  if (movie.surprise_by && movie.surprise_by !== currentUser) return '';
  const label = (reviewTextFor(movie, 'both') || togetherRating(movie) !== null) ? 'Modifica voto' : 'Vota';
  return `<button onclick="addReview('${jsAttrEscape(movie.id)}')" class="shared-vote-action w-full min-h-11 px-3 py-2 rounded-lg font-medium">${label} ${escapeHtml(sharedPeopleLabel())}</button>`;
}

function viewingStatusHtml(movie) {
  const seen = viewingState(movie);
  const label = seen.together ? 'Visto insieme da N e V'
    : seen.N && seen.V ? 'Visto separatamente da N e V'
    : seen.N ? 'Visto da N' : seen.V ? 'Visto da V' : 'Non ancora visto';
  const person = key => `<span class="viewing-person viewing-person-${key.toLowerCase()}${seen[key] ? ' is-seen' : ''}${seen.together ? ' is-together' : ''}" aria-label="${key}: ${seen[key] ? (seen.together ? 'visto insieme' : 'visto') : 'non visto'}">${key}</span>`;
  const scores = ['N', 'V'].map(key => {
    const rating = personalRating(movie, key);
    return rating === null ? '' : `<span class="viewing-score viewing-score-${key.toLowerCase()}">${key} <i class="fa-solid fa-star" aria-hidden="true"></i> ${formatMovieRating(rating)}/10</span>`;
  }).filter(Boolean);
  const shared = togetherRating(movie);
  if (shared !== null && seen.together) scores.push(`<span class="viewing-score viewing-score-together" aria-label="Voto insieme: ${formatMovieRating(shared)} su 10">${escapeHtml(sharedPeopleLabel())} <i class="fa-solid fa-star" aria-hidden="true"></i> ${formatMovieRating(shared)}/10</span>`);
  return `<div class="viewing-status" role="group" aria-label="${label}"><span class="viewing-label" aria-hidden="true">Visto da</span>${person('N')}${person('V')}</div>${scores.length ? `<div class="viewing-scores" aria-label="Voti del film">${scores.join('')}</div>` : ''}`;
}

function personalVoteButtonHtml(movie) {
  if ((currentUser !== 'N' && currentUser !== 'V') || !viewingState(movie)[currentUser]
      || (movie.surprise_by && movie.surprise_by !== currentUser)) return '';
  const name = CONFIG.PEOPLE[currentUser]?.label || currentUser;
  return `<button onclick="addPersonalReview('${jsAttrEscape(movie.id)}')" class="personal-vote-action personal-vote-${currentUser.toLowerCase()} w-full min-h-11 px-3 py-2 rounded-lg font-medium">Modifica voto ${escapeHtml(name)}</button>`;
}

function reviewCardsHtml(movie) {
  return ['N', 'V', 'both'].map(person => {
    const text = reviewTextFor(movie, person);
    if (!text) return '';
    const label = person === 'both' ? escapeHtml(sharedPeopleLabel()) : person;
    const score = person === 'both' ? togetherRating(movie) : personalRating(movie, person);
    return `<div class="mt-2 p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 text-xs text-slate-300">
      <span class="text-[11px] font-bold text-indigo-300">Recensione ${label}${score !== null ? ` · ★ ${formatMovieRating(score)}/10` : ''}</span>
      <p class="italic mt-1">“${escapeHtml(text)}”</p>
    </div>`;
  }).join('');
}

// ---- Il Nostro Cinema — una card per ogni serata completata, anche rewatch.
// Nessun timbro d'origine: il ticket PNG non viene conservato nel database. ----
function nightTimelineDate(night) {
  const raw = night.date;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return { key: raw, source: 'scheduled' };
    }
  }
  const completed = night.completed_at ? new Date(night.completed_at) : null;
  if (completed && Number.isFinite(completed.getTime())) {
    return { key: localDateKey(completed), source: 'registered' };
  }
  return null;
}

function completedNightEntries() {
  return movieNights.filter(n => n.status === 'completed')
    .map(night => ({ night, movie: movies.find(m => m.id === night.movie_id) || null,
      timelineDate: nightTimelineDate(night) }))
    .sort((a, b) => {
      const byDay = (b.timelineDate?.key || '').localeCompare(a.timelineDate?.key || '');
      if (byDay) return byDay;
      const byCompletion = (b.night.completed_at || '').localeCompare(a.night.completed_at || '');
      return byCompletion || String(a.night.id || '').localeCompare(String(b.night.id || ''));
    });
}

// Phase 23: conteggi retrospettivi. Un rewatch è ogni serata conclusa
// successiva alla prima sullo stesso movie_id; un film rimosso resta conteggiato
// perché l'evento esiste ancora. Il voto insieme è per film, non per serata.
function movieChemistryStats(nights, films) {
  const completed = nights.filter(n => n.status === 'completed');
  const byMovie = new Map();
  completed.forEach(n => {
    if (n.movie_id != null) byMovie.set(n.movie_id, (byMovie.get(n.movie_id) || 0) + 1);
  });
  const rewatches = [...byMovie.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const sharedRatings = films.filter(m => viewingState(m).together && togetherRating(m) !== null).length;
  return { nights: completed.length, films: byMovie.size, rewatches, sharedRatings };
}

function completedNightLabel(entry) {
  if (!entry.timelineDate) return 'Data non registrata';
  if (entry.timelineDate.source === 'scheduled') {
    return 'Serata del ' + formatNightDate(entry.timelineDate.key, entry.night.time);
  }
  const [year, month, day] = entry.timelineDate.key.split('-').map(Number);
  return 'Registrata il ' + new Date(year, month - 1, day)
    .toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderNightHistory() {
  const container = document.getElementById('nightHistory');
  if (!container) return;
  const entries = completedNightEntries();
  const count = document.getElementById('nightHistoryCount');
  if (count) count.textContent = `${entries.length} ${entries.length === 1 ? 'serata' : 'serate'}`;
  if (!entries.length) {
    container.innerHTML = '<p class="text-sm text-slate-400">Le serate concluse compariranno qui.</p>';
    return;
  }
  const groups = new Map();
  entries.forEach(entry => {
    const monthKey = entry.timelineDate ? entry.timelineDate.key.slice(0, 7) : '';
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey).push(entry);
  });
  container.innerHTML = [...groups].map(([monthKey, group]) => {
    const monthLabel = monthKey
      ? new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1)
        .toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
      : 'Data non registrata';
    const cards = group.map(({ night, movie, timelineDate }) => {
      const hidden = !!(movie && movie.surprise_by && movie.surprise_by !== currentUser);
      const title = hidden ? 'Film a sorpresa' : movie?.title || 'Film non disponibile';
      const poster = movie?.poster && !hidden
        ? `<img src="${escapeHtml(movie.poster)}" alt="Locandina di ${escapeHtml(title)}" loading="lazy">`
        : '<i class="fa-solid fa-film" aria-hidden="true"></i>';
      return `<article class="history-ticket">
      <div class="history-ticket-poster">${poster}</div>
      <div class="history-ticket-info">
        <span class="history-ticket-kicker">SERATA CONCLUSA</span>
        <h5>${escapeHtml(title)}</h5>
        <p>${escapeHtml(completedNightLabel({ night, timelineDate }))}</p>
        ${night.snack ? `<p>🍿 ${escapeHtml(night.snack)}</p>` : ''}
        ${night.location && !hidden ? `<p><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(night.location)}</p>` : ''}
        ${movie && !hidden && togetherRating(movie) !== null ? `<p class="history-shared-score">${escapeHtml(sharedPeopleLabel())} <i class="fa-solid fa-star" aria-hidden="true"></i> ${formatMovieRating(togetherRating(movie))}/10</p>` : ''}
      </div>
    </article>`;
    }).join('');
    return `<section aria-label="${escapeHtml(monthLabel)}">
      <div class="flex items-center justify-between gap-2 mb-3">
        <h5 class="text-sm font-bold text-slate-200 capitalize">${escapeHtml(monthLabel)}</h5>
        <span class="text-xs text-slate-400">${group.length} ${group.length === 1 ? 'serata' : 'serate'}</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${cards}</div>
    </section>`;
  }).join('');
}

// ---- Il Nostro Cinema — statistiche + recensioni senza data ----
function renderStats() {
  renderNightHistory();
  const watched = movies.filter(m => viewingState(m).together);
  const allRatings = watched.map(togetherRating).filter(value => value !== null);
  // Somma in decimi: evita che 9,1 e 0 producano 4,5 invece di 4,6.
  const avgRating = allRatings.length
    ? (Math.round(allRatings.reduce((sum, value) => sum + Math.round(value * 10), 0) / allRatings.length) / 10).toFixed(1).replace('.', ',')
    : '—';

  // Genere più visto insieme: conta le occorrenze dei generi REALI sui film condivisi.
  // Un film multi-genere contribuisce a ogni genere (come i dropdown filtri);
  // il valore mostrato è il COUNT del genere in testa, mai una somma di film.
  const genreCounts = {};
  watched.forEach(m => (m.genres || []).forEach(g => {
    if (g && typeof g === 'string') genreCounts[g] = (genreCounts[g] || 0) + 1;
  }));
  const topGenres = Object.keys(genreCounts)
    .sort((a, b) => genreCounts[b] - genreCounts[a] || a.localeCompare(b));
  const topGenre = topGenres[0];
  const topGenreValue = topGenre ? `${topGenre} (${genreCounts[topGenre]})` : '—';

  // Film aggiunti: intera libreria, attribuzione persistita sul film.
  // Non è un conteggio delle serate: i rewatch non moltiplicano i film.
  const proposersValue = ['N', 'V'].map(person => {
    const count = movies.filter(movie => movie.added_by === person).length;
    return `${CONFIG.PEOPLE[person]?.label || person} ${count}`;
  }).join(' · ');

  const visibleRated = watched.filter(movie => (!movie.surprise_by || movie.surprise_by === currentUser)
    && togetherRating(movie) !== null);
  const highestRating = visibleRated.length ? Math.max(...visibleRated.map(togetherRating)) : null;
  const topRated = visibleRated.filter(movie => togetherRating(movie) === highestRating);
  const highestTitle = topRated.length === 1 ? topRated[0].title || 'Film senza titolo'
    : topRated.length > 1 ? `${topRated.length} film a pari voto` : '';
  const cards = [
    { key: 'average', icon: 'fa-star', iconClass: 'text-amber-400', label: 'Voto medio', value: avgRating === '—' ? '—' : `${avgRating}/10` },
    { key: 'highest', icon: 'fa-trophy', iconClass: 'text-amber-400', label: 'Voto più alto',
      value: highestRating === null ? '—' : `${formatMovieRating(highestRating)}/10`, detail: highestTitle },
    { key: 'genre', icon: 'fa-tags', iconClass: 'text-sky-400', label: 'Genere più visto', value: topGenreValue },
    { key: 'added', icon: 'fa-users', iconClass: 'text-indigo-400', label: 'Film aggiunti', value: proposersValue }
  ];
  document.getElementById('statsGrid').innerHTML = cards.map(c => `
    <div class="cinema-stat-card glass-card rounded-xl p-4" data-stat="${c.key}">
      <div class="flex items-center gap-2 text-xs text-cinema-testo-3">
        <i class="fa-solid ${c.icon} ${c.iconClass}" aria-hidden="true"></i><span>${c.label}</span>
      </div>
      <div class="cinema-stat-value text-lg font-bold text-cinema-testo-1 mt-3">${escapeHtml(c.value)}</div>
      ${c.detail ? `<p class="text-xs text-cinema-testo-3 mt-1">${escapeHtml(c.detail)}</p>` : ''}
    </div>
  `).join('');

  const reviewed = watched.filter(m => !m.surprise_by || m.surprise_by === currentUser)
    .map(m => ({ movie: m, text: reviewTextFor(m, 'both'), score: togetherRating(m) }))
    .filter(entry => entry.text || entry.score !== null)
    .sort((a, b) => String(a.movie.title || '').localeCompare(String(b.movie.title || ''), 'it'));
  const timeline = document.getElementById('reviewTimeline');
  if (reviewed.length === 0) {
    timeline.innerHTML = `<p class="text-xs text-slate-400 italic">Ancora nessun voto o recensione.</p>`;
  } else {
    timeline.innerHTML = reviewed.map(({ movie: m, text: review, score }) => `
      <div class="timeline-item">
        <div class="text-sm font-bold text-slate-100">${escapeHtml(m.title)}</div>
        ${score !== null ? `<div class="text-xs text-amber-300">★ ${formatMovieRating(score)}/10</div>` : ''}
        ${review ? `<div class="text-xs text-slate-300 italic mt-1">“${escapeHtml(review)}”</div>` : ''}
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

// ---- Render principale ----
function renderDashboardHome() {
  const greeting = document.getElementById('sceltaTitle');
  const name = CONFIG.PEOPLE[currentUser]?.label || currentUser;
  if (greeting) greeting.textContent = name ? `Ciao, ${name}.` : 'Benvenuti in sala.';
  const watchlist = document.getElementById('homeWatchlistCount');
  const waiting = movies.filter(m => m.status === 'watchlist').length;
  if (watchlist) watchlist.textContent = waiting
    ? `${waiting} film in attesa del ciak.` : 'La lista aspetta il primo titolo.';
  const watched = document.getElementById('homeWatchedCount');
  const seen = movies.filter(m => m.status === 'watched').length;
  if (watched) watched.textContent = seen
    ? `${seen} ${seen === 1 ? 'film visto' : 'film visti'}.` : 'Qui finiscono i film già visti.';
}

function render() {
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
  const inLibrary = !inHome && !inWheel;
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
    : currentTab === 'watched' ? 'Visti e recensioni' : 'Libreria';
  const pageEyebrow = document.getElementById('libraryPageEyebrow');
  if (pageEyebrow) pageEyebrow.textContent = currentTab === 'calendar' ? 'IL CARTELLONE'
    : currentTab === 'watched' ? 'DOPO LA PROIEZIONE' : 'LO SCAFFALE DEI FILM';
  const libraryCount = document.getElementById('libraryCount');
  if (libraryCount) libraryCount.textContent = currentTab === 'calendar' ? ''
    : `${filterMoviesByState(movies, currentTab === 'all' ? null : currentTab).length} film`;
  const libraryTools = document.getElementById('libraryTools');
  if (libraryTools) libraryTools.classList.toggle('!hidden', inMatch || currentTab === 'calendar');
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
    const metaParts = [m.cinema_watchlist ? 'Al cinema / prossimamente' : (m.platform || 'Streaming')];
    if (m.release_year) metaParts.push(String(m.release_year));
    if (m.duration) metaParts.push(m.duration);
    const card = document.createElement('div');
    card.className = "movie-ticket flex flex-col justify-between" + (m.cinema_watchlist ? ' is-cinema-ticket' : '') + (isVetoed ? ' card-vetoed' : '');

    card.innerHTML = `
      <div class="relative h-48 bg-slate-900 overflow-hidden">
        <img src="${poster}" alt="${escapeHtml(m.title)}" class="w-full h-full object-cover ${isSurpriseHidden ? 'surprise-blur' : ''}">
        ${!isSurpriseHidden ? `<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" aria-hidden="true"></div>` : ''}
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
        ${!isSurpriseHidden ? `<div class="absolute bottom-4 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-slate-300 backdrop-blur">
          <i class="fa-solid ${m.cinema_watchlist ? 'fa-ticket' : 'fa-tv'} text-indigo-400"></i> ${metaParts.map(escapeHtml).join(' • ')}
        </div>` : ''}
        ${(m.trailer_url && !isSurpriseHidden) ? `<a href="${m.trailer_url}" target="_blank" rel="noopener" class="absolute bottom-4 right-2 px-2 py-1 bg-red-600/80 hover:bg-red-500 rounded text-[10px] text-white backdrop-blur"><i class="fa-solid fa-play"></i> Trailer</a>` : ''}
      </div>
      <div class="p-4 flex-1 flex flex-col justify-between space-y-3 ticket-seam">
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
            ${m.cinema_watchlist ? '<span class="badge bg-amber-600/80">🎬 Al cinema / prossimamente</span>' : ''}
            ${m.status === 'tonight' && currentTab === 'all' ? `<span class="badge bg-sky-700/90">in programma</span>` : ''}
            ${m.status === 'tonight' && currentTab === 'tonight' ? `<span class="badge bg-indigo-600/90"><i class="fa-regular fa-clock"></i> ${escapeHtml(formatNightDate(m.scheduled_date, m.scheduled_time))}</span>` : ''}
          </div>
          ${viewingStatusHtml(m)}
          ${m.matched === false ? `<button onclick="retryMatch('${m.id}', '${jsAttrEscape(m.title)}')" class="mt-1 text-[10px] text-amber-400 hover:text-amber-300 underline">Correggi titolo e ricerca di nuovo</button>` : ''}
          ${(m.imdb_rating || m.rt_rating || m.metacritic_rating) ? `
            <div class="rating-holo flex gap-2 mt-1 px-2 py-1 rounded text-[10px] text-slate-400">
              ${m.imdb_rating ? `<span><i class="fa-solid fa-star text-amber-400"></i> IMDb ${m.imdb_rating}</span>` : ''}
              ${m.rt_rating ? `<span class="text-rose-400">RT ${m.rt_rating}</span>` : ''}
              ${m.metacritic_rating ? `<span class="text-emerald-400">MC ${m.metacritic_rating}</span>` : ''}
            </div>
          ` : ''}
          ${reviewCardsHtml(m)}
          ${sagaButtonHtml(m)}
        </div>
        ${(m.status === 'watchlist' || m.status === 'tonight' || m.status === 'watched') ? `
        <div class="card-action-row flex flex-col gap-2 pt-2 border-t border-slate-800/80 text-xs">
          ${m.status === 'watched' || isSurpriseHidden ? '' : !viewingState(m)[currentUser]
            ? `<button onclick="markSeenUI('${m.id}')" class="w-full min-h-9 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium text-left"><i class="fa-solid fa-eye mr-1.5" aria-hidden="true"></i>L'ho già visto</button>`
            : (canUndoSeen(m, currentUser) ? `<button onclick="undoSeenUI('${jsAttrEscape(m.id)}')" class="min-h-9 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium" aria-label="Annulla l'ho già visto">Annulla</button>` : '')}
          ${m.status === 'watchlist' ? `
            <div class="flex gap-2">
              <button onclick="quickTonightUI('${m.id}')" class="flex-1 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded font-medium">Oggi</button>
              <button onclick="scheduleMovie('${m.id}')" aria-label="Programma la serata" class="flex-1 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">Programma</button>
              ${!isVetoed
                ? `<button onclick="vetoMovie('${m.id}', '${jsAttrEscape(m.title)}')" aria-label="Vieta questa settimana" class="px-2 py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-300 rounded" title="Vieta questa settimana"><i class="fa-solid fa-ban"></i></button>`
                : (vetoForMovieThisWeek(m.id) && vetoForMovieThisWeek(m.id).person === currentUser
                  ? `<button onclick="unvetoMovie('${m.id}')" aria-label="Togli il veto" class="px-2 py-1.5 bg-rose-900/50 hover:bg-rose-900/80 text-rose-300 rounded" title="Togli il veto"><i class="fa-solid fa-rotate-left"></i></button>`
                  : '')}
            </div>
            ${!isSurpriseHidden ? `<button onclick="toggleCinemaWatchlist('${jsAttrEscape(m.id)}')" class="w-full min-h-9 px-2 py-1.5 text-xs text-amber-200 hover:text-amber-100 underline">${m.cinema_watchlist ? 'Sposta in Streaming' : 'Sposta al cinema / prossimamente'}</button>` : ''}
          ` : ''}
          ${m.status === 'tonight' ? `
            ${projectionInfoHtml(m)}
            ${(reviewTextFor(m, 'both') || togetherRating(m) !== null) ? `<button onclick="finishTogetherNightUI('${jsAttrEscape(m.id)}')" class="flex-1 min-h-11 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded font-medium">Segna come visto</button>` : sharedVoteButtonHtml(m)}
            ${(reviewTextFor(m, 'both') || togetherRating(m) !== null) ? sharedVoteButtonHtml(m) : ''}
          ` : ''}
          ${m.status === 'watched' && !isSurpriseHidden ? `
            ${sharedVoteButtonHtml(m)}
          ` : ''}
          ${personalVoteButtonHtml(m)}
        </div>
        ` : ''}
      </div>
    `;
    // Step3 phase9 — dettaglio film: il click sulla card apre il modale, ma
    // mai dai controlli interni (visione/azioni/trailer/cestino/retry/sorpresa)
    // né per una sorpresa vista dall'altra persona (click inerte).
    card.addEventListener('click', e => {
      if (isSurpriseHidden) return;
      const t = e && e.target;
      if (t && t.closest && t.closest('button, a, input, select, textarea')) return;
      openMovieDetail(m.id, card);
    });
    grid.appendChild(card);
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

function projectionActionsHtml(pick) {
  const id = jsAttrEscape(pick.id);
  const title = jsAttrEscape(pick.title);
  const target = pick.nightId ? `, '${jsAttrEscape(pick.nightId)}'` : '';
  if (pick.proposed_by && !pick.night_confirmed) {
    if (pick.proposed_by !== currentUser) return `<button onclick="confirmNightUI('${id}'${target})" class="projection-accept">Accetta proposta</button><button onclick="cancelNightUI('${id}', '${title}'${target})">Rifiuta</button>`;
    return `<span class="projection-wait">In attesa di conferma</span><button onclick="cancelNightUI('${id}', '${title}'${target})">Annulla proposta</button>`;
  }
  return '';
}

function projectionInfoHtml(movie) {
  const night = activeNightForMovie(movie.id);
  const pick = night ? { ...movie, scheduled_date: night.date, scheduled_time: night.time,
    nightId: night.id, snack: night.snack, location: night.location, proposed_by: night.proposed_by,
    night_confirmed: night.status === 'confirmed' } : { ...movie };
  if (movie.surprise_by && movie.surprise_by !== currentUser) pick.title = 'Film a sorpresa';
  const pending = pick.proposed_by && !pick.night_confirmed;
  return `<div class="projection-card-info"><p><i class="fa-solid ${pending ? 'fa-hourglass-half' : 'fa-calendar-check'}" aria-hidden="true"></i> ${pending ? 'Proposta da confermare' : 'Proiezione in programma'} · ${escapeHtml(formatNightDate(pick.scheduled_date, pick.scheduled_time))}</p>
    ${pick.snack ? `<p>🍿 ${escapeHtml(pick.snack)}</p>` : ''}
    ${pick.location ? `<p><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(pick.location)}</p>` : ''}
    <div class="projection-actions">${projectionActionsHtml(pick)}${night ? `<button onclick="editNightDetailsUI('${jsAttrEscape(movie.id)}', '${jsAttrEscape(night.id)}')">Snack e luogo</button>` : ''}</div></div>`;
}

function renderScheduled() {
  const container = document.getElementById('scheduledList');
  const panel = document.getElementById('scheduledPanel');
  if (!container) return;
  const pick = tonightPick() || nextMoviePick();
  const active = activeNights();
  const entries = active.filter(n => n.id !== pick?.nightId)
    .map(n => {
      const movie = movies.find(m => m.id === n.movie_id);
      return movie ? { ...movie, nightId: n.id, scheduled_date: n.date,
        scheduled_time: n.time, snack: n.snack, location: n.location,
        proposed_by: n.proposed_by, night_confirmed: n.status === 'confirmed' } : null;
    }).filter(Boolean);
  // Mirror legacy solo per film senza evento attivo, mai per eventi conclusi.
  entries.push(...movies.filter(m => m.scheduled_date && m.status !== 'watched'
    && !movieNights.some(n => n.movie_id === m.id)));
  entries.sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''));
  if (panel) panel.classList.toggle('hidden', !entries.length || currentTab === 'match');
  container.innerHTML = entries.map(m => {
    const hidden = m.surprise_by && m.surprise_by !== currentUser;
    const title = hidden ? 'Film a sorpresa' : m.title;
    const actionPick = { ...m, title };
    return `<article class="upcoming-projection">
      <div class="upcoming-projection-copy"><p class="dashboard-eyebrow">${m.proposed_by && !m.night_confirmed ? 'PROPOSTA' : 'PROSSIMA PROIEZIONE'}</p><h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(formatNightDate(m.scheduled_date, m.scheduled_time))}${!hidden && (m.cinema_watchlist || m.platform) ? ' · ' + escapeHtml(m.cinema_watchlist ? 'Al cinema' : m.platform) : ''}${m.snack ? ' · ' + escapeHtml(m.snack) : ''}</p>
      ${m.location ? `<p><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(m.location)}</p>` : ''}</div>
      <div class="projection-actions">${projectionActionsHtml(actionPick)}${m.nightId ? `<button onclick="editNightDetailsUI('${jsAttrEscape(m.id)}', '${jsAttrEscape(m.nightId)}')">Snack e luogo</button>` : ''}</div>
    </article>`;
  }).join('');
}

// ============================================
// Step3 phase9 — dettaglio film (modale)
// Apre il modale #detailModal e popola #detailBody con i metadati del film.
// Usa i campi già in memoria; solo gli Oscar sono letti su richiesta.
// ============================================
let detailTransitionSource = null;
let detailTransitionActive = false;

function canTransitionMovieDetail(source) {
  return !!(source && source.isConnected && document.startViewTransition
    && (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches));
}

function openMovieDetail(id, sourceCard) {
  if (detailTransitionActive) return;
  const m = movies.find(x => x.id === id);
  if (!m || (m.surprise_by && m.surprise_by !== currentUser)) return;
  renderMovieDetail(m);
  const panel = document.getElementById('detailPanel');
  if (panel && canTransitionMovieDetail(sourceCard) && !detailTransitionActive) {
    detailTransitionActive = true;
    detailTransitionSource = sourceCard;
    sourceCard.style.viewTransitionName = 'movie-detail';
    let transition;
    try {
      transition = document.startViewTransition(() => {
        sourceCard.style.viewTransitionName = '';
        openModal('detailModal');
        panel.style.viewTransitionName = 'movie-detail';
      });
    } catch (error) {
      sourceCard.style.viewTransitionName = '';
      detailTransitionActive = false;
      detailTransitionSource = null;
      openModal('detailModal');
      transition = null;
    }
    if (transition) {
      transition.finished.then(() => {
        panel.style.viewTransitionName = '';
        detailTransitionActive = false;
      }, () => {
        panel.style.viewTransitionName = '';
        detailTransitionActive = false;
      });
    }
  } else {
    detailTransitionSource = null;
    openModal('detailModal');
  }
  if (m.tmdb_id) fetchOscarWins(m.tmdb_id).then(wins => renderOscarWins(m.id, wins));
}

function closeMovieDetailWithTransition(closeNow) {
  const source = detailTransitionSource;
  const panel = document.getElementById('detailPanel');
  const modal = document.getElementById('detailModal');
  detailTransitionSource = null;
  if (detailTransitionActive || !panel || !modal || modal.classList.contains('hidden')
      || !canTransitionMovieDetail(source)) return false;
  detailTransitionActive = true;
  panel.style.viewTransitionName = 'movie-detail';
  let transition;
  try {
    transition = document.startViewTransition(() => {
      panel.style.viewTransitionName = '';
      closeNow();
      source.style.viewTransitionName = 'movie-detail';
    });
  } catch (error) {
    panel.style.viewTransitionName = '';
    detailTransitionActive = false;
    closeNow();
    return true;
  }
  transition.finished.then(() => {
    source.style.viewTransitionName = '';
    detailTransitionActive = false;
  }, () => {
    source.style.viewTransitionName = '';
    detailTransitionActive = false;
  });
  return true;
}

function renderOscarWins(movieId, wins) {
  const body = document.getElementById('detailBody');
  const awards = document.getElementById('detailAwards');
  const modal = document.getElementById('detailModal');
  const movie = movies.find(m => m.id === movieId);
  if (!body || !awards || !modal || modal.classList.contains('hidden')
      || body.dataset.movieId !== String(movieId)
      || !movie || (movie.surprise_by && movie.surprise_by !== currentUser)) return;
  awards.innerHTML = Number.isSafeInteger(wins) && wins > 0
    ? `<span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm"><i class="fa-solid fa-trophy" aria-hidden="true"></i> ${wins} ${wins === 1 ? 'Oscar vinto' : 'Oscar vinti'} <span class="text-xs text-amber-100/70">· OMDb</span></span>`
    : '';
}

function renderMovieDetail(m) {
  const body = document.getElementById('detailBody');
  if (!body) return;

  // Meta-blocco "{anno} • {durata}" su piattaforma (regola card: mai "•" isolato)
  const metaParts = [m.cinema_watchlist ? 'Al cinema / prossimamente' : (m.platform || 'Streaming')];
  if (m.release_year) metaParts.push(String(m.release_year));
  if (m.duration) metaParts.push(m.duration);

  const genreChipsHtml = genreChips(m);
  const ratingsHtml = (m.imdb_rating || m.rt_rating || m.metacritic_rating) ? `
    <div class="rating-holo flex gap-2 px-2 py-1 rounded text-[10px] text-slate-400">
      ${m.imdb_rating ? `<span><i class="fa-solid fa-star text-amber-400"></i> IMDb ${escapeHtml(m.imdb_rating)}</span>` : ''}
      ${m.rt_rating ? `<span class="text-rose-400">RT ${escapeHtml(m.rt_rating)}</span>` : ''}
      ${m.metacritic_rating ? `<span class="text-emerald-400">MC ${escapeHtml(m.metacritic_rating)}</span>` : ''}
    </div>
  ` : '';
  const overviewHtml = m.overview
    ? `<p class="text-sm text-slate-300 leading-relaxed">${escapeHtml(m.overview)}</p>`
    : '';
  const castHtml = (m.cast_names && m.cast_names.length)
    ? `<p class="text-xs text-slate-400 leading-relaxed"><i class="fa-solid fa-masks-theater text-indigo-400 mr-1"></i>${m.cast_names.map(escapeHtml).join(', ')}</p>`
    : '';
  const trailerHtml = m.trailer_url
    ? `<a href="${m.trailer_url}" target="_blank" rel="noopener" class="detail-trailer"><i class="fa-solid fa-play" aria-hidden="true"></i> Guarda il trailer <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`
    : '';

  body.innerHTML = `
    <div class="detail-head">
      <div class="detail-cover">${m.poster ? `<img src="${escapeHtml(m.poster)}" alt="Locandina di ${escapeHtml(m.title)}">` : '<i class="fa-solid fa-film" aria-hidden="true"></i>'}</div>
      <div class="detail-head-copy">
        <div class="detail-head-top"><span class="dashboard-eyebrow">SCHEDA FILM</span><button onclick="closeModal('detailModal')" class="detail-close" aria-label="Chiudi" title="Chiudi"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        <h3 id="detailModalTitle" class="detail-title">${escapeHtml(m.title)}</h3>
        <p class="detail-meta">${metaParts.map(escapeHtml).join(' • ')}</p>
        <div class="detail-genres">${genreChipsHtml}</div>
      </div>
    </div>
    ${m.cinema_watchlist ? '<span class="badge bg-amber-600/80">🎬 Al cinema / prossimamente</span>' : ''}
    ${overviewHtml ? `<section class="detail-section"><h4>La storia</h4>${overviewHtml}</section>` : ''}
    ${castHtml ? `<section class="detail-section"><h4>Nel cast</h4>${castHtml}</section>` : ''}
    ${trailerHtml}
    ${ratingsHtml}
    <div id="detailAwards" aria-live="polite"></div>
    <div class="detail-viewing">${viewingStatusHtml(m)}</div>
    ${reviewCardsHtml(m)}
    ${sagaButtonHtml(m)}
    ${m.status === 'tonight' || m.status === 'watched' ? sharedVoteButtonHtml(m) : ''}
    ${personalVoteButtonHtml(m)}
    <div class="detail-footer">
      ${personBadge(m.added_by)}
      ${m.surprise_by ? `<span class="badge bg-indigo-600/90">🎁 sorpresa di ${escapeHtml(CONFIG.PEOPLE[m.surprise_by]?.label || m.surprise_by)}</span>` : ''}
      ${m.matched === false ? `<span class="badge bg-amber-700/90" title="Nessun riscontro trovato"><i class="fa-solid fa-triangle-exclamation"></i> verifica titolo</span>` : ''}
    </div>
  `;
  body.dataset.movieId = String(m.id);

  // Step3 phase9.1 — ambient (poster sfocato come sfondo del modale).
  setDetailAmbient(m.poster);
  // Step3 phase9.2 — accento perimetrale dal colore dominante del poster.
  applyPosterAccent(m.poster);
}

// Step3 phase9.1 — ambiente visivo del modale dettaglio: usa il poster come
// sfondo sfocato. Poster assente/non valido → solo overlay scuro (fallback).
function setDetailAmbient(posterUrl) {
  const ambient = document.getElementById('detailAmbient');
  if (!ambient) return;
  ambient.style.setProperty('background-image', posterUrl ? `url("${posterUrl.replace(/"/g, '\\"')}")` : 'none');
}

// Step3 phase9.2 — colore dominante del poster (quantizzazione 4 bit/canale).
// Pura e testabile fuori dal DOM: prende i pixel RGBA e ritorna il colore del
// bucket più popolato ({r,g,b}) o null se vuoto/tutto trasparente.
function dominantColorFromData(data) {
  if (!data || !data.length) return null;
  const buckets = new Map();
  for (let i = 0; i + 4 <= data.length; i += 4) {
    const a = data[i + 3] === undefined ? 255 : data[i + 3];
    if (a < 128) continue; // salta pixel trasparenti
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  let best = null, bestCount = 0;
  buckets.forEach((count, key) => { if (count > bestCount) { bestCount = count; best = key; } });
  if (best === null) return null;
  const r = ((best >> 8) & 15) << 4, g = ((best >> 4) & 15) << 4, b = (best & 15) << 4;
  return { r: r + 8, g: g + 8, b: b + 8 };
}

// Applica l'accento perimetrale (bordo/glow) da un poster. L'immagine è
// caricata con crossOrigin="anonymous" (TMDb/OMDb rispondono ACAO:*: il canvas
// non viene tainted). Ogni fallimento è SILENZIOSO: si resta sul bordo indigo
// standard, mai un errore in console, mai un crash.
function applyPosterAccent(posterUrl) {
  const panel = document.getElementById('detailPanel');
  if (!panel) return;
  const clear = () => {
    panel.classList.remove('detail-accent');
    panel.style.setProperty('--detail-accent', '');
  };
  if (!posterUrl || typeof Image === 'undefined') { clear(); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 96;
      const ctx = canvas.getContext('2d');
      if (!ctx) { clear(); return; }
      ctx.drawImage(img, 0, 0, 64, 96);
      const data = ctx.getImageData(0, 0, 64, 96).data;
      const rgb = dominantColorFromData(data);
      if (!rgb) { clear(); return; }
      panel.style.setProperty('--detail-accent', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
      panel.classList.add('detail-accent');
    } catch (e) { clear(); }
  };
  img.onerror = clear;
  img.src = posterUrl;
}
