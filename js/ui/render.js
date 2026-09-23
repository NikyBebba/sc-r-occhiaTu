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
    box.innerHTML = `<p class="text-xs text-slate-500 italic">Nessun film scelto per la prossima serata: gira la ruota, fate match o proponete una sera.</p>`;
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
      countdownHtml = `📅 ${pick.scheduled_date} ore ${pick.scheduled_time || '21:30'}`;
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
        <img src="${pick.poster || 'https://via.placeholder.com/60x90/1e293b/64748b?text=?'}" class="w-12 h-16 object-cover rounded">
        <div class="flex-1">
          <div class="font-bold text-slate-100 text-sm">${escapeHtml(pick.title)}</div>
          <div class="text-[11px] text-slate-400">${countdownHtml}${pick.snack ? ' • ' + escapeHtml(pick.snack) : ''}</div>
        </div>
      </div>
      ${actionsHtml}
    </div>
  `;
}

// ---- Il Nostro Cinema — statistiche + timeline recensioni ----
function renderStats() {
  const watched = movies.filter(m => m.status === 'watched');
  const totalWatched = watched.length;
  const avgRating = totalWatched
    ? (watched.reduce((s, m) => s + (m.rating || 0), 0) / totalWatched).toFixed(1)
    : '—';

  const genreCounts = {};
  movies.forEach(m => { if (m.genre) genreCounts[m.genre] = (genreCounts[m.genre] || 0) + 1; });
  const topGenre = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a])[0];

  const matchable = movies.filter(m => {
    const v = getVotesForMovie(m.id);
    return v.N !== undefined && v.V !== undefined;
  });
  const matches = matchable.filter(m => {
    const v = getVotesForMovie(m.id);
    return v.N === v.V;
  });
  const matchPct = matchable.length ? Math.round((matches.length / matchable.length) * 100) : null;

  const cards = [
    { label: 'Film visti insieme', value: totalWatched },
    { label: 'Voto medio', value: avgRating === '—' ? '—' : `⭐ ${avgRating}` },
    { label: 'Mood preferito', value: topGenre ? MOOD_LABELS[topGenre] : '—' },
    { label: 'Match sui gusti', value: matchPct === null ? '—' : `${matchPct}%` }
  ];
  document.getElementById('statsGrid').innerHTML = cards.map(c => `
    <div class="p-4 bg-slate-900/80 rounded-xl border border-slate-800 text-center">
      <div class="text-xl font-bold text-slate-100">${c.value}</div>
      <div class="text-[10px] text-slate-500 mt-1">${c.label}</div>
    </div>
  `).join('');

  const reviewed = watched.filter(m => m.review_text)
    .sort((a, b) => new Date(b.scheduled_date || b.created_at) - new Date(a.scheduled_date || a.created_at));
  const timeline = document.getElementById('reviewTimeline');
  if (reviewed.length === 0) {
    timeline.innerHTML = `<p class="text-xs text-slate-500 italic">Ancora nessuna recensione.</p>`;
  } else {
    timeline.innerHTML = reviewed.map(m => `
      <div class="timeline-item">
        <div class="text-sm font-bold text-slate-100">${escapeHtml(m.title)}</div>
        <div class="text-[10px] text-slate-500">${m.scheduled_date || ''} • ${'⭐'.repeat(m.rating || 0)} • ${m.review_by === 'both' ? 'Insieme' : (CONFIG.PEOPLE[m.review_by]?.label || m.review_by)}</div>
        <div class="text-xs text-slate-300 italic mt-1">"${escapeHtml(m.review_text)}"</div>
      </div>
    `).join('');
  }
}

// ---- Render principale ----
function render() {
  const grid = document.getElementById('movieGrid');
  grid.innerHTML = '';

  const statusFilter = currentTab;
  const filtered = movies.filter(m => m.status === statusFilter);
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-500 text-sm">Nessun film in questa sezione.</div>`;
  }

  const vetoedIds = vetoedMovieIdsThisWeek();

  filtered.forEach(m => {
    const isSurpriseHidden = m.surprise_by && m.surprise_by !== currentUser;
    const poster = m.poster || 'https://via.placeholder.com/300x450/1e293b/64748b?text=No+Cover';
    const isVetoed = vetoedIds.includes(m.id);
    const card = document.createElement('div');
    card.className = "glass rounded-xl overflow-hidden border border-slate-800 flex flex-col justify-between" + (isVetoed ? ' card-vetoed' : '');

    const votesObj = getVotesForMovie(m.id);
    const bothVoted = votesObj.N !== undefined && votesObj.V !== undefined;
    const matchHtml = bothVoted
      ? (votesObj.N === votesObj.V
          ? `<span class="match-yes text-[10px] font-bold"><i class="fa-solid fa-heart"></i> Match!</span>`
          : `<span class="match-no text-[10px] font-bold"><i class="fa-solid fa-heart-crack"></i> Gusti diversi</span>`)
      : '';

    card.innerHTML = `
      <div class="relative h-48 bg-slate-900 overflow-hidden">
        <img src="${poster}" class="w-full h-full object-cover ${isSurpriseHidden ? 'surprise-blur' : ''}">
        ${isSurpriseHidden ? `
          <div class="surprise-overlay bg-black/40">
            <div class="text-2xl">🎁</div>
            <div class="text-xs text-slate-100 font-semibold">Sorpresa di ${CONFIG.PEOPLE[m.surprise_by]?.label || m.surprise_by}</div>
            <button onclick="revealSurpriseUI('${m.id}')" class="mt-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-medium">Rivela</button>
          </div>
        ` : ''}
        <div class="absolute top-2 right-2 flex flex-col gap-1 items-end">
          ${personBadge(m.added_by)}
          ${m.matched === false ? `<span class="badge bg-amber-500/90" title="Nessun riscontro trovato su TMDb/OMDb, titolo forse errato"><i class="fa-solid fa-triangle-exclamation"></i> verifica</span>` : ''}
          ${m.surprise_by === currentUser ? `<span class="badge bg-indigo-500/90">🎁 tua sorpresa</span>` : ''}
          ${isVetoed ? `<span class="badge bg-rose-500/90">vietato</span>` : ''}
        </div>
        ${!isSurpriseHidden ? `<div class="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-slate-300 backdrop-blur">
          <i class="fa-solid fa-tv text-indigo-400"></i> ${escapeHtml(m.platform || 'Streaming')} • ${escapeHtml(m.duration || '')}
        </div>` : ''}
        ${(m.trailer_url && !isSurpriseHidden) ? `<a href="${m.trailer_url}" target="_blank" rel="noopener" class="absolute bottom-2 right-2 px-2 py-1 bg-red-600/80 hover:bg-red-500 rounded text-[10px] text-white backdrop-blur"><i class="fa-solid fa-play"></i> Trailer</a>` : ''}
      </div>
      <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-bold text-slate-100 text-base leading-snug">${isSurpriseHidden ? '???' : escapeHtml(m.title)}</h3>
            <button onclick="deleteMovieConfirm('${m.id}', '${jsAttrEscape(m.title)}')" class="text-slate-600 hover:text-rose-400 transition shrink-0" title="Rimuovi">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            ${m.genre ? `<span class="text-[10px] text-slate-400">${MOOD_LABELS[m.genre] || m.genre}</span>` : ''}
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
          ${(currentTab === 'watchlist' || currentTab === 'tonight') ? `
            <div class="flex items-center gap-2">
              <button onclick="voteMovie('${m.id}', true)" class="px-2 py-1 rounded ${votesObj[currentUser] === true ? 'bg-emerald-600/60 text-white' : 'bg-slate-800 text-slate-400 hover:text-emerald-300'}"><i class="fa-solid fa-thumbs-up"></i></button>
              <button onclick="voteMovie('${m.id}', false)" class="px-2 py-1 rounded ${votesObj[currentUser] === false ? 'bg-rose-600/60 text-white' : 'bg-slate-800 text-slate-400 hover:text-rose-300'}"><i class="fa-solid fa-thumbs-down"></i></button>
              <span class="text-[10px] text-slate-500">voto tuo</span>
            </div>
          ` : ''}
          ${currentTab === 'watchlist' ? `
            <div class="flex gap-2">
              <button onclick="quickTonightUI('${m.id}')" class="flex-1 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded font-medium">Stasera</button>
              <button onclick="scheduleMovie('${m.id}')" class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"><i class="fa-solid fa-calendar"></i></button>
              ${!isVetoed ? `<button onclick="vetoMovie('${m.id}', '${jsAttrEscape(m.title)}')" class="px-2 py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-300 rounded" title="Vieta questa settimana"><i class="fa-solid fa-ban"></i></button>` : ''}
            </div>
          ` : ''}
          ${currentTab === 'tonight' ? `
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
  drawWheel();
}

function renderScheduled() {
  const container = document.getElementById('scheduledList');
  container.innerHTML = '';
  const scheduled = movies.filter(m => m.scheduled_date);
  if (scheduled.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500 italic">Nessun film programmato.</p>`;
    return;
  }
  scheduled.forEach(m => {
    container.innerHTML += `
      <div class="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs flex justify-between items-center">
        <div>
          <div class="font-bold text-slate-200">${escapeHtml(m.title)}</div>
          <div class="text-slate-400 text-[10px]"><i class="fa-regular fa-clock"></i> ${m.scheduled_date} ore ${m.scheduled_time || '21:30'} ${m.snack ? '• ' + escapeHtml(m.snack) : ''}</div>
        </div>
        <span class="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-medium">${escapeHtml(m.platform || '')}</span>
      </div>
    `;
  });
}