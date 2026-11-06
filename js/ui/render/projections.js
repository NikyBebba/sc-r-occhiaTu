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

function renderNextMovieBox(now = new Date(), context = null) {
  if (!context && typeof targetSessionActive === 'function' && targetSessionActive()) return;
  const box = document.getElementById('nextMovieBox');
  if (!box) return;
  const hero = document.getElementById('nextMovieHero');
  const tonight = context ? null : tonightPick(now);
  const rawPick = (context ? context.homeNightPick : homeNightPick)(now);
  const sourceMovie = (context ? context.movies : movies).find(m => m.id === rawPick?.id);
  const pick = rawPick && (context ? sourceMovie && context.hidden(sourceMovie) : sourceMovie?.surprise_by && sourceMovie.surprise_by !== currentUser)
    ? { ...rawPick, title: 'Film a sorpresa', poster: null } : rawPick;
  if (hero) {
    if(context)hero.classList.remove('!hidden');
    hero.classList.toggle('hidden', !pick || currentTab === 'match' || (dashboardView === 'library' && currentTab === 'calendar'));
    hero.classList.toggle('is-tonight', context ? !!pick?.night_confirmed : !!tonight);
  }
  if (!pick) {
    box.innerHTML = '';
    return;
  }

  const pending = context ? !pick.night_confirmed : pick.proposed_by && !pick.night_confirmed;
  const countdown = context && !pick.scheduled_date ? (pending ? 'Proposta in attesa' : 'Da vedere insieme') : nextMovieTimeLabel(pick, now.getTime());
  const countdownHtml = escapeHtml(countdown);
  const dateHtml = pick.scheduled_date ? escapeHtml(formatNightDate(pick.scheduled_date, pick.scheduled_time)) : '';
  const safeId = jsAttrEscape(pick.id);
  const safeTitle = jsAttrEscape(pick.title);
  const nightTarget = pick.nightId ? `, '${jsAttrEscape(pick.nightId)}'` : '';
  const pickMovie = (context ? context.movies : movies).find(m => m.id === pick.id) || {};

  let actionsHtml = '';
  if (context) actionsHtml = context.eventActions(context.nights.find(n=>n.id===pick.nightId));
  else {
  if (pending && pick.proposed_by === (context ? context.callerLabel : currentUser)) {
    actionsHtml = `<p class="text-sm text-amber-200">In attesa che ${escapeHtml(CONFIG.PEOPLE[pick.proposed_by === 'N' ? 'V' : 'N']?.label || '...')} confermi</p>
      <button onclick="cancelNightUI('${safeId}', '${safeTitle}'${nightTarget})" class="next-movie-action next-movie-secondary">Annulla proposta</button>`;
  } else if (pending && pick.proposed_by !== (context ? context.callerLabel : currentUser)) {
    actionsHtml = `<p class="text-sm text-sky-200">Proposto da ${escapeHtml(CONFIG.PEOPLE[pick.proposed_by]?.label || pick.proposed_by)}</p>
      <button onclick="confirmNightUI('${safeId}'${nightTarget})" class="next-movie-action next-movie-primary">Accetta proposta</button>
      <button onclick="cancelNightUI('${safeId}', '${safeTitle}'${nightTarget})" class="next-movie-action next-movie-secondary">Rifiuta</button>`;
  } else {
    actionsHtml = `${(context ? context.due : nightIsDue)((context ? context.nights : movieNights).find(n => n.id === pick.nightId), now) ? `<button onclick="finishTogetherNightUI('${safeId}'${nightTarget})" class="next-movie-action next-movie-primary">Completa serata</button>` : ''}
      <button onclick="cancelNightUI('${safeId}', '${safeTitle}'${nightTarget})" class="next-movie-action next-movie-secondary">Annulla proiezione</button>`;
  }

  }
  if (!context && pick.nightId) actionsHtml += `<button onclick="editNightDetailsUI('${safeId}'${nightTarget})" class="next-movie-action next-movie-secondary">Snack e luogo</button>`;

  // Step4 phase18 — ticket per la proposta DIRETTA: il bottone appare SOLO se
  // l'origine è stata marcata in-memory come 'manual' in QUESTA sessione di
  // navigazione (markTicketOrigin in quickTonightUI/confirmSchedule della
  // card). Match Live e Ruota hanno il proprio bottone Ticket nelle loro viste
  // (% o timbro dedicato); qui mai un'% inventata.
  if (!context && typeof ticketOriginOf === 'function' && ticketOriginOf(pick.id) === 'manual') {
    actionsHtml += `<button onclick="downloadTicket('${safeId}', 'manual')" class="next-movie-action next-movie-secondary">🎟️ Ticket</button>`;
  }

  box.innerHTML = `
    <div class="next-movie-content${pending ? ' is-pending' : ''}" data-home-night-id="${escapeHtml(pick.nightId || '')}">
      <div class="next-movie-poster">
        ${pick.poster ? `<img src="${escapeHtml(pick.poster)}" alt="Locandina di ${escapeHtml(pick.title)}">` : '<i class="fa-solid fa-film" aria-hidden="true"></i>'}
      </div>
      <div class="next-movie-info">
        <p class="dashboard-eyebrow next-movie-status"><i class="fa-solid ${pending ? 'fa-hourglass-half' : 'fa-ticket'}" aria-hidden="true"></i>${context ? (pending ? 'PROPOSTA · IN ATTESA' : pick.scheduled_date ? 'SERATA APERTA' : 'FILM SCELTO') : tonight ? (pending ? 'OGGI · PROPOSTA' : 'OGGI SI GUARDA') : (pending ? 'PROPOSTA DI PROIEZIONE' : 'IN PROGRAMMA')}</p>
        <h2>${escapeHtml(pick.title)}</h2>
        <div class="next-movie-timing"><p class="next-movie-date">${countdownHtml}</p>${dateHtml && countdown.startsWith('⏳') ? `<p class="next-movie-when"><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${dateHtml}</p>` : ''}</div>
        ${pick.snack ? `<p class="next-movie-snack">🍿 ${escapeHtml(pick.snack)}</p>` : ''}
        ${pick.location ? `<p class="next-movie-snack"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(pick.location)}</p>` : ''}
        <div class="next-movie-actions">${actionsHtml}</div>
        ${(context ? context.sagaButtonHtml : sagaButtonHtml)(pickMovie)}
      </div>
    </div>
  `;
  if (context) context.bind(box);
}

