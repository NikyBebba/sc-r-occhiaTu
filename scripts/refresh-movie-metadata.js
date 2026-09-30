#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { extractRatings } = require(path.join(__dirname, '..', 'js', 'api', 'omdb.js'));
const { buildTmdbDetails } = require(path.join(__dirname, '..', 'js', 'api', 'tmdb.js'));

const REPO = path.resolve(__dirname, '..');
const FIELDS = [
  'poster', 'genres', 'duration', 'release_year', 'director',
  'imdb_rating', 'rt_rating', 'metacritic_rating'
];
const RATING_FIELD_MAP = {
  imdb_rating: 'imdbRating',
  rt_rating: 'rtRating',
  metacritic_rating: 'metacriticRating'
};
const OMDB_PACE_MS = 1100;
let lastOmdbRequestAt = 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USAGE = [
  'Uso:',
  '  node scripts/refresh-movie-metadata.js --ids=<uuid1>,<uuid2> --dry-run',
  '  node scripts/refresh-movie-metadata.js --titles="Bullet Train,The Lighthouse" --dry-run',
  '  node scripts/refresh-movie-metadata.js --ids=<uuid1>,<uuid2> --apply',
  '  node scripts/refresh-movie-metadata.js --titles="Bullet Train,The Lighthouse" --apply',
  '  Per una virgola interna al titolo: --titles="Crazy\\, Stupid\\, Love."',
  '',
  'Sono richiesti esattamente un selettore (--ids oppure --titles) e una modalità',
  '(--dry-run oppure --apply). Il PATCH avviene solo con --apply.'
].join('\n');

