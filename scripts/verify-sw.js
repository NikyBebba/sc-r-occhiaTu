#!/usr/bin/env node
// ============================================
// Verifica dei vincoli di intercettazione del service worker (PWA Foundation).
// Carica il VERO service-worker.js in un sandbox vm e simula gli eventi fetch:
//   - Supabase (REST + websocket), TMDb, OMDb, poster (TMDb/placeholder),
//     YouTube → MAI intercettati (nessun respondWith, nessuna cache);
//   - CDN whitelist: network-first, in cache SOLO risposte 2xx/3xx,
//     fallback alla cache ESCLUSIVAMENTE dopo errore di rete (offline/DNS).
//
// Uso: node scripts/verify-sw.js
// ============================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_SRC = fs.readFileSync(path.resolve(__dirname, '..', 'service-worker.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

// ---------- stub globali del SW ----------
const cacheApi = {
  store: new Map(),
  async open() { return cacheApi; },
  async addAll() { return; },
  async keys() { return [...cacheApi.store.keys()]; },
  async delete(k) { return cacheApi.store.delete(k); },
  async match(key) { return cacheApi.store.get((key && key.url) || String(key)) || undefined; },
  async put(key, res) { cacheApi.store.set((key && key.url) || String(key), res); }
};

const listeners = {};
const selfStub = {
  location: { origin: 'https://scrocciatu.example' },
  clients: { claim() { return Promise.resolve(); } },
  addEventListener(type, fn) { listeners[type] = fn; }
};

let offline = false;
const fetchStub = async (input) => {
  if (offline) throw new TypeError('Failed to fetch (simulato offline/DNS)');
  const url = (input && input.url) || String(input);
  const status = url.includes('status-404') ? 404 : url.includes('status-500') ? 500 : 200;
  return { ok: status < 400, status, url, clone() { return this; } };
};

const swCtx = { self: selfStub, caches: cacheApi, fetch: fetchStub, URL, Promise, console };
vm.createContext(swCtx);
vm.runInContext(SW_SRC + '\n;', swCtx, { filename: 'service-worker.js' });

const handler = listeners.fetch;
if (!handler) { console.log('FATALE: listener fetch non registrato'); process.exit(1); }

function fire(url, mode) {
  let responded;
  handler({ request: { method: 'GET', url, mode: mode || 'cors' }, respondWith(p) { responded = p; } });
  return responded;
}

(async () => {
  console.log('--- 1. Domini che NON devono mai passare dal SW ---');
  const excluded = [
    ['Supabase REST',      'https://teslxpcgrrmqysfkdewe.supabase.co/rest/v1/movies?select=*'],
    ['Supabase websocket', 'wss://teslxpcgrrmqysfkdewe.supabase.co/realtime/v1/websocket?apikey=x'],
    ['TMDb API',           'https://api.themoviedb.org/3/search/movie?query=blade+runner'],
    ['OMDb API',           'https://www.omdbapi.com/?t=bladerunner&type=movie'],
    ['Poster TMDb',        'https://image.tmdb.org/t/p/w500/abc123.jpg'],
    ['Poster placeholder', 'https://via.placeholder.com/300x450?text=poster'],
    ['YouTube',            'https://www.youtube.com/watch?v=abc123']
  ];
  for (const [name, url] of excluded) {
    const r = fire(url);
    ok(name + ' → niente respondWith (request nativa)', r === undefined);
  }
  ok('cache vuota dopo i domini esclusi', cacheApi.store.size === 0);

  console.log('--- 2. CDN whitelist: network-first con cache condizionata ---');
  // 2a. rete ok → risposta dal network E cachata (2xx)
  let p = fire('https://cdn.tailwindcss.com/3.4.1/dist/tailwind.min.js');
  let res = await p;
  ok('CDN 200: risposta dal network, cachata', res && res.ok && cacheApi.store.size === 1);

  // 2b. CDN HTTP 4xx → passa, NON cachata
  p = fire('https://cdn.tailwindcss.com/status-404.js');
  res = await p;
  ok('CDN 404: passata ma NON cachata', res && !res.ok && cacheApi.store.size === 1);

  // 2c. CDN HTTP 5xx → passa, NON cachata
  p = fire('https://fonts.googleapis.com/status-500.css');
  res = await p;
  ok('CDN 500: passata ma NON cachata', res && !res.ok && cacheApi.store.size === 1);

  // 2d. CDN offline (errore di rete) → fallback alla cache precendentemente salvata
  offline = true;
  p = fire('https://cdn.tailwindcss.com/3.4.1/dist/tailwind.min.js');
  res = await p;
  offline = false;
  ok('CDN offline: fallback su cache (solo errore di rete)', res && res.status === 200 && res.url.includes('tailwind'));

  console.log('\n=== RISULTATO: ' + pass + ' PASS / ' + fail + ' FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})();