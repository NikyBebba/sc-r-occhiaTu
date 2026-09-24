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
    'js/genres.js',
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
  await okA('buildTmdbDetails (canned, niente imdb_id → nessuna rete) espone genres + mood + duration', runA(async () => {
    const d = await buildTmdbDetails({ id: 11, title: 'T', runtime: 92, genres: [{ id: 35, name: 'Commedia' }, { id: 18, name: 'Dramma' }], 'watch/providers': { results: {} }, videos: { results: [] } }, 'T');
    return d.genres.join() === 'Commedia,Dramma' && d.genre === 'risata' && d.duration === '92 min';
  }));
  await okA('buildTmdbDetails (canned) senza runtime → duration null, genre null', runA(async () => {
    const d = await buildTmdbDetails({ id: 12, title: 'T2', runtime: null, genres: [] }, 'T2');
    return d.duration === null && d.genre === null && Array.isArray(d.genres) && d.genres.length === 0;
  }));
  ok('omdbToDetails (canned): Genre "Drama, Comedy" → genres + mood + duration', run(() => {
    const d = omdbToDetails({ Title: 'OD', Runtime: '142 min', Genre: 'Drama, Comedy', Poster: 'N/A' }, 'OD');
    return d.genres.join() === 'Drama,Comedy' && d.genre === 'risata' && d.duration === '142 min';
  }));
  ok('omdbToDetails (canned): Runtime/Genre N/A → duration null, genre null', run(() => {
    const d = omdbToDetails({ Title: 'OD2', Runtime: 'N/A', Genre: 'N/A' }, 'OD2');
    return d.duration === null && d.genre === null && d.genres.length === 0;
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
  await okA('add salva genres + mood derivato; duration null senza runtime', runA(async () => {
    pickerMode = 'add'; pendingAddedBy = 'N';
    await applyResolvedDetails({ title: 'Con Generi', tmdb_id: 991, genres: ['Dramma'], genre: 'nostalgia', duration: null, platform: 'P', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.tmdb_id === 991);
    movies = movies.filter(x => x.tmdb_id !== 991);
    return Boolean(m) && m.genres.join() === 'Dramma' && m.genre === 'nostalgia' && m.duration === null;
  }));
  await okA('add senza generi → genre null, genres [], nessun "120 min"', runA(async () => {
    pickerMode = 'add'; pendingAddedBy = 'N';
    await applyResolvedDetails({ title: 'Senza Generi', tmdb_id: 992, genres: [], genre: null, duration: null, platform: 'P', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.tmdb_id === 992);
    movies = movies.filter(x => x.tmdb_id !== 992);
    return m !== undefined && m.genre === null && Array.isArray(m.genres) && m.genres.length === 0 && m.duration === null;
  }));
  await okA('add: mood scelto a mano vince su quello derivato', runA(async () => {
    pickerMode = 'add'; pendingAddedBy = 'N'; pendingGenre = 'paura';
    await applyResolvedDetails({ title: 'Mood Manuale', tmdb_id: 993, genres: ['Commedia'], genre: 'risata', duration: '90 min', platform: 'P', poster: '', trailerUrl: '', matched: true });
    pendingGenre = '';
    const m = movies.find(x => x.tmdb_id === 993);
    movies = movies.filter(x => x.tmdb_id !== 993);
    return m.genre === 'paura' && m.genres.join() === 'Commedia';
  }));
  await okA('retry: preserva mood manuale ma aggiorna i generi', runA(async () => {
    const manual = { id: 'manualretry', title: 'M Retry', added_by: 'N', status: 'watchlist', genre: 'romantico', genres: [], duration: null, platform: 'P', poster: '' };
    movies.push(manual);
    pickerMode = 'retry'; pickerTargetId = manual.id;
    await applyResolvedDetails({ title: 'M Retry', genres: ['Fantascienza'], genre: 'altro', duration: '131 min', platform: 'S', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.id === manual.id);
    movies = movies.filter(x => x.id !== manual.id);
    return m.genre === 'romantico' && m.genres.join() === 'Fantascienza' && m.duration === '131 min';
  }));
  await okA('retry: genre null → deriva il mood dai generi', runA(async () => {
    const emptyMood = { id: 'retrynull', title: 'R Null', added_by: 'N', status: 'watchlist', genre: null, genres: [], duration: null, platform: 'P', poster: '' };
    movies.push(emptyMood);
    pickerMode = 'retry'; pickerTargetId = emptyMood.id;
    await applyResolvedDetails({ title: 'R Null', genres: ['Horror'], genre: 'paura', duration: '95 min', platform: 'S', poster: '', trailerUrl: '', matched: true });
    const m = movies.find(x => x.id === emptyMood.id);
    movies = movies.filter(x => x.id !== emptyMood.id);
    return m.genre === 'paura' && m.duration === '95 min';
  }));
  // ripristino: togli i ghost di test (array + mirror localStorage) per non
  // inquinare statistiche/render dei test successivi
  run(() => {
    movies = movies.filter(x => x.tmdb_id !== 991 && x.tmdb_id !== 992 && x.tmdb_id !== 993);
    const ghostTitles = ['Con Generi', 'Senza Generi', 'Mood Manuale'];
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
    const okDir = html.indexOf('class="mt-1 text-[10px] text-slate-500 truncate"') !== -1
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
  ok('renderStats: 4 card con icona, genere non mappato escaped, mai "undefined"', run(() => {
    movies.push({ id: 'stats-ghost', title: 'x', status: 'watched', genre: 'a<b', rating: 5, review_text: '', review_by: 'both' });
    renderStats();
    const html = document.getElementById('statsGrid').innerHTML;
    return html.indexOf('fa-clapperboard') !== -1
      && html.indexOf('fa-star') !== -1
      && html.indexOf('fa-face-smile-beam') !== -1
      && html.indexOf('fa-heart') !== -1
      && html.indexOf('a&lt;b') !== -1
      && html.indexOf('a<b') === -1
      && html.indexOf('undefined') === -1;
  }));

  // --- 5c) generi: mappa + derivazione mood (oggetti canned, nessuna rete) ---
  console.log('\n[generi — mappa TMDb/OMDb → mood]');
  ok('TMDB_GENRE_MOOD: id principali mappati', run(() =>
    TMDB_GENRE_MOOD[27] === 'paura' && TMDB_GENRE_MOOD[53] === 'paura'
    && TMDB_GENRE_MOOD[18] === 'nostalgia' && TMDB_GENRE_MOOD[36] === 'nostalgia'
    && TMDB_GENRE_MOOD[35] === 'risata' && TMDB_GENRE_MOOD[28] === 'azione'
    && TMDB_GENRE_MOOD[10749] === 'romantico'));
  ok('TMDB_GENRE_MOOD: Fantasy(14) e Science Fiction(878) restano in \'altro\'', run(() =>
    TMDB_GENRE_MOOD[14] === 'altro' && TMDB_GENRE_MOOD[878] === 'altro'));
  ok('moodFromGenres: horror+drama → paura (priorità)', run(() => moodFromGenres([27, 18]) === 'paura'));
  ok('moodFromGenres: drama+comedy → risata (priorità)', run(() => moodFromGenres([18, 35]) === 'risata'));
  ok('moodFromGenres: romantico+thriller → paura (thriller vince)', run(() => moodFromGenres([10749, 53]) === 'paura'));
  ok('moodFromGenres: singolo azione → azione', run(() => moodFromGenres([28]) === 'azione'));
  ok('moodFromGenres: solo fantascienza → altro', run(() => moodFromGenres([878]) === 'altro'));
  ok('moodFromGenres: vuoto/null/id ignoto → altro', run(() =>
    moodFromGenres([]) === 'altro' && moodFromGenres(null) === 'altro' && moodFromGenres([999999]) === 'altro'));
  ok('moodFromGenreNames: Drama+Comedy → risata (nomi OMDb)', run(() => moodFromGenreNames(['Drama', 'Comedy']) === 'risata'));
  ok('moodFromGenreNames: Horror+Drama → paura (nomi OMDb)', run(() => moodFromGenreNames(['Horror', 'Drama']) === 'paura'));
  ok('moodFromGenreNames: Sci-Fi → altro (nomi OMDb)', run(() => moodFromGenreNames(['Sci-Fi']) === 'altro'));
  ok('moodFromGenreNames: nomi it-IT TMDb (Fantascienza+Dramma → nostalgia)', run(() => moodFromGenreNames(['Fantascienza', 'Dramma']) === 'nostalgia'));
  ok('moodFromGenreNames: vuoto o nome ignoto → altro', run(() =>
    moodFromGenreNames([]) === 'altro' && moodFromGenreNames(['Sconosciuto']) === 'altro'));

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
      && cnt(html, 'bg-sky-500/90') === 1 // badge "stasera" solo per il film tonight
      && cnt(html, 'deleteMovieConfirm') === 4; // ogni card ha comunque il cestino (nessun errore per status ignoto)
    currentTab = prevTab;
    currentUser = prevUser;
    movies = saved;
    return ok;
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
          const ch = {
            name, opts: opts || {}, bindings: [],
            on(ev, filterOrCb, cb) { this.bindings.push({ ev, filter: filterOrCb, cb }); return this; },
            subscribe(cb) { this.statusCb = cb; calls.channels.push({ name: this.name, bindingsAtSubscribe: this.bindings.length, ch: this }); return this; },
            track(p) { calls.tracks++; calls.trackPayloads.push(Object.assign({}, p)); return Promise.resolve('ok'); },
            untrack() { calls.tracks--; return Promise.resolve('ok'); },
            presenceState() { return { N: [{ user: 'N' }], V: [{ user: 'V' }] }; },
            fire(status, err) { if (this.statusCb) this.statusCb(status, err); }
          };
          return ch;
        },
        removeChannel(ch) { calls.removes++; calls.removed.push(ch ? ch.name : null); if (ch) ch.removed = true; return Promise.resolve('ok'); },
        getChannels() { return []; },
        __calls: () => calls,
        __sessions: () => root.swipe_sessions,
        __swipes: () => root.swipes,
        __root: () => root
      };
    }
    function __matchSnap() {
      return { sb, dbMode, currentUser, movies, vetoes, movieNights,
        matchAvailable, swipeSessions, swipes, matchChannel, matchResyncTimer,
        matchProbeDone, matchChannelSeq, matchLeaving, matchUnavailableWarnedAt,
        matchProbeTimeoutMs, lobbyPresenceState, realtimeChannel,
        matchChannelStatus, currentTab, matchPrevTab, matchDragging,
        matchPendingRender, matchNightCreated, matchPendingSchedule, matchExitTimer };
    }
    function __matchRestore(p) {
      sb = p.sb; dbMode = p.dbMode; currentUser = p.currentUser; movies = p.movies;
      vetoes = p.vetoes; movieNights = p.movieNights;
      matchAvailable = p.matchAvailable; swipeSessions = p.swipeSessions; swipes = p.swipes;
      matchChannel = p.matchChannel; matchResyncTimer = p.matchResyncTimer;
      matchProbeDone = p.matchProbeDone; matchChannelSeq = p.matchChannelSeq;
      matchLeaving = p.matchLeaving; matchUnavailableWarnedAt = p.matchUnavailableWarnedAt;
      matchProbeTimeoutMs = p.matchProbeTimeoutMs; lobbyPresenceState = p.lobbyPresenceState;
      realtimeChannel = p.realtimeChannel;
      matchChannelStatus = p.matchChannelStatus; currentTab = p.currentTab;
      matchPrevTab = p.matchPrevTab; matchDragging = p.matchDragging;
      matchPendingRender = p.matchPendingRender; matchNightCreated = p.matchNightCreated;
      matchPendingSchedule = p.matchPendingSchedule; matchExitTimer = p.matchExitTimer;
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

  await okA('recordSwipe: upsert con onConflict+ignoreDuplicates; doppio like → reconcile matched', runA(async () => {
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
      const matched = calls.updates.find(f => f.patch.status === 'matched');
      const s = mock.__sessions().find(x => x.id === 's1');
      return optsOk
        && calls.upserts.length === 2
        && matched && matched.in.vals.join() === 'open'
        && s.status === 'matched' && s.matched_movie_id === 'ma' && Boolean(s.matched_at);
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

  await okA('continueMatch: matched→open condizionato; reconcile tardivo → nessuna ricelebrazione', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 'sC', status: 'matched', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: 'ma' }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    movies = [{ id: 'ma', status: 'watchlist' }, { id: 'mb', status: 'watchlist' }];
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false;
    try {
      const session = { id: 'sC', status: 'matched', created_at: new Date().toISOString(), deck: ['ma', 'mb'], matched_movie_id: 'ma' };
      swipeSessions = [session];
      swipes = [
        { movie_id: 'ma', person: 'N', liked: true },
        { movie_id: 'ma', person: 'V', liked: true }
      ];
      await continueMatch(session);
      const afterContinue = mock.__calls().updates.length === 1 && mock.__calls().updates[0].patch.status === 'open';
      await reconcileSession(session, swipes); // il "reconcile in ritardo" dell'altro telefono
      const row = mock.__sessions().find(x => x.id === 'sC');
      return afterContinue && row.status === 'open'
        && mock.__calls().updates.length === 1   // nessuna update aggiuntiva (niente ricelebrazione)
        && row.matched_movie_id === 'ma';
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
      const matchTables = entry.ch.bindings.filter(b => b.ev === 'postgres_changes').map(b => b.filter.table).join();
      entry.ch.fire('CHANNEL_ERROR', Error('boom'));
      await new Promise(r => setTimeout(r, 20));
      const removedMatch = m.removed.indexOf(entry.ch.name) !== -1;
      return bindingsBefore === 3
        && matchTables === 'swipe_sessions,swipes'
        && entry.ch.bindings.some(b => b.ev === 'presence')
        && matchAvailable === false && matchChannel === null
        && removedMatch
        && realtimeChannel !== null && realtimeChannel.name === coreName;
    } finally { __matchRestore(p); }
  }));

  await okA('logout: removeChannel; rientro → canale NUOVO con binding prima di subscribe', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({});
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = []; swipes = []; matchChannel = null; matchLeaving = false; matchChannelSeq = 0;
    try {
      openMatchChannel();
      const m = mock.__calls();
      const first = m.channels[0];
      const firstBindings = first.ch.bindings.length;
      logout(); // → unsubscribeRealtime (noop) + leaveMatch + sessionStorage + reload
      const removedAfterLogout = m.removed.indexOf(first.ch.name) !== -1 && matchChannel === null && currentUser === null;
      currentUser = 'N';
      await enterMatch(); // rientro: nuovo canale (seq incrementata)
      const second = m.channels[1];
      return firstBindings === 3
        && removedAfterLogout && first.ch.removed === true
        && second && second.ch.name !== first.ch.name
        && second.bindingsAtSubscribe === 3
        && m.channels[0].ch.name === 'scorochiatu-match-1'
        && second.ch.name === 'scorochiatu-match-2';
    } finally { __matchRestore(p); }
  }));;

  await okA('track solo dopo SUBSCRIBED; dopo SUBSCRIBED refetch dell\'ultima sessione', runA(async () => {
    const p = __matchSnap();
    const mock = mockMatchSb({ sessions: [{ id: 's-before', status: 'open', created_at: new Date(Date.now() - 1000).toISOString(), deck: [] }] });
    sb = mock; dbMode = 'supabase'; currentUser = 'N'; matchAvailable = true; matchProbeDone = true;
    swipeSessions = [{ id: 's-before', status: 'open', created_at: new Date(Date.now() - 1000).toISOString(), deck: [] }];
    swipes = []; matchChannel = null; matchLeaving = false; matchChannelSeq = 0;
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
    try {
      for (let i = 0; i < 5; i++) onMatchChange();
      await new Promise(r => setTimeout(r, 250));
      // un resync = GET sessioni + GET swipe = 2 letture, non 5
      const gets = mock.__calls().gets.length;
      return gets === 2;
    } finally { __matchRestore(p); }
  }));

  ok('presenceUsers: chiavi uniche per persona (una key per utente)', run(() => {
    const a = presenceUsers({ N: [{ user: 'N' }], V: [{ user: 'V' }] });
    const b = presenceUsers(null);
    const c = presenceUsers({});
    return a.join() === 'N,V' && b.length === 0 && c.length === 0;
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

  await okA('setTab(match): entra e render; uscita verso altro tab chiude SOLO il canale; prevTab salvato', runA(async () => {
    const p = __matchSnap();
    const S = { id: 'sU', status: 'open', created_at: new Date().toISOString(), deck: ['ma'] };
    const mock = mockMatchSb({ sessions: [S], movies: [{ id: 'ma', title: 'M' }] });
    sb = mock; dbMode = 'supabase';
    __matchUI({});
    currentTab = 'watchlist'; matchPrevTab = 'watchlist';
    swipeSessions = [S]; swipes = []; movies = [{ id: 'ma', title: 'M' }];
    matchChannel = null; matchChannelSeq = 0; matchChannelStatus = null; matchLeaving = false;
    realtimeChannel = null;
    try {
      setTab('match');
      await new Promise(r => setTimeout(r, 30));
      const entered = currentTab === 'match' && matchPrevTab === 'watchlist'
        && matchChannel && matchChannelStatus === 'connecting'
        && document.getElementById('movieGrid').innerHTML.indexOf('Connessione…') !== -1;
      // subscribed → presence → swipe (LOBBY_DUE auto-start)
      matchChannel.fire('SUBSCRIBED');
      await new Promise(r => setTimeout(r, 30));
      matchChannel.bindings.filter(b => b.ev === 'presence').forEach(b => b.cb());
      await new Promise(r => setTimeout(r, 10));
      const swipeView = document.getElementById('movieGrid').innerHTML.indexOf('Nope') !== -1;
      setTab('calendar');
      const left = currentTab === 'calendar' && matchChannel === null && matchChannelStatus === null;
      const removedName = mock.__calls().removed.indexOf('scorochiatu-match-1') !== -1;
      // rientro da calendar → prevTab aggiornato a calendar
      setTab('match');
      await new Promise(r => setTimeout(r, 30));
      const reentered = matchPrevTab === 'calendar' && currentTab === 'match';
      return entered && swipeView && left && removedName && reentered;
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
    const ch = mock.channel('scorochiatu-match-1', {});
    sb = mock; dbMode = 'supabase';
    __matchUI({});
    currentUser = 'N'; matchChannel = ch; matchChannelStatus = 'subscribed'; currentTab = 'match';
    try {
      logout();
      return currentTab === 'match'                     // logout NON chiama setTab
        && currentUser === null
        && matchChannel === null && matchChannelStatus === null
        && mock.__calls().removed.indexOf('scorochiatu-match-1') !== -1;
    } finally { __matchRestore(p); }
  }));

  console.log(`\n=== RISULTATO: ${pass}/${pass + fail} PASS ===`);
  if (fails.length) { console.log('FAIL:', fails.join('\n  ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('Harness crash:', e); process.exit(1); });