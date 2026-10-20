'use strict';
// Synthetic wire documents only. Signatures are opaque fixture tokens, NOT hashes.
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const N = uid(1001), V = uid(1002), H = uid(1003), G = uid(3001), M = uid(1), Q = uid(2), NIGHT = uid(20001);
const AT = '2027-01-04T12:00:00.000000Z', NEXT = '2027-01-04T23:00:00.000000Z';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const context = (overrides = {}) => ({ callerId: N, groupId: G, contractVersion: 1, contextEpoch: 1, ...overrides });
const content = movie_id => ({ movie_id, title: 'Synthetic ' + movie_id.slice(-4), added_by_person_id: null,
  created_at: AT, duration: null, platform: null, poster: null, trailer_url: null, metadata_matched: true,
  imdb_rating: null, rt_rating: null, metacritic_rating: null, tmdb_id: null, collection_id: null,
  collection_name: null, director: null, overview: null, release_year: null, genres: null, cast_names: null,
  cinema_watchlist: false, surprise_by_person_id: null });
const personalState = movie_id => ({ movie_id, seen: false, list: { active: false, generation: null },
  judgment: { rating: null, preference: null, review: null } });
const groupState = movie_id => ({ movie_id, effective_candidacy: false, list_visible: false, active_night_ids: [],
  completed_night_ids: [], rewatch_semantic: false, rewatch_visible: false, eligibility: { match_base: false, ruota_base: false } });
const night = (night_id = NIGHT, movie_id = M, status = 'proposed') => ({ night_id, movie_id, status, date: '2027-01-05', time: '21:30',
  snack: null, location: null, proposed_by_person_id: N, created_at: AT, confirmed_at: null, cancelled_at: null,
  completed_at: status === 'completed' ? AT : null });