function readOption(args, name) {
  const prefix = `--${name}=`;
  const values = args.filter(arg => arg.startsWith(prefix));
  if (values.length > 1) throw new Error(`Ripetuto --${name}.`);
  if (args.includes(`--${name}`)) throw new Error(`Usa --${name}=<valore>.`);
  return values.length ? values[0].slice(prefix.length) : null;
}

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };

  const unknown = args.filter(arg => (
    !['--dry-run', '--apply', '--ids', '--titles'].includes(arg)
    && !arg.startsWith('--ids=')
    && !arg.startsWith('--titles=')
  ));
  if (unknown.length) throw new Error(`Argomento sconosciuto: ${unknown[0]}`);

  const idsValue = readOption(args, 'ids');
  const titlesValue = readOption(args, 'titles');
  if (idsValue !== null && titlesValue !== null) {
    throw new Error('Usa --ids oppure --titles, non entrambi.');
  }
  if (idsValue === null && titlesValue === null) {
    throw new Error('Specifica --ids oppure --titles.');
  }

  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  if (dryRun === apply) {
    throw new Error('Specifica esattamente una modalità: --dry-run oppure --apply.');
  }

  if (idsValue !== null) {
    const ids = [...new Set(idsValue.split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (!ids.length) throw new Error('--ids non contiene alcun UUID.');
    const invalid = ids.find(id => !UUID_RE.test(id));
    if (invalid) throw new Error(`UUID non valido in --ids: ${invalid}`);
    return { dryRun, apply, ids, titles: null };
  }

  const titlesInput = titlesValue.trim();
  if (!titlesInput) throw new Error('--titles non contiene alcun titolo.');
  return { dryRun, apply, ids: null, titlesInput };
}

function readConfig() {
  const source = fs.readFileSync(path.join(REPO, 'js', 'config.js'), 'utf8');
  const valueOf = name => {
    const match = source.match(new RegExp(name + ":[ \\t]*['\"]([^'\"]+)['\"]"));
    return match ? match[1] : '';
  };
  const config = {
    tmdbKey: valueOf('TMDB_API_KEY'),
    omdbKey: valueOf('OMDB_API_KEY'),
    supabaseUrl: valueOf('SUPABASE_URL'),
    supabaseAnon: valueOf('SUPABASE_ANON_KEY')
  };
  if (!config.tmdbKey || !config.omdbKey || !config.supabaseUrl || !config.supabaseAnon) {
    throw new Error('Config incompleta in js/config.js: servono TMDB_API_KEY, OMDB_API_KEY, SUPABASE_URL e SUPABASE_ANON_KEY.');
  }
  return config;
}

function restUrl(config, query) {
  return `${config.supabaseUrl}/rest/v1/movies?${query}`;
}

function sbHeaders(config, extra = {}) {
  return {
    apikey: config.supabaseAnon,
    Authorization: `Bearer ${config.supabaseAnon}`,
    ...extra
  };
}

async function getMovies(config) {
  const select = ['id', 'title', 'tmdb_id', ...FIELDS].join(',');
  const response = await fetch(restUrl(config, `select=${encodeURIComponent(select)}`), {
    headers: sbHeaders(config, { Accept: 'application/json' })
  });
  if (!response.ok) throw new Error(`Lettura movies fallita: HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Lettura movies: risposta non valida.');
  return rows;
}

async function patchMovie(config, row, patch) {
  const query = new URLSearchParams({
    id: `eq.${row.id}`,
    tmdb_id: `eq.${row.tmdb_id}`
  });
  const response = await fetch(restUrl(config, query.toString()), {
    method: 'PATCH',
    headers: sbHeaders(config, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error(`PATCH ${row.id} fallito: HTTP ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error(`PATCH ${row.id}: il film non è stato aggiornato.`);
  }
}

async function fetchTmdbDetail(config, tmdbId) {
  const query = new URLSearchParams({
    api_key: config.tmdbKey,
    append_to_response: 'watch/providers,videos,credits',
    language: 'it-IT'
  });
  const response = await fetch(
    `https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}?${query.toString()}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!response.ok) throw new Error(`TMDb HTTP ${response.status}`);
  const detail = await response.json();
  if (!detail || typeof detail !== 'object' || Array.isArray(detail) || detail.status_code != null) {
    throw new Error('risorsa TMDb non valida');
  }
  if (detail.id == null || String(detail.id) !== String(tmdbId)) {
    throw new Error('TMDb ha restituito un tmdb_id diverso');
  }
  return detail;
}

async function fetchOmdbForRefresh(config, imdbId) {
  if (!imdbId) throw new Error('TMDb non ha indicato un imdb_id per il rating');
  const wait = OMDB_PACE_MS - (Date.now() - lastOmdbRequestAt);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastOmdbRequestAt = Date.now();
  const query = new URLSearchParams({ apikey: config.omdbKey, i: imdbId });
  const response = await fetch(`https://www.omdbapi.com/?${query.toString()}`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`OMDb HTTP ${response.status}`);
  const data = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.Response === 'False') {
    throw new Error('risposta OMDb non valida');
  }
  return data;
}

function normalizeValue(value) {
  return value === undefined ? null : value;
}

function sameValue(left, right) {
  return JSON.stringify(normalizeValue(left)) === JSON.stringify(normalizeValue(right));
}

function formatValue(value) {
  const normalized = normalizeValue(value);
  if (normalized === null) return 'null';
  if (typeof normalized === 'string') return JSON.stringify(normalized);
  return JSON.stringify(normalized);
}

function targetMetadata(details, row = {}) {
  const target = {};
  for (const field of FIELDS) {
    const value = normalizeValue(details[RATING_FIELD_MAP[field] || field]);
    target[field] = RATING_FIELD_MAP[field] && (value === null || value === '')
      ? normalizeValue(row[field])
      : value;
  }
  return target;
}

function buildPatch(row, target) {
  const patch = {};
  for (const field of FIELDS) {
    if (!sameValue(row[field], target[field])) patch[field] = target[field];
  }
  return patch;
}

function printComparison(row, target, changedFields, unavailable = false) {
  for (const field of FIELDS) {
    const newValue = unavailable ? 'non disponibile' : formatValue(target[field]);
    const marker = unavailable ? '' : (changedFields.has(field) ? ' [cambia]' : ' [invariato]');
    console.log(`    ${field}: ${formatValue(row[field])} -> ${newValue}${marker}`);
  }
}

function splitTitleInput(raw) {
  const parts = [];
  let current = '';
  let escaped = false;
  let hasEscapedComma = false;
  for (const char of raw) {
    if (escaped) {
      if (char === ',') {
        current += char;
        hasEscapedComma = true;
      } else {
        current += `\\${char}`;
      }
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (escaped) return { error: 'Backslash finale non valido in --titles.' };
  parts.push(current.trim());
  return { parts: [...new Set(parts.filter(Boolean))], hasEscapedComma };
}

function resolveTitleInput(raw, availableTitles) {
  const parsed = splitTitleInput(raw);
  if (parsed.error) return { error: parsed.error };
  if (!parsed.parts.length) return { error: '--titles non contiene alcun titolo.' };
  if (parsed.hasEscapedComma) return { titles: parsed.parts };

  const value = raw.trim();
  const boundaries = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] === ',') boundaries.push(index);
  }

  const solutions = [];
  const visit = (start, boundaryIndex, titles) => {
    for (let end = boundaryIndex; end <= boundaries.length; end++) {
      const endPosition = end === boundaries.length ? value.length : boundaries[end];
      const title = value.slice(start, endPosition).trim();
      if (!title || !availableTitles.has(title)) continue;
      if (end === boundaries.length) {
        solutions.push([...titles, title]);
        continue;
      }
      visit(endPosition + 1, end + 1, [...titles, title]);
    }
  };
  visit(0, 0, []);

  if (solutions.length === 1) return { titles: [...new Set(solutions[0])] };
  if (solutions.length > 1) {
    return { error: 'L\'elenco --titles è ambiguo: usa \\, per una virgola interna al titolo.' };
  }
  return { titles: parsed.parts };
}

