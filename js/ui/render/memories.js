// Titoli di coda: date storiche, riepiloghi e recensioni condivise.
// Dipende da store/nights, store/viewing e dai frammenti delle card.

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
