#!/usr/bin/env node
// ============================================
// sc(r)occhiaTu — Backfill overview + cast su Supabase
// Uso:
//   node scripts/backfill-overview-cast.js            → collect + scritture in burst
//   node scripts/backfill-overview-cast.js --dry-run  → solo report, nessuna scrittura
//   node scripts/backfill-overview-cast.js --limit 10 → primi 10 film (dry o reale)
//   node scripts/backfill-overview-cast.js --force    → rilegge TUTTI i film con
//     tmdb_id e riscrive anche i valori uguali
//
// Proprietà:
//   - usa il tmdb_id già presente sui film (100% oggi); chi non ce l'ha
//     viene lasciato in pace e segnalato;
//   - idempotente: una seconda esecuzione senza --force trova i film già
//     popolati e non scrive nulla (0 PATCH);
//   - DUE FASI: prima raccoglie tutti i metadati da TMDb (pace 380 ms),
//     poi scrive gli update RAVVICINATI alla fine (burst). Così il debounce
//     Realtime (un timer, resync solo se il dato cambia) assorbe l'esplosione
//     in un solo render sull'altro telefono;
//   - regole (vincoli step 7):
//       overview (text) e cast_names (text[]) si prendono da TMDb in UNA
//       sola chiamata: /movie/{id}?append_to_response=credits&language=it-IT
//       (overview è nella risposta base; cast = primi 8 nomi in billing
//       order da credits.cast, stesso taglio di buildTmdbDetails);
//       si scrivono SOLO valori non-null: MAI sovrascrivere un campo già
//       popolato con null, nemmeno con --force (se TMDb non ha più il dato,
//       il valore attuale resta e viene segnalato nel report);
//       senza --force si scrive solo se il valore è cambiato;
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

// ---------- TMDb: dettaglio con credits (cast) + overview (risposta base) ----------
// Stessa estrazione di js/api/tmdb.js buildTmdbDetails: overview non vuota →
// valore; vuota/assente → null. cast = primi 8 nomi in billing order, vuoto → null.
async function tmdbMeta(id) {
  const res = await fetch(
    `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&append_to_response=credits&language=it-IT`
  );
  const d = await res.json();
  if (d.status_code) return null; // es. 34 = resource not found
  const overview = d.overview && d.overview.trim() ? d.overview : null;
  const castNames = ((d.credits && d.credits.cast) || [])
    .map(p => p.name).filter(Boolean).slice(0, 8);
  return { overview, cast_names: castNames.length ? castNames : null };
}

