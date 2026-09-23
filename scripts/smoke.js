#!/usr/bin/env node
// Harness smoke-test — carica i moduli della SPA con DOM stub e verifica:
// 1) nessun ReferenceError al load/render (struttura modulare)
// 2) api: metadati TMDb (tmdb_id / collection) via chiamate LIVE (se la chiave c'è)
// 3) store modalità LOCALE: serate su movie_nights (quick/propose/confirm/cancel/complete), nextMoviePick
// 4) vote/veto/sorpresa/recensione, helper anti-XSS, findDuplicate
// Uso: node scripts/smoke.js
//
// NOTA: le chiamate live TMDb/OMDb richiedono rete. I controlli di rete non
// stampano mai le chiavi di config.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

// ---------- DOM / surface-stubs ----------
function makeEl(id) {
  const el = {
    id, _value: '', _innerHTML: '', _text: '', className: '', disabled: false,
    style: { setProperty() {} },
    classList: {
      _set: new Set(['hidden']),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }, toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); }
    },
    value: '', dataset: {}, onclick: null, onkeydown: null,
    appendChild() {}, remove() {}, focus() {}, scrollIntoView() {},
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
    set innerHTML(v) { this._innerHTML = String(v); }, get innerHTML() { return this._innerHTML; },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; }
  };
  Object.defineProperty(el, 'value', { get() { return el._value; }, set(v) { el._value = v; }, configurable: true });
  return el;
}

const elements = {};
const elementsById = id => (elements[id] || (elements[id] = makeEl(id)));

const canvasCtx = new Proxy({}, {
  get(t, p) {
    if (p === 'canvas') return { width: 256, height: 256 };
    return () => undefined;
  },
  set() { return true; }
});
elementsById('wheelCanvas').getContext = () => canvasCtx;

const documentStub = {
  getElementById: elementsById,
  createElement: tag => makeEl('el-' + Math.random().toString(36).slice(2)),
  addEventListener() {},
  querySelector() { return makeEl('q'); }
};

const localStore = new Map();
const sessionStore = new Map();
const storageStub = map => ({
  getItem: k => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: k => map.delete(k),
  clear: () => map.clear()
});

const sandbox = {
  window: { addEventListener() {}, supabase: undefined, performance: Date.now },
  document: documentStub,
  localStorage: storageStub(localStore),
  sessionStorage: storageStub(sessionStore),
  console,
  fetch: typeof fetch === 'function' ? fetch : undefined,
  AbortController: typeof AbortController !== 'undefined' ? AbortController : undefined,
  requestAnimationFrame(cb) { return setTimeout(cb, 0); },
  performance: Date.now,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, String, Number, Boolean, Array, Object, Promise,
  encodeURIComponent, decodeURIComponent, URLSearchParams,
  isFinite: Number.isFinite
};
sandbox.isNaN = Number.isNaN;
sandbox.globalThis = sandbox;

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fails.push(name + (extra ? ' :: ' + extra : '')); }
}
async function okA(name, fn) {
  try {
    const v = typeof fn === 'function' ? await fn() : await fn;
    ok(name, v === true, 'returned ' + JSON.stringify(v));
  } catch (e) { ok(name, false, 'threw ' + e.message); }
}

