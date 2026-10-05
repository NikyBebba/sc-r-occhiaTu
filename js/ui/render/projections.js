// Hero, countdown e cartellone delle proiezioni.
// Dipende da store/nights e dalle azioni UI; un unico timer resta condiviso.

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
  if (!night) return '';
  const pick = movieProjection(movie, night);
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
      return movie ? movieProjection(movie, n) : null;
    }).filter(Boolean);
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