function projectionActionsHtml(pick, now = new Date(), { showCompletion = true } = {}) {
  const id = jsAttrEscape(pick.id);
  const title = jsAttrEscape(pick.title);
  const target = pick.nightId ? `, '${jsAttrEscape(pick.nightId)}'` : '';
  if (pick.proposed_by && !pick.night_confirmed) {
    if (pick.proposed_by !== currentUser) return `<button onclick="confirmNightUI('${id}'${target})" class="projection-accept">Accetta proposta</button><button onclick="cancelNightUI('${id}', '${title}'${target})">Rifiuta</button>`;
    return `<span class="projection-wait">In attesa di conferma</span><button onclick="cancelNightUI('${id}', '${title}'${target})">Annulla proposta</button>`;
  }
  return showCompletion && nightIsDue(movieNights.find(n => n.id === pick.nightId), now) ? `<button onclick="finishTogetherNightUI('${id}'${target})" class="projection-accept">Completa serata</button><button onclick="cancelNightUI('${id}', '${title}'${target})">Annulla proiezione</button>` : '';
}

function projectionInfoHtml(movie, context = null) {
  const night = context ? context.active(movie.id) : activeNightForMovie(movie.id);
  if (!night) return '';
  const pick = context ? {...context.movieProjection(movie,night),nightId:night.id} : movieProjection(movie, night);
  if (movie.surprise_by && movie.surprise_by !== (context ? context.callerLabel : currentUser)) pick.title = 'Film a sorpresa';
  const pending = pick.proposed_by && !pick.night_confirmed;
  return `<div class="projection-card-info"><p><i class="fa-solid ${pending ? 'fa-hourglass-half' : 'fa-calendar-check'}" aria-hidden="true"></i> ${pending ? 'Proposta da confermare' : pick.scheduled_date ? 'Proiezione in programma' : 'FILM SCELTO'} · ${pick.scheduled_date ? escapeHtml(formatNightDate(pick.scheduled_date, pick.scheduled_time)) : 'Da vedere insieme'}</p>
    ${pick.snack ? `<p>🍿 ${escapeHtml(pick.snack)}</p>` : ''}
    ${pick.location ? `<p><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(pick.location)}</p>` : ''}
    <div class="projection-actions">${context ? context.eventActions(night) : projectionActionsHtml(pick, new Date(), { showCompletion: false })}${!context && night ? `<button onclick="editNightDetailsUI('${jsAttrEscape(movie.id)}', '${jsAttrEscape(night.id)}')">Snack e luogo</button>` : ''}</div></div>`;
}

