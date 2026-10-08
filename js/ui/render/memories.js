// Stato esclusivamente in memoria, indipendente dai dati e dalle preferenze.
let memoriesState = { sections: new Map(), initialized: false, fresh: true, reviewLimit: 10 };
function resetMemoriesState() {
  memoriesState = { sections: new Map(), initialized: false, fresh: true, reviewLimit: 10 };
}
function memoryIsOpen(key, fallback = false) {
  return memoriesState.sections.has(key) ? memoriesState.sections.get(key) : fallback;
}
function rememberMemorySection(key, open, element) {
  if (element?.isConnected === false || !isAppAuthorized()) return;
  memoriesState.sections.set(key, open);
  element?.querySelector('summary')?.setAttribute('aria-expanded', String(open));
}
function memoryDetails(key, label, count, body) {
  const open = memoryIsOpen(key);
  return `<details data-memory-key="${escapeHtml(key)}" class="memory-section" ${open ? 'open' : ''} ontoggle="rememberMemorySection('${jsAttrEscape(key)}', this.open, this)">
    <summary id="memorySummary-${escapeHtml(encodeURIComponent(key))}" class="memory-summary" aria-expanded="${open}"><span>${escapeHtml(label)}</span><span class="text-xs text-slate-400">${count} ${count === 1 ? 'serata' : 'serate'}</span></summary>${body}</details>`;
}
function showMoreReviews() {
  const firstNew = memoriesState.reviewLimit;
  memoriesState.reviewLimit += 10;
  renderStats();
  document.querySelectorAll('#reviewTimeline .review-item')[firstNew]?.focus({ preventScroll: true });
}

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
  if (!memoriesState.initialized) {
    const latest = entries.find(entry => entry.timelineDate)?.timelineDate.key.slice(0, 7);
    if (latest) {
      memoriesState.sections.set('year:' + latest.slice(0, 4), true);
      memoriesState.sections.set('month:' + latest, true);
      memoriesState.initialized = true;
    }
  }
  const groups = new Map();
  entries.forEach(entry => {
    const monthKey = entry.timelineDate ? entry.timelineDate.key.slice(0, 7) : '';
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey).push(entry);
  });
  const years = new Map();
  const months = [...groups].map(([monthKey, group]) => {
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
    const html = memoryDetails('month:' + monthKey, monthLabel, group.length,
      `<div class="memory-body grid grid-cols-1 sm:grid-cols-2 gap-3">${cards}</div>`);
    if (monthKey) {
      const year = monthKey.slice(0, 4);
      if (!years.has(year)) years.set(year, { count: 0, months: [] });
      years.get(year).count += group.length;
      years.get(year).months.push(html);
      return '';
    }
    return html;
  });
  container.innerHTML = [...years].map(([year, group]) => memoryDetails('year:' + year,
    year, group.count, `<div class="memory-body space-y-3">${group.months.join('')}</div>`)).join('')
    + months.join('');
}

// ---- Il Nostro Cinema — statistiche + recensioni senza data ----
function renderStats() {
  // toggle è asincrono: acquisire anche lo stato DOM prima di sostituire i nodi.
  if (!memoriesState.fresh) document.querySelectorAll('#statsModal [data-memory-key]').forEach(element => {
    memoriesState.sections.set(element.dataset.memoryKey, element.open);
  });
  memoriesState.fresh = false;
  const focusId = document.activeElement?.closest?.('#statsModal') ? document.activeElement.id : null;
  const historySection = document.getElementById('nightHistorySection');
  const reviewsSection = document.getElementById('reviewSection');
  if (historySection) {
    historySection.open = memoryIsOpen('history', true);
    historySection.querySelector?.('summary')?.setAttribute('aria-expanded', String(historySection.open));
  }
  if (reviewsSection) {
    reviewsSection.open = memoryIsOpen('reviews');
    reviewsSection.querySelector?.('summary')?.setAttribute('aria-expanded', String(reviewsSection.open));
  }
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
  const count = document.getElementById('reviewCount');
  if (count) count.textContent = `${reviewed.length} film`;
  const timeline = document.getElementById('reviewTimeline');
  if (reviewed.length === 0) {
    timeline.innerHTML = `<p class="text-xs text-slate-400 italic">Ancora nessun voto o recensione.</p>`;
  } else {
    timeline.innerHTML = reviewed.slice(0, memoriesState.reviewLimit).map(({ movie: m, text: review, score }) => {
      const key = 'review:' + m.id;
      const open = memoryIsOpen(key);
      const id = 'reviewItem-' + encodeURIComponent(m.id);
      const heading = `<span class="text-sm font-bold text-slate-100">${escapeHtml(m.title)}</span>
        ${score !== null ? `<span class="text-xs text-amber-300">★ ${formatMovieRating(score)}/10</span>` : ''}`;
      return review ? `<details data-memory-key="${escapeHtml(key)}" id="${escapeHtml(id)}" tabindex="-1" class="timeline-item review-item" ${open ? 'open' : ''} ontoggle="rememberMemorySection('${jsAttrEscape(key)}', this.open, this)">
        <summary id="${escapeHtml(id)}-toggle" class="memory-summary" aria-expanded="${open}">${heading}</summary>
        <div class="review-copy text-sm text-slate-300 italic mt-1">“${escapeHtml(review)}”</div>
      </details>` : `<div id="${escapeHtml(id)}" tabindex="-1" class="timeline-item review-item">${heading}</div>`;
    }).join('') + (reviewed.length > memoriesState.reviewLimit
      ? `<button id="reviewsMore" type="button" class="memory-more" onclick="showMoreReviews()">Mostra altre (${reviewed.length - memoriesState.reviewLimit})</button>` : '');
  }
  if (focusId) {
    const target = document.getElementById(focusId) || document.getElementById('nightHistoryTitle');
    target?.focus?.({ preventScroll: true });
  }
}
