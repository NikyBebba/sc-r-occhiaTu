#!/usr/bin/env node
// ============================================
// sc(r)occhiaTu — Import watchlist reale su Supabase
// Uso:
//   node scripts/import-movies.js            → esegue db-check + scritture
//   node scripts/import-movies.js --dry-run  → solo report, nessuna scrittura
//   node scripts/import-movies.js --limit 10 → primi 10 titoli (dry o reale)
//
// Proprietà:
//   - idempotente: una seconda esecuzione non duplica nulla, arricchisce solo
//     i metadati mancanti delle righe già presenti;
//   - NON tocca voti/recensioni/serate/veto/stato/scheduling dei film esistenti;
//   - matching prudente: titolo (+anno come disambiguazione), ritorna
//     eligible solo con soglia sufficiente; altrimenti OMDb fallback;
//     se fallisce anche quello il film resta matched:false (da verificare a
//     mano in UI, flusso "Correggi titolo").
//   - nessuna dipendenza npm: Supabase interlocutato via REST con l'anon key
//     di js/config.js (stessa policy RLS aperte dell'app). Le chiavi non
//     vengono MAI stampate.
// ============================================

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity;

// ---- Config: unica sorgente di verità resta js/config.js ----
const configSrc = fs.readFileSync(path.join(REPO, 'js', 'config.js'), 'utf8');
const grab = (name) => (configSrc.match(new RegExp(name + ":\\s*'([^']+)'")) || [])[1] || '';
const TMDB_KEY = grab('TMDB_API_KEY');
const OMDB_KEY = grab('OMDB_API_KEY');
const SUPABASE_URL = grab('SUPABASE_URL');
const SUPABASE_ANON = grab('SUPABASE_ANON_KEY');

if (!TMDB_KEY || !SUPABASE_URL || !SUPABASE_ANON) {
  console.error('Config incompleta in js/config.js (servono TMDB_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY).');
  process.exit(1);
}

const PACE_MS = 380;   // ~2,6 req/s: sotto il limite TMDb (40 req / 10s)
const OMDb_PACE_MS = 300;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- normalizzazione / similarità ----------
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // toglie accenti
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return String(s || '').split(/\s+/).filter(Boolean);
}

// Dice coefficient sui bigrammi di caratteri: robusto a ordine/traduzioni parziali
function diceBigrams(a, b) {
  const make = s => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const A = make(a), B = make(b);
  let inter = 0;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) || 0);
  let total = 0;
  for (const c of A.values()) total += c;
  for (const c of B.values()) total += c;
  return total === 0 ? 0 : (2 * inter) / total;
}

const yearOf = r => (r.release_date ? parseInt(String(r.release_date).slice(0, 4), 10) : null);

