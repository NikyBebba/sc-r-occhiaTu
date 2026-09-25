// ============================================
// MATCH — logica pura del Match live (step 6): deck, seed, valutazione
// sessione di swipe. DOM-free: testata da scripts/smoke.js con oggetti
// canned e seed iniettato (nessuna casualità reale nei test). Script
// classico, niente ES modules / export.
//
// Sessione = un giro di swipe col proprio mazzo mescolato e congelato
// (deck uuid[] letto dal DB, stesso ordine sui due telefoni). seed =
// generato dal CLIENT (crypto.getRandomValues), MAI derivato da data/day.
//
// CONTRACT (Match — riconoscimento dai dati):
// - Celebrazione: pendingMatch(session, swipes, deck) != null. Lo status 'matched' NON è un prerequisito.
// - matched_movie_id = ultimo match RICONOSCIUTO tramite "Continua" (non scritto al doppio like).
// - Il percorso swipe/reconcile/resync NON scrive più 'matched'. Schema ammette ancora 'matched' (inutilizzato), nessuna migration.
// - reconcileSession resta solo per open→done (mazzo esaurito, nessun match pendente), idempotente, condizionato a id+status 'open'.
// - "Continua": update con matched_movie_id = pending, matched_at (informativo), status 'open' (o 'done' se esaurito), condizionato a id+status IN('open','matched'); se 0 righe o errore → console.error una volta + riallineamento; idempotente.

// Regole chiave:
// - stati sessione: open|matched = attive; done|closed = non attive. (status 'matched' ammesso ma non usato per la celebrazione).
// - attività sessione = max(created_at) degli swipe, altrimenti created_at
//   della sessione (nessuna colonna updated_at).
// - TTL di ripresa: SESSION_TTL_HOURS = 6.
// ============================================

const SESSION_TTL_HOURS = 6;
const TTL_MS = SESSION_TTL_HOURS * 3600000;

const VALID_PERSONS = ['N', 'V'];

// ---- Seed client 0..2^31-1 (colonna integer) ----
function newSeed() {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
  }
  return Math.floor(Math.random() * 0x7fffffff); // fallback (sandbox/no crypto)
}

// ---- Shuffle deterministico (mulberry32) ----
// Stesso seed → stessa permutazione; l'ordine del deck è riproducibile.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seed) {
  const rnd = mulberry32(seed);
  const out = (Array.isArray(arr) ? arr : []).slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// ---- Deck ----
// Watchlist ammissibile (filtrata in ingresso, MAI dagli swipe di sessioni
// precedenti: i film già swipati tornano nei mazzi nuovi). Seed iniettato
// per i test, altrimenti generato col client.
function buildDeck(moviesList, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const veto = new Set(o.vetoedIds || []);
  const excl = new Set(o.excludeIds || []);
  const eligible = [];
  const seen = new Set();
  for (const m of (moviesList || [])) {
    if (!m || m.id == null) continue;
    if (m.status && m.status !== 'watchlist') continue;
    if (veto.has(m.id) || excl.has(m.id)) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    eligible.push(m.id);
  }
  const seed = typeof o.seed === 'number' ? o.seed : newSeed();
  return { seed, deck: seededShuffle(eligible, seed) };
}

// ---- Timestamp ----
function tsOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

// Ultima attività: max(created_at) degli swipe validi, altrimenti created_at
// della sessione. 0 se non ricavabile.
function lastActivityAt(session, swipes) {
  let max = 0;
  for (const s of filterSwipes(swipes)) {
    const t = tsOf(s.created_at);
    if (t > max) max = t;
  }
  if (max > 0) return max;
  return tsOf(session && session.created_at);
}

// Scaduta se now — ultima attività >= TTL (al limite esatto delle 6h non si
// riprende: la regola è "più recente di 6 ore").
function isExpired(session, swipes, now) {
  const current = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  return current - lastActivityAt(session, swipes) >= TTL_MS;
}

// ---- Sessione attiva (una sola: open|matched) ----
function activeSession(sessions) {
  const active = (sessions || []).filter(s => s && (s.status === 'open' || s.status === 'matched'));
  if (active.length === 0) return null;
  active.sort((a, b) => tsOf(b.created_at) - tsOf(a.created_at));
  return active[0];
}

// ---- Swipe validi (persone N/V) ----
function isValidPerson(p) {
  return p === 'N' || p === 'V';
}

function filterSwipes(swipes) {
  return (swipes || []).filter(s => s && isValidPerson(s.person));
}