// ---------- main ----------
(async () => {
  console.log('sc(r)occhiaTu — Backfill overview + cast' +
    (DRY ? ' (DRY-RUN, nessuna scrittura)' : '') +
    (FORCE ? ' + --force (rilettura completa, anche valori uguali)' : ''));

  // stato DB attuale
  let rows = [];
  try {
    await sleep(200);
    rows = await sbGet('movies?select=id,title,overview,cast_names,tmdb_id&order=title.asc');
  } catch (e) {
    console.error('ERRORE: impossibile leggere Supabase (' + e.message + '). Backfill interrotto per sicurezza.');
    process.exit(1);
  }
  console.log(`Film su Supabase: ${rows.length}`);
  if (DRY) console.log('(dry-run: nessuna modifica verrà applicata)');

  const withTmdb = rows.filter(r => r.tmdb_id != null);
  const noTmdb = rows.filter(r => r.tmdb_id == null);
  if (noTmdb.length) {
    console.log(`\nSenza tmdb_id (non processabili, invariati): ${noTmdb.length}`);
  }

  // Candidati: con --force tutti i film con tmdb_id; altrimenti solo chi ha
  // almeno uno dei due campi non ancora popolato (entrambi non-null = salta).
  const castNonVuoto = r => Array.isArray(r.cast_names) && r.cast_names.length > 0;
  const populated = r => r.overview != null && castNonVuoto(r);
  const candidates = FORCE ? withTmdb : withTmdb.filter(r => !populated(r));
  const bucket = candidates.slice(0, LIMIT);
  const alreadyOk = withTmdb.filter(r => populated(r)).length;

  if (bucket.length === 0) console.log('\nNessun candidato alla raccolta (tutti già popolati).');
  else console.log(`\nFase 1 — raccolta metadati TMDb (${bucket.length} film, pace ${PACE_MS} ms)...`);

  // ---------- FASE 1: raccolta metadati TMDb (pace 380 ms) ----------
  const fetched = new Map(); // film id -> { overview, cast_names } | null
  let fetchFailed = 0;
  for (let i = 0; i < bucket.length; i++) {
    const r = bucket[i];
    try {
      await sleep(PACE_MS);
      const d = await tmdbMeta(r.tmdb_id);
      if (!d) { fetched.set(r.id, null); fetchFailed++; console.log(`  [${i + 1}/${bucket.length}] · fetch fallito · ${r.title}`); continue; }
      fetched.set(r.id, d);
    } catch (e) {
      fetched.set(r.id, null); fetchFailed++;
      console.log(`  [${i + 1}/${bucket.length}] · errore fetch · ${r.title} (${e.message})`);
    }
  }
  if (fetchFailed) console.log(`Fetch falliti: ${fetchFailed}`);

  // ---------- FASE 2: scritture in burst (nessun pace) ----------
  // Regole: si scrivono SOLO valori non-null; senza --force solo se cambiati;
  // mai null su un campo già popolato (valore attuale mantenuto e segnalato).
  const stats = {
    updated: 0, noPatch: 0, maintainedOverview: 0, maintainedCast: 0,
    noOverview: 0, noCast: 0, failed: 0
  };

  console.log('\nFase 2 — scritture' + (DRY ? ' (solo report)' : ' (burst ravvicinato)'));
  console.log('Tabella (titolo | overview | cast):');

  for (const r of bucket) {
    const data = fetched.get(r.id);
    if (data === null) continue; // fetch fallito: già segnalato

    const overview = data.overview;
    const cast = data.cast_names;
    const hasCurrentCast = castNonVuoto(r);
    console.log(`  · ${r.title} | overview ${overview != null ? overview.slice(0, 40) + (overview.length > 40 ? '…' : '') : '—'}`
      + (overview == null && r.overview != null ? ' (attuale mantenuta)' : '')
      + ` | cast ${cast != null ? cast.join(', ') : '—'}`
      + (cast == null && hasCurrentCast ? ' (attuale mantenuto)' : ''));

    const patch = {};
    if (overview != null) {
      if (FORCE || overview !== r.overview) patch.overview = overview;
    } else if (r.overview != null) {
      stats.maintainedOverview++;
    } else {
      stats.noOverview++;
    }
    if (cast != null) {
      if (FORCE || cast.join(',') !== (hasCurrentCast ? r.cast_names.join(',') : '')) patch.cast_names = cast;
    } else if (hasCurrentCast) {
      stats.maintainedCast++;
    } else {
      stats.noCast++;
    }

    if (Object.keys(patch).length === 0) { stats.noPatch++; continue; }
    if (!DRY) {
      try {
        await sbPatch(r.id, patch);
        stats.updated++;
        console.log(`  ✓ ${r.title} (${Object.keys(patch).join(', ')})`);
        continue;
      } catch (e) {
        stats.failed++;
        console.error(`  ✗ PATCH fallita · ${r.title}: ${e.message}`);
        continue;
      }
    }
    stats.updated++;
    console.log(`  (dry) ${r.title} (${Object.keys(patch).join(', ')})`);
  }

  // ---------- report ----------
  console.log('\n' + '='.repeat(48));
  console.log(`${'Aggiornati:'}          ${stats.updated}`);
  console.log(`${'Già popolati (saltati):'} ${alreadyOk}`);
  console.log(`${'TMDb senza overview:'} ${stats.noOverview}`);
  console.log(`${'TMDb senza cast:'}     ${stats.noCast}`);
  console.log(`${'Overview mantenuta (TMDb senza più il dato):'} ${stats.maintainedOverview}`);
  console.log(`${'Cast mantenuto (TMDb senza più il dato):'} ${stats.maintainedCast}`);
  console.log(`${'Senza variazioni da scrivere:'} ${stats.noPatch}`);
  console.log(`${'Fetch falliti:'}       ${fetchFailed}`);
  console.log(`${'Scritture fallite:'}   ${stats.failed}`);
  console.log(`${'Senza tmdb_id:'}       ${noTmdb.length}`);

  if (DRY) console.log('\n(dry-run: nessuna modifica applicata — esegui senza --dry-run per scrivere)');
  if (LIMIT !== Infinity) console.log(`(eseguito con --limit=${LIMIT}, non tutti i candidati)`);
})().catch(e => { console.error('Backfill crash:', e); process.exit(1); });