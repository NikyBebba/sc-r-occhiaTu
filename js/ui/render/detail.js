// Scheda film: contenuti, Oscar su richiesta, transizioni e accento poster.
// Riusa i frammenti delle card e il ciclo openModal/closeModal esistente.

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
