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
    'js/store.js', 'js/filters.js', 'js/wheel.js',
    'js/ui/modals.js', 'js/ui/navigation.js', 'js/ui/actions.js', 'js/ui/render.js', 'js/ui/calendar.js',
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
    moodFilter = 'all';
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
    moodFilter = 'all'; genreFilter = 'all';
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
  ok('wheelPool: mood + durata + genere combinati; film senza generi solo in "tutti"', run(() => {
    const saved = movies;
    movies = [
      { id: 'c-short', title: 'AzioneCorta', status: 'watchlist', duration: '95 min', genre: 'azione', genres: ['Azione', 'Thriller'] },
      { id: 'c-med', title: 'CommediaMedia', status: 'watchlist', duration: '110 min', genre: 'risata', genres: ['Commedia'] },
      { id: 'c-nogen', title: 'Nostalgico', status: 'watchlist', duration: '95 min', genre: 'nostalgia', genres: null }
    ];
    durationFilter = 'all'; moodFilter = 'all'; genreFilter = 'Azione';
    let ids = wheelPool().map(m => m.id).sort();
    const okAzione = ids.join() === 'c-short';
    genreFilter = 'all'; moodFilter = 'risata';
    ids = wheelPool().map(m => m.id).sort();
    const okMood = ids.join() === 'c-med';
    moodFilter = 'all'; durationFilter = 'short'; genreFilter = 'all';
    ids = wheelPool().map(m => m.id).sort();
    const okShortNoGenInAll = ids.join() === 'c-nogen,c-short';
    durationFilter = 'medium'; genreFilter = 'Commedia';
    ids = wheelPool().map(m => m.id).sort();
    const okCommedia = ids.join() === 'c-med';
    genreFilter = 'Dramma';
    const noDramma = wheelPool().length === 0;
    genreFilter = 'all'; durationFilter = 'all';
    movies = saved;
    return okAzione && okMood && okShortNoGenInAll && okCommedia && noDramma;
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

  console.log(`\n=== RISULTATO: ${pass}/${pass + fail} PASS ===`);
  if (fails.length) { console.log('FAIL:', fails.join('\n  ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('Harness crash:', e); process.exit(1); });