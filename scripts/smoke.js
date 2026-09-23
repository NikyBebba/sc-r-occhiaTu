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
    'js/store.js', 'js/wheel.js',
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
  ok('escapeHtml neutralizza tag', run(() => escapeHtml('<script>').indexOf('&lt;script&gt;') !== -1));
  ok('jsAttrEscape neutralizza apici', run(() => jsAttrEscape("O'Brien").indexOf("\\'") !== -1));

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

  console.log(`\n=== RISULTATO: ${pass}/${pass + fail} PASS ===`);
  if (fails.length) { console.log('FAIL:', fails.join('\n  ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('Harness crash:', e); process.exit(1); });