function renderScheduled(now = new Date(), context = null, mount = null, entriesOverride = null) {
  if (!context && typeof targetSessionActive === 'function' && targetSessionActive()) return;
  const container = mount || document.getElementById('scheduledList');
  const panel = mount ? null : document.getElementById('scheduledPanel');
  if (!container) return;
  const pick = mount ? null : (context ? context.homeNightPick : homeNightPick)(now);
  const active = (context ? context.activeNights : activeNights)();
  if (context && !mount) {
    // Home is a doorway, not the agenda. Keep every other event reachable;
    // agenda grouping, sorting and event editors are unchanged until UX-6.
    const others = active.filter(n => n.id !== pick?.nightId).length;
    if (panel) { panel.classList.remove('!hidden'); panel.classList.toggle('hidden', !others); }
    const label = others === 1 ? 'Un’altra serata/scelta aperta' : 'Altre ' + others + ' serate/scelte aperte';
    container.innerHTML = others ? context.action(label + ' <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>', () => setTab('tonight'), 'home-open-events') : '';
    context.bind(container);
    return;
  }
  const entries = entriesOverride || active.filter(n => n.id !== pick?.nightId)
    .map(n => {
      const movie = (context ? context.movies : movies).find(m => m.id === n.movie_id);
      return movie ? (context ? context.movieProjection : movieProjection)(movie, n) : null;
    }).filter(Boolean);
  if(!entriesOverride)entries.sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''));
  if (panel) { if(context)panel.classList.remove('!hidden');panel.classList.toggle('hidden', !entries.length || currentTab === 'match'); }
  const renderEntry = m => {
    const hidden = context ? context.hidden(m) : m.surprise_by && m.surprise_by !== currentUser;
    const title = hidden ? 'Film a sorpresa' : m.title;
    const actionPick = { ...m, title };
    const night = (context ? context.nights : movieNights).find(n => n.id === m.nightId);
    const quick = context && night?.status === 'confirmed' && !m.scheduled_date;
    return `<article class="upcoming-projection" data-projection-movie="${escapeHtml(m.id)}" data-night-id="${escapeHtml(m.nightId || '')}">
      <div class="upcoming-projection-copy"><p class="dashboard-eyebrow">${quick ? 'FILM SCELTO' : m.proposed_by && !m.night_confirmed ? 'PROPOSTA' : (context ? context.due : nightIsDue)(night, now) ? 'DA CONCLUDERE' : 'PROSSIMA PROIEZIONE'}</p><h3>${escapeHtml(title)}</h3>
      <p>${quick ? 'Da vedere insieme' : escapeHtml(formatNightDate(m.scheduled_date, m.scheduled_time))}${!hidden && (m.cinema_watchlist || m.platform) ? ' · ' + escapeHtml(m.cinema_watchlist ? 'Al cinema' : m.platform) : ''}${m.snack ? ' · ' + escapeHtml(m.snack) : ''}</p>
      ${m.location ? `<p><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(m.location)}</p>` : ''}</div>
      <div class="projection-actions">${context && m.nightId ? context.action('Apri serata', () => context.openNight(m.nightId), 'next-movie-action next-movie-secondary', {'aria-haspopup':'dialog'}) : ''}${context ? context.eventActions(night) : projectionActionsHtml(actionPick, now)}${!context && m.nightId ? `<button onclick="editNightDetailsUI('${jsAttrEscape(m.id)}', '${jsAttrEscape(m.nightId)}')">Snack e luogo</button>` : ''}</div>
    </article>`;
  };
  if (context && mount) {
    const groups = [
      ['Da concludere', n => n.status === 'confirmed' && !!n.date && context.due(n)],
      ['Proposte in attesa', n => n.status === 'proposed'],
      ['Scelte senza data', n => n.status === 'confirmed' && !n.date],
      ['Prossime serate', n => n.status === 'confirmed' && !!n.date && !context.due(n)]
    ];
    container.innerHTML = groups.map(([title, belongs]) => {
      const rows = entries.filter(m => { const n = context.nights.find(n => n.id === m.nightId); return n && belongs(n); });
      return rows.length ? `<section class="col-span-full" aria-label="${title}"><h3 class="text-lg font-semibold text-slate-100 mb-3">${title}</h3><div class="space-y-3">${rows.map(renderEntry).join('')}</div></section>` : '';
    }).join('');
  } else container.innerHTML = entries.map(renderEntry).join('');
  if (context) { context.bind(container); context.bindHistory(container); }
}
