#!/usr/bin/env node
// ============================================
// sc(r)occhiaTu — Backfill generi reali su Supabase
// Uso:
//   node scripts/backfill-genres.js            → collect + scritture in burst
//   node scripts/backfill-genres.js --dry-run  → solo report, nessuna scrittura
//   node scripts/backfill-genres.js --limit 10 → primi 10 film (dry o reale)
//   node scripts/backfill-genres.js --force    → sovrascrive il mood (genre)
//   node scripts/backfill-genres.js --fix-duration → corregge SOLO il
//     segnaposto duration '120 min' quando TMDb ha un runtime reale
//
// Proprietà:
//   - usa il tmdb_id già presente sui film (100% oggi); chi non ce l'ha
//     viene lasciato in pace e segnalato;
//   - idempotente: una seconda esecuzione trova i film già a posto e non
//     scrive nulla;
//   - DUE FASI: prima raccoglie tutti i metadati da TMDb (pace 380 ms),
//     poi scrive gli update RAVVICINATI alla fine (burst). Così il debounce
//     Realtime (un timer, resync solo se il dato cambia) assorbe l'esplosione
//     in un solo render sull'altro telefono;
//   - regole (vincolo step 4):
//       genres si riempie solo se vuoto;
//       genre (mood) si riempie solo se null, o sempre con --force;
//       duration si tocca SOLO con --fix-duration E solo se vale
//       esattamente '120 min' (il vecchio segnaposto finto);
//     niente altri campi, niente DELETE.
//   - nessuna dipendenza npm: Supabase via REST con l'anon key di
//     js/config.js (policy RLS aperte dell'app). Le chiavi NON vengono MAI
//     stampate.
// ============================================

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const FIX_DURATION = process.argv.includes('--fix-duration');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity;

// ---- Config: unica sorgente di verità resta js/config.js ----
const configSrc = fs.readFileSync(path.join(REPO, 'js', 'config.js'), 'utf8');
const grab = (name) => (configSrc.match(new RegExp(name + ":[ \t]*['\"]([^'\"]+)['\"]")) || [])[1] || '';
const TMDB_KEY = grab('TMDB_API_KEY');
const SUPABASE_URL = grab('SUPABASE_URL');
const SUPABASE_ANON = grab('SUPABASE_ANON_KEY');

if (!TMDB_KEY || !SUPABASE_URL || !SUPABASE_ANON) {
  console.error('Config incompleta in js/config.js (servono TMDB_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY).');
  process.exit(1);
}