(async () => {
  const sources = [
    'js/config.js',
    'js/api/omdb.js', 'js/api/tmdb.js', 'js/api/index.js',
    'js/store.js', 'js/wheel.js',
    'js/ui/modals.js', 'js/ui/navigation.js', 'js/ui/actions.js', 'js/ui/render.js',
    'js/main.js'
  ].map(f => read(f) + '\n;');

  try {
    vm.createContext(sandbox);
    vm.runInContext(sources.join('\n'), sandbox, { filename: 'app.js' });
    console.log('OK: moduli caricati senza ReferenceError');
  } catch (e) {
    console.log('FATALE caricamento moduli:', e.message);
    process.exit(1);
  }

  const run = fn => vm.runInContext(`(${fn.toString()})()`, sandbox);
  const runA = fn => vm.runInContext(`(async()=>{ return (${fn.toString()})(); })()`, sandbox);

  // --- 0) guardie / load ---
  console.log('\n[guardie + load]');
  ok('tmdbConfigured() true', run(() => tmdbConfigured()));
  ok('omdbConfigured() true', run(() => omdbConfigured()));
  ok('senza supabase → dbMode local', run(() => dbMode === 'local'));
  ok('subscribeRealtime no-op (nessun canale)', run(() => { subscribeRealtime(); return realtimeChannel === null; }));
  ok('unsubscribeRealtime no-crash', run(() => { unsubscribeRealtime(); return true; }));
  await okA('loadMovies (locale vuoto) non crasha', runA(async () => { await loadMovies(); return true; }));
  ok('render() non crasha su stato vuoto', run(() => { render(); return true; }));

  // --- 1) store locale: film + serate su movie_nights ---
  console.log('\n[store locale — film]');
  await okA('insertMovie aggiunge + persiste in localStorage', runA(async () => {
    await insertMovie({ title: 'Inception', added_by: 'N', status: 'watchlist' });
    return movies.length === 1 && JSON.parse(localStorage.getItem('scorochiatu_movies')).length === 1;
  }));
  await okA('insertMovie genera id', runA(async () => { await insertMovie({ title: 'Interstellar', added_by: 'V', status: 'watchlist' }); return movies.length === 2 && movies[1].id != null; }));
  ok('findDuplicate normalizza il titolo', run(() => findDuplicate('  INCEPTION ')?.id === movies[0].id));

  console.log('\n[store locale — serate movie_nights]');
  await okA('setQuickTonight crea serata confirmed (date null) + mirror', runA(async () => {
    const id = movies[0].id;
    currentUser = 'N';
    await setQuickTonight(id);
    const n = movieNights.find(x => x.movie_id === id);
    const m = movies.find(x => x.id === id);
    return n && n.status === 'confirmed' && n.date === null && m.status === 'tonight' && m.night_confirmed === false;
  }));

  await okA('nextMoviePick pick veloce → shape compatibile box', run(() => {
    const pick = nextMoviePick();
    return pick && pick.id === movies[0].id && pick.night_confirmed === true && pick.scheduled_date === null;
  }));

  await okA('proposeNight crea serata proposed + mirror legacy', runA(async () => {
    const id = movies[1].id;
    await proposeNight(id, 'V', '2026-10-01', '21:30', '🍕 Pizza');
    const n = movieNights.find(x => x.movie_id === id);
    const m = movies.find(x => x.id === id);
    return n && n.status === 'proposed' && n.snack === '🍕 Pizza' && m.scheduled_date === '2026-10-01' && m.night_confirmed === false;
  }));

  await okA('nextMoviePick dà priorità alla serata con data', runA(async () => {
    await confirmNight(movies[1].id);
    const pick = nextMoviePick();
    return pick.id === movies[1].id && pick.scheduled_date === '2026-10-01' && pick.night_confirmed === true;
  }));

  await okA('confirmNight segna confirmed_at + confirmed', run(() => {
    const n = movieNights.find(x => x.movie_id === movies[1].id);
    return n.status === 'confirmed' && !!n.confirmed_at;
  }));

  await okA('completeNight → completed + completed_at', runA(async () => {
    await completeNight(movies[1].id);
    const n = movieNights.find(x => x.movie_id === movies[1].id);
    return n.status === 'completed' && !!n.completed_at;
  }));

  await okA('nextMoviePick ignora serate completate (torna a quella con data)', run(() => {
    const pick = nextMoviePick();
    return pick && pick.id === movies[0].id; // resta la quick pick valida
  }));

  await okA('cancelNight → cancelled + mirror watchlist pulito', runA(async () => {
    const id = movies[1].id;
    await proposeNight(id, 'N', '2026-10-15', '21:30', null);
    await cancelNight(id);
    const n = movieNights.find(x => x.movie_id === id && x.status === 'cancelled');
    const m = movies.find(x => x.id === id);
    return n && m.status === 'watchlist' && m.proposed_by === null && m.scheduled_date === null;
  }));

  await okA('storico: stesso film può avere più serate', run(() => {
    return movieNights.filter(x => x.movie_id === movies[1].id).length === 2;
  }));

  // --- 2) vote / veto / sorpresa / recensione in locale ---
  console.log('\n[store locale — vote / veto / sorpresa]');
  await okA('castVote like + refetch locale', runA(async () => {
    await castVote(movies[0].id, 'N', true);
    await castVote(movies[0].id, 'V', true);
    const v = getVotesForMovie(movies[0].id);
    return v.N === true && v.V === true;
  }));
  await okA('addVeto settimanale (1 per persona)', runA(async () => {
    const a = await addVeto('N', movies[0].id);
    const b = await addVeto('N', movies[1].id);
    return a === true && b === false && vetoUsedThisWeek('N') === true && vetoedMovieIdsThisWeek().includes(movies[0].id);
  }));
  await okA('setSurprise + reveal', runA(async () => {
    await setSurprise(movies[0].id, 'V');
    const sur = movies.find(x => x.id === movies[0].id).surprise_by === 'V';
    await revealSurprise(movies[0].id);
    return sur && movies.find(x => x.id === movies[0].id).surprise_by === null;
  }));
  await okA('proposeMovie/acceptProposal', runA(async () => {
    await proposeMovie({ title: 'Proposal Test', matched: true }, 'V');
    const p = movies.find(x => x.title === 'Proposal Test');
    if (!p) return false;
    await acceptProposal(p.id);
    return movies.find(x => x.id === p.id).status === 'watchlist';
  }));

  // --- 3) api TMDb metadata (live, senza stampare chiavi) ---
  console.log('\n[api — metadati TMDb]');
  await okA('fetchTmdbDetailsById espone tmdb_id + collection (The Dark Knight, Batman Collection)', runA(async () => {
    const d = await fetchTmdbDetailsById(155);
    return Boolean(d && d.tmdb_id === 155 && d.collection_id === 263 && d.collection_name && d.matched === true);
  }));
  await okA('fetchMovieDetails espone tmdb_id + collection anche in bulk', runA(async () => {
    const d = await fetchMovieDetails('The Dark Knight');
    return Boolean(d && d.tmdb_id === 155 && d.collection_name);
  }));
  await okA('fetchMovieDetails titolo fittizio → matched false + tmdb_id null', runA(async () => {
    const d = await fetchMovieDetails('ZZZQuestoTitoloNonEsiste98765ZZZ');
    return d && d.matched === false && d.tmdb_id === null && d.collection_id === null;
  }));
  await okA('candidati picker hanno id numerico', runA(async () => {
    const c = await searchTmdbCandidates('Interstellar');
    return Array.isArray(c) && c.length > 0 && typeof c[0].id === 'number';
  }));

  // --- 4) ui aggiunta film (locale) via applyResolvedDetails ---
  console.log('\n[ui — aggiunta con metadati]');
  await okA('applyResolvedDetails (add) persiste tmdb_id', runA(async () => {
    pickerMode = 'add'; pendingAddedBy = 'N';
    await applyResolvedDetails({ title: 'Tenet', tmdb_id: 577922, collection_id: null, collection_name: null, duration: '150 min', platform: 'P', poster: '', trailerUrl: '', matched: true, imdbRating: '7.3', rtRating: '', metacriticRating: '' });
    const m = movies.find(x => x.tmdb_id === 577922);
    return Boolean(m && m.collection_id === null);
  }));
  await okA('applyResolvedDetails (retry) aggiorna metadati', runA(async () => {
    const target = movies[0];
    pickerMode = 'retry'; pickerTargetId = target.id;
    await applyResolvedDetails({ title: target.title, tmdb_id: 999, collection_id: 666, collection_name: 'Saga', duration: '120 min', platform: 'S', poster: '', trailerUrl: '', matched: true, imdbRating: '', rtRating: '', metacriticRating: '' });
    const m = movies.find(x => x.id === target.id);
    return m.tmdb_id === 999 && m.collection_name === 'Saga';
  }));

  // --- 5) modal helpers ---
  console.log('\n[modali + anti-XSS]');
  ok('openModal/closeModal gestiscono le classi', run(() => { openModal('x'); closeModal('x'); return true; }));
  ok('escapeHtml neutralizza tag', run(() => escapeHtml('<script>').indexOf('&lt;script&gt;') !== -1));
  ok('jsAttrEscape neutralizza apici', run(() => jsAttrEscape("O'Brien").indexOf("\\'") !== -1));

  console.log(`\n=== RISULTATO: ${pass}/${pass + fail} PASS ===`);
  if (fails.length) { console.log('FAIL:', fails.join('\n  ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('Harness crash:', e); process.exit(1); });