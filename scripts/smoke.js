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
    value: '', dataset: {}, onclick: null, onkeydown: null, onmousedown: null,
    _handlers: {},
    addEventListener(ev, cb) { (this._handlers[ev] = this._handlers[ev] || []).push(cb); },
    removeEventListener(ev, cb) {
      const arr = this._handlers[ev] || [];
      this._handlers[ev] = arr.filter(x => x !== cb);
    },
    _children: [],
    appendChild(c) { this._children.push(c); }, remove() {}, focus() {}, scrollIntoView() {},
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; },
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
    set innerHTML(v) { this._innerHTML = String(v); this._children = []; }, get innerHTML() { return this._innerHTML + this._children.map(c => (c._innerHTML || '')).join(''); },
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

// Mock sb MINIMALE per il test "ordine dei <script> di index.html": servono le
// letture di fetchLatestMatchState (select/order/limit/eq) e l'insert di
// startNewSession. Host-side: iniettato SOLO nel contesto vm isolato come
// `mockSb` (mai nel contesto principale, dove c'è mockMatchSb).
function buildBrowserOrderMockSb(seed) {
  const root = {
    swipe_sessions: (seed && seed.sessions ? seed.sessions : []).map(s => Object.assign({}, s)),
    swipes: (seed && seed.swipes ? seed.swipes : []).map(s => Object.assign({}, s)),
    movies: (seed && seed.movies ? seed.movies : []).map(s => Object.assign({}, s))
  };
  const rowsOf = name => (root[name] || (root[name] = []));
  return {
    from(name) {
      const b = { _eq: null, _order: null, _limit: null };
      b.select = function () { return b; };
      b.order = function (c) { b._order = c; return b; };
      b.limit = function (n) { b._limit = n; return b; };
      b.eq = function (c, v) { b._eq = { c, v }; return b; };
      b.in = function () { return b; };
      b.insert = function (rows) {
        return { select: async () => ({
          data: rows.map((r, i) => Object.assign({ id: name + '-' + (rowsOf(name).length + i + 1), created_at: new Date().toISOString() }, r)),
          error: null
        }) };
      };
      b.update = function (patch) {
        return {
          eq(c, v) { b._eq = { c, v }; return this; },
          in() { return this; },
          select: async () => {
            let rows = rowsOf(name).slice();
            if (b._eq) rows = rows.filter(r => r[b._eq.c] === b._eq.v);
            rows.forEach(r => Object.assign(r, patch));
            return { data: rows.map(r => Object.assign({}, r)), error: null };
          }
        };
      };
      b.then = function (resolve) {
        let rows = rowsOf(name).slice();
        if (b._eq) rows = rows.filter(r => r[b._eq.c] === b._eq.v);
        if (b._order) rows = rows.slice().sort((x, y) => String(x[b._order] || '').localeCompare(String(y[b._order] || '')));
        if (b._limit != null) rows = rows.slice(0, b._limit);
        return Promise.resolve(resolve({ data: rows.map(r => Object.assign({}, r)), error: null }));
      };
      return b;
    },
    channel() { throw new Error('canale non usato nel test browser-order'); },
    removeChannel() { return Promise.resolve(); },
    getChannels() { return []; }
  };
}