const PACE_MS = 380; // ~2,6 req/s: sotto il limite TMDb (40 req / 10s)

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- js/genres.js condiviso: mappa + derivazione mood (stessa dell'app) ----
const genresSrc = fs.readFileSync(path.join(REPO, 'js', 'genres.js'), 'utf8');
let TMDB_GENRE_MOOD, moodFromGenres, moodFromGenreNames;
try {
  const load = new Function(genresSrc + '\n;return { TMDB_GENRE_MOOD, moodFromGenres, moodFromGenreNames };');
  ({ TMDB_GENRE_MOOD, moodFromGenres, moodFromGenreNames } = load());
} catch (e) {
  console.error('ERRORE: impossibile caricare js/genres.js (' + e.message + ').');
  process.exit(1);
}

// ---------- Supabase (REST, stesse policy aperte dell'app) ----------
const sb = (seg) => `${SUPABASE_URL}/rest/v1/${seg}`;
async function sbGet(seg) {
  const res = await fetch(sb(seg), {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
  });
  if (!res.ok) throw new Error(`GET ${seg} → HTTP ${res.status}`);
  return res.json();
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

// ---------- TMDb ----------
async function tmdbDetail(id) {
  const res = await fetch(
    `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&language=it-IT`
  );
  const d = await res.json();
  if (d.status_code) return null; // es. 34 = resource not found
  return d;
}

const hasGenres = row => Array.isArray(row.genres) && row.genres.length > 0;

// Mood del film: preferisce gli id TMDb (stabile tra lingue), altrimenti i
// nomi (OMDb EN o TMDb it-IT) già presenti in riga/colonna.
const derivedFor = (row, data) => {
  if (data && data.genreIds && data.genreIds.length) return moodFromGenres(data.genreIds);
  return moodFromGenreNames(data && data.genreNames ? data.genreNames : row.genres);
};

// Patch non distruttiva (vincoli step 4):
//   genres → solo se colonna vuota;
//   genre  → solo se null, o sempre con --force;
//   duration → solo con --fix-duration E segnaposto esatto '120 min'.
const buildPatch = (row, data) => {
  const patch = {};
  if (!hasGenres(row) && data && data.genreNames && data.genreNames.length) patch.genres = data.genreNames;
  if (!row.genre || FORCE) {
    const hasAnyGenre = (data && data.genreIds && data.genreIds.length) || hasGenres(row);
    if (hasAnyGenre) patch.genre = derivedFor(row, data);
  }
  if (FIX_DURATION && row.duration === '120 min' && data && data.runtime) {
    patch.duration = `${data.runtime} min`;
  }
  return patch;
};

// ---------- main ----------
(async () => {
  console.log('sc(r)occhiaTu — Backfill generi' +
    (DRY ? ' (DRY-RUN, nessuna scrittura)' : '') +
    (FORCE ? ' + --force (mood sovrascritto)' : '') +
    (FIX_DURATION ? ' + --fix-duration (solo segnaposto 120 min)' : ''));

  // stato DB attuale
  let rows = [];
  try {
    await sleep(200);
    rows = await sbGet('movies?select=id,title,genre,genres,duration,tmdb_id&order=title.asc');
  } catch (e) {
    console.error('ERRORE: impossibile leggere Supabase (' + e.message + '). Backfill interrotto per sicurezza.');
    process.exit(1);
  }
  console.log(`Film su Supabase: ${rows.length}`);
  if (DRY) console.log('(dry-run: nessuna modifica verrà applicata)');

  const withTmdb = rows.filter(r => r.tmdb_id != null);
  const noTmdb = rows.filter(r => r.tmdb_id == null);

  // elenco per titolo dei segnaposto duration '120 min'
  const placeholders = rows.filter(r => r.duration === '120 min');
  if (placeholders.length) {
    console.log(`\nSegnaposto duration '120 min' (${placeholders.length}):`);
    placeholders.forEach(r => console.log(`  - ${r.title}${r.tmdb_id != null ? '' : ' (senza tmdb_id)'}`));
  } else {
    console.log('\nNessun segnaposto duration \'120 min\'.');
  }

  if (noTmdb.length) {
    console.log(`\nSenza tmdb_id (non processabili, invariati): ${noTmdb.length}`);
  }

  // ---------- FASE 1: raccolta metadati TMDb (pace 380 ms) ----------
  // Chi richiede la chiamata: generi da prendere da TMDb, oppure --force
  // (mood fresco), oppure --fix-duration su segnaposto.
  const candidates = withTmdb.filter(r =>
    FORCE || !hasGenres(r) || (FIX_DURATION && r.duration === '120 min')
  );
  // Chi NON serve che chiami TMDb ma ha genre nullo e generi già in colonna:
  // derivazione locale, nessuna richiesta di rete.
  const localDerive = withTmdb.filter(r =>
    !candidates.includes(r) && !r.genre && hasGenres(r)
  );

  const bucket = candidates.slice(0, LIMIT);
  if (bucket.length === 0) console.log('\nNessun candidato alla raccolta (tutti già a posto).');
  else console.log(`\nFase 1 — raccolta metadati TMDb (${bucket.length} film, pace ${PACE_MS} ms)...`);

  const fetched = new Map(); // film id -> { genreIds, genreNames, runtime } | null
  const nonMappedGenres = new Map(); // nome di id non coperto dalla mappa -> count
  let fetchFailed = 0;
  for (let i = 0; i < bucket.length; i++) {
    const r = bucket[i];
    try {
      await sleep(PACE_MS);
      const d = await tmdbDetail(r.tmdb_id);
      if (!d) { fetched.set(r.id, null); fetchFailed++; console.log(`  [${i + 1}/${bucket.length}] · fetch fallito · ${r.title}`); continue; }
      const ids = [], names = [];
      (d.genres || []).forEach(x => {
        if (!(x.id in TMDB_GENRE_MOOD)) nonMappedGenres.set(x.name, (nonMappedGenres.get(x.name) || 0) + 1);
        ids.push(x.id); names.push(x.name);
      });
      fetched.set(r.id, { genreIds: ids, genreNames: names, runtime: d.runtime || null });
    } catch (e) {
      fetched.set(r.id, null); fetchFailed++;
      console.log(`  [${i + 1}/${bucket.length}] · errore fetch · ${r.title} (${e.message})`);
    }
  }
  if (fetchFailed) console.log(`Fetch falliti: ${fetchFailed}`);

  // ---------- FASE 2: scritture in burst (nessun pace) ----------
  const stats = { updated: 0, alreadyOk: 0, noGenres: 0, failed: 0 };
  const updatedTitles = [];

  console.log('\nFase 2 — scritture' + (DRY ? ' (solo report)' : ' (burst ravvicinato)'));

  // Tutti i film da (ri)valutare: candidati (con dati TMDb) + derivazione locale.
  const processed = localDerive.concat(bucket);

  for (const r of processed) {
    const data = fetched.get(r.id); // undefined se non era candidato
    if (fetched.has(r.id) && data === null) continue; // fetch fallito: già segnalato
    if (bucket.includes(r) && data && (!data.genreNames || data.genreNames.length === 0)
        && !FORCE) {
      stats.noGenres++;
      console.log(`  · senza generi TMDb · ${r.title}`);
      continue;
    }
    const patch = buildPatch(r, data);
    if (Object.keys(patch).length === 0) { stats.alreadyOk++; continue; }
    if (!DRY) {
      try {
        await sbPatch(r.id, patch);
        stats.updated++; updatedTitles.push(r.title);
        console.log(`  ✓ ${r.title} (${Object.keys(patch).join(', ')})`);
        continue;
      } catch (e) {
        stats.failed++;
        console.error(`  ✗ PATCH fallita · ${r.title}: ${e.message}`);
        continue;
      }
    }
    stats.updated++; updatedTitles.push(r.title);
    console.log(`  (dry) ${r.title} (${Object.keys(patch).join(', ')})`);
  }

  // Già a posto: chi oggi ha già genre + generi ed è fuori dal processing.
  const processedIds = new Set(processed.map(r => r.id));
  const alreadyOkCount = withTmdb.filter(r => !processedIds.has(r.id)).length + stats.alreadyOk;

  // ---------- report ----------
  console.log('\n' + '='.repeat(48));
  console.log(`${'Aggiornati:'}          ${stats.updated}`);
  console.log(`${'Già a posto:'}         ${alreadyOkCount}`);
  console.log(`${'Senza generi TMDb:'}   ${stats.noGenres}`);
  console.log(`${'Fetch falliti:'}       ${fetchFailed}`);
  console.log(`${'Scritture fallite:'}   ${stats.failed}`);
  console.log(`${'Senza tmdb_id:'}       ${noTmdb.length}`);

  if (nonMappedGenres.size) {
    console.log('\nGeneri con id NON coperti dalla mappa (mood → \'altro\'):');
    for (const [name, count] of nonMappedGenres) console.log(`  - ${name} (${count})`);
  } else if (bucket.length) {
    console.log('\nTutti gli id genere incontrati sono coperti dalla mappa.');
  }

  if (DRY) console.log('\n(dry-run: nessuna modifica applicata — esegui senza --dry-run per scrivere)');
  if (LIMIT !== Infinity) console.log(`(eseguito con --limit=${LIMIT}, non tutti i candidati)`);
})().catch(e => { console.error('Backfill crash:', e); process.exit(1); });