const version = (scope_kind, scope_id, entity_id, value = '1', tombstone = false) => ({ scope_kind, scope_id, entity_id, version: value, tombstone });
function base(contents = [M]) {
  return { contract_version: 1, outcome: 'OK', caller: { person_id: N }, selected_group: { group_id: G, member_person_ids: [N, V] },
    temporal: { as_of: AT, timezone: 'Europe/Rome', local_date: '2027-01-04', week_key: '2027-W01', next_temporal_invalidation_at: NEXT },
    coverage: { complete: true, catalog: 'FULL_APP_CATALOG', personal_person_ids: [N, V], group_id: G, nights: 'ALL_SELECTED_GROUP',
      participants: 'ALL_RETURNED_NIGHTS', veto_week_key: '2027-W01', versions: 'COVERED_SCOPES_AND_RETAINED_MARKERS', counts: {} },
    catalog: contents.map(content), people: [{ person_id: N, legacy_person: 'N', personal_readable: true }, { person_id: V, legacy_person: 'V', personal_readable: true }],
    personal: [N, V].map(person_id => ({ person_id, states: contents.map(personalState), collections: { list_movie_ids: [], seen_movie_ids: [] } })),
    group: { states: contents.map(groupState), collections: { list_movie_ids: [], scheduled_night_ids: [], together_movie_ids: [], rewatch_movie_ids: [] }, judgments: [] },
    nights: [], participants: [], exposure: [], vetoes: [], versions: { defaults: { person_film: '0', group_film: '0', content: '0', night: null }, entries: [], unavailable_night_ids: [] },
    payload_signature: { algorithm: 'sha256-pg-jsonb-text-v1', value: 'a'.repeat(64) } };
}
// This factory utility maintains wire bookkeeping only, never runs application code.
function finish(s) {
  const order = (a, key) => a.sort((x, y) => compare(key(x), key(y)));
  order(s.catalog, x => x.movie_id); order(s.people, x => x.person_id); order(s.personal, x => x.person_id);
  order(s.nights, x => x.night_id); order(s.group.states, x => x.movie_id); order(s.group.judgments, x => x.movie_id);
  order(s.participants, x => x.night_id + '|' + x.person_id); order(s.exposure, x => x.person_id + '|' + x.movie_id); order(s.vetoes, x => x.veto_id);
  order(s.versions.entries, x => x.scope_kind + '|' + x.scope_id + '|' + x.entity_id);
  s.selected_group.member_person_ids = s.people.filter(x => x.personal_readable).map(x => x.person_id);
  s.coverage.personal_person_ids = [...s.selected_group.member_person_ids];
  for (const p of s.personal) {
    order(p.states, x => x.movie_id);
    p.collections = { list_movie_ids: p.states.filter(x => x.list.active).map(x => x.movie_id), seen_movie_ids: p.states.filter(x => x.seen === true).map(x => x.movie_id) };
  }
  const byMovie = new Map(s.group.states.map(x => [x.movie_id, x]));
  for (const x of s.group.states) { x.active_night_ids = []; x.completed_night_ids = []; }
  for (const n of s.nights) {
    const row = byMovie.get(n.movie_id);
    if (['proposed', 'confirmed'].includes(n.status)) row.active_night_ids.push(n.night_id);
    if (n.status === 'completed') row.completed_night_ids.push(n.night_id);
  }
  s.group.collections = { list_movie_ids: s.group.states.filter(x => x.list_visible).map(x => x.movie_id),
    scheduled_night_ids: s.nights.filter(x => ['proposed', 'confirmed'].includes(x.status)).map(x => x.night_id),
    together_movie_ids: s.group.states.filter(x => x.completed_night_ids.length).map(x => x.movie_id),
    rewatch_movie_ids: s.group.states.filter(x => x.rewatch_visible).map(x => x.movie_id) };
  const nightVersions = new Set(s.versions.entries.filter(x => x.scope_kind === 'night').map(x => x.entity_id));
  s.versions.unavailable_night_ids = s.nights.filter(x => !nightVersions.has(x.night_id)).map(x => x.night_id);
  s.coverage.counts = { catalog: s.catalog.length, people: s.people.length, personal_views: s.personal.length,
    personal_states: s.personal.reduce((n, p) => n + p.states.length, 0), group_states: s.group.states.length,
    group_judgments: s.group.judgments.length, nights: s.nights.length, participants: s.participants.length, exposure: s.exposure.length,
    vetoes: s.vetoes.length, version_entries: s.versions.entries.length, night_tokens_unavailable: s.versions.unavailable_night_ids.length };
  return s;
}
const relationless = () => finish(base());
function selfList() {
  const s = base(); s.personal[0].states[0].list = { active: true, generation: '1' };
  s.versions.entries.push(version('person_film', N, M)); return finish(s);
}
function otherList() {
  const s = base(); s.personal[1].states[0].list = { active: true, generation: null };
  s.versions.entries.push(version('person_film', V, M)); return finish(s);
}
function candidate() {
  const s = base(); Object.assign(s.group.states[0], { effective_candidacy: true, list_visible: true,
    eligibility: { match_base: true, ruota_base: true } });
  s.versions.entries.push(version('group_film', G, M)); return finish(s);
}
function scheduled() {
  const s = selfList(); s.nights.push(night()); s.group.states[0].effective_candidacy = true;
  s.versions.entries.push(version('group_film', G, M), version('night', G, NIGHT)); return finish(s);
}
function completed() {
  const s = base(); s.nights.push(night(NIGHT, M, 'completed'));
  s.participants.push({ night_id: NIGHT, person_id: N }, { night_id: NIGHT, person_id: V });
  s.exposure.push(...[N, V].map(person_id => ({ person_id, movie_id: M, sources: ['SELECTED_GROUP_TOGETHER'] })));
  s.versions.entries.push(version('night', G, NIGHT, '2')); return finish(s);
}
function partialParticipants() {
  const s = completed(); s.participants = s.participants.filter(x => x.person_id === N); s.exposure = s.exposure.filter(x => x.person_id === N); return finish(s);
}
function rewatch() {
  const s = base(); for (const p of s.personal) p.states[0].seen = true;
  s.group.states[0].rewatch_semantic = true; s.group.states[0].rewatch_visible = true;
  s.exposure = [N, V].map(person_id => ({ person_id, movie_id: M, sources: ['PERSONAL_SEEN'] })); return finish(s);
}
function tombstones() {
  const s = base(), missing = uid(900001);
  s.versions.entries = [version('content', missing, missing, '7', true), version('person_film', N, missing, '8', true),
    version('group_film', G, missing, '9', true), version('night', G, missing, '10', true)]; return finish(s);
}
function legacyNight() { const s = base(); s.nights.push(night()); return finish(s); }
function largeDecimals() {
  const s = selfList(); s.personal[0].states[0].list.generation = '9007199254740993';
  s.versions.entries[0].version = '9223372036854775807'; s.catalog[0].tmdb_id = '9007199254740993'; s.catalog[0].collection_id = '-9223372036854775808'; return finish(s);
}
const emptyCatalog = () => finish(base([]));
function multipleEvents() {
  const s = completed(); s.nights.push(night(uid(20002)), night(uid(20003), M, 'completed'));
  s.participants.push({ night_id: uid(20003), person_id: N }); return finish(s);
}
const serverError = code => ({ contract_version: 1, outcome: 'ERROR', error: { code } });
function scale({ people = 2, contents = 2000, nights = 500 } = {}) {
  if (people !== 2 || !Number.isSafeInteger(contents) || !Number.isSafeInteger(nights) || contents < 1 || nights < 0) throw new TypeError('Synthetic P=2 scale required');
  const s = base(Array.from({ length: contents }, (_, i) => uid(100000 + i)));
  for (let i = 0; i < contents; i++) {
    const m = s.catalog[i].movie_id;
    s.catalog[i].genres = ['Synthetic Drama', null]; s.catalog[i].overview = 'Synthetic text '.repeat(5);
    if (i % 3 === 0) { s.personal[0].states[i].list = { active: true, generation: '9007199254740993' };
      s.versions.entries.push(version('person_film', N, m, '9007199254740994')); }
    if (i % 5 === 0) { s.personal[1].states[i].judgment.preference = false; s.versions.entries.push(version('person_film', V, m)); }
    if (i % 7 === 0) { s.group.states[i].effective_candidacy = true; s.group.states[i].list_visible = true; s.versions.entries.push(version('group_film', G, m)); }
  }
  for (let i = 0; i < nights; i++) {
    const m = s.catalog[i % contents].movie_id, n = uid(20000 + i), status = i % 2 === 0 ? 'completed' : 'confirmed';
    s.nights.push(night(n, m, status)); s.group.states[i % contents].list_visible = false;
    s.versions.entries.push(version('night', G, n));
    if (status === 'completed') { s.participants.push({ night_id: n, person_id: N }); }
  }
  // One sparse exposure row per person/movie, even with repeated events.
  const seen = new Set();
  for (const n of s.nights) if (n.status === 'completed' && !seen.has(n.movie_id)) {
    seen.add(n.movie_id); s.exposure.push({ person_id: N, movie_id: n.movie_id, sources: ['SELECTED_GROUP_TOGETHER'] });
  }
  return finish(s);
}
module.exports = Object.freeze({ uid, N, V, H, G, M, Q, NIGHT, AT, NEXT, context, content, personalState, groupState, night,
  version, base, finish, relationless, selfList, otherList, candidate, scheduled, completed, partialParticipants, rewatch,
  tombstones, legacyNight, largeDecimals, emptyCatalog, multipleEvents, serverError, scale });
