// Card della libreria e frammenti condivisi con dettaglio, storico e form.
// Dipende da store/viewing, modals, sagas e dalle azioni proiezione.

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
// Costruzione della card e binding del dettaglio; il coordinatore la inserisce nella griglia.
function createMovieCard(m, vetoedIds) {
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
    return card;
}