const sandbox = {
  window: { addEventListener() {}, supabase: undefined, performance: Date.now },
  document: documentStub,
  localStorage: storageStub(localStore),
  sessionStorage: storageStub(sessionStore),
  location: { reload() {} },
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
    'js/format.js',
    'js/api/omdb.js', 'js/api/tmdb.js', 'js/api/index.js',
    'js/store.js', 'js/match.js', 'js/filters.js', 'js/wheel.js',
    'js/ui/modals.js', 'js/ui/navigation.js', 'js/ui/actions.js', 'js/ui/render.js', 'js/ui/calendar.js',
    'js/ui/match.js',
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

  // --- 0b) formatNightDate (helper DOM-free) ---
  console.log('\n[formatNightDate]');
  ok('date null → "Stasera" (con/senza time, stringa vuota)', run(() =>
    formatNightDate(null, '21:30') === 'Stasera' && formatNightDate(null, null) === 'Stasera'
    && formatNightDate('', '21:30') === 'Stasera' && formatNightDate(undefined, '21:30') === 'Stasera'));
  ok('data valida + orario semplice e con secondi', run(() =>
    formatNightDate('2026-10-24', '21:30') === '24 ott · 21:30'
    && formatNightDate('2026-10-24', '21:30:00') === '24 ott · 21:30'));
  ok('orario assente o vuoto → solo data, mai orario inventato', run(() =>
    formatNightDate('2026-10-24', null) === '24 ott' && formatNightDate('2026-10-24', '') === '24 ott'));
  ok('leading zeros normalizzati (giorno + ora)', run(() =>
    formatNightDate('2026-10-05', '9:05:00') === '5 ott · 09:05'
    && formatNightDate('2026-1-3', '21:30') === '3 gen · 21:30'));
  ok('formato non valido / mese fuori range / orario non time → fallback al dato grezzo o solo data', run(() =>
    formatNightDate('banana', '21:30') === 'banana'
    && formatNightDate('2026-13-01', '21:30') === '2026-13-01'
    && formatNightDate('2026-00-01', '21:30') === '2026-00-01'
    && formatNightDate('24/10/2026', '21:30') === '24/10/2026'
    && formatNightDate('2026-10', '21:30') === '2026-10'
    && formatNightDate('2026-10-24', 'banana') === '24 ott'
    && formatNightDate('2026-10-24', '12') === '24 ott'));

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
  await okA('castVote: riclick dello stesso voto lo rimuove (toggle locale)', runA(async () => {
    await castVote('vote-extra', 'N', true);
    const liked = getVotesForMovie('vote-extra').N === true;
    await castVote('vote-extra', 'N', true); // stesso voto: annulla
    const removed = votes.filter(v => v.movie_id === 'vote-extra').length === 0;
    return liked && removed;
  }));
  await okA('castVote: switch like→dislike sostituisce senza duplicati', runA(async () => {
    await castVote('vote-extra', 'N', false);
    return getVotesForMovie('vote-extra').N === false
      && votes.filter(v => v.movie_id === 'vote-extra').length === 1;
  }));
  await okA('castVote su Supabase: riclick dello stesso voto fa DELETE (mock sb)', runA(async () => {
    const rows = [];
    const mockFrom = table => {
      if (table !== 'votes') throw new Error('mock: solo votes');
      return {
        upsert: async incoming => {
          for (const r of incoming) {
            const i = rows.findIndex(x => x.movie_id === r.movie_id && x.person === r.person);
            if (i >= 0) rows[i] = { ...rows[i], ...r };
            else rows.push({ id: 'mock-' + (rows.length + 1), ...r });
          }
          return { error: null };
        },
        select: () => ({ then: resolve => resolve({ data: rows.map(r => ({ ...r })), error: null }) }),
        delete: () => {
          const q = {
            where: {},
            eq(column, value) { this.where[column] = value; return this; },
            then: resolve => {
              for (let i = rows.length - 1; i >= 0; i--) {
                const r = rows[i];
                if (Object.keys(q.where).every(k => r[k] === q.where[k])) rows.splice(i, 1);
              }
              resolve({ error: null });
            }
          };
          return q;
        }
      };
    };
    const prevSb = sb, prevMode = dbMode, prevVotes = votes;
    const prevLSVotes = localStorage.getItem('scorochiatu_votes');
    sb = { from: mockFrom }; dbMode = 'supabase';
    try {
      await castVote('m-vote', 'N', true);   // insert
      const inserted = rows.length === 1 && rows[0].liked === true;
      await castVote('m-vote', 'N', true);   // stesso voto: delete su Supabase
      const deleted = rows.length === 0 && getVotesForMovie('m-vote').N === undefined;
      await castVote('m-vote', 'N', false);  // switch; ancora una riga, niente dup
      const switched = rows.length === 1 && rows[0].liked === false;
      return inserted && deleted && switched;
    } finally {
      sb = prevSb; dbMode = prevMode; votes = prevVotes;
      if (prevLSVotes === null) localStorage.removeItem('scorochiatu_votes');
      else localStorage.setItem('scorochiatu_votes', prevLSVotes);
    }
  }));
  await okA('addVeto settimanale (1 per persona)', runA(async () => {
    const a = await addVeto('N', movies[0].id);
    const b = await addVeto('N', movies[1].id);
    return a === true && b === false && vetoUsedThisWeek('N') === true && vetoedMovieIdsThisWeek().includes(movies[0].id);
  }));
  await okA('vetoForMovieThisWeek: solo la settimana corrente (niente passato)', runA(async () => {
    const prevV = vetoes, prevLS = localStorage.getItem('scorochiatu_vetoes');
    vetoes = [
      ...(prevV || []),
      { id: 'past-veto', person: 'N', movie_id: 'xyz-movie', week_key: '2020-W01' }
    ];
    localStorage.removeItem('scorochiatu_vetoes');
    try {
      const currentV = vetoForMovieThisWeek(movies[0].id);
      const pastV = vetoForMovieThisWeek('xyz-movie');
      const missing = vetoForMovieThisWeek('id-missing');
      return currentV !== null && currentV.person === 'N' && pastV === null && missing === null;
    } finally {
      vetoes = prevV;
      if (prevLS === null) localStorage.removeItem('scorochiatu_vetoes');
      else localStorage.setItem('scorochiatu_vetoes', prevLS);
    }
  }));
  await okA('removeVeto: solo il proprietario, id mancanti no-op, slot liberato', runA(async () => {
    const wk = currentWeekKey();
    const prevV = vetoes, prevLS = localStorage.getItem('scorochiatu_vetoes');
    vetoes = [
      { id: 'v1', person: 'N', movie_id: 'mv-veto', week_key: wk },
      { id: 'v2', person: 'V', movie_id: 'mv-veto2', week_key: wk }
    ];
    localStorage.removeItem('scorochiatu_vetoes');
    try {
      const notOwn = await removeVeto('V', 'mv-veto');       // veto di N
      const missing = await removeVeto('N', 'mv-missing');   // riga inesistente
      const own = await removeVeto('N', 'mv-veto');          // ok
      const slotFreed = vetoUsedThisWeek('N') === false;
      const reAdd = await addVeto('N', 'mv-veto');           // posto di nuovo libero
      const otherIntact = vetoes.some(v => v.id === 'v2');   // veto di V intatto
      return notOwn === false && missing === false && own === true
        && slotFreed && reAdd === true && otherIntact;
    } finally {
      vetoes = prevV;
      if (prevLS === null) localStorage.removeItem('scorochiatu_vetoes');
      else localStorage.setItem('scorochiatu_vetoes', prevLS);
    }
  }));
  await okA('removeVeto Supabase: delete per id + refetch coerente', runA(async () => {
    const wk = currentWeekKey();
    const prevSb = sb, prevMode = dbMode, prevV = vetoes;
    const prevLS = localStorage.getItem('scorochiatu_vetoes');
    const rows = [{ id: 'vx', person: 'N', movie_id: 'mv-x', week_key: wk }];
    const mk = table => {
      if (table !== 'vetoes') throw new Error('mock: solo vetoes');
      const q = {
        where: {},
        eq(c, v) { q.where[c] = v; return q; },
        select() { return q; },
        then(resolve) {
          const removed = rows.filter(r => Object.keys(q.where).every(k => r[k] === q.where[k]));
          for (const r of removed) rows.splice(rows.indexOf(r), 1);
          return resolve({ data: removed.map(r => ({ ...r })), error: null });
        }
      };
      return {
        delete() { return q; },
        select() { return { then: resolve => resolve({ data: rows.map(r => ({ ...r })), error: null }) }; }
      };
    };
    sb = { from: mk }; dbMode = 'supabase';
    vetoes = [{ id: 'vx', person: 'N', movie_id: 'mv-x', week_key: wk }];
    localStorage.removeItem('scorochiatu_vetoes');
    try {
      const removed = await removeVeto('N', 'mv-x');
      return removed === true && rows.length === 0 && vetoes.length === 0;
    } finally {
      sb = prevSb; dbMode = prevMode; vetoes = prevV;
      if (prevLS === null) localStorage.removeItem('scorochiatu_vetoes');
      else localStorage.setItem('scorochiatu_vetoes', prevLS);
    }
  }));
  await okA('removeVeto Supabase: delete 0 righe → no-op, stato locale intatto, nessun errore', runA(async () => {
    const wk = currentWeekKey();
    const prevSb = sb, prevMode = dbMode, prevV = vetoes;
    const prevLS = localStorage.getItem('scorochiatu_vetoes');
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => errs.push(a.map(String).join(' '));
    const rows = []; // DB già senza la riga (cancellata altrove)
    const mk = table => {
      if (table !== 'vetoes') throw new Error('mock: solo vetoes');
      const q = {
        where: {},
        eq(c, v) { q.where[c] = v; return q; },
        select() { return q; },
        then(resolve) {
          const removed = rows.filter(r => Object.keys(q.where).every(k => r[k] === q.where[k]));
          for (const r of removed) rows.splice(rows.indexOf(r), 1);
          return resolve({ data: removed.map(r => ({ ...r })), error: null });
        }
      };
      return {
        delete() { return q; },
        select() { return { then: resolve => resolve({ data: rows.map(r => ({ ...r })), error: null }) }; }
      };
    };
    sb = { from: mk }; dbMode = 'supabase';
    vetoes = [{ id: 'vx', person: 'N', movie_id: 'mv-x', week_key: wk }]; // locale stantio
    localStorage.removeItem('scorochiatu_vetoes');
    try {
      const res = await removeVeto('N', 'mv-x');
      const localIntact = vetoes.length === 1 && vetoes[0].id === 'vx';
      return res === true && localIntact && errs.length === 0;
    } finally {
      console.error = origErr;
      sb = prevSb; dbMode = prevMode; vetoes = prevV;
      if (prevLS === null) localStorage.removeItem('scorochiatu_vetoes');
      else localStorage.setItem('scorochiatu_vetoes', prevLS);
    }
  }));
  await okA('setSurprise + reveal', runA(async () => {
    await setSurprise(movies[0].id, 'V');
    const sur = movies.find(x => x.id === movies[0].id).surprise_by === 'V';
    await revealSurprise(movies[0].id);
    return sur && movies.find(x => x.id === movies[0].id).surprise_by === null;
  }));
  await okA('setSurprise/reveal NON toccano movie_nights', runA(async () => {
    const before = JSON.stringify(movieNights.map(n => ({ id: n.id, status: n.status })));
    await setSurprise(movies[1].id, 'V');
    await revealSurprise(movies[1].id);
    const after = JSON.stringify(movieNights.map(n => ({ id: n.id, status: n.status })));
    return before === after;
  }));
  ok('render: "Annulla sorpresa" visibile SOLO al creatore (e id escapato)', run(() => {
    const m = movies.find(x => x.status === 'watchlist');
    if (!m) return false;
    const prevUser = currentUser;
    m.surprise_by = 'N';
    currentTab = 'watchlist';
    currentUser = 'V';
    render();
    const away = document.getElementById('movieGrid').innerHTML.indexOf('Annulla sorpresa') === -1;
    currentUser = 'N';
    render();
    const html = document.getElementById('movieGrid').innerHTML;
    const mine = html.indexOf('Annulla sorpresa') !== -1
      && html.indexOf(`revealSurpriseUI('${m.id}')`) !== -1;
    m.surprise_by = null;
    currentUser = prevUser;
    return away && mine;
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

  // --- 3b) api generi/durata: oggetti canned, nessuna rete ---
  console.log('\n[api — generi + durata (canned)]');
  await okA('buildTmdbDetails (canned, niente imdb_id → nessuna rete) espone genres + duration + overview + cast', runA(async () => {
    const d = await buildTmdbDetails({ id: 11, title: 'T', runtime: 92, overview: 'Trama it.', genres: [{ id: 35, name: 'Commedia' }, { id: 18, name: 'Dramma' }], credits: { cast: Array.from({ length: 10 }, (_, i) => ({ name: 'Att' + i, order: i })) }, 'watch/providers': { results: {} }, videos: { results: [] } }, 'T');
    return d.genres.join() === 'Commedia,Dramma' && d.duration === '92 min'
      && d.overview === 'Trama it.'
      && Array.isArray(d.cast_names) && d.cast_names.length === 8 && d.cast_names.join() === 'Att0,Att1,Att2,Att3,Att4,Att5,Att6,Att7';
  }));
  await okA('buildTmdbDetails (canned) overview assente e cast vuoto → entrambi null', runA(async () => {
    const d = await buildTmdbDetails({ id: 13, title: 'T4', runtime: 100, overview: '', credits: { cast: [] }, 'watch/providers': { results: {} }, videos: { results: [] } }, 'T4');
    return d.overview === null && d.cast_names === null;
  }));
  await okA('buildTmdbDetails (canned) senza runtime → duration null, genres []', runA(async () => {
    const d = await buildTmdbDetails({ id: 12, title: 'T2', runtime: null, genres: [] }, 'T2');
    return d.duration === null && Array.isArray(d.genres) && d.genres.length === 0;
  }));
  ok('omdbToDetails (canned): Genre "Drama, Comedy" → genres + duration', run(() => {
    const d = omdbToDetails({ Title: 'OD', Runtime: '142 min', Genre: 'Drama, Comedy', Poster: 'N/A' }, 'OD');
    return d.genres.join() === 'Drama,Comedy' && d.duration === '142 min';
  }));
  ok('omdbToDetails (canned): Runtime/Genre N/A → duration null, genres []', run(() => {
    const d = omdbToDetails({ Title: 'OD2', Runtime: 'N/A', Genre: 'N/A' }, 'OD2');
    return d.duration === null && d.genres.length === 0;
  }));

  // --- 3c) api anno + regista: oggetti canned, nessuna rete (step 5b) ---
  console.log('\n[api — anno + regista (canned)]');
  await okA('buildTmdbDetails (canned): 0 registi → director null, no release_date → year null', runA(async () => {
    const d = await buildTmdbDetails({ id: 21, title: 'T0', release_date: '', genres: [], credits: { crew: [] }, 'watch/providers': { results: {} }, videos: { results: [] } }, 'T0');
    return d.director === null && d.release_year === null;
  }));
  await okA('buildTmdbDetails (canned): 1 regista (Director/Directing) + year da release_date', runA(async () => {
    const d = await buildTmdbDetails({ id: 22, title: 'T1', release_date: '1972-03-24', genres: [], credits: { crew: [{ job: 'Director', department: 'Directing', name: 'Francis Ford Coppola' }] }, 'watch/providers': { results: {} }, videos: { results: [] } }, 'T1');
    return d.director === 'Francis Ford Coppola' && d.release_year === 1972;
  }));
  await okA('buildTmdbDetails (canned): N registi → unica stringa ", "; producer escluso', runA(async () => {
    const d = await buildTmdbDetails({ id: 23, title: 'T2', release_date: '1991-01-01', genres: [], credits: { crew: [{ job: 'Director', department: 'Directing', name: 'A' }, { job: 'Director', department: 'Directing', name: 'B' }, { job: 'Producer', department: 'Production', name: 'C' }] }, 'watch/providers': { results: {} }, videos: { results: [] } }, 'T2');
    return d.director === 'A, B' && d.release_year === 1991;
  }));
  await okA('buildTmdbDetails (canned): release_date assente → year null', runA(async () => {
    const d = await buildTmdbDetails({ id: 24, title: 'T3', genres: [], credits: { crew: [] }, 'watch/providers': { results: {} }, videos: { results: [] } }, 'T3');
    return d.release_year === null && d.director === null;
  }));
  ok('omdbToDetails (canned): Year 1990 → 1990; Director → stringa', run(() => {
    const d = omdbToDetails({ Title: 'L', Year: '1990', Runtime: '90 min', Genre: 'Drama', Director: 'Stanley Kubrick', Poster: 'N/A' }, 'L');
    return d.release_year === 1990 && d.director === 'Stanley Kubrick';
  }));
  ok('omdbToDetails (canned): Year "1990–1994" → prima cifra 1990; direttori multipli preservati', run(() => {
    const d = omdbToDetails({ Title: 'R', Year: '1990–1994', Runtime: '90 min', Genre: 'Drama', Director: 'A, B', Poster: 'N/A' }, 'R');
    return d.release_year === 1990 && d.director === 'A, B';
  }));
  ok('omdbToDetails (canned): Year/Director N/A → null', run(() => {
    const d = omdbToDetails({ Title: 'N', Year: 'N/A', Runtime: 'N/A', Genre: 'N/A', Director: 'N/A', Poster: 'N/A' }, 'N');
    return d.release_year === null && d.director === null;
  }));
  await okA('fetchMovieDetails notFound: release_year/director null (fetch stub, nessuna rete)', runA(async () => {
    const stub = async url => ({
      json: async () => (String(url).includes('omdbapi') ? { Response: 'False' } : { results: [] })
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = stub;
    try {
      const d = await fetchMovieDetails('ZZZNonEsiste999');
      return d.matched === false && d.tmdb_id === null && d.release_year === null && d.director === null && d.title === 'ZZZNonEsiste999';
    } finally {
      globalThis.fetch = realFetch;
    }
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

  console.log('\n[ui — generi + durata in aggiunta/retry]');
  await okA('add salva genres; duration null senza runtime', runA(async () => {
    pickerMode = 'add'; pendingAddedBy = 'N';
    await applyResolvedDetails({ title: 'Con Generi', tmdb_id: 991, genres: ['Dramma'], duration: null, platform: 'P', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.tmdb_id === 991);
    movies = movies.filter(x => x.tmdb_id !== 991);
    return Boolean(m) && m.genres.join() === 'Dramma' && m.duration === null;
  }));
  await okA('add senza generi → genres [], nessun "120 min"', runA(async () => {
    pickerMode = 'add'; pendingAddedBy = 'N';
    await applyResolvedDetails({ title: 'Senza Generi', tmdb_id: 992, genres: [], duration: null, platform: 'P', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.tmdb_id === 992);
    movies = movies.filter(x => x.tmdb_id !== 992);
    return m !== undefined && Array.isArray(m.genres) && m.genres.length === 0 && m.duration === null;
  }));
  await okA('retry aggiorna i generi senza toccare il resto', runA(async () => {
    const target = { id: 'retrygen', title: 'R Gen', added_by: 'N', status: 'watchlist', genres: ['Vecchio'], duration: null, platform: 'P', poster: '' };
    movies.push(target);
    pickerMode = 'retry'; pickerTargetId = target.id;
    await applyResolvedDetails({ title: 'R Gen', genres: ['Fantascienza', 'Azione'], duration: '131 min', platform: 'S', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.id === target.id);
    movies = movies.filter(x => x.id !== target.id);
    return m.genres.join() === 'Fantascienza,Azione' && m.duration === '131 min';
  }));
  // ripristino: togli i ghost di test (array + mirror localStorage) per non
  // inquinare statistiche/render dei test successivi
  run(() => {
    movies = movies.filter(x => x.tmdb_id !== 991 && x.tmdb_id !== 992);
    const ghostTitles = ['Con Generi', 'Senza Generi'];
    const mirror = JSON.parse(localStorage.getItem('scorochiatu_movies') || '[]');
    if (Array.isArray(mirror) && mirror.some(x => ghostTitles.includes(x.title))) {
      localStorage.setItem('scorochiatu_movies', JSON.stringify(mirror.filter(x => !ghostTitles.includes(x.title))));
    }
    return true;
  });

  // --- 4b) ui anno + regista in aggiunta (canned) + mock sb (step 5b) ---
  console.log('\n[ui — anno + regista (add/retry + mock sb)]');
  await okA('add salva release_year + director (valori)', runA(async () => {
    pickerMode = 'add'; pendingAddedBy = 'N';
    await applyResolvedDetails({ title: 'Con Regista', tmdb_id: 994, release_year: 2000, director: 'Christopher Nolan', genres: [], genre: null, duration: null, platform: 'P', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.tmdb_id === 994);
    return Boolean(m) && m.release_year === 2000 && m.director === 'Christopher Nolan';
  }));
  await okA('add senza dato → release_year/director null', runA(async () => {
    pickerMode = 'add'; pendingAddedBy = 'N';
    await applyResolvedDetails({ title: 'Senza Regista', tmdb_id: 995, release_year: null, director: null, genres: [], genre: null, duration: null, platform: 'P', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.tmdb_id === 995);
    return m !== undefined && m.release_year === null && m.director === null;
  }));
  await okA('retry aggiorna release_year/director se non-null', runA(async () => {
    const target = { id: 'retry-meta', title: 'M', added_by: 'N', status: 'watchlist', genre: null, genres: [], duration: null, platform: 'P', poster: '' };
    movies.push(target);
    pickerMode = 'retry'; pickerTargetId = target.id;
    await applyResolvedDetails({ title: 'M', release_year: 1984, director: 'A, B', genres: [], genre: null, duration: null, platform: 'S', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.id === target.id);
    return m.release_year === 1984 && m.director === 'A, B';
  }));
  await okA('retry con valori null NON sovrascrive anno/regista esistenti', runA(async () => {
    const target = { id: 'retry-meta-null', title: 'M2', added_by: 'N', status: 'watchlist', genre: null, genres: [], duration: null, platform: 'P', poster: '', release_year: 2010, director: 'Stanley Kubrick' };
    movies.push(target);
    pickerMode = 'retry'; pickerTargetId = target.id;
    await applyResolvedDetails({ title: 'M2', release_year: null, director: null, genres: [], genre: null, duration: null, platform: 'S', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.id === target.id);
    return m.release_year === 2010 && m.director === 'Stanley Kubrick';
  }));
  await okA('insertMovie su Supabase (mock sb): release_year/director nel payload', runA(async () => {
    const rows = [];
    const mockFrom = table => {
      if (table !== 'movies') throw new Error('mock: solo movies');
      return {
        insert: incoming => {
          rows.push({ id: 'mock-m' + (rows.length + 1), ...incoming[0] });
          return { select: async () => ({ data: rows.map(r => ({ ...r })), error: null }) };
        }
      };
    };
    const prevSb = sb, prevMode = dbMode, prevMovies = movies;
    const prevLSMovies = localStorage.getItem('scorochiatu_movies');
    sb = { from: mockFrom }; dbMode = 'supabase';
    try {
      const m = await insertMovie({ title: 'MockMeta', added_by: 'N', status: 'watchlist', release_year: 1999, director: 'Quentin Tarantino' });
      return m.id === 'mock-m1' && rows[0].release_year === 1999 && rows[0].director === 'Quentin Tarantino';
    } finally {
      sb = prevSb; dbMode = prevMode; movies = prevMovies;
      if (prevLSMovies === null) localStorage.removeItem('scorochiatu_movies');
      else localStorage.setItem('scorochiatu_movies', prevLSMovies);
    }
  }));
  // ripristino dei ghost di test 5b (array + mirror localStorage)
  run(() => {
    movies = movies.filter(x => x.tmdb_id !== 994 && x.tmdb_id !== 995 && x.id !== 'retry-meta' && x.id !== 'retry-meta-null');
    const ghostTitles = ['Con Regista', 'Senza Regista', 'M', 'M2', 'MockMeta'];
    const mirror = JSON.parse(localStorage.getItem('scorochiatu_movies') || '[]');
    if (Array.isArray(mirror) && mirror.some(x => ghostTitles.includes(x.title))) {
      localStorage.setItem('scorochiatu_movies', JSON.stringify(mirror.filter(x => !ghostTitles.includes(x.title))));
    }
    pickerMode = 'add'; pickerTargetId = null;
    return true;
  });

  // --- 5) modal helpers ---
  console.log('\n[modali + anti-XSS]');
  ok('openModal/closeModal gestiscono le classi', run(() => { openModal('x'); closeModal('x'); return true; }));
  ok('openModal due volte sullo stesso id NON duplica lo stack', run(() => {
    openModal('reviewModal');
    openModal('reviewModal');
    const size = modalStack.length;
    closeModal('reviewModal');
    return size === 1;
  }));
  ok('closeTopModal chiude il top (LIFO), lascia sotto eventuali altri', run(() => {
    openModal('statsModal');
    openModal('surpriseModal');
    closeTopModal();
    const surpriseHidden = document.getElementById('surpriseModal').classList.contains('hidden');
    const statsStillOpen = !document.getElementById('statsModal').classList.contains('hidden');
    closeModal('statsModal');
    return surpriseHidden && statsStillOpen && modalStack.length === 0;
  }));
  ok('backdrop: mousedown+click sull\'overlay chiude il modale', run(() => {
    const overlay = document.getElementById('reviewModal');
    openModal('reviewModal');
    overlay.onmousedown({ target: overlay });
    overlay.onclick({ target: overlay });
    return overlay.classList.contains('hidden') && modalStack.length === 0;
  }));
  ok('backdrop: selezione testo (mousedown nel pannello) NON chiude', run(() => {
    const overlay = document.getElementById('reviewModal');
    const panel = { tagName: 'DIV' };
    openModal('reviewModal');
    overlay.onmousedown({ target: panel });
    overlay.onclick({ target: overlay });
    const stillOpen = !overlay.classList.contains('hidden');
    closeModal('reviewModal');
    return stillOpen;
  }));
  ok('cancelConfirmModal risolve false (handler attivo) e chiude', run(() => {
    const no = document.getElementById('confirmNo');
    let resolved = null;
    no.onclick = () => { resolved = false; };
    openModal('confirmModal');
    cancelConfirmModal();
    return resolved === false && document.getElementById('confirmModal').classList.contains('hidden');
  }));
  ok('closeWheelWinner nasconde il box senza toccare lo spin', run(() => {
    const box = document.getElementById('wheelWinner');
    box.classList.remove('hidden');
    wheelSpinning = true;
    closeWheelWinner();
    return box.classList.contains('hidden') && wheelSpinning === true;
  }));
  await okA('un nuovo spin ri-mostra il box del vincitore con X', runA(async () => {
    const box = document.getElementById('wheelWinner');
    box.classList.add('hidden');
    wheelSpinning = false;
    durationFilter = 'all'; genreFilter = 'all';
    if (wheelPool().length === 0) return false; // servono film in watchlist
    const origRaf = requestAnimationFrame;
    const origPerf = performance;
    requestAnimationFrame = cb => setTimeout(() => cb(Date.now() + 5000), 0);
    performance = { now: Date.now };
    try {
      spinWheel();
      await new Promise(r => setTimeout(r, 30));
    } finally {
      requestAnimationFrame = origRaf;
      performance = origPerf;
    }
    wheelSpinning = false;
    return !box.classList.contains('hidden')
      && box.innerHTML.indexOf('fa-xmark') !== -1
      && box.innerHTML.indexOf('closeWheelWinner') !== -1;
  }));

  // --- 5d) ruota: filtri durata + genere reali ---
  console.log('\n[ruota — durata + genere]');
  ok('parseDurationMinutes: stringhe e null senza crash', run(() =>
    parseDurationMinutes('126 min') === 126 && parseDurationMinutes('95') === 95
    && parseDurationMinutes(null) === null && parseDurationMinutes('') === null
    && parseDurationMinutes(undefined) === null && parseDurationMinutes('N/A') === null
    && parseDurationMinutes('abc') === null));
  ok('durationBucket: soglie 100/120/150 + null', run(() =>
    durationBucket(95) === 'short' && durationBucket(99) === 'short'
    && durationBucket(100) === 'medium' && durationBucket(119) === 'medium'
    && durationBucket(120) === 'long' && durationBucket(149) === 'long'
    && durationBucket(150) === 'epic' && durationBucket(null) === null));
  ok('wheelPool: durata short/medium/epic esclusi null e durate non in bucket', run(() => {
    const saved = movies;
    movies = [
      { id: 'w-short', title: 'Corto', status: 'watchlist', duration: '95 min', genres: ['Azione'] },
      { id: 'w-med', title: 'Medio', status: 'watchlist', duration: '110 min', genres: ['Commedia'] },
      { id: 'w-epic', title: 'Epico', status: 'watchlist', duration: '160 min', genres: ['Dramma'] },
      { id: 'w-nodur', title: 'NoDur', status: 'watchlist', duration: null, genres: ['Azione'] }
    ];
    durationFilter = 'all'; genreFilter = 'all';
    durationFilter = 'short';
    let ids = wheelPool().map(m => m.id).sort();
    const okShort = ids.join() === 'w-short';
    durationFilter = 'medium';
    ids = wheelPool().map(m => m.id).sort();
    const okMed = ids.join() === 'w-med';
    durationFilter = 'epic';
    ids = wheelPool().map(m => m.id).sort();
    const okEpic = ids.join() === 'w-epic';
    durationFilter = 'all';
    movies = saved;
    return okShort && okMed && okEpic;
  }));
  ok('wheelPool: durata + genere combinati; film senza generi solo in "tutti"', run(() => {
    const saved = movies;
    movies = [
      { id: 'c-short', title: 'AzioneCorta', status: 'watchlist', duration: '95 min', genre: 'azione', genres: ['Azione', 'Thriller'] },
      { id: 'c-med', title: 'CommediaMedia', status: 'watchlist', duration: '110 min', genre: 'risata', genres: ['Commedia'] },
      { id: 'c-nogen', title: 'Nostalgico', status: 'watchlist', duration: '95 min', genre: 'nostalgia', genres: null }
    ];
    durationFilter = 'all'; genreFilter = 'Azione';
    let ids = wheelPool().map(m => m.id).sort();
    const okAzione = ids.join() === 'c-short';
    genreFilter = 'all'; durationFilter = 'short';
    ids = wheelPool().map(m => m.id).sort();
    const okShortNoGenInAll = ids.join() === 'c-nogen,c-short';
    durationFilter = 'medium'; genreFilter = 'Commedia';
    ids = wheelPool().map(m => m.id).sort();
    const okCommedia = ids.join() === 'c-med';
    durationFilter = 'short'; genreFilter = 'Dramma';
    const noMatch = wheelPool().length === 0;
    genreFilter = 'all'; durationFilter = 'all';
    movies = saved;
    return okAzione && okShortNoGenInAll && okCommedia && noMatch;
  }));
  ok('syncGenreFilterOptions: conteggio/ordine/escape → selezione preservata o azzerata', run(() => {
    const saved = movies;
    const sel = document.getElementById('genreFilterSelect');
    sel.value = 'all'; sel.dataset.genresKey = '';
    movies = [
      { id: 'g1', title: 't1', status: 'watchlist', genres: ['Azione', 'Thriller'] },
      { id: 'g2', title: 't2', status: 'watchlist', genres: ['Azione'] },
      { id: 'g3', title: 't3', status: 'watchlist', genres: ["O'Brien"] }
    ];
    syncGenreFilterOptions();
    const html = sel.innerHTML;
    const azioneFirst = html.indexOf('>Azione (2)</option>') !== -1
      && html.indexOf('>Azione (2)</option>') < html.indexOf('>Thriller (1)</option>')
      && html.indexOf('>Azione (2)</option>') < html.indexOf('>O&#39;Brien (1)</option>');
    const xss = html.indexOf('value="O\\\'Brien"') !== -1 && html.indexOf('O&#39;Brien (1)') !== -1 && html.indexOf("O'Brien") === -1;
    const key = sel.dataset.genresKey;
    sel.value = 'Azione';
    syncGenreFilterOptions(); // opzioni identiche → nessun rebuild
    const preserved = sel.value === 'Azione' && sel.dataset.genresKey === key;
    movies = [{ id: 'g9', title: 't9', status: 'watchlist', genres: ['Dramma'] }];
    syncGenreFilterOptions();
    const resetAll = sel.value === 'all' && genreFilter === 'all';
    sel.value = 'all'; genreFilter = 'all';
    movies = saved;
    return azioneFirst && xss && preserved && resetAll;
  }));
  ok('render() costruisce le opzioni genere della ruota', run(() => {
    const saved = movies;
    const sel = document.getElementById('genreFilterSelect');
    sel.value = 'all'; sel.dataset.genresKey = '';
    movies = [{ id: 'r1', title: 'Rr', status: 'watchlist', duration: '90 min', genre: 'azione', genres: ['Azione'], added_by: 'N', poster: '', platform: '' }];
    currentTab = 'watchlist';
    render();
    const has = sel.innerHTML.indexOf('>Azione (1)</option>') !== -1;
    const selStillAll = sel.value === 'all';
    movies = saved;
    return has && selStillAll;
  }));

  ok('escapeHtml neutralizza tag', run(() => escapeHtml('<script>').indexOf('&lt;script&gt;') !== -1));
  ok('jsAttrEscape neutralizza apici', run(() => jsAttrEscape("O'Brien").indexOf("\\'") !== -1));
  ok('render card: duration null → nessun "null" né bullet vuoto; duration presente sì', run(() => {
    const prevUser = currentUser; currentUser = 'N';
    movies.push({ id: 'dur-null', title: 'Niente Durata', status: 'watchlist', duration: null, platform: 'CINEMA-TEST-NULL', poster: '', added_by: 'N', genre: 'azione' });
    movies.push({ id: 'dur-ok', title: 'Con Durata', status: 'watchlist', duration: '126 min', platform: 'DUR-TEST', poster: '', added_by: 'N', genre: 'azione' });
    currentTab = 'watchlist';
    render();
    const html = document.getElementById('movieGrid').innerHTML;
    const okNull = html.indexOf('</i> CINEMA-TEST-NULL') !== -1 && html.indexOf('CINEMA-TEST-NULL •') === -1 && html.indexOf('null min') === -1;
    const okDur = html.indexOf('DUR-TEST • 126 min') !== -1;
    movies = movies.filter(x => x.id !== 'dur-null' && x.id !== 'dur-ok');
    currentUser = prevUser;
    return okNull && okDur;
  }));
  ok('render card: meta "P • anno • durata" + regista su riga propria (title escapato, truncate)', run(() => {
    const prevUser = currentUser; currentUser = 'N';
    const prevTab = currentTab; currentTab = 'watchlist';
    const saved = movies;
    movies = [
      { id: 'c-full', title: 'Full', status: 'watchlist', release_year: 1972, duration: '148 min', platform: 'P-FULL', poster: '', added_by: 'N', genre: 'azione', director: 'Sergio Leone, Tonino Valerii' }
    ];
    render();
    const html = document.getElementById('movieGrid').innerHTML;
    const okMeta = html.indexOf('P-FULL • 1972 • 148 min') !== -1 && html.indexOf('• •') === -1;
    const okDir = html.indexOf('class="mt-1 text-[10px] text-slate-400 truncate"') !== -1
      && html.indexOf('title="Sergio Leone, Tonino Valerii"') !== -1
      && html.indexOf('<i class="fa-solid fa-user mr-1"></i>Sergio Leone, Tonino Valerii</div>') !== -1;
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return okMeta && okDir;
  }));
  ok('render card: regista con caratteri speciali escapato in title e testo (niente injection)', run(() => {
    const prevUser = currentUser; currentUser = 'N';
    const prevTab = currentTab; currentTab = 'watchlist';
    const saved = movies;
    movies = [
      { id: 'c-xss', title: 'Xss', status: 'watchlist', release_year: 2000, duration: null, platform: 'P', poster: '', added_by: 'N', genre: 'azione', director: 'A, B & "C" <D>' }
    ];
    render();
    const html = document.getElementById('movieGrid').innerHTML;
    const okEsc = html.indexOf('title="A, B &amp; &quot;C&quot; &lt;D&gt;"') !== -1
      && html.indexOf('&gt;D&lt;</div>') === -1 // il testo va escapato, nessun tag reale
      && html.indexOf('>A, B &amp; &quot;C&quot; &lt;D&gt;</div>') !== -1
      && html.indexOf('&lt;D&gt;') !== -1
      && html.indexOf('<D>') === -1;
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return okEsc;
  }));
  ok('render card: meta-blocco null-aware — solo durata, solo anno, entrambi null (mai "•" isolato né null/undefined)', run(() => {
    const prevUser = currentUser; currentUser = 'N';
    const prevTab = currentTab; currentTab = 'watchlist';
    const saved = movies;
    const grid = () => document.getElementById('movieGrid').innerHTML;
    const badTokens = ['null', 'undefined', '• •'];
    const scan = (m, expect, absent) => {
      movies = [m];
      render();
      const html = grid();
      return expect.every(e => html.indexOf(e) !== -1)
        && badTokens.every(t => html.indexOf(t) === -1)
        && (absent || []).every(a => html.indexOf(a) === -1);
    };
    const durOk = scan(
      { id: 'm-dur', title: 'D', status: 'watchlist', release_year: null, duration: '148 min', platform: 'P-D', genre: 'azione' },
      ['P-D • 148 min'], []);
    const yearOk = scan(
      { id: 'm-year', title: 'Y', status: 'watchlist', release_year: 1972, duration: null, platform: 'P-A', genre: 'azione' },
      ['P-A • 1972'], []);
    const noneOk = scan(
      { id: 'm-none', title: 'N', status: 'watchlist', release_year: null, duration: null, platform: 'P-N', genre: 'azione' },
      ['P-N'], ['P-N •']); // solo platform, nessun bullet appeso
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return durOk && yearOk && noneOk;
  }));

  // --- 5b) statistiche ---
  console.log('\n[statistiche — icone card + genere escapato]');
  ok('renderStats: 4 card con icona, top genere escapato, mai "undefined"', run(() => {
    movies.push({ id: 'stats-ghost', title: 'x', status: 'watched', genres: ['a<b'], rating: 5, review_text: '', review_by: 'both' });
    renderStats();
    const html = document.getElementById('statsGrid').innerHTML;
    return html.indexOf('fa-clapperboard') !== -1
      && html.indexOf('fa-star') !== -1
      && html.indexOf('fa-tags') !== -1
      && html.indexOf('fa-users') !== -1
      && html.indexOf('fa-heart') === -1
      && html.indexOf('Proposti da') !== -1
      && html.indexOf('a&lt;b (1)') !== -1
      && html.indexOf('a<b (1)') === -1
      && html.indexOf('a<b)') === -1
      && html.indexOf('undefined') === -1;
  }));
  ok('renderStats: "Genere più amato" conta il genere vincente, non la somma dei film/generi', run(() => {
    const saved = movies;
    movies = [
      { id: 'gs1', title: 'S1', status: 'watched', genres: ['Azione'], rating: 0, review_text: '', review_by: 'both' },
      { id: 'gs2', title: 'S2', status: 'watched', genres: ['Azione'], rating: 0, review_text: '', review_by: 'both' },
      { id: 'gs3', title: 'S3', status: 'watched', genres: ['Azione'], rating: 0, review_text: '', review_by: 'both' },
      { id: 'gs4', title: 'S4', status: 'watched', genres: ['Commedia', 'Dramma'], rating: 0, review_text: '', review_by: 'both' }
    ];
    renderStats();
    const html = document.getElementById('statsGrid').innerHTML;
    movies = saved;
    return html.indexOf('>Azione (3)<') !== -1    // conta le occorrenze del genere in testa (3)
      && html.indexOf('Azione (4)') === -1        // NON il numero totale di film (4)
      && html.indexOf('Azione (5)') === -1        // NON la somma delle occorrenze (5)
      && html.indexOf('undefined') === -1;
  }));
  ok('card: chip generi reali max 3, dedup, null-safe, escapati', run(() => {
    const full = genreChips({ genres: ['Azione', 'Commedia', 'Dramma', 'Horror'] });
    const dedup = genreChips({ genres: ['Azione', 'Azione'] });
    const nullSafe = genreChips(null) + '|' + genreChips({ genres: null }) + '|' + genreChips({ genres: 'Azione' });
    const xss = genreChips({ genres: ['a<b'] });
    return full.indexOf('>Azione<') !== -1 && full.indexOf('>Commedia<') !== -1
      && full.indexOf('>Dramma<') !== -1 && full.indexOf('>Horror<') === -1
      && dedup.split('Azione').length === 2
      && nullSafe === '||' // tre blocchi vuoti: mai "undefined"
      && xss.indexOf('a&lt;b') !== -1 && xss.indexOf('a<b') === -1;
  }));

  // --- 6) calendario: logica pura + render (step 3a, solo vista) ---
  console.log('\n[calendario — logica pura + render]');
  ok('dayKey con padding a 2 cifre', run(() => dayKey(2026, 9, 3) === '2026-09-03'));
  ok('dayKey edge anno/mese (dicembre)', run(() => dayKey(2025, 12, 31) === '2025-12-31'));
  ok('todayKey = componenti locali (senza off-by-one)', run(() => {
    const now = new Date();
    return todayKey() === dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }));
  ok('monthGrid settembre 2026: 5 settimane x 7, lunedì-primo, prima cella 31/08', run(() => {
    const w = monthGrid(2026, 8);
    return w.length === 5 && w.every(row => row.length === 7)
      && w[0][0].key === '2026-08-31' && w[0][0].inMonth === false && w[0][0].day === 31;
  }));
  ok('monthGrid: tutti i 30 giorni di settembre presenti e inMonth', run(() => {
    const days = monthGrid(2026, 8).flat().filter(c => c.inMonth);
    return days.length === 30 && days[0].key === '2026-09-01' && days[29].key === '2026-09-30';
  }));
  ok('monthGrid: overflow al mese successivo (trailing out-of-month)', run(() => {
    const last = monthGrid(2026, 8).flat().slice(-1)[0];
    return last.inMonth === false && last.key === '2026-10-04';
  }));
  ok('shiftMonth attraversa il cambio anno', run(() => {
    const a = shiftMonth(2026, 0, -1);
    const b = shiftMonth(2026, 11, 1);
    return a.year === 2025 && a.month === 11 && b.year === 2027 && b.month === 0;
  }));
  await okA('nightsByDayKey: mappa night->giorno, status conservato, date null escluse', runA(async () => {
    movieNights = [
      { id: 'cal1', movie_id: movies[0].id, date: '2026-09-03', time: '21:30', status: 'confirmed' },
      { id: 'cal2', movie_id: movies[0].id, date: '2026-09-03', time: '22:00', status: 'proposed' },
      { id: 'cal3', movie_id: movies[0].id, date: null, status: 'confirmed' },
      { id: 'cal4', movie_id: movies[0].id, date: '2026-10-01', status: 'completed' }
    ];
    const { byDay, undated } = nightsByDayKey(movieNights, movies, 2026, 8);
    return byDay['2026-09-03']?.length === 2
      && byDay['2026-09-03'][0].night.status === 'confirmed'
      && byDay['2026-09-03'][1].night.status === 'proposed'
      && byDay['2026-10-01'] === undefined
      && byDay[null] === undefined
      && undated.some(e => e.night.id === 'cal3');
  }));
  ok('nightsByDayKey: film presente risolto, film mancante -> null (no crash)', run(() => {
    const found = nightsByDayKey([{ id: 'x', movie_id: movies[0].id, date: '2026-09-05', status: 'cancelled' }], movies, 2026, 8);
    const missing = nightsByDayKey([{ id: 'y', movie_id: 'ghost', date: '2026-09-06', status: 'cancelled' }], movies, 2026, 8);
    return found.byDay['2026-09-05'][0].movie?.id === movies[0].id && missing.byDay['2026-09-06'][0].movie === null;
  }));
  ok('renderCalendar: primo open = mese corrente, senza crash', run(() => {
    calendarYear = null; calendarMonth = null; calendarSelectedKey = null;
    renderCalendar();
    const now = new Date();
    return calendarYear === now.getFullYear() && calendarMonth === now.getMonth();
  }));
  ok('calendarSelectDay: toggle apre, il giorno senza serate chiude il riepilogo', run(() => {
    calendarYear = 2026; calendarMonth = 8; calendarSelectedKey = null;
    calendarSelectDay('2026-09-03');
    const opened = calendarSelectedKey === '2026-09-03';
    calendarSelectDay('2026-09-10');
    return opened && calendarSelectedKey === null;
  }));
  ok('calendarShift: naviga al mese dopo e resetta la selezione', run(() => {
    calendarYear = 2026; calendarMonth = 8; calendarSelectedKey = '2026-09-03';
    calendarShift(1);
    return calendarYear === 2026 && calendarMonth === 9 && calendarSelectedKey === null;
  }));
  ok('calendarToday: torna al mese corrente e resetta la selezione', run(() => {
    calendarYear = 2026; calendarMonth = 0; calendarSelectedKey = '2026-09-03';
    calendarToday();
    const now = new Date();
    return calendarYear === now.getFullYear() && calendarMonth === now.getMonth() && calendarSelectedKey === null;
  }));
  ok('render() su tab calendar disegna la griglia e non crasha', run(() => {
    currentTab = 'calendar';
    render();
    const drawn = document.getElementById('movieGrid').innerHTML.length > 0;
    currentTab = 'watchlist';
    return drawn;
  }));
  ok('renderCalendar: wrapper col-span-full come unico figlio di #movieGrid', run(() => {
    calendarYear = 2026; calendarMonth = 8; calendarSelectedKey = null;
    renderCalendar();
    const html = document.getElementById('movieGrid').innerHTML.trim();
    return html.startsWith('<div class="col-span-full">')
      && html.endsWith('</div>')
      && (html.match(/<div class="col-span-full">/g) || []).length === 1
      && html.indexOf('<div class="space-y-1">') !== -1;
  }));
  ok('monthGrid ottobre 2026: 28/29/30/09 fuori mese + 01/10 inMonth, righe da 7', run(() => {
    const w = monthGrid(2026, 9);
    const first = w[0];
    return w.length === 5 && w.every(row => row.length === 7)
      && first[0].key === '2026-09-28' && first[0].inMonth === false
      && first[1].key === '2026-09-29' && first[1].inMonth === false
      && first[2].key === '2026-09-30' && first[2].inMonth === false
      && first[3].key === '2026-10-01' && first[3].inMonth === true;
  }));

  // --- 7) page filtri/ricerca/sort: logica pura (canned, nessuna rete) ---
  console.log('\n[pagina — ricerca/status/dropdown/sort]');
  ok('normalizeSearch: accenti + maiuscole + spazi → "piu sfumato"', run(() =>
    normalizeSearch('  Pïù SFUMÀTO ') === 'piu sfumato' && normalizeSearch('SCI-FI') === 'sci-fi'));
  ok('normalizeSearch: null/undefined/vuoto → ""', run(() =>
    normalizeSearch(null) === '' && normalizeSearch(undefined) === '' && normalizeSearch('') === ''
    && normalizeSearch('  ') === ''));
  ok('movieSearchText: titolo + generi (niente doppi spazi)', run(() =>
    movieSearchText({ title: 'Hamnet', genres: ['Dramma', 'Storia'] }) === 'Hamnet Dramma Storia'
    && movieSearchText({ title: 'T' }) === 'T'
    && movieSearchText({ title: 'X', genres: null }) === 'X'));
  ok('filterMovies: ricerca su titolo E su genere, token AND, accenti', run(() => {
    const list = [
      { id: 'f1', title: 'Più sfumato', status: 'watchlist', genres: ['Dramma'] },
      { id: 'f2', title: 'Dracula', status: 'watchlist', genres: ['Horror', 'Thriller'] },
      { id: 'f3', title: 'Via col vento', status: 'watched', genres: ['Dramma', 'Romance'] }
    ];
    const byTitle = filterMovies(list, { query: 'sfumato' });
    const byGenre = filterMovies(list, { query: 'horror' });
    const byTwoTokens = filterMovies(list, { query: 'col vento' });
    const noMatch = filterMovies(list, { query: 'alieni' });
    return byTitle.length === 1 && byTitle[0].id === 'f1'
      && byGenre.length === 1 && byGenre[0].id === 'f2'
      && byTwoTokens.length === 1 && byTwoTokens[0].id === 'f3'
      && noMatch.length === 0;
  }));
  ok('filterMovies: combinazione query + proposer + genere + piattaforma + status', run(() => {
    const list = [
      { id: 'c1', title: 'Inception', added_by: 'N', status: 'watchlist', genres: ['Azione', 'Fantascienza'], platform: 'Netflix' },
      { id: 'c2', title: 'Inception 2', added_by: 'V', status: 'watchlist', genres: ['Azione'], platform: 'Prima' },
      { id: 'c3', title: 'Other', added_by: 'N', status: 'watched', genres: ['Azione'], platform: 'Netflix' }
    ];
    const one = filterMovies(list, { query: 'inception', proposer: 'N', genre: 'Azione', platform: 'Netflix', status: 'watchlist' });
    const statusOnly = filterMovies(list, { status: 'watched' });
    return one.length === 1 && one[0].id === 'c1'
      && statusOnly.length === 1 && statusOnly[0].id === 'c3';
  }));
  ok('filterMovies: nessun filtro → passa tutto (status null o omesso)', run(() => {
    const list = [
      { id: 'a1', title: 'X', status: 'watchlist' },
      { id: 'a2', title: 'Y', status: 'tonight' }
    ];
    const all = filterMovies(list, {});
    const noStatus = filterMovies(list, { query: '' });
    return all.length === 2 && noStatus.length === 2 && filterMovies(list).length === 2;
  }));
  ok('statusCounts: coerenti con filterMovies quando i filtri sono attivi', run(() => {
    const list = [
      { id: 's1', title: 'Dracula', status: 'watchlist', genres: ['Horror'], added_by: 'N', platform: 'P1' },
      { id: 's2', title: 'Bram Dracula', status: 'tonight', genres: ['Horror'], added_by: 'V', platform: 'P2' },
      { id: 's3', title: 'Dracula DX', status: 'watched', genres: ['Horror'], added_by: 'N', platform: 'P3' },
      { id: 's4', title: 'Altro', status: 'watchlist', genres: ['Commedia'], added_by: 'N', platform: 'P1' }
    ];
    const f = { query: 'dracula', proposer: '', genre: 'Horror', platform: '' };
    const counts = statusCounts(list, f);
    return counts.all === 3 && counts.watchlist === 1 && counts.tonight === 1 && counts.watched === 1
      && filterMovies(list, { ...f, status: 'watchlist' }).length === counts.watchlist
      && filterMovies(list, { ...f, status: 'watched' }).length === counts.watched;
  }));
  ok('statusCounts: senza filtri "all" = tutti i match, i parziali = i tre status', run(() => {
    const list = [
      { id: 't1', title: 'a', status: 'watchlist' },
      { id: 't2', title: 'b', status: 'tonight' },
      { id: 't3', title: 'c', status: 'watched' },
      { id: 't4', title: 'd', status: 'proposal' }
    ];
    const c = statusCounts(list, {});
    const all = filterMovies(list, {}).length;
    return c.all === 4 && c.watchlist + c.tonight + c.watched === 3 && c.all === all;
  }));
  ok('sortMovies: durata null-last in entrambe le direzioni', run(() => {
    const list = [
      { id: 'd1', title: 'a', duration: '95 min' },
      { id: 'd2', title: 'b', duration: null },
      { id: 'd3', title: 'c', duration: '150 min' }
    ];
    const asc = sortMovies(list, 'duration', 'asc').map(x => x.id).join();
    const desc = sortMovies(list, 'duration', 'desc').map(x => x.id).join();
    return asc === 'd1,d3,d2' && desc === 'd3,d1,d2';
  }));
  ok('sortMovies: rating → non recensiti (null/0) in fondo, desc = migliore primo', run(() => {
    const list = [
      { id: 'r1', title: 'cinque', rating: 5 },
      { id: 'r2', title: 'niente', rating: 0 },
      { id: 'r3', title: 'tre', rating: 3 },
      { id: 'r4', title: 'assente' }
    ];
    const desc = sortMovies(list, 'rating', 'desc').map(x => x.id).join();
    const asc = sortMovies(list, 'rating', 'asc').map(x => x.id).join();
    return desc === 'r1,r3,r2,r4' && asc === 'r3,r1,r2,r4';
  }));
  ok('sortMovies: titolo case-insensitive asc/desc', run(() => {
    const list = [
      { id: 'z', title: 'Zeta' },
      { id: 'al', title: 'alfa' },
      { id: 'B', title: 'Bravo' }
    ];
    const asc = sortMovies(list, 'title', 'asc').map(x => x.title).join();
    const desc = sortMovies(list, 'title', 'desc').map(x => x.title).join();
    return asc === 'alfa,Bravo,Zeta' && desc === 'Zeta,Bravo,alfa';
  }));
  ok('sortMovies: added (created_at ISO) cronologico + null-last', run(() => {
    const list = [
      { id: 'c1', title: 'a', created_at: '2026-01-01T10:00:00Z' },
      { id: 'c2', title: 'b', created_at: '2026-03-01T10:00:00Z' },
      { id: 'c3', title: 'c' }
    ];
    const desc = sortMovies(list, 'added', 'desc').map(x => x.id).join();
    const asc = sortMovies(list, 'added', 'asc').map(x => x.id).join();
    return desc === 'c2,c1,c3' && asc === 'c1,c2,c3';
  }));
  ok('sortMovies: imdb parse virgola/punto, "N/A" → null in fondo', run(() => {
    const list = [
      { id: 'i1', title: 'a', imdb_rating: '7.3' },
      { id: 'i2', title: 'b', imdb_rating: '8,5' },
      { id: 'i3', title: 'c', imdb_rating: 'N/A' },
      { id: 'i4', title: 'd', imdb_rating: '' }
    ];
    const desc = sortMovies(list, 'imdb', 'desc').map(x => x.id).join();
    return desc === 'i2,i1,i3,i4';
  }));
  ok('sortMovies: proposer (added_by) + default key non noto → ordine stabile', run(() => {
    const list = [
      { id: 'p1', title: 'a', added_by: 'N' },
      { id: 'p2', title: 'b', added_by: 'V' },
      { id: 'p3', title: 'c' }
    ];
    const asc = sortMovies(list, 'proposer', 'asc').map(x => x.id).join();
    const unknown = sortMovies(list, 'zzz', 'desc').length === 3;
    return asc === 'p1,p2,p3' && unknown;
  }));
  ok('deriveFilterOptions: conteggi + ordine (count desc, poi nome) + ignora vuoti', run(() => {
    const list = [
      { id: 'o1', title: 'a', added_by: 'V', genres: ['Azione', 'Thriller'], platform: 'Netflix' },
      { id: 'o2', title: 'b', added_by: 'N', genres: ['Azione'], platform: 'Prima' },
      { id: 'o3', title: 'c', added_by: 'N', genres: [], platform: null },
      { id: 'o4', title: 'd', added_by: 'N', genres: ['Commedia'], platform: 'Netflix' }
    ];
    const { proposers, genres, platforms } = deriveFilterOptions(list);
    const props = proposers.map(p => p.value + ':' + p.count).join();
    const gs = genres.map(g => g.value + ':' + g.count).join();
    const plats = platforms.map(p => p.value + ':' + p.count).join();
    return props === 'N:3,V:1'
      && gs === 'Azione:2,Commedia:1,Thriller:1'
      && plats === 'Netflix:2,Prima:1'
      && genres.some(g => g.value === '' || g.count === 0 || g.count == null) === false;
  }));
  ok('hasActiveListFilters + resetListFilters: stato coerente e azzerato', run(() => {
    const before = hasActiveListFilters(listFilterState());
    const prevQ = listQuery, prevP = listProposer, prevG = listGenre, prevPl = listPlatform;
    const prevSK = listSortKey, prevSD = listSortDir;
    listQuery = 'x'; listProposer = 'N'; listGenre = 'Azione'; listPlatform = 'Netflix';
    listSortKey = 'title'; listSortDir = 'asc';
    const active = hasActiveListFilters(listFilterState()) === true;
    const clean = !hasActiveListFilters({ query: '  ', proposer: '', genre: '', platform: '' });
    resetListFilters();
    const resetted = listQuery === '' && listProposer === '' && listGenre === ''
      && listPlatform === '' && listSortKey === 'added' && listSortDir === 'desc'
      && hasActiveListFilters(listFilterState()) === false;
    listQuery = prevQ; listProposer = prevP; listGenre = prevG; listPlatform = prevPl;
    listSortKey = prevSK; listSortDir = prevSD;
    return before === false && active && clean && resetted;
  }));
  ok('filterMoviesByState/statusCountsFor: usano lo stato globale', run(() => {
    const saved = movies;
    const prevQ = listQuery, prevP = listProposer, prevG = listGenre, prevPl = listPlatform;
    movies = [
      { id: 'g1', title: 'Dracula', status: 'watchlist', added_by: 'N', genres: ['Horror'], platform: 'Netflix' },
      { id: 'g2', title: 'Comedy', status: 'tonight', added_by: 'V', genres: ['Commedia'], platform: 'Prima' }
    ];
    listQuery = 'dracula'; listProposer = 'N'; listGenre = 'Horror'; listPlatform = 'Netflix';
    const list = filterMoviesByState(movies, null);
    const counts = statusCountsFor(movies);
    movies = saved;
    listQuery = prevQ; listProposer = prevP; listGenre = prevG; listPlatform = prevPl;
    return list.length === 1 && list[0].id === 'g1'
      && counts.all === 1 && counts.watchlist === 1 && counts.tonight === 0 && counts.watched === 0;
  }));

  // --- 7c) pagina — ricerca per regista + sort per anno (step 5b, canned) ---
  console.log('\n[pagina — regista + anno]');
  ok('movieSearchText: include il regista (niente doppi spazi)', run(() => {
    const t = movieSearchText({ title: 'Hamnet', genres: ['Dramma'], director: 'Chloé Zhao' });
    return t === 'Hamnet Dramma Chloé Zhao'
      && movieSearchText({ title: 'T', director: null }) === 'T'
      && movieSearchText({ title: 'X', genres: null }) === 'X';
  }));
  ok('filterMovies: ricerca per regista — accenti/maiuscole; apostrofo conservato da normalizeSearch', run(() => {
    const list = [
      { id: 'r1', title: 'Titolo', status: 'watchlist', genres: [], director: "D'Angelo Ñúñez" },
      { id: 'r2', title: 'Altro', status: 'watchlist', genres: [], director: 'Jane Doe' },
      { id: 'r3', title: 'Altro2', status: 'watchlist', genres: [], director: null }
    ];
    const upper = filterMovies(list, { query: 'D\'ANGELO' });
    const accents = filterMovies(list, { query: 'nunez' });           // ñ → n
    const apostrophe = filterMovies(list, { query: "d'angelo" });     // ' conservato
    const noDir = filterMovies(list, { query: 'doe' });
    const miss = filterMovies(list, { query: 'kubrick' });
    return upper.length === 1 && upper[0].id === 'r1'
      && accents.length === 1 && accents[0].id === 'r1'
      && apostrophe.length === 1 && apostrophe[0].id === 'r1'
      && noDir.length === 1 && noDir[0].id === 'r2'
      && miss.length === 0;
  }));
  ok('filterMovies: più registi → match con qualsiasi token; director null non matcha la query regista', run(() => {
    const list = [
      { id: 'm1', title: 'Per Qualche Dollaro in Più', status: 'watchlist', genres: [], director: 'Sergio Leone, Tonino Valerii' },
      { id: 'm2', title: 'Senza Regista', status: 'watchlist', genres: [], director: null }
    ];
    const byFirst = filterMovies(list, { query: 'sergio' });
    const byLast = filterMovies(list, { query: 'valerii' });
    const tokenAnd = filterMovies(list, { query: 'leone dollaro' }); // regista + titolo, token AND
    const noDir = filterMovies(list, { query: 'regista' });          // solo il titolo di m2, non il director null
    return byFirst.length === 1 && byFirst[0].id === 'm1'
      && byLast.length === 1 && byLast[0].id === 'm1'
      && tokenAnd.length === 1 && tokenAnd[0].id === 'm1'
      && noDir.length === 1 && noDir[0].id === 'm2';
  }));
  ok('sortMovies: anno null-last asc e desc (null/0/assente in fondo)', run(() => {
    const list = [
      { id: 'y1', title: 'a', release_year: 1994 },
      { id: 'y2', title: 'b', release_year: null },
      { id: 'y3', title: 'c', release_year: 1972 },
      { id: 'y4', title: 'd', release_year: 0 },
      { id: 'y5', title: 'e' }
    ];
    const asc = sortMovies(list, 'year', 'asc').map(x => x.id).join();
    const desc = sortMovies(list, 'year', 'desc').map(x => x.id).join();
    return asc === 'y3,y1,y2,y4,y5' && desc === 'y1,y3,y2,y4,y5';
  }));
  ok('sortMovies: anno con valore testuale (es. "1994") → numero; non-numerico → null in fondo', run(() => {
    const list = [
      { id: 't1', title: 'a', release_year: '1994' },
      { id: 't2', title: 'b', release_year: 'abc' },
      { id: 't3', title: 'c', release_year: 1989 }
    ];
    const asc = sortMovies(list, 'year', 'asc').map(x => x.id).join();
    return asc === 't3,t1,t2';
  }));

  // --- 7b) pagina: ricerca + pill con contatori + azioni per status ---
  console.log('\n[pagina — ricerca + pill + azioni per status]');
  ok('setTab: ogni valore senza eccezioni (guardia id inesistenti)', run(() => {
    const prevUser = currentUser; currentUser = 'N';
    ['all', 'watchlist', 'tonight', 'watched', 'calendar'].forEach(t => setTab(t));
    const last = currentTab;
    currentUser = prevUser;
    return last === 'calendar';
  }));
  ok('pill: contatori calcolati coi filtri attivi, "Tutti" = tutti i match', run(() => {
    const saved = movies;
    const prevQ = listQuery, prevP = listProposer, prevG = listGenre, prevPl = listPlatform;
    movies = [
      { id: 'p1', title: 'Dracula', status: 'watchlist', added_by: 'N', genres: ['Horror'], platform: 'Netflix' },
      { id: 'p2', title: 'Dracula Night', status: 'tonight', added_by: 'V', genres: ['Horror'], platform: 'Prima' },
      { id: 'p3', title: 'Riso', status: 'watched', added_by: 'N', genres: ['Commedia'], platform: 'Netflix' }
    ];
    listQuery = 'dracula'; listProposer = ''; listGenre = ''; listPlatform = '';
    renderPillCounters();
    const okFiltered = document.getElementById('pillCountAll').textContent === '2'
      && document.getElementById('pillCountWatchlist').textContent === '1'
      && document.getElementById('pillCountTonight').textContent === '1'
      && document.getElementById('pillCountWatched').textContent === '0';
    listQuery = '';
    renderPillCounters();
    const okAll = document.getElementById('pillCountAll').textContent === '3';
    movies = saved;
    listQuery = prevQ; listProposer = prevP; listGenre = prevG; listPlatform = prevPl;
    return okFiltered && okAll;
  }));
  ok('render non tocca l\'input di ricerca (valore e stato persisti)', run(() => {
    const input = document.getElementById('movieSearchInput');
    const prevQ = listQuery; const prevTab = currentTab; const prevUser = currentUser;
    input.value = 'Interstellar';
    currentUser = 'N';
    currentTab = 'all';
    render(); // render/rendere realtime NON deve scrivere l'input
    const afterRender = input.value === 'Interstellar' && listQuery === prevQ;
    currentTab = prevTab; listQuery = prevQ; currentUser = prevUser; input.value = '';
    return afterRender;
  }));
  ok('empty state: senza filtri messaggio storico; con filtri cita i filtri (query escapata) + Azzera', run(() => {
    const saved = movies;
    const prevQ = listQuery; const prevTab = currentTab;
    const input = document.getElementById('movieSearchInput');
    movies = [];
    currentTab = 'all';
    listQuery = '';
    render();
    const plain = document.getElementById('movieGrid').innerHTML.includes('Nessun film in questa sezione.');
    listQuery = '<script>zed';
    render();
    const html = document.getElementById('movieGrid').innerHTML;
    const withFilters = html.includes('Nessun film corrisponde ai filtri')
      && html.includes('&lt;script&gt;zed') && html.indexOf('<script>zed') === -1
      && html.includes('resetListFiltersUI');
    resetListFiltersUI();
    const afterReset = listQuery === '' && input.value === '';
    movies = saved;
    listQuery = prevQ; currentTab = prevTab;
    return plain && withFilters && afterReset;
  }));
  await okA('onSearchInput: aggiorna subito listQuery e ri-render dopo il debounce (~250ms)', runA(async () => {
    const saved = movies;
    const prevQ = listQuery; const prevTab = currentTab; const prevUser = currentUser;
    const input = document.getElementById('movieSearchInput');
    movies = [{ id: 'db1', title: 'Dracula di Bram Stoker', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: 'azione', genres: ['Horror'] }];
    currentTab = 'all'; currentUser = 'N';
    input.value = 'bram';
    onSearchInput();
    const immediate = listQuery === 'bram';
    await new Promise(r => setTimeout(r, 300));
    const rerendered = document.getElementById('movieGrid').innerHTML.includes('Dracula di Bram Stoker');
    movies = saved;
    listQuery = prevQ; currentTab = prevTab; currentUser = prevUser; input.value = '';
    return immediate && rerendered;
  }));
  ok('azioni card: stesse di oggi per ogni status con la tab specifica', run(() => {
    const saved = movies;
    const prevUser = currentUser; const prevTab = currentTab;
    currentUser = 'N';
    currentTab = 'watchlist';
    movies = [
      { id: 'A', title: 'Alpha Watch', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: 'azione' },
      { id: 'B', title: 'Beta Tonight', status: 'tonight', added_by: 'V', poster: '', platform: '', genre: 'azione' },
      { id: 'C', title: 'Gamma Watched', status: 'watched', added_by: 'N', poster: '', platform: '', review_text: '', rating: 0 },
      { id: 'D', title: 'Delta Proposal', status: 'proposal', added_by: 'V', poster: '', platform: '' }
    ];
    const cnt = (h, s) => h.split(s).length - 1;
    let okAll = true;
    render();
    let html = document.getElementById('movieGrid').innerHTML;
    okAll = okAll && html.includes('Alpha Watch') && html.indexOf('Beta Tonight') === -1
      && html.indexOf('Gamma Watched') === -1 && html.indexOf('Delta Proposal') === -1
      && cnt(html, 'voteMovie') === 2 && cnt(html, 'quickTonightUI') === 1
      && cnt(html, 'scheduleMovie') === 1 && cnt(html, 'vetoMovie') === 1 && cnt(html, 'addReview') === 0;
    currentTab = 'tonight';
    render();
    html = document.getElementById('movieGrid').innerHTML;
    okAll = okAll && html.includes('Beta Tonight') && html.indexOf('Gamma Watched') === -1
      && cnt(html, 'voteMovie') === 2 && cnt(html, 'addReview') === 1
      && cnt(html, 'quickTonightUI') === 0 && cnt(html, 'vetoMovie') === 0 && cnt(html, 'scheduleMovie') === 0;
    currentTab = 'watched';
    render();
    html = document.getElementById('movieGrid').innerHTML;
    okAll = okAll && html.includes('Gamma Watched') && html.indexOf('Beta Tonight') === -1
      && cnt(html, 'voteMovie') === 0 && cnt(html, 'addReview') === 0
      && cnt(html, 'quickTonightUI') === 0 && cnt(html, 'scheduleMovie') === 0 && cnt(html, 'vetoMovie') === 0;
    currentTab = prevTab;
    currentUser = prevUser;
    movies = saved;
    return okAll;
  }));
  ok('azioni card: stesse di oggi con currentTab="all" (status misti) + badge stasera', run(() => {
    const saved = movies;
    const prevUser = currentUser; const prevTab = currentTab;
    currentUser = 'N';
    currentTab = 'all';
    movies = [
      { id: 'A', title: 'Alpha Watch', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: 'azione' },
      { id: 'B', title: 'Beta Tonight', status: 'tonight', added_by: 'V', poster: '', platform: '', genre: 'azione' },
      { id: 'C', title: 'Gamma Watched', status: 'watched', added_by: 'N', poster: '', platform: '', review_text: '', rating: 0 },
      { id: 'D', title: 'Delta Proposal', status: 'proposal', added_by: 'V', poster: '', platform: '' }
    ];
    const cnt = (h, s) => h.split(s).length - 1;
    render();
    const html = document.getElementById('movieGrid').innerHTML;
    const ok = html.includes('Alpha Watch') && html.includes('Beta Tonight')
      && html.includes('Gamma Watched') && html.includes('Delta Proposal')
      && cnt(html, 'voteMovie') === 4 // watchlist + tonight
      && cnt(html, 'quickTonightUI') === 1 && cnt(html, 'scheduleMovie') === 1 && cnt(html, 'vetoMovie') === 1
      && cnt(html, 'addReview') === 1
      && cnt(html, 'bg-sky-700/90') === 1 // badge "stasera" solo per il film tonight
      && cnt(html, 'deleteMovieConfirm') === 4; // ogni card ha comunque il cestino (nessun errore per status ignoto)
    currentTab = prevTab;
    currentUser = prevUser;
    movies = saved;
    return ok;
  }));

  console.log('\n[step2 phase8/6 — card biglietto + home cta]');
  ok('card: container "movie-ticket" + linea strappo "ticket-seam" + scrim poster', run(() => {
    const prevUser = currentUser, prevTab = currentTab, saved = movies;
    currentUser = 'N'; currentTab = 'all';
    movies = [
      { id: 't-w', title: 'T Watch', status: 'watchlist', added_by: 'N', poster: '', platform: 'P', genre: 'azione' },
      { id: 't-t', title: 'T Tonight', status: 'tonight', added_by: 'V', poster: '', platform: '', genre: 'azione' },
      { id: 't-d', title: 'T Watched', status: 'watched', added_by: 'N', poster: '', platform: '', review_text: '', rating: 0 }
    ];
    render();
    const grid = document.getElementById('movieGrid');
    const html = grid.innerHTML;
    const ticketClass = grid._children.length === 3
      && grid._children.every(c => c.className.indexOf('movie-ticket') !== -1)
      && grid._children.every(c => c.className.indexOf('glass-card') === -1);
    const okTicket = ticketClass
      && html.indexOf('ticket-seam') !== -1
      && html.indexOf('bg-gradient-to-t from-black/70') !== -1;
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return okTicket;
  }));
  ok('card: BUGFIX footer — watched/status ignoto NON renderizza il footer azioni vuoto; watchlist/tonight sì', run(() => {
    const prevUser = currentUser, prevTab = currentTab, saved = movies;
    currentUser = 'N'; currentTab = 'all';
    movies = [
      { id: 'f-w', title: 'FW', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: 'azione' },
      { id: 'f-d', title: 'FD', status: 'watched', added_by: 'N', poster: '', platform: '', review_text: '', rating: 0 }
    ];
    render();
    const grid = document.getElementById('movieGrid');
    const watchedCard = grid._children.find(c => c._innerHTML.indexOf('FD') !== -1);
    const watchCard = grid._children.find(c => c._innerHTML.indexOf('FW') !== -1);
    const watchedNoFooter = watchedCard && watchedCard._innerHTML.indexOf('pt-2 border-t border-slate-800/80') === -1
      && watchedCard._innerHTML.indexOf('voteMovie') === -1;
    const watchHasFooter = watchCard && watchCard._innerHTML.indexOf('pt-2 border-t border-slate-800/80') !== -1
      && watchCard._innerHTML.indexOf('voteMovie') !== -1;
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return !!watchedNoFooter && !!watchHasFooter;
  }));
  ok('card: rating assente → niente rating-holo; presente → container holo con testi piattaforma', run(() => {
    const prevUser = currentUser, prevTab = currentTab, saved = movies;
    currentUser = 'N'; currentTab = 'all';
    movies = [
      { id: 'h-none', title: 'H0', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: 'azione' },
      { id: 'h-ok', title: 'H1', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: 'azione', imdb_rating: '8.1', rt_rating: '92%' }
    ];
    render();
    const grid = document.getElementById('movieGrid');
    const h0 = grid._children.find(c => c._innerHTML.indexOf('H0<') !== -1);
    const h1 = grid._children.find(c => c._innerHTML.indexOf('H1<') !== -1);
    const noneHolo = h0 && h0._innerHTML.indexOf('rating-holo') === -1;
    const holo = h1 && h1._innerHTML.indexOf('rating-holo flex gap-2') !== -1
      && h1._innerHTML.indexOf('IMDb 8.1') !== -1 && h1._innerHTML.indexOf('RT 92%') !== -1;
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return !!noneHolo && !!holo;
  }));
  ok('card: personBadge → person-pill con pallino persona (paternità riconoscibile)', run(() => {
    const b = personBadge('N');
    return b.indexOf('badge badge-n person-pill') !== -1 && b.indexOf('fa-circle') !== -1;
  }));

  console.log('\n[step3 phase9 — dettaglio film modale]');
  ok('dettaglio: click card su area non-interattiva apre il modale col contenuto (titolo/overview/cast/rating/trailer)', run(() => {
    const prevUser = currentUser, prevTab = currentTab, saved = movies;
    currentUser = 'N'; currentTab = 'all';
    movies = [
      { id: 'd-1', title: 'Film Dettaglio', status: 'watchlist', added_by: 'N', poster: '', platform: 'Netflix', genre: 'azione',
        overview: 'Una trama di prova col dettaglio.', cast_names: ['Attore Uno', 'Attrice Due'], imdb_rating: '7.7', release_year: 2020, duration: '2h 10m', trailer_url: 'https://youtu.be/xyz' }
    ];
    render();
    const card = document.getElementById('movieGrid')._children[0];
    closeModal('detailModal');
    card._handlers.click[0]({ target: { closest: () => null } });
    const hidden = document.getElementById('detailModal').classList.contains('hidden');
    const body = document.getElementById('detailBody')._innerHTML;
    const okOpen = !hidden
      && body.indexOf('Film Dettaglio') !== -1
      && body.indexOf('Una trama di prova col dettaglio.') !== -1
      && body.indexOf('Attore Uno') !== -1
      && body.indexOf('IMDb 7.7') !== -1
      && body.indexOf('youtu.be') !== -1;
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return okOpen;
  }));
  ok('dettaglio: guardia — click su button/a/input/select/textarea NON apre il modale', run(() => {
    const prevUser = currentUser, prevTab = currentTab, saved = movies;
    currentUser = 'N'; currentTab = 'all';
    movies = [{ id: 'd-2', title: 'Guardia', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: 'azione' }];
    render();
    const card = document.getElementById('movieGrid')._children[0];
    closeModal('detailModal');
    card._handlers.click[0]({ target: { closest: () => 'button' } });
    const stillHidden = document.getElementById('detailModal').classList.contains('hidden');
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return stillHidden;
  }));
  ok('dettaglio: overview/cast/rating assenti → sezioni nascoste singolarmente (mai placeholder)', run(() => {
    const prevUser = currentUser, prevTab = currentTab, saved = movies;
    currentUser = 'N'; currentTab = 'all';
    movies = [{ id: 'd-3', title: 'NienteMeta', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: '', release_year: null, duration: '' }];
    render();
    openMovieDetail('d-3');
    const body = document.getElementById('detailBody')._innerHTML;
    const noSections = body.indexOf('mask-theater') === -1
      && body.indexOf('rating-holo') === -1
      && body.indexOf('NienteMeta') !== -1;
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return noSections;
  }));
  ok('dettaglio: sorpresa vista dall\'altra persona → click inerte; propria sorpresa → apre', run(() => {
    const prevUser = currentUser, prevTab = currentTab, saved = movies;
    currentUser = 'N'; currentTab = 'all';
    movies = [{ id: 's-1', title: 'Sorpresa Altrui', status: 'watchlist', added_by: 'V', poster: '', platform: '', surprise_by: 'V' }];
    render();
    const cardN = document.getElementById('movieGrid')._children[0];
    closeModal('detailModal');
    cardN._handlers.click[0]({ target: { closest: () => null } });
    const inertForOther = document.getElementById('detailModal').classList.contains('hidden');
    currentUser = 'V'; render();
    const cardV = document.getElementById('movieGrid')._children[0];
    closeModal('detailModal');
    cardV._handlers.click[0]({ target: { closest: () => null } });
    const opensForOwner = !document.getElementById('detailModal').classList.contains('hidden');
    movies = saved; currentUser = prevUser; currentTab = prevTab;
    return inertForOther && opensForOwner;
  }));
  ok('dettaglio ambient: setDetailAmbient applica url con/senza poster senza crash (fallback)', run(() => {
    const ambient = document.getElementById('detailAmbient');
    const prevBg = { u: null };
    ambient.style.setProperty = (k, v) => { prevBg[k.replace(/-/g, '_')] = v; };
    setDetailAmbient('https://image.tmdb.org/x/poster.jpg');
    const withPoster = !!prevBg.background_image && prevBg.background_image.indexOf('url("https://image.tmdb.org/x/poster.jpg")') !== -1;
    setDetailAmbient(null);
    const fallback = prevBg.background_image === 'none';
    setDetailAmbient('');
    return withPoster && fallback && prevBg.background_image === 'none';
  }));
  ok('dettaglio accent: dominantColorFromData — bucket più popolato (maggioranza rossa vince)', run(() => {
    const data = new Uint8ClampedArray(64 * 96 * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 200; data[i + 1] = 30; data[i + 2] = 30; data[i + 3] = 255; } // base rossa
    for (let i = 0; i < data.length; i += 4) {
      if (((i / 4) % 64) === 0) { data[i] = 10; data[i + 1] = 20; data[i + 2] = 40; data[i + 3] = 255; } // colonna scura 1/64
    }
    const c = dominantColorFromData(data);
    return c && c.r >= 192 && c.r <= 208 && c.g >= 24 && c.g <= 40 && c.b >= 24 && c.b <= 40;
  }));
  ok('dettaglio accent: dominantColorFromData — dati vuoti/tutto trasparente/null → null (no crash)', run(() => {
    const empty = dominantColorFromData(new Uint8ClampedArray(0));
    const alpha = new Uint8ClampedArray(64 * 96 * 4);
    for (let i = 0; i < alpha.length; i += 4) alpha[i + 3] = 0;
    return empty === null && dominantColorFromData(alpha) === null && dominantColorFromData(null) === null;
  }));
  ok('dettaglio accent: applyPosterAccent — senza poster fallback indigo (classe rimossa, accento vuoto, no crash)', run(() => {
    const panel = document.getElementById('detailPanel');
    const prev = { accent: '' };
    panel.style.setProperty = (k, v) => { if (k.indexOf('detail-accent') !== -1) prev.accent = v; };
    panel.classList.add('detail-accent');
    applyPosterAccent('');
    return !panel.classList.contains('detail-accent') && prev.accent === '';
  }));
  ok('HOME CTA: visibile nei tab di lista, nascosta in calendario (via render)', run(() => {
    const prevTab = currentTab, prevMode = dbMode;
    dbMode = 'local';
    currentTab = 'watchlist'; render();
    const cta = document.getElementById('sceltaCta');
    const visibleOnList = !cta.classList.contains('hidden');
    currentTab = 'calendar'; render();
    const hiddenOnCalendar = cta.classList.contains('hidden');
    currentTab = 'watchlist'; render();
    const visibleAgain = !cta.classList.contains('hidden');
    currentTab = prevTab; dbMode = prevMode;
    return visibleOnList && hiddenOnCalendar && visibleAgain;
  }));
  ok('HOME CTA: bottone Match Live nascosto offline (local), visibile con Supabase', run(() => {
    const prevTab = currentTab, prevMode = dbMode;
    dbMode = 'local'; currentTab = 'watchlist'; render();
    const ctaMatch = document.getElementById('ctaMatch');
    const hiddenLocal = ctaMatch.classList.contains('hidden');
    dbMode = 'supabase'; render();
    const visibleSup = !ctaMatch.classList.contains('hidden');
    currentTab = prevTab; dbMode = prevMode;
    return hiddenLocal && visibleSup;
  }));

  console.log('\n[render — pulsante "Togli veto"]');
  ok('unveto: solo sul veto PROPRIO (veto altrui e assente → nessun bottone)', run(() => {
    const saved = movies;
    const prevUser = currentUser, prevTab = currentTab, prevVetoes = vetoes;
    const wk = currentWeekKey();
    currentUser = 'N';
    currentTab = 'watchlist';
    movies = [
      { id: 'A', title: 'Alpha Watch', status: 'watchlist', added_by: 'N', poster: '', platform: '', genre: 'azione' }
    ];
    let ok1, ok2, ok3;
    vetoes = [{ id: 'vx1', person: 'N', movie_id: 'A', week_key: wk }];
    render();
    let html = document.getElementById('movieGrid').innerHTML;
    ok1 = html.indexOf('onclick="unvetoMovie(') !== -1 && html.indexOf('onclick="vetoMovie(') === -1;
    vetoes = [{ id: 'vx2', person: 'V', movie_id: 'A', week_key: wk }];
    render();
    html = document.getElementById('movieGrid').innerHTML;
    ok2 = html.indexOf('unvetoMovie') === -1 && html.indexOf('onclick="vetoMovie(') === -1;
    vetoes = [];
    render();
    html = document.getElementById('movieGrid').innerHTML;
    ok3 = html.indexOf('unvetoMovie') === -1 && html.indexOf('onclick="vetoMovie(') !== -1;
    currentTab = prevTab;
    currentUser = prevUser;
    vetoes = prevVetoes;
    movies = saved;
    return ok1 && ok2 && ok3;
  }));

  console.log('\n[renderScheduled — dedup next night]');
  ok('scheduledList: una serata con pick → niente doppione (lista vuota)', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [{ id: 'ma', title: 'M A', status: 'tonight', scheduled_date: '2026-10-24', scheduled_time: '21:30', added_by: 'N', platform: 'P', poster: '' }];
    movieNights = [{ id: 'n1', movie_id: 'ma', date: '2026-10-24', time: '21:30', status: 'confirmed', proposed_by: 'N' }];
    renderScheduled();
    const html = document.getElementById('scheduledList').innerHTML;
    const okR = html.indexOf('M A') === -1;
    movies = savedM; movieNights = savedN;
    return okR;
  }));
  ok('scheduledList: pick + altra serata → l\'altra compare, il pick no', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [
      { id: 'ma', title: 'M A', status: 'tonight', scheduled_date: '2026-10-24', scheduled_time: '21:30', added_by: 'N', platform: 'P', poster: '' },
      { id: 'mb', title: 'M B', status: 'tonight', scheduled_date: '2026-10-30', scheduled_time: '20:00', added_by: 'V', platform: 'Q', poster: '' }
    ];
    movieNights = [
      { id: 'n1', movie_id: 'ma', date: '2026-10-24', time: '21:30', status: 'confirmed', proposed_by: 'N' },
      { id: 'n2', movie_id: 'mb', date: '2026-10-30', time: '20:00', status: 'proposed', proposed_by: 'V' }
    ];
    renderScheduled();
    const html = document.getElementById('scheduledList').innerHTML;
    const okR = html.indexOf('M B') !== -1 && html.indexOf('M A') === -1;
    movies = savedM; movieNights = savedN;
    return okR;
  }));
  ok('scheduledList: unica serata datata = pick → contenitore svuotato (nessun residuo)', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [
      { id: 'ma', title: 'M A', status: 'tonight', scheduled_date: '2026-10-24', scheduled_time: '21:30', added_by: 'N', platform: 'P', poster: '' },
      { id: 'mb', title: 'M B', status: 'tonight', scheduled_date: '2026-10-30', scheduled_time: '20:00', added_by: 'V', platform: 'Q', poster: '' }
    ];
    movieNights = [
      { id: 'n1', movie_id: 'ma', date: '2026-10-24', time: '21:30', status: 'confirmed', proposed_by: 'N' },
      { id: 'n2', movie_id: 'mb', date: '2026-10-30', time: '20:00', status: 'proposed', proposed_by: 'V' }
    ];
    renderScheduled();                         // primo render: 1 riga (M B)
    const before = document.getElementById('scheduledList').innerHTML;
    movies = [{ id: 'ma', title: 'M A', status: 'tonight', scheduled_date: '2026-10-24', scheduled_time: '21:30', added_by: 'N', platform: 'P', poster: '' }];
    movieNights = [{ id: 'n1', movie_id: 'ma', date: '2026-10-24', time: '21:30', status: 'confirmed', proposed_by: 'N' }];
    renderScheduled();                         // secondo render: solo pick → vuoto
    const after = document.getElementById('scheduledList').innerHTML;
    const okR = before.indexOf('M B') !== -1 && after === '';
    movies = savedM; movieNights = savedN;
    return okR;
  }));
  ok('scheduledList: nulla di datato → "Nessun film programmato."', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [{ id: 'ma', title: 'M A', status: 'tonight', scheduled_date: null, added_by: 'N', platform: 'P', poster: '' }];
    movieNights = [{ id: 'n1', movie_id: 'ma', date: null, time: null, status: 'confirmed', proposed_by: 'N' }];
    renderScheduled();
    const html = document.getElementById('scheduledList').innerHTML;
    const okR = html.indexOf('Nessun film programmato.') !== -1;
    movies = savedM; movieNights = savedN;
    return okR;
  }));
  ok('scheduledList: legacy (scheduled_date senza movie_nights) resta in lista', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [{ id: 'lg', title: 'Legacy', status: 'tonight', scheduled_date: '2026-11-01', scheduled_time: '20:00', added_by: 'N', platform: 'PL', poster: '' }];
    movieNights = [];
    renderScheduled();
    const html = document.getElementById('scheduledList').innerHTML;
    const okR = html.indexOf('Legacy') !== -1;
    movies = savedM; movieNights = savedN;
    return okR;
  }));

  console.log('\n[renderScheduled — film watched]');
  ok('scheduledList: film watched con scheduled_date NON compare', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [{ id: 'w1', title: 'Watched Film', status: 'watched', scheduled_date: '2026-10-20', scheduled_time: '21:00', added_by: 'N', platform: 'P', poster: '' }];
    movieNights = [];
    renderScheduled();
    const html = document.getElementById('scheduledList').innerHTML;
    const okR = html.indexOf('Watched Film') === -1;
    movies = savedM; movieNights = savedN;
    return okR;
  }));
  ok('scheduledList: film in watchlist con data resta in lista', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [{ id: 'wl1', title: 'Planned Film', status: 'watchlist', scheduled_date: '2026-10-22', scheduled_time: '20:00', added_by: 'V', platform: 'Q', poster: '' }];
    movieNights = [];
    renderScheduled();
    const html = document.getElementById('scheduledList').innerHTML;
    const okR = html.indexOf('Planned Film') !== -1;
    movies = savedM; movieNights = savedN;
    return okR;
  }));
  ok('scheduledList: nessun altro caso cambia (watched+watchlist → solo watchlist; quick-only → messaggio)', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [
      { id: 'm1', title: 'Seen', status: 'watched', scheduled_date: '2026-10-20', added_by: 'N', platform: 'P', poster: '' },
      { id: 'm2', title: 'Keep', status: 'watchlist', scheduled_date: '2026-10-22', added_by: 'V', platform: 'Q', poster: '' }
    ];
    movieNights = [];
    renderScheduled();
    const mix = document.getElementById('scheduledList').innerHTML;
    const ok1 = mix.indexOf('Keep') !== -1 && mix.indexOf('Seen') === -1;
    movies = [{ id: 'q1', title: 'Quick', status: 'tonight', scheduled_date: null, added_by: 'N', platform: 'P', poster: '' }];
    movieNights = [{ id: 'nq', movie_id: 'q1', date: null, time: null, status: 'confirmed', proposed_by: 'N' }];
    renderScheduled();
    const quick = document.getElementById('scheduledList').innerHTML;
    const ok2 = quick.indexOf('Nessun film programmato.') !== -1;
    movies = savedM; movieNights = savedN;
    return ok1 && ok2;
  }));

  console.log('\n[nextMoviePick — fallback legacy: watched esclusi]');
  ok('nextMoviePick: film watched con scheduled_date + night_confirmed NON restituito', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [{ id: 'w1', title: 'W Seen', status: 'watched', scheduled_date: '2026-10-20', night_confirmed: true, proposed_by: 'N' }];
    movieNights = [];
    const pick = nextMoviePick();
    movies = savedM; movieNights = savedN;
    return pick === null;
  }));
  ok('nextMoviePick: film in watchlist con serata → sì', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [{ id: 'wl1', title: 'Planned', status: 'watchlist', scheduled_date: '2026-10-22', night_confirmed: true, proposed_by: 'V' }];
    movieNights = [];
    const pick = nextMoviePick();
    movies = savedM; movieNights = savedN;
    return pick !== null && pick.id === 'wl1';
  }));
  ok('nextMoviePick: film "tonight" → sì', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [{ id: 'tn1', title: 'Tonight', status: 'tonight' }];
    movieNights = [];
    const pick = nextMoviePick();
    movies = savedM; movieNights = savedN;
    return pick !== null && pick.id === 'tn1';
  }));
  ok('nextMoviePick: nessun altro caso cambia (serata attiva batte watched; quick legacy ok)', run(() => {
    const savedM = movies, savedN = movieNights;
    movies = [
      { id: 'ma', title: 'M A', status: 'tonight' },
      { id: 'w2', title: 'W Seen', status: 'watched', scheduled_date: '2026-10-20', night_confirmed: true, proposed_by: 'N' }
    ];
    movieNights = [{ id: 'n1', movie_id: 'ma', date: '2026-10-24', time: '21:30', status: 'confirmed', proposed_by: 'N' }];
    const pick1 = nextMoviePick();                       // percorso principale (movie_nights)
    movies = [{ id: 'lq', title: 'LegacyQ', status: 'tonight' }];
    movieNights = [];
    const pick2 = nextMoviePick();                       // fallback legacy quick
    movies = savedM; movieNights = savedN;
    return pick1 !== null && pick1.id === 'ma' && pick2 !== null && pick2.id === 'lq';
  }));

  ok('collapse: toggle mobile + render/resync non tocca lo stato del pannello', run(() => {
    const panel = document.getElementById('listFiltersPanel');
    const savedOpen = listFiltersOpen;
    panel.classList.remove('hidden');
    panel.classList.add('hidden'); // stato di default: collassato (su mobile)
    toggleListFiltersPanel();
    const opened = listFiltersOpen === true && !panel.classList.contains('hidden');
    render(); // un render/resync NON deve cambiare lo stato del collapse
    const afterRender = listFiltersOpen === true && !panel.classList.contains('hidden');
    toggleListFiltersPanel();
    const closed = listFiltersOpen === false && panel.classList.contains('hidden');
    listFiltersOpen = savedOpen;
    return opened && afterRender && closed;
  }));
  ok('dropdown: opzioni costruite una volta, selezione preservata, dati escapati (O\'Brien)', run(() => {
    const saved = movies;
    const prevG = listGenre, prevPl = listPlatform, prevP = listProposer;
    movies = [
      { id: 'c1', title: 'A', status: 'watchlist', added_by: 'N', genres: ["O'Brien"], platform: 'Netflix' },
      { id: 'c2', title: 'B', status: 'watchlist', added_by: 'V', genres: ['Horror'], platform: 'Netflix' }
    ];
    listGenre = ''; listPlatform = ''; listProposer = '';
    const g = document.getElementById('genreListFilterSelect');
    const pl = document.getElementById('platformFilterSelect');
    delete g.dataset.listGenreOptions;
    delete pl.dataset.listPlatformOptions;
    g.value = 'all'; pl.value = 'all';
    syncListFilterSelects();
    const html1 = g.innerHTML;
    const key = g.dataset.listGenreOptions;
    const hasEscape = html1.includes('O&#39;Brien (1)') && html1.includes("value=\"O\\'Brien\"")
      && html1.indexOf("O'Brien") === -1; // nessun apostrofo nudo
    g.value = "O'Brien";
    syncListFilterSelects(); // opzioni identiche: niente rebuild, scelta intatta
    const preserved = g.value === "O'Brien" && g.dataset.listGenreOptions === key && g.innerHTML === html1;
    const plBuilt = pl.innerHTML.includes('Netflix (2)');
    movies = saved;
    listGenre = prevG; listPlatform = prevPl; listProposer = prevP;
    return hasEscape && preserved && plBuilt;
  }));
  ok('dropdown: opzione scelta che sparisce torna a "all" (stato azzerato); opzione che resta preservata', run(() => {
    const saved = movies;
    const prevG = listGenre, prevPl = listPlatform, prevP = listProposer;
    const g = document.getElementById('genreListFilterSelect');
    const pl = document.getElementById('platformFilterSelect');
    const p = document.getElementById('proposerFilterSelect');
    movies = [
      { id: 'y1', title: 'A', status: 'watchlist', added_by: 'N', genres: ['Dramma'], platform: 'Netflix' }
    ];
    listGenre = ''; listPlatform = ''; listProposer = '';
    delete g.dataset.listGenreOptions; delete pl.dataset.listPlatformOptions; delete p.dataset.listProposerOptions;
    g.value = 'all'; pl.value = 'all'; p.value = 'all';
    syncListFilterSelects();
    setPlatformFilter('Netflix'); // selezione + stato coerenti
    setProposerFilter('N');
    const selected = listPlatform === 'Netflix' && pl.value === 'Netflix' && listProposer === 'N' && p.value === 'N';
    movies = [
      { id: 'y2', title: 'B', status: 'watchlist', added_by: 'N', genres: ['Dramma'], platform: 'Prime' }
    ]; // Netflix sparita dal dataset, 'N' resta
    syncListFilterSelects();
    const platformReset = listPlatform === '' && pl.value === 'all';
    const proposerKept = listProposer === 'N' && p.value === 'N';
    syncListFilterSelects(); // idempotenza: niente rebuild, stato invariato
    const idemOk = listPlatform === '' && pl.value === 'all' && listProposer === 'N' && p.value === 'N';
    movies = saved;
    listGenre = prevG; listPlatform = prevPl; listProposer = prevP;
    g.value = 'all'; pl.value = 'all'; p.value = 'all'; // ripristino select condivise
    return selected && platformReset && proposerKept && idemOk;
  }));
  ok('sort: toggle direzione aggiorna stato+icona; null sempre in fondo nelle due direzioni', run(() => {
    const saved = movies;
    const prevKey = listSortKey, prevDir = listSortDir, prevTab = currentTab;
    const prevQ = listQuery, prevP = listProposer, prevG = listGenre, prevPl = listPlatform;
    // stato filtri ermetico: eventuali selezioni residue di test precedenti
    // agirebbero sul predicato (es. proposer 'N' escluderebbe il film 'V').
    listQuery = ''; listProposer = ''; listGenre = ''; listPlatform = '';
    ['proposerFilterSelect', 'genreListFilterSelect', 'platformFilterSelect']
      .forEach(id => { document.getElementById(id).value = 'all'; });
    movies = [
      { id: 's1', title: 'Corto', status: 'watchlist', added_by: 'N', duration: '95 min', genres: ['Azione'], platform: 'Netflix', poster: '' },
      { id: 's2', title: 'NullDurata', status: 'watchlist', added_by: 'V', duration: null, genres: ['Azione'], platform: 'Netflix', poster: '' },
      { id: 's3', title: 'Lungo', status: 'watchlist', added_by: 'N', duration: '150 min', genres: ['Azione'], platform: 'Netflix', poster: '' }
    ];
    currentTab = 'all';
    listSortKey = 'duration'; listSortDir = 'asc'; renderSortDirBtn();
    render();
    const grid = () => document.getElementById('movieGrid').innerHTML;
    const pos = h => [h.indexOf('Corto'), h.indexOf('Lungo'), h.indexOf('NullDurata')];
    let [aC, aL, aN] = pos(grid());
    const ascOk = aC < aL && aL < aN;
    listSortDir = 'desc'; renderSortDirBtn();
    render();
    let [dC, dL, dN] = pos(grid());
    const descOk = dL < dC && dC < dN; // null (NullDurata) in fondo anche in desc
    toggleListSortDir(); // desc → asc
    const toggleAsc = listSortDir === 'asc' && document.getElementById('sortDirIcon').className.includes('fa-arrow-up-a-z');
    toggleListSortDir();
    const toggleDesc = listSortDir === 'desc' && document.getElementById('sortDirIcon').className.includes('fa-arrow-down-a-z');
    listSortDir = 'asc';
    setListSortKey('title');
    const keyTitle = listSortKey === 'title' && document.getElementById('sortKeySelect').value === 'title';
    render();
    let [tC, tL, tN] = pos(grid());
    const titleAscOk = tC < tL && tL < tN;
    listSortKey = prevKey; listSortDir = prevDir; currentTab = prevTab; movies = saved;
    listQuery = prevQ; listProposer = prevP; listGenre = prevG; listPlatform = prevPl;
    return ascOk && descOk && toggleAsc && toggleDesc && keyTitle && titleAscOk;
  }));
  ok('setter dropdown/sort + Azzera filtri: stato, select e vista sempre coerenti', run(() => {
    const savedMovies = movies;
    const prevU = currentUser, prevTab = currentTab;
    const prevP = listProposer, prevG = listGenre, prevPl = listPlatform, prevK = listSortKey, prevD = listSortDir;
    movies = [
      { id: 'f1', title: 'Azione Alfa', status: 'watchlist', added_by: 'N', genres: ['Azione'], platform: 'Netflix', poster: '' },
      { id: 'f2', title: 'Commedia Beta', status: 'watchlist', added_by: 'V', genres: ['Commedia'], platform: 'Prime', poster: '' }
    ];
    currentUser = 'N'; currentTab = 'all';
    listProposer = ''; listGenre = ''; listPlatform = ''; listSortKey = 'added'; listSortDir = 'desc';
    const grid = () => document.getElementById('movieGrid').innerHTML;
    setGenreListFilter('Azione');
    const genreOk = listGenre === 'Azione' && grid().includes('Azione Alfa') && grid().indexOf('Commedia Beta') === -1;
    resetListFiltersUI();
    setPlatformFilter('Prime');
    const platOk = listPlatform === 'Prime' && grid().includes('Commedia Beta') && grid().indexOf('Azione Alfa') === -1;
    resetListFiltersUI();
    setProposerFilter('N');
    const propOk = listProposer === 'N' && grid().includes('Azione Alfa') && grid().indexOf('Commedia Beta') === -1;
    resetListFiltersUI();
    setListSortKey('title');
    const sortOk = listSortKey === 'title' && document.getElementById('sortKeySelect').value === 'title';
    resetListFiltersUI();
    const resetOk = listProposer === '' && listGenre === '' && listPlatform === '' && listSortKey === 'added' && listSortDir === 'desc'
      && document.getElementById('proposerFilterSelect').value === 'all'
      && document.getElementById('genreListFilterSelect').value === 'all'
      && document.getElementById('platformFilterSelect').value === 'all'
      && document.getElementById('sortKeySelect').value === 'added'
      && document.getElementById('sortDirIcon').className.includes('fa-arrow-down');
    const allShown = grid().includes('Azione Alfa') && grid().includes('Commedia Beta');
    currentUser = prevU; currentTab = prevTab;
    listProposer = prevP; listGenre = prevG; listPlatform = prevPl; listSortKey = prevK; listSortDir = prevD;
    movies = savedMovies;
    return genreOk && platOk && propOk && sortOk && resetOk && allShown;
  }));

  // --- 8) match: logica pura — deck, seed, valutazione sessione (step 6) ---
  // Seed sempre iniettato: nessuna casualità reale nei test.
  console.log('\n[match — logica pura (seed, deck, sessione)]');
  ok('SESSION_TTL_HOURS = 6', run(() => SESSION_TTL_HOURS === 6));
  ok('newSeed: stub crypto 0xffffffff → 0x7fffffff (mask 31 bit)', run(() => {
    globalThis.crypto = { getRandomValues: a => { a[0] = 0xffffffff; return a; } };
    try { return newSeed() === 0x7fffffff; } finally { delete globalThis.crypto; }
  }));
  ok('newSeed: valori vari nello stub → sempre nel range 0..2^31-1', run(() => {
    const vals = [0, 1, 42, 0x7ffffffe, 0x40000000];
    globalThis.crypto = { getRandomValues: a => { a[0] = vals.shift(); return a; } };
    try {
      for (let i = 0; i < 5; i++) {
        const s = newSeed();
        if (!(Number.isInteger(s) && s >= 0 && s <= 0x7fffffff)) return false;
      }
      return true;
    } finally { delete globalThis.crypto; }
  }));
  ok('newSeed: fallback senza crypto → range valido', run(() => {
    const orig = Math.random;
    Math.random = () => 0.999999;
    try {
      const s = newSeed();
      return Number.isInteger(s) && s >= 0 && s <= 0x7fffffff;
    } finally { Math.random = orig; }
  }));
  ok('seededShuffle: stesso seed → stesso ordine (deterministico, nessuna perdita)', run(() => {
    const src = ['a', 'b', 'c', 'd', 'e', 'f'];
    const A = seededShuffle(src, 12345);
    const B = seededShuffle(src, 12345);
    return JSON.stringify(A) === JSON.stringify(B)
      && A.length === src.length
      && src.slice().sort().join() === A.slice().sort().join();
  }));
  ok('seededShuffle: seed diversi → ordini diversi', run(() => {
    const src = ['a', 'b', 'c', 'd', 'e', 'f'];
    const A = seededShuffle(src, 1);
    const B = seededShuffle(src, 999983);
    return JSON.stringify(A) !== JSON.stringify(B)
      && src.slice().sort().join() === A.slice().sort().join()
      && src.slice().sort().join() === B.slice().sort().join();
  }));
  ok('buildDeck: stesso seed → stesso mazzo; seed diverso → mazzo diverso', run(() => {
    const list = [
      { id: 'm1', title: 'A', status: 'watchlist' }, { id: 'm2', title: 'B', status: 'watchlist' },
      { id: 'm3', title: 'C', status: 'watchlist' }, { id: 'm4', title: 'D', status: 'watchlist' },
      { id: 'm5', title: 'E', status: 'watchlist' }
    ];
    const A = buildDeck(list, { seed: 7 });
    const B = buildDeck(list, { seed: 7 });
    const C = buildDeck(list, { seed: 8 });
    return A.seed === 7 && JSON.stringify(A.deck) === JSON.stringify(B.deck)
      && JSON.stringify(A.deck) !== JSON.stringify(C.deck)
      && A.deck.slice().sort().join() === 'm1,m2,m3,m4,m5';
  }));
  ok('buildDeck: filtra status/veto/escluse + dedupe (seed iniettato)', run(() => {
    const list = [
      { id: 'a', title: 'A', status: 'watchlist' },
      { id: 'b', title: 'B', status: 'tonight' },
      { id: 'c', title: 'C', status: 'watched' },
      { id: 'd', title: 'D' },
      { id: 'e', title: 'E', status: 'watchlist' },
      { id: 'f', title: 'F', status: 'watchlist' },
      { id: 'g', title: 'Doppio', status: 'watchlist' },
      { id: 'g', title: 'Doppio 2', status: 'watchlist' },
      { id: null, title: 'no-id', status: 'watchlist' }
    ];
    const r = buildDeck(list, { vetoedIds: ['e'], excludeIds: ['f'], seed: 5 });
    const deck = r.deck.slice().sort();
    return r.seed === 5 && deck.join() === 'a,d,g'
      && deck.length === new Set(deck).size;
  }));
  ok('buildDeck: i film swipati in sessioni PRECEDENTI sono riammessi', run(() => {
    const list = [{ id: 'x', title: 'X', status: 'watchlist' }, { id: 'y', title: 'Y', status: 'watchlist' }];
    // Il mazzo NON consulta gli swipe passati: x e y restano ammissibili.
    const r = buildDeck(list, { seed: 11 });
    return r.deck.slice().sort().join() === 'x,y';
  }));
  ok('activeSession: solo open|matched attive; done non è ripresa', run(() => {
    const a = activeSession([
      { id: 's-open', status: 'open', created_at: 3 },
      { id: 's-done', status: 'done', created_at: 9 },
      { id: 's-closed', status: 'closed', created_at: 7 }
    ]);
    return a && a.id === 's-open';
  }));
  ok('activeSession: matched è attiva, la più recente vince, vuoto → null', run(() => {
    const a = activeSession([
      { id: 'm1', status: 'matched', created_at: '2026-09-10T10:00:00Z' },
      { id: 'm2', status: 'open', created_at: '2026-09-12T10:00:00Z' }
    ]);
    return a && a.id === 'm2' && activeSession([]) === null && activeSession(null) === null;
  }));
  ok('swipesForCard: coppia mancante → undefined; persone non N/V ignorate', run(() => {
    const swipes = [
      { movie_id: 'm1', person: 'N', liked: true, created_at: 1 },
      { movie_id: 'm1', person: 'X', liked: true, created_at: 2 }, // invalida
      { movie_id: 'm2', person: 'V', liked: false, created_at: 3 }
    ];
    const r1 = swipesForCard(swipes, 'm1');
    const r2 = swipesForCard(swipes, 'm2');
    return r1.N === true && r1.V === undefined
      && r2.V === false && r2.N === undefined
      && hasMatchOnCard(swipes, 'm1') === false
      && hasMatchOnCard([
        { movie_id: 'm1', person: 'N', liked: true },
        { movie_id: 'm1', person: 'V', liked: true }
      ], 'm1') === true;
  }));
  ok('lastActivityAt: max creato_at degli swipe, altrimenti created_at sessione', run(() => {
    const session = { id: 'sn', created_at: 100 };
    const a = lastActivityAt(session, [
      { movie_id: 'm', person: 'N', created_at: 300 },
      { movie_id: 'm', person: 'V', created_at: 200 }
    ]);
    const b = lastActivityAt(session, []);
    const c = lastActivityAt({ id: 's2', created_at: '2026-09-01T00:00:00Z' }, []);
    return a === 300 && b === 100 && c === Date.parse('2026-09-01T00:00:00Z');
  }));
  ok('isExpired: a cavallo delle 6 ore (now iniettato)', run(() => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    const fresh = { id: 's', created_at: now - 5 * 3600000 };
    const boundary = { id: 's2', created_at: now - 6 * 3600000 };
    const old = { id: 's3', created_at: now - 7 * 3600000 };
    return isExpired(fresh, [], now) === false
      && isExpired(boundary, [], now) === true
      && isExpired(old, [], now) === true;
  }));
  ok('isExpired: un swipe recente tiene viva una sessione vecchia', run(() => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    const session = { id: 's', created_at: now - 20 * 3600000 };
    const swipes = [
      { movie_id: 'm', person: 'N', created_at: now - 2 * 3600000 },
      { movie_id: 'm', person: 'V', created_at: now - 3600000 }
    ];
    return lastActivityAt(session, swipes) === now - 3600000
      && isExpired(session, swipes, now) === false;
  }));
  ok('currentIndex: primo card senza entrambe le risposte; esaurito → lunghezza', run(() => {
    const deck = ['a', 'b', 'c'];
    const none = currentIndex(deck, []);
    const oneN = currentIndex(deck, [{ movie_id: 'a', person: 'N', liked: true }]);
    const abPartial = currentIndex(deck, [
      { movie_id: 'a', person: 'N', liked: true } , { movie_id: 'a', person: 'V', liked: false },
      { movie_id: 'b', person: 'N', liked: false }
    ]);
    const allDone = currentIndex(deck, [
      { movie_id: 'a', person: 'N', liked: true }, { movie_id: 'a', person: 'V', liked: true },
      { movie_id: 'b', person: 'N', liked: false }, { movie_id: 'b', person: 'V', liked: true },
      { movie_id: 'c', person: 'N', liked: true }, { movie_id: 'c', person: 'V', liked: true }
    ]);
    return none === 0 && oneN === 0 && abPartial === 1 && allDone === 3;
  }));
  ok('currentIndex: film cancellato nel deck = card risolto', run(() => {
    const deck = ['ghost', 'ok'];
    const moviesList = [{ id: 'ok', title: 'OK', status: 'watchlist' }];
    return currentIndex(deck, [], moviesList) === 1;
  }));
  ok('resolveDeckMovie: trova il film o null (niente crash su id mancante)', run(() => {
    const list = [{ id: 'm1', title: 'T1' }];
    return resolveDeckMovie(list, 'm1') && resolveDeckMovie(list, 'm1').title === 'T1'
      && resolveDeckMovie(list, 'zzz') === null
      && resolveDeckMovie([], 'm1') === null
      && resolveDeckMovie(null, 'm1') === null;
  }));
  ok('pendingMatch: nessun doppio like → null', run(() => {
    return pendingMatch({ id: 's', matched_movie_id: null }, [
      { movie_id: 'a', person: 'N', liked: true }, { movie_id: 'a', person: 'V', liked: false }
    ], ['a', 'b']) === null;
  }));
  ok('pendingMatch: doppio like → id col card più alto del DECK (non timestamp)', run(() => {
    // doppio like su a e b: vince b (ordine deck), anche se i like di a sono più "recenti".
    const swipes = [
      { movie_id: 'b', person: 'V', liked: true, created_at: 1 },
      { movie_id: 'b', person: 'N', liked: true, created_at: 2 },
      { movie_id: 'a', person: 'N', liked: true, created_at: 3 },
      { movie_id: 'a', person: 'V', liked: true, created_at: 4 }
    ];
    return pendingMatch({ id: 's', matched_movie_id: null }, swipes, ['a', 'b']) === 'b';
  }));
  ok('pendingMatch: "Continua poi reconcile in ritardo" → null (nessuna ricelebrazione)', run(() => {
    // Primo match su "a" già celebrato e continuato: il reconcile tardivo
    // dell'altro telefono NON deve portare a una nuova celebrazione.
    const session = { id: 's', status: 'matched', matched_movie_id: 'a' };
    const swipes = [
      { movie_id: 'a', person: 'N', liked: true },
      { movie_id: 'a', person: 'V', liked: true }
    ];
    return pendingMatch(session, swipes, ['a', 'b']) === null;
  }));
  ok('pendingMatch: un secondo match successivo → restituisce il nuovo id', run(() => {
    const session = { id: 's', status: 'matched', matched_movie_id: 'a' };
    const swipes = [
      { movie_id: 'a', person: 'N', liked: true }, { movie_id: 'a', person: 'V', liked: true },
      { movie_id: 'b', person: 'N', liked: true }, { movie_id: 'b', person: 'V', liked: true }
    ];
    return pendingMatch(session, swipes, ['a', 'b']) === 'b';
  }));
  ok('pendingMatch: film cancellato nel deck mai celebrato', run(() => {
    const swipes = [
      { movie_id: 'ghost', person: 'N', liked: true }, { movie_id: 'ghost', person: 'V', liked: true }
    ];
    return pendingMatch({ id: 's', matched_movie_id: null }, swipes, ['ghost', 'ok'],
      [{ id: 'ok', status: 'watchlist' }]) === null;
  }));
  ok('countAllMatches: conta i doppio like; persone non valide ignorate', run(() => {
    const swipes = [
      { movie_id: 'a', person: 'N', liked: true }, { movie_id: 'a', person: 'V', liked: true },
      { movie_id: 'b', person: 'N', liked: true }, { movie_id: 'b', person: 'Z', liked: true },
      { movie_id: 'c', person: 'N', liked: true }, { movie_id: 'c', person: 'V', liked: false }
    ];
    return countAllMatches(swipes) === 1;
  }));
  ok('sessionAgreement: accordo su giudizio identico (like E dislike); totale = risolti da entrambi', run(() => {
    const swipes = [
      { movie_id: 'a', person: 'N', liked: true }, { movie_id: 'a', person: 'V', liked: true },
      { movie_id: 'b', person: 'N', liked: true }, { movie_id: 'b', person: 'V', liked: false },
      { movie_id: 'c', person: 'N', liked: false }, { movie_id: 'c', person: 'V', liked: false },
      { movie_id: 'd', person: 'N', liked: false }, { movie_id: 'd', person: 'V', liked: true },
      { movie_id: 'e', person: 'N', liked: true }, { movie_id: 'e', person: 'V', liked: false }
    ];
    const r = sessionAgreement(swipes);
    return r.total === 5 && r.agreed === 2 && r.pct === 40;
  }));
  ok('sessionAgreement: 0 risolti → pct null (mai 0%); 1-2 risolti → % contata comunque; 3+ → nota', run(() => {
    const a0 = sessionAgreement([]);
    const a1 = sessionAgreement([{ movie_id: 'x', person: 'N', liked: true }]); // solo N
    const a2 = sessionAgreement([{ movie_id: 'x', person: 'N', liked: true }, { movie_id: 'x', person: 'V', liked: true }]);
    const a3 = sessionAgreement([
      { movie_id: 'x', person: 'N', liked: true }, { movie_id: 'x', person: 'V', liked: true },
      { movie_id: 'y', person: 'N', liked: true }, { movie_id: 'y', person: 'V', liked: true },
      { movie_id: 'z', person: 'N', liked: true }, { movie_id: 'z', person: 'V', liked: true }
    ]);
    return a0.total === 0 && a0.pct === null
      && a1.total === 0 && a1.pct === null
      && a2.total === 1 && a2.agreed === 1 && a2.pct === 100
      && a3.total === 3 && a3.agreed === 3 && a3.pct === 100;
  }));
  ok('sessionAgreement: film cancellato ignorato; persona non valida ignorata; semirisolto escluso', run(() => {
    const moviesList = [{ id: 'ok', status: 'watchlist' }];
    const swipes = [
      { movie_id: 'ghost', person: 'N', liked: true }, { movie_id: 'ghost', person: 'V', liked: true }, // cancellato
      { movie_id: 'ok', person: 'Z', liked: true },                                                    // person invalida
      { movie_id: 'ok', person: 'N', liked: true }                                                     // semirisolto
    ];
    const r = sessionAgreement(swipes, moviesList);
    return r.total === 0 && r.agreed === 0 && r.pct === null;
  }));
  ok('evaluateSession: swipe → card corrente; match → celebra; done → riepilogo', run(() => {
    const moviesList = [
      { id: 'a', title: 'A', status: 'watchlist' },
      { id: 'b', title: 'B', status: 'watchlist' },
      { id: 'c', title: 'C', status: 'watchlist' }
    ];
    const deck = ['a', 'b', 'c'];
    const s0 = evaluateSession({ id: 's', deck, status: 'open' }, [], moviesList);
    const s1 = evaluateSession({ id: 's', deck, status: 'open' }, [{ movie_id: 'a', person: 'N', liked: true }], moviesList);
    const sMatch = evaluateSession({ id: 's', deck, status: 'matched' }, [
      { movie_id: 'a', person: 'N', liked: true }, { movie_id: 'a', person: 'V', liked: true }
    ], moviesList);
    const consumed = evaluateSession({ id: 's', deck, status: 'open', matched_movie_id: 'a' }, [
      { movie_id: 'a', person: 'N', liked: true }, { movie_id: 'a', person: 'V', liked: true }
    ], moviesList);
    const done = evaluateSession({ id: 's', deck, status: 'done', matched_movie_id: 'a' }, [
      { movie_id: 'a', person: 'N', liked: true }, { movie_id: 'a', person: 'V', liked: true },
      { movie_id: 'b', person: 'N', liked: false }, { movie_id: 'b', person: 'V', liked: true },
      { movie_id: 'c', person: 'N', liked: true }, { movie_id: 'c', person: 'V', liked: false }
    ], moviesList);
    return s0.view === 'swipe' && s0.movieId === 'a' && s0.index === 0 && s0.matches === 0
      && s1.view === 'swipe' && s1.movieId === 'a'
      && sMatch.view === 'match' && sMatch.movieId === 'a' && sMatch.matches === 1
      && consumed.view === 'swipe' && consumed.movieId === 'b'
      && done.view === 'done' && done.movieId === null && done.index === 3 && done.matches === 1;
  }));
  ok('evaluateSession: match sull\'ultimo card → celebra prima del riepilogo', run(() => {
    const moviesList = [{ id: 'm', title: 'Ultimo', status: 'watchlist' }];
    const r = evaluateSession({ id: 's', deck: ['m'], status: 'matched' }, [
      { movie_id: 'm', person: 'N', liked: true }, { movie_id: 'm', person: 'V', liked: true }
    ], moviesList);
    return r.view === 'match' && r.movieId === 'm';
  }));
  ok('evaluateSession: persone non N/V ignorate; film cancellato = card risolto', run(() => {
    const moviesList = [{ id: 'ok', title: 'OK', status: 'watchlist' }];
    const r = evaluateSession({ id: 's', deck: ['ghost', 'ok'], status: 'open' }, [
      { movie_id: 'ghost', person: 'Z', liked: true }, // person invalida: ignorata
      { movie_id: 'ok', person: 'N', liked: true }
    ], moviesList);
    return r.view === 'swipe' && r.movieId === 'ok';
  }));

  // --- 8b) match — data layer + canale SEPARATO (mock sb, step 6 commit 3) ---
  // Mock in-memory di Supabase per sessione/swipe + canale virtuale.
  console.log('\n[match — data layer + canale separato]');
  vm.runInContext(`
    function mockMatchSb(seed) {
      // Root tabellare generico: la serata dal Match (setQuickTonight/proposeNight)
      // scrive su movie_nights/movies, la sessione swipe su swipe_sessions/swipes.
      const root = {
        swipe_sessions: (seed && seed.sessions) ? seed.sessions.map(x => Object.assign({ deck: [] }, x)) : [],
        swipes: (seed && seed.swipes) ? seed.swipes.slice() : [],
        movies: (seed && seed.movies) ? seed.movies.map(x => Object.assign({}, x)) : [],
        votes: [],
        vetoes: [],
        movie_nights: (seed && seed.movie_nights) ? seed.movie_nights.slice() : []
      };
      const calls = {
        gets: [], inserts: 0, inserted: [], upserts: [],
        updates: [], removes: 0, removed: [], channels: [], tracks: 0, trackPayloads: []
      };
      // Registro presence PER-TOPIC. Con seed.hub condiviso tra più mock si
      // simula il WEBSOCKET REALE: N e V iscritti allo STESSO topic vedono gli
      // stessi pezzi (come su un topic Realtime vero); topic diversi = regioni
      // diverse (i due client non si vedono). Questo è il punto che lo smoke
      // PRECEDENTE non simulava (mock statico senza separazione per-topic).
      const hub = (seed && seed.hub) ? seed.hub : null;
      const ownRegions = {};
      const regionOf = topic => {
        const base = hub ? (hub.presence || (hub.presence = {})) : ownRegions;
        return (base[topic] || (base[topic] = {}));
      };
      const liveChannels = [];
      const failInsert = seed ? seed.failInsert : null;
      const slowProbe  = !!(seed && seed.slowProbe);
      const pref = { swipe_sessions: 'sess', swipes: 'sw', movies: 'mov', movie_nights: 'night' };
      const rowsOf = name => (root[name] || (root[name] = []));
      const makeId = name => pref[name] + '-' + (rowsOf(name).length + 1);
      const filter = (name, b) => {
        let out = rowsOf(name).slice();
        if (b._eq) out = out.filter(r => r[b._eq.col] === b._eq.v);
        if (b._in) out = out.filter(r => b._in.vals.indexOf(r[b._in.col]) !== -1);
        return out;
      };
      const from = name => {
        const b = {
          _limit: null, _order: null, _eq: null, _in: null,
          select(cols) { this._cols = cols || '*'; return this; },
          order(col, o) { this._order = col; this._asc = !!(o && o.ascending); return this; },
          limit(n) { this._limit = n; return this; },
          eq(col, v) { this._eq = { col, v }; return this; },
          in(col, vals) { this._in = { col, vals }; return this; },
          insert(rows) {
            calls.inserts += rows.length;
            if (failInsert) return { select: async () => ({ data: null, error: { code: failInsert, message: 'unique violation' } }) };
            const made = rows.map(r => Object.assign({ id: makeId(name), created_at: new Date().toISOString() }, r));
            rowsOf(name).unshift.apply(rowsOf(name), made);
            calls.inserted = made;
            return { select: async () => ({ data: made.map(x => Object.assign({}, x)), error: null }) };
          },
          upsert(rows, opts) {
            calls.upserts.push({ rows: rows.map(r => Object.assign({}, r)), opts: Object.assign({}, opts) });
            rows.forEach(r => {
              const table = rowsOf(name);
              const i = table.findIndex(x =>
                x.session_id === r.session_id && x.movie_id === r.movie_id && x.person === r.person);
              if (i >= 0) { if (!(opts && opts.ignoreDuplicates)) table[i] = Object.assign({}, table[i], r); }
              else table.push(Object.assign({ id: makeId(name) }, r));
            });
            return Promise.resolve({ error: null });
          },
          update(patch) {
            return {
              eq(col, v) { b._eq = { col, v }; return this; },
              in(col, vals) { b._in = { col, vals }; return this; },
              select: async () => {
                const rows = filter(name, b).filter(r => !b._in || b._in.vals.indexOf(r.status) !== -1);
                calls.updates.push({
                  table: name, patch: Object.assign({}, patch),
                  eq: b._eq ? Object.assign({}, b._eq) : null,
                  in: b._in ? { vals: b._in.vals.slice() } : null,
                  affected: rows.map(r => r.id)
                });
                rows.forEach(r => Object.assign(r, patch));
                return { data: rows.map(r => Object.assign({}, r)), error: null };
              }
            };
          },
          then(resolve) {
            if (slowProbe) return new Promise(() => {});
            calls.gets.push(name);
            let rows = filter(name, b);
            if (b._order) rows = rows.slice().sort((x, y) => {
              const a = String(x[b._order] || ''), c = String(y[b._order] || '');
              if (a === c) return 0;
              return (a > c ? 1 : -1) * (b._asc ? 1 : -1);
            });
            if (b._limit != null) rows = rows.slice(0, b._limit);
            return resolve({ data: rows.map(x => Object.assign({}, x)), error: null });
          }
        };
        return b;
      };
      return {
        from,
        channel(name, opts) {
          const pkey = (opts && opts.config && opts.config.presence && opts.config.presence.key) || null;
          const ch = {
            name, opts: opts || {}, bindings: [],
            on(ev, filterOrCb, cb) { this.bindings.push({ ev, filter: filterOrCb, cb }); return this; },
            subscribe(cb) {
              this.statusCb = cb;
              liveChannels.push(this);
              calls.channels.push({ name: this.name, bindingsAtSubscribe: this.bindings.length, ch: this });
              return this;
            },
            track(p) {
              calls.tracks++; calls.trackPayloads.push(Object.assign({}, p));
              const region = regionOf(this.name);
              const key = pkey || (p && p.user) || 'anon';
              if (!region[key]) region[key] = [];
              region[key].push(Object.assign({ user: p && p.user, tracked_at: new Date().toISOString() }, p));
              return Promise.resolve('ok');
            },
            untrack() {
              calls.tracks--;
              const region = regionOf(this.name);
              if (pkey && region[pkey]) delete region[pkey];
              return Promise.resolve('ok');
            },
            presenceState() {
              const region = regionOf(this.name);
              const out = {};
              Object.keys(region).forEach(k => out[k] = region[k].slice());
              return out;
            },
            // Simula un evento presence ARRIVATO dal websocket: fuoca i binding
            // presence (sync/join/leave) con lo snapshot corrente del topic.
            firePresence(kind) {
              const region = regionOf(this.name);
              const snap = {};
              Object.keys(region).forEach(k => snap[k] = region[k].slice());
              this.bindings.filter(b => b.ev === 'presence').forEach(b => {
                if (kind && b.filter && b.filter.event && b.filter.event !== kind) return;
                b.cb({ event: kind || 'sync', key: pkey, currentPresences: snap, newPresences: [] });
              });
            },
            fire(status, err) { if (this.statusCb) this.statusCb(status, err); }
          };
          return ch;
        },
        removeChannel(ch) {
          calls.removes++; calls.removed.push(ch ? ch.name : null);
          if (ch) {
            ch.removed = true;
            const i = liveChannels.indexOf(ch);
            if (i >= 0) liveChannels.splice(i, 1);
          }
          return Promise.resolve('ok');
        },
        getChannels() { return liveChannels.slice(); },
        __calls: () => calls,
        __sessions: () => root.swipe_sessions,
        __swipes: () => root.swipes,
        __root: () => root
      };
    }
    function __matchSnap() {
      return { sb, dbMode, currentUser, movies, vetoes, movieNights,
        matchAvailable, swipeSessions, swipes, matchChannel, matchResyncTimer,
        matchProbeDone, matchLeaving, matchUnavailableWarnedAt,
        matchProbeTimeoutMs, lobbyPresenceState, realtimeChannel,
        matchChannelStatus, currentTab, matchPrevTab, matchDragging,
        matchPendingRender, matchNightCreated, matchPendingSchedule, matchExitTimer,
        matchEnterErrorMsg, matchEnterErrorLogged, matchContinueErrLoggedAt };
    }
    function __matchRestore(p) {
      sb = p.sb; dbMode = p.dbMode; currentUser = p.currentUser; movies = p.movies;
      vetoes = p.vetoes; movieNights = p.movieNights;
      matchAvailable = p.matchAvailable; swipeSessions = p.swipeSessions; swipes = p.swipes;
      matchChannel = p.matchChannel; matchResyncTimer = p.matchResyncTimer;
      matchProbeDone = p.matchProbeDone;
      matchLeaving = p.matchLeaving; matchUnavailableWarnedAt = p.matchUnavailableWarnedAt;
      matchProbeTimeoutMs = p.matchProbeTimeoutMs; lobbyPresenceState = p.lobbyPresenceState;
      realtimeChannel = p.realtimeChannel;
      matchChannelStatus = p.matchChannelStatus; currentTab = p.currentTab;
      matchPrevTab = p.matchPrevTab; matchDragging = p.matchDragging;
      matchPendingRender = p.matchPendingRender; matchNightCreated = p.matchNightCreated;
      matchPendingSchedule = p.matchPendingSchedule; matchExitTimer = p.matchExitTimer;
      matchEnterErrorMsg = p.matchEnterErrorMsg; matchEnterErrorLogged = p.matchEnterErrorLogged;
      matchContinueErrLoggedAt = p.matchContinueErrLoggedAt;
    }
    // Riallinea lo stato minimo delle viste Match (niente canale reale: la
    // vista "completa" dei casi si testa impostando direttamente lo stato).
    function __matchUI(seed) {
      matchAvailable = true; matchChannelStatus = 'subscribed'; matchChannel = {};
      matchLeaving = false; matchNightCreated = null; matchPendingSchedule = null;
      matchDragging = false; matchPendingRender = false; matchExitTimer = null;
      matchProbeDone = true; matchProbeTimeoutMs = 3000;
      currentTab = 'match'; matchPrevTab = 'watchlist';
      currentUser = seed && seed.user ? seed.user : 'N';
      swipeSessions = (seed && seed.sessions) ? seed.sessions.slice() : [];
      swipes = (seed && seed.swipes) ? seed.swipes.slice() : [];
      movies = (seed && seed.movies) ? seed.movies.slice() : [];
      lobbyPresenceState = (seed && seed.presence) ? seed.presence.slice() : [];
    }
  `, sandbox);

  await okA('ensureActiveSession: attiva recente → ripresa, nessun insert', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 's-fresh', status: 'open', created_at: new Date(Date.now() - 60000).toISOString() }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = await ensureActiveSession();
      return session && session.id === 's-fresh'
        && mock.__calls().inserts === 0
        && swipeSessions[0].id === 's-fresh';
    } finally { __matchRestore(p); }
  }));

  await okA('ensureActiveSession: attiva SCADUTA → closeSession (filter id+status) poi nuova sessione', runA(async () => {
    const p = __matchSnap();
    const old = new Date(Date.now() - 7 * 3600000).toISOString();
    const mock = mockMatchSb({ sessions: [{ id: 's-old', status: 'open', created_at: old }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = await ensureActiveSession();
      const calls = mock.__calls();
      const closed = calls.updates.find(u => u.patch.status === 'closed');
      const fresh = mock.__sessions().find(x => x.status === 'open');
      return session && session.id !== 's-old'
        && calls.inserts === 1
        && closed && closed.eq.col === 'id' && closed.eq.v === 's-old'
        && closed.in.vals.join() === 'open,matched'
        && fresh.status === 'open';
    } finally { __matchRestore(p); }
  }));

  await okA('ensureActiveSession: ultima sessione done → nuova sessione (done non riprendibile)', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 's-done', status: 'done', created_at: new Date().toISOString() }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = await ensureActiveSession();
      return session && session.status === 'open' && session.id !== 's-done'
        && mock.__calls().inserts === 1;
    } finally { __matchRestore(p); }
  }));

  await okA('startNewSession: corsa 23505 → aggancio alla sessione attiva esistente (niente errori)', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ failInsert: '23505', sessions: [{ id: 's-existing', status: 'open', created_at: new Date().toISOString() }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = await startNewSession();
      return session && session.id === 's-existing' && swipeSessions[0].id === 's-existing';
    } finally { __matchRestore(p); }
  }));

  await okA('closeSession: SOLO per id e SOLO open|matched (done/closed intatte)', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [
      { id: 's-open', status: 'open', created_at: new Date().toISOString() },
      { id: 's-done', status: 'done', created_at: new Date().toISOString() }
    ] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      await closeSession('s-done');           // filtro esclude done → 0 righe
      const updated = await closeSession('s-open');
      const calls = mock.__calls();
      const rows = mock.__sessions();
      const doneRow = rows.find(x => x.id === 's-done');
      const openRow = rows.find(x => x.id === 's-open');
      return updated && updated.status === 'closed'
        && doneRow.status === 'done'
        && openRow.status === 'closed'
        && calls.updates[0].in.vals.join() === 'open,matched' && calls.updates[0].affected.length === 0
        && calls.updates[1].eq.v === 's-open' && calls.updates[1].affected.length === 1;
    } finally { __matchRestore(p); }
  }));

  await okA('recordSwipe: upsert su onConflict+ignoreDuplicates; il doppio like NON scrive (celebrazione dai dati, status resta open)', runA(async () => {
    const p = __matchSnap();
    const movie = { id: 'ma', title: 'Match A', status: 'watchlist' };
    const mock = mockMatchSb({ sessions: [{ id: 's1', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [movie]; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = { id: 's1', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
      await recordSwipe(session, 'ma', 'N', true);
      const up = mock.__calls().upserts[0];
      const optsOk = up.opts.onConflict === 'session_id,movie_id,person' && up.opts.ignoreDuplicates === true
        && up.rows[0].session_id === 's1' && up.rows[0].movie_id === 'ma' && up.rows[0].person === 'N' && up.rows[0].liked === true;
      await recordSwipe(session, 'ma', 'V', true);
      const calls = mock.__calls();
      const s = mock.__sessions().find(x => x.id === 's1');
      return optsOk
        && calls.upserts.length === 2
        && calls.updates.filter(f => f.patch.status === 'matched').length === 0   // il match NON si scrive mai
        && s.status === 'open' && s.matched_movie_id === undefined && !s.matched_at;
    } finally { __matchRestore(p); }
  }));

  await okA('reconcileSession: sessione già closed → NESSUNA modifica (reconcile in ritardo non riapre)', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 'sX', status: 'closed', created_at: new Date().toISOString(), deck: ['ma'] }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [{ id: 'ma', status: 'watchlist' }]; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = { id: 'sX', status: 'closed', created_at: new Date().toISOString(), deck: ['ma'], matched_movie_id: null };
      await reconcileSession(session, [
        { movie_id: 'ma', person: 'N', liked: true },
        { movie_id: 'ma', person: 'V', liked: true }
      ]);
      const calls = mock.__calls();
      const row = mock.__sessions().find(x => x.id === 'sX');
      return row.status === 'closed'
        && (calls.updates.length === 0 || calls.updates.every(u => u.affected.length === 0));
    } finally { __matchRestore(p); }
  }));

  await okA('continueMatch = RICONOSCIMENTO: matched_movie_id=pending + open, condizionato a open|matched; reconcile tardivo non riscrive', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 'sC', status: 'open', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: null }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [{ id: 'ma', status: 'watchlist' }, { id: 'mb', status: 'watchlist' }];
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = { id: 'sC', status: 'open', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: null };
      swipeSessions = [session];
      swipes = [
        { movie_id: 'ma', person: 'N', liked: true },
        { movie_id: 'ma', person: 'V', liked: true }
      ];
      await continueMatch(session);
      const up0 = mock.__calls().updates[0];
      const afterContinue = mock.__calls().updates.length === 1
        && up0.patch.status === 'open' && up0.patch.matched_movie_id === 'ma' && up0.patch.matched_at
        && up0.in.vals.join() === 'open,matched';
      await reconcileSession(session, swipes); // il "reconcile in ritardo" dell'altro telefono
      const row = mock.__sessions().find(x => x.id === 'sC');
      return afterContinue && row.status === 'open'
        && mock.__calls().updates.length === 1   // nessuna update aggiuntiva (niente ricelebrazione / riscritture)
        && row.matched_movie_id === 'ma' && Boolean(row.matched_at);
    } finally { __matchRestore(p); }
  }));

  await okA('resyncMatchQuiet: il partner chiude e apre una nuova → ci agganciamo alla NUOVA', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 's-old', status: 'open', created_at: new Date(Date.now() - 120000).toISOString() }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      await ensureActiveSession();
      const sOld = mock.__sessions()[0];
      mock.__sessions()[0].status = 'closed'; // partner chiude
      mock.__sessions().push({ id: 's-new', status: 'open', created_at: new Date().toISOString(), deck: [] });
      await resyncMatchQuiet();
      return swipeSessions[0].id === 's-new';
    } finally { __matchRestore(p); }
  }));

  // --- 8b3) regressioni "riconoscimento match dai dati" (commit fix) ---
  // Il caso rosso del doppio client resta permanente: il percorso swipe NON
  // scrive più status 'matched' (celebrazione derivata dai dati via
  // pendingMatch); matched_movie_id vive SOLO del riconoscimento ("Continua");
  // la transizione open→done è delegata anche al resync (sullo stato
  // fetchato, non sugli swipe locali).
  console.log('\n[match — riconoscimento dai dati (regressioni fix)]');

  await okA('reb(a) primo match: celebrato su entrambi e NESSUNA scrittura di stato (prima del fix il 2° fetch scriveva matched)', runA(async () => {
    const p = __matchSnap();
    const A = { id: 'ma', title: 'A', status: 'watchlist' };
    const B = { id: 'mb', title: 'B', status: 'watchlist' };
    const mock = mockMatchSb({ sessions: [{ id: 'sA', status: 'open', created_at: new Date().toISOString(), deck: ['ma', 'mb'] }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [A, B]; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = mock.__sessions()[0];
      await recordSwipe(session, 'ma', 'N', true);
      await recordSwipe(session, 'ma', 'V', true);
      const s = mock.__sessions().find(x => x.id === 'sA');
      const partner = await fetchLatestMatchState();
      const mine = evaluateSession(swipeSessions[0], swipes, movies);
      const theirs = evaluateSession(partner.session, partner.swipes, movies);
      console.log('[reb(a)] update matched=' + mock.__calls().updates.filter(u => u.patch.status === 'matched').length
        + ' status=' + s.status + ' mmid=' + (s.matched_movie_id || '∅')
        + ' vista locale=' + mine.view + '/' + mine.movieId + ' vista partner=' + theirs.view + '/' + theirs.movieId);
      return mock.__calls().updates.filter(u => u.patch.status === 'matched').length === 0
        && s.status === 'open' && s.matched_movie_id === undefined
        && mine.view === 'match' && mine.movieId === 'ma'
        && theirs.view === 'match' && theirs.movieId === 'ma';
    } finally { __matchRestore(p); }
  }));

  await okA('reb(b) match A + Continua, poi match B quasi-simultaneo: riconosciuto di nuovo, mmid=B, card successivo su entrambi', runA(async () => {
    const p = __matchSnap();
    const A = { id: 'ma', title: 'A', status: 'watchlist' };
    const B = { id: 'mb', title: 'B', status: 'watchlist' };
    const C = { id: 'mc', title: 'C', status: 'watchlist' };
    const mock = mockMatchSb({ sessions: [{ id: 'sB', status: 'open', created_at: new Date().toISOString(), deck: ['ma', 'mb', 'mc'] }], movies: [A, B, C] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [A, B, C]; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = mock.__sessions()[0];
      const ups = (movieId, person) => sb.from('swipes').upsert(
        [{ session_id: 'sB', movie_id: movieId, person, liked: true }],
        { onConflict: 'session_id,movie_id,person', ignoreDuplicates: true });
      const base = async () => {
        const st = await fetchLatestMatchState();
        return (st && st.swipes ? st.swipes : []).slice();
      };
      // match su A (percorso sequenziale classico) + riconoscimento
      await recordSwipe(session, 'ma', 'N', true);
      await recordSwipe(session, 'ma', 'V', true);
      await continueMatch(session);
      const afterContA = { ...mock.__sessions().find(x => x.id === 'sB') };
      // match su B con like QUASI-SIMULTANEI: i due reconcile (stale) vedono
      // ciascuno solo il proprio swipe → il resync NON recupera (solo "Continua")
      const baseSwipes = await base();
      await ups('mb', 'N');
      await reconcileSession(session, baseSwipes.concat([{ movie_id: 'mb', person: 'N', liked: true }]));
      await ups('mb', 'V');
      await reconcileSession(session, baseSwipes.concat([{ movie_id: 'mb', person: 'V', liked: true }]));
      await resyncMatchQuiet();
      const stB = await fetchLatestMatchState();
      const beforeCont = evaluateSession(stB.session, stB.swipes, movies);
      // Continua su UN client, poi l'altro client resincronizza
      await continueMatch(mock.__sessions()[0]);
      await resyncMatchQuiet();
      const s = mock.__sessions().find(x => x.id === 'sB');
      const v = evaluateSession(swipeSessions[0], swipes, movies);
      const partner = await fetchLatestMatchState();
      const pv = evaluateSession(partner.session, partner.swipes, movies);
      console.log('[reb(b)] dopo Continua-B: status=' + s.status + ' mmid=' + s.matched_movie_id
        + ' vista=' + v.view + '/' + v.movieId + ' partner=' + pv.view + '/' + pv.movieId);
      return afterContA.status === 'open' && afterContA.matched_movie_id === 'ma'
        && beforeCont.view === 'match' && beforeCont.movieId === 'mb'
        && s.status === 'open' && s.matched_movie_id === 'mb'
        && v.view === 'swipe' && v.movieId === 'mc'
        && pv.view === 'swipe' && pv.movieId === 'mc'
        && mock.__calls().updates.filter(u => u.patch.status === 'matched').length === 0;
    } finally { __matchRestore(p); }
  }));

  await okA('reb(c) Continua con update a vuoto (locale/DB disallineati) → console.error una volta + riallineamento', runA(async () => {
    const p = __matchSnap();
    const A = { id: 'ma', title: 'A', status: 'watchlist' };
    // DB: sessione GIÀ done (l'altro telefono ha riconosciuto e finito);
    // locale: ancora open con match su ma non riconosciuto → update 0 righe.
    const mock = mockMatchSb({
      sessions: [{ id: 'sC', status: 'done', created_at: new Date().toISOString(), deck: ['ma'], matched_movie_id: 'ma' }],
      swipes: [
        { session_id: 'sC', movie_id: 'ma', person: 'N', liked: true },
        { session_id: 'sC', movie_id: 'ma', person: 'V', liked: true }
      ]
    });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [A]; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.map(x => String(x)).join(' ')); };
    try {
      const local = { id: 'sC', status: 'open', created_at: new Date().toISOString(), deck: ['ma'], matched_movie_id: null };
      swipeSessions = [local];
      swipes = [
        { movie_id: 'ma', person: 'N', liked: true },
        { movie_id: 'ma', person: 'V', liked: true }
      ];
      await continueMatch(local);
      const s = mock.__sessions().find(x => x.id === 'sC');
      const v = evaluateSession(swipeSessions[0], swipes, movies);
      console.log('[reb(c)] errori=' + errs.length + ' status=' + s.status + ' mmid=' + (s.matched_movie_id || '∅') + ' vista=' + v.view);
      return errs.length === 1                                  // console.error UNA volta
        && s.status === 'done' && s.matched_movie_id === 'ma'   // DB intatto
        && swipeSessions[0].status === 'done' && swipeSessions[0].matched_movie_id === 'ma' // riallineato
        && v.view === 'done';                                    // vista coerente (non muta/stallo)
    } finally { console.error = origErr; __matchRestore(p); }
  }));

  await okA('reb(d) uscita+rientro con match non riconosciuto: la celebrazione riappare (derivata dai dati)', runA(async () => {
    const p = __matchSnap();
    const A = { id: 'ma', title: 'A', status: 'watchlist' };
    const mock = mockMatchSb({
      sessions: [{ id: 'sD', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }],
      swipes: [
        { id: 'w1', session_id: 'sD', movie_id: 'ma', person: 'N', liked: true },
        { id: 'w2', session_id: 'sD', movie_id: 'ma', person: 'V', liked: true }
      ]
    });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [A]; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      // "uscita": stato locale azzerato (la sessione resta open NON riconosciuta nel DB)
      swipeSessions = []; swipes = []; matchChannel = null;
      // "rientro": ensureActiveSession riprende l'attiva e applica lo stato fetchato
      const resumed = await ensureActiveSession();
      const v = evaluateSession(swipeSessions[0], swipes, movies);
      console.log('[reb(d)] ripresa sessione=' + (resumed && resumed.id) + ' vista=' + v.view + '/' + v.movieId);
      return resumed && resumed.id === 'sD'
        && v.view === 'match' && v.movieId === 'ma'
        && mock.__calls().updates.length === 0; // il rientro NON scrive nulla
    } finally { __matchRestore(p); }
  }));

  await okA('reb(e) reconcile in ritardo dopo "Continua": non riscrive niente (match né done)', runA(async () => {
    const p = __matchSnap();
    const A = { id: 'ma', title: 'A', status: 'watchlist' };
    const B = { id: 'mb', title: 'B', status: 'watchlist' };
    const mock = mockMatchSb({ sessions: [{ id: 'sE', status: 'open', created_at: new Date().toISOString(), deck: ['ma', 'mb'] }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [A, B]; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = mock.__sessions()[0];
      await recordSwipe(session, 'ma', 'N', true);
      await recordSwipe(session, 'ma', 'V', true);
      await continueMatch(session);                  // riconoscimento → mmid='ma', open
      const before = mock.__calls().updates.length;  // 1 (il riconoscimento)
      // reconcile in ritardo: snapshot stantio (solo il like di N) e snapshot pieno
      await reconcileSession(session, [{ movie_id: 'ma', person: 'N', liked: true }]);
      await reconcileSession(session, [
        { movie_id: 'ma', person: 'N', liked: true },
        { movie_id: 'ma', person: 'V', liked: true }
      ]);
      const s = mock.__sessions().find(x => x.id === 'sE');
      return before === 1 && mock.__calls().updates.length === 1
        && s.status === 'open' && s.matched_movie_id === 'ma';
    } finally { __matchRestore(p); }
  }));

  await okA('reb(f) mazzo esaurito con swipe quasi-simultanei: view done su entrambi, "done" scritto dal RESYNC', runA(async () => {
    const p = __matchSnap();
    const A = { id: 'ma', title: 'A', status: 'watchlist' };
    const mock = mockMatchSb({ sessions: [{ id: 'sF', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [A]; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = mock.__sessions()[0];
      const ups = (person, liked) => sb.from('swipes').upsert(
        [{ session_id: 'sF', movie_id: 'ma', person, liked }],
        { onConflict: 'session_id,movie_id,person', ignoreDuplicates: true });
      // Nessun match (N e V rifiutano). I reconcile quasi-simultanei (stale)
      // non vedono il mazzo esaurito → niente 'done' finché non arriva il resync.
      await ups('N', false);
      await reconcileSession(session, [{ movie_id: 'ma', person: 'N', liked: false }]);
      await ups('V', false);
      await reconcileSession(session, [{ movie_id: 'ma', person: 'V', liked: false }]);
      const beforeResync = mock.__calls().updates.length;
      // il resync porta l'ULTIMO swipe dell'altro → open→done scritto QUI
      await resyncMatchQuiet();
      const s = mock.__sessions().find(x => x.id === 'sF');
      const v = evaluateSession(swipeSessions[0], swipes, movies);
      const lastUp = mock.__calls().updates[mock.__calls().updates.length - 1];
      console.log('[reb(f)] prima-resync updates=' + beforeResync + ' dopo: status=' + s.status
        + ' vista=' + v.view + ' (' + (lastUp && lastUp.patch.status) + ')');
      return beforeResync === 0
        && lastUp && lastUp.patch.status === 'done'
        && s.status === 'done'
        && v.view === 'done' && v.movieId === null;
    } finally { __matchRestore(p); }
  }));

  await okA('enterMatch: dbMode local → matchAvailable false, nessun canale', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({});
    sb = mock; dbMode = 'local'; currentUser = 'N'; matchProbeDone = true; matchAvailable = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      await enterMatch();
      return matchAvailable === false && mock.__calls().channels.length === 0 && matchChannel === null;
    } finally { __matchRestore(p); }
  }));

  await okA('enterMatch: sonda con TIMEOUT (3s) → matchAvailable false, niente canale', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ slowProbe: true });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchProbeDone = false; matchAvailable = true;
    matchProbeTimeoutMs = 40; swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const t0 = Date.now();
      await enterMatch();
      const elapsed = Date.now() - t0;
      return matchAvailable === false && matchProbeDone === true
        && mock.__calls().channels.length === 0
        && elapsed >= 30 && elapsed < 2000;
    } finally { __matchRestore(p); }
  }));

  ok('canale core: nessun binding match (solo movies/votes/vetoes/movie_nights)', run(() => {
    const mock = mockMatchSb({});
    const prevSb = sb, prevRtc = realtimeChannel;
    sb = mock; realtimeChannel = null;
    try {
      subscribeRealtime();
      const core = mock.__calls().channels.find(c => c.ch.name === 'scorochiatu-db-changes');
      if (!core) return false;
      const evs = core.ch.bindings.map(b => b.ev);
      const tables = core.ch.bindings
        .filter(b => b.ev === 'postgres_changes')
        .map(b => b.filter.table);
      const okTables = tables.every(t => ['movies', 'votes', 'vetoes', 'movie_nights'].includes(t));
      return evs.indexOf('presence') === -1
        && tables.indexOf('swipe_sessions') === -1 && tables.indexOf('swipes') === -1
        && okTables;
    } finally { sb = prevSb; realtimeChannel = prevRtc; }
  }));

  await okA('canale match: binding PRIMA di subscribe; CHANNEL_ERROR → matchAvailable false e core INTATTO', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({});
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false; realtimeChannel = null;
    try {
      subscribeRealtime(); // core attivo
      const coreName = realtimeChannel && realtimeChannel.name;
      openMatchChannel();
      const m = mock.__calls();
      const entry = m.channels.find(c => !c.ch.name.startsWith('scorochiatu-db-changes'));
      if (!entry) return false;
      const bindingsBefore = entry.bindingsAtSubscribe;
      const topic = entry.ch.name;
      const matchTables = entry.ch.bindings.filter(b => b.ev === 'postgres_changes').map(b => b.filter.table).join();
      const presenceBindings = entry.ch.bindings.filter(b => b.ev === 'presence').length;
      entry.ch.fire('CHANNEL_ERROR', Error('boom'));
      await new Promise(r => setTimeout(r, 20));
      const removedMatch = m.removed.indexOf(topic) !== -1;
      const matchGone = mock.getChannels().filter(c => c.name === 'scorochiatu-match').length === 0;
      const coreKept = mock.getChannels().filter(c => c.name === coreName).length === 1;
      return topic === 'scorochiatu-match'
        && bindingsBefore === 5
        && matchTables === 'swipe_sessions,swipes'
        && presenceBindings === 3
        && entry.ch.bindings.some(b => b.ev === 'presence')
        && matchAvailable === false && matchChannel === null
        && removedMatch && matchGone && coreKept
        && realtimeChannel !== null && realtimeChannel.name === coreName;
    } finally { __matchRestore(p); }
  }));

  await okA('logout: rimozione canale VERIFICATA (getChannels vuoto); rientro → canale NUOVO stesso topic, binding prima di subscribe', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({});
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      openMatchChannel();
      const m = mock.__calls();
      const first = m.channels[0];
      const firstBindings = first.ch.bindings.length;
      logout(); // → unsubscribeRealtime (noop) + leaveMatch(true): rimozione COMPLETA
      const removedAfterLogout = m.removed.indexOf('scorochiatu-match') !== -1
        && matchChannel === null && currentUser === null && mock.getChannels().length === 0;
      currentUser = 'N';
      await enterMatch(); // rientro: la sonda è già passata (matchProbeDone=true)
      const second = m.channels[1];
      return firstBindings === 5
        && removedAfterLogout && first.ch.removed === true
        && second && second.ch.name === 'scorochiatu-match'         // topic COSTANTE, non -1/-2
        && second.ch.name === first.ch.name
        && second.ch !== first.ch
        && second.bindingsAtSubscribe === 5;
    } finally { __matchRestore(p); }
  }));

  await okA('track solo dopo SUBSCRIBED; dopo SUBSCRIBED refetch dell\'ultima sessione', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 's-before', status: 'open', created_at: new Date(Date.now() - 1000).toISOString(), deck: [] }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = [{ id: 's-before', status: 'open', created_at: new Date(Date.now() - 1000).toISOString(), deck: [] }];
    swipes = []; matchChannel = null; matchLeaving = false;
    try {
      openMatchChannel();
      const m = mock.__calls();
      const entry = m.channels[0];
      const noTrackYet = m.tracks === 0;
      // tra la lettura iniziale e l'aggancio arriva una sessione nuova
      mock.__sessions().push({ id: 's-after', status: 'open', created_at: new Date().toISOString(), deck: [] });
      entry.ch.fire('SUBSCRIBED');
      await new Promise(r => setTimeout(r, 20));
      return noTrackYet
        && m.tracks === 1 && m.trackPayloads[0].user === 'N'
        && swipeSessions[0].id === 's-after';
    } finally { __matchRestore(p); }
  }));

  await okA('onMatchChange: debounce proprio 120ms → un solo resync per burst', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 's-d', status: 'open', created_at: new Date().toISOString(), deck: [] }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false; matchResyncTimer = null;
    currentTab = 'match'; // il canale è persistente: fuori dal tab il resync NON parte
    try {
      for (let i = 0; i < 5; i++) onMatchChange();
      await new Promise(r => setTimeout(r, 250));
      // un resync = GET sessioni + GET swipe = 2 letture, non 5
      const gets = mock.__calls().gets.length;
      currentTab = 'watchlist';
      onMatchChange();
      await new Promise(r => setTimeout(r, 150));
      // fuori dal tab: nessuna lettura aggiuntiva (il rientro rifarà il refetch)
      const getsAfter = mock.__calls().gets.length;
      return gets === 2 && getsAfter === 2;
    } finally { __matchRestore(p); }
  }));

  ok('presenceUsers: chiavi uniche per persona (una key per utente)', run(() => {
    const a = presenceUsers({ N: [{ user: 'N' }], V: [{ user: 'V' }] });
    const b = presenceUsers(null);
    const c = presenceUsers({});
    return a.join() === 'N,V' && b.length === 0 && c.length === 0;
  }));

  // --- 8b2) REGRESSIONE topic/presence (commit fix: topic COSTANTE 'scorochiatu-match') ---
  // Il mock PRECEDENTE non simulava la separazione per-topic: presenceState()
  // era statico {N,V} per qualunque canale, quindi un canale NUOVO col suffisso
  // '-<seq>' risultava comunque "compatibile". Qui l'hub condiviso (per-topic,
  // condiviso tra "client" == websocket reale) riproduce il bug: topic diversi
  // = regioni diverse = i client non si vedono. Il topic DOPO il fix è identico.
  console.log('\n[match — topic costante + presence per-topic (regressione)]');

  await okA('topic COSTANTE: identico dopo 3 cicli entrata/uscita e tra due client (hub condiviso)', runA(async () => {
    const p = __matchSnap();
    const hub = { presence: {} };
    const mock = mockMatchSb({ hub, sessions: [], movies: [] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false; matchChannelStatus = null;
    const vMock = mockMatchSb({ hub, sessions: [], movies: [] });
    const vCh = vMock.channel('scorochiatu-match', { config: { presence: { key: 'V' } } });
    try {
      openMatchChannel();                    // entrata 1 (creazione)
      const ch1 = matchChannel;
      ch1.fire('SUBSCRIBED');
      await new Promise(r => setTimeout(r, 10));
      leaveMatch();                          // uscita: untrack, il canale RESTA
      openMatchChannel();                    // rientro 1 (track + refetch)
      openMatchChannel();                    // rientro 2
      openMatchChannel();                    // rientro 3
      await new Promise(r => setTimeout(r, 10));
      const m = mock.__calls();
      return m.channels.length === 1         // MAI ricreato (unico per topic)
        && m.channels[0].ch.name === 'scorochiatu-match'           // nessun suffisso
        && matchChannel === ch1              // stessa istanza PERSISTENTE
        && vCh.name === 'scorochiatu-match'  // topic identico tra N e V
        && m.tracks === 3;                   // 1 untrack (uscita) + 1 track per ciascuno dei 3 rientri
    } finally { __matchRestore(p); }
  }));

  ok('due client STESSO topic → presente entrambi; topic DIVERSI (suffisso) → non si vedono', run(() => {
    const p = __matchSnap();
    const hub = { presence: {} };
    const mock = mockMatchSb({ hub, sessions: [], movies: [] });
    const vMock = mockMatchSb({ hub, sessions: [], movies: [] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false; matchChannelStatus = null;
    try {
      openMatchChannel();
      const nCh = matchChannel;
      nCh.fire('SUBSCRIBED');
      // V sullo STESSO topic 'scorochiatu-match' (mock separato, hub condiviso)
      const vch = vMock.channel('scorochiatu-match', { config: { presence: { key: 'V' } } }).subscribe(() => {});
      vch.track({ user: 'V' });
      nCh.firePresence('sync');
      const sameTopic = lobbyPresenceState.slice().sort().join() === 'N,V';
      // V lascia il topic ufficiale e si sposta su un topic DIVERSO (= suffisso)
      vch.untrack();
      vMock.channel('scorochiatu-match-alt', { config: { presence: { key: 'V' } } })
        .subscribe(() => {}).track({ user: 'V' });
      nCh.firePresence('leave');
      const differentTopic = lobbyPresenceState.join() === 'N';
      return sameTopic && differentTopic;
    } finally { __matchRestore(p); }
  }));

  ok('solo N online: lobby con un solo chip e vista LOBBY_SOLO "In attesa di V"', run(() => {
    const p = __matchSnap();
    const hub = { presence: {} };
    const mock = mockMatchSb({ hub, sessions: [], movies: [] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false; matchChannelStatus = null;
    try {
      openMatchChannel();
      const nCh = matchChannel;
      nCh.fire('SUBSCRIBED');
      const solo = lobbyPresenceState.join() === 'N';
      __matchUI({ presence: ['N'], sessions: [{ id: 'sS', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], movies: [{ id: 'ma', title: 'M' }] });
      const html = matchViewHtml();
      return solo && html.indexOf('Chi c\'è?') !== -1 && /In attesa di V/.test(html);
    } finally { __matchRestore(p); }
  }));

  ok('uscita e rientro: canale UNICO (nessuna ricreazione) e track esattamente una volta per rientro', run(() => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [], movies: [] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false; matchChannelStatus = null;
    try {
      openMatchChannel();
      const ch1 = matchChannel;
      ch1.fire('SUBSCRIBED');
      const tracksBefore = mock.__calls().tracks;           // 1
      leaveMatch();                                          // untrack → 0
      const tracksAfterLeave = mock.__calls().tracks;        // 0
      openMatchChannel();
      const tracksAfterReentry = mock.__calls().tracks;      // 1 (un solo track)
      return matchChannel === ch1
        && mock.__calls().channels.length === 1
        && mock.__calls().removed.length === 0               // mai rimossi (persistente)
        && tracksBefore === 1 && tracksAfterLeave === 0 && tracksAfterReentry === 1;
    } finally { __matchRestore(p); }
  }));

  // --- 8c) match — UI (lobby, swipe, match, done, serata dal match) ---
  console.log('\n[match — UI tab]');

  ok('vista non disponibile: "Match non disponibile" + Riprova (azzera sonda)', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({});
      matchAvailable = false; matchChannel = null; matchChannelStatus = null;
      const html = matchViewHtml();
      const beforeProbe = matchProbeDone;
      tryMatchAgain();
      return html.indexOf('Match non disponibile') !== -1
        && html.indexOf('Riprova') !== -1
        && matchProbeDone === false && matchAvailable === false
        && beforeProbe === true;
    } finally { __matchRestore(p); }
  }));

  ok('vista connessione: status non subscribed → "Connessione…"', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({});
      matchChannelStatus = 'connecting';
      return matchViewHtml().indexOf('Connessione…') !== -1;
    } finally { __matchRestore(p); }
  }));

  ok('lobby SOLO: chip presenza + "In attesa di V" + Nuova sessione', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({ presence: ['N'], sessions: [{ id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], movies: [{ id: 'ma', title: 'M' }] });
      const html = matchViewHtml();
      return html.indexOf('Chi c\'è?') !== -1
        && /In attesa di V/.test(html)
        && html.indexOf('Nuova sessione') !== -1;
    } finally { __matchRestore(p); }
  }));

  ok('lobby con presenza DOPPIO TAB deduplicata → LOBBY_DUE → swipe auto-start', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({ presence: ['N', 'N', 'V'], sessions: [{ id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], movies: [{ id: 'ma', title: 'Geometria del terrore' }] });
      const present = matchPresentUsers();
      const html = matchViewHtml();
      return present.join() === 'N,V' && html.indexOf('Nope') !== -1 && html.indexOf('Like') !== -1;
    } finally { __matchRestore(p); }
  }));

  ok('card corrente: titolo/anno•durata senza null/undefined; film cancellato = card risolto (DONE)', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], movies: [{ id: 'ma', title: 'Le Iene', release_year: 1992, duration: '100 min', poster: null, genres: ['Thriller', 'Crime'] }] });
      const html = matchViewHtml();
      const noNull = html.indexOf('null') === -1 && html.indexOf('undefined') === -1;
      const withMeta = html.indexOf('Le Iene') !== -1 && html.indexOf('1992') !== -1 && html.indexOf('100 min') !== -1;
      // film cancellato (unico del deck) = card risolto → vista DONE, senza null/undefined
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ghost'] }], movies: [] });
      const removedHtml = matchViewHtml();
      const removed = removedHtml.indexOf('Mazzo finito!') !== -1
        && removedHtml.indexOf('null') === -1 && removedHtml.indexOf('undefined') === -1;
      return noNull && withMeta && removed;
    } finally { __matchRestore(p); }
  }));

  ok('"Nuova sessione": presente in lobby/MATCH/DONE, ASSENTE in SWIPE', run(() => {
    const p = __matchSnap();
    try {
      // lobby (nessuna sessione)
      __matchUI({ presence: ['N'] });
      const inLobby = matchViewHtml().indexOf('Nuova sessione') !== -1;
      // MATCH (doppio like non ancora celebrato)
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sM', status: 'matched', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: null }], swipes: [{ movie_id: 'ma', person: 'N', liked: true }, { movie_id: 'ma', person: 'V', liked: true }], movies: [{ id: 'ma', title: 'M' }, { id: 'mb', title: 'B' }] });
      const matchHtml = matchViewHtml();
      const inMatch = matchHtml.indexOf('Match!') !== -1 && matchHtml.indexOf('Nuova sessione') !== -1;
      // DONE (mazzo esaurito, match già celebrato)
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sD', status: 'open', created_at: new Date().toISOString(), deck: ['ma'], matched_movie_id: 'ma' }], swipes: [{ movie_id: 'ma', person: 'N', liked: true }, { movie_id: 'ma', person: 'V', liked: true }], movies: [{ id: 'ma', title: 'M' }] });
      const doneHtml = matchViewHtml();
      const inDone = doneHtml.indexOf('Mazzo finito!') !== -1 && doneHtml.indexOf('Nuova sessione') !== -1;
      // SWIPE (entrambi presenti, card corrente)
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sS', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], swipes: [], movies: [{ id: 'ma', title: 'M' }] });
      const swipeHtml = matchViewHtml();
      const absentInSwipe = swipeHtml.indexOf('Nuova sessione') === -1 && swipeHtml.indexOf('Nope') !== -1;
      return inLobby && inMatch && inDone && absentInSwipe;
    } finally { __matchRestore(p); }
  }));

  ok('match %: presente nelle 3 viste — swipe (…% in attesa), match (…% finora), done (X% in comune)', run(() => {
    const p = __matchSnap();
    try {
      // SWIPE: nessun card risolto da entrambi → "…% · in attesa" (mai 0%)
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sP', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], swipes: [], movies: [{ id: 'ma', title: 'M' }] });
      const swipe = matchViewHtml();
      const swipeOk = swipe.indexOf("…% d'accordo") !== -1 && swipe.indexOf('% d\'accordo in questa sessione') === -1;
      // SWIPE: 1 card risolto in accordo → "100%" ma con nota "poche risposte" (soglia 3)
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sP', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], swipes: [{ movie_id: 'ma', person: 'N', liked: true }, { movie_id: 'ma', person: 'V', liked: true }], movies: [{ id: 'ma', title: 'M' }] });
      const swipePct = matchViewHtml();
      const swipePctOk = swipePct.indexOf('100% d\'accordo') !== -1
        && swipePct.indexOf('poche risposte per un dato attendibile') !== -1;
      // MATCH: doppio like → celebrazione con "…% finora" o % piena
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sP', status: 'matched', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: null }], swipes: [{ movie_id: 'ma', person: 'N', liked: true }, { movie_id: 'ma', person: 'V', liked: true }, { movie_id: 'mb', person: 'N', liked: true }, { movie_id: 'mb', person: 'V', liked: false }], movies: [{ id: 'ma', title: 'M' }, { id: 'mb', title: 'B' }] });
      const match = matchViewHtml();
      const matchOk = match.indexOf('Match!') !== -1 && match.indexOf('50% d\'accordo finora') !== -1;
      // DONE: mazzo esaurito, "X% di gusti in comune"
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sP', status: 'open', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: 'ma' }], swipes: [{ movie_id: 'ma', person: 'N', liked: true }, { movie_id: 'ma', person: 'V', liked: true }, { movie_id: 'mb', person: 'N', liked: false }, { movie_id: 'mb', person: 'V', liked: false }], movies: [{ id: 'ma', title: 'M' }, { id: 'mb', title: 'B' }] });
      const done = matchViewHtml();
      const doneOk = done.indexOf('Mazzo finito!') !== -1 && done.indexOf('100% di gusti in comune') !== -1;
      return swipeOk && swipePctOk && matchOk && doneOk;
    } finally { __matchRestore(p); }
  }));

  await okA('swipe bloccato se ho già risposto: "In attesa di V", niente bottoni, recordSwipe non parte', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const mock = mockMatchSb({ sessions: [S], swipes: [] });
    sb = mock; dbMode = 'supabase';
    __matchUI({ presence: ['N', 'V'], sessions: [S], swipes: [{ movie_id: 'ma', person: 'N', liked: true }], movies: [{ id: 'ma', title: 'M' }] });
    try {
      const html = matchViewHtml();
      const blocked = html.indexOf('In attesa di V') !== -1
        && html.indexOf('fa-xmark') === -1 && html.indexOf('Nope') === -1;
      await swipeCard('ma', false);
      await new Promise(r => setTimeout(r, 20));
      return blocked && mock.__root().swipes.length === 0 && mock.__calls().upserts.length === 0;
    } finally { __matchRestore(p); }
  }));

  ok('MATCH: si celebra SOLO con pendingMatch non-null (no ricelebrazione)', run(() => {
    const p = __matchSnap();
    try {
      // (a) pendingMatch null (matched_movie_id === doppio like) → nessuna celebrazione
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sM', status: 'matched', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: 'ma' }], swipes: [{ movie_id: 'ma', person: 'N', liked: true }, { movie_id: 'ma', person: 'V', liked: true }], movies: [{ id: 'ma', title: 'M' }, { id: 'mb', title: 'B' }] });
      const noCelebration = matchViewHtml().indexOf('Match!') === -1;
      // (b) pendingMatch non-null (doppio like su card ≠ matched_movie_id) → celebra
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sM2', status: 'matched', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: 'ma' }], swipes: [{ movie_id: 'mb', person: 'N', liked: true }, { movie_id: 'mb', person: 'V', liked: true }], movies: [{ id: 'ma', title: 'M' }, { id: 'mb', title: 'B' }] });
      const html = matchViewHtml();
      const celebrates = html.indexOf('Match!') !== -1
        && html.indexOf('Stasera') !== -1 && html.indexOf('Programma') !== -1
        && html.indexOf('Continua') !== -1 && html.indexOf('Esci') !== -1;
      return noCelebration && celebrates;
    } finally { __matchRestore(p); }
  }));

  await okA('DONE: riepilogo "1 match" + Nuova sessione/Esci', runA(async () => {
    const p = __matchSnap();
    try {
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sD', status: 'open', created_at: new Date().toISOString(), deck: ['ma'], matched_movie_id: 'ma' }], swipes: [{ movie_id: 'ma', person: 'N', liked: true }, { movie_id: 'ma', person: 'V', liked: true }], movies: [{ id: 'ma', title: 'M' }] });
      const html = matchViewHtml();
      return html.indexOf('match in questa sessione') !== -1
        && html.indexOf('Mazzo finito!') !== -1
        && html.indexOf('Nuova sessione') !== -1 && html.indexOf('Esci') !== -1;
    } finally { __matchRestore(p); }
  }));

  await okA('gesto touch (soglia ~80px) e bottoni convergono su swipeCard; sotto soglia nessuno swipe', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const mock = mockMatchSb({ sessions: [S], movies: [{ id: 'ma', title: 'M' }] });
    sb = mock; dbMode = 'supabase';
    __matchUI({ presence: ['N', 'V'], sessions: [S], movies: [{ id: 'ma', title: 'M' }] });
    try {
      renderMatch();
      const card = document.getElementById('matchCard');
      if (!card || !card._handlers.touchstart) return false;
      const last = a => a[a.length - 1];
      const fire = (ev, e) => { const arr = card._handlers[ev]; if (!arr || !arr.length) return; last(arr)(e); };
      fire('touchstart', { touches: [{ clientX: 10 }] });
      fire('touchmove', { cancelable: true, preventDefault() {}, touches: [{ clientX: 130 }] });
      fire('touchend', {});
      await new Promise(r => setTimeout(r, 20));
      const afterSwipe = mock.__root().swipes.length === 1
        && mock.__root().swipes[0].person === 'N' && mock.__root().swipes[0].liked === true;
      renderMatch();
      fire('touchstart', { touches: [{ clientX: 10 }] });
      fire('touchmove', { cancelable: true, preventDefault() {}, touches: [{ clientX: 40 }] });
      fire('touchend', {});
      await new Promise(r => setTimeout(r, 20));
      return afterSwipe && mock.__root().swipes.length === 1;
    } finally { __matchRestore(p); }
  }));

  ok('anti-XSS: titolo/genere non iniettano markup (swipe e match), dati sempre escappati', run(() => {
    const p = __matchSnap();
    const evil = '<img src=x onerror=alert(1)>';
    try {
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], movies: [{ id: 'ma', title: evil, release_year: 1992, duration: '90 min', genres: ['<script>O\'Brien</script>'] }] });
      const swipeHtml = matchViewHtml();
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sM', status: 'matched', created_at: new Date().toISOString(), deck: ['mb', 'ma'], matched_movie_id: null }], swipes: [{ movie_id: 'ma', person: 'N', liked: true }, { movie_id: 'ma', person: 'V', liked: true }], movies: [{ id: 'ma', title: evil }] });
      const matchHtml = matchViewHtml();
      const clean = h => h.indexOf('<img src=x') === -1 && h.indexOf('O\'Brien') === -1 && h.indexOf('&lt;img') !== -1;
      return clean(swipeHtml) && clean(matchHtml);
    } finally { __matchRestore(p); }
  }));

  await okA('serata dal match: Stasera → confirmed + sessione chiusa SOLO dopo creazione reale', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const mock = mockMatchSb({ sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    sb = mock; dbMode = 'supabase';
    movieNights = [];   // hermetic: la verifica passa da activeNightForMovie
    __matchUI({ presence: ['N', 'V'], sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    try {
      await createMatchNight('ma', 'tonight');
      const root = mock.__root();
      const night = root.movie_nights.find(n => n.movie_id === 'ma');
      const sessionAfter = root.swipe_sessions[0];
      const okNight = night && night.status === 'confirmed' && night.date === null && night.proposed_by === 'N';
      const okClose = sessionAfter && sessionAfter.status === 'closed';
      const okView = document.getElementById('movieGrid').innerHTML.indexOf('Serata creata ✓') !== -1;
      if (matchExitTimer) { clearTimeout(matchExitTimer); matchExitTimer = null; }
      return okNight && okClose && okView && matchNightCreated && matchNightCreated.movieId === 'ma'
        && activeNightForMovie('ma') && activeNightForMovie('ma').status === 'confirmed';
    } finally { __matchRestore(p); }
  }));

  await okA('Stasera: serata NON creata (insert fallito) → sessione aperta, niente "Serata creata"', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const mock = mockMatchSb({ failInsert: '500', sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    sb = mock; dbMode = 'supabase';
    movieNights = [];
    __matchUI({ presence: ['N', 'V'], sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    document.getElementById('movieGrid').innerHTML = '';   // hermetic: verifica assenza celebrazione
    try {
      await createMatchNight('ma', 'tonight');
      const root = mock.__root();
      return activeNightForMovie('ma') === null
        && root.swipe_sessions[0].status === 'open'
        && matchNightCreated === null
        && root.movie_nights.length === 0
        && document.getElementById('movieGrid').innerHTML.indexOf('Serata creata ✓') === -1;
    } finally { __matchRestore(p); }
  }));

  await okA('Programma: annullo/chiudi modale azzera il pending; conferma dalla lista NON chiude la sessione Match', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const mock = mockMatchSb({ sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    sb = mock; dbMode = 'supabase';
    movieNights = [];
    __matchUI({ presence: ['N', 'V'], sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    const dateEl = document.getElementById('scheduleDate');
    const movieIdEl = document.getElementById('scheduleMovieId');
    const timeEl = document.getElementById('scheduleTime');
    const snackEl = document.getElementById('scheduleSnack');
    document.getElementById('movieGrid').innerHTML = '';    // hermetic: verifica assenza celebrazione
    try {
      await createMatchNight('ma', 'schedule');
      const atModalOpen = mock.__root().swipe_sessions[0].status === 'open'
        && matchPendingSchedule && matchPendingSchedule.sessionId === 'sU' && matchPendingSchedule.movieId === 'ma'
        && matchNightCreated === null;
      closeModal('scheduleModal');      // annullo: nessuna conferma
      const afterCancel = mock.__root().swipe_sessions[0].status === 'open'
        && matchPendingSchedule === null && matchNightCreated === null;
      // data vuota → confirmSchedule esce prima (modale ancora aperta, ancora inerte)
      movieIdEl.value = 'ma'; dateEl.value = ''; timeEl.value = '21:30'; snackEl.value = '';
      await confirmSchedule();
      const afterEmpty = mock.__root().swipe_sessions[0].status === 'open'
        && mock.__root().movie_nights.length === 0 && matchPendingSchedule === null;
      // stesso film programmato dalla LISTA normale: il pending è stato azzerato
      // dall'annullo → la sessione Match NON si chiude e non mostra "Serata creata"
      dateEl.value = '2026-12-24';
      await confirmSchedule();
      const root = mock.__root();
      const night = root.movie_nights.find(n => n.movie_id === 'ma');
      return atModalOpen && afterCancel && afterEmpty
        && root.swipe_sessions[0].status === 'open'
        && night && night.status === 'proposed' && night.date === '2026-12-24'
        && matchPendingSchedule === null && matchNightCreated === null
        && document.getElementById('movieGrid').innerHTML.indexOf('Serata creata ✓') === -1;
    } finally { __matchRestore(p); }
  }));

  await okA('Programma: conferma DIRETTA dal Match → sessione chiusa SOLO a serata creata (a posteriori)', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const mock = mockMatchSb({ sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    sb = mock; dbMode = 'supabase';
    movieNights = [];
    __matchUI({ presence: ['N', 'V'], sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    const dateEl = document.getElementById('scheduleDate');
    const movieIdEl = document.getElementById('scheduleMovieId');
    try {
      await createMatchNight('ma', 'schedule');
      const sessionId = matchPendingSchedule && matchPendingSchedule.sessionId;
      movieIdEl.value = 'ma'; dateEl.value = '2026-12-24';
      await confirmSchedule();
      const root = mock.__root();
      const night = root.movie_nights.find(n => n.movie_id === 'ma');
      const ok = sessionId === 'sU'
        && root.swipe_sessions[0].status === 'closed'
        && night && night.status === 'proposed' && night.date === '2026-12-24'
        && matchPendingSchedule === null && matchNightCreated && matchNightCreated.movieId === 'ma'
        && document.getElementById('movieGrid').innerHTML.indexOf('Serata creata ✓') !== -1;
      if (matchExitTimer) { clearTimeout(matchExitTimer); matchExitTimer = null; }
      return ok;
    } finally { __matchRestore(p); }
  }));

  await okA('confirmSchedule: hook scatta SOLO se currentTab === match (pending da fuori Match non chiude)', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const mock = mockMatchSb({ sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    sb = mock; dbMode = 'supabase';
    movieNights = [];
    __matchUI({ presence: ['N', 'V'], sessions: [S], movies: [{ id: 'ma', title: 'Match A' }] });
    currentTab = 'watchlist';   // fuori dal tab Match
    const dateEl = document.getElementById('scheduleDate');
    const movieIdEl = document.getElementById('scheduleMovieId');
    document.getElementById('movieGrid').innerHTML = '';    // hermetic: verifica assenza celebrazione
    try {
      matchPendingSchedule = { sessionId: 'sU', movieId: 'ma' }; // pending "scaduto"/stale
      movieIdEl.value = 'ma'; dateEl.value = '2026-12-24';
      await confirmSchedule();
      const root = mock.__root();
      return root.swipe_sessions[0].status === 'open'          // sessione Match NON chiusa
        && root.movie_nights.length === 1                       // ma la serata dalla lista SÌ è creata
        && matchNightCreated === null && matchPendingSchedule === null
        && document.getElementById('movieGrid').innerHTML.indexOf('Serata creata ✓') === -1;
    } finally { __matchRestore(p); }
  }));

  ok('uscita dal tab Match: clearMatchState azzera matchPendingSchedule', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], movies: [{ id: 'ma', title: 'M' }] });
      matchPendingSchedule = { sessionId: 'sU', movieId: 'ma' };
      matchChannel = { untrack() { return Promise.resolve('ok'); } };
      matchChannelStatus = 'subscribed'; matchLeaving = false;
      setTab('watchlist');
      return matchPendingSchedule === null && matchNightCreated === null
        && currentTab === 'watchlist';
    } finally { __matchRestore(p); }
  }));

  ok('filtri: blocco lista visibile in lista/calendario, nascosto (più !hidden) solo nel tab Match', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({});
      dbMode = 'supabase';
      currentTab = 'watchlist'; render();
      const blk = document.getElementById('listFiltersBlock');
      const visibleLista = blk && !blk.classList.contains('!hidden');
      currentTab = 'calendar'; render();
      const visibleCalendario = blk && !blk.classList.contains('!hidden');
      currentTab = 'match'; render();
      const hiddenMatch = blk && blk.classList.contains('!hidden');
      return visibleLista && visibleCalendario && hiddenMatch;
    } finally { __matchRestore(p); }
  }));

  await okA('setTab(match): entra e render; uscita verso altro tab RIMUOVE SOLO la presence (canale persistente resta); rientro = track + same topic', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const hub = { presence: {} };
    const mock = mockMatchSb({ sessions: [S], movies: [{ id: 'ma', title: 'M' }], hub });
    sb = mock; dbMode = 'supabase';
    __matchUI({});
    currentTab = 'watchlist'; matchPrevTab = 'watchlist';
    swipeSessions = [S]; swipes = []; movies = [{ id: 'ma', title: 'M' }];
    matchChannel = null; matchChannelStatus = null; matchLeaving = false;
    realtimeChannel = null;
    try {
      setTab('match');
      await new Promise(r => setTimeout(r, 30));
      const ch1 = matchChannel;
      const entered = currentTab === 'match' && matchPrevTab === 'watchlist'
        && ch1 && ch1.name === 'scorochiatu-match' && matchChannelStatus === 'connecting'
        && document.getElementById('movieGrid').innerHTML.indexOf('Connessione…') !== -1;
      // subscribed → presence (N) + V che entra sullo STESSO topic (hub) → LOBBY_DUE
      ch1.fire('SUBSCRIBED');
      await new Promise(r => setTimeout(r, 30));
      const vMock = mockMatchSb({ hub, sessions: [], movies: [] });
      await vMock.channel('scorochiatu-match', { config: { presence: { key: 'V' } } })
        .subscribe(() => {}).track({ user: 'V' });
      ch1.firePresence('sync');   // l'evento presence arriva a N dallo stesso topic
      await new Promise(r => setTimeout(r, 10));
      const swipeView = document.getElementById('movieGrid').innerHTML.indexOf('Nope') !== -1;
      const lobbyDue = lobbyPresenceState.join() === 'N,V';
      // uscita: UNTRACK SOLO — il canale resta aperto e SUBSCRIBED (stesso istanza)
      setTab('calendar');
      const left = currentTab === 'calendar'
        && matchChannel === ch1 && matchChannelStatus === 'subscribed'
        && mock.__calls().removed.indexOf('scorochiatu-match') === -1
        && lobbyPresenceState.length === 0;
      // rientro: nessun canale nuovo (unico per topic), un TRACK in più
      setTab('match');
      await new Promise(r => setTimeout(r, 30));
      const reentered = matchPrevTab === 'calendar' && currentTab === 'match'
        && matchChannel === ch1
        && mock.__calls().channels.length === 1;
      return entered && swipeView && lobbyDue && left && reentered;
    } finally { __matchRestore(p); }
  }));

  ok('guardie: setTab su tab inesistente e dbMode local non cambiano stato; render nasconde la pill offline', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({});
      currentTab = 'watchlist'; matchChannel = null; matchChannelStatus = null;
      dbMode = 'local';
      render();
      const hiddenLocally = document.getElementById('tabMatch').classList.contains('hidden');
      setTab('match');
      const notEntered = currentTab === 'watchlist' && matchChannel === null;
      dbMode = 'supabase';
      render();
      const visibleSupabase = !document.getElementById('tabMatch').classList.contains('hidden');
      setTab('does-not-exist');
      const guardOk = currentTab === 'watchlist';
      return hiddenLocally && notEntered && visibleSupabase && guardOk;
    } finally { __matchRestore(p); }
  }));

  ok('renderMatch fuori dal tab match: nessuna scrittura nella grid', run(() => {
    const p = __matchSnap();
    try {
      __matchUI({ presence: ['N', 'V'], sessions: [{ id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], movies: [{ id: 'ma', title: 'M' }] });
      currentTab = 'watchlist';
      const grid = document.getElementById('movieGrid');
      grid.innerHTML = 'contenuto lista';
      renderMatch();
      return grid.innerHTML === 'contenuto lista';
    } finally { __matchRestore(p); }
  }));

  ok('logout chiude il canale del Match senza toccare setTab/currentTab', run(() => {
    const p = __matchSnap();
    const mock = mockMatchSb({});
    const ch = mock.channel('scorochiatu-match', {});
    sb = mock; dbMode = 'supabase';
    __matchUI({});
    currentUser = 'N'; matchChannel = ch; matchChannelStatus = 'subscribed'; currentTab = 'match';
    try {
      logout();
      return currentTab === 'match'                     // logout NON chiama setTab
        && currentUser === null
        && matchChannel === null && matchChannelStatus === null
        && mock.__calls().removed.indexOf('scorochiatu-match') !== -1;   // topic costante
    } finally { __matchRestore(p); }
  }));

  // --- 8d) caricamento BROWSER: ordine dei <script> di index.html ----
  // REGRESSIONE: js/match.js (logica pura) mancava da index.html → nel browser
  // filterSwipes/buildDeck/pendingMatch erano undefined e enterMatch lanciava
  // ReferenceError. Lo smoke restava verde perché caricava i file in ordine
  // diretto in Node. Qui si legge index.html, si estraggono i <script src>
  // nell'ordine reale del browser e si caricano in un contesto vm ISOLATO.
  console.log('\n[match — caricamento browser (ordine script di index.html)]');

  ok('index.html: js/match.js presente, subito dopo js/store.js e prima di js/ui/match.js', (() => {
    const scripts = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !/^https?:\/\//.test(s));
    const iStore = scripts.indexOf('js/store.js');
    const iMatch = scripts.indexOf('js/match.js');
    const iUIMatch = scripts.indexOf('js/ui/match.js');
    return iStore !== -1 && iMatch === iStore + 1 && iUIMatch > iMatch && scripts.indexOf('js/main.js') === scripts.length - 1;
  })());

  await okA('ordine index.html: load isolato (vm, senza DOM reale) — funzioni cross-file tutte definite', async () => {
    const scripts = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !/^https?:\/\//.test(s));
    const ordEls = {};
    const ordById = id => (ordEls[id] || (ordEls[id] = makeEl(id)));
    ordById('wheelCanvas').getContext = () => canvasCtx;
    const ctx = {
      window: { addEventListener() {}, supabase: undefined, performance: Date.now },
      document: { getElementById: ordById, createElement: () => makeEl('el-' + Math.random().toString(36).slice(2)), addEventListener() {}, querySelector() { return makeEl('q'); } },
      localStorage: storageStub(new Map()), sessionStorage: storageStub(new Map()),
      location: { reload() {} }, console,
      fetch: undefined, AbortController: undefined,
      requestAnimationFrame(cb) { return setTimeout(cb, 0); }, performance: Date.now,
      setTimeout, clearTimeout, setInterval, clearInterval,
      Date, Math, JSON, String, Number, Boolean, Array, Object, Promise,
      encodeURIComponent, decodeURIComponent, URLSearchParams,
      isFinite: Number.isFinite, isNaN: Number.isNaN
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of scripts) vm.runInContext(read(f) + '\n;', ctx, { filename: f });
    const fn = n => vm.runInContext(`typeof ${n} === 'function'`, ctx) === true;
    const decl = n => vm.runInContext(`typeof ${n} !== 'undefined'`, ctx) === true;
    const funcs = [
      // match.js — usate cross-file (store.js e ui/match.js)
      'filterSwipes', 'activeSession', 'isExpired', 'buildDeck', 'pendingMatch', 'currentIndex',
      'resolveDeckMovie', 'evaluateSession', 'swipesForCard', 'countAllMatches', 'seededShuffle', 'newSeed',
      // store.js — usate da ui/** e navigation
      'enterMatch', 'leaveMatch', 'ensureActiveSession', 'closeSession', 'recordSwipe', 'continueMatch',
      'setQuickTonight', 'activeNightForMovie', 'applyMatchState', 'renderMatchArea', 'openMatchChannel',
      'startNewSession', 'proposeNight', 'reportMatchEnterError', 'warnMatch', 'probeMatchTables',
      // ui/match.js — usate da store/render/actions/modals
      'renderMatch', 'matchScheduleModalClosed', 'matchNightDone', 'clearMatchState', 'createMatchNight',
      'swipeCard', 'newMatchSession', 'exitMatchView', 'tryMatchAgain', 'matchUnavailableHtml',
      'matchNightCreatedHtml'
    ].every(fn);
    return funcs && decl('VALID_PERSONS');
  });

  await okA('ordine index.html: applyMatchState + ensureActiveSession + startNewSession con mock nel contesto isolato', async () => {
    const scripts = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(s => !/^https?:\/\//.test(s));
    const ordEls = {};
    const ordById = id => (ordEls[id] || (ordEls[id] = makeEl(id)));
    ordById('wheelCanvas').getContext = () => canvasCtx;
    const seed = {
      sessions: [{ id: 'x1', status: 'open', created_at: new Date(Date.now() - 60000).toISOString(), deck: ['m1', 'm2'] }],
      swipes: [
        { id: 'w1', session_id: 'x1', movie_id: 'm1', person: 'N', liked: true },
        { id: 'w2', session_id: 'x1', movie_id: 'm1', person: 'X', liked: false }
      ],
      movies: [{ id: 'm1', title: 'M1', status: 'watchlist' }, { id: 'm2', title: 'M2', status: 'watchlist' }]
    };
    const ctx = {
      window: { addEventListener() {}, supabase: undefined, performance: Date.now },
      document: { getElementById: ordById, createElement: () => makeEl('el-' + Math.random().toString(36).slice(2)), addEventListener() {}, querySelector() { return makeEl('q'); } },
      localStorage: storageStub(new Map()), sessionStorage: storageStub(new Map()),
      location: { reload() {} }, console,
      fetch: undefined, AbortController: undefined,
      requestAnimationFrame(cb) { return setTimeout(cb, 0); }, performance: Date.now,
      setTimeout, clearTimeout, setInterval, clearInterval,
      Date, Math, JSON, String, Number, Boolean, Array, Object, Promise,
      encodeURIComponent, decodeURIComponent, URLSearchParams,
      isFinite: Number.isFinite, isNaN: Number.isNaN,
      mockSb: buildBrowserOrderMockSb(seed), sbSeed: seed.movies.map(m => Object.assign({}, m))
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of scripts) vm.runInContext(read(f) + '\n;', ctx, { filename: f });
    const r = await vm.runInContext(`
      (async () => {
        sb = mockSb; dbMode = 'supabase'; matchAvailable = true; matchProbeDone = true; matchProbeTimeoutMs = 3000;
        currentUser = 'N'; movies = sbSeed;
        applyMatchState({ session: { id: 'd1', status: 'open', deck: ['m1', 'm2'] }, swipes: [{ movie_id: 'm1', person: 'V', liked: true }] });
        const direct = swipeSessions.length === 1 && swipes.length === 1;
        const s = await ensureActiveSession();
        const ensured = !!s && s.id === 'x1' && swipes.length === 1;   // swipe X scartato da filterSwipes
        await closeSession('x1');
        const fresh = await startNewSession();
        const built = !!fresh && fresh.status === 'open' && Array.isArray(fresh.deck) && fresh.deck.length === 2;
        return { direct, ensured, built };
      })()
    `, ctx);
    return r && r.direct === true && r.ensured === true && r.built === true;
  });

  await okA('ingresso con errore reale: console.error UNA volta per entrata + vista col messaggio tecnico', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 'sE', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] }], movies: [{ id: 'ma', title: 'M' }] });
    sb = mock; dbMode = 'supabase'; matchAvailable = false; matchProbeDone = false;
    currentUser = 'N'; currentTab = 'match';
    const origFilter = filterSwipes;
    const origErr = console.error;
    const errs = [];
    console.error = (...a) => errs.push(a.map(String).join(' '));
    filterSwipes = function () { throw new Error('F91-KABOOM'); };
    try {
      await enterMatch();
      return errs.length === 1
        && errs[0].indexOf('F91-KABOOM') !== -1
        && matchAvailable === false
        && matchEnterErrorMsg && matchEnterErrorMsg.indexOf('F91-KABOOM') !== -1
        && document.getElementById('movieGrid').innerHTML.indexOf('F91-KABOOM') !== -1;
    } finally { filterSwipes = origFilter; console.error = origErr; __matchRestore(p); }
  }));

  ok('matchUnavailableHtml: messaggio tecnico in piccolo ed escappato', run(() => {
    matchEnterErrorMsg = '<b>ERR & co</b>';
    const html = matchUnavailableHtml();
    matchEnterErrorMsg = null;
    return html.indexOf('&lt;b&gt;ERR &amp; co&lt;/b&gt;') !== -1
      && html.indexOf('<b>ERR ') === -1
      && html.indexOf('text-[10px]') !== -1;
  }));

  console.log(`\n=== RISULTATO: ${pass}/${pass + fail} PASS ===`);
  if (fails.length) { console.log('FAIL:', fails.join('\n  ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('Harness crash:', e); process.exit(1); });