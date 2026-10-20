'use strict';
// Phase 3B1: pure, isolated Snapshot v1 primitives. Not loaded by the application.
// The document is authoritative; all lookup structures are private derivatives.
const SnapshotCore = (() => {
  const MAX = '9223372036854775807';
  const MIN_MAGNITUDE = '9223372036854775808';
  const KINDS = ['content', 'group_film', 'night', 'person_film'];
  const ERRORS = ['UNAUTHENTICATED', 'FORBIDDEN', 'INVALID_GROUP', 'UNSUPPORTED_CONTRACT',
    'UNSUPPORTED_GROUP', 'FOUNDATION_NOT_READY', 'SNAPSHOT_DATA_INVALID', 'SNAPSHOT_TOO_LARGE'];
  const ROOT = ['contract_version', 'outcome', 'caller', 'selected_group', 'temporal', 'coverage',
    'catalog', 'people', 'personal', 'group', 'nights', 'participants', 'exposure', 'vetoes', 'versions', 'payload_signature'];
  const COUNTS = ['catalog', 'people', 'personal_views', 'personal_states', 'group_states', 'group_judgments',
    'nights', 'participants', 'exposure', 'vetoes', 'version_entries', 'night_tokens_unavailable'];
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const decimalCmp = (a, b) => cmp(a.length, b.length) || cmp(a, b);
  const ptr = (p, k) => p + '/' + String(k).replace(/~/g, '~0').replace(/\//g, '~1');
  class Issue extends Error {
    constructor(code, path) { super(code); this.code = code; this.path = path; }
  }
  const fail = (code, path) => { throw new Issue(code, path); };
  const ensure = (condition, code, path) => { if (!condition) fail(code, path); };
  const frozen = x => Object.freeze(x);
  const errorValue = e => frozen({ code: e.code, path: e.path });
  function result(fn) {
    try { return frozen({ ok: true, value: fn() }); }
    catch (e) { if (!(e instanceof Issue)) throw e; return frozen({ ok: false, error: errorValue(e) }); }
  }
  function plain(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
    const p = Object.getPrototypeOf(x);
    return p === null || (Object.getPrototypeOf(p) === null &&
      Object.getOwnPropertyDescriptor(p, 'constructor')?.value?.name === 'Object');
  }
  function object(x, keys, path) {
    ensure(plain(x), 'OBJECT_REQUIRED', path);
    const allowed = new Set(keys);
    for (const k of Reflect.ownKeys(x)) {
      ensure(typeof k === 'string' && allowed.has(k), 'UNKNOWN_KEY', typeof k === 'string' ? ptr(path, k) : path);
      const d = Object.getOwnPropertyDescriptor(x, k);
      ensure(d.enumerable && Object.hasOwn(d, 'value'), 'JSON_DATA_PROPERTY_REQUIRED', ptr(path, k));
    }
    for (const k of keys) ensure(Object.hasOwn(x, k), 'REQUIRED_KEY', ptr(path, k));
  }
  function ownedJSON(x, path = '', ancestors = new WeakSet()) {
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return x;
    if (typeof x === 'number') { ensure(Number.isFinite(x), 'JSON_NUMBER_REQUIRED', path); return x; }
    ensure(Array.isArray(x) || plain(x), 'JSON_VALUE_REQUIRED', path);
    ensure(!ancestors.has(x), 'CYCLIC_INPUT', path); ancestors.add(x);
    const out = Array.isArray(x) ? [] : {};
    if (Array.isArray(x)) {
      ensure(Reflect.ownKeys(x).length === x.length + 1, 'DENSE_JSON_ARRAY_REQUIRED', path);
      for (let i = 0; i < x.length; i++) {
        const d = Object.getOwnPropertyDescriptor(x, String(i));
        ensure(d && d.enumerable && Object.hasOwn(d, 'value'), 'JSON_DATA_PROPERTY_REQUIRED', ptr(path, i));
        out.push(ownedJSON(d.value, ptr(path, i), ancestors));
      }
    } else {
      for (const k of Reflect.ownKeys(x)) {
        ensure(typeof k === 'string', 'JSON_KEY_REQUIRED', path);
        const d = Object.getOwnPropertyDescriptor(x, k);
        ensure(d.enumerable && Object.hasOwn(d, 'value'), 'JSON_DATA_PROPERTY_REQUIRED', ptr(path, k));
        Object.defineProperty(out, k, { value: ownedJSON(d.value, ptr(path, k), ancestors), enumerable: true, writable: true, configurable: true });
      }
    }
    ancestors.delete(x); return out;
  }
  function deepFreeze(x) {
    if (x && typeof x === 'object' && !Object.isFrozen(x)) { for (const value of Object.values(x)) deepFreeze(value); frozen(x); }
    return x;
  }
  const str = (x, p) => ensure(typeof x === 'string', 'STRING_REQUIRED', p);
  const bool = (x, p) => ensure(typeof x === 'boolean', 'BOOLEAN_REQUIRED', p);
  const nullable = (fn, x, p) => { if (x !== null) fn(x, p); };
  const integer = (x, p, min = 0, max = Number.MAX_SAFE_INTEGER) =>
    ensure(Number.isSafeInteger(x) && x >= min && x <= max, 'INTEGER_RANGE', p);
  const literal = (x, expected, p) => ensure(x === expected, 'LITERAL_MISMATCH', p);
  function uuid(x, p) {
    ensure(typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x), 'UUID_REQUIRED', p);
  }
  function decimal(x, p) {
    ensure(typeof x === 'string' && /^(0|[1-9][0-9]*)$/.test(x) && decimalCmp(x, MAX) <= 0, 'DECIMAL_REQUIRED', p);
  }
  function metadata(x, p) {
    if (x === null) return;
    ensure(typeof x === 'string' && /^(0|-?[1-9][0-9]*)$/.test(x), 'METADATA_DECIMAL_REQUIRED', p);
    const negative = x.startsWith('-');
    ensure(decimalCmp(negative ? x.slice(1) : x, negative ? MIN_MAGNITUDE : MAX) <= 0, 'METADATA_DECIMAL_RANGE', p);
  }
  function exactRevision(x, p) {
    if (typeof x === 'number') {
      ensure(Number.isSafeInteger(x) && x >= 0, 'UNSAFE_REVISION_NUMBER', p);
      x = String(x); // Only after proving exact integer representation.
    }
    decimal(x, p); return x;
  }
  function date(x, p) {
    ensure(typeof x === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x), 'DATE_REQUIRED', p);
    const y = Number(x.slice(0, 4)), m = Number(x.slice(5, 7)), d = Number(x.slice(8, 10));
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    ensure(y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1], 'DATE_RANGE', p);
  }
  function instant(x, p) {
    ensure(typeof x === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(x), 'INSTANT_REQUIRED', p);
    date(x.slice(0, 10), p);
    ensure(Number(x.slice(11, 13)) <= 23 && Number(x.slice(14, 16)) <= 59 && Number(x.slice(17, 19)) <= 59, 'INSTANT_RANGE', p);
  }
  function week(x, p) { ensure(typeof x === 'string' && /^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/.test(x), 'WEEK_REQUIRED', p); }
  function rating(x, p) {
    if (x !== null) ensure(typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 10 && x === Math.round(x * 10) / 10, 'RATING_REQUIRED', p);
  }
  function array(x, p, fn) {
    ensure(Array.isArray(x), 'ARRAY_REQUIRED', p);
    // JSON-like arrays contain only dense, own, enumerable data elements.
    ensure(Reflect.ownKeys(x).length === x.length + 1, 'DENSE_JSON_ARRAY_REQUIRED', p);
    for (let i = 0; i < x.length; i++) {
      const d = Object.getOwnPropertyDescriptor(x, String(i));
      ensure(d && d.enumerable && Object.hasOwn(d, 'value'), 'JSON_DATA_PROPERTY_REQUIRED', ptr(p, i));
      fn(d.value, ptr(p, i));
    }
  }
  function ordered(x, key, p) {
    let previous;
    for (let i = 0; i < x.length; i++) {
      const k = key(x[i]);
      if (i) ensure(previous < k, previous === k ? 'DUPLICATE' : 'NON_CANONICAL_ORDER', ptr(p, i));
      previous = k;
    }
  }
  function ids(x, p) { array(x, p, uuid); ordered(x, v => v, p); }
  function equalIDs(actual, expected, p) {
    ensure(actual.length === expected.length && actual.every((x, i) => x === expected[i]), 'SET_MISMATCH', p);
  }
  const ref = (map, id, p) => ensure(map.has(id), 'BROKEN_REFERENCE', p);
  function context(x, p = '') {
    object(x, ['callerId', 'groupId', 'contractVersion', 'contextEpoch'], p);
    uuid(x.callerId, ptr(p, 'callerId')); uuid(x.groupId, ptr(p, 'groupId'));
    literal(x.contractVersion, 1, ptr(p, 'contractVersion')); integer(x.contextEpoch, ptr(p, 'contextEpoch'));
  }
  const sameIdentity = (a, b) => a.callerId === b.callerId && a.groupId === b.groupId && a.contractVersion === b.contractVersion;
  const sameContext = (a, b) => sameIdentity(a, b) && a.contextEpoch === b.contextEpoch;
  function judgment(x, p, personal) {
    object(x, personal ? ['rating', 'preference', 'review'] : ['movie_id', 'rating', 'review'], p);
    rating(x.rating, ptr(p, 'rating')); nullable(str, x.review, ptr(p, 'review'));
    if (personal) { nullable(bool, x.preference, ptr(p, 'preference')); ensure(x.rating === null || x.preference === null, 'JUDGMENT_EXCLUSIVITY', p); }
    else uuid(x.movie_id, ptr(p, 'movie_id'));
  }
  function validateDocument(s) {
    object(s.caller, ['person_id'], '/caller'); uuid(s.caller.person_id, '/caller/person_id');
    object(s.selected_group, ['group_id', 'member_person_ids'], '/selected_group');
    uuid(s.selected_group.group_id, '/selected_group/group_id'); ids(s.selected_group.member_person_ids, '/selected_group/member_person_ids');
    object(s.temporal, ['as_of', 'timezone', 'local_date', 'week_key', 'next_temporal_invalidation_at'], '/temporal');
    instant(s.temporal.as_of, '/temporal/as_of'); instant(s.temporal.next_temporal_invalidation_at, '/temporal/next_temporal_invalidation_at');
    literal(s.temporal.timezone, 'Europe/Rome', '/temporal/timezone'); date(s.temporal.local_date, '/temporal/local_date'); week(s.temporal.week_key, '/temporal/week_key');
    ensure(s.temporal.as_of < s.temporal.next_temporal_invalidation_at, 'TEMPORAL_INTERVAL', '/temporal');
    object(s.coverage, ['complete', 'catalog', 'personal_person_ids', 'group_id', 'nights', 'participants', 'veto_week_key', 'versions', 'counts'], '/coverage');
    for (const [k, v] of Object.entries({ complete: true, catalog: 'FULL_APP_CATALOG', group_id: s.selected_group.group_id,
      nights: 'ALL_SELECTED_GROUP', participants: 'ALL_RETURNED_NIGHTS', veto_week_key: s.temporal.week_key, versions: 'COVERED_SCOPES_AND_RETAINED_MARKERS' })) literal(s.coverage[k], v, '/coverage/' + k);
    ids(s.coverage.personal_person_ids, '/coverage/personal_person_ids');
    object(s.coverage.counts, COUNTS, '/coverage/counts'); for (const k of COUNTS) integer(s.coverage.counts[k], '/coverage/counts/' + k);
    array(s.catalog, '/catalog', (m, p) => {
      object(m, ['movie_id', 'title', 'added_by_person_id', 'created_at', 'duration', 'platform', 'poster', 'trailer_url', 'metadata_matched',
        'imdb_rating', 'rt_rating', 'metacritic_rating', 'tmdb_id', 'collection_id', 'collection_name', 'director', 'overview', 'release_year', 'genres', 'cast_names', 'cinema_watchlist', 'surprise_by_person_id'], p);
      uuid(m.movie_id, ptr(p, 'movie_id')); str(m.title, ptr(p, 'title'));
      for (const k of ['added_by_person_id', 'surprise_by_person_id']) nullable(uuid, m[k], ptr(p, k));
      nullable(instant, m.created_at, ptr(p, 'created_at')); nullable(bool, m.metadata_matched, ptr(p, 'metadata_matched')); bool(m.cinema_watchlist, ptr(p, 'cinema_watchlist'));
      for (const k of ['duration', 'platform', 'poster', 'trailer_url', 'imdb_rating', 'rt_rating', 'metacritic_rating', 'collection_name', 'director', 'overview']) nullable(str, m[k], ptr(p, k));
      for (const k of ['tmdb_id', 'collection_id']) metadata(m[k], ptr(p, k));
      if (m.release_year !== null) integer(m.release_year, ptr(p, 'release_year'), -2147483648, 2147483647);
      for (const k of ['genres', 'cast_names']) if (m[k] !== null) array(m[k], ptr(p, k), (v, q) => nullable(str, v, q));
    }); ordered(s.catalog, x => x.movie_id, '/catalog');
    array(s.people, '/people', (x, p) => { object(x, ['person_id', 'legacy_person', 'personal_readable'], p); uuid(x.person_id, ptr(p, 'person_id')); ensure([null, 'N', 'V'].includes(x.legacy_person), 'LEGACY_PERSON', ptr(p, 'legacy_person')); bool(x.personal_readable, ptr(p, 'personal_readable')); });
    ordered(s.people, x => x.person_id, '/people');
    array(s.personal, '/personal', (x, p) => {
      object(x, ['person_id', 'states', 'collections'], p); uuid(x.person_id, ptr(p, 'person_id'));
      array(x.states, ptr(p, 'states'), (v, q) => {
        object(v, ['movie_id', 'seen', 'list', 'judgment'], q); uuid(v.movie_id, ptr(q, 'movie_id')); nullable(bool, v.seen, ptr(q, 'seen'));
        object(v.list, ['active', 'generation'], ptr(q, 'list')); bool(v.list.active, ptr(q, 'list/active'));
        nullable(decimal, v.list.generation, ptr(q, 'list/generation'));
        if (x.person_id !== s.caller.person_id) literal(v.list.generation, null, ptr(q, 'list/generation'));
        else if (v.list.active) ensure(v.list.generation !== null && v.list.generation !== '0', 'ACTIVE_GENERATION_REQUIRED', ptr(q, 'list/generation'));
        if (v.judgment !== null) judgment(v.judgment, ptr(q, 'judgment'), true);
      }); ordered(x.states, v => v.movie_id, ptr(p, 'states'));
      object(x.collections, ['list_movie_ids', 'seen_movie_ids'], ptr(p, 'collections'));
      ids(x.collections.list_movie_ids, ptr(p, 'collections/list_movie_ids')); ids(x.collections.seen_movie_ids, ptr(p, 'collections/seen_movie_ids'));
    }); ordered(s.personal, x => x.person_id, '/personal');
    object(s.group, ['states', 'collections', 'judgments'], '/group');
    array(s.group.states, '/group/states', (x, p) => {
      object(x, ['movie_id', 'effective_candidacy', 'list_visible', 'active_night_ids', 'completed_night_ids', 'rewatch_semantic', 'rewatch_visible', 'eligibility'], p);
      uuid(x.movie_id, ptr(p, 'movie_id')); for (const k of ['effective_candidacy', 'list_visible', 'rewatch_visible']) bool(x[k], ptr(p, k));
      nullable(bool, x.rewatch_semantic, ptr(p, 'rewatch_semantic')); ids(x.active_night_ids, ptr(p, 'active_night_ids')); ids(x.completed_night_ids, ptr(p, 'completed_night_ids'));
      object(x.eligibility, ['match_base', 'ruota_base'], ptr(p, 'eligibility')); bool(x.eligibility.match_base, ptr(p, 'eligibility/match_base')); bool(x.eligibility.ruota_base, ptr(p, 'eligibility/ruota_base'));
    }); ordered(s.group.states, x => x.movie_id, '/group/states');
    object(s.group.collections, ['list_movie_ids', 'scheduled_night_ids', 'together_movie_ids', 'rewatch_movie_ids'], '/group/collections');
    for (const k of Object.keys(s.group.collections)) ids(s.group.collections[k], '/group/collections/' + k);
    array(s.group.judgments, '/group/judgments', (x, p) => { judgment(x, p, false); ensure(x.rating !== null || x.review !== null, 'EMPTY_GROUP_JUDGMENT', p); }); ordered(s.group.judgments, x => x.movie_id, '/group/judgments');
    array(s.nights, '/nights', (x, p) => {
      object(x, ['night_id', 'movie_id', 'status', 'date', 'time', 'snack', 'location', 'proposed_by_person_id', 'created_at', 'confirmed_at', 'cancelled_at', 'completed_at'], p);
      uuid(x.night_id, ptr(p, 'night_id')); uuid(x.movie_id, ptr(p, 'movie_id')); nullable(uuid, x.proposed_by_person_id, ptr(p, 'proposed_by_person_id'));
      ensure(['proposed', 'confirmed', 'cancelled', 'completed', 'skipped'].includes(x.status), 'NIGHT_STATUS', ptr(p, 'status'));
      // Legacy calendar strings are opaque here: no conversion or normalization.
      for (const k of ['date', 'time', 'snack', 'location']) nullable(str, x[k], ptr(p, k));
      for (const k of ['created_at', 'confirmed_at', 'cancelled_at', 'completed_at']) nullable(instant, x[k], ptr(p, k));
    }); ordered(s.nights, x => x.night_id, '/nights');
    array(s.participants, '/participants', (x, p) => { object(x, ['night_id', 'person_id'], p); uuid(x.night_id, ptr(p, 'night_id')); uuid(x.person_id, ptr(p, 'person_id')); }); ordered(s.participants, x => x.night_id + '|' + x.person_id, '/participants');
    array(s.exposure, '/exposure', (x, p) => {
      object(x, ['person_id', 'movie_id', 'sources'], p); uuid(x.person_id, ptr(p, 'person_id')); uuid(x.movie_id, ptr(p, 'movie_id'));
      array(x.sources, ptr(p, 'sources'), (v, q) => ensure(['PERSONAL_SEEN', 'SELECTED_GROUP_TOGETHER'].includes(v), 'EXPOSURE_SOURCE', q));
      ensure(x.sources.length > 0, 'EXPOSURE_SOURCE_REQUIRED', ptr(p, 'sources')); ordered(x.sources, v => v, ptr(p, 'sources'));
    }); ordered(s.exposure, x => x.person_id + '|' + x.movie_id, '/exposure');
    array(s.vetoes, '/vetoes', (x, p) => { object(x, ['veto_id', 'person_id', 'movie_id', 'week_key'], p); for (const k of ['veto_id', 'person_id', 'movie_id']) uuid(x[k], ptr(p, k)); literal(x.week_key, s.temporal.week_key, ptr(p, 'week_key')); }); ordered(s.vetoes, x => x.veto_id, '/vetoes');
    object(s.versions, ['defaults', 'entries', 'unavailable_night_ids'], '/versions'); object(s.versions.defaults, KINDS, '/versions/defaults');
    for (const k of KINDS) literal(s.versions.defaults[k], k === 'night' ? null : '0', '/versions/defaults/' + k);
    array(s.versions.entries, '/versions/entries', (x, p) => {
      object(x, ['scope_kind', 'scope_id', 'entity_id', 'version', 'tombstone'], p); ensure(KINDS.includes(x.scope_kind), 'SCOPE_KIND', ptr(p, 'scope_kind'));
      uuid(x.scope_id, ptr(p, 'scope_id')); uuid(x.entity_id, ptr(p, 'entity_id')); decimal(x.version, ptr(p, 'version')); bool(x.tombstone, ptr(p, 'tombstone'));
      if (x.scope_kind === 'night') ensure(x.version !== '0', 'NIGHT_VERSION_REQUIRED', ptr(p, 'version'));
    }); ordered(s.versions.entries, tupleKey, '/versions/entries'); ids(s.versions.unavailable_night_ids, '/versions/unavailable_night_ids');
    object(s.payload_signature, ['algorithm', 'value'], '/payload_signature'); literal(s.payload_signature.algorithm, 'sha256-pg-jsonb-text-v1', '/payload_signature/algorithm');
    ensure(typeof s.payload_signature.value === 'string' && /^[0-9a-f]{64}$/.test(s.payload_signature.value), 'SIGNATURE_REQUIRED', '/payload_signature/value');
  }
  const tupleKey = x => x.scope_kind + '|' + x.scope_id + '|' + x.entity_id;
  function buildIndexes(s) {
    const content = new Map(s.catalog.map(x => [x.movie_id, x])), people = new Map(s.people.map(x => [x.person_id, x]));
    const personal = new Map(), personViews = new Map(), groups = new Map(s.group.states.map(x => [x.movie_id, x]));
    const nights = new Map(s.nights.map(x => [x.night_id, x])), participants = new Map(), active = new Map(), completed = new Map();
    const exposure = new Map(), vetoes = new Map(), vetoPersonWeek = new Set(), judgments = new Map(), versions = new Map();
    const readable = new Set(s.coverage.personal_person_ids), unavailable = new Set(s.versions.unavailable_night_ids);
    const catalogIDs = s.catalog.map(x => x.movie_id);
    equalIDs(s.selected_group.member_person_ids, s.coverage.personal_person_ids, '/selected_group/member_person_ids');
    equalIDs(s.people.filter(x => x.personal_readable).map(x => x.person_id), s.coverage.personal_person_ids, '/people');
    equalIDs(s.personal.map(x => x.person_id), s.coverage.personal_person_ids, '/personal');
    ensure(readable.has(s.caller.person_id), 'CALLER_OUT_OF_COVERAGE', '/caller/person_id');
    const tags = new Set();
    for (const p of s.people) if (p.legacy_person !== null) { ensure(!tags.has(p.legacy_person), 'DUPLICATE_LEGACY_MAPPING', '/people'); tags.add(p.legacy_person); }
    for (const m of s.catalog) for (const k of ['added_by_person_id', 'surprise_by_person_id']) if (m[k] !== null) ref(people, m[k], '/catalog/' + k);
    for (const p of s.personal) {
      ref(people, p.person_id, '/personal/person_id'); personViews.set(p.person_id, p);
      equalIDs(p.states.map(x => x.movie_id), catalogIDs, '/personal/states');
      personal.set(p.person_id, new Map(p.states.map(x => [x.movie_id, x])));
      equalIDs(p.collections.list_movie_ids, p.states.filter(x => x.list.active).map(x => x.movie_id), '/personal/collections/list_movie_ids');
      equalIDs(p.collections.seen_movie_ids, p.states.filter(x => x.seen === true).map(x => x.movie_id), '/personal/collections/seen_movie_ids');
    }
    equalIDs(s.group.states.map(x => x.movie_id), catalogIDs, '/group/states');
    for (const n of s.nights) {
      ref(content, n.movie_id, '/nights/movie_id'); if (n.proposed_by_person_id !== null) ref(people, n.proposed_by_person_id, '/nights/proposed_by_person_id');
      participants.set(n.night_id, []);
      const bucket = ['proposed', 'confirmed'].includes(n.status) ? active : n.status === 'completed' ? completed : null;
      if (bucket) { if (!bucket.has(n.movie_id)) bucket.set(n.movie_id, []); bucket.get(n.movie_id).push(n.night_id); }
    }
    for (const p of s.participants) {
      ref(nights, p.night_id, '/participants/night_id'); ref(people, p.person_id, '/participants/person_id');
      ensure(nights.get(p.night_id).status === 'completed', 'PARTICIPANT_EVENT_STATE', '/participants'); participants.get(p.night_id).push(p);
    }
    for (const n of s.nights) {
      ensure(n.status !== 'completed' || participants.get(n.night_id).length > 0, 'PARTICIPANTS_REQUIRED', '/participants'); frozen(participants.get(n.night_id));
    }
    for (const g of s.group.states) {
      equalIDs(g.active_night_ids, active.get(g.movie_id) || [], '/group/states/active_night_ids');
      equalIDs(g.completed_night_ids, completed.get(g.movie_id) || [], '/group/states/completed_night_ids');
    }
    equalIDs(s.group.collections.list_movie_ids, s.group.states.filter(x => x.list_visible).map(x => x.movie_id), '/group/collections/list_movie_ids');
    equalIDs(s.group.collections.rewatch_movie_ids, s.group.states.filter(x => x.rewatch_visible).map(x => x.movie_id), '/group/collections/rewatch_movie_ids');
    equalIDs(s.group.collections.together_movie_ids, s.group.states.filter(x => x.completed_night_ids.length > 0).map(x => x.movie_id), '/group/collections/together_movie_ids');
    equalIDs(s.group.collections.scheduled_night_ids, s.nights.filter(x => ['proposed', 'confirmed'].includes(x.status)).map(x => x.night_id), '/group/collections/scheduled_night_ids');
    for (const x of s.exposure) {
      ref(people, x.person_id, '/exposure/person_id'); ref(content, x.movie_id, '/exposure/movie_id');
      if (!exposure.has(x.person_id)) exposure.set(x.person_id, new Map()); exposure.get(x.person_id).set(x.movie_id, x);
    }
    for (const v of s.vetoes) {
      ensure(readable.has(v.person_id), 'VETO_OUT_OF_COVERAGE', '/vetoes/person_id'); ref(content, v.movie_id, '/vetoes/movie_id');
      const key = v.person_id + '|' + v.week_key; ensure(!vetoPersonWeek.has(key), 'DUPLICATE_VETO_PERSON_WEEK', '/vetoes'); vetoPersonWeek.add(key);
      if (!vetoes.has(v.movie_id)) vetoes.set(v.movie_id, v);
    }
    for (const x of s.group.judgments) { ref(content, x.movie_id, '/group/judgments/movie_id'); judgments.set(x.movie_id, x); }
    const authorizedScope = (k, scope, entity) => k === 'content' ? scope === entity : k === 'person_film' ? readable.has(scope) : scope === s.selected_group.group_id;
    for (const v of s.versions.entries) {
      ensure(authorizedScope(v.scope_kind, v.scope_id, v.entity_id), 'VERSION_SCOPE', '/versions/entries');
      const exists = v.scope_kind === 'night' ? nights.has(v.entity_id) : content.has(v.entity_id);
      ensure(v.tombstone ? !exists : exists, 'VERSION_ENTITY', '/versions/entries'); versions.set(tupleKey(v), v);
    }
    equalIDs(s.versions.unavailable_night_ids, s.nights.filter(n => !versions.has(tupleKey({ scope_kind: 'night', scope_id: s.selected_group.group_id, entity_id: n.night_id }))).map(n => n.night_id), '/versions/unavailable_night_ids');
    const actual = { catalog: s.catalog.length, people: s.people.length, personal_views: s.personal.length,
      personal_states: s.personal.reduce((sum, p) => sum + p.states.length, 0), group_states: s.group.states.length,
      group_judgments: s.group.judgments.length, nights: s.nights.length, participants: s.participants.length, exposure: s.exposure.length,
      vetoes: s.vetoes.length, version_entries: s.versions.entries.length, night_tokens_unavailable: s.versions.unavailable_night_ids.length };
    for (const k of COUNTS) literal(s.coverage.counts[k], actual[k], '/coverage/counts/' + k);
    const missing = frozen({ kind: 'OUT_OF_COVERAGE' }), zero = frozen({ kind: 'DEFAULT_ZERO', version: '0' }), noToken = frozen({ kind: 'UNAVAILABLE' });
    function getVersion(k, scope, entity) {
      queryTuple(k, scope, entity);
      const v = versions.get(tupleKey({ scope_kind: k, scope_id: scope, entity_id: entity }));
      if (v) return frozen({ kind: v.tombstone ? 'TOMBSTONED' : 'AVAILABLE', version: v.version });
      if (!authorizedScope(k, scope, entity)) return missing;
      if (k === 'night') return nights.has(entity) && unavailable.has(entity) ? noToken : missing;
      return content.has(entity) ? zero : missing;
    }
    const get = (map, id) => { queryUUID(id); return map.get(id) || null; };
    return frozen({
      getContent: id => get(content, id), getPerson: id => get(people, id), getPersonalView: id => get(personViews, id),
      getPersonalState: (p, m) => { queryUUID(p); queryUUID(m); return personal.get(p)?.get(m) || null; },
      getGroupState: id => get(groups, id), getNight: id => get(nights, id), getParticipants: id => get(participants, id),
      getExposure: (p, m) => { queryUUID(p); queryUUID(m); return exposure.get(p)?.get(m) || null; },
      hasExposure: (p, m) => { queryUUID(p); queryUUID(m); return people.has(p) && content.has(m) ? !!exposure.get(p)?.has(m) : null; },
      getGroupJudgment: id => get(judgments, id), getVetoForMovie: id => get(vetoes, id), getExpectedRevision: getVersion
    });
  }
  function queryUUID(x) { if (!result(() => uuid(x, '')).ok) throw new TypeError('Canonical UUID query required'); }
  function queryTuple(k, s, e) { if (!KINDS.includes(k)) throw new TypeError('Known scope required'); queryUUID(s); queryUUID(e); }
  function requireRoot(root) {
    if (!root || !root.snapshot || !root.context || !root.indexes ||
      ![root, root.snapshot, root.context, root.indexes].every(Object.isFrozen)) throw new TypeError('Decoded immutable root required');
    return root;
  }
  function decodeSnapshotEnvelope(raw, expectedContext) {
    try {
      context(expectedContext, '/expectedContext');
      ensure(plain(raw), 'OBJECT_REQUIRED', '');
      const outcome = Object.getOwnPropertyDescriptor(raw, 'outcome');
      ensure(outcome && Object.hasOwn(outcome, 'value'), 'OUTCOME_REQUIRED', '/outcome');
      object(raw, outcome.value === 'ERROR' ? ['contract_version', 'outcome', 'error'] : ROOT, '');
      const s = ownedJSON(raw); literal(s.contract_version, 1, '/contract_version');
      if (s.outcome === 'ERROR') {
        object(s.error, ['code'], '/error'); ensure(ERRORS.includes(s.error.code), 'SERVER_ERROR_CODE', '/error/code');
        return frozen({ kind: 'SERVER_ERROR', code: s.error.code });
      }
      literal(s.outcome, 'OK', '/outcome'); validateDocument(s);
      if (s.caller.person_id !== expectedContext.callerId || s.selected_group.group_id !== expectedContext.groupId) return frozen({ kind: 'CONTEXT_MISMATCH' });
      const indexes = buildIndexes(s); deepFreeze(s);
      return frozen({ kind: 'DECODED_SNAPSHOT', candidate: frozen({ snapshot: s, context: frozen({ ...expectedContext }), indexes }) });
    } catch (e) { if (!(e instanceof Issue)) throw e; return frozen({ kind: 'INVALID', error: errorValue(e) }); }
  }
  function sameSemanticPayload(a, b) {
    requireRoot(a); requireRoot(b);
    return !sameIdentity(a.context, b.context) ? 'NOT_COMPARABLE' : a.snapshot.payload_signature.value === b.snapshot.payload_signature.value ? 'SAME' : 'DIFFERENT';
  }
  const known = v => ['AVAILABLE', 'DEFAULT_ZERO', 'TOMBSTONED'].includes(v.kind);
  function compareSnapshotVersions(current, candidate) {
    requireRoot(current); requireRoot(candidate);
    const comparable = sameIdentity(current.context, candidate.context), regressions = [], authorityLost = [], contradictions = [];
    if (comparable) for (const v of current.snapshot.versions.entries) {
      const next = candidate.indexes.getExpectedRevision(v.scope_kind, v.scope_id, v.entity_id);
      const tuple = { scope_kind: v.scope_kind, scope_id: v.scope_id, entity_id: v.entity_id };
      if (next.kind === 'UNAVAILABLE' && v.scope_kind === 'night') authorityLost.push(tuple);
      if (known(next)) {
        const c = decimalCmp(next.version, v.version);
        if (c < 0) regressions.push(tuple);
        else if (c === 0 && v.tombstone !== (next.kind === 'TOMBSTONED')) contradictions.push(tuple);
      }
    }
    // An implicit covered baseline is still revision 0, not permission to
    // introduce a different tombstone state at the very same revision.
    if (comparable) for (const v of candidate.snapshot.versions.entries) {
      if (!v.tombstone || v.version !== '0') continue;
      const old = current.indexes.getExpectedRevision(v.scope_kind, v.scope_id, v.entity_id);
      if (old.kind === 'DEFAULT_ZERO') contradictions.push({ scope_kind: v.scope_kind, scope_id: v.scope_id, entity_id: v.entity_id });
    }
    const sameIDs = (a, b, key) => a.length === b.length && a.every((x, i) => key(x) === key(b[i]));
    return deepFreeze({ comparable, regressions, authorityLost, contradictions,
      coverageChanged: comparable && (!sameIDs(current.snapshot.coverage.personal_person_ids, candidate.snapshot.coverage.personal_person_ids, x => x) ||
        !sameIDs(current.snapshot.catalog, candidate.snapshot.catalog, x => x.movie_id) ||
        !sameIDs(current.snapshot.nights, candidate.snapshot.nights, x => x.night_id)) });
  }
  function normalizeAffectedVersions(ctx, entries) {
    return result(() => {
      context(ctx, '/context'); const byTuple = new Map();
      array(entries, '/affected_versions', (x, p) => {
        object(x, ['scope_kind', 'scope_id', 'entity_id', 'version'], p);
        ensure(KINDS.includes(x.scope_kind), 'SCOPE_KIND', ptr(p, 'scope_kind')); uuid(x.scope_id, ptr(p, 'scope_id')); uuid(x.entity_id, ptr(p, 'entity_id'));
        ensure(x.scope_kind !== 'content' || x.scope_id === x.entity_id, 'CONTENT_SCOPE', p);
        if (['group_film', 'night'].includes(x.scope_kind)) literal(x.scope_id, ctx.groupId, ptr(p, 'scope_id'));
        const version = exactRevision(x.version, ptr(p, 'version')), key = tupleKey(x), old = byTuple.get(key);
        if (!old || decimalCmp(version, old.minimum_version) > 0) byTuple.set(key, frozen({ scope_kind: x.scope_kind, scope_id: x.scope_id, entity_id: x.entity_id, minimum_version: version }));
      });
      return frozen({ context: frozen({ ...ctx }), entries: frozen([...byTuple.values()]) });
    });
  }
  function validateThresholds(t) {
    object(t, ['context', 'entries'], '/thresholds'); context(t.context, '/thresholds/context');
    const seen = new Set(); array(t.entries, '/thresholds/entries', (x, p) => {
      object(x, ['scope_kind', 'scope_id', 'entity_id', 'minimum_version'], p); ensure(KINDS.includes(x.scope_kind), 'SCOPE_KIND', p);
      uuid(x.scope_id, ptr(p, 'scope_id')); uuid(x.entity_id, ptr(p, 'entity_id')); decimal(x.minimum_version, ptr(p, 'minimum_version'));
      ensure(x.scope_kind !== 'content' || x.scope_id === x.entity_id, 'CONTENT_SCOPE', p);
      if (['group_film', 'night'].includes(x.scope_kind)) literal(x.scope_id, t.context.groupId, ptr(p, 'scope_id'));
      const key = tupleKey(x); ensure(!seen.has(key), 'DUPLICATE', p); seen.add(key);
    });
  }
  function mergeThresholds(left, right) {
    return result(() => {
      validateThresholds(left); validateThresholds(right); ensure(sameContext(left.context, right.context), 'THRESHOLD_CONTEXT', '/thresholds/context');
      const entries = [];
      for (const t of [left, right]) array(t.entries, '/thresholds/entries', x => {
        entries.push({ scope_kind: x.scope_kind, scope_id: x.scope_id, entity_id: x.entity_id, version: x.minimum_version });
      });
      const normalized = normalizeAffectedVersions(left.context, entries);
      if (!normalized.ok) fail(normalized.error.code, normalized.error.path); return normalized.value;
    });
  }
  function checkThresholds(candidate, thresholds) {
    return result(() => {
      requireRoot(candidate); validateThresholds(thresholds); ensure(sameContext(candidate.context, thresholds.context), 'THRESHOLD_CONTEXT', '/thresholds/context');
      const insufficient = [], unavailable = [], outOfCoverage = [];
      array(thresholds.entries, '/thresholds/entries', t => {
        const v = candidate.indexes.getExpectedRevision(t.scope_kind, t.scope_id, t.entity_id);
        if (v.kind === 'OUT_OF_COVERAGE') outOfCoverage.push({ ...t });
        else if (v.kind === 'UNAVAILABLE') unavailable.push({ ...t });
        else if (decimalCmp(v.version, t.minimum_version) < 0) insufficient.push({ ...t });
      });
      return deepFreeze({ satisfied: !insufficient.length && !unavailable.length && !outOfCoverage.length,
        insufficient, unavailable, outOfCoverage });
    });
  }
  function isSnapshotTemporallyCurrent(root, nowInstant) {
    return result(() => {
      requireRoot(root); instant(nowInstant, '/nowInstant'); const t = root.snapshot.temporal;
      return frozen(nowInstant < t.as_of ? { current: false, reason: 'CLOCK_BEFORE_AS_OF' } :
        nowInstant >= t.next_temporal_invalidation_at ? { current: false, reason: 'TEMPORAL_EXPIRED' } : { current: true, reason: null });
    });
  }
  function evaluateAcceptance(args) {
    const decision = (outcome, details = {}) => deepFreeze({ outcome, ...details });
    try {
      object(args, ['decoded', 'current', 'expectedContext', 'requestMeta', 'latestRequestSequence', 'thresholds', 'nowInstant'], '');
      const { decoded, current, expectedContext: ctx, requestMeta: request, latestRequestSequence: latest, thresholds, nowInstant } = args;
      context(ctx, '/expectedContext'); object(request, ['context', 'requestSequence'], '/requestMeta'); context(request.context, '/requestMeta/context');
      integer(request.requestSequence, '/requestMeta/requestSequence', 1); integer(latest, '/latestRequestSequence', 1);
      if (request.context.contextEpoch !== ctx.contextEpoch) return decision('DISCARD_OBSOLETE', { reason: 'EPOCH_CHANGED' });
      if (request.requestSequence !== latest) return decision('DISCARD_OBSOLETE', { reason: 'REQUEST_SUPERSEDED' });
      if (!sameIdentity(request.context, ctx)) return decision('DISCARD_CONTEXT', { reason: 'REQUEST_CONTEXT' });
      if (current !== null) {
        requireRoot(current);
        object(current.acceptance, ['requestSequence'], '/current/acceptance'); integer(current.acceptance.requestSequence, '/current/acceptance/requestSequence', 1);
        if (sameContext(current.context, ctx) && request.requestSequence <= current.acceptance.requestSequence) return decision('DISCARD_OBSOLETE', { reason: 'DUPLICATE_RESPONSE' });
      }
      ensure(plain(decoded), 'DECODE_RESULT_REQUIRED', '/decoded');
      const tag = Object.getOwnPropertyDescriptor(decoded, 'kind');
      ensure(tag && Object.hasOwn(tag, 'value'), 'DECODE_RESULT_REQUIRED', '/decoded/kind');
      const fields = { SERVER_ERROR: ['kind', 'code'], CONTEXT_MISMATCH: ['kind'], INVALID: ['kind', 'error'], DECODED_SNAPSHOT: ['kind', 'candidate'] };
      ensure(Object.hasOwn(fields, tag.value), 'DECODE_RESULT_REQUIRED', '/decoded/kind'); object(decoded, fields[tag.value], '/decoded');
      if (decoded.kind === 'SERVER_ERROR') { ensure(ERRORS.includes(decoded.code), 'SERVER_ERROR_CODE', '/decoded/code'); return decision('SERVER_ERROR', { code: decoded.code }); }
      if (decoded.kind === 'CONTEXT_MISMATCH') return decision('DISCARD_CONTEXT', { reason: 'PAYLOAD_CONTEXT' });
      if (decoded.kind === 'INVALID') {
        object(decoded.error, ['code', 'path'], '/decoded/error'); str(decoded.error.code, '/decoded/error/code'); str(decoded.error.path, '/decoded/error/path');
        return decision('CONTRACT_ERROR', { error: { code: decoded.error.code, path: decoded.error.path } });
      }
      ensure(decoded.kind === 'DECODED_SNAPSHOT', 'DECODE_RESULT_REQUIRED', '/decoded/kind');
      const candidate = requireRoot(decoded.candidate);
      if (!sameContext(candidate.context, ctx)) return decision('DISCARD_CONTEXT', { reason: 'CANDIDATE_CONTEXT' });
      if (current !== null) {
        const comparison = compareSnapshotVersions(current, candidate);
        if (comparison.contradictions.length) return decision('CONTRACT_ERROR', { reason: 'TOMBSTONE_CONTRADICTION', tuples: comparison.contradictions });
        if (comparison.regressions.length || comparison.authorityLost.length) return decision('DISCARD_VERSION_REGRESSION', { comparison });
      }
      if (thresholds !== null) {
        const checked = checkThresholds(candidate, thresholds);
        if (!checked.ok) return decision(checked.error.code === 'THRESHOLD_CONTEXT' ? 'DISCARD_CONTEXT' : 'CONTRACT_ERROR', { error: checked.error });
        if (checked.value.outOfCoverage.length) return decision('DISCARD_CONTEXT', { reason: 'THRESHOLD_OUT_OF_COVERAGE', thresholds: checked.value.outOfCoverage });
        if (!checked.value.satisfied) return decision('RETRY_THRESHOLD', { thresholds: checked.value });
      }
      const temporal = isSnapshotTemporallyCurrent(candidate, nowInstant);
      if (!temporal.ok) return decision('CONTRACT_ERROR', { error: temporal.error });
      if (!temporal.value.current) return decision('TEMPORALLY_STALE', { reason: temporal.value.reason });
      const nextRoot = frozen({ snapshot: candidate.snapshot, context: candidate.context, indexes: candidate.indexes,
        acceptance: frozen({ requestSequence: request.requestSequence }) });
      return decision('ACCEPT', { nextRoot, semanticChanged: current === null || sameSemanticPayload(current, candidate) !== 'SAME' });
    } catch (e) { if (!(e instanceof Issue)) throw e; return decision('CONTRACT_ERROR', { error: errorValue(e) }); }
  }
  const selectors = {};
  for (const name of ['getContent', 'getPerson', 'getPersonalView', 'getPersonalState', 'getGroupState', 'getNight', 'getParticipants',
    'getExposure', 'hasExposure', 'getGroupJudgment', 'getVetoForMovie', 'getExpectedRevision']) {
    selectors[name] = (root, ...ids) => requireRoot(root).indexes[name](...ids);
  }
  return frozen({
    createContext: x => result(() => { context(x); return frozen({ ...x }); }),
    validateUUID: x => result(() => { uuid(x, ''); return x; }),
    validateNonNegativeDecimal: x => result(() => { decimal(x, ''); return x; }),
    validateNullableDecimal: x => result(() => { nullable(decimal, x, ''); return x; }),
    validateMetadataIdentifierDecimal: x => result(() => { metadata(x, ''); return x; }),
    normalizeExactRevision: x => result(() => exactRevision(x, '')),
    compareDecimals: (a, b) => { if (!result(() => { decimal(a, ''); decimal(b, ''); }).ok) throw new TypeError('Validated Decimal required'); return decimalCmp(a, b); },
    decodeSnapshotEnvelope, ...selectors, sameSemanticPayload, compareSnapshotVersions,
    normalizeAffectedVersions, mergeThresholds, checkThresholds, isSnapshotTemporallyCurrent, evaluateAcceptance
  });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SnapshotCore;
