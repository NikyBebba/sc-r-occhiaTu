#!/usr/bin/env node
// Consumer Recommendation browser checks use a synthetic 437-film snapshot only.
// Usage: node scripts/verify-recommendation-consumer-browser.cjs --playwright=/path/to/playwright --engine=chromium|webkit
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.argv.find(a => a.startsWith('--playwright='))?.slice(13) || 'playwright');
const engine = process.argv.find(a => a.startsWith('--engine='))?.slice(9) || 'chromium';
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };

function fixture() {
  const rows = [];
  for (let i = 0; i < 437; i++) {
    const shared = i < 91;
    rows.push({ id: `m${String(i).padStart(3, '0')}`, title: `Film sintetico ${String(i).padStart(3, '0')}`,
      in_shared_list: shared, cinema_watchlist: i % 11 === 0, seen_n: i < 355, seen_v: i < 12,
      seen_rating_n: i < 20 ? [9, 8, 4, 6][i % 4] : null,
      seen_rating_v: i < 7 ? [8.5, 6, 3][i % 3] : null,
      personal_liked_n: null, personal_liked_v: null,
      seen_rating_together: i < 3 ? [8, 6, 2][i] : null,
      review_text_n: i === 1 ? 'review ignored for scoring' : null,
      review_text_v: null, review_text_together: i === 2 ? 'together review ignored' : null,
      genres: [i % 2 ? 'Dramma' : 'Commedia'], director: `Regista ${i % 7}`,
      cast_names: [`Attore ${i % 9}`], duration: `${90 + i % 100} min`, release_year: 1980 + i % 45,
      collection_id: i % 13 === 0 ? 17 + (i % 3) : null, poster: null });
  }
  return rows;
}

