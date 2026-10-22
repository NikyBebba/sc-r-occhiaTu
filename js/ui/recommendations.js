// Consumer Cosa Guardiamo?: usa solo lo Store già caricato e il Core stabile.
// La vista conserva il proprio snapshot durante Realtime; l'utente decide quando aggiornarlo.
const RecommendationConsumer = (() => {
  const pageSize = RecommendationConfig.diversity.defaultShortlistSize;
  let snapshot = null;

  function sourceSignature() {
    if (typeof targetSessionActive === 'function' && targetSessionActive()) return null;
    const relevant = movies.map(m => [m.id, m.title, m.in_shared_list, m.cinema_watchlist,
      m.genres, m.director, m.cast_names, m.duration, m.release_year, m.collection_id,
      m.seen_rating_n, m.seen_rating_v, m.personal_liked_n, m.personal_liked_v,
      m.seen_rating_together]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const nights = movieNights.map(n => [n.movie_id, n.status]).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
    return JSON.stringify([relevant, nights]);
  }

  function run(excludeMovieIds = []) {
    if (typeof targetSessionActive === 'function' && targetSessionActive()) throw new TypeError('TARGET_RECOMMENDATION_INPUT_REQUIRED');
    const start = performance.now();
    const context = RecommendationAdapters.fromMovies({
      movies,
      movieNights,
      userIds: { N: 'N', V: 'V' },
      groupId: 'shared',
      constraints: { context: 'all', excludeMovieIds }
    });
    const adaptedAt = performance.now();
    const ranked = RecommendationEngine.recommend(context);
    const recommendedAt = performance.now();
    const page = RecommendationEngine.rerank(ranked, pageSize);
    const rerankedAt = performance.now();
    return { page, timings: { adapter: adaptedAt - start, core: recommendedAt - adaptedAt,
      diversity: rerankedAt - recommendedAt }, eligibleCount: ranked.length };
  }

  function calculate() {
    if (typeof targetSessionActive === 'function' && targetSessionActive()) return;
    try {
      if (typeof storeReady !== 'undefined' && !storeReady) {
        snapshot = { status: 'loading', pages: [], signature: null };
        return;
      }
      const result = run();
      snapshot = { status: 'ready', pages: [result.page], shownIds: result.page.map(r => r.movieId),
        signature: sourceSignature(), hasMore: result.eligibleCount > result.page.length,
        timings: result.timings };
    } catch (error) {
      snapshot = { status: 'error', pages: [], signature: null };
      console.error('[sc(r)occhiaTu] Recommendation consumer failed.', error);
    }
  }

  function showMore() {
    if (typeof targetSessionActive === 'function' && targetSessionActive()) return;
    if (!snapshot || snapshot.status !== 'ready' || !snapshot.hasMore) return;
    try {
      const result = run(snapshot.shownIds);
      if (!result.page.length) { snapshot.hasMore = false; return; }
      snapshot.pages.push(result.page);
      snapshot.shownIds.push(...result.page.map(r => r.movieId));
      snapshot.hasMore = result.eligibleCount > result.page.length;
      snapshot.signature = sourceSignature();
    } catch (error) {
      snapshot.status = 'error';
      console.error('[sc(r)occhiaTu] Recommendation consumer failed.', error);
    }
  }

  function reasonCopy(result) {
    const reasons = result.reasons || [];
    const personName = id => id === 'N' ? (CONFIG.PEOPLE.N?.label || 'N') : (CONFIG.PEOPLE.V?.label || 'V');
    for (const [personId, prediction] of Object.entries(result.personal || {})) {
      if (prediction.provenance === 'EXPLICIT_LIKE') return `A ${personName(personId)} è piaciuto.`;
      if (prediction.provenance === 'EXPLICIT_DISLIKE') return `A ${personName(personId)} non è piaciuto.`;
      if (prediction.provenance === 'PERSONAL_RATING_POSITIVE') return `${personName(personId)} gli ha dato un voto positivo.`;
      if (prediction.provenance === 'PERSONAL_RATING_NEUTRAL') return `${personName(personId)} gli ha dato un voto nella fascia neutra.`;
      if (prediction.provenance === 'PERSONAL_RATING_NEGATIVE') return `Il voto di ${personName(personId)} è un segnale negativo.`;
      if (prediction.provenance === 'FEATURE_AFFINITY') return 'Alcuni dettagli richiamano film valutati in precedenza.';
    }
    if (reasons.some(r => r.code === 'TOGETHER_RATING')) return 'Anche i voti condivisi contribuiscono alla proposta.';
    if (reasons.some(r => r.code === 'NEGATIVE_PROTECTION')) return 'Un giudizio personale negativo pesa sulla posizione.';
    return 'Non ci sono ancora abbastanza giudizi per descrivere questa proposta.';
  }

  function evidenceCopy(result) {
    const states = Object.values(result.personal || {}).map(p => p.state);
    if (states.includes('OBSERVED')) return 'Giudizio diretto';
    if (states.includes('INFERRED')) return 'Dai gusti emersi';
    if (states.includes('LOW_EVIDENCE')) return 'Pochi elementi';
    if ((result.reasons || []).some(r => r.code === 'TOGETHER_RATING')) return 'Voti condivisi';
    return 'Ancora da scoprire';
  }

  function cardHtml(result) {
    const movie = movies.find(m => String(m.id) === result.movieId);
    if (!movie) return '';
    const poster = movie.poster ? `<img class="recommendation-poster" src="${escapeHtml(movie.poster)}" alt="" loading="lazy">`
      : '<div class="recommendation-poster" aria-hidden="true"><i class="fa-solid fa-film"></i></div>';
    const details = [evidenceCopy(result), reasonCopy(result)].join(' · ');
    return `<article class="recommendation-card" data-recommendation-id="${jsAttrEscape(result.movieId)}">
      ${poster}<div class="min-w-0"><h3 class="recommendation-title">${escapeHtml(result.title || movie.title)}</h3>
      <p class="recommendation-meta">${escapeHtml(details)}</p></div>
      <button type="button" class="recommendation-open" onclick="openMovieDetail('${jsAttrEscape(result.movieId)}')" aria-label="Apri la scheda di ${jsAttrEscape(result.title || movie.title)}"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
    </article>`;
  }

  function render(active) {
    if (typeof targetSessionActive === 'function' && targetSessionActive()) return;
    if (!active) return;
    const renderStarted = performance.now();
    const section = document.getElementById('recommendationSection');
    const status = document.getElementById('recommendationStatus');
    const results = document.getElementById('recommendationResults');
    const empty = document.getElementById('recommendationEmpty');
    const error = document.getElementById('recommendationError');
    const more = document.getElementById('recommendationMore');
    const stale = document.getElementById('recommendationStale');
    if (!section || !status || !results) return;
    if (snapshot?.status === 'loading' && !(typeof storeReady !== 'undefined' && !storeReady)) calculate();
    if (snapshot?.status === 'ready' && snapshot.signature !== sourceSignature()) snapshot.stale = true;
    results.innerHTML = ''; empty?.classList.add('hidden'); error?.classList.add('hidden');
    more?.classList.add('hidden'); stale?.classList.toggle('hidden', !snapshot?.stale);
    if (!snapshot || snapshot.status === 'loading') {
      section.setAttribute('aria-busy', 'true'); status.textContent = 'Stiamo preparando le proposte…'; return;
    }
    section.setAttribute('aria-busy', 'false');
    if (snapshot.status === 'error') {
      status.textContent = ''; error?.classList.remove('hidden'); return;
    }
    status.textContent = snapshot.pages.flat().length ? 'Le proposte seguono i giudizi disponibili e possono includere film già visti separatamente.' : '';
    const pageRows = snapshot.pages.flat();
    results.innerHTML = pageRows.map(cardHtml).join('');
    if (snapshot && !snapshot.renderMeasured) {
      snapshot.timings.render = performance.now() - renderStarted;
      snapshot.renderMeasured = true;
      if (typeof console !== 'undefined' && console.debug)
        console.debug('[recommendations] timings ms', snapshot.timings);
    }
    if (!pageRows.length) {
      empty.textContent = movies.some(m => m.in_shared_list)
        ? 'Al momento non ci sono film candidabili nella lista condivisa.'
        : 'La lista condivisa è vuota. Aggiungi un film per ricevere proposte.';
      empty.classList.remove('hidden');
    }
    if (snapshot.hasMore) more?.classList.remove('hidden');
  }

  return Object.freeze({ calculate, showMore, render, run, reasonCopy, evidenceCopy,
    getSnapshot: () => snapshot });
})();

function calculateRecommendations() {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return TargetShell.navigate('recommendations'); RecommendationConsumer.calculate(); }
function refreshRecommendations() {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return TargetShell.navigate('recommendations');
  calculateRecommendations();
  renderRecommendationView(true);
}
function showMoreRecommendations() {
  if (typeof targetSessionActive === 'function' && targetSessionActive()) return TargetShell.navigate('recommendations');
  RecommendationConsumer.showMore();
  renderRecommendationView(true);
}
function renderRecommendationView(active) { RecommendationConsumer.render(active); }