// ---------- TMDb ----------
async function tmdbSearch(query, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&language=it-IT&include_adult=true` +
    (year ? `&year=${year}` : '');
  const res = await fetch(url);
  const data = await res.json();
  return (data && data.results) || [];
}

// true se i token di `a` sono ESATTAMENTE il PREFIX dei token di `b` e `b` è più
// lungo (sottotitolo/mezzo-titolo appeso al titolo). Distingue il caso "vero
// film col titolo lunghissimo" (Dr. Strangelove o: How I...) dal caso featurette
// type "A Look Inside Eternal Sunshine..." dove il titolo è nel MEZZO.
function isTokenPrefix(a, b) {
  const A = tokens(a), B = tokens(b);
  return A.length > 0 && B.length > A.length && B.slice(0, A.length).join(' ') === A.join(' ');
}

// Sceglie il candidato migliore con soglia prudente. Ritorna null se non c'è
// un risultato affidabile. Confronta con title (it-IT) E original_title:
// molti film hanno il titolo italiano su TMDb (es. "Se mi lasci ti cancello"),
// e senza il confronto con l'originale rischiamo di matchare un featurette
// in lingua originale invece del film vero.
function pickBest(results, titleNorm, year) {
  let best = null, bestScore = 0;
  for (const r of results) {
    const y = yearOf(r);
    const textA = norm(r.title || '');
    const textB = norm(r.original_title || '');
    let score = Math.max(diceBigrams(titleNorm, textA), diceBigrams(titleNorm, textB));
    if (isTokenPrefix(titleNorm, textA) || isTokenPrefix(titleNorm, textB)) score += 0.30;
    if (year) {
      if (y != null && Math.abs(y - year) <= 1) score += 0.18;
      else if (y != null) score -= 0.30;
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  const minScore = year ? 0.58 : 0.80;
  return bestScore >= minScore ? { best, score: bigRound(bestScore) } : null;
}

const bigRound = x => Math.round(x * 100) / 100;

async function tmdbDetail(id) {
  const res = await fetch(
    `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&append_to_response=watch/providers,videos,credits&language=it-IT`
  );
  const d = await res.json();
  if (d.status_code) return null; // 34 = resource not found
  return d;
}

// Dettagli nel formato dell'app (stesso field-set di movies).
function buildDetails(detail) {
  let platform = 'Streaming';
  const providers = detail['watch/providers']?.results?.IT?.flatrate;
  if (providers && providers.length > 0) platform = providers[0].provider_name;

  let trailerUrl = '';
  const videos = detail.videos?.results || [];
  const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer')
    || videos.find(v => v.site === 'YouTube');
  if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;

  // Step 7 — overview (trama it-IT) + primi 8 nomi del cast in billing order
  // (credits ora in append_to_response). overview vuota → null; cast vuoto → null.
  const overview = detail.overview && detail.overview.trim() ? detail.overview : null;
  const castNames = ((detail.credits && detail.credits.cast) || [])
    .map(p => p.name).filter(Boolean).slice(0, 8);

  return {
    title: detail.title,
    tmdb_id: detail.id,
    collection_id: detail.belongs_to_collection?.id ?? null,
    collection_name: detail.belongs_to_collection?.name || null,
    genres: (detail.genres || []).map(g => g.name),
    duration: detail.runtime ? `${detail.runtime} min` : null,
    platform,
    poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
    trailerUrl,
    matched: true,
    imdb_id: detail.imdb_id || null,
    overview,
    cast_names: castNames.length ? castNames : null
  };
}

// ---------- OMDb (solo fallback) ----------
async function omdbSearch(title) {
  if (!OMDB_KEY) return null;
  const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(title)}`);
  const data = await res.json();
  return data.Response === 'False' ? null : data;
}

