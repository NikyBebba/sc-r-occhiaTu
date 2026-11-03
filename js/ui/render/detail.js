// Scheda film: contenuti, Oscar su richiesta, transizioni e accento poster.
// Riusa i frammenti delle card e il ciclo openModal/closeModal esistente.

// ============================================
// Step3 phase9 — dettaglio film (modale)
// Apre il modale #detailModal e popola #detailBody con i metadati del film.
// Usa i campi già in memoria; solo gli Oscar sono letti su richiesta.
// ============================================
let detailReturnFocus = null;
let detailTransitionSource = null;
let detailTransitionActive = false;

function restoreMovieDetailFocus() {
  const id = document.getElementById('detailBody')?.dataset.movieId;
  const replacement = [...document.querySelectorAll('#movieGrid [data-movie-id], #statsModal [data-history-movie], [data-projection-movie]')]
    .find(node => (node.dataset.movieId || node.dataset.historyMovie || node.dataset.projectionMovie) === id)
    ?.querySelector('h3 button, h5 button');
  const target = detailReturnFocus?.isConnected ? detailReturnFocus : replacement || document.getElementById('libraryBack');
  target?.focus?.({preventScroll:true});
}

function canTransitionMovieDetail(source) {
  return !!(source && source.isConnected && document.startViewTransition
    && (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches));
}

