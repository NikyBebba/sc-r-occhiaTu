// ============================================
// Service Worker — sc(r)occhiaTu (PWA Foundation)
// Strategia: app-shell versionata + whitelist cloud di stile, TUTTO il resto
// passa-through (mai intercettare Supabase, TMDb, OMDb, placeholder, youtube).
// Aggiornamento: niente skipWaiting (prompt "nuova versione" lato client).
// ============================================

const CACHE_REV = 'scorochiatu-shell-v1';
const CACHE_PREFIX = 'scorochiatu-shell-';

const PRECACHE = [
  '/',
  '/css/style.css',
  '/js/config.js',
  '/js/format.js',
  '/js/api/omdb.js',
  '/js/api/tmdb.js',
  '/js/api/index.js',
  '/js/store.js',
  '/js/match.js',
  '/js/filters.js',
  '/js/wheel.js',
  '/js/ui/modals.js',
  '/js/ui/navigation.js',
  '/js/ui/actions.js',
  '/js/ui/render.js',
  '/js/ui/calendar.js',
  '/js/ui/match.js',
  '/js/main.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon-180.png'
];

// Whistle di CDN di stile/libs: network-first → cache di fallback (offline stilato).
const CDN_STYLE_HOSTS = [
  'cdn.tailwindcss.com',     // Tailwind Play (genera le utility lato client)
  'cdnjs.cloudflare.com',    // Font Awesome css + webfont
  'cdn.jsdelivr.net',        // libreria @supabase/supabase-js (SOLO il JS lib)
  'fonts.googleapis.com',    // CSS Google Fonts
  'fonts.gstatic.com'        // woff2 Plus Jakarta Sans
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_REV)
      .then(cache => cache.addAll(PRECACHE))
      .catch(() => {/* precache best-effort: l'app funziona anche senza */})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_REV).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function cacheFirst(event, cachedPath) {
  event.respondWith(
    caches.match(event.request)
      .then(hit => hit || caches.match(cachedPath))
      .then(hit => hit || fetch(event.request).then(res => {
        if (res && res.ok && cachedPath) {
          const copy = res.clone();
          caches.open(CACHE_REV).then(c => c.put(cachedPath, copy)).catch(() => {});
        }
        return res;
      }))
  );
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. Navigazione (documento) → cache-first con fallback rete, poi './' dalla cache.
  if (event.request.mode === 'navigate') {
    cacheFirst(event, '/');
    return;
  }

  // 2. Same-origin: solo gli asset dell'app-shell (whitelist), cache-first.
  if (url.origin === self.location.origin) {
    if (PRECACHE.includes(url.pathname)) {
      cacheFirst(event, url.pathname);
    }
    return;
  }

  // 3. CDN di stile/libs (network-first): si risponde dalla RETE e la risposta
  //    viene cachata per l'offline. Il fallback alla cache scatta SOLO su errore
  //    di rete (offline/DNS/timeout, nel .catch). Una risposta HTTP 4xx/5xx
  //    arriva comunque nel .then e NON viene cachata (filtro res.ok).
  if (CDN_STYLE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res && res.ok) {              // solo 2xx/3xx finiscono in cache
            const copy = res.clone();
            caches.open(CACHE_REV).then(c => c.put(event.request, copy)).catch(() => {});
          }
          return res;                        // 4xx/5xx: passano, MAI cachate
        })
        .catch(() => caches.match(event.request))  // errore di rete → cache
    );
    return;
  }

  // 4. NON intercettare: Supabase (REST + realtime/websocket), TMDb, OMDb,
  //    poster (image.tmdb.org / via.placeholder.com), YouTube e qualunque
  //    altro dominio fuori dalla whitelist. Qui non c'è alcun respondWith:
  //    le richieste restano 100% native, il SW non le guarda né le cachea.
});