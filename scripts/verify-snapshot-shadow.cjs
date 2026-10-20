#!/usr/bin/env node
'use strict';
// Synthetic shadow integration only: no network, database or real storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const Core = require('../js/snapshot/core');
const { createProjection } = require('../js/snapshot/projection');
const { createCacheAdapter } = require('../js/snapshot/cache');
const { createShadowController } = require('../js/snapshot/controller');
const F = require('./fixtures/snapshot-v1.cjs');
const Recommendation = require('../js/recommendation/adapters');
const Engine = require('../js/recommendation/core');
const { N, V, H, G, M, NIGHT, AT, NEXT, uid } = F;
let count = 0;
const copy = x => JSON.parse(JSON.stringify(x));
const drain = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const addMs = (at, ms) => new Date(Date.parse(at) + ms).toISOString().slice(0, -1) + at.slice(23, 26) + 'Z';
function decoded(s, context = F.context()) {
  const d = Core.decodeSnapshotEnvelope(s, context); assert.equal(d.kind, 'DECODED_SNAPSHOT', JSON.stringify(d)); return d;
}
function root(s = F.relationless()) {
  const d = decoded(s), a = Core.evaluateAcceptance({ decoded: d, current: null, expectedContext: F.context(),
    requestMeta: { context: F.context(), requestSequence: 1 }, latestRequestSequence: 1, thresholds: null, nowInstant: s.temporal.as_of });
  assert.equal(a.outcome, 'ACCEPT'); return a.nextRoot;
}
function versioned(v = '5') { const s = F.selfList(); s.versions.entries[0].version = v; return s; }
const affected = (version = '5', scope_kind = 'person_film', scope_id = N, entity_id = M) => ({ scope_kind, scope_id, entity_id, version });
function storage() {
  const values = new Map(), writes = [];
  let fail = false;
  return { values, writes, set fail(x) { fail = x; }, getItem(k) { return values.get(k) ?? null; },
    setItem(k, v) { if (fail) throw Error('Synthetic quota'); values.set(k, v); writes.push([k, v]); }, removeItem(k) { values.delete(k); } };
}
function harness({ cached = null, store = storage(), timeoutMs = 10000, onController = null } = {}) {
  let instant = AT, next = 0;
  const tasks = new Map(), reads = [];
  const clock = { nowInstant: () => instant };
  const scheduler = { scheduleAt(at, fn) { const id = ++next; tasks.set(id, { at, fn }); return id; }, cancel(id) { tasks.delete(id); } };
  const provider = { read(args) { return new Promise((resolve, reject) => reads.push({ args, resolve, reject })); } };
  if (cached) { assert(createCacheAdapter(store).write(root(cached), AT).ok); store.writes.length = 0; }
  const controller = createShadowController({ provider, clock, scheduler, storage: store, timeoutMs });
  if (onController) onController(controller);
  controller.setContext(F.context());
  const h = { controller, reads, tasks, store, clock, scheduler,
    async start(reason = 'INITIAL') { const t = controller.requestRefresh(reason); await drain(); return t; },
    async resolve(s = F.relationless(), index = reads.length - 1) { reads[index].resolve(s); await drain(); },
    async reject(index = reads.length - 1) { reads[index].reject(Error('Synthetic network')); await drain(); },
    async advance(ms) {
      instant = addMs(instant, ms);
      for (let i = 0; i < 100; i++) {
        const due = [...tasks].filter(([, t]) => t.at <= instant).sort((a, b) => a[1].at.localeCompare(b[1].at) || a[0] - b[0])[0];
        if (!due) { await drain(); return; }
        tasks.delete(due[0]); due[1].fn(); await drain();
      }
      throw Error('Scheduler loop');
    },
    setTime(at) { instant = at; },
    async online(s = F.relationless()) { await h.start(); await h.resolve(s); return controller.getState(); },
    state: () => controller.getState()
  };
  return h;
}
function frozenTree(x) {
  if (!x || typeof x !== 'object') return;
  assert(Object.isFrozen(x)); for (const value of Object.values(x)) frozenTree(value);
}
function constraintParity(projection, constraints) {
  const expected = Recommendation.fromMovies({ movies: projection.legacy.movies,
    movieNights: projection.legacy.movieNights, userIds: { N, V }, groupId: G, constraints });
  const actual = projection.getRecommendationInput({ constraints });
  assert.equal(actual.kind, 'AVAILABLE');
  assert.deepEqual(actual.input.constraints, expected.constraints);
  const outcome = input => {
    try { return { kind: 'SUCCESS', value: Engine.recommend(input) }; }
    catch (e) { return { kind: 'ERROR', name: e.name, message: e.message }; }
  };
  const expectedOutcome = outcome(expected), actualOutcome = outcome(actual.input);
  assert.deepEqual(actualOutcome, expectedOutcome);
  return { actual: actual.input, outcome: actualOutcome };
}
const test = async (id, name, fn) => { await fn(); count++; console.log('PASS ' + id + ' ' + name); };
async function main() {
  await test('C01', 'initial online success and coherent root', async () => {
    const h = harness(); await h.start(); assert.equal(h.state().status, 'LOADING'); await h.resolve();
    assert.equal(h.state().status, 'READY'); assert.equal(h.state().view.source, 'ONLINE');
    assert.strictEqual(h.state().view.root.context, h.state().view.projection.context); frozenTree(h.state());
  });
  await test('C02', 'initial transport failure invents no empty view', async () => {
    const h=harness();await h.start();await h.reject();assert.equal(h.state().status,'UNINITIALIZED');assert.equal(h.state().view,null);
  });
  await test('C03', 'recovery after degraded replaces complete view', async () => {
    const h=harness();await h.online();const old=h.state().view;await h.start('MANUAL');await h.reject();assert.equal(h.state().status,'DEGRADED');assert.strictEqual(h.state().view,old);
    await h.advance(250);await h.resolve(F.selfList());assert.equal(h.state().status,'READY');assert.notStrictEqual(h.state().view,old);
  });
  await test('C04', 'A/B/C coalescing and dirty during follow-up', async () => {
    const h=harness();await h.start();h.controller.requestRefresh('MANUAL');h.controller.requestRefresh('INVALIDATION');assert.equal(h.reads.length,1);
    await h.resolve();assert.equal(h.reads.length,2);assert.equal(h.reads[1].args.requestSequence,2);
    h.controller.requestRefresh('MANUAL');h.controller.requestRefresh('MANUAL');await h.resolve();assert.equal(h.reads.length,3);
    await h.resolve();assert.equal(h.reads.length,3);assert.equal(h.state().view.root.acceptance.requestSequence,3);
  });
  await test('C05', 'old response and finally cannot overwrite new epoch', async () => {
    const h=harness();await h.start();const nextG=uid(3100);h.controller.setContext(F.context({groupId:nextG}));assert.equal(h.state().view,null);
    await h.start();const s=F.relationless();s.selected_group.group_id=nextG;s.coverage.group_id=nextG;
    await h.resolve(s,1);const state=h.state();await h.resolve(F.relationless(),0);assert.strictEqual(h.state(),state);assert.equal(h.reads.length,2);
  });
  await test('C06', 'auth failure clears sensitive state and pending', async () => {
    const h=harness();await h.online();h.controller.requireVersions({requestId:uid(801),affectedVersions:[affected()]});await drain();
    await h.resolve(F.serverError('UNAUTHENTICATED'));assert.equal(h.state().status,'AUTH_INVALID');assert.equal(h.state().view,null);assert.deepEqual(h.state().pending.requestIds,[]);
    assert.equal(h.controller.requestRefresh('MANUAL'),null);assert.equal(h.tasks.size,0);
  });
  await test('C07', 'all forbidden/group errors invalidate context', async () => {
    for(const code of ['FORBIDDEN','INVALID_GROUP','UNSUPPORTED_GROUP']) {
      const h=harness();await h.online();await h.start('MANUAL');await h.resolve(F.serverError(code));assert.equal(h.state().status,'CONTEXT_INVALID');assert.equal(h.state().view,null);assert.equal(h.tasks.size,0);
    }
  });
  await test('C08', 'structural errors preserve stale view without retry loop', async () => {
    for(const code of ['UNSUPPORTED_CONTRACT','FOUNDATION_NOT_READY','SNAPSHOT_DATA_INVALID','SNAPSHOT_TOO_LARGE']) {
      const h=harness();await h.online();const prior=h.state().view;await h.start('MANUAL');await h.resolve(F.serverError(code));
      assert.equal(h.state().status,code==='FOUNDATION_NOT_READY'?'DEGRADED':'CONTRACT_INVALID');assert.strictEqual(h.state().view,prior);
      await h.advance(1001);assert.equal(h.reads.length,2);
    }
  });
  await test('C09', 'malformed payload fails contract without publication', async () => {
    const h=harness();await h.online();const prior=h.state().view;await h.start('MANUAL');await h.resolve({});assert.equal(h.state().status,'CONTRACT_INVALID');assert.strictEqual(h.state().view,prior);
  });
  await test('C10', 'online version regression preserves previous root', async () => {
    const h=harness();await h.online(versioned());const prior=h.state().view;await h.start('MANUAL');await h.resolve(versioned('4'));
    assert.equal(h.state().status,'STALE');assert.strictEqual(h.state().view,prior);assert(h.state().diagnostics.some(x=>x.code==='DISCARD_VERSION_REGRESSION'));
  });
  await test('C11', 'equal threshold satisfied only by accepted online state', async () => {
    const h=harness();h.controller.requireVersions({requestId:uid(802),affectedVersions:[affected()]});await drain();await h.resolve(versioned());
    assert.equal(h.state().status,'READY');assert.equal(h.state().pending.thresholds,null);assert.deepEqual(h.state().pending.requestIds,[]);
  });
  await test('C12', 'behind threshold candidate is not published', async () => {
    const h=harness();await h.online();const prior=h.state().view;h.controller.requireVersions({requestId:uid(803),affectedVersions:[affected()]});await drain();await h.resolve(versioned('4'));
    assert.strictEqual(h.state().view,prior);assert.equal(h.state().pending.thresholds.entries[0].minimum_version,'5');assert.equal(h.state().status,'STALE');
  });
  await test('C13', 'later snapshot satisfies exact maximum pending thresholds', async () => {
    const h=harness();h.controller.requireVersions({requestId:uid(804),affectedVersions:[affected('9007199254740993')]});await drain();
    h.controller.requireVersions({requestId:uid(805),affectedVersions:[affected('9007199254740994')]});assert.equal(h.reads.length,1);
    await h.resolve(versioned('9007199254740993'));assert.equal(h.state().view,null);assert.equal(h.reads.length,2);assert.equal(h.state().pending.requestIds.length,2);
    await h.resolve(versioned('9007199254740994'));assert.equal(h.state().status,'READY');assert.equal(h.state().pending.thresholds,null);
  });
  await test('C14', 'threshold outside coverage invalidates instead of retrying', async () => {
    const h=harness();h.controller.requireVersions({requestId:uid(806),affectedVersions:[affected('1','person_film',H)]});await drain();await h.resolve();
    assert.equal(h.state().status,'CONTEXT_INVALID');assert.equal(h.state().view,null);assert.equal(h.tasks.size,0);
  });
  await test('C15', 'temporal deadline marks stale and refreshes once', async () => {
    const h=harness();await h.online();h.setTime(NEXT);await h.advance(0);assert.equal(h.state().status,'STALE');assert.equal(h.reads.length,2);assert.equal(h.reads[1].args.reason,'TEMPORAL');
    await h.resolve();assert.notEqual(h.state().status,'READY');assert.equal(h.reads.length,2);
  });
  await test('C16', 'foreground after expiry rejects expired response', async () => {
    const h=harness();await h.online();h.setTime(NEXT);await h.start('FOREGROUND');assert.equal(h.state().status,'STALE');await h.resolve();assert.equal(h.state().status,'STALE');assert.equal(h.state().freshness.temporalCurrent,false);
  });
  await test('C17', 'timeout preserves physical single-flight and rejects late success', async () => {
    const h=harness({timeoutMs:100});await h.start();await h.advance(100);assert.equal(h.state().status,'UNINITIALIZED');
    h.controller.requestRefresh('MANUAL');await drain();assert.equal(h.reads.length,1);await h.advance(2000);assert.equal(h.reads.length,1);
    await h.resolve();assert.equal(h.state().view,null);assert.equal(h.reads.length,2);await h.resolve();assert.equal(h.state().status,'READY');
  });
  await test('C18', 'retry budget is two with exact 250/1000 backoff', async () => {
    const h=harness();await h.start();await h.reject();await h.advance(249);assert.equal(h.reads.length,1);await h.advance(1);assert.equal(h.reads.length,2);
    await h.reject();await h.advance(999);assert.equal(h.reads.length,2);await h.advance(1);assert.equal(h.reads.length,3);await h.reject();await h.advance(5000);assert.equal(h.reads.length,3);
    await h.start('MANUAL');assert.equal(h.reads.length,4);
  });
  await test('C19', 'cache bootstrap is stale candidate, never fake online acceptance', async () => {
    const h=harness({cached:versioned()});assert.equal(h.state().status,'STALE');assert.equal(h.state().view.source,'CACHE');assert(!Object.hasOwn(h.state().view.root,'acceptance'));assert.equal(h.store.writes.length,0);
  });
  await test('C20', 'malformed cache rejected', async () => {
    const store=storage();store.values.set('scorochiatu_snapshot_v1:'+N+':'+G,'{bad');const h=harness({store});assert.equal(h.state().view,null);assert(h.state().diagnostics.some(x=>x.code==='CACHE_REJECTED'));
  });
  await test('C21', 'wrong cache owner/group/contract rejected', async () => {
    for(const [key,value] of [['caller_id',V],['group_id',uid(9)],['contract_version',2]]) {
      const store=storage();createCacheAdapter(store).write(root(),AT);const k=[...store.values.keys()][0],r=JSON.parse(store.values.get(k));r[key]=value;store.values.set(k,JSON.stringify(r));
      const h=harness({store});assert.equal(h.state().view,null);
    }
  });
  await test('C22', 'quota failure does not undo online acceptance', async () => {
    const h=harness();h.store.fail=true;await h.online();assert.equal(h.state().status,'READY');assert.equal(h.state().view.source,'ONLINE');assert(h.state().diagnostics.some(x=>x.code==='CACHE_WRITE_FAILED'));
  });
  await test('C23', 'same signature never bypasses temporal or rebuild gate', async () => {
    const h=harness();await h.online();const old=h.state().view;const s=F.relationless();s.temporal.as_of=addMs(AT,1000);h.setTime(s.temporal.as_of);
    await h.start('MANUAL');await h.resolve(s);assert.notStrictEqual(h.state().view,old);assert.equal(h.state().view.root.snapshot.temporal.as_of,s.temporal.as_of);
    h.controller.requireVersions({requestId:uid(807),affectedVersions:[affected()]});await drain();await h.resolve(s);assert.equal(h.state().status,'STALE');
  });
  await test('C24', 'published bundles and old retained observations stay atomic', async () => {
    const h=harness();await h.online();const before=h.state();await h.start('MANUAL');await h.resolve(F.selfList());const after=h.state();
    assert.strictEqual(before.view.selectors,before.view.projection.selectors);assert.strictEqual(after.view.selectors,after.view.projection.selectors);
    assert.equal(before.view.selectors.getPersonalListMovies(N).movies.length,0);assert.equal(after.view.selectors.getPersonalListMovies(N).movies.length,1);frozenTree(after);
  });
  await test('C25', 'clear/dispose ignores all late callbacks and prevents reuse', async () => {
    const h=harness();await h.online();await h.start('MANUAL');h.controller.clearContext('LOGOUT');assert.equal(h.tasks.size,0);const cleared=h.state();await h.resolve();assert.strictEqual(h.state(),cleared);assert.equal(h.state().view,null);
    h.controller.dispose();assert.throws(()=>h.controller.setContext(F.context()));assert.equal(h.controller.requestRefresh('MANUAL'),null);
  });
  await test('P01', 'relationless metadata only; no invented workflow', () => {
    const p=createProjection(root()),m=p.legacy.movies[0];assert.equal(m.id,M);assert.equal(m.in_shared_list,false);
    for(const k of ['status','scheduled_date','scheduled_time','personal_list','participants'])assert(!Object.hasOwn(m,k));
  });
  await test('P02', 'personal seen maps exactly, including false', () => {
    const s=F.relationless();s.personal[0].states[0].seen=true;F.finish(s);const p=createProjection(root(s));
    assert.equal(p.legacy.movies[0].seen_n,true);assert.equal(p.legacy.movies[0].seen_v,false);assert.equal(p.selectors.getPersonalSeenMovies(N).movies.length,1);
  });
  await test('P03', 'judgment zero/false/review/null remain independent of seen', () => {
    const s=F.relationless();s.personal[0].states[0].judgment={rating:0,preference:null,review:''};s.personal[1].states[0].judgment.preference=false;
    const m=createProjection(root(s)).legacy.movies[0];assert.equal(m.seen_rating_n,0);assert.equal(m.personal_liked_v,false);assert.equal(m.review_text_n,'');assert.equal(m.seen_n,false);
  });
  await test('P04', 'effective candidacy alias has no personal-list implication', () => {
    const p=createProjection(root(F.candidate()));assert.equal(p.legacy.movies[0].in_shared_list,true);assert.equal(p.selectors.getVisibleGroupListMovies().length,1);assert.equal(p.selectors.getPersonalListMovies(N).movies.length,0);
  });
  await test('P05', 'schedule remains event based', () => {
    const p=createProjection(root(F.scheduled()));assert.equal(p.legacy.movieNights[0].id,NIGHT);assert.equal(p.legacy.movieNights[0].proposed_by,'N');assert.equal(p.selectors.getScheduledNights()[0].night_id,NIGHT);assert(!Object.hasOwn(p.legacy.movies[0],'scheduled_date'));
  });
  await test('P06', 'Together event and group judgment without personal seen', () => {
    const s=F.completed();s.group.judgments=[{movie_id:M,rating:0,review:'Synthetic shared'}];F.finish(s);const p=createProjection(root(s));
    assert.equal(p.selectors.getTogetherMovies().length,1);assert.equal(p.legacy.movies[0].seen_n,false);assert.equal(p.legacy.movies[0].seen_rating_together,0);
  });
  await test('P07', 'veto identity is UUID with optional verified label', () => {
    const s=F.relationless();s.vetoes=[{veto_id:uid(6001),person_id:V,movie_id:M,week_key:'2027-W01'}];F.finish(s);
    const v=createProjection(root(s)).legacy.vetoes[0];assert.equal(v.person_id,V);assert.equal(v.person,'V');
  });
  await test('P08', 'metadata exact Decimal and multiple nights retained', () => {
    const s=F.multipleEvents();s.catalog[0].tmdb_id='9007199254740993';s.catalog[0].added_by_person_id=V;s.catalog[0].surprise_by_person_id=N;
    const p=createProjection(root(s));assert.equal(p.legacy.movies[0].tmdb_id,'9007199254740993');assert.equal(p.legacy.movies[0].added_by,'V');assert.equal(p.legacy.movies[0].surprise_by,'N');assert.equal(p.legacy.movieNights.length,3);
  });
  await test('P09', 'post-Together recandidacy list does not invent eligibility', () => {
    const s=F.completed();Object.assign(s.group.states[0],{effective_candidacy:true,list_visible:true});F.finish(s);
    const p=createProjection(root(s));assert.equal(p.selectors.getVisibleGroupListMovies().length,1);assert.equal(p.selectors.getTogetherMovies().length,1);
    assert.equal(p.selectors.getMatchBaseEligibility(M),false);assert.equal(p.selectors.getRuotaBaseEligibility(M),false);assert.equal(p.legacy.movies[0].in_shared_list,true);
  });
  await test('P10', 'partial participants remain per event with no N+V inference', () => {
    const p=createProjection(root(F.partialParticipants()));assert.deepEqual(p.selectors.getNightParticipants(NIGHT).map(x=>x.person_id),[N]);
    assert.equal(p.selectors.getMovieParticipants(M).length,1);assert.equal(p.legacy.movies[0].seen_v,false);
  });
  await test('P11', 'personal List independent of group and SELF/OTHER generation privacy', () => {
    for(const [factory,person] of [[F.selfList,N],[F.otherList,V]]) {const p=createProjection(root(factory()));assert.equal(p.selectors.getPersonalListMovies(person).movies.length,1);assert.equal(p.selectors.getVisibleGroupListMovies().length,0);assert(!Object.hasOwn(p.legacy.movies[0],'generation'));}
  });
  await test('P12', 'rewatch semantic and visible stay distinct', () => {
    const s=F.rewatch();s.group.states[0].rewatch_visible=false;F.finish(s);const p=createProjection(root(s));
    assert.deepEqual(p.selectors.getRewatchState(M),{semantic:true,visible:false});assert.equal(p.selectors.getRewatchMovies().length,0);
  });
  await test('P13', 'exposure never populates personal seen', () => {
    const r=root(F.completed()),p=createProjection(r);assert.equal(Core.hasExposure(r,N,M),true);assert.equal(p.selectors.getPersonalSeenMovies(N).movies.length,0);assert.equal(p.legacy.movies[0].seen_n,false);
  });
  await test('P14', 'missing labels degrade explicitly and block legacy Recommendation input', () => {
    const s=F.relationless();s.people[1].legacy_person=null;const p=createProjection(root(s));assert.equal(p.legacy.mappingStatus,'PARTIAL');assert.deepEqual(p.legacy.missingMappings,['V']);assert.equal(p.legacy.movies[0].seen_v,null);assert.equal(p.getRecommendationInput().kind,'LEGACY_MAPPING_UNAVAILABLE');
  });
  await test('P15', 'historical unreadable person never becomes false personal state', () => {
    const s=F.completed();s.people[1].personal_readable=false;s.personal=s.personal.filter(p=>p.person_id!==V);F.finish(s);
    const p=createProjection(root(s));assert.equal(p.legacy.movies[0].seen_v,null);assert.deepEqual(p.selectors.getPersonalSeenMovies(V),{kind:'OUT_OF_COVERAGE'});assert.equal(p.selectors.getNightParticipants(NIGHT).length,2);
    const bad=F.relationless();bad.people[1].legacy_person='N';assert.equal(Core.decodeSnapshotEnvelope(bad,F.context()).kind,'INVALID');
  });
  await test('P16', 'projection owns no mutable data and does not freeze caller constraints', () => {
    const raw=F.candidate(),r=root(raw),before=JSON.stringify(raw),p=createProjection(r);frozenTree(p);
    const constraints={context:'all',genres:['Synthetic Drama']};const input=p.getRecommendationInput({constraints});frozenTree(input);assert(!Object.isFrozen(constraints));assert(!Object.isFrozen(constraints.genres));
    assert.equal(JSON.stringify(raw),before);assert(!Object.isFrozen(raw));assert.strictEqual(p.getMatchInputs().content,r.snapshot.catalog);assert.throws(()=>{p.legacy.movies[0].seen_n=true;});
  });
  for(let i=1;i<=4;i++) await test('R0'+i,'Recommendation parity case '+i,()=>{
    const s=F.candidate();Object.assign(s.catalog[0],{duration:'110 min',genres:['Synthetic Drama'],director:'Synthetic Director',cast_names:['Synthetic Actor'],release_year:2005,collection_id:'9007199254740993'});
    s.personal[0].states[0].judgment={rating:i===2?0:null,preference:i===2?null:true,review:'Synthetic personal'};
    s.personal[1].states[0].judgment={rating:null,preference:false,review:null};s.personal[0].states[0].seen=i===1;
    s.group.judgments=[{movie_id:M,rating:7.5,review:'Synthetic shared'}];
    if(i===3) {s.nights=[F.night()];s.versions.entries.push(F.version('night',G,NIGHT));}
    if(i===4)s.catalog[0].cinema_watchlist=true;F.finish(s);
    const constraints={context:i===4?'cinema':'streaming'};
    const legacyMovie={id:M,title:s.catalog[0].title,in_shared_list:true,cinema_watchlist:i===4,duration:'110 min',genres:['Synthetic Drama'],director:'Synthetic Director',cast_names:['Synthetic Actor'],release_year:2005,collection_id:'9007199254740993',seen_rating_n:i===2?0:null,personal_liked_n:i===2?null:true,review_text_n:'Synthetic personal',seen_rating_v:null,personal_liked_v:false,review_text_v:null,seen_n:i===1,seen_v:false,seen_rating_together:7.5,review_text_together:'Synthetic shared'};
    const expected=Recommendation.fromMovies({movies:[legacyMovie],movieNights:i===3?[{movie_id:M,status:'proposed'}]:[],userIds:{N,V},groupId:G,constraints});
    const actual=createProjection(root(s)).getRecommendationInput({constraints});assert.equal(actual.kind,'AVAILABLE');assert.deepEqual(actual.input,expected);assert.deepEqual(Engine.recommend(actual.input),Engine.recommend(expected));
  });
  await test('R05', 'Infinity remains invalid exactly as in current Recommendation',()=>{
    const p=createProjection(root(F.candidate()));
    for(const key of ['minRuntimeMinutes','maxRuntimeMinutes'])for(const value of [Infinity,-Infinity]) {
      const result=constraintParity(p,{context:'streaming',[key]:value});
      assert.equal(result.actual.constraints[key],value);
      assert.deepEqual(result.outcome,{kind:'ERROR',name:'TypeError',message:'Invalid runtime constraint'});
    }
  });
  await test('R06', 'NaN never becomes a null or accepted runtime constraint',()=>{
    const p=createProjection(root(F.candidate()));
    for(const key of ['minRuntimeMinutes','maxRuntimeMinutes']) {
      const result=constraintParity(p,{context:'streaming',[key]:NaN});
      assert(Number.isNaN(result.actual.constraints[key]));assert.equal(result.outcome.kind,'ERROR');assert.equal(result.outcome.message,'Invalid runtime constraint');
    }
  });
  await test('R07', 'valid numeric and nested array constraints preserve Recommendation results',()=>{
    const s=F.candidate();s.catalog[0].duration='110 min';s.catalog[0].genres=['Synthetic Drama'];
    const p=createProjection(root(s));const result=constraintParity(p,{context:'streaming',minRuntimeMinutes:100,maxRuntimeMinutes:120,genres:['Synthetic Drama'],excludeMovieIds:[]});
    assert.equal(result.outcome.kind,'SUCCESS');assert.equal(result.outcome.value.length,1);
  });
  await test('R08', 'null and own undefined constraints retained without property deletion',()=>{
    const p=createProjection(root(F.candidate()));
    for(const constraints of [null,undefined])assert.equal(constraintParity(p,constraints).outcome.kind,'SUCCESS');
    for(const value of [null,undefined]) {
      const constraints={context:'streaming',minRuntimeMinutes:value,maxRuntimeMinutes:value,genres:value,excludeMovieIds:value};
      const result=constraintParity(p,constraints);assert.equal(result.outcome.kind,'SUCCESS');
      for(const key of Object.keys(constraints)){assert(Object.hasOwn(result.actual.constraints,key));assert.strictEqual(result.actual.constraints[key],constraints[key]);}
    }
  });
  await test('R09', 'false zero negative-zero and empty string are never truthiness-normalized',()=>{
    const p=createProjection(root(F.candidate()));
    for(const value of [false,0,-0,'']) {
      assert.equal(constraintParity(p,value).outcome.kind,'SUCCESS');
      for(const key of ['context','excludeMovieIds']) {
        const result=constraintParity(p,{[key]:value});assert.equal(result.outcome.kind,'SUCCESS');assert(Object.is(result.actual.constraints[key],value));
      }
      for(const key of ['minRuntimeMinutes','maxRuntimeMinutes','genres']) {
        const result=constraintParity(p,{[key]:value});assert.equal(result.outcome.kind,'ERROR');assert(Object.is(result.actual.constraints[key],value));
      }
    }
  });
  await test('R10', 'constraints input unchanged and unfrozen on successful and invalid semantic paths',()=>{
    const p=createProjection(root(F.candidate()));
    for(const value of [120,Infinity,NaN,undefined,null]) {
      const constraints={maxRuntimeMinutes:value,genres:['Synthetic Drama']};const descriptors=Object.getOwnPropertyDescriptors(constraints);
      const before=constraints.genres;constraintParity(p,constraints);
      assert.deepEqual(Object.getOwnPropertyDescriptors(constraints),descriptors);assert.strictEqual(constraints.genres,before);assert(Object.is(constraints.maxRuntimeMinutes,value));
      assert(!Object.isFrozen(constraints));assert(!Object.isFrozen(constraints.genres));
    }
  });
  await test('R11', 'nested supported arrays are owned immutable copies without caller aliases',()=>{
    const p=createProjection(root(F.candidate()));const constraints={context:'streaming',genres:['Synthetic Drama'],excludeMovieIds:[uid(900)]};
    const {actual}=constraintParity(p,constraints);assert.notStrictEqual(actual.constraints.genres,constraints.genres);assert.notStrictEqual(actual.constraints.excludeMovieIds,constraints.excludeMovieIds);
    constraints.genres.push('Later');constraints.excludeMovieIds[0]=M;
    assert.deepEqual(actual.constraints.genres,['Synthetic Drama']);assert.deepEqual(actual.constraints.excludeMovieIds,[uid(900)]);frozenTree(actual.constraints);
    const plain=Object.create(null);plain.context='streaming';assert.equal(constraintParity(p,plain).outcome.kind,'SUCCESS');
    const nested={extra:{values:[undefined,NaN,Infinity,false,0,'']}};
    const copied=p.getRecommendationInput({constraints:nested}).input.constraints.extra;
    assert.notStrictEqual(copied,nested.extra);assert.notStrictEqual(copied.values,nested.extra.values);assert.deepEqual(copied,nested.extra);assert(!Object.isFrozen(nested.extra));
  });
  await test('R12', 'unsupported structures and accessors fail closed without executing hooks',()=>{
    const p=createProjection(root(F.candidate()));let reads=0;
    const getter={};Object.defineProperty(getter,'maxRuntimeMinutes',{enumerable:true,get(){reads++;return 120;}});
    const element=[];Object.defineProperty(element,'0',{enumerable:true,get(){reads++;return 'Synthetic Drama';}});
    const toJSON={toJSON(){reads++;return {};}};const cycle={};cycle.extra=cycle;
    const hidden={};Object.defineProperty(hidden,'context',{value:'streaming',enumerable:false});
    const symbols={};symbols[Symbol('extra')]='value';
    const inherited=Object.create({context:'streaming'});
    const disguised=new Array(1);disguised.extra='Synthetic Drama';
    const accessorArrayProto=Object.create(Array.prototype);Object.defineProperty(accessorArrayProto,'0',{get(){reads++;return 'Synthetic Drama';}});
    const inheritedHole=new Array(1);Object.setPrototypeOf(inheritedHole,accessorArrayProto);
    const customDense=['Synthetic Drama'];Object.setPrototypeOf(customDense,accessorArrayProto);
    const malformed=[getter,{genres:element},toJSON,cycle,hidden,symbols,inherited,{genres:new Array(1)},{genres:disguised},{genres:inheritedHole},{genres:customDense},
      {extra:new Date(0)},{extra:new Map()},{extra:new Set()},{extra:()=>0},{extra:Symbol('value')},{extra:1n},new Date(0)];
    for(const constraints of malformed)assert.throws(()=>p.getRecommendationInput({constraints}),TypeError);
    assert.equal(reads,0);
  });
  await test('M01', 'Match content/eligibility are direct immutable server inputs',()=>{
    const p=createProjection(root(F.candidate())),input=p.getMatchInputs();assert.deepEqual(input.matchBaseIds,[M]);assert.equal(input.context.callerId,N);frozenTree(input);
    const completed=createProjection(root(F.completed())).getMatchInputs();assert.deepEqual(completed.matchBaseIds,[]);
  });
  await test('M02', 'Match session/swipe/presence never enter shadow state',async()=>{
    const h=harness();await h.online();const names=JSON.stringify(h.state());for(const k of ['swipeSessions','swipes','pendingMatch','Presence','frozenDeck'])assert(!names.includes(k));
  });
  await test('M03', 'projection cannot mutate external frozen deck/session',()=>{
    const deck=Object.freeze([M]),session=Object.freeze({id:uid(811),deck});const p=createProjection(root(F.scheduled()));p.getMatchInputs();assert.deepEqual(deck,[M]);assert.strictEqual(session.deck,deck);
  });
  await test('K01', 'cache writes one exact envelope and no private state',()=>{
    const store=storage(),cache=createCacheAdapter(store);assert(cache.write(root(),AT).ok);assert.equal(store.writes.length,1);
    const [key,value]=store.writes[0];assert.equal(key,'scorochiatu_snapshot_v1:'+N+':'+G);
    const record=JSON.parse(value);assert.deepEqual(Object.keys(record).sort(),['cache_format_version','caller_id','contract_version','group_id','saved_at','snapshot']);assert(!value.includes('requestSequence'));assert(!value.includes('thresholds'));
  });
  await test('K02', 'cache roundtrip preserves exact large Decimal and unavailable night',()=>{
    for(const s of [F.largeDecimals(),F.legacyNight(),F.tombstones()]) {const store=storage(),cache=createCacheAdapter(store);cache.write(root(s),AT);const hit=cache.load(F.context());assert.equal(hit.kind,'HIT');assert.deepEqual(hit.root.snapshot,s);assert(!Object.hasOwn(hit.root,'acceptance'));}
  });
  await test('K03', 'expired cache preserves original time and remains stale',()=>{
    const h=harness({cached:F.relationless()});h.controller.clearContext();h.setTime(addMs(NEXT,1000));h.controller.setContext(F.context());
    assert.equal(h.state().status,'STALE');assert.equal(h.state().view.root.snapshot.temporal.as_of,AT);assert.equal(h.state().view.root.snapshot.temporal.next_temporal_invalidation_at,NEXT);assert.equal(h.tasks.size,0);
  });
  await test('K04', 'no cache write from decode, failed online response or cache candidate',async()=>{
    const h=harness({cached:F.relationless()});assert.throws(()=>createCacheAdapter(h.store).write(h.state().view.root,AT));await h.start();await h.resolve({});assert.equal(h.store.writes.length,0);
  });
  await test('X01', 'CACHE v5 to ONLINE v4 rejected with no rewrite',async()=>{
    const h=harness({cached:versioned()});const prior=h.state().view;await h.start();await h.resolve(versioned('4'));
    assert.strictEqual(h.state().view,prior);assert.equal(h.state().view.source,'CACHE');assert.equal(h.state().status,'STALE');assert.equal(h.store.writes.length,0);
  });
  await test('X02', 'CACHE available night to ONLINE unavailable loses authority',async()=>{
    const h=harness({cached:F.scheduled()});const s=F.scheduled();s.versions.entries=s.versions.entries.filter(v=>v.scope_kind!=='night');F.finish(s);
    const prior=h.state().view;await h.start();await h.resolve(s);assert.strictEqual(h.state().view,prior);assert.equal(h.state().view.source,'CACHE');assert.equal(h.store.writes.length,0);
  });
  await test('X03', 'CACHE equal version can pass full online gates',async()=>{
    const h=harness({cached:versioned()});await h.start();await h.resolve(versioned());assert.equal(h.state().status,'READY');assert.equal(h.state().view.source,'ONLINE');assert.equal(h.state().view.root.acceptance.requestSequence,1);assert.equal(h.store.writes.length,1);
  });
  await test('X04', 'CACHE higher online revision accepted',async()=>{
    const h=harness({cached:versioned()});await h.start();await h.resolve(versioned('6'));assert.equal(h.state().view.source,'ONLINE');assert.equal(Core.getExpectedRevision(h.state().view.root,'person_film',N,M).version,'6');
  });
  await test('X05', 'CACHE coverage shrink fully removes newly unauthorized personal data',async()=>{
    const cached=F.otherList(),h=harness({cached});const s=copy(cached);s.people[1].personal_readable=false;s.personal=s.personal.filter(p=>p.person_id!==V);s.versions.entries=s.versions.entries.filter(v=>v.scope_id!==V);F.finish(s);
    await h.start();await h.resolve(s);assert.equal(h.state().view.source,'ONLINE');assert.equal(Core.getPersonalState(h.state().view.root,V,M),null);assert.equal(h.state().view.projection.legacy.movies[0].seen_v,null);
    assert(!h.state().view.root.snapshot.personal.some(p=>p.person_id===V));
  });
  await test('X06', 'CACHE cannot satisfy pending command thresholds',async()=>{
    const h=harness({cached:versioned()});h.controller.requireVersions({requestId:uid(820),affectedVersions:[affected()]});await drain();
    assert.equal(h.state().view.source,'CACHE');assert.equal(h.state().pending.requestIds.length,1);assert.equal(h.store.writes.length,0);
    await h.resolve(versioned('4'));assert.equal(h.state().pending.requestIds.length,1);assert.equal(h.state().view.source,'CACHE');
  });
  await test('X07', 'sparse/unsafe thresholds reject without changing state or starting read',async()=>{
    const h=harness();const before=h.state();
    for(const values of [new Array(1),[affected(),,],[affected(Number.MAX_SAFE_INTEGER+1)]])assert.throws(()=>h.controller.requireVersions({requestId:uid(821),affectedVersions:values}));
    assert.throws(()=>h.controller.requireVersions({requestId:'N',affectedVersions:[]}));assert.strictEqual(h.state(),before);assert.equal(h.reads.length,0);
    h.controller.requireVersions({requestId:uid(821),affectedVersions:[]});await drain();await h.resolve();assert.equal(h.state().status,'READY');
  });
  await test('X08', 'tombstone may satisfy version threshold without making entity writable',async()=>{
    const s=F.tombstones(),v=s.versions.entries.find(x=>x.scope_kind==='person_film');const h=harness();
    h.controller.requireVersions({requestId:uid(822),affectedVersions:[affected(v.version,v.scope_kind,v.scope_id,v.entity_id)]});await drain();await h.resolve(s);
    assert.equal(h.state().status,'READY');assert.equal(Core.getExpectedRevision(h.state().view.root,v.scope_kind,v.scope_id,v.entity_id).kind,'TOMBSTONED');assert.equal(h.state().pending.thresholds,null);
  });
  await test('X09', 'unavailable night never proves threshold or becomes zero',async()=>{
    const h=harness({cached:F.legacyNight()});h.controller.requireVersions({requestId:uid(823),affectedVersions:[affected('1','night',G,NIGHT)]});await drain();await h.resolve(F.legacyNight());
    assert.equal(h.state().view.source,'CACHE');assert.equal(h.state().pending.requestIds.length,1);assert.equal(Core.getExpectedRevision(h.state().view.root,'night',G,NIGHT).kind,'UNAVAILABLE');
  });
  await test('X10', 'early temporal callback rearms exact deadline',async()=>{
    const h=harness();await h.online();const temporal=[...h.tasks].find(([,t])=>t.at===NEXT);assert(temporal);h.tasks.delete(temporal[0]);temporal[1].fn();
    assert.equal(h.state().status,'READY');assert.equal(h.reads.length,1);assert([...h.tasks.values()].some(t=>t.at===NEXT));
  });
  await test('X11', 'nonterminating provider stays single-flight and disposal removes timers',async()=>{
    const h=harness({timeoutMs:100});await h.start();await h.advance(100);await h.advance(5000);await h.start('RECONNECT');assert.equal(h.reads.length,1);
    h.controller.dispose();assert.equal(h.tasks.size,0);const state=h.state();await h.resolve();assert.strictEqual(h.state(),state);
  });
  await test('X12', 'same identity new epoch waits for old physical read, never overlaps',async()=>{
    const h=harness();await h.start();h.controller.setContext(F.context());await h.start('MANUAL');assert.equal(h.reads.length,1);
    await h.resolve();assert.equal(h.reads.length,2);assert.equal(h.state().view,null);await h.resolve();assert.equal(h.state().status,'READY');assert.equal(h.state().context.contextEpoch,2);
  });
  await test('X13', 'CACHE same-version tombstone contradiction rejected',async()=>{
    const s=F.tombstones(),h=harness({cached:s});const next=copy(s);const m=s.versions.entries.find(v=>v.scope_kind==='content').entity_id;
    next.catalog.push(F.content(m));for(const p of next.personal)p.states.push(F.personalState(m));next.group.states.push(F.groupState(m));
    for(const v of next.versions.entries)if(v.entity_id===m && v.scope_kind!=='night')v.tombstone=false;F.finish(next);
    await h.start();await h.resolve(next);assert.equal(h.state().status,'CONTRACT_INVALID');assert.equal(h.state().view.source,'CACHE');assert.equal(h.store.writes.length,0);
  });
  await test('I01', 'no runtime reachability or direct I/O APIs in shadow modules',()=>{
    const names=['projection','controller','cache'];
    for(const entry of ['index.html','js/main.js','service-worker.js','js/store.js']) {
      const source=fs.readFileSync(path.join(__dirname,'..',entry),'utf8');
      for(const name of names)assert(!source.includes('snapshot/'+name+'.js'));
    }
    for(const name of names) {
      const source=fs.readFileSync(path.join(__dirname,'../js/snapshot',name+'.js'),'utf8').split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
      assert(!/\b(?:window|document|localStorage|sessionStorage|fetch|supabase|Realtime|setTimeout|setInterval|addEventListener)\b|Date\.now\s*\(/.test(source));
      const imports=[...source.matchAll(/require\('([^']+)'\)/g)].map(x=>x[1]);
      for(const target of imports)assert(['./core','./projection','./cache','../recommendation/adapters'].includes(target));
    }
  });
  await test('I02', 'module evaluation touches no browser globals',()=>{
    const vm=require('node:vm');
    for(const name of ['projection','controller','cache']) {
      let accesses=0;const sandbox={module:{exports:{}},require:id=>{
        const resolved=path.resolve(__dirname,'../js/snapshot',id);return require(resolved);
      }};
      for(const key of ['window','document','localStorage','fetch','supabase','Realtime','setTimeout','setInterval'])Object.defineProperty(sandbox,key,{get(){accesses++;throw Error('Forbidden global');}});
      vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/snapshot',name+'.js'),'utf8'),sandbox);assert.equal(accesses,0);
    }
  });
  await test('I03', 'controller construction performs no injected I/O or implicit clock read',()=>{
    let accesses=0;const trap=()=>{accesses++;throw Error('Unrequested dependency');};
    const c=createShadowController({provider:{read:trap},clock:{nowInstant:trap},scheduler:{scheduleAt:trap,cancel:trap},storage:{getItem:trap,setItem:trap,removeItem:trap}});
    assert.equal(c.getState().view,null);assert.equal(accesses,0);assert.deepEqual(Object.keys(c).sort(),['getState','subscribe','requestRefresh','setContext','clearContext','requireVersions','dispose'].sort());
  });
  await test('U01', 'subscription validation, no implicit event, independent duplicate registrations',async()=>{
    const h=harness(),events=[],listener=e=>events.push(e);
    for(const value of [null,{},1,'listener'])assert.throws(()=>h.controller.subscribe(value),TypeError);
    const off1=h.controller.subscribe(listener),off2=h.controller.subscribe(listener);assert.equal(events.length,0);
    await h.online();assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,2);
    off1();off1();events.length=0;await h.start('MANUAL');await h.resolve();assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,1);
    off2();events.length=0;await h.start('MANUAL');await h.resolve();assert.equal(events.length,0);
  });
  await test('U02', 'online commit has frozen envelope and atomic root/projection/selectors/pending',async()=>{
    const h=harness(),commits=[];h.controller.subscribe(e=>{if(e.type==='VIEW_COMMITTED')commits.push(e);});
    h.controller.requireVersions({requestId:uid(850),affectedVersions:[affected()]});await drain();await h.resolve(versioned());
    assert.equal(commits.length,1);const e=commits[0];frozenTree(e);assert.strictEqual(e.state,h.state());
    assert.equal(e.contextEpoch,h.state().context.contextEpoch);assert.equal(e.state.view.source,'ONLINE');
    assert.strictEqual(e.state.view.root.context,e.state.view.projection.context);assert.strictEqual(e.state.view.selectors,e.state.view.projection.selectors);
    assert.equal(e.state.pending.thresholds,null);assert.deepEqual(e.state.pending.requestIds,[]);
    assert.throws(()=>{e.type='STATUS_CHANGED';},TypeError);assert.throws(()=>{e.state.view.root.snapshot.catalog.length=0;},TypeError);
  });
  await test('U03', 'cache bootstrap commits CACHE stale and online acceptance commits ONLINE',async()=>{
    const events=[],h=harness({cached:versioned(),onController:c=>c.subscribe(e=>events.push(e))});
    const cacheEvents=events.filter(e=>e.type==='VIEW_COMMITTED');assert.equal(cacheEvents.length,1);
    assert.equal(cacheEvents[0].state.view.source,'CACHE');assert.equal(cacheEvents[0].state.status,'STALE');assert.equal(cacheEvents[0].state.freshness.validatedOnline,false);
    assert(!Object.hasOwn(cacheEvents[0].state.view.root,'acceptance'));
    h.controller.requireVersions({requestId:uid(851),affectedVersions:[affected()]});await drain();assert.equal(h.state().pending.requestIds.length,1);
    await h.resolve(versioned());assert.deepEqual(events.filter(e=>e.type==='VIEW_COMMITTED').map(e=>e.state.view.source),['CACHE','ONLINE']);
  });
  await test('U04', 'status changes remain distinct from domain commits',async()=>{
    const h=harness(),events=[];h.controller.subscribe(e=>events.push(e));await h.start();
    assert.deepEqual(events.map(e=>e.type),['STATUS_CHANGED']);assert.equal(events[0].state.status,'LOADING');await h.resolve();
    assert.deepEqual(events.map(e=>e.type),['STATUS_CHANGED','VIEW_COMMITTED']);
    await h.advance(Date.parse(NEXT)-Date.parse(AT));assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,1);assert(events.some(e=>e.type==='STATUS_CHANGED'&&e.state.status==='STALE'));
  });
  await test('U05', 'malformed/regressed/behind-threshold candidates publish no commit',async()=>{
    for(const mode of ['malformed','regressed','threshold']) {
      const h=harness(),events=[];await h.online(versioned());h.controller.subscribe(e=>events.push(e));
      if(mode==='threshold')h.controller.requireVersions({requestId:uid(852),affectedVersions:[affected('6')]});else await h.start('MANUAL');
      await drain();await h.resolve(mode==='malformed'?{}:versioned('4'));assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,0);
    }
  });
  await test('U06', 'cache persistence success/failure never duplicates commit',async()=>{
    for(const fail of [false,true]) {
      const h=harness(),events=[];h.store.fail=fail;h.controller.subscribe(e=>events.push(e));await h.online();
      assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,1);assert.equal(events.length,2);
      if(fail)assert(events[1].state.diagnostics.some(d=>d.code==='CACHE_WRITE_FAILED'));
    }
  });
  await test('U07', 'clear boundary exposes no prior private view and retains cleared epoch',async()=>{
    const h=harness();await h.online();const epoch=h.state().context.contextEpoch,events=[];h.controller.subscribe(e=>events.push(e));
    h.controller.clearContext();assert.equal(events.length,1);assert.equal(events[0].type,'VIEW_CLEARED');assert.equal(events[0].contextEpoch,epoch);
    assert.equal(events[0].state.context,null);assert.equal(events[0].state.view,null);assert.deepEqual(events[0].state.pending.requestIds,[]);
  });
  await test('U08', 'auth invalidation publishes cleared view, never old sensitive bundle',async()=>{
    const h=harness();await h.online();const events=[];h.controller.subscribe(e=>events.push(e));await h.start();await h.resolve(F.serverError('UNAUTHENTICATED'));
    const clear=events.filter(e=>e.type==='VIEW_CLEARED');assert.equal(clear.length,1);assert.equal(clear[0].state.view,null);assert.equal(clear[0].state.status,'AUTH_INVALID');
    assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,0);
  });
  await test('U09', 'listener exceptions neither propagate nor reclassify accepted state',async()=>{
    const h=harness(),events=[];h.controller.subscribe(()=>{throw Error('Synthetic observer failure');});h.controller.subscribe(e=>events.push(e));await h.online();
    assert.equal(h.state().status,'READY');assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,1);assert(!h.state().diagnostics.some(d=>d.code==='ORCHESTRATION_ERROR'));
  });
  await test('U10', 'all mutating APIs explicitly reject synchronous reentrancy',async()=>{
    const h=harness(),errors=[];h.controller.subscribe(e=>{
      if(e.type!=='VIEW_COMMITTED')return;
      const before=h.state();for(const call of [()=>h.controller.requestRefresh(),()=>h.controller.setContext(F.context()),()=>h.controller.clearContext(),
        ()=>h.controller.requireVersions({requestId:uid(853),affectedVersions:[]}),()=>h.controller.dispose()]) {
        assert.throws(call,/mutation during publication/);errors.push(true);assert.strictEqual(h.state(),before);
      }
    });await h.online();assert.equal(errors.length,5);assert.equal(h.reads.length,1);
  });
  await test('U11', 'unsubscribe during notification skips removed listener; additions wait next pass',async()=>{
    const h=harness(),calls=[];let offSecond,offFirst;
    offFirst=h.controller.subscribe(e=>{if(e.type==='VIEW_COMMITTED'){calls.push('first');offSecond();h.controller.subscribe(x=>{if(x.type==='VIEW_COMMITTED')calls.push('added');});offFirst();}});
    offSecond=h.controller.subscribe(e=>{if(e.type==='VIEW_COMMITTED')calls.push('second');});
    await h.online();assert.deepEqual(calls,['first']);await h.start();await h.resolve();assert.deepEqual(calls,['first','added']);
  });
  await test('U12', 'late old-context results and finally publish nothing into new context',async()=>{
    const h=harness(),events=[];await h.start();h.controller.subscribe(e=>events.push(e));const nextG=uid(3200);
    h.controller.setContext(F.context({groupId:nextG}));await h.start();const s=F.relationless();s.selected_group.group_id=nextG;s.coverage.group_id=nextG;
    await h.resolve(s,1);const n=events.length,state=h.state();await h.resolve(F.relationless(),0);assert.equal(events.length,n);assert.strictEqual(h.state(),state);
    assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,1);assert.equal(events.find(e=>e.type==='VIEW_COMMITTED').state.context.groupId,nextG);
  });
  await test('U13', 'context switch publishes clear before next-context cache commit',async()=>{
    const h=harness({cached:versioned()}),events=[];h.controller.subscribe(e=>events.push(e));h.controller.setContext(F.context());
    assert.deepEqual(events.map(e=>e.type),['VIEW_CLEARED','VIEW_COMMITTED']);assert.equal(events[0].state.view,null);
    assert.equal(events[1].state.view.source,'CACHE');assert(events[1].contextEpoch>events[0].contextEpoch);
  });
  await test('U14', 'dispose clears once and suppresses every late publication',async()=>{
    const h=harness(),events=[];await h.online();await h.start();const off=h.controller.subscribe(e=>events.push(e));h.controller.dispose();
    assert.deepEqual(events.map(e=>e.type),['VIEW_CLEARED']);assert.equal(events[0].state.view,null);const state=h.state();
    off();off();h.controller.dispose();h.controller.clearContext();h.controller.requestRefresh();await h.resolve();await h.advance(100000);
    assert.equal(events.length,1);assert.strictEqual(h.state(),state);assert.throws(()=>h.controller.subscribe(()=>{}),/Disposed/);
  });
  await test('U15', 'dirty coalescing still commits exactly once per accepted read',async()=>{
    const h=harness(),commits=[];h.controller.subscribe(e=>{if(e.type==='VIEW_COMMITTED')commits.push(e);});
    await h.start();h.controller.requestRefresh();h.controller.requestRefresh();await h.resolve();assert.equal(h.reads.length,2);assert.equal(commits.length,1);
    await h.resolve();assert.equal(commits.length,2);assert.deepEqual(commits.map(e=>e.state.view.root.acceptance.requestSequence),[1,2]);
  });
  await test('U16', 'threshold arriving during read appears atomically cleared only on qualifying commit',async()=>{
    const h=harness(),events=[];await h.online();h.controller.subscribe(e=>events.push(e));await h.start();h.controller.requireVersions({requestId:uid(854),affectedVersions:[affected()]});
    await h.resolve(versioned('4'));assert.equal(events.filter(e=>e.type==='VIEW_COMMITTED').length,0);assert.equal(h.state().pending.requestIds.length,1);
    await h.resolve(versioned());const commits=events.filter(e=>e.type==='VIEW_COMMITTED');assert.equal(commits.length,1);assert.equal(commits[0].state.pending.thresholds,null);
  });
  await test('U17', 'published selectors and projection contain the new generation, old view remains intact',async()=>{
    const h=harness();await h.online();const old=h.state().view,events=[];
    assert.equal(old.selectors.getPersonalListMovies(N).movies.length,0);
    h.controller.subscribe(e=>{if(e.type==='VIEW_COMMITTED')events.push(e);});
    h.controller.requireVersions({requestId:uid(855),affectedVersions:[affected()]});await drain();await h.resolve(versioned());
    assert.equal(events.length,1);const view=events[0].state.view;
    assert.notStrictEqual(view.root,old.root);assert.notStrictEqual(view.projection,old.projection);assert.notStrictEqual(view.selectors,old.selectors);
    assert.equal(view.root.indexes.getPersonalState(N,M).list.active,true);assert.equal(view.selectors.getPersonalListMovies(N).movies[0].movie_id,M);
    assert.equal(old.selectors.getPersonalListMovies(N).movies.length,0);assert.equal(events[0].state.pending.thresholds,null);
  });
  await test('B01', 'scale benchmark separates decode/projection/acceptance/bundle/cache costs',()=>{
    const rows=[];
    for(const [contents,nights] of [[500,125],[2000,500]]) {
      const raw=F.scale({contents,nights}),accepted=root(raw),store=storage(),cache=createCacheAdapter(store),samples={decode:[],projection:[],acceptance:[],bundle:[],serialize:[],parse:[]};
      for(let i=0;i<9;i++) {
        let at=performance.now();const d=decoded(raw);const decode=performance.now()-at;
        at=performance.now();const p=createProjection(d.candidate);const projection=performance.now()-at;
        at=performance.now();const decision=Core.evaluateAcceptance({decoded:d,current:accepted,expectedContext:F.context(),requestMeta:{context:F.context(),requestSequence:2},latestRequestSequence:2,thresholds:null,nowInstant:AT});assert.equal(decision.outcome,'ACCEPT');const acceptance=performance.now()-at;
        at=performance.now();const bundle=Object.freeze({root:decision.nextRoot,source:'ONLINE',projection:p,selectors:p.selectors});assert.strictEqual(bundle.root.snapshot,d.candidate.snapshot);assert.strictEqual(bundle.projection.context,bundle.root.context);const construction=performance.now()-at;
        at=performance.now();cache.write(decision.nextRoot,AT);const serialize=performance.now()-at;
        at=performance.now();assert.equal(cache.load(F.context()).kind,'HIT');const parse=performance.now()-at;
        if(i>=2)for(const [k,v] of Object.entries({decode,projection,acceptance,bundle:construction,serialize,parse}))samples[k].push(v);
      }
      const medians=Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,Number(v.sort((a,b)=>a-b)[Math.floor(v.length/2)].toFixed(3))]));
      for(const ms of Object.values(medians))assert(ms<500,'Diagnostic threshold exceeded');
      const row={contents,nights,bytes:Buffer.byteLength(JSON.stringify(raw)),samples:7,median_ms:medians};rows.push(row);console.log('BENCHMARK',JSON.stringify(row));
    }
    assert(rows[1].median_ms.decode/rows[0].median_ms.decode<6);assert(rows[1].median_ms.projection/Math.max(rows[0].median_ms.projection,0.01)<6);
  });
  assert.equal(count,94);console.log('Snapshot shadow: '+count+'/94 PASS; synthetic-only; no runtime activation.');
}
main().catch(e=>{console.error('FAIL after '+count+' groups:',e.stack);process.exitCode=1;});