function openMovieDetail(id, sourceCard, context = null, nightId = null, openNights = false) {
  if (!context && typeof targetSessionActive === 'function' && targetSessionActive()) return TargetShell.detail(id, sourceCard);
  if (detailTransitionActive) return;
  const m = context ? context.movies.find(x => x.id === id) : movies.find(x => x.id === id);
  if (!m || (context ? context.hidden(m) : m.surprise_by && m.surprise_by !== currentUser)) return;
  renderMovieDetail(m, context);
  detailReturnFocus = context && sourceCard ? (sourceCard.matches?.('button,a,[tabindex]') ? sourceCard : sourceCard.querySelector?.('h3 button') || sourceCard) : sourceCard || document.activeElement;
  const panel = document.getElementById('detailPanel');
  const revealNight = () => { if (context && (nightId || openNights)) context.openDetailNights(nightId); };
  if (panel && canTransitionMovieDetail(sourceCard) && !detailTransitionActive) {
    detailTransitionActive = true;
    detailTransitionSource = sourceCard;
    sourceCard.style.viewTransitionName = 'movie-detail';
    let transition;
    try {
      transition = document.startViewTransition(() => {
        if(context && !context.current()) return;
        sourceCard.style.viewTransitionName = '';
        openModal('detailModal');
        revealNight();
        syncDetailStoryOverflow();
        panel.style.viewTransitionName = 'movie-detail';
      });
    } catch (error) {
      sourceCard.style.viewTransitionName = '';
      detailTransitionActive = false;
      detailTransitionSource = null;
      openModal('detailModal');
      revealNight();
      syncDetailStoryOverflow();
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
    revealNight();
    syncDetailStoryOverflow();
  }
  if (!context && m.tmdb_id) fetchOscarWins(m.tmdb_id).then(wins => renderOscarWins(m.id, wins));
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

// The story control reflects actual line clamping at the current panel width.
// The modal is measured only after it becomes visible; resize rechecks it.
function syncDetailStoryOverflow() {
  const modal=document.getElementById('detailModal');
  if(!modal||modal.classList.contains('hidden'))return;
  const section=modal.querySelector('[data-detail-story]');
  const copy=section?.querySelector('.detail-story-copy');
  const button=section?.querySelector('[data-story-toggle]');
  if(!copy||!button)return;
  const expanded=section.classList.contains('is-expanded');
  if(expanded)section.classList.remove('is-expanded');
  const clipped=copy.clientHeight>0&&copy.scrollHeight>copy.clientHeight+1;
  if(expanded&&clipped)section.classList.add('is-expanded');
  button.hidden=!clipped;
  button.textContent=expanded&&clipped?'Mostra meno':'Leggi tutto';
  button.setAttribute('aria-expanded',String(expanded&&clipped));
}
if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('resize',syncDetailStoryOverflow);

function renderMovieDetail(m, context = null) {
  const body = document.getElementById('detailBody');
  if (!body) return;

  const sameMovie=body.dataset.movieId===String(m.id);
  const openDisclosures=context&&sameMovie?[...body.querySelectorAll('details[open]')].map(node=>node.dataset.nightId||node.dataset.detailDisclosure||(node.hasAttribute('data-detail-nights')?'nights':'more')):[];
  const expandedStory=context&&sameMovie&&body.querySelector('[data-detail-story]')?.classList.contains('is-expanded');
  const expandedCast=context&&sameMovie&&body.querySelector('[data-detail-cast]')?.classList.contains('is-expanded');
  const focused=context&&sameMovie&&body.contains?.(document.activeElement)?{text:document.activeElement.textContent,tag:document.activeElement.tagName}:null;
  const panelScroll=sameMovie?document.getElementById('detailPanel')?.scrollTop:0;
  body.classList.toggle('target-film-detail',!!context);

  // Meta-blocco "{anno} • {durata}" su piattaforma (regola card: mai "•" isolato)
  const metaParts = [m.cinema_watchlist ? 'Al cinema / prossimamente' : (m.platform || 'Streaming')];
  if (m.release_year) metaParts.push(String(m.release_year));
  if (m.duration) metaParts.push(m.duration);

  const genreChipsHtml = genreChips(m);
  const ratingsHtml = externalRatingsHtml(m,!!context);
  const overviewText=typeof m.overview==='string'?m.overview.trim():'';
  const castNames=Array.isArray(m.cast_names)?m.cast_names.filter(name=>typeof name==='string'&&name.trim()):[];
  const overviewHtml = overviewText
    ? `<p class="text-sm text-slate-300 leading-relaxed">${escapeHtml(overviewText)}</p>`
    : '';
  const castHtml = castNames.length
    ? `<p class="text-xs text-slate-400 leading-relaxed"><i class="fa-solid fa-masks-theater text-indigo-400 mr-1"></i>${castNames.map(escapeHtml).join(', ')}</p>`
    : '';
  const storySection=context&&overviewText?`<section class="detail-story" data-detail-story><h4>La storia</h4><p id="detailStoryCopy" class="detail-story-copy is-clamped">${escapeHtml(overviewText)}</p><button type="button" class="detail-content-toggle" data-story-toggle aria-controls="detailStoryCopy" aria-expanded="false" hidden>Leggi tutto</button></section>`:'';
  const castSection=context&&castNames.length?`<section class="detail-cast" data-detail-cast><h4>Cast</h4><ul id="detailCastList">${castNames.map(name=>`<li>${escapeHtml(name)}</li>`).join('')}</ul>${castNames.length>6?'<button type="button" class="detail-content-toggle" data-cast-toggle aria-controls="detailCastList" aria-expanded="false">Vedi tutto il cast</button>':''}</section>`:'';
  const trailerHtml = m.trailer_url
    ? `<a href="${escapeHtml(m.trailer_url)}" target="_blank" rel="noopener" class="detail-trailer"><i class="fa-solid fa-play" aria-hidden="true"></i> Guarda il trailer <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`
    : '';

  body.innerHTML = `
    <div class="detail-head">
      <div class="detail-cover">${m.poster ? `<img src="${escapeHtml(m.poster)}" alt="Locandina di ${escapeHtml(m.title)}">` : '<i class="fa-solid fa-film" aria-hidden="true"></i>'}</div>
      <div class="detail-head-copy">
        <div class="detail-head-top"><span class="dashboard-eyebrow">SCHEDA FILM</span><button onclick="closeModal('detailModal')" class="detail-close" aria-label="Chiudi" title="Chiudi"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        <h3 id="detailModalTitle" class="detail-title">${escapeHtml(m.title)}</h3>
        <p class="detail-meta">${metaParts.map(escapeHtml).join(' • ')}</p>
        ${m.director?`<p class="detail-meta card-director">Regia di ${escapeHtml(m.director)}</p>`:''}
        ${genreChipsHtml?`<div class="detail-genres card-genres">${genreChipsHtml}</div>`:''}
        ${context?ratingsHtml:''}
      </div>
      ${context||trailerHtml?`<div class="detail-header-actions">${context?`<div class="detail-token-row">${context.viewingStatusHtml(m)}</div>`:''}${trailerHtml}</div>`:''}
    </div>
    ${!context&&m.cinema_watchlist ? '<span class="badge bg-amber-600/80">🎬 Al cinema / prossimamente</span>' : ''}
    ${context ? `${storySection}${castSection}<p id="detailFeedback" role="status" class="detail-feedback"></p>${context.detailActions(m)}` : `
    ${overviewHtml ? `<section class="detail-section"><h4>La storia</h4>${overviewHtml}</section>` : ''}
    ${castHtml ? `<section class="detail-section"><h4>Nel cast</h4>${castHtml}</section>` : ''}
    ${ratingsHtml}
    <div id="detailAwards" aria-live="polite"></div>
    <div class="detail-viewing">${viewingStatusHtml(m)}</div>${reviewCardsHtml(m)}`}
    ${context ? '' : sagaButtonHtml(m)}
    ${context ? '' : `
${nightIsDue(activeNightForMovie(m.id)) || togetherSeen(m) ? sharedVoteButtonHtml(m) : ''}
    ${personalWatchButtonHtml(m)}
    ${personalRemovalButtonsHtml(m)}
    ${rewatchActionsHtml(m)}
    <div class="flex gap-2 mt-3"><button class="min-h-11 px-3 bg-indigo-600/20 rounded" onclick="quickTonightUI('${jsAttrEscape(m.id)}')">Oggi</button><button class="min-h-11 px-3 bg-slate-800 rounded" onclick="scheduleMovie('${jsAttrEscape(m.id)}')">Programma</button></div>
    <div id="detailVetoAction">${detailVetoActionHtml(m)}</div>
    `}
    <div class="detail-footer">
      ${(context ? context.personBadge : personBadge)(m.added_by)}
      ${m.surprise_by ? `<span class="badge bg-indigo-600/90">🎁 sorpresa di ${escapeHtml(CONFIG.PEOPLE[m.surprise_by]?.label || m.surprise_by)}</span>` : ''}
      ${m.matched === false ? `<span class="badge bg-amber-700/90" title="Nessun riscontro trovato"><i class="fa-solid fa-triangle-exclamation"></i> verifica titolo</span>` : ''}
    </div>
  `;
  body.dataset.movieId = String(m.id);
  if (context) {
    context.bind(body);
    for(const [selector,toggleSelector,expanded,openLabel,closedLabel] of [
      ['[data-detail-story]','[data-story-toggle]',expandedStory,'Mostra meno','Leggi tutto'],
      ['[data-detail-cast]','[data-cast-toggle]',expandedCast,'Mostra meno','Vedi tutto il cast']]){
      const section=body.querySelector(selector),button=section?.querySelector(toggleSelector);
      if(!section||!button)continue;
      if(expanded)section.classList.add('is-expanded');
      button.textContent=expanded?openLabel:closedLabel;
      button.setAttribute('aria-expanded',String(!!expanded));
      button.onclick=()=>{const open=section.classList.toggle('is-expanded');button.textContent=open?openLabel:closedLabel;button.setAttribute('aria-expanded',String(open));};
    }
    body.querySelectorAll('details').forEach(node=>{
      const key=node.dataset.nightId||node.dataset.detailDisclosure||(node.hasAttribute('data-detail-nights')?'nights':'more');
      if(openDisclosures.includes(key))node.open=true;
    });
    if(focused){const replacement=[...body.querySelectorAll('button,summary,a')].find(node=>node.tagName===focused.tag&&node.textContent===focused.text)||body.querySelector('[data-detail-primary]');replacement?.focus({preventScroll:true});}
    document.getElementById('detailPanel').scrollTop=panelScroll||0;
    syncDetailStoryOverflow();
  }

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