async function omdbRatings(imdbId) {
  if (!OMDB_KEY || !imdbId) return { imdbRating: '', rtRating: '', metacriticRating: '' };
  const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_KEY}&i=${imdbId}`);
  const data = await res.json();
  const out = { imdbRating: '', rtRating: '', metacriticRating: '' };
  if (data.Response === 'False') return out;
  if (data.imdbRating && data.imdbRating !== 'N/A') out.imdbRating = data.imdbRating;
  (data.Ratings || []).forEach(r => {
    if (r.Source === 'Rotten Tomatoes') out.rtRating = r.Value;
    if (r.Source === 'Metacritic') out.metacriticRating = r.Value;
  });
  return out;
}

function omdbToDetails(omdbData, fallbackTitle) {
  const genreNames = (omdbData.Genre || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s && s.toLowerCase() !== 'n/a');
  return {
    title: omdbData.Title || fallbackTitle,
    tmdb_id: null,
    collection_id: null,
    collection_name: null,
    genres: genreNames,
    duration: omdbData.Runtime && omdbData.Runtime !== 'N/A' ? omdbData.Runtime : null,
    platform: 'Streaming',
    poster: omdbData.Poster && omdbData.Poster !== 'N/A' ? omdbData.Poster : '',
    trailerUrl: '',
    matched: true,
    imdb_id: null,
    imdbRating: omdbData.imdbRating && omdbData.imdbRating !== 'N/A' ? omdbData.imdbRating : '',
    rtRating: '',
    metacriticRating: ''
  };
}

// ---------- Supabase (REST, stesse policy aperte dell'app) ----------
const sb = (seg) => `${SUPABASE_URL}/rest/v1/${seg}`;
async function sbGet(seg, select) {
  const res = await fetch(sb(seg), {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
  });
  if (!res.ok) throw new Error(`GET ${seg} → HTTP ${res.status}`);
  return res.json();
}
async function sbInsert(movie) {
  const res = await fetch(sb('movies'), {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    },
    body: JSON.stringify([movie])
  });
  if (!res.ok) throw new Error(`INSERT → HTTP ${res.status}`);
  const rows = await res.json();
  return rows && rows[0];
}
async function sbPatch(id, patch) {
  const res = await fetch(sb(`movies?id=eq.${id}`), {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`PATCH ${id} → HTTP ${res.status}`);
}

// ---------- Alias di ricerca documentati ----------
// Usati SOLO quando la ricerca con il titolo esatto non produce un match
// affidabile: modificano la QUERY, mai il titolo salvato (che resta quello
// risolto da TMDb/OMDb). I titoli originali restano in data/movie-watchlist.json.
const SEARCH_ALIASES = {
  'Springsteen - Liberami dal nulla': 'Road Diary: Bruce Springsteen and The E Street Band',
  'Italia 1982, una storia azzurra': 'Italia 1982',
  'Der große Fake: Die Wirecard-Story': 'Wirecard',
  'F1: Il film': 'F1',
  'Demon Slayer: Il Castello dell\'Infinito': 'Demon Slayer: Kimetsu no Yaiba - Infinity Castle',
  'Balls Up: Palle al sicuro': 'Balls Up',
  'Una battaglia dopo l\'altra': 'Fight or Flight',
  'Il metodo di Phil Stutz': 'Stutz',
  // TMDb it-IT lo salva col titolo completo "Il dottor Stranamore - Ovvero: come
  // ho imparato a non preoccuparmi e ad amare la bomba": la query esatta in
  // italiano scende sotto soglia. Con l'originale English match pulito.
  'Il dottor Stranamore': 'Dr. Strangelove'
};

// ---------- Risoluzione di un singolo titolo ----
// Ritorna { found, matcher: 'tmdb'|'omdb'|null, details, alias, reason }
async function resolveTitle(entry) {
  const titleNorm = norm(entry.title);
  let aliasUsed = null;

  // 1° tentativo: titolo esatto
  await sleep(PACE_MS);
  let results = await tmdbSearch(entry.title, null);
  let hit = pickBest(results, titleNorm, entry.year);

  // alias documentati se il primo tentativo non è affidabile
  if (!hit && SEARCH_ALIASES[entry.title]) {
    aliasUsed = SEARCH_ALIASES[entry.title];
    await sleep(PACE_MS);
    results = await tmdbSearch(aliasUsed, null);
    hit = pickBest(results, norm(aliasUsed), entry.year);
  }

  // 2° tentativo con anno come filtro forte (solo se conosciamo l'anno)
  if (!hit && entry.year) {
    await sleep(PACE_MS);
    results = await tmdbSearch(entry.title, entry.year);
    hit = pickBest(results, titleNorm, entry.year);
  }

  if (hit) {
    await sleep(PACE_MS);
    const detail = await tmdbDetail(hit.best.id);
    if (detail) {
      const d = buildDetails(detail);
      const ratings = await omdbRatings(d.imdb_id);
      return { found: true, matcher: 'tmdb', details: { ...d, ...ratings }, alias: aliasUsed };
    }
    return { found: false, matcher: null, details: null, alias: aliasUsed,
      reason: 'TMDb ha trovato il titolo ma il dettaglio è fallito' };
  }

  // fallback OMDb (titolo esatto)
  await sleep(OMDb_PACE_MS);
  const omdbData = await omdbSearch(entry.title);
  if (omdbData) {
    return { found: true, matcher: 'omdb', details: omdbToDetails(omdbData, entry.title), alias: aliasUsed };
  }
  return { found: false, matcher: null, details: null, alias: aliasUsed,
    reason: entry.year ? `nessun risultato affidabile TMDb (anno ${entry.year}) né OMDb` : 'nessun risultato affidabile TMDb né OMDb' };
}

// ---------- metadata update non distruttivo ----------
const METADATA_KEYS = ['duration', 'platform', 'poster', 'trailer_url', 'imdb_rating', 'rt_rating', 'metacritic_rating', 'tmdb_id', 'collection_id', 'collection_name', 'genres', 'overview', 'cast_names'];

function metadataPatch(row, details) {
  const patch = {};
  if (row.matched !== true && details.matched === true) patch.matched = true;
  for (const k of METADATA_KEYS) {
    const target = details[k === 'trailer_url' ? 'trailerUrl' : k];
    if (target === null || target === undefined) continue;
    if (Array.isArray(target)) {
      // genres (array): si riempie solo se la colonna è vuota e il target
      // ha almeno un genere (niente patch inutili che stancano il realtime).
      if (target.length > 0 && (!row[k] || (Array.isArray(row[k]) && row[k].length === 0))) patch[k] = target;
    } else if (target !== '' && !row[k]) {
      patch[k] = target;
    }
  }
  return patch;
}

// ---------- main ----------
(async () => {
  console.log('sc(r)occhiaTu — Movie Import' + (DRY ? ' (DRY-RUN, nessuna scrittura)' : ''));
  console.log('Input:');

  const list = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'movie-watchlist.json'), 'utf8'));
  const entries = list.movies;
  const total = entries.length;
  const nCount = entries.filter(e => e.source === 'N').length;
  const vCount = entries.filter(e => e.source === 'V').length;
  console.log(`${total} titles`);
  console.log(`N: ${nCount}`);
  console.log(`V: ${vCount}`);

  // duplicati NELLA lista (per titolo normalizzato)
  const seen = new Map();
  const dupes = [];
  const unique = entries.filter(e => {
    const k = norm(e.title);
    if (seen.has(k)) { dupes.push(e.title); return false; }
    seen.set(k, true);
    return true;
  });
  if (dupes.length) console.log(`Duplicati dentro la lista: ${dupes.join(' | ')}`);

  // stato DB attuale
  await sleep(200);
  let existing = [];
  try {
    existing = await sbGet('movies?select=id,title,added_by,status,duration,platform,poster,matched,imdb_rating,rt_rating,metacritic_rating,tmdb_id,collection_id,collection_name');
  } catch (e) {
    console.error('ERRORE: impossibile leggere Supabase (' + e.message + '). Import interrotta per sicurezza.');
    process.exit(1);
  }
  console.log(`\nGià presenti su Supabase all'avvio: ${existing.length}`);
  if (DRY) console.log('(dry-run: nessuna modifica verrà applicata)');

  const existingNorm = new Map(existing.map(r => [norm(r.title), r]));
  const existingByTmdb = new Map(existing.filter(r => r.tmdb_id != null).map(r => [r.tmdb_id, r]));

  const stats = {
    tmdbMatched: 0, tmdbUnmatched: 0, omdbFallback: 0,
    inserted: 0, alreadyExisting: 0, updatedMetadata: 0, dupesSkipped: dupes.length,
    notFound: 0
  };
  const notFoundList = [];
  const aliasUsedList = [];

  const bucket = unique.slice(0, LIMIT);
  for (let i = 0; i < bucket.length; i++) {
    const entry = bucket[i];
    const row = existingNorm.get(norm(entry.title));
    let existingPtr = row || null;

    const { found, matcher, details, alias, reason } = await resolveTitle(entry);
    if (alias) aliasUsedList.push(entry.title + ' → "' + alias + '"');
    if (matcher === 'tmdb' && found) stats.tmdbMatched++;
    if (matcher === 'tmdb' && !found) stats.tmdbUnmatched++;
    if (matcher === 'omdb') stats.omdbFallback++;

    // De-dup anche per tmdb_id (stesso film scritto con titolo diverso)
    if (!existingPtr && details && details.tmdb_id != null) existingPtr = existingByTmdb.get(details.tmdb_id) || null;

    const tag = entry.source === 'N' ? 'N' : 'V';
    const shown = details ? details.title : entry.title;

    if (existingPtr) {
      // già presente: eventuale arricchimento metadati NON distruttivo
      const patch = details ? metadataPatch(existingPtr, details) : null;
      if (patch && Object.keys(patch).length > 0 && !DRY) {
        try { await sbPatch(existingPtr.id, patch); stats.updatedMetadata++; } catch (e) { console.error(`  ! PATCH ${shown} fallita: ${e.message}`); }
      }
      stats.alreadyExisting++;
      console.log(`  [${i + 1}/${bucket.length}] · esistente · ${shown} (${tag})`);
      continue;
    }

    if (!found) {
      stats.notFound++;
      notFoundList.push({ title: entry.title, year: entry.year });
      const meta = {
        title: entry.title, added_by: tag, status: 'watchlist', duration: null,
        platform: 'Streaming', poster: '', trailer_url: '', matched: false, rating: 0,
        genres: [],
        imdb_rating: '', rt_rating: '', metacritic_rating: '',
        tmdb_id: null, collection_id: null, collection_name: null,
        overview: null, cast_names: null
      };
      if (!DRY) {
        try { await sbInsert(meta); stats.inserted++; } catch (e) { console.error(`  ! insert "${shown}" fallita: ${e.message}`); }
      } else {
        stats.inserted++;
      }
      console.log(`  [${i + 1}/${bucket.length}] · NON TROVATO · ${entry.title} (${entry.year || '—'}, ${tag}) → salvato matched:false (${reason})`);
      continue;
    }

    const meta = {
      title: details.title, added_by: tag, status: 'watchlist',
      duration: details.duration, platform: details.platform,
      poster: details.poster, trailer_url: details.trailerUrl,
      matched: true, rating: 0,
      genres: details.genres || [],
      imdb_rating: details.imdbRating || '', rt_rating: details.rtRating || '', metacritic_rating: details.metacriticRating || '',
      tmdb_id: details.tmdb_id ?? null, collection_id: details.collection_id ?? null, collection_name: details.collection_name || null,
      overview: details.overview || null, cast_names: details.cast_names || null
    };
    if (!DRY) {
      try { await sbInsert(meta); stats.inserted++; } catch (e) { console.error(`  ! insert "${shown}" fallita: ${e.message}`); }
    } else {
      stats.inserted++;
    }
    console.log(`  [${i + 1}/${bucket.length}] · ${matcher === 'tmdb' ? 'TMDb' : 'OMDb'} · ${shown}${details.collection_name ? ' [collezione: ' + details.collection_name + ']' : ''} (${tag})`);
  }

  // ---------- report ----------
  console.log('\n' + '='.repeat(48));
  console.log(`${'TMDb matched:'}        ${stats.tmdbMatched}`);
  console.log(`${'TMDb unmatched:'}      ${stats.tmdbUnmatched}`);
  console.log(`${'OMDb fallback:'}       ${stats.omdbFallback}`);
  console.log(`${'Inserted:'}            ${stats.inserted}`);
  console.log(`${'Already existing:'}    ${stats.alreadyExisting}`);
  console.log(`${'Updated metadata:'}    ${stats.updatedMetadata}`);
  console.log(`${'Duplicates skipped:'}  ${stats.dupesSkipped}`);
  console.log(`${'Not found:'}           ${stats.notFound}`);

  if (aliasUsedList.length) {
    console.log('\nAlias di ricerca usati:');
    aliasUsedList.forEach(a => console.log('  - ' + a));
  }
  if (notFoundList.length) {
    console.log('\nNOT FOUND:');
    for (const nf of notFoundList) console.log(`  - ${nf.title}${nf.year ? ' (' + nf.year + ')' : ''}`);
  }
  if (LIMIT !== Infinity) console.log(`\n(eseguito con --limit=${LIMIT}, non tutta la lista)`);

  // ---------- verifica finale DB ----------
  try {
    await sleep(200);
    const after = await sbGet('movies?select=id,title,tmdb_id,collection_id');
    const withTmdb = after.filter(r => r.tmdb_id != null).length;
    const withCol = after.filter(r => r.collection_id != null).length;
    const dupByName = after.length - new Set(after.map(r => norm(r.title))).size;
    console.log('\nDatabase after import:');
    console.log(`  film totali: ${after.length}`);
    console.log(`  con tmdb_id: ${withTmdb} (${withTmdb && after.length ? Math.round(withTmdb / after.length * 100) : 0}%)`);
    console.log(`  con collection_id: ${withCol} (${withCol && after.length ? Math.round(withCol / after.length * 100) : 0}%)`);
    console.log(`  possibili duplicati per titolo normalizzato: ${dupByName}`);
    if (DRY) console.log('  (dry-run)');
  } catch (e) {
    console.log('\nVerifica DB finale non riuscita: ' + e.message);
  }
})();