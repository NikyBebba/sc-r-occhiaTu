#!/usr/bin/env node
// Audit senza scritture: node scripts/audit-data-model.js --live
// Oppure --file=fixture.json con { movies, movie_nights, votes }.
// Output solo aggregati; mai titoli, PIN, chiavi o URL autenticati.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function analyzeDataModel({ movies, movie_nights: nights, votes = null }) {
  if (!Array.isArray(movies) || !Array.isArray(nights) || (votes !== null && !Array.isArray(votes))) {
    throw new Error('Servono array movies/movie_nights e votes opzionale.');
  }
  const ids = new Set(movies.map(movie => movie.id));
  const byMovie = new Map();
  nights.forEach(night => {
    if (!byMovie.has(night.movie_id)) byMovie.set(night.movie_id, []);
    byMovie.get(night.movie_id).push(night);
  });
  const active = night => night.status === 'proposed' || night.status === 'confirmed';
  const legacyScheduled = movie => movie.status !== 'watched' && (movie.status === 'tonight' || !!movie.scheduled_date);
  const time = value => typeof value === 'string' ? value.replace(/^(\d{2}:\d{2}):00$/, '$1') : value;
  const same = (a, b) => (a ?? null) === (b ?? null);
  const counts = {
    movies: movies.length, movieNights: nights.length, legacyVotes: votes?.length ?? null,
    moviesByStatus: Object.fromEntries(['watchlist', 'tonight', 'watched'].map(status => [status, movies.filter(m => m.status === status).length])),
    nightsByStatus: Object.fromEntries(['proposed', 'confirmed', 'cancelled', 'completed', 'skipped'].map(status => [status, nights.filter(n => n.status === status).length])),
    legacyOnlyDated: 0, legacyOnlyUndated: 0, closedEventsWithLegacySchedule: 0,
    moviesWithMultipleActiveEvents: 0, activeEventsWithMovieOutsideTonight: 0,
    activeEventsWithDifferentMirror: 0, movieOnlySnacks: 0,
    unknownMovieStatus: 0,
    orphanNights: nights.filter(n => !ids.has(n.movie_id)).length,
    orphanVotes: votes === null ? null : votes.filter(v => !ids.has(v.movie_id)).length,
    undatedConfirmedWithoutTimestamp: nights.filter(n => n.date == null && n.status === 'confirmed' && !n.confirmed_at).length,
    completedWithoutDateOrTimestamp: nights.filter(n => n.status === 'completed' && !n.date && !n.completed_at).length
  };
  movies.forEach(movie => {
    const events = byMovie.get(movie.id) || [];
    const current = events.filter(active).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (!['watchlist', 'tonight', 'watched'].includes(movie.status)) counts.unknownMovieStatus++;
    if (!events.length && legacyScheduled(movie)) {
      counts[movie.scheduled_date ? 'legacyOnlyDated' : 'legacyOnlyUndated']++;
    }
    if (events.length && !current.length && legacyScheduled(movie)) counts.closedEventsWithLegacySchedule++;
    if (current.length > 1) counts.moviesWithMultipleActiveEvents++;
    if (current.length && movie.status !== 'tonight') counts.activeEventsWithMovieOutsideTonight++;
    const night = current[0];
    if (night) {
      // Quick pick: il mirror storico usa proposed_by NULL/confirmed false,
      // mentre l'evento conserva autore e conferma. Non è un conflitto.
      const quickMirror = night.date == null && night.status === 'confirmed'
        && movie.proposed_by == null && movie.night_confirmed === false;
      const drift = !same(movie.scheduled_date, night.date)
        || !same(time(movie.scheduled_time), time(night.time)) || !same(movie.snack, night.snack)
        || (!quickMirror && (!same(movie.proposed_by, night.proposed_by)
          || movie.night_confirmed !== (night.status === 'confirmed')));
      if (drift) counts.activeEventsWithDifferentMirror++;
    }
    if (movie.snack && !events.some(event => event.snack === movie.snack)) counts.movieOnlySnacks++;
  });
  return counts;
}

async function readLiveData() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../js/config.js'), 'utf8')
    + '\n;this.connection = { url: CONFIG.SUPABASE_URL, key: CONFIG.SUPABASE_ANON_KEY };', context);
  const { url, key } = context.connection;
  if (!url || !key) throw new Error('Configurazione Supabase assente.');
  const columns = {
    movies: 'id,status,scheduled_date,scheduled_time,snack,proposed_by,night_confirmed,created_at',
    movie_nights: 'id,movie_id,date,time,snack,location,proposed_by,status,created_at,confirmed_at,cancelled_at,completed_at',
    votes: 'id,movie_id,person,liked'
  };
  async function readTable(table) {
    const rows = [];
    for (let offset = 0; ;) {
      const endpoint = new URL('/rest/v1/' + table, url);
      endpoint.searchParams.set('select', columns[table]);
      endpoint.searchParams.set('order', 'id.asc');
      endpoint.searchParams.set('offset', String(offset));
      endpoint.searchParams.set('limit', '1000');
      let response;
      try {
        response = await fetch(endpoint, { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
      } catch (_) { throw new Error('Lettura ' + table + ' non riuscita (rete/timeout).'); }
      if (!response.ok) throw new Error('Lettura ' + table + ': HTTP ' + response.status + '.');
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error('Risposta ' + table + ' non valida.');
      rows.push(...page);
      // Anche un server con limite inferiore a 1000 deve essere letto tutto.
      if (!page.length) return rows;
      offset += page.length;
    }
  }
  const [movies, movie_nights, votes] = await Promise.all([
    readTable('movies'), readTable('movie_nights'), readTable('votes').catch(() => null)
  ]);
  return { movies, movie_nights, votes };
}

async function main() {
  const args = process.argv.slice(2);
  let data;
  if (args.length === 1 && args[0] === '--live') data = await readLiveData();
  else if (args.length === 1 && args[0].startsWith('--file=')) data = JSON.parse(fs.readFileSync(args[0].slice(7), 'utf8'));
  else throw new Error('Uso: node scripts/audit-data-model.js --live oppure --file=fixture.json');
  console.log(JSON.stringify({ readOnly: true, counts: analyzeDataModel(data),
    note: 'Conteggi diagnostici, non autorizzano backfill/drop. Nessuna data o conferma ricostruita.' }, null, 2));
}

module.exports = { analyzeDataModel };
if (require.main === module) main().catch(error => {
  // I messaggi del percorso live sono costruiti senza URL/key. Errori di
  // parsing delle fixture possono contenere dati: non stamparli.
  const safe = /^(Uso:|Servono array|Configurazione Supabase|Lettura (movies|movie_nights):?[^\n]*|Risposta (movies|movie_nights) non valida)/.test(error.message);
  console.error(safe ? error.message : 'Audit non riuscito: controllare configurazione o fixture.');
  process.exitCode = 1;
});