// Risposte N/V per un card (undefined = non ancora risposto).
function swipesForCard(swipes, movieId) {
  const out = {};
  for (const s of filterSwipes(swipes)) {
    if (s.movie_id !== movieId) continue;
    out[s.person] = s.liked === true;
  }
  return out;
}

// Doppio like = match.
function hasMatchOnCard(swipes, movieId) {
  const r = swipesForCard(swipes, movieId);
  return r.N === true && r.V === true;
}

// Risolto = entrambi hanno risposto (indipendentemente dal valore).
function isCardResolved(swipes, movieId) {
  const r = swipesForCard(swipes, movieId);
  return r.N !== undefined && r.V !== undefined;
}

function resolveDeckMovie(moviesList, movieId) {
  for (const m of (moviesList || [])) {
    if (m && m.id === movieId) return m;
  }
  return null;
}

// Primo card non risolto (index), deck.length se tutti risolti. Con
// moviesList fornito, un id senza film nel deck (cancellato) vale risolto.
function currentIndex(deck, swipes, moviesList) {
  const d = Array.isArray(deck) ? deck : [];
  for (let i = 0; i < d.length; i++) {
    if (moviesList && !resolveDeckMovie(moviesList, d[i])) continue;
    if (!isCardResolved(swipes, d[i])) return i;
  }
  return d.length;
}

// Conta i match (doppio like) tra gli swipe validi.
function countAllMatches(swipes, moviesList) {
  const byMovie = {};
  for (const s of filterSwipes(swipes)) {
    if (!byMovie[s.movie_id]) byMovie[s.movie_id] = {};
    byMovie[s.movie_id][s.person] = s.liked === true;
  }
  let n = 0;
  for (const id in byMovie) {
    if (moviesList && !resolveDeckMovie(moviesList, id)) continue;
    if (byMovie[id].N === true && byMovie[id].V === true) n++;
  }
  return n;
}

// ---- Step4 phase16 — Match % di sessione ----
// Agreement% = film con giudizio IDENTICO (doppio-like O doppio-dislike) /
// film risolti da entrambi (sottoinsieme già comune: gestisce da solo il
// match a metà mazzo). DOM-free e senza side-effect, testabile in smoke.
// Ritorna { agreed, total, pct } con pct = % arrotondata o null se total 0.
function sessionAgreement(swipes, moviesList) {
  const byMovie = {};
  for (const s of filterSwipes(swipes)) {
    if (!byMovie[s.movie_id]) byMovie[s.movie_id] = {};
    byMovie[s.movie_id][s.person] = s.liked === true;
  }
  let agreed = 0, total = 0;
  for (const id in byMovie) {
    if (moviesList && !resolveDeckMovie(moviesList, id)) continue;
    const n = byMovie[id].N, v = byMovie[id].V;
    if (n === undefined || v === undefined) continue; // non ancora comune
    total++;
    if (n === v) agreed++;
  }
  return { agreed, total, pct: total > 0 ? Math.round((agreed / total) * 100) : null };
}

// ---- Regola di celebrazione (ordine del DECK, mai timestamps) ----
// Id del card con l'indice più alto del deck tra quelli con doppio like,
// solo se session.matched_movie_id è diverso da quel film; altrimenti null
// (il match già celebrato/continuato non si ricelebra, nemmeno per un
// reconcile in ritardo dell'altro telefono).
function pendingMatch(session, swipes, deck, moviesList) {
  const d = Array.isArray(deck) ? deck : [];
  for (let i = d.length - 1; i >= 0; i--) {
    const id = d[i];
    if (moviesList && !resolveDeckMovie(moviesList, id)) continue;
    if (hasMatchOnCard(swipes, id)) {
      return (session && session.matched_movie_id === id) ? null : id;
    }
  }
  return null;
}

// ---- Valutazione sessione ----
// view: 'match' (da celebrare) | 'swipe' (card corrente) | 'done' (mazzo
// esaurito). Persone non N/V ignorate; film cancellato nel deck = risolto.
function evaluateSession(session, swipes, moviesList) {
  const d = Array.isArray(session && session.deck) ? session.deck : [];
  const valid = filterSwipes(swipes);
  const index = currentIndex(d, valid, moviesList);
  const matches = countAllMatches(valid, moviesList);
  const pending = pendingMatch(session, valid, d, moviesList);
  if (pending !== null) return { view: 'match', movieId: pending, index, matches };
  if (index >= d.length) return { view: 'done', movieId: null, index, matches };
  return { view: 'swipe', movieId: d[index], index, matches };
}
