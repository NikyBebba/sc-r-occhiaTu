#!/usr/bin/env node
'use strict';
// Synthetic-only contract tests. No database, network, application config or data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const C = require('../js/snapshot/core');
const F = require('./fixtures/snapshot-v1.cjs');
const { N, V, H, G, M, Q, NIGHT, AT, NEXT, uid } = F;
const copy = x => JSON.parse(JSON.stringify(x));
let groups = 0, rejections = 0;
const test = (id, name, fn) => { fn(); groups++; console.log('PASS ' + id + ' ' + name); };
function decoded(raw = F.relationless(), ctx = F.context()) {
  const r = C.decodeSnapshotEnvelope(raw, ctx); assert.equal(r.kind, 'DECODED_SNAPSHOT', JSON.stringify(r)); return r;
}
function root(raw, ctx) {
  const d = decoded(raw, ctx), c = d.candidate.context;
  const a = assess(d, { expectedContext: c, requestMeta: { context: { ...c }, requestSequence: 1 }, nowInstant: d.candidate.snapshot.temporal.as_of });
  assert.equal(a.outcome, 'ACCEPT'); return a.nextRoot;
}
function reject(raw, code, ctx = F.context()) {
  const r = C.decodeSnapshotEnvelope(raw, ctx); assert.equal(r.kind, 'INVALID', JSON.stringify(r));
  if (code) assert.equal(r.error.code, code, JSON.stringify(r)); rejections++; return r;
}
function assess(d = decoded(), overrides = {}) {
  const ctx = F.context(), seq = (overrides.current?.acceptance?.requestSequence || 0) + 1;
  return C.evaluateAcceptance({ decoded: d, current: null, expectedContext: ctx,
    requestMeta: { context: { ...ctx }, requestSequence: seq }, latestRequestSequence: seq, thresholds: null,
    nowInstant: '2027-01-04T12:00:01.000000Z', ...overrides });
}
const thresholds = (entries, ctx = F.context()) => {
  const r = C.normalizeAffectedVersions(ctx, entries); assert(r.ok, JSON.stringify(r)); return r.value;
};
const affected = (kind = 'person_film', scope = N, entity = M, version = '1') => ({ scope_kind: kind, scope_id: scope, entity_id: entity, version });
function withVersion(value) { const s = F.selfList(); s.versions.entries[0].version = value; return s; }
function rich() {
  const s = F.scale({ contents: 8, nights: 4 });
  s.catalog[0].cast_names = ['Synthetic Actor', null]; s.catalog[0].tmdb_id = '123';
  s.catalog[0].added_by_person_id = N; s.catalog[0].surprise_by_person_id = V;
  s.group.judgments.push({ movie_id: s.catalog[0].movie_id, rating: 0, review: '' });
  s.vetoes.push({ veto_id: uid(60001), person_id: N, movie_id: s.catalog[0].movie_id, week_key: '2027-W01' });
  return F.finish(s);
}
function objectPaths(x, prefix = []) {
  if (!x || typeof x !== 'object') return [];
  const paths = Array.isArray(x) ? [] : [prefix];
  for (const [k, value] of Object.entries(x)) paths.push(...objectPaths(value, [...prefix, k])); return paths;
}
const at = (x, keys) => keys.reduce((v, k) => v[k], x);
function benchmarks() {
  const reports = [];
  for (const [contents, nights] of [[500, 125], [2000, 500]]) {
    const raw = F.scale({ contents, nights }), ctx = F.context(), decodeTimes = [], acceptanceTimes = [];
    const current = root(raw, ctx), pending = thresholds(raw.versions.entries.map(x => affected(x.scope_kind, x.scope_id, x.entity_id, x.version)));
    const sample = () => {
      let start = performance.now(); const d = C.decodeSnapshotEnvelope(raw, ctx); const decodeMs = performance.now() - start;
      assert.equal(d.kind, 'DECODED_SNAPSHOT'); start = performance.now(); const a = assess(d, { current, thresholds: pending });
      const acceptanceMs = performance.now() - start; assert.equal(a.outcome, 'ACCEPT'); return [decodeMs, acceptanceMs];
    };
    for (let i = 0; i < 5; i++) sample();
    for (let i = 0; i < 20; i++) { const [d, a] = sample(); decodeTimes.push(d); acceptanceTimes.push(a); }
    const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    reports.push({ people: 2, contents, nights, bytes: Buffer.byteLength(JSON.stringify(raw)), samples: 20,
      decode_median_ms: median(decodeTimes), acceptance_median_ms: median(acceptanceTimes),
      decode_max_ms: Math.max(...decodeTimes) });
  }
  for (const r of reports) console.log('BENCHMARK ' + JSON.stringify(r));
  const ratio = reports[1].decode_median_ms / reports[0].decode_median_ms;
  console.log('BENCHMARK growth: payload=' + (reports[1].bytes / reports[0].bytes).toFixed(2) + 'x decode=' + ratio.toFixed(2) + 'x');
  assert(reports[1].decode_median_ms < 500, 'Diagnostic threshold exceeded: analyze before claiming PASS');
  assert(ratio < 6, 'Clearly superlinear growth: analyze before claiming PASS');
}
try {
  test('T01', 'all synthetic variants decode without domain reconstruction', () => {
    for (const name of ['relationless', 'selfList', 'otherList', 'candidate', 'scheduled', 'completed', 'partialParticipants',
      'rewatch', 'tombstones', 'legacyNight', 'largeDecimals', 'emptyCatalog', 'multipleEvents', 'scale']) decoded(F[name]());
    const s = root(F.selfList()); assert.equal(C.getGroupState(s, M).effective_candidacy, false);
    assert.equal(C.getPersonalState(s, N, M).seen, false);
    const r = rich(); decoded(r); assert.deepEqual(C.createContext(F.context()).value, F.context());
  });
  test('T02', 'every required key on populated schema instances is mandatory', () => {
    const source = rich();
    for (const p of objectPaths(source)) for (const k of Object.keys(at(source, p))) {
      const s = copy(source); delete at(s, p)[k]; reject(s);
    }
    for (const key of ['contract_version', 'outcome', 'error']) { const s = F.serverError('FORBIDDEN'); delete s[key]; reject(s); }
    const e = F.serverError('FORBIDDEN'); delete e.error.code; reject(e);
  });
  test('T03', 'invalid types and nullability rejected', () => {
    const changes = [s => s.catalog = null, s => s.caller.person_id = null, s => s.coverage.complete = 'true',
      s => s.coverage.counts.catalog = '1', s => s.personal[0].states[0].seen = 1, s => s.catalog[0].title = null,
      s => s.catalog[0].metadata_matched = 'false', s => s.catalog[0].genres = [1], s => s.catalog[0].tmdb_id = 123,
      s => s.personal[0].states[0].judgment.rating = '0', s => s.personal[0].states[0].judgment.preference = 0,
      s => s.group.states[0].eligibility.match_base = null, s => s.personal[0].states[0].list.active = 1];
    for (const change of changes) { const s = F.relationless(); change(s); reject(s); }
    for (const raw of [null, [], '', 1, false]) reject(raw);
  });
  test('T04', 'unknown root keys including prototype-like keys rejected', () => {
    for (const key of ['new_field', '__proto__', 'constructor']) {
      const s = F.relationless(); Object.defineProperty(s, key, { value: {}, enumerable: true }); reject(s, 'UNKNOWN_KEY');
    }
    const e = F.serverError('FORBIDDEN'); e.catalog = []; reject(e, 'UNKNOWN_KEY');
  });
  test('T05', 'unknown nested keys rejected at every populated object', () => {
    const source = rich(); for (const p of objectPaths(source).filter(x => x.length)) { const s = copy(source); at(s, p).unknown = true; reject(s, 'UNKNOWN_KEY'); }
  });
  test('T06', 'non JSON objects, accessors, sparse arrays and cycles rejected', () => {
    for (const bad of [undefined, NaN, Infinity, 1n, () => {}, new Date(0), new Map(), new Set(), new (class Example {})()]) {
      const s = F.relationless(); s.catalog[0].overview = bad; reject(s);
    }
    let invoked = false; const s = F.relationless(); Object.defineProperty(s.catalog[0], 'title', { enumerable: true, get() { invoked = true; throw Error('getter'); } }); reject(s); assert.equal(invoked, false);
    const cyclic = F.relationless(); cyclic.catalog[0].overview = cyclic; reject(cyclic, 'CYCLIC_INPUT');
    const sparse = F.relationless(); sparse.catalog[0].genres = new Array(2); reject(sparse);
    const extra = F.relationless(); extra.catalog.foo = 'extra'; reject(extra);
    const hidden = F.relationless(); Object.defineProperty(hidden.catalog[0], 'hidden', { value: true }); reject(hidden);
  });
  test('T07', 'canonical UUID without invented version/variant restrictions', () => {
    for (const v of ['ABCDEF00-0000-4000-8000-000000000001', ' '+M, M+' ', 'N', null, 1]) assert.equal(C.validateUUID(v).ok, false);
    assert.equal(C.validateUUID('00000000-0000-0000-0000-000000000000').ok, true);
    const s = F.relationless(); s.caller.person_id = 'N'; reject(s, 'UUID_REQUIRED');
  });
  test('T08', 'nonnegative Decimal zero and int64 maximum accepted exactly', () => {
    for (const x of ['0', '1', '9007199254740993', '9223372036854775807']) assert.equal(C.validateNonNegativeDecimal(x).value, x);
    assert.equal(C.validateNullableDecimal(null).value, null); assert.equal(C.validateNullableDecimal('0').value, '0');
  });
  test('T09', 'malformed and overflow Decimal rejected', () => {
    for (const x of ['', '00', '01', '+1', '-0', '-1', '1.0', '1e3', ' 1', '1 ', '9223372036854775808', 1, null]) assert.equal(C.validateNonNegativeDecimal(x).ok, false);
    for (const x of ['01', '9223372036854775808', 1]) { const s = F.selfList(); s.versions.entries[0].version = x; reject(s, 'DECIMAL_REQUIRED'); }
  });
  test('T10', 'large generation and version preserve exact strings', () => {
    const s = root(F.largeDecimals()); assert.equal(C.getPersonalState(s, N, M).list.generation, '9007199254740993');
    assert.deepEqual(C.getExpectedRevision(s, 'person_film', N, M), { kind: 'AVAILABLE', version: '9223372036854775807' });
    assert.equal(C.compareDecimals('9007199254740993', '9007199254740992'), 1); assert.equal(C.compareDecimals('10', '9'), 1);
  });
  test('T11', 'signed metadata identifier SQL range retained', () => {
    for (const x of [null, '0', '-1', '-9223372036854775808', '9223372036854775807']) assert(C.validateMetadataIdentifierDecimal(x).ok);
    for (const x of ['-0', '+1', '01', '-01', '-9223372036854775809', '9223372036854775808', 1]) assert(!C.validateMetadataIdentifierDecimal(x).ok);
    assert.equal(C.getContent(root(F.largeDecimals()), M).collection_id, '-9223372036854775808');
  });
  test('T12', 'only safe JSON numbers may become revision strings', () => {
    for (const [x, want] of [[0, '0'], [-0, '0'], [1, '1'], [Number.MAX_SAFE_INTEGER, '9007199254740991'], ['9007199254740993', '9007199254740993']]) assert.equal(C.normalizeExactRevision(x).value, want);
    for (const x of [Number.MAX_SAFE_INTEGER+1, Number('9007199254740993'), -1, 1.5, NaN, Infinity, null, true, '01']) assert(!C.normalizeExactRevision(x).ok);
  });
  test('T13', 'duplicate identities rejected across all entity and collection arrays', () => {
    const source = rich(), locations = [['catalog'], ['people'], ['personal'], ['personal','0','states'], ['group','states'], ['group','judgments'], ['nights'], ['participants'], ['exposure'], ['vetoes'], ['versions','entries']];
    for (const p of locations) { const s = copy(source), a = at(s, p); a.splice(1, 0, copy(a[0])); reject(s, 'DUPLICATE'); }
    const s = F.candidate(); s.group.collections.list_movie_ids.push(M); reject(s, 'DUPLICATE');
  });
  test('T14', 'broken person/content/night references fail directly', () => {
    for (const change of [s => s.catalog[0].added_by_person_id = H, s => s.nights[0].movie_id = Q,
      s => s.nights[0].proposed_by_person_id = H, s => s.participants[0].person_id = uid(99)]) {
      const s = F.completed(); change(s); reject(s, 'BROKEN_REFERENCE');
    }
    const s = F.completed(); s.participants[0].night_id = uid(19999); reject(s, 'BROKEN_REFERENCE');
  });
  test('T15', 'coverage labels, counts and context references exact', () => {
    for (const key of ['catalog','nights','participants','versions']) { const s = F.relationless(); s.coverage[key] = 'PARTIAL'; reject(s); }
    for (const key of Object.keys(F.relationless().coverage.counts)) { const s = F.relationless(); s.coverage.counts[key]++; reject(s, 'LITERAL_MISMATCH'); }
    const s = F.relationless(); s.coverage.group_id = uid(3002); reject(s); const e = F.relationless(); e.coverage.complete = false; reject(e);
  });
  test('T16', 'P×C and group states completeness independent of declared counts', () => {
    const s = F.relationless(); s.personal[0].states = []; F.finish(s); reject(s, 'SET_MISMATCH');
    const g = F.relationless(); g.group.states = []; F.finish(g); reject(g, 'SET_MISMATCH');
    const p = F.relationless(); p.personal.pop(); F.finish(p); reject(p, 'SET_MISMATCH');
  });
  test('T17', 'collections checked against public states, events and ordering', () => {
    const s = F.candidate(); s.group.collections.list_movie_ids = []; reject(s, 'SET_MISMATCH');
    const p = F.selfList(); p.personal[0].collections.list_movie_ids = []; reject(p, 'SET_MISMATCH');
    const n = F.scheduled(); n.group.states[0].active_night_ids = []; reject(n, 'SET_MISMATCH');
    const order = F.finish(F.base([M, Q])); order.catalog.reverse(); reject(order, 'NON_CANONICAL_ORDER');
  });
  test('T18', 'SELF absent/zero/terminated generation and active positive generation', () => {
    for (const gen of [null, '0', '1']) { const s = F.relationless(); s.personal[0].states[0].list.generation = gen; assert.equal(C.getPersonalState(root(s), N, M).list.generation, gen); }
    for (const gen of [null, '0']) { const s = F.selfList(); s.personal[0].states[0].list.generation = gen; reject(s, 'ACTIVE_GENERATION_REQUIRED'); }
  });
  test('T19', 'OTHER list remains visible; generation never disclosed', () => {
    const r = root(F.otherList()); assert.equal(C.getPersonalState(r, V, M).list.active, true); assert.equal(C.getPersonalState(r, V, M).list.generation, null);
    const s = F.otherList(); s.personal[1].states[0].list.generation = '1'; reject(s, 'LITERAL_MISMATCH');
  });
  test('T20', 'historical participant visible without personal data coverage', () => {
    const s = F.completed(); s.people[1].personal_readable = false; s.personal.pop(); F.finish(s); const r = root(s);
    assert.equal(C.getPerson(r, V).personal_readable, false); assert.equal(C.getPersonalState(r, V, M), null); assert(C.getExposure(r, V, M));
  });
  test('T21', 'partial participants do not manufacture personal seen or all members', () => {
    const r = root(F.partialParticipants()); assert.deepEqual(C.getParticipants(r, NIGHT), [{ night_id: NIGHT, person_id: N }]);
    assert.equal(C.getPersonalState(r, N, M).seen, false); assert.equal(C.hasExposure(r, V, M), false);
  });
  test('T22', 'zero, false, empty review and null judgments retained', () => {
    const s = F.relationless(); s.personal[0].states[0].judgment = { rating: 0, preference: null, review: '' };
    assert.deepEqual(C.getPersonalState(root(s), N, M).judgment, s.personal[0].states[0].judgment);
    s.personal[0].states[0].judgment = { rating: null, preference: false, review: null }; assert.equal(C.getPersonalState(root(s), N, M).judgment.preference, false);
    s.personal[0].states[0].judgment = null; s.personal[0].states[0].seen = null; const r = root(s); assert.equal(C.getPersonalState(r, N, M).seen, null); assert.equal(C.getPersonalState(r, N, M).judgment, null);
    const bad = F.relationless(); bad.personal[0].states[0].judgment = { rating: 0, preference: false, review: null }; reject(bad, 'JUDGMENT_EXCLUSIVITY');
  });
  test('T23', 'default zero available only in non-night covered scopes', () => {
    const r = root(); for (const [k, s] of [['person_film',N],['group_film',G],['content',M]]) assert.deepEqual(C.getExpectedRevision(r,k,s,M), { kind: 'DEFAULT_ZERO', version: '0' });
  });
  test('T24', 'outside coverage never receives zero', () => {
    const r = root(); for (const t of [['person_film',H,M],['group_film',uid(3002),M],['content',M,Q],['content',Q,Q],['night',G,NIGHT]]) assert.deepEqual(C.getExpectedRevision(r,...t),{kind:'OUT_OF_COVERAGE'});
  });
  test('T25', 'legacy night unavailable; token/default gaps never masked', () => {
    assert.deepEqual(C.getExpectedRevision(root(F.legacyNight()),'night',G,NIGHT),{kind:'UNAVAILABLE'});
    let s=F.legacyNight();s.versions.unavailable_night_ids=[];reject(s,'SET_MISMATCH');
    s=F.scheduled();s.versions.unavailable_night_ids=[NIGHT];reject(s,'SET_MISMATCH');
    s=F.scheduled();s.versions.defaults.night='0';reject(s,'LITERAL_MISMATCH');
    s=F.scheduled();s.versions.entries.find(v=>v.scope_kind==='night').version='0';reject(s,'NIGHT_VERSION_REQUIRED');
  });
  test('T26', 'retained authorized tombstones before defaults', () => {
    const r=root(F.tombstones()),id=uid(900001);
    for(const [k,s] of [['content',id],['person_film',N],['group_film',G],['night',G]])assert.equal(C.getExpectedRevision(r,k,s,id).kind,'TOMBSTONED');
    const bad=F.tombstones();bad.versions.entries[0].scope_id=M;reject(bad,'VERSION_SCOPE');
  });
  test('T27', 'all scope lookups return exact explicit versions', () => {
    const s=F.scheduled();s.versions.entries.push(F.version('content',M,M,'5'));const r=root(F.finish(s));
    for(const x of s.versions.entries)assert.deepEqual(C.getExpectedRevision(r,x.scope_kind,x.scope_id,x.entity_id),{kind:'AVAILABLE',version:x.version});
    assert.throws(()=>C.getExpectedRevision(r,'bad',G,M),TypeError);assert.throws(()=>C.getContent(r,'N'),TypeError);
  });
  test('T28', 'lower revision and disappearance to covered baseline are regressions', () => {
    const old=root(withVersion('2')),lower=decoded(withVersion('1'));
    assert.equal(assess(lower,{current:old}).outcome,'DISCARD_VERSION_REGRESSION');
    assert.equal(assess(decoded(F.relationless()),{current:old}).outcome,'DISCARD_VERSION_REGRESSION');
  });
  test('T29', 'night authority loss rejects, acquisition accepts', () => {
    const old=root(F.scheduled()),gap=decoded(F.legacyNight());assert.equal(assess(gap,{current:old}).outcome,'DISCARD_VERSION_REGRESSION');
    assert.equal(assess(decoded(F.scheduled()),{current:root(F.legacyNight())}).outcome,'ACCEPT');
  });
  test('T30', 'coverage loss removes data instead of retaining unauthorized rows', () => {
    const s=F.otherList(),old=root(s);s.people[1].personal_readable=false;s.personal.pop();s.versions.entries=[];const d=decoded(F.finish(s));
    assert(C.compareSnapshotVersions(old,d.candidate).coverageChanged);const a=assess(d,{current:old});assert.equal(a.outcome,'ACCEPT');assert.equal(C.getPersonalState(a.nextRoot,V,M),null);
    assert(C.compareSnapshotVersions(root(),root(F.emptyCatalog())).coverageChanged);
  });
  test('T31', 'same revision incompatible tombstone is contract error', () => {
    const id=uid(900001),s=F.relationless();s.versions.entries=[F.version('content',id,id,'3',true)];const old=root(F.finish(s));
    const next=F.base([M,id]);next.versions.entries=[F.version('content',id,id,'3',false)];assert.equal(assess(decoded(F.finish(next)),{current:old}).outcome,'CONTRACT_ERROR');
    const zero=F.emptyCatalog();zero.versions.entries.push(F.version('content',M,M,'0',true));assert.equal(assess(decoded(F.finish(zero)),{current:root()}).outcome,'CONTRACT_ERROR');
  });
  test('T32', 'caller/group/contract mismatch and context validation', () => {
    assert.equal(C.decodeSnapshotEnvelope(F.relationless(),F.context({callerId:V})).kind,'CONTEXT_MISMATCH');
    assert.equal(C.decodeSnapshotEnvelope(F.relationless(),F.context({groupId:uid(3002)})).kind,'CONTEXT_MISMATCH');
    assert.equal(C.decodeSnapshotEnvelope(F.relationless(),F.context({contractVersion:2})).kind,'INVALID');
    assert.equal(assess({kind:'CONTEXT_MISMATCH'}).outcome,'DISCARD_CONTEXT');
    assert.equal(C.createContext(F.context({contextEpoch:-1})).ok,false);
  });
  test('T33', 'B wins over A and duplicate response cannot replace current', () => {
    const request={context:F.context(),requestSequence:2},b=assess(decoded(),{requestMeta:request,latestRequestSequence:2});assert.equal(b.outcome,'ACCEPT');
    const a=assess(decoded(),{current:b.nextRoot,requestMeta:{context:F.context(),requestSequence:1},latestRequestSequence:2});assert.equal(a.outcome,'DISCARD_OBSOLETE');
    assert.equal(assess(decoded(),{current:b.nextRoot,requestMeta:request,latestRequestSequence:2}).outcome,'DISCARD_OBSOLETE');
  });
  test('T34', 'old epoch including authorization error never invalidates new context', () => {
    const d=C.decodeSnapshotEnvelope(F.serverError('UNAUTHENTICATED'),F.context());
    assert.equal(assess(d,{expectedContext:F.context({contextEpoch:2})}).outcome,'DISCARD_OBSOLETE');
  });
  test('T35', 'threshold equality accepted', () => {
    const t=thresholds([affected()]);assert(C.checkThresholds(root(F.selfList()),t).value.satisfied);assert.equal(assess(decoded(F.selfList()),{thresholds:t}).outcome,'ACCEPT');
  });
  test('T36', 'higher threshold requires refresh without an effect', () => {
    assert.equal(assess(decoded(F.selfList()),{thresholds:thresholds([affected('person_film',N,M,'2')])}).outcome,'RETRY_THRESHOLD');
  });
  test('T37', 'snapshot beyond threshold is accepted, not required to equal it', () => {
    assert.equal(assess(decoded(withVersion('3')),{thresholds:thresholds([affected('person_film',N,M,'2')])}).outcome,'ACCEPT');
  });
  test('T38', 'exact per-tuple threshold maximum and context-safe merge', () => {
    const a=thresholds([affected('person_film',N,M,'9007199254740993'),affected('person_film',N,M,'9007199254740992')]);
    const b=thresholds([affected('person_film',N,M,'9007199254740994'),affected('group_film',G,M,1)]);
    const merged=C.mergeThresholds(a,b);assert(merged.ok);assert.equal(merged.value.entries.length,2);assert.equal(merged.value.entries[0].minimum_version,'9007199254740994');
    assert(!C.mergeThresholds(a,thresholds([],F.context({contextEpoch:2}))).ok);
    assert(!C.normalizeAffectedVersions(F.context(),[affected('person_film',N,M,Number.MAX_SAFE_INTEGER+1)]).ok);
    assert(!C.normalizeAffectedVersions(F.context(),[affected('group_film',uid(3002),M,1)]).ok);
  });
  test('T39', 'out-of-coverage context path versus unavailable retry path', () => {
    assert.equal(assess(decoded(),{thresholds:thresholds([affected('person_film',N,Q,'1')])}).outcome,'DISCARD_CONTEXT');
    assert.equal(assess(decoded(F.legacyNight()),{thresholds:thresholds([affected('night',G,NIGHT,'1')])}).outcome,'RETRY_THRESHOLD');
  });
  test('T40', 'tombstone proves advancement but never AVAILABLE', () => {
    const r=root(F.tombstones()),id=uid(900001),t=thresholds([affected('content',id,id,'6')]);
    assert(C.checkThresholds(r,t).value.satisfied);assert.equal(C.getExpectedRevision(r,'content',id,id).kind,'TOMBSTONED');
  });
  test('T41', 'explicit UTC temporal interval with microsecond boundary', () => {
    const r=root();assert(C.isSnapshotTemporallyCurrent(r,AT).value.current);
    assert(C.isSnapshotTemporallyCurrent(r,'2027-01-04T22:59:59.999999Z').value.current);
    assert.equal(assess(decoded(),{nowInstant:NEXT}).outcome,'TEMPORALLY_STALE');
    const s=F.relationless();s.temporal.next_temporal_invalidation_at='2027-01-04T12:00:00.000001Z';const rr=root(s);
    assert(C.isSnapshotTemporallyCurrent(rr,AT).value.current);assert(!C.isSnapshotTemporallyCurrent(rr,'2027-01-04T12:00:00.000001Z').value.current);
  });
  test('T42', 'clock-before-as_of and malformed temporal fields', () => {
    const r=root();assert.equal(C.isSnapshotTemporallyCurrent(r,'2027-01-04T11:59:59.999999Z').value.reason,'CLOCK_BEFORE_AS_OF');
    for(const x of ['2027-01-04T12:00:00Z','2027-01-04T12:00:00.000000+00:00','2027-02-30T12:00:00.000000Z',new Date(0)])assert(!C.isSnapshotTemporallyCurrent(r,x).ok);
    const s=F.relationless();s.temporal.next_temporal_invalidation_at=AT;reject(s,'TEMPORAL_INTERVAL');
    const b=F.relationless();b.temporal.timezone='UTC';reject(b,'LITERAL_MISMATCH');
    const c=F.relationless();c.temporal.local_date='2027-02-30';reject(c,'DATE_RANGE');
  });
  test('T43', 'device timezone does not reinterpret UTC or legacy time strings', () => {
    const prior=process.env.TZ;
    try { for(const tz of ['Europe/Rome','UTC','America/Los_Angeles']) {process.env.TZ=tz;assert.equal(assess().outcome,'ACCEPT');} }
    finally {if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
    const s=F.legacyNight();s.nights[0].date='2027-10-31';s.nights[0].time='02:30';assert.equal(C.getNight(root(s),NIGHT).time,'02:30');
    s.nights[0].time='unknown legacy text';assert.equal(C.getNight(root(s),NIGHT).time,'unknown legacy text');
  });
  test('T44', 'signature is opaque and context-bound', () => {
    const a=root(),s=F.relationless();s.payload_signature.value='b'.repeat(64);assert.equal(C.sameSemanticPayload(a,root()),'SAME');assert.equal(C.sameSemanticPayload(a,root(s)),'DIFFERENT');
    const g=F.relationless(),other=uid(3002);g.selected_group.group_id=other;g.coverage.group_id=other;assert.equal(C.sameSemanticPayload(a,root(g,F.context({groupId:other}))),'NOT_COMPARABLE');
    const bad=F.relationless();bad.payload_signature.algorithm='sha256-js';reject(bad,'LITERAL_MISMATCH');
    bad.payload_signature.algorithm='sha256-pg-jsonb-text-v1';bad.payload_signature.value='A'.repeat(64);reject(bad,'SIGNATURE_REQUIRED');
  });
  test('T45', 'equal vector with changed opaque semantic signature can advance', () => {
    const old=root(),s=F.relationless();s.catalog[0].overview='Synthetic changed metadata';s.payload_signature.value='b'.repeat(64);
    const a=assess(decoded(s),{current:old});assert.equal(a.outcome,'ACCEPT');assert.equal(a.semanticChanged,true);
  });
  test('T46', 'signature equality bypasses no acceptance gate', () => {
    const d=decoded(F.selfList()),t=thresholds([affected('person_film',N,M,'2')]);
    assert.equal(assess(d,{thresholds:t}).outcome,'RETRY_THRESHOLD');assert.equal(assess(d,{nowInstant:NEXT}).outcome,'TEMPORALLY_STALE');
    assert.equal(assess(d,{current:root(withVersion('2'))}).outcome,'DISCARD_VERSION_REGRESSION');
  });
  test('T47', 'immutable document, collections, selector output and index facade', () => {
    const r=root(F.scheduled());assert(Object.isFrozen(r));assert(Object.isFrozen(r.snapshot));assert(Object.isFrozen(r.indexes));
    assert.throws(()=>r.snapshot.catalog[0].title='bad',TypeError);assert.throws(()=>r.snapshot.group.collections.list_movie_ids.push(M),TypeError);
    assert.throws(()=>C.getContent(r,M).title='bad',TypeError);assert.throws(()=>r.indexes.getContent=()=>null,TypeError);
    assert.throws(()=>C.getParticipants(r,NIGHT).push({person_id:N}),TypeError);
    assert(Object.values(r.indexes).every(x=>typeof x==='function'&&!(x instanceof Map)&&!(x instanceof Set)));
    const a=assess(decoded(F.scheduled()));assert(Object.isFrozen(a.nextRoot.acceptance));assert.throws(()=>a.nextRoot.acceptance.requestSequence++,TypeError);
  });
  test('T48', 'subsequent raw mutations never change decoded ownership', () => {
    const s=F.selfList(),r=root(s);s.catalog[0].title='Changed raw';s.personal[0].states[0].list.generation='2';s.catalog.push(F.content(Q));
    assert.notEqual(C.getContent(r,M).title,'Changed raw');assert.equal(C.getPersonalState(r,N,M).list.generation,'1');assert.equal(r.snapshot.catalog.length,1);
  });
  test('T49', 'input is neither frozen nor modified by decode', () => {
    const s=rich(),before=JSON.stringify(s);const r=root(s);assert.equal(JSON.stringify(s),before);assert(!Object.isFrozen(s));assert(!Object.isFrozen(s.catalog[0]));assert.notEqual(s,r.snapshot);assert.notEqual(s.catalog[0],r.snapshot.catalog[0]);
  });
  test('T50', 'all selectors and unknown-versus-absent results', () => {
    const r=root(F.completed());assert.equal(C.getContent(r,M),r.snapshot.catalog[0]);assert.equal(C.getPerson(r,N).person_id,N);
    assert.equal(C.getPersonalView(r,V).person_id,V);assert.equal(C.getGroupState(r,M).movie_id,M);assert.equal(C.getNight(r,NIGHT).status,'completed');
    assert.equal(C.getParticipants(r,NIGHT).length,2);assert(C.hasExposure(r,N,M));assert.equal(C.hasExposure(r,H,M),null);
    assert.equal(C.getContent(r,Q),null);assert.equal(C.getNight(r,uid(29999)),null);assert.equal(C.getParticipants(r,uid(29999)),null);assert.equal(C.getGroupJudgment(r,M),null);
    const all=root(rich()),m=all.snapshot.catalog[0].movie_id;assert.equal(C.getGroupJudgment(all,m).rating,0);assert.equal(C.getVetoForMovie(all,m).person_id,N);
    assert.equal(C.hasExposure(root(),N,M),false);
  });
  test('T51', 'only the eight server error codes decode', () => {
    for(const code of ['UNAUTHENTICATED','FORBIDDEN','INVALID_GROUP','UNSUPPORTED_CONTRACT','UNSUPPORTED_GROUP','FOUNDATION_NOT_READY','SNAPSHOT_DATA_INVALID','SNAPSHOT_TOO_LARGE'])assert.deepEqual(C.decodeSnapshotEnvelope(F.serverError(code),F.context()),{kind:'SERVER_ERROR',code});
    reject(F.serverError('UNEXPECTED_ERROR'),'SERVER_ERROR_CODE');
  });
  test('T52', 'server errors never construct empty accepted state', () => {
    const current=root(F.selfList());const a=assess(C.decodeSnapshotEnvelope(F.serverError('FORBIDDEN'),F.context()),{current});
    assert.deepEqual(a,{outcome:'SERVER_ERROR',code:'FORBIDDEN'});assert(!Object.hasOwn(a,'nextRoot'));assert.equal(current.snapshot.catalog.length,1);
  });
  test('T53', 'assessment and threshold checks do not mutate caller objects', () => {
    const r=root(F.selfList()),input=copy(thresholds([affected('person_film',N,M,'2')]));const before=JSON.stringify(input);
    C.checkThresholds(r,input);assert.equal(JSON.stringify(input),before);assert(!Object.isFrozen(input));assert(!Object.isFrozen(input.entries[0]));
    const invalid={kind:'INVALID',error:{code:'TEST',path:'/example'}};assess(invalid);assert(!Object.isFrozen(invalid.error));
    const ctx=F.context(),request={context:ctx,requestSequence:1};assess(decoded(),{expectedContext:ctx,requestMeta:request});assert(!Object.isFrozen(ctx));assert(!Object.isFrozen(request));
  });
  test('T54', 'VM isolation and zero normal-runtime reachability', () => {
    const file=path.join(__dirname,'../js/snapshot/core.js'),source=fs.readFileSync(file,'utf8');
    for(const entry of ['index.html','js/main.js','service-worker.js'])assert(!fs.readFileSync(path.join(__dirname,'..',entry),'utf8').includes('snapshot/core.js'));
    const executable=source.split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
    assert(!/\brequire\s*\(|\bimport\b|\b(?:window|document|localStorage|sessionStorage|fetch|supabase|Realtime|setTimeout|setInterval|addEventListener)\b|\bDate\s*\.|\bperformance\s*\./.test(executable));
    const sandbox={module:{exports:{}}};let accesses=0;
    for(const name of ['window','document','localStorage','sessionStorage','fetch','supabase','setTimeout','setInterval','Date','performance'])Object.defineProperty(sandbox,name,{get(){accesses++;throw Error('Forbidden access '+name);},configurable:false});
    const keys=Reflect.ownKeys(sandbox);vm.createContext(sandbox);vm.runInContext(source,sandbox);
    const E=sandbox.module.exports;const d=E.decodeSnapshotEnvelope(F.relationless(),F.context());assert.equal(d.kind,'DECODED_SNAPSHOT');assert.equal(E.evaluateAcceptance({decoded:d,current:null,expectedContext:F.context(),requestMeta:{context:F.context(),requestSequence:1},latestRequestSequence:1,thresholds:null,nowInstant:AT}).outcome,'ACCEPT');
    assert.deepEqual(Reflect.ownKeys(sandbox),keys);assert.equal(accesses,0);
  });
  test('T55', 'scale fixture and optional benchmark', () => {
    const s=F.scale({contents:2000,nights:500}),r=root(s);assert.equal(r.snapshot.personal.reduce((n,p)=>n+p.states.length,0),4000);assert.equal(r.snapshot.nights.length,500);
    if(process.argv.includes('--benchmark'))benchmarks();
  });
  test('T56', 'sparse affected arrays fail closed at normalization and acceptance', () => {
    for (const entries of [new Array(1), [affected(), , affected()], [affected(), ,]]) {
      const normalized=C.normalizeAffectedVersions(F.context(),entries);
      assert.equal(normalized.ok,false);assert(!Object.hasOwn(normalized,'value'));
      const input={context:F.context(),entries};
      assert.equal(C.checkThresholds(root(),input).ok,false);
      assert.equal(C.mergeThresholds(thresholds([]),input).ok,false);
      assert.equal(C.mergeThresholds(input,thresholds([])).ok,false);
      assert.equal(assess(decoded(),{thresholds:input}).outcome,'CONTRACT_ERROR');
    }
  });
  test('T57', 'dense empty and valid threshold arrays retain exact merge semantics', () => {
    const empty=thresholds([]);assert.deepEqual(empty.entries,[]);
    assert.equal(assess(decoded(),{thresholds:empty}).outcome,'ACCEPT');
    const one=thresholds([affected('person_film',N,M,'9007199254740993')]);
    assert.equal(one.entries[0].minimum_version,'9007199254740993');
    const many=thresholds([affected('person_film',N,M,'9007199254740994'),affected('group_film',G,M,1),affected('person_film',N,M,'2')]);
    const merged=C.mergeThresholds(one,many);assert(merged.ok);assert.equal(merged.value.entries.length,2);
    assert.equal(merged.value.entries.find(x=>x.scope_kind==='person_film').minimum_version,'9007199254740994');
  });
  test('T58', 'array accessor and inherited elements are rejected without execution', () => {
    let reads=0;const accessor=[];
    Object.defineProperty(accessor,'0',{enumerable:true,get(){reads++;return affected();}});
    const inherited=new Array(1),proto=Object.create(Array.prototype);
    Object.defineProperty(proto,'0',{get(){reads++;return affected();}});Object.setPrototypeOf(inherited,proto);
    const hidden=[affected()];Object.defineProperty(hidden,'0',{enumerable:false});
    const extra=[affected()];extra.extra=true;
    const symbol=[affected()];symbol[Symbol('extra')]=true;
    const disguised=new Array(1);disguised.extra=affected();
    for(const entries of [accessor,inherited,hidden,extra,symbol,disguised]) {
      assert.equal(C.normalizeAffectedVersions(F.context(),entries).ok,false);
      const input={context:F.context(),entries};
      assert.equal(C.checkThresholds(root(),input).ok,false);
      assert.equal(C.mergeThresholds(thresholds([]),input).ok,false);
      assert.equal(assess(decoded(),{thresholds:input}).outcome,'CONTRACT_ERROR');
    }
    assert.equal(reads,0);
  });
  test('T59', 'entry and threshold accessors cannot bypass validation', () => {
    let reads=0;const entry=affected();
    Object.defineProperty(entry,'version',{enumerable:true,get(){reads++;return '1';}});
    assert.equal(C.normalizeAffectedVersions(F.context(),[entry]).ok,false);
    const input={context:F.context(),entries:[]};
    Object.defineProperty(input,'entries',{enumerable:true,get(){reads++;return [];}});
    assert.equal(C.checkThresholds(root(),input).ok,false);
    assert.equal(C.mergeThresholds(thresholds([]),input).ok,false);
    assert.equal(assess(decoded(),{thresholds:input}).outcome,'CONTRACT_ERROR');
    const normalizedEntry={...affected(),minimum_version:'1'};delete normalizedEntry.version;
    Object.defineProperty(normalizedEntry,'minimum_version',{enumerable:true,get(){reads++;return '1';}});
    const malformed={context:F.context(),entries:[normalizedEntry]};
    assert.equal(C.checkThresholds(root(),malformed).ok,false);
    assert.equal(assess(decoded(),{thresholds:malformed}).outcome,'CONTRACT_ERROR');
    assert.equal(reads,0);
  });
  test('T60', 'dense threshold arrays preserve unsafe-number and Decimal rejection', () => {
    for(const value of [Number.MAX_SAFE_INTEGER+1,-1,1.5,NaN,Infinity,'01','9223372036854775808'])
      assert.equal(C.normalizeAffectedVersions(F.context(),[affected('person_film',N,M,value)]).ok,false);
    assert.equal(thresholds([affected('person_film',N,M,Number.MAX_SAFE_INTEGER)]).entries[0].minimum_version,'9007199254740991');
    assert.equal(thresholds([affected('person_film',N,M,'9223372036854775807')]).entries[0].minimum_version,'9223372036854775807');
  });
  test('T61', 'threshold iteration never trusts inherited iteration hooks', () => {
    let reads=0;const entries=[{...thresholds([affected('person_film',N,M,'2')]).entries[0]}];
    const proto=Object.create(Array.prototype);
    for(const name of [Symbol.iterator,'forEach','map'])Object.defineProperty(proto,name,{get(){reads++;throw Error('Untrusted iteration hook');}});
    Object.setPrototypeOf(entries,proto);
    const input={context:F.context(),entries};
    const checked=C.checkThresholds(root(),input);assert(checked.ok);assert.equal(checked.value.satisfied,false);
    assert.equal(assess(decoded(),{thresholds:input}).outcome,'RETRY_THRESHOLD');
    const merged=C.mergeThresholds(thresholds([]),input);assert(merged.ok);assert.equal(merged.value.entries[0].minimum_version,'2');
    assert.equal(reads,0);
  });
  assert.equal(groups,61);console.log('Snapshot core: '+groups+'/61 PASS; '+rejections+' negative decode cases rejected.');
} catch(e) { console.error('FAIL snapshot core after '+groups+' groups:',e.stack);process.exitCode=1; }