function selectRows(rows, options) {
  if (options.ids) {
    const byId = new Map(rows.map(row => [String(row.id).toLowerCase(), row]));
    return {
      selected: options.ids.map(id => byId.get(id)).filter(Boolean),
      missing: options.ids.filter(id => !byId.has(id)),
      ambiguous: []
    };
  }

  const resolution = resolveTitleInput(options.titlesInput, new Set(rows.map(row => row.title)));
  if (resolution.error) {
    return { selected: [], missing: [], ambiguous: [], error: resolution.error };
  }
  const wanted = new Set(resolution.titles);
  const groups = new Map();
  for (const row of rows) {
    if (!wanted.has(row.title)) continue;
    const group = groups.get(row.title) || [];
    group.push(row);
    groups.set(row.title, group);
  }
  const selected = [];
  const missing = [];
  const ambiguous = [];
  for (const title of resolution.titles) {
    const group = groups.get(title) || [];
    if (!group.length) missing.push(title);
    else if (group.length > 1) ambiguous.push({ title, count: group.length });
    else selected.push(group[0]);
  }
  return { selected, missing, ambiguous };
}

function printSelection(selection) {
  for (const id of selection.missing) console.log(`  ID non trovato: ${id}`);
  for (const item of selection.ambiguous || []) {
    console.log(`  Titolo ambiguo: ${JSON.stringify(item.title)} (${item.count} film con lo stesso titolo)`);
  }
}