(async () => {
  const html = `<!doctype html><html><head><style>
    .hidden{display:none!important}.recommendation-results{display:grid;gap:8px}.recommendation-card{display:grid;grid-template-columns:62px 1fr auto;gap:10px}
  </style></head><body><section id="recommendationSection" class="hidden" aria-busy="false">
    <p id="recommendationStatus" role="status" aria-live="polite"></p><div id="recommendationStale" class="hidden">Aggiorna?<button onclick="refreshRecommendations()">Aggiorna</button></div>
    <div id="recommendationResults"></div><div id="recommendationEmpty" class="hidden" role="status"></div>
    <div id="recommendationError" class="hidden" role="alert">Non riusciamo a preparare le proposte.</div>
    <button id="recommendationMore" class="hidden" onclick="showMoreRecommendations()">Altri suggerimenti</button>
  </section></body></html>`;
  const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.setContent(html);
    await page.evaluate(({ rows }) => {
      window.CONFIG = { PEOPLE: { N: { label: 'N' }, V: { label: 'V' } } };
      window.movies = rows; window.fixtureRows = rows;
      window.movieNights = [
        { movie_id: 'm000', status: 'completed' }, { movie_id: 'm001', status: 'completed' },
        { movie_id: 'm002', status: 'completed' }, { movie_id: 'm003', status: 'proposed' },
        { movie_id: 'm004', status: 'confirmed' }, { movie_id: 'm005', status: 'cancelled' },
        { movie_id: 'm006', status: 'skipped' }
      ];
      window.currentUser = 'N'; window.dbMode = 'supabase'; window.initialLoadingPending = false; window.storeReady = true;
      window.cancelListingSearch = () => {}; window.clearMatchState = () => {}; window.leaveMatch = () => {};
      window.sb = {}; window.requireAppIdentity = () => {}; window.validMovieRating = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 && Math.round(value * 10) === value * 10;
      window.rejectMovieMutation = () => false; window.lastMovieMutationError = null;
      window.updateMovie = async (id, patch) => {
        const movie = movies.find(m => m.id === id); if (!movie) return false;
        Object.assign(movie, patch);
        if (Object.hasOwn(patch, 'seen_rating_n')) { movie.personal_liked_n = null; movie.personal_liked_updated_at_n = null; }
        if (Object.hasOwn(patch, 'seen_rating_v')) { movie.personal_liked_v = null; movie.personal_liked_updated_at_v = null; }
        return true;
      };
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.jsAttrEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.openedDetail = null; window.openMovieDetail = id => { window.openedDetail = id; };
    }, { rows: fixture() });
    for (const file of ['js/recommendation/config.js','js/recommendation/core.js','js/recommendation/adapters.js','js/ui/recommendations.js'])
      await page.addScriptTag({ content: read(file) });
    await page.addScriptTag({ content: read('js/store/viewing.js') });
    await page.addScriptTag({ content: read('js/ui/navigation.js') });
    await page.evaluate(() => { window.render = () => { document.getElementById('recommendationSection').classList.toggle('hidden', dashboardView !== 'recommendations'); renderRecommendationView(dashboardView === 'recommendations'); }; });

    await check('Home navigation opens the integrated recommendation consumer', async () => {
      await page.evaluate(() => openRecommendationView());
      assert.equal(await page.evaluate(() => dashboardView), 'recommendations');
      assert.equal(await page.locator('#recommendationSection').isVisible(), true);
      assert.equal(await page.evaluate(() => RecommendationConsumer.getSnapshot().status), 'ready');
    });

    await check('Core invoked; shared-list-only candidates; operational exclusions', async () => {
      await page.evaluate(() => { calculateRecommendations(); renderRecommendationView(true); });
      const got = await page.evaluate(() => RecommendationConsumer.getSnapshot());
      assert.equal(got.status, 'ready'); assert(got.pages[0].length > 0);
      const ids = await page.locator('[data-recommendation-id]').evaluateAll(es => es.map(e => e.dataset.recommendationId));
      assert(ids.every(id => Number(id.slice(1)) < 91));
      assert(!ids.includes('m000') && !ids.includes('m001') && !ids.includes('m002') && !ids.includes('m003') && !ids.includes('m004'));
      const eligible = await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).map(r=>r.movieId));
      assert(eligible.includes('m005') && eligible.includes('m006'));
    });
    await check('Visible ordering equals Core diversity output; no UI shuffle', async () => {
      const expected = await page.evaluate(() => RecommendationEngine.rerank(RecommendationEngine.recommend(
        RecommendationAdapters.fromMovies({ movies, movieNights, userIds: {N:'N',V:'V'}, groupId:'shared', constraints:{context:'all',excludeMovieIds:[]} })),
      RecommendationConfig.diversity.defaultShortlistSize).map(r => r.movieId));
      const actual = await page.locator('[data-recommendation-id]').evaluateAll(es => es.map(e => e.dataset.recommendationId));
      assert.deepEqual(actual, expected);
      await page.evaluate(() => { calculateRecommendations(); renderRecommendationView(true); });
      assert.deepEqual(await page.locator('[data-recommendation-id]').evaluateAll(es => es.map(e => e.dataset.recommendationId)), expected);
    });
    await check('Cold-start NULL preferences remain eligible; Seen does not exclude', async () => {
      assert.equal(await page.evaluate(() => movies.filter(m => m.in_shared_list && m.personal_liked_n === null && m.personal_liked_v === null).length), 91);
      const eligible = await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).map(r=>r.movieId));
      assert(eligible.includes('m056') && eligible.includes('m057'));
    });
    await check('Explicit Dislike affects Core but stays eligible; realtime-style recompute', async () => {
      await page.evaluate(() => { movies.find(m => m.id === 'm005').personal_liked_n = false; calculateRecommendations(); renderRecommendationView(true); });
      const state = await page.evaluate(() => RecommendationConsumer.getSnapshot());
      assert.equal(state.status, 'ready');
      assert(await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).some(r=>r.movieId==='m005')));
      assert(state.timings.adapter >= 0 && state.timings.core >= 0 && state.timings.diversity >= 0);
    });
    await check('Rating replacement and removal are taken from current Store snapshot', async () => {
      await page.evaluate(() => { const m=movies.find(m=>m.id==='m005');m.personal_liked_n=true;m.seen_rating_n=8;m.personal_liked_n=null;calculateRecommendations(); });
      let state = await page.evaluate(() => RecommendationConsumer.getSnapshot());
      assert(await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).some(r=>r.movieId==='m005')));
      const ratingObservation = await page.evaluate(() => RecommendationAdapters.fromMovies({movies,movieNights}).personalSignals.N.ratings.some(r=>r.contentId==='m005'&&r.value===8));
      assert(ratingObservation);
      await page.evaluate(() => { const m=movies.find(m=>m.id==='m005');m.seen_rating_n=null;m.personal_liked_n=null;calculateRecommendations(); });
      const noResurrection = await page.evaluate(() => RecommendationAdapters.fromMovies({movies,movieNights}).personalSignals.N.preferences.some(p=>p.contentId==='m005'));
      assert.equal(noResurrection, false);
    });
    await check('Together rating affects Core; review-only does not', async () => {
      const before = await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).map(r=>[r.movieId,r.group.score]));
      await page.evaluate(() => { movies.find(m=>m.id==='m010').review_text_together='A lovely evening'; });
      const reviewOnly = await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).map(r=>[r.movieId,r.group.score]));
      assert.deepEqual(reviewOnly, before);
      await page.evaluate(() => { movies.find(m=>m.id==='m010').seen_rating_together=10; });
      const withTogether = await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).map(r=>[r.movieId,r.group.score]));
      assert.notDeepEqual(withTogether, before);
    });
    await check('Personal Rating / Like / Dislike mutations affect a later computation', async () => {
      const state = await page.evaluate(async () => {
        const m=movies.find(m=>m.id==='m011');m.seen_rating_n=null;m.personal_liked_n=null;
        const like=await setPersonalPreference('m011','N',true);calculateRecommendations();
        const likeSeen=RecommendationAdapters.fromMovies({movies,movieNights}).personalSignals.N.preferences.some(p=>p.contentId==='m011'&&p.value===true);
        const dislike=await setPersonalPreference('m011','N',false);calculateRecommendations();
        const dislikeSeen=RecommendationAdapters.fromMovies({movies,movieNights}).personalSignals.N.preferences.some(p=>p.contentId==='m011'&&p.value===false);
        const rating=await savePersonalReview('m011',0);calculateRecommendations();
        const ratingWins=RecommendationAdapters.fromMovies({movies,movieNights}).personalSignals.N.ratings.some(r=>r.contentId==='m011'&&r.value===0)
          && !RecommendationAdapters.fromMovies({movies,movieNights}).personalSignals.N.preferences.some(p=>p.contentId==='m011');
        const removed=await savePersonalReview('m011',null);calculateRecommendations();
        const noResurrection=!RecommendationAdapters.fromMovies({movies,movieNights}).personalSignals.N.preferences.some(p=>p.contentId==='m011');
        return {like,dislike,rating,removed,likeSeen,dislikeSeen,ratingWins,noResurrection,status:RecommendationConsumer.getSnapshot().status};
      });
      assert.deepEqual(state,{like:true,dislike:true,rating:true,removed:true,likeSeen:true,dislikeSeen:true,ratingWins:true,noResurrection:true,status:'ready'});
    });
    await check('Match-only changes cannot influence stable rankings', async () => {
      const before = await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).map(r=>[r.movieId,r.group.score,r.reasons]));
      await page.evaluate(() => { window.matchHistory = Array.from({length:100},(_,i)=>({movie_id:'m'+String(i%91).padStart(3,'0'),liked:i%2===0,double:i%3===0})); });
      const after = await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).map(r=>[r.movieId,r.group.score,r.reasons]));
      assert.deepEqual(after, before);
    });
    await check('UNKNOWN differs from neutral; no probability percent or synthetic five', async () => {
      await page.evaluate(() => { for(const m of movies){m.seen_rating_n=null;m.seen_rating_v=null;m.personal_liked_n=null;m.personal_liked_v=null;m.seen_rating_together=null;}calculateRecommendations();renderRecommendationView(true); });
      const unknown = await page.evaluate(() => RecommendationConsumer.evidenceCopy(RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).find(r=>r.movieId==='m012')));
      assert(['Ancora da scoprire','Pochi elementi'].includes(unknown));
      const text = await page.locator('#recommendationSection').innerText();
      assert(!/%\s*(match|compatibilit)/i.test(text)); assert(!/5\/10/.test(text));
      await page.evaluate(() => { movies.find(m=>m.id==='m012').seen_rating_n=6;calculateRecommendations(); });
      const neutral = await page.evaluate(() => RecommendationEngine.recommend(RecommendationAdapters.fromMovies({movies,movieNights})).find(r=>r.movieId==='m012')?.personal.N.provenance);
      assert.equal(neutral, 'PERSONAL_RATING_NEUTRAL');
    });
    await check('Other suggestions are deterministic, Core-ranked and never repeat', async () => {
      await page.evaluate(() => { calculateRecommendations(); renderRecommendationView(true); });
      const first = await page.locator('[data-recommendation-id]').evaluateAll(es => es.map(e=>e.dataset.recommendationId));
      await page.locator('#recommendationMore').click();
      const all = await page.locator('[data-recommendation-id]').evaluateAll(es => es.map(e=>e.dataset.recommendationId));
      assert(all.length > first.length); assert.equal(new Set(all).size, all.length);
      const nextExpected = await page.evaluate(ids => RecommendationEngine.rerank(RecommendationEngine.recommend(
        RecommendationAdapters.fromMovies({movies,movieNights,userIds:{N:'N',V:'V'},groupId:'shared',constraints:{context:'all',excludeMovieIds:ids}})),
        RecommendationConfig.diversity.defaultShortlistSize).map(r=>r.movieId), first);
      assert.deepEqual(all.slice(first.length), nextExpected);
    });
    await check('Store changes mark visible ranking stale without jumping; explicit refresh recomputes', async () => {
      await page.evaluate(() => { calculateRecommendations(); renderRecommendationView(true); const m=movies.find(m=>m.id==='m020');m.seen_rating_v=0;renderRecommendationView(true); });
      assert.equal(await page.evaluate(() => RecommendationConsumer.getSnapshot().stale), true);
      assert.equal(await page.locator('#recommendationStale').isVisible(), true);
      await page.locator('#recommendationStale button').click();
      assert.equal(await page.locator('#recommendationStale').isVisible(), false);
    });
    await check('Loading waits for complete Store; empty list and Core errors are isolated', async () => {
      await page.evaluate(() => { storeReady=false;calculateRecommendations();renderRecommendationView(true); });
      assert.match(await page.locator('#recommendationStatus').innerText(), /preparando/);
      await page.evaluate(() => { storeReady=true;renderRecommendationView(true); });
      assert.equal(await page.evaluate(()=>RecommendationConsumer.getSnapshot().status),'ready');
      await page.evaluate(() => { movies.forEach(m=>m.in_shared_list=false);calculateRecommendations();renderRecommendationView(true); });
      assert.match(await page.locator('#recommendationEmpty').innerText(),/lista condivisa è vuota/);
      await page.evaluate(() => { movies[0].in_shared_list=true;movies.push({...movies[0],title:'conflicting duplicate'});calculateRecommendations();renderRecommendationView(true);movies.pop(); });
      assert.equal(await page.locator('#recommendationError').isVisible(),true);
    });
    await check('Detail navigation remains actionable and errors stay in consumer', async () => {
      await page.evaluate(() => { movies=fixtureRows; movies[10].in_shared_list=true; calculateRecommendations();renderRecommendationView(true); });
      const button = page.locator('#recommendationResults .recommendation-open').first();
      if (await button.count()) { const id=await button.evaluate(e=>e.closest('[data-recommendation-id]').dataset.recommendationId);await button.click();assert.equal(await page.evaluate(()=>openedDetail),id); }
      assert.deepEqual(pageErrors, []);
    });
    await check('Synthetic scale performance captured (adapter/profile/core/diversity/render)', async () => {
      const timings = await page.evaluate(() => {
        const t=performance.now(),ctx=RecommendationAdapters.fromMovies({movies:fixtureRows,movieNights,userIds:{N:'N',V:'V'},groupId:'shared',constraints:{context:'all'}}),a=performance.now();
        const normalized=Object.fromEntries(Object.entries(ctx.contentFeatures).map(([id,f])=>[id,RecommendationEngine.normalizeFeatures(f)]));
        RecommendationEngine.buildProfile(ctx.personalSignals.N,normalized);RecommendationEngine.buildProfile(ctx.personalSignals.V,normalized);const p=performance.now();
        const ranked=RecommendationEngine.recommend(ctx),c=performance.now();RecommendationEngine.rerank(ranked,5);const d=performance.now();
        calculateRecommendations();const renderStart=performance.now();renderRecommendationView(true);const render=performance.now()-renderStart;
        return {adapter:a-t,profiles:p-a,core:c-p,diversity:d-c,render};
      });
      assert(Object.values(timings).every(n=>Number.isFinite(n)&&n>=0));
      console.log('PERFORMANCE ms '+JSON.stringify(timings));
    });
    await check('Recommendation Home arrow matches the canonical dashboard back button at supported widths', async () => {
      const source = read('index.html');
      const consumer = source.match(/<button type="button" onclick="openDashboardHome\(\)" class="dashboard-back"[^>]*>[^<]*(?:<i[^>]*><\/i>[^<]*)?(?:<span[^>]*>[\s\S]*?<\/span>)?[\s\S]*?<\/button>/)?.[0];
      const canonical = source.match(/<button id="libraryBack"[^>]*class="dashboard-back"[^>]*>[\s\S]*?<\/button>/)?.[0];
      assert(consumer && canonical, 'real Home buttons found in index.html');
      await page.setContent(`<!doctype html><html><head><style>${read('css/style.css')}</style></head><body tabindex="-1"><div>${consumer}${canonical}</div><script>window.homeHits=0;window.openDashboardHome=()=>window.homeHits++;</script></body></html>`);
      const [home, peer] = [page.locator('button[aria-label="Torna alla home"]'), page.locator('#libraryBack')];
      for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        const state = await page.evaluate(() => {
          const a=document.querySelector('button[aria-label="Torna alla home"]'),b=document.querySelector('#libraryBack');
          const pick=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {height:r.height,minHeight:s.minHeight,padding:s.padding,borderRadius:s.borderRadius,border:s.border,background:s.backgroundColor,font:s.font,display:s.display,alignItems:s.alignItems,gap:s.gap,width:r.width,scrollWidth:document.documentElement.scrollWidth}};
          return {a:pick(a),b:pick(b),text:a.textContent.trim(),classA:a.className,classB:b.className};
        });
        assert.deepEqual(state.a,state.b,`canonical dimensions/styles at ${width}px`);
        assert.equal(state.text,'Torna alla home');
        assert.equal(state.classA,state.classB);
        assert(state.a.height >= 44,`touch target >=44px at ${width}px`);
        assert(state.a.scrollWidth <= width,`no horizontal overflow at ${width}px`);
      }
      assert.match(read('css/style.css'), /:focus-visible\s*\{[^}]*outline:\s*2px solid/);
      await home.focus();
      assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Torna alla home');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>homeHits),1,'keyboard activation preserves Home handler');
      await home.click();
      assert.equal(await page.evaluate(()=>homeHits),2,'pointer activation preserves Home handler');
    });
    await check('Recommendation cards fit narrow and wide viewports with usable detail targets', async () => {
      const section = read('index.html').match(/<section id="recommendationSection"[\s\S]*?<\/section>/)?.[0];
      assert(section, 'actual Cosa Guardiamo? section found');
      await page.setContent(`<!doctype html><html><head><style>${read('css/style.css')}body{margin:0;padding:12px}.recommendation-card{max-width:100%}</style></head><body><main style="max-width:1100px;margin:auto">${section}</main></body></html>`);
      await page.locator('#recommendationSection').evaluate(e=>e.classList.remove('hidden'));
      await page.locator('#recommendationResults').evaluate(e=>{e.innerHTML=Array.from({length:5},(_,i)=>`<article class="recommendation-card" data-recommendation-id="film-${i}"><div class="recommendation-poster" aria-hidden="true"></div><div class="min-w-0"><h3 class="recommendation-title">Una storia cinematografica dal titolo volutamente lungo ${i}</h3><p class="recommendation-meta">Giudizio diretto · Alcuni dettagli richiamano film valutati in precedenza.</p></div><button class="recommendation-open" aria-label="Apri il dettaglio"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></article>`).join('');});
      for (const width of [320,390,768,1280]) {
        await page.setViewportSize({width,height:844});
        const state=await page.evaluate(()=>({viewport:innerWidth,doc:document.documentElement.scrollWidth,section:document.querySelector('#recommendationSection').getBoundingClientRect().width,cards:[...document.querySelectorAll('.recommendation-card')].map(e=>({width:e.getBoundingClientRect().width,scroll:e.scrollWidth,button:e.querySelector('button').getBoundingClientRect().height,title:e.querySelector('h3').getBoundingClientRect().height}))}));
        assert(state.doc<=width,`no horizontal page overflow at ${width}px`);
        assert.equal(state.cards.length,5);
        assert(state.cards.every(c=>c.scroll<=c.width+1),`cards do not overflow at ${width}px`);
        assert(state.cards.every(c=>c.button>=44),`detail touch target >=44px at ${width}px`);
        assert(state.cards.every(c=>c.title>0),`titles remain visible at ${width}px`);
      }
    });
    console.log(`Consumer Recommendation ${engine}: ${checks}/${checks} PASS`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