function validTmdbId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  const parsed = Number(normalized);
  return /^\d+$/.test(normalized) && Number.isSafeInteger(parsed) && parsed > 0 ? normalized : null;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERRORE: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  let config;
  try {
    config = readConfig();
  } catch (error) {
    console.error(`ERRORE: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (typeof fetch !== 'function') {
    console.error('ERRORE: questo script richiede Node 18 o successivo con fetch globale.');
    process.exitCode = 1;
    return;
  }

  const mode = options.dryRun ? 'DRY-RUN' : 'APPLY';
  console.log(`sc(r)occhiaTu — refresh metadata selettivi (${mode})`);
  console.log('Selettore:', options.ids ? `ID ${options.ids.join(', ')}` : `titoli esatti ${JSON.stringify(options.titlesInput)}`);
  console.log(`Campi: ${FIELDS.join(', ')}`);
  if (options.dryRun) console.log('Nessuna scrittura verrà eseguita in dry-run.');

  let rows;
  try {
    rows = await getMovies(config);
  } catch (error) {
    console.error(`ERRORE: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const selection = selectRows(rows, options);
  if (selection.error) {
    console.error(`ERRORE: ${selection.error}`);
    process.exitCode = 1;
    return;
  }
  printSelection(selection);
  console.log(`Film trovati: ${selection.selected.length}`);
  if (selection.missing.length || (selection.ambiguous && selection.ambiguous.length)) {
    console.log('Le righe mancanti o ambigue restano invariate.');
  }

  const plan = [];
  let fetchFailed = 0;
  let withoutTmdb = 0;
  for (let index = 0; index < selection.selected.length; index++) {
    const row = selection.selected[index];
    const tmdbId = validTmdbId(row.tmdb_id);
    console.log(`\n[${index + 1}/${selection.selected.length}] ${row.title} · id=${row.id} · tmdb_id=${row.tmdb_id == null ? 'null' : row.tmdb_id}`);
    if (!tmdbId) {
      withoutTmdb++;
      printComparison(row, {}, new Set(), true);
      console.log('  Nessun fetch: tmdb_id mancante o non valido.');
      continue;
    }

    try {
      const detail = await fetchTmdbDetail(config, tmdbId);
      const omdbData = detail.imdb_id ? await fetchOmdbForRefresh(config, detail.imdb_id) : null;
      const details = await buildTmdbDetails(detail, row.title, {
        fetchOmdbByImdbId: async () => omdbData,
        extractRatings
      });
      const target = targetMetadata(details, row);
      const patch = buildPatch(row, target);
      const changedFields = new Set(Object.keys(patch));
      printComparison(row, target, changedFields);
      if (!changedFields.size) {
        console.log('  Nessuna variazione: nessun PATCH.');
        continue;
      }
      plan.push({ row, patch, changedFields });
      console.log(`  ${options.dryRun ? 'DRY' : 'Da applicare'}: ${[...changedFields].join(', ')}`);
    } catch (error) {
      fetchFailed++;
      printComparison(row, {}, new Set(), true);
      console.log(`  Fetch/estrazione fallita: ${error.message}. Nessun PATCH per questo film.`);
    }
  }

  console.log('\nRiepilogo:');
  console.log(`  righe con modifiche: ${plan.length}`);
  console.log(`  righe senza variazioni: ${selection.selected.length - plan.length - fetchFailed - withoutTmdb}`);
  console.log(`  fetch/estrazioni fallite: ${fetchFailed}`);
  console.log(`  film senza tmdb_id valido: ${withoutTmdb}`);

  const selectionIssues = selection.missing.length + selection.ambiguous.length;
  if (selectionIssues || fetchFailed || withoutTmdb) {
    if (options.apply) {
      console.error('APPLY annullato: selettori incompleti o fetch non riusciti. Nessun PATCH eseguito.');
    } else {
      console.error('DRY-RUN incompleto: correggi i selettori o riprova i fetch. Nessuna scrittura eseguita.');
    }
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log('DRY-RUN completato: nessuna scrittura eseguita.');
    console.log('Per applicare esplicitamente, riavvia con lo stesso selettore e --apply.');
    return;
  }

  let applied = 0;
  let failed = 0;
  for (const item of plan) {
    try {
      await patchMovie(config, item.row, item.patch);
      applied++;
      console.log(`  ✓ ${item.row.title} (${[...item.changedFields].join(', ')})`);
    } catch (error) {
      failed++;
      console.error(`  ✗ ${item.row.title}: ${error.message}`);
    }
  }
  console.log(`APPLY completato: PATCH riusciti ${applied}, falliti ${failed}.`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Refresh metadata crash: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  targetMetadata,
  buildPatch,
  fetchOmdbForRefresh,
  resolveTitleInput
};
