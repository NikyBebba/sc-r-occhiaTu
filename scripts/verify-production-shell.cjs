#!/usr/bin/env node
'use strict';
// The host and every child module are real. Fakes are restricted to verified
// identity, RPC/server state, storage, time and injected lifecycle boundaries.
function fixtureData() {
  const F = require('./fixtures/snapshot-v1.cjs');
  const raw = require('./verify-target-match-adapter.cjs').fixtureData().raw;
  const absent = F.relationless();
  const unavailable = JSON.parse(JSON.stringify(raw)); unavailable.people[1].personal_readable = false; unavailable.personal.pop(); F.finish(unavailable);
  const quickCard=JSON.parse(JSON.stringify(raw));
  quickCard.nights.push({...F.night(),status:'confirmed',date:null,time:null,confirmed_at:F.AT});
  quickCard.versions.entries.push(F.version('night',F.G,F.NIGHT));
  quickCard.group.states.find(g=>g.movie_id===F.M).list_visible=false;
  F.finish(quickCard);
  const seen=(wire,index)=>{wire.personal[index].states[0].seen=true;wire.exposure.push({person_id:wire.personal[index].person_id,movie_id:F.M,sources:['PERSONAL_SEEN']});return F.finish(wire);};
  const addNight=(wire,date='2027-01-05',id=F.uid(20009))=>{wire.nights.push({...F.night(id,F.M,'confirmed'),date,time:date?'21:30':null,confirmed_at:F.AT});wire.versions.entries.push(F.version('night',F.G,id));wire.group.states[0].list_visible=false;wire.group.states[0].rewatch_visible=false;wire.group.states[0].eligibility={match_base:false,ruota_base:false};return F.finish(wire);};
  const repeat=F.completed();repeat.nights.push({...F.night(F.uid(20002),F.M,'completed'),snack:'Secondo snack'});repeat.versions.entries.push(F.version('night',F.G,F.uid(20002)));repeat.participants.push({night_id:F.uid(20002),person_id:F.N});F.finish(repeat);
  const togetherList=F.completed();togetherList.personal[0].states[0].list={active:true,generation:'1'};F.finish(togetherList);
  const agenda=F.base();
  for(const [number,status,date] of [[20001,'proposed','2027-01-03'],[20002,'confirmed','2027-01-03'],[20003,'confirmed',null],[20004,'confirmed','2027-01-05']]){
    const id=F.uid(number),night={...F.night(id,F.M,status),date,time:date?'21:30':null,snack:'Poke',location:'Casa',confirmed_at:status==='confirmed'?F.AT:null};
    agenda.nights.push(night);agenda.versions.entries.push(F.version('night',F.G,id));
  }
  F.finish(agenda);
  const recommendationSet=F.base(Array.from({length:12},(_,index)=>F.uid(index+1)));
  for(const [index,row] of recommendationSet.catalog.entries()){
    row.title='Proposal '+String(index+1).padStart(2,'0');row.release_year=2000+index;row.duration='110 min';
    Object.assign(recommendationSet.group.states[index],{effective_candidacy:true,list_visible:true,eligibility:{match_base:true,ruota_base:true}});
  }
  recommendationSet.personal[0].states[0].judgment.rating=8;
  F.finish(recommendationSet);
  const metadata=F.completed();
  Object.assign(metadata.catalog[0],{tmdb_id:'777',poster:'https://example.test/old.jpg',overview:'Trama precedente',platform:'Netflix',cinema_watchlist:true});
  metadata.personal[0].states[0].list={active:true,generation:'1'};
  metadata.personal[0].states[0].judgment.rating=8;
  metadata.nights[0].snack='Poke';metadata.nights[0].location='Casa';F.finish(metadata);
  const withCancelled=(wire,id=F.uid(20003))=>{
    wire.nights.push({...F.night(id,F.M,'cancelled'),cancelled_at:F.AT});
    wire.versions.entries.push(F.version('night',F.G,id));return F.finish(wire);
  };
  const cancelledOnly=withCancelled(F.base());
  const cancelledCompleted=withCancelled(F.completed());
  const cancelledOpen=withCancelled(F.scheduled());
  const cancelledMixed=withCancelled(F.completed());
  cancelledMixed.nights.push(F.night(F.uid(20002),F.M,'proposed'));
  cancelledMixed.versions.entries.push(F.version('night',F.G,F.uid(20002)));F.finish(cancelledMixed);
  const detailCases=[['none',F.relationless(),'shared'],['mine',F.selfList(),'choose'],['shared',F.candidate(),'choose'],['seenme',seen(F.relationless(),0),'myJudgment'],['seenother',seen(F.relationless(),1),'seen'],['separate',F.rewatch(),'shared'],['together',F.completed(),'groupJudgment'],['again',togetherList,'choose'],['future',addNight(F.relationless()),'nights'],['due',addNight(F.relationless(),'2027-01-03'),'complete'],['repeat',repeat,'nights'],['pastfuture',addNight(F.completed()),'nights']];
  return { detailCases, quickCard, agenda, recommendationSet, metadata, cancelledOnly, cancelledCompleted, cancelledOpen, cancelledMixed,
    noEligible: F.scheduled(), raw, absent, unavailable, selfList:F.selfList(), seenOther:seen(F.relationless(),1), rewatch: F.rewatch(), multiple: F.multipleEvents(), N: F.N, V: F.V, G: F.G, M: F.M, Q: F.Q, R: F.uid(3), NIGHT: F.NIGHT, observer: F.uid(998000), other: F.uid(998001), at: F.AT };
}
async function runChecks(modules, data, onCase = () => {}, selected = () => true) {
  // Component regressions inject explicit legacy authority; normal negotiation
  // is exercised separately by verify-protocol-session.cjs.
  const productionEntry = modules.originalSession;
  const legacyFixture = modules.createCoordinator({ mode: 'LEGACY', legacy: { start() { requireAppIdentity(); subscribeRealtime(); loadMovies().catch(() => {}); }, stop() { unsubscribeRealtime(); leaveMatch(true); }, async refresh() { subscribeRealtime(); await resyncQuiet(); } } });
  modules = { ...modules, originalSession: Object.freeze({ ...legacyFixture, invalidateAuth: () => productionEntry.invalidateAuth() }) };

  const { Core, Cache, Engine, Shell } = modules;
  const Production = { createProductionHost(options) {
    const coordinator = modules.createCoordinator({ ...options, mode: 'TARGET' });
    modules.install(coordinator);
    return Object.freeze({ ...coordinator, startTarget: () => coordinator.startAuthenticated(data.N), replaceAuthenticatedSession: () => coordinator.startAuthenticated(data.N), stop: coordinator.invalidateAuth });
  } };
  let cases = 0, assertions = 0, worstSnapshotReads = 0, worstMatchReads = 0, worstHostPublications = 0;
  const check = (ok, m) => { if (!ok) throw Error(m); assertions++; };
  const eq = (a, b, m) => check(a === b, m + ': ' + String(a) + ' != ' + String(b));
  const copy = x => JSON.parse(JSON.stringify(x));
  const deep = (a, b, m) => eq(JSON.stringify(a), JSON.stringify(b), m);
  const tick = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const freezeCheck = x => { check(Object.isFrozen(x), 'frozen'); for (const v of Object.values(x)) if (v && typeof v === 'object') freezeCheck(v); };
  // Synthetic server fixture bookkeeping only. This does not run in the host.
  function finish(w) {
    const sort = (a, key) => a.sort((x, y) => key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0);
    sort(w.catalog, x => x.movie_id); sort(w.group.states, x => x.movie_id); sort(w.nights, x => x.night_id);
    sort(w.versions.entries, x => x.scope_kind + '|' + x.scope_id + '|' + x.entity_id);
    sort(w.participants, x => x.night_id + '|' + x.person_id); sort(w.group.judgments, x => x.movie_id);
    w.selected_group.member_person_ids = w.people.filter(p => p.personal_readable).map(p => p.person_id); w.coverage.personal_person_ids = [...w.selected_group.member_person_ids];
    for (const p of w.personal) p.collections = { list_movie_ids: p.states.filter(x => x.list.active).map(x => x.movie_id), seen_movie_ids: p.states.filter(x => x.seen).map(x => x.movie_id) };
    for (const g of w.group.states) { g.active_night_ids = w.nights.filter(n => n.movie_id === g.movie_id && ['proposed', 'confirmed'].includes(n.status)).map(n => n.night_id); g.completed_night_ids = w.nights.filter(n => n.movie_id === g.movie_id && n.status === 'completed').map(n => n.night_id); }
    w.group.collections = { list_movie_ids: w.group.states.filter(g => g.list_visible).map(g => g.movie_id), scheduled_night_ids: w.nights.filter(n => ['proposed', 'confirmed'].includes(n.status)).map(n => n.night_id), together_movie_ids: w.group.states.filter(g => g.completed_night_ids.length).map(g => g.movie_id), rewatch_movie_ids: w.group.states.filter(g => g.rewatch_visible).map(g => g.movie_id) };
    w.exposure = [];
    for (const person of w.people) for (const m of w.catalog) {
      const sources = []; if (w.personal.find(p => p.person_id === person.person_id)?.states.find(s => s.movie_id === m.movie_id)?.seen) sources.push('PERSONAL_SEEN');
      if (w.nights.some(n => n.movie_id === m.movie_id && n.status === 'completed' && w.participants.some(p => p.night_id === n.night_id && p.person_id === person.person_id))) sources.push('SELECTED_GROUP_TOGETHER');
      if (sources.length) w.exposure.push({ person_id: person.person_id, movie_id: m.movie_id, sources });
    }
    sort(w.exposure, x => x.person_id + '|' + x.movie_id);
    w.versions.unavailable_night_ids = w.nights.filter(n => !w.versions.entries.some(v => v.scope_kind === 'night' && v.entity_id === n.night_id)).map(n => n.night_id);
    w.coverage.counts = { catalog: w.catalog.length, people: w.people.length, personal_views: w.personal.length, personal_states: w.personal.reduce((n, p) => n + p.states.length, 0), group_states: w.group.states.length, group_judgments: w.group.judgments.length, nights: w.nights.length, participants: w.participants.length, exposure: w.exposure.length, vetoes: w.vetoes.length, version_entries: w.versions.entries.length, night_tokens_unavailable: w.versions.unavailable_night_ids.length };
    return w;
  }
  async function make(options = {}) {
    const jobs = [], snapshots = [], commands = [], invalidation = [], matchCalls = [], matchReads = [], rt = [], presence = [], publications = [], timers = new Map(), records = new Map(), receipts = new Map();
    let serial = 0, request = 998100, contentSerial = 95000, nightSerial = 20000, swipeSerial = 70000, matchSerial = 60000;
    const controls = { wire: copy(options.raw ?? data.raw), caller: options.caller ?? data.N, group: data.G, holdSnapshot: !!options.cached, holdCommand: false, commandOutcome: null, uncertain: false, snapshotError: null, matchUncertain: null, matchBefore: null, matchHold: false, matchReadUnavailable: false, matchCloseOutcome: null, satisfyOnComplete: false };
    const matchServer = { session: null, swipes: [] };
    function wire() {
      const w = copy(controls.wire); w.caller.person_id = controls.caller; w.selected_group.group_id = controls.group; w.coverage.group_id = controls.group;
      for (const v of w.versions.entries) if (['group_film', 'night'].includes(v.scope_kind)) v.scope_id = controls.group;
      for (const p of w.personal) if (p.person_id !== controls.caller) for (const s of p.states) s.list.generation = null;
      return finish(w);
    }
    function bump(kind, scope, id) {
      let v = controls.wire.versions.entries.find(x => x.scope_kind === kind && x.scope_id === scope && x.entity_id === id);
      if (!v) { v = { scope_kind: kind, scope_id: scope, entity_id: id, version: '0', tombstone: false }; controls.wire.versions.entries.push(v); }
      v.version = String(BigInt(v.version) + 1n); return { scope_kind: kind, scope_id: scope, entity_id: id, version: v.version };
    }
    function commandServer(body, caller, groupId) {
      const prior = receipts.get(body.request_id);
      if (prior) return { ...copy(prior), replayed: true };
      const outcome = controls.commandOutcome;
      if (outcome === 'ALREADY_IN_TARGET_STATE') return { protocol_version: 1, request_id: body.request_id, outcome, replayed: false, result: { movie_id: body.target.movie_id, night_id: null }, affected_versions: [] };
      if (outcome === 'STALE') return { protocol_version: 1, request_id: body.request_id, outcome, current_versions: [] };
      if (outcome === 'REQUEST_ID_REUSE') return { protocol_version: 1, request_id: body.request_id, outcome };
      if (outcome) return { protocol_version: 1, request_id: body.request_id, outcome: 'ERROR', error: { code: outcome } };
      const w = controls.wire, p = body.parameters, id = body.target.movie_id, intent = body.intent, affected = [];
      const personal = w.personal.find(x => x.person_id === caller)?.states.find(x => x.movie_id === id);
      const group = w.group.states.find(x => x.movie_id === id); let nid = body.target.night_id, createdId = null;
      if (['ADD_PERSONAL_LIST', 'REMOVE_PERSONAL_LIST'].includes(intent)) { personal.list = { active: intent === 'ADD_PERSONAL_LIST', generation: '1' }; affected.push(bump('person_film', caller, id)); }
      else if (['RETROSPECTIVE_SEEN', 'REMOVE_PERSONAL_SEEN'].includes(intent)) { personal.seen = intent === 'RETROSPECTIVE_SEEN'; affected.push(bump('person_film', caller, id)); }
      else if (intent === 'SET_PERSONAL_EVALUATION') { Object.assign(personal.judgment, p); affected.push(bump('person_film', caller, id)); }
      else if (['PROPOSE_TO_GROUP', 'WITHDRAW_GROUP_CANDIDACY'].includes(intent)) { group.effective_candidacy = intent === 'PROPOSE_TO_GROUP'; group.list_visible = group.effective_candidacy && !group.active_night_ids.length; group.eligibility = { match_base: group.list_visible && !group.completed_night_ids.length, ruota_base: group.list_visible && !group.completed_night_ids.length }; affected.push(bump('group_film', groupId, id)); }
      else if (['SCHEDULE_NIGHT', 'QUICK_NIGHT', 'COMPLETE_NOW', 'COMPLETE_NOW_WITH_CONTEXT'].includes(intent)) {
        nid = uid(++nightSerial); const complete = intent.startsWith('COMPLETE_NOW');
        w.nights.push({ night_id: nid, movie_id: id, status: complete ? 'completed' : intent === 'QUICK_NIGHT' ? 'confirmed' : 'proposed', date: p.date ?? null, time: p.time ?? null, snack: p.snack ?? null, location: p.location ?? null, proposed_by_person_id: caller, created_at: data.at, confirmed_at: intent === 'QUICK_NIGHT' ? data.at : null, cancelled_at: null, completed_at: complete ? data.at : null });
        if (complete) { for (const person_id of p.participants) w.participants.push({ night_id: nid, person_id }); group.effective_candidacy = false; affected.push(bump('group_film', groupId, id)); }
        group.list_visible = false; group.eligibility = { match_base: false, ruota_base: false }; affected.push(bump('night', groupId, nid));
      } else if (['CONFIRM_NIGHT', 'CANCEL_NIGHT', 'EDIT_NIGHT', 'COMPLETE_NIGHT'].includes(intent)) {
        const n = w.nights.find(n => n.night_id === nid);
        if (intent === 'CONFIRM_NIGHT') { n.status = 'confirmed'; n.confirmed_at = data.at; }
        if (intent === 'CANCEL_NIGHT') { n.status = 'cancelled'; n.cancelled_at = data.at; }
        if (intent === 'EDIT_NIGHT') for (const k of ['date', 'time', 'snack', 'location']) if (Object.hasOwn(p, k)) n[k] = p[k];
        if (intent === 'COMPLETE_NIGHT') {
          n.status = 'completed'; n.completed_at = data.at; for (const person_id of p.participants) w.participants.push({ night_id: nid, person_id });
          group.effective_candidacy = false; group.list_visible = false; group.eligibility = { match_base: false, ruota_base: false }; affected.push(bump('group_film', groupId, id));
          if (controls.satisfyOnComplete && personal.list.active) { personal.list.active = false; affected.push(bump('person_film', caller, id)); }
        }
        affected.push(bump('night', groupId, nid));
      } else if (intent === 'CONTENT_CREATE') {
        const movie = copy(w.catalog[0]); movie.movie_id = createdId = uid(++contentSerial); movie.title = p.title; w.catalog.push(movie);
        for (const person of w.personal) { const state = copy(person.states[0]); state.movie_id = movie.movie_id; state.seen = false; state.list = { active: false, generation: null }; state.judgment = { rating: null, preference: null, review: null }; person.states.push(state); }
        const state = copy(w.group.states[0]); Object.assign(state, { movie_id: movie.movie_id, effective_candidacy: false, list_visible: false, active_night_ids: [], completed_night_ids: [], rewatch_semantic: false, rewatch_visible: false, eligibility: { match_base: false, ruota_base: false } }); w.group.states.push(state);
        affected.push(bump('content', movie.movie_id, movie.movie_id));
      } else if (intent === 'CONTENT_UPDATE_METADATA') { Object.assign(w.catalog.find(x => x.movie_id === id), p); affected.push(bump('content', id, id));
      } else if (intent === 'SET_TOGETHER_EVALUATION') {
        let j=w.group.judgments.find(j=>j.movie_id===id);if(!j){j={movie_id:id,rating:null,review:null};w.group.judgments.push(j);}Object.assign(j,p);if(j.rating===null&&j.review===null)w.group.judgments=w.group.judgments.filter(x=>x!==j);affected.push(bump('group_film',groupId,id));
      } else if (intent === 'CONTENT_SET_CINEMA' || intent === 'CONTENT_SET_SURPRISE') {
        const c=w.catalog.find(x=>x.movie_id===id);if(intent==='CONTENT_SET_CINEMA'){c.cinema_watchlist=p.value;group.eligibility={match_base:!p.value&&group.list_visible,ruota_base:!p.value&&group.list_visible};}else c.surprise_by_person_id=p.enabled?caller:null;affected.push(bump('content',id,id));
      } else if (intent === 'CONTENT_DELETE') {
        w.catalog=w.catalog.filter(c=>c.movie_id!==id);w.group.states=w.group.states.filter(c=>c.movie_id!==id);w.group.judgments=w.group.judgments.filter(c=>c.movie_id!==id);for(const person of w.personal)person.states=person.states.filter(c=>c.movie_id!==id);affected.push(bump('content',id,id));w.versions.entries.find(v=>v.scope_kind==='content'&&v.entity_id===id).tombstone=true;
      } else if (intent === 'VETO_ADD' || intent === 'VETO_REMOVE') {
        w.vetoes=w.vetoes.filter(v=>v.movie_id!==id);if(intent==='VETO_ADD')w.vetoes.push({veto_id:uid(96001),person_id:caller,movie_id:id,week_key:w.temporal.week_key});group.eligibility={match_base:intent==='VETO_REMOVE'&&group.list_visible,ruota_base:intent==='VETO_REMOVE'&&group.list_visible};affected.push(bump('group_film',groupId,id));
      } else throw Error('Unexpected shared intent ' + intent);
      finish(w);
      const response = { protocol_version: 1, request_id: body.request_id, outcome: 'SUCCESS', replayed: false, result: { movie_id: createdId ?? id, night_id: nid }, affected_versions: affected };
      receipts.set(body.request_id, copy(response)); return response;
    }
    if (options.cached) {
      const raw = wire(), context = { callerId: controls.caller, groupId: controls.group, contractVersion: 1, contextEpoch: 1 };
      const decoded = Core.decodeSnapshotEnvelope(raw, context);
      const accepted = Core.evaluateAcceptance({ decoded, current: null, expectedContext: context, requestMeta: { context, requestSequence: 1 }, latestRequestSequence: 1, thresholds: null, nowInstant: data.at });
      eq(accepted.outcome, 'ACCEPT', 'cache fixture'); Cache.createCacheAdapter({ getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k) }).write(accepted.nextRoot, data.at);
    }
    let host;
    function matchProgress() {
      const s = matchServer.session, ids = s.deck.filter(id => host.getState().view.getMatchInput().matchBaseIds.includes(id));
      const rows = id => matchServer.swipes.filter(w => w.movie_id === id);
      const last = [...ids].reverse().find(id => rows(id).filter(w => w.liked).length === 2) ?? null;
      return { pending: last !== s.matched_movie_id ? last : null, done: ids.every(id => rows(id).length === 2) };
    }
    const matchResponse = outcome => ({ outcome, session: copy(matchServer.session), swipes: copy(matchServer.swipes) });
    function matchExecute(req, actor) {
      const a = req.p_action, p = req.p_parameters; let s = matchServer.session;
      if (controls.matchError) return { outcome: 'ERROR', error: { code: controls.matchError } };
      if (a === 'start') {
        if (s && ['open', 'matched'].includes(s.status)) return matchResponse('ALREADY_IN_TARGET_STATE');
        matchServer.session = { id: uid(++matchSerial), created_by: actor === data.N ? 'N' : 'V', seed: p.seed, deck: copy(p.deck), status: 'open', matched_movie_id: null, matched_at: null, created_at: data.at }; matchServer.swipes = []; return matchResponse('SUCCESS');
      }
      if (!s || s.id !== p.session_id) return { outcome: 'STALE', session: null };
      if (a === 'swipe') { const person = actor === data.N ? 'N' : 'V'; if (matchServer.swipes.some(w => w.movie_id === p.movie_id && w.person === person)) return matchResponse('ALREADY_IN_TARGET_STATE'); matchServer.swipes.push({ id: uid(++swipeSerial), session_id: s.id, movie_id: p.movie_id, person, liked: p.liked, created_at: data.at }); return matchResponse('SUCCESS'); }
      if (a === 'close') { if (controls.matchCloseOutcome === 'ERROR') return { outcome: 'ERROR', error: { code: 'TRANSIENT_FAILURE' } }; if (controls.matchCloseOutcome === 'STALE') s.status = 'closed'; if (!['open', 'matched'].includes(s.status)) return { outcome: 'STALE', session: copy(s) }; s.status = 'closed'; return matchResponse('SUCCESS'); }
      const progress = matchProgress();
      if (a === 'reconcile-done') { if (s.status === 'open' && progress.done && !progress.pending) { s.status = 'done'; return matchResponse('SUCCESS'); } return matchResponse('ALREADY_IN_TARGET_STATE'); }
      if (a === 'acknowledge-match') { if (s.matched_movie_id === p.matched_movie_id) return matchResponse('ALREADY_IN_TARGET_STATE'); if (progress.pending !== p.matched_movie_id || !['open', 'matched'].includes(s.status)) return { outcome: 'STALE', session: copy(s) }; s.matched_movie_id = p.matched_movie_id; s.matched_at = data.at; s.status = progress.done ? 'done' : 'open'; return matchResponse('SUCCESS'); }
      throw Error('Unexpected Match action');
    }
    const runtimeDependencies = {
      auth: { async getVerifiedIdentity() { return { callerId: controls.caller }; } },
      rpc(name, args) {
        if (name === 'get_app_runtime_context' && controls.bootstrapError) return Promise.resolve({data:{bootstrap_contract_version:1,outcome:'ERROR',error:{code:controls.bootstrapError}},error:null});
        if (name === 'get_app_runtime_context') return Promise.resolve({ data: { bootstrap_contract_version: 1, outcome: 'OK', caller: { person_id: controls.caller, legacy_person: controls.caller === data.N ? 'N' : 'V' }, selected_group: { group_id: controls.group }, protocol: { client_protocol: 1, supported_protocol: 1, minimum_client_protocol: 1, snapshot_contract_version: 1 }, runtime: { mode: 'target', activation_allowed: true } }, error: null });
        if (name === 'get_person_group_snapshot') return new Promise(resolve => { const captured = wire(), row = { args, resolve: raw => resolve({ data: controls.snapshotError ? null : raw ?? captured, error: controls.snapshotError }) }; snapshots.push(row); if (!controls.holdSnapshot) row.resolve(); });
        if (name === 'execute_app_command') return new Promise((resolve, reject) => {
          const actor = controls.caller, groupId = controls.group; const row = { body: args.p_request, resolve() { const response = commandServer(args.p_request, actor, groupId); if (controls.uncertain) { controls.uncertain = false; reject(Error('Synthetic command response lost')); } else resolve({ data: response, error: null }); } }; commands.push(row); if (!controls.holdCommand) row.resolve();
        });
        throw Error('Unexpected RPC ' + name);
      }, clock: { nowInstant: () => data.at }, scheduler: { scheduleAt(at, fn) { timers.set(++serial, fn); return serial; }, cancel: id => timers.delete(id) },
      storage: { getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k) },
      subscribeInvalidation: h => { invalidation.push(h); return () => {}; }, enqueue: f => jobs.push(f), observerRequestId: data.observer
    };
    const targetDependencies = ({ runtime: runtimeDependencies, newRequestId: () => uid(++request), enqueue: f => jobs.push(f), match: {
      executeMatchAction(req) {
        return new Promise((resolve, reject) => { const actor = controls.caller; const row = { request: req, resolve() { if (controls.matchBefore === req.p_action) { controls.matchBefore = null; reject(Error('Synthetic before send')); return; } const r = matchExecute(req, actor); if (controls.matchUncertain === req.p_action) { controls.matchUncertain = null; reject(Error('Synthetic Match response lost')); } else resolve(r); } }; matchCalls.push(row); if (!controls.matchHold) row.resolve(); });
      },
      readLatestMatchState: async () => { const value = controls.matchReadUnavailable ? { category: 'UNAVAILABLE', code: 'OFFLINE' } : { category: 'MATCH_STATE', session: copy(matchServer.session), swipes: copy(matchServer.swipes) }; matchReads.push(value); return value; },
      subscribeRealtime: h => { rt.push(h); return () => {}; }, subscribePresence: h => { presence.push(h); return { track: async () => {}, untrack: async () => {}, dispose() {} }; }, newSeed: () => 17, nowInstant: () => data.at
    } });
    const legacyEvents = [];
    let legacyActive = false;
    const legacy = {
      async start() { legacyEvents.push('start'); legacyActive = true; if (controls.legacyStart) await controls.legacyStart; },
      async stop() { legacyEvents.push('stop'); if (controls.legacyStopError) throw Error('Synthetic teardown failed'); legacyActive = false; },
      async refresh() { legacyEvents.push('refresh'); }
    };
    host = Production.createProductionHost({ target: targetDependencies, legacy, enqueue: f => jobs.push(f), labels: { N: 'Nicholas', V: 'Valeria' } });
    const pump = async () => { for (let i = 0; i < 24; i++) { await tick(); if (!jobs.length) break; for (const f of jobs.splice(0)) f(); } await tick(); };
    host.subscribe(s => publications.push(s));
    const h = { host, targetDependencies, legacyEvents, get legacyActive() { return legacyActive; }, controls, snapshots, commands, invalidation, matchCalls, matchReads, matchServer, rt, presence, publications, pump,
      get state() { return host.getState(); },
      async boot() { await host.startTarget(); await pump(); },
      async action(name, ...args) { const r = await h.state.actions[name](...args); await pump(); return r; },
      async reply(raw, index = snapshots.length - 1) { snapshots[index].resolve(raw); await pump(); },
      async refresh() { host.requestRefresh(); await pump(); },
      async enterMatch() { const r = await h.state.matchCommands.enter(); await pump(); return r; },
      async pending() { await h.enterMatch(); const card = h.state.match.derived.currentCard; await h.state.matchCommands.swipe(card, true); matchServer.swipes.push({ id: uid(++swipeSerial), session_id: matchServer.session.id, movie_id: card.movie_id, person: controls.caller === data.N ? 'V' : 'N', liked: true, created_at: data.at }); await h.state.matchCommands.reconcile(); await pump(); return h.state.match.derived.pendingMatch; },
      async replace(caller = controls.caller, group = controls.group) { controls.caller = caller; controls.group = group; await host.replaceAuthenticatedSession({ mode: 'TARGET' }); await pump(); },
      shutdown() { Shell.dispose(); const disposed = host.dispose(); worstSnapshotReads = Math.max(worstSnapshotReads, snapshots.length); worstMatchReads = Math.max(worstMatchReads, matchReads.length); worstHostPublications = Math.max(worstHostPublications, publications.length); return disposed; }
    }; return h;
  }
  function authClient(caller, h = null) {
    const now=Math.floor(Date.now()/1000), session={access_token:'synthetic-only',user:{id:caller},expires_at:now+3600};
    const calls=[], channels=[];
    const client={calls,channels,auth:{async getSession(){return{data:{session},error:null};},async getUser(){return{data:{user:session.user},error:null};}},realtime:{async setAuth(){}},
      rpc(name,args){calls.push(['rpc',name]);if(!h)throw Error('Legacy must not probe target');const result=name==='execute_match_action'?h.targetDependencies.match.executeMatchAction(args).then(data=>({data,error:null})):h.targetDependencies.runtime.rpc(name,args);return Promise.resolve(result).then(r=>({count:null,...r,status:r.error?500:200,statusText:r.error?'Error':'OK',success:r.error===null}));},
      from(table){calls.push(['read',table]);const b={select(){return b;},order(){return b;},limit(){return b;},eq(){return b;},async maybeSingle(){return{data:{user_id:caller,person:caller===data.N?'N':'V'},error:null};},then(resolve){const rows=table==='movies'?[{id:data.M,title:'Legacy fixture film',status:'watchlist',in_shared_list:true,seen_n:false,seen_v:false}]:table==='swipe_sessions'?(h?.matchServer.session?[copy(h.matchServer.session)]:[]):table==='swipes'?copy(h?.matchServer.swipes??[]):[];return Promise.resolve({data:rows,error:null}).then(resolve);}};return b;},
      channel(topic,options){const callbacks=[],c={topic,options,callbacks,on(type,filter,fn){callbacks.push({type,filter,fn});return c;},subscribe(fn){c.status=fn;return c;},presenceState(){return{};},track:async()=>{},untrack:async()=>{}};channels.push(c);return c;},removeChannel(c){channels.splice(channels.indexOf(c),1);return Promise.resolve();}};
    sb=client;authIdentity={uid:caller,person:caller===data.N?'N':'V',expiresAt:(now+3600)*1000};currentUser=authIdentity.person;return{client,session};
  }
  async function test(name, fn, options) { if(!selected(name))return;modules.clearTimers?.();const h = await make(options); try { await fn(h); cases++; onCase(name); } finally { await h.shutdown(); modules.clearTimers?.(); } }
  const html = () => modules.html();
  await test('initial accepted Snapshot renders real shell',async h=>{await h.boot();eq(h.state.phase,'READY','ready');check(!html().includes('Lista personale'),'no duplicate navigation in grid');Shell.navigate('groupList');check(html().includes(data.raw.catalog[0].title),'catalog rendered in library');});
  for(const destination of ['home','personalList','personalSeen','groupList','rewatch','scheduled','together','memories','calendar','recommendations','wheel']) await test('real shell '+destination,async h=>{await h.boot();Shell.navigate(destination);eq(Shell.getDestination(),destination,'selected route');eq(h.commands.length,0,'render not command');});
  for(const caller of [data.N,data.V])for(const observed of [data.N,data.V])await test('shell observed '+caller+'/'+observed,async h=>{await h.boot();h.host.setObservedPerson(observed);await h.pump();eq(h.state.view.context.observedPerson.personId,observed,'read identity');await Shell.perform('addToMyList',data.M);await h.pump();eq(h.commands[0].body.expected_versions[0].scope_id,caller,'caller authority');},{caller});
  await test('card/detail uses semantic view',async h=>{await h.boot();Shell.detail(data.M);check(document.getElementById('detailBody').innerHTML.includes('SCHEDA FILM'),'product detail modal');check(!('status' in h.state.view.getCard(data.M).content),'no status');});
  await test('personal uncovered renders unavailable',async h=>{await h.boot();h.host.setObservedPerson(data.V);Shell.navigate('personalList');check(document.getElementById('targetFeedback').textContent.includes('Dati personali non disponibili'),'unavailable state in feedback panel');check(!html().includes(data.unavailable.catalog[0].title),'uncovered personal data not rendered');},{raw:data.unavailable});
  await test('Rewatch selector reaches screen',async h=>{await h.boot();Shell.navigate('rewatch');check(h.state.view.group.rewatch.length>0,'selector');check(html().includes(h.state.view.group.rewatch[0].title),'render');},{raw:data.rewatch});
  await test('Ricordi preserves repeat events',async h=>{await h.boot();Shell.navigate('memories');check(h.state.view.events.completed.length>h.state.view.counts.togetherFilms,'events versus films');},{raw:data.multiple});
  for(const [method,args,intent]of [['addToMyList',[data.M],'ADD_PERSONAL_LIST'],['removeFromMyList',[data.M],'REMOVE_PERSONAL_LIST'],['recordSeen',[data.M],'RETROSPECTIVE_SEEN'],['removeSeen',[data.M],'REMOVE_PERSONAL_SEEN'],['setMyEvaluation',[data.M,{rating:0,review:''}],'SET_PERSONAL_EVALUATION'],['proposeToGroup',[data.M],'PROPOSE_TO_GROUP'],['withdrawGroupCandidacy',[data.M],'WITHDRAW_GROUP_CANDIDACY'],['scheduleNight',[data.M,{date:'2027-01-05'}],'SCHEDULE_NIGHT'],['quickNight',[data.M],'QUICK_NIGHT'],['completeNow',[data.M,{participants:[data.N]}],'COMPLETE_NOW']])await test('shell action '+intent,async h=>{await h.boot();eq((await Shell.perform(method,...args)).outcome,'SUCCESS','result');await h.pump();eq(h.commands[0].body.intent,intent,'actual action path');});
  await test('SUCCESS is feedback only before Snapshot',async h=>{await h.boot();const before=h.state.view;h.controls.holdSnapshot=true;await Shell.perform('recordSeen',data.M);await h.pump();eq(h.state.view.personal.caller.seen.length,0,'no optimistic seen');eq(before.personal.caller.seen.length,0,'historical');await h.reply();eq(h.state.view.personal.caller.seen.length,1,'accepted Snapshot');});
  for(const outcome of ['STALE','REQUEST_ID_REUSE'])await test('shell '+outcome+' does not retry',async h=>{await h.boot();h.controls.commandOutcome=outcome;eq((await Shell.perform('recordSeen',data.M)).outcome,outcome,'semantic result');await h.pump();eq(h.commands.length,1,'no retry');});
  await test('uncertain exact request retry',async h=>{await h.boot();h.controls.uncertain=true;const r=await Shell.perform('recordSeen',data.M);eq(r.outcome,'TRANSPORT_UNCERTAIN','uncertain');const before=copy(h.commands[0].body);await Shell.perform('retry',r.retryHandle);deep(h.commands.at(-1).body,before,'exact request');});
  await test('content creation and explicit relation separate',async h=>{await h.boot();const r=await Shell.saveContent({title:'Synthetic new'},'addToMyList');await h.pump();eq(r.content.outcome,'SUCCESS','create');eq(r.relation.outcome,'SUCCESS','relation');deep(h.commands.map(c=>c.body.intent),['CONTENT_CREATE','ADD_PERSONAL_LIST'],'separate');});
  for(const destination of ['personalList','personalSeen','groupList'])await test('UX11A contextual Add keeps destination and zero results read-only '+destination,async h=>{
    await h.boot();const ui=Shell.createShell({session:h.host,root:document});
    ui.navigate(destination);
    const originalSearch=searchTmdbCandidates;searchTmdbCandidates=async()=>[];
    ui.edit('createContent',null);
    eq(document.getElementById('targetAddDestination').value,destination,'contextual destination shown');
    document.getElementById('addTitle').value='Synthetic contextual add';
    try{await document.getElementById('addSaveBtn').onclick();await h.pump();eq(h.commands.length,0,'search never writes');check(document.getElementById('targetAddMessage').textContent.includes('Nessun film'),'zero results feedback: '+document.getElementById('targetAddMessage').textContent);}
    finally{searchTmdbCandidates=originalSearch;ui.dispose();}
  });
  for(const [destination,intent] of [['personalList','ADD_PERSONAL_LIST'],['groupList','PROPOSE_TO_GROUP'],['personalSeen','RETROSPECTIVE_SEEN']])await test('UX11A selection and explicit primary save '+destination,async h=>{
    await h.boot();const originalSearch=searchTmdbCandidates;searchTmdbCandidates=async()=>[];
    const ui=Shell;
    try{
      ui.navigate(destination);ui.edit('createContent',null);eq(document.getElementById('targetAddDestination').value,destination,'context destination');
      document.getElementById('addTitle').value=data.absent.catalog[0].title;
      await document.getElementById('addSaveBtn').onclick();
      const choices=document.getElementById('pickerResults')._children;check(choices.length>0,'known result offered');
      eq(h.commands.length,0,'search does not write');choices[0].onclick();eq(h.commands.length,0,'selection does not write');
      eq(document.getElementById('targetPickerDestination').value,destination,'destination shown with selection');
      await document.getElementById('targetPickerCommit').onclick();await h.pump();
      deep(h.commands.map(c=>c.body.intent),[intent],'existing content reused');
      eq(document.getElementById('targetPickerMessage').textContent,'','no duplicate success inside picker');
      eq(document.getElementById('targetFeedbackMessage').textContent,destination==='groupList'?'Aggiunto a Da vedere insieme':destination==='personalList'?'Aggiunto ai tuoi Da vedere':'Aggiunto ai miei Visti.','specific success toast');
      await document.getElementById('targetPickerCommit').onclick();eq(h.commands.length,1,'repeat submission blocked');
    }finally{searchTmdbCandidates=originalSearch;}
  },{raw:data.absent});
  for(const [label,raw,observed] of [['Voglio vederlo',data.seenOther,data.V],['Voglio rivederlo',(()=>{const wire=copy(data.absent);wire.personal[0].states[0].seen=true;return finish(wire);})(),data.N]])
    await test('intent picker uses authenticated Seen for '+label,async h=>{
      await h.boot();h.host.setObservedPerson(observed);await h.pump();
      const originalSearch=searchTmdbCandidates;searchTmdbCandidates=async()=>[];
      try{
        Shell.navigate('personalList');Shell.edit('createContent',null);
        document.getElementById('addTitle').value=raw.catalog[0].title;await document.getElementById('addSaveBtn').onclick();
        document.getElementById('pickerResults')._children[0].onclick();
        const commit=document.getElementById('targetPickerCommit');
        check(commit.innerHTML.includes('fa-user')&&commit.innerHTML.includes(label)&&!commit.innerHTML.includes('fa-user-plus'),'personal icon and caller-specific wording');
        eq(h.commands.length,0,'selection has no write');
      }finally{searchTmdbCandidates=originalSearch;}
    },{raw});
  await test('intent success uses one temporary toast and errors never report success',async h=>{
    await h.boot();modules.clearTimers();
    await Shell.perform('proposeToGroup',data.M);await h.pump();
    eq(document.getElementById('targetFeedbackMessage').textContent,'Aggiunto a Da vedere insieme','shared toast after success');
    modules.advanceTime(2600);eq(document.getElementById('targetFeedbackMessage').textContent,'','shared toast dismissed');
    h.controls.commandOutcome='STALE';await Shell.perform('addToMyList',data.M);await h.pump();
    check(!document.getElementById('targetFeedbackMessage').textContent.includes('Aggiunto'),'no false personal success');
    modules.advanceTime(10000);check(document.getElementById('targetFeedbackMessage').textContent.includes('I dati sono cambiati'),'error remains readable');
  },{raw:data.absent});
  await test('UX11A global Add requires destination and writes only caller seen',async h=>{
    await h.boot();h.host.setObservedPerson(data.V);await h.pump();
    const originalSearch=searchTmdbCandidates;searchTmdbCandidates=async()=>[];
    const ui=Shell.createShell({session:h.host,root:document});
    try{
      ui.navigate('personalSeen');ui.edit('createContent',null,{entry:'global'});
      eq(document.getElementById('targetAddDestination').value,'','global has no preselection');
      document.getElementById('addTitle').value=data.absent.catalog[0].title;await document.getElementById('addSaveBtn').onclick();
      document.getElementById('pickerResults')._children[0].onclick();
      check(document.getElementById('targetPickerCommit').disabled,'no implicit destination');eq(h.commands.length,0,'no write yet');
      const pickerDestination=document.getElementById('targetPickerDestination');pickerDestination.value='personalSeen';pickerDestination.onchange();
      await document.getElementById('targetPickerCommit').onclick();await h.pump();
      eq(h.commands[0].body.intent,'RETROSPECTIVE_SEEN','personal seen intent');
      eq(h.commands[0].body.expected_versions[0].scope_id,data.N,'authenticated caller scope');
      check(!h.state.view.getCard(data.M).personal.observed.seen,'other person unchanged');
    }finally{searchTmdbCandidates=originalSearch;ui.dispose();}
  },{raw:data.absent});
  await test('UX11A cancel and already-present relation stay explicit',async h=>{
    await h.boot();const originalSearch=searchTmdbCandidates;searchTmdbCandidates=async()=>[];
    const ui=Shell.createShell({session:h.host,root:document});
    try{
      ui.navigate('groupList');ui.edit('createContent',null);document.getElementById('addTitle').value=data.absent.catalog[0].title;
      await document.getElementById('addSaveBtn').onclick();document.getElementById('pickerResults')._children[0].onclick();
      closeModal('pickerModal');eq(h.commands.length,0,'cancel has no effects');
      ui.edit('createContent',null);document.getElementById('addTitle').value=data.absent.catalog[0].title;
      await document.getElementById('addSaveBtn').onclick();document.getElementById('pickerResults')._children[0].onclick();
      h.controls.commandOutcome='ALREADY_IN_TARGET_STATE';await document.getElementById('targetPickerCommit').onclick();
      check(document.getElementById('targetPickerMessage').textContent.includes('già nei Da vedere insieme'),'already-present relation explained');
      eq(h.commands.length,1,'only explicit command');
    }finally{searchTmdbCandidates=originalSearch;ui.dispose();}
  },{raw:data.absent});
  await test('UX11A homonyms remain distinct by TMDb identity',async h=>{
    await h.boot();const originalSearch=searchTmdbCandidates;
    searchTmdbCandidates=async()=>[{id:4101,title:'The Same Title',year:'1998',poster:''},{id:4102,title:'The Same Title',year:'2024',poster:''}];
    const ui=Shell.createShell({session:h.host,root:document,detailsById:async id=>({tmdb_id:id,title:'The Same Title',matched:true,release_year:id===4102?2024:1998})});
    try{
      ui.navigate('personalList');ui.edit('createContent',null);document.getElementById('addTitle').value='The Same Title';
      await document.getElementById('addSaveBtn').onclick();const choices=document.getElementById('pickerResults')._children;
      eq(choices.length,2,'two years offered');check(choices[0].innerHTML.includes('1998')&&choices[1].innerHTML.includes('2024'),'years visible');
      choices[1].onclick();eq(h.commands.length,0,'selection neutral');await document.getElementById('targetPickerCommit').onclick();await h.pump();
      deep(h.commands.map(c=>c.body.intent),['CONTENT_CREATE','ADD_PERSONAL_LIST'],'content and chosen relation');
      eq(h.commands[0].body.parameters.tmdb_id,'4102','chosen identity retained');
    }finally{searchTmdbCandidates=originalSearch;ui.dispose();}
  },{raw:data.absent});
  await test('UX11A TMDb match reuses known content while adding missing relation',async h=>{
    await h.boot();const originalSearch=searchTmdbCandidates;
    searchTmdbCandidates=async()=>[{id:777,title:'Alternate search title',year:'2020',poster:''}];
    const ui=Shell.createShell({session:h.host,root:document,detailsById:async()=>{throw Error('Known content must not be fetched again');}});
    try{
      ui.navigate('personalList');ui.edit('createContent',null);document.getElementById('addTitle').value='Alternate search title';
      await document.getElementById('addSaveBtn').onclick();const choices=document.getElementById('pickerResults')._children;
      eq(choices.length,1,'existing TMDb ID deduplicated');check(choices[0].innerHTML.includes('Già nel catalogo'),'known status visible');
      choices[0].onclick();await document.getElementById('targetPickerCommit').onclick();await h.pump();
      deep(h.commands.map(c=>c.body.intent),['ADD_PERSONAL_LIST'],'no duplicate content create');
    }finally{searchTmdbCandidates=originalSearch;ui.dispose();}
  },{raw:(()=>{const wire=copy(data.absent);wire.catalog[0].tmdb_id='777';return wire;})()});
  await test('UX11A search error differs from zero results',async h=>{
    await h.boot();const originalSearch=searchTmdbCandidates;searchTmdbCandidates=async()=>{throw Error('Synthetic network failure');};
    const ui=Shell.createShell({session:h.host,root:document});
    try{ui.navigate('groupList');ui.edit('createContent',null);document.getElementById('addTitle').value='Missing';
      await document.getElementById('addSaveBtn').onclick();check(document.getElementById('targetAddMessage').textContent.includes('Ricerca non disponibile'),'network error');eq(h.commands.length,0,'no fallback save');}
    finally{searchTmdbCandidates=originalSearch;ui.dispose();}
  },{raw:data.absent});
  await test('UX11A stale search response cannot replace newer query',async h=>{
    await h.boot();const originalSearch=searchTmdbCandidates,resolvers=new Map();
    searchTmdbCandidates=title=>new Promise(resolve=>resolvers.set(title,resolve));
    const ui=Shell.createShell({session:h.host,root:document});
    try{
      ui.navigate('groupList');ui.edit('createContent',null);const input=document.getElementById('addTitle'),button=document.getElementById('addSaveBtn');
      input.value='First query';const first=button.onclick();input.value='Second query';input.oninput();const second=button.onclick();
      resolvers.get('First query')([{id:5101,title:'Old result',year:'2001',poster:''}]);await first;
      check(document.getElementById('pickerModal').classList.contains('hidden'),'late old result ignored');
      resolvers.get('Second query')([{id:5102,title:'Current result',year:'2024',poster:''}]);await second;
      check(document.getElementById('pickerResults').innerHTML.includes('Current result'),'latest result displayed');
      check(!document.getElementById('pickerResults').innerHTML.includes('Old result'),'old result never displayed');eq(h.commands.length,0,'search remains read only');
    }finally{searchTmdbCandidates=originalSearch;ui.dispose();}
  },{raw:data.absent});
  await test('UX11A global navigation entry has no preselected relation',async h=>{
    await h.boot();Shell.navigate('personalList');openAddModal();
    eq(document.getElementById('targetAddDestination').value,'','global plus requires choice');eq(h.commands.length,0,'opening global Add read only');
  },{raw:data.absent});
  await test('UX11B same-ID preview applies only changed allowed fields',async h=>{
    await h.boot();const before=copy(h.state.view.getCard(data.M)),nights=copy(h.controls.wire.nights),participants=copy(h.controls.wire.participants);
    const ui=Shell.createShell({session:h.host,root:document,detailsById:async id=>({tmdb_id:Number(id),matched:true,title:before.content.title,
      overview:'Trama aggiornata',poster:'https://example.test/new.jpg',platform:'Streaming',cinema_watchlist:false})});
    try{
      const context=ui.presentation(),detail=context.detailActions(context.getMovie(data.M));
      check(detail.includes('Aggiorna informazioni da TMDb')&&!detail.includes('Correggi titolo'),'secondary action in film detail');
      ui.edit('refreshMetadata',data.M);await tick();eq(h.commands.length,0,'preview read only');
      const changes=document.getElementById('metadataRefreshChanges').innerHTML;
      check(changes.includes('Trama')&&changes.includes('Locandina'),'compact changes shown');
      await document.getElementById('metadataRefreshApply').onclick();await h.pump();
      eq(h.commands.length,1,'single explicit write');eq(h.commands[0].body.intent,'CONTENT_UPDATE_METADATA','metadata command');
      deep(h.commands[0].body.parameters,{poster:'https://example.test/new.jpg',overview:'Trama aggiornata'},'changed content only');
      const after=h.state.view.getCard(data.M);
      deep(after.personal,before.personal,'personal relations and judgments preserved');
      deep(after.group.candidacy,before.group.candidacy,'group relation preserved');
      deep(after.group.judgment,before.group.judgment,'group judgment preserved');
      deep(h.controls.wire.nights,nights,'night snack and location preserved');deep(h.controls.wire.participants,participants,'participants preserved');
      eq(after.content.cinema_watchlist,true,'cinema classification preserved');
      await document.getElementById('metadataRefreshApply').onclick();eq(h.commands.length,1,'repeat submission blocked');
    }finally{ui.dispose();}
  },{raw:data.metadata});
  await test('UX11B no differences and incomplete data do not write',async h=>{
    await h.boot();const original=data.metadata.catalog[0];
    const ui=Shell.createShell({session:h.host,root:document,detailsById:async()=>({tmdb_id:777,matched:true,title:original.title,
      overview:null,poster:'',genres:[],platform:'Streaming'})});
    try{ui.edit('refreshMetadata',data.M);await tick();
      check(document.getElementById('metadataRefreshStatus').textContent.includes('già aggiornate'),'no differences feedback');
      check(document.getElementById('metadataRefreshApply').classList.contains('hidden'),'apply hidden');eq(h.commands.length,0,'no write');
    }finally{ui.dispose();}
  },{raw:data.metadata});
  await test('UX11B mismatched TMDb response and transport error are read only',async h=>{
    await h.boot();let response={tmdb_id:778,matched:true,title:'Wrong film'};
    const ui=Shell.createShell({session:h.host,root:document,detailsById:async()=>{if(response==='throw')throw Error('Synthetic network failure');return response;}});
    try{ui.edit('refreshMetadata',data.M);await tick();
      check(document.getElementById('metadataRefreshStatus').textContent.includes('coerenti'),'wrong identity rejected');eq(h.commands.length,0,'no write');
      response=null;document.getElementById('metadataRefreshRetry').onclick();await tick();
      check(document.getElementById('metadataRefreshStatus').textContent.includes('coerenti'),'empty response rejected');eq(h.commands.length,0,'no write after retry');
      response='throw';document.getElementById('metadataRefreshRetry').onclick();await tick();
      check(document.getElementById('metadataRefreshStatus').textContent.includes('TMDb non disponibile'),'transport error explained');eq(h.commands.length,0,'no write on error');
    }finally{ui.dispose();}
  },{raw:data.metadata});
  await test('UX11B stale preview cannot overwrite newer metadata',async h=>{
    await h.boot();const ui=Shell.createShell({session:h.host,root:document,detailsById:async()=>({tmdb_id:777,matched:true,title:data.metadata.catalog[0].title,overview:'Proposed overview'})});
    try{ui.edit('refreshMetadata',data.M);await tick();
      h.controls.wire.catalog[0].overview='Changed elsewhere';await h.refresh();
      await document.getElementById('metadataRefreshApply').onclick();
      eq(h.commands.length,0,'stale preview no write');check(document.getElementById('metadataRefreshStatus').textContent.includes('Aggiorna l’anteprima'),'refresh required');
    }finally{ui.dispose();}
  },{raw:data.metadata});
  await test('UX11B closing modal ignores late TMDb response',async h=>{
    await h.boot();let resolve;const ui=Shell.createShell({session:h.host,root:document,detailsById:()=>new Promise(r=>resolve=r)});
    try{ui.edit('refreshMetadata',data.M);closeModal('metadataRefreshModal');
      resolve({tmdb_id:777,matched:true,title:'Late title'});await tick();
      eq(h.commands.length,0,'late response cannot write');check(document.getElementById('metadataRefreshModal').classList.contains('hidden'),'modal stays closed');
    }finally{ui.dispose();}
  },{raw:data.metadata});
  await test('UX11B no TMDb identity exposes no refresh action',async h=>{
    await h.boot();const context=Shell.presentation();
    check(!context.detailActions(context.getMovie(data.M)).includes('Aggiorna informazioni da TMDb'),'no unavailable action');
  },{raw:data.absent});
  await test('UX4 existing catalog retrospective seen preserves personal intent and judgments',async h=>{
    await h.boot();await Shell.perform('addToMyList',data.M);await h.pump();
    const before=copy(h.state.view.getCard(data.M));const n=h.commands.length;
    const result=await Shell.saveContent({movie_id:data.M},'recordSeen');await h.pump();
    eq(result.movieId,data.M,'existing identity reused');deep(h.commands.slice(n).map(c=>c.body.intent),['RETROSPECTIVE_SEEN'],'no create or evaluation');
    deep(h.commands.at(-1).body.parameters,{},'no patch');const after=h.state.view.getCard(data.M);
    check(after.personal.caller.seen,'personal seen');deep(after.personal.caller.list,before.personal.caller.list,'interest preserved');
    deep(after.personal.caller.judgment,before.personal.caller.judgment,'judgment preserved');deep(after.group,before.group,'group unchanged');
  });
  await test('UX4 new identified content is saved only to caller seen',async h=>{
    await h.boot();const nights=copy(h.state.view.events),before=h.state.view.counts;
    const result=await Shell.saveContent({title:'Synthetic identified past film',tmdb_id:'987654'},'recordSeen');await h.pump();
    deep(h.commands.map(c=>c.body.intent),['CONTENT_CREATE','RETROSPECTIVE_SEEN'],'content then retrospective command');
    const card=h.state.view.getCard(result.movieId);check(card.personal.caller.seen,'caller seen');check(!card.personal.caller.list.active,'no personal interest');
    check(!card.group.candidacy.effectiveCandidacy&&!card.group.hasTogetherHistory,'no shared relation');
    deep(card.personal.caller.judgment,{rating:null,preference:null,review:null},'no judgment');deep(h.state.view.events,nights,'no night');
    eq(h.state.view.counts.groupListFilms,before.groupListFilms,'shared list unchanged');
  });
  await test('metadata command reaches accepted catalog',async h=>{await h.boot();await Shell.perform('updateMetadata',data.M,{title:'Synthetic corrected'});await h.pump();eq(h.state.view.catalog.getContent(data.M).content.title,'Synthetic corrected','accepted metadata');});
  await test('Match enter/start',async h=>{await h.boot();Shell.navigate('match');await h.pump();check(!!h.state.match.authoritative.session,'session');eq(h.commands.length,0,'no shared writer');});
  await test('Match swipe pending H1 exact',async h=>{await h.boot();const token=await h.pending();eq((await h.state.matchCommands.acknowledge(token)).outcome,'SUCCESS','ack');deep(h.matchCalls.at(-1).request.p_parameters,token,'exact observed token');});
  await test('Match Presence separate',async h=>{await h.boot();await h.enterMatch();const before=h.state.view;h.presence[0].onSync([data.N,data.N,data.V]);await h.pump();deep(h.state.match.presence,[data.N,data.V],'UUID dedup');eq(h.state.view,before,'shared unchanged');});
  await test('Match reconnect revalidates',async h=>{await h.boot();await h.enterMatch();const n=h.matchReads.length;h.rt[0].onReconnect();await h.pump();check(h.matchReads.length>n,'read');});
  await test('Match connecting is transient, then ordinary lobby',async h=>{await h.boot();Shell.navigate('match');check(html().includes('Connessione…'),'connecting feedback');await h.pump();eq(h.state.match.phase,'READY','ready');check(html().includes('Chi c&#39;è?')||html().includes("Chi c'è?"),'ordinary lobby');check(!html().includes('Match non disponibile'),'no false error');});
  await test('Match disconnect hides swipe and reconnects without session reset',async h=>{await h.boot();Shell.navigate('match');await h.pump();h.presence[0].onSync([data.N,data.V]);await h.pump();const id=h.matchServer.session.id,deck=copy(h.matchServer.session.deck),card=h.state.match.derived.currentCard;check(html().includes('swipeCard(')||html().includes('Nope'),'swipe visible');h.rt[0].onDisconnected();await h.pump();eq(h.state.match.phase,'DISCONNECTED','disconnected');check(html().includes('riconnetterà automaticamente'),'automatic recovery copy');check(!html().includes('Nope')&&!html().includes('Riprova</button>'),'no swipe or manual retry');h.rt[0].onReconnect();await h.pump();eq(h.state.match.phase,'READY','recovered');eq(h.matchServer.session.id,id,'same session');deep(h.matchServer.session.deck,deck,'same deck');eq(h.state.match.derived.currentCard.movie_id,card.movie_id,'same card');eq(h.matchCalls.filter(c=>['start','close'].includes(c.request.p_action)).length,1,'no restart or close');});
  await test('Match waiting for partner remains normal Match state',async h=>{await h.boot();Shell.navigate('match');await h.pump();h.presence[0].onSync([data.N,data.V]);await h.pump();const card=h.state.match.derived.currentCard;await h.state.matchCommands.swipe(card,true);await h.pump();eq(h.state.match.phase,'READY','still connected');check(html().includes('In attesa di'),'partner wait visible');check(!html().includes('Match non disponibile')&&!html().includes('Nope'),'no false connection error or second swipe');});
  await test('Match unavailable retries read of existing session',async h=>{await h.boot();Shell.navigate('match');await h.pump();const id=h.matchServer.session.id,card=h.state.match.derived.currentCard;h.controls.matchReadUnavailable=true;await h.state.matchCommands.reconcile();await h.pump();eq(h.state.match.phase,'UNAVAILABLE','unavailable');check(html().includes('Riprova a caricare la sessione'),'recovery copy');check(html().includes('reconcileMatch()'),'recovery control uses reconciliation');check(!html().includes('Nope'),'no swipe while unavailable');h.controls.matchReadUnavailable=false;await Shell.performMatch('reconcile');await h.pump();eq(h.state.match.phase,'READY','read recovered');eq(h.matchServer.session.id,id,'same session');eq(h.state.match.derived.currentCard.movie_id,card.movie_id,'same card');eq(h.matchCalls.filter(c=>['start','close'].includes(c.request.p_action)).length,1,'no restart or close');});
  await test('Match initial read failure recovers without creating a session',async h=>{await h.boot();h.controls.matchReadUnavailable=true;Shell.navigate('match');await h.pump();eq(h.state.match.phase,'UNAVAILABLE','initial read unavailable');eq(h.matchServer.session,null,'no invented session');check(html().includes('reconcileMatch()'),'read retry available');h.controls.matchReadUnavailable=false;await Shell.performMatch('reconcile');await h.pump();eq(h.state.match.phase,'READY','read recovers');eq(h.matchServer.session,null,'retry does not start');eq(h.matchCalls.length,0,'no Match mutation');check(html().includes('Chi c&#39;è?')||html().includes("Chi c'è?"),'normal lobby');});
  await test('Match leave preserves server session',async h=>{await h.boot();await h.enterMatch();const id=h.matchServer.session.id;await h.state.matchCommands.leave();eq(h.matchServer.session.id,id,'not close');});
  await test('Match schedule Snapshot explicit close',async h=>{await h.boot();const token=await h.pending();h.controls.holdSnapshot=true;const r=await h.host.scheduleMatchedMovie(token,{date:'2027-01-05'});eq((await h.host.closeScheduledMatch(r.closeTicket)).code,'SCHEDULE_SNAPSHOT_REQUIRED','gate');await h.reply();eq((await h.host.closeScheduledMatch(r.closeTicket)).outcome,'SUCCESS','close');});
  await test('Match close partial failure remains separate',async h=>{await h.boot();const token=await h.pending();h.controls.matchCloseOutcome='ERROR';const r=await h.host.scheduleMatchedMovie(token,{date:'2027-01-05'});await h.pump();eq(r.actionResult.outcome,'SUCCESS','schedule');eq((await h.host.closeScheduledMatch(r.closeTicket)).outcome,'ERROR','partial');});
  await test('Together does not populate personal seen',async h=>{await h.boot();await Shell.perform('completeNow',data.M,{participants:[data.N]});await h.pump();eq(h.state.view.personal.caller.seen.length,0,'independent');eq(h.state.view.counts.togetherFilms,1,'Together');});
  await test('observed unknown label remains unknown',async h=>{await h.boot();h.host.setObservedPerson(data.other);await h.pump();eq(h.state.view.context.observedPerson.label,null,'no V fallback');});
  await test('stale UI action token cannot cross context',async h=>{await h.boot();const token=h.host.capture();await h.replace(data.V);eq((await h.host.action(token,'recordSeen',data.M)).outcome,'OBSOLETE','old callback');eq(h.commands.length,0,'no write');});
  await test('Auth invalidation clears real presentation',async h=>{await h.boot();await h.host.invalidateAuth();await h.pump();eq(h.state.view.kind,'UNAVAILABLE','cleared');check(!html().includes(data.raw.catalog[0].title),'sensitive display cleared');});
  for(const code of ['MAINTENANCE','FOUNDATION_NOT_READY','PROTOCOL_UNSUPPORTED'])await test('blocked '+code+' no legacy',async h=>{h.controls.bootstrapError=code;await h.boot();eq(h.state.phase,'BLOCKED','blocked');eq(h.legacyEvents.length,0,'no fallback');});
  await test('initial Snapshot error no legacy mirror',async h=>{h.controls.snapshotError={message:'Synthetic offline'};await h.boot();eq(h.state.view.kind,'UNAVAILABLE','not READY');eq(h.legacyEvents.length,0,'no fallback');});
  await test('filter search sort stay local',async h=>{await h.boot();const reads=h.snapshots.length;Shell.navigate('groupList');Shell.setFilters({query:'missing synthetic',sort:'title'});check(html().includes('Nessun film'),'empty filtered');eq(h.snapshots.length,reads,'no render fetch');});
  await test('Together judgment is separate from event edit',async h=>{await h.boot();await Shell.perform('setGroupEvaluation',data.M,{rating:0,review:''});await h.pump();eq(h.state.view.group.getJudgment(data.M).judgment.rating,0,'zero');eq(h.state.view.counts.completedEvents,0,'no fabricated event');});
  await test('night confirm edit complete preserves UUID',async h=>{await h.boot();const r=await Shell.perform('scheduleNight',data.M,{date:'2027-01-05'});await h.pump();const id=r.result.night_id;await Shell.perform('confirmNight',id);await h.pump();await Shell.perform('editNight',id,{snack:'Synthetic'});await h.pump();await Shell.perform('completeScheduled',id,{participants:[data.N]});await h.pump();eq(h.state.view.events.completed[0].eventId,id,'stable night');deep(h.state.view.events.completed[0].participants.map(x=>x.person_id),[data.N],'explicit subset');});
  await test('night cancellation publishes via Snapshot',async h=>{await h.boot();const r=await Shell.perform('quickNight',data.M);await h.pump();await Shell.perform('cancelNight',r.result.night_id);await h.pump();eq(h.state.view.events.scheduled.length,0,'cancelled');});
  await test('content delete creates authoritative tombstone',async h=>{await h.boot();const r=await Shell.saveContent({title:'Delete fixture'});await h.pump();eq((await Shell.perform('deleteContent',r.movieId)).outcome,'SUCCESS','delete');await h.pump();eq(h.state.view.catalog.getContent(r.movieId).kind,'NOT_IN_CATALOG','Snapshot deletion');});
  await test('cinema updates target eligibility',async h=>{await h.boot();await Shell.perform('setCinema',data.M,true);await h.pump();check(!h.state.view.ruota.eligibleMovieIds.includes(data.M),'target eligibility');});
  await test('Surprise generic command only',async h=>{await h.boot();await Shell.perform('setSurprise',data.M,true);await h.pump();eq(h.commands[0].body.intent,'CONTENT_SET_SURPRISE','generic');});
  await test('Veto generic add and remove',async h=>{await h.boot();await Shell.perform('addVeto',data.M);await h.pump();const id=h.state.view.getVetoForMovie(data.M).veto.veto_id;await Shell.perform('removeVeto',data.M,id);await h.pump();eq(h.commands[1].body.intent,'VETO_REMOVE','generic');});
  await test('all legacy domain entry points fenced in TARGET',async h=>{await h.boot();for(const fn of [()=>loadLocal(),()=>fetchAll(),()=>loadMovies(),()=>resyncQuiet(),()=>subscribeRealtime(),()=>insertMovie({}),()=>updateMovie(data.M,{}),()=>deleteMovie(data.M),()=>loadMatchLocal(),()=>recordSwipe(data.M,true)]){let rejected=false;try{await fn();}catch(e){rejected=e.message==='LEGACY_AUTHORITY_FORBIDDEN';}check(rejected,'legacy fenced');}});
  await test('Auth refresh delegates TARGET without legacy bypass',async h=>{await h.boot();authClient(data.N);const n=h.snapshots.length;await refreshAuthConnection();await h.pump();check(h.snapshots.length>n,'target refresh');eq(h.legacyEvents.length,0,'no legacy');eq(h.state.context.caller.personId,data.N,'same caller');});
  await test('actual lock/logout clears TARGET without mirror restore',async h=>{await h.boot();authClient(data.N);lockApp();await h.pump();eq(h.state.phase,'AUTH_INVALIDATING','auth retired');eq(h.state.view.kind,'UNAVAILABLE','clear');eq(h.legacyEvents.length,0,'no legacy');});
  await test('production dependency factory is dormant until requested',async h=>{authClient(data.N,h);const deps=modules.productionDependencies();eq(sb.calls.length,0,'no RPC/read');eq(sb.channels.length,0,'no subscription');check(typeof deps.runtime.subscribeInvalidation==='function','factory');});
  await test('real production RPC factory boots injected TARGET',async h=>{await h.shutdown();authClient(data.N,h);const deps=modules.productionDependencies();deps.runtime.clock=h.targetDependencies.runtime.clock;deps.runtime.scheduler=h.targetDependencies.runtime.scheduler;deps.runtime.enqueue=deps.enqueue=h.targetDependencies.enqueue;deps.match.nowInstant=()=>data.at;const app=modules.createCoordinator({mode:'TARGET',target:deps,legacy:{start(){throw Error('Legacy forbidden');},stop(){},refresh(){throw Error('Legacy forbidden');}},enqueue:deps.enqueue});modules.install(app);try{await app.startAuthenticated(data.N);await h.pump();eq(app.getState().phase,'READY','real production factories');check(sb.calls.some(c=>c[1]==='get_app_runtime_context'),'bootstrap');check(sb.channels.some(c=>c.callbacks.some(x=>x.filter.table==='domain_versions')),'target Realtime');}finally{await app.dispose();}});
  await test('target mirror storage is unreachable during real Auth handoff',async h=>{
    await h.boot();const owner=typeof Storage!=='undefined'?Storage.prototype:localStorage, saved={};let accesses=0;
    for(const method of ['getItem','setItem','removeItem']){saved[method]=owner[method];owner[method]=function(key,...rest){if(/^scorochiatu_(movies|movie_nights|vetoes|swipe_sessions|swipes|mirror_owner)$/.test(key)){accesses++;throw Error('Legacy mirror forbidden');}return saved[method].call(this,key,...rest);};}
    try{const f=authClient(data.N);authIdentity=null;currentUser=null;await establishAuth(f.session);lockApp();await h.pump();eq(accesses,0,'no mirror access');}finally{for(const method of Object.keys(saved))owner[method]=saved[method];}
  });
  await test('product context cannot submit into replacement caller',async h=>{await h.boot();const old=Shell.presentation();check(old.current(),'captured context current');await h.replace(data.V);check(!old.current(),'old product context retired');eq(h.commands.length,0,'no cross-caller command');});
  await test('context replacement retires old judgment editor',async h=>{await h.boot();Shell.edit('setMyEvaluation',data.M,{review:'Old caller private draft'});check(!document.getElementById('reviewModal').classList.contains('hidden'),'product editor open');await h.replace(data.V);check(document.getElementById('reviewModal').classList.contains('hidden'),'old editor retired');});
  await test('old Snapshot cannot render into replacement caller',async h=>{await h.boot();h.controls.holdSnapshot=true;await Shell.perform('recordSeen',data.M);const old=h.snapshots.length-1;await h.replace(data.V);await h.reply(undefined,old);eq(h.state.view.kind,'UNAVAILABLE','old read inert');await h.reply();eq(h.state.context.caller.personId,data.V,'new identity');});
  await test('old action completion cannot render new caller',async h=>{await h.boot();h.controls.holdCommand=true;const pending=Shell.perform('recordSeen',data.M);await tick();await h.replace(data.V);h.commands[0].resolve();eq((await pending).outcome,'OBSOLETE','old response');eq(h.state.view.personal.caller.seen.length,0,'new seen unchanged');});
  await test('old Match H1 and retry cannot cross shell context',async h=>{await h.boot();const token=await h.pending();const old=h.state.matchCommands;await h.replace(data.V);eq((await old.acknowledge(token)).category,'OBSOLETE','old H1 surface');check(['OBSOLETE','INVALID_INPUT'].includes((await h.state.matchCommands.acknowledge(token)).category),'new owner rejects token');});
  await test('old close ticket cannot cross shell context',async h=>{await h.boot();const token=await h.pending();const r=await h.host.scheduleMatchedMovie(token,{date:'2027-01-05'});await h.pump();await h.replace(data.V);eq((await h.host.closeScheduledMatch(r.closeTicket)).category,'OBSOLETE','ticket retired');});
  await test('old Realtime callback cannot refresh replacement',async h=>{await h.boot();await h.enterMatch();const rt=h.rt[0];await h.replace(data.V);const n=h.matchReads.length;rt.onReconnect();rt.onChange();await h.pump();eq(h.matchReads.length,n,'old callback inert');});
  await test('unavailable Realtime blocks target without fallback',async h=>{h.targetDependencies.runtime.subscribeInvalidation=()=>{throw Error('Synthetic source unavailable');};await h.boot();eq(h.state.phase,'BLOCKED','blocked');eq(h.legacyEvents.length,0,'no fallback');});
  await test('Recommendation consumes target and CTA shares actions',async h=>{await h.boot();const input=h.state.view.getRecommendationInput();eq(input.kind,'AVAILABLE','target input');const rows=Engine.recommend(input.input);check(Array.isArray(rows),'real engine');await Shell.perform('proposeToGroup',data.M);eq(h.commands.at(-1).body.intent,'PROPOSE_TO_GROUP','same writer');});
  await test('UX10 shortlist follows Core order and shows evidence',async h=>{
    await h.boot();Shell.navigate('recommendations');check(document.getElementById('recommendationSection').getAttribute('aria-busy')==='true','loading');await h.pump();
    const input=h.state.view.getRecommendationInput({constraints:{context:'all'}}).input;
    const expected=Engine.rerank(Engine.recommend(input),5).map(row=>row.movieId);
    const markup=document.getElementById('recommendationResults').innerHTML;
    const shown=[...markup.matchAll(/data-recommendation-id="([^"]+)"/g)].map(match=>match[1]);
    deep(shown,expected,'Core shortlist order');check(shown.length<=5,'at most five');
    check(markup.includes('recommendation-reason')&&markup.includes('voto positivo'),'real direct evidence visible');
    check(markup.includes('Pochi giudizi disponibili'),'low evidence stays honest');
    check(!markup.includes('movie-ticket')&&markup.includes('recommendation-card'),'dedicated compact row');
    check(markup.includes('2000')&&markup.includes('110 min'),'essential metadata');eq(h.commands.length,0,'read-only ranking');
  },{raw:data.recommendationSet});
  await test('UX10 next batch replaces results without duplicates and exhausts',async h=>{
    await h.boot();Shell.navigate('recommendations');await h.pump();
    const rows=()=>[...document.getElementById('recommendationResults').innerHTML.matchAll(/data-recommendation-id="([^"]+)"/g)].map(match=>match[1]);
    const seen=new Set(rows());eq(seen.size,5,'first batch');
    Shell.showMoreRecommendations();const second=rows();eq(second.length,5,'second batch replaces first');check(second.every(id=>!seen.has(id)),'no duplicate');second.forEach(id=>seen.add(id));
    Shell.showMoreRecommendations();const third=rows();eq(third.length,2,'short final batch');check(third.every(id=>!seen.has(id)),'no duplicate final');
    check(document.getElementById('recommendationMore').classList.contains('hidden'),'no more button after exhaustion');
    check(document.getElementById('recommendationStatus').textContent.includes('tutti i suggerimenti'),'explicit exhaustion');
  },{raw:data.recommendationSet});
  await test('UX10 stale keeps batch until explicit refresh',async h=>{
    await h.boot();Shell.navigate('recommendations');await h.pump();
    const results=document.getElementById('recommendationResults'),before=results.innerHTML;
    for(const row of h.controls.wire.catalog)row.title='Updated proposal '+row.movie_id.slice(-4);
    await h.refresh();
    eq(results.innerHTML,before,'stable shortlist and copy');check(!document.getElementById('recommendationStale').classList.contains('hidden'),'stale visible');
    Shell.refreshRecommendations();check(document.getElementById('recommendationSection').getAttribute('aria-busy')==='true','refresh loading');await h.pump();
    check(document.getElementById('recommendationStale').classList.contains('hidden'),'refresh clears stale');
    check(results.innerHTML.includes('Updated proposal'),'current TARGET snapshot used');
    Shell.detail(data.M);check(document.getElementById('detailBody').innerHTML.includes('SCHEDA FILM'),'existing detail opens');
  },{raw:data.recommendationSet});
  await test('UX10 empty and unavailable inputs are distinct',async h=>{
    await h.boot();Shell.navigate('recommendations');await h.pump();
    check(document.getElementById('recommendationEmpty').textContent.includes('Lista condivisa è vuota'),'empty shared list');
    eq(document.getElementById('recommendationResults').innerHTML,'','no invented result');
  },{raw:data.absent});
  await test('UX10 ineligible candidates are not called empty Lista',async h=>{
    await h.boot();Shell.navigate('recommendations');await h.pump();
    check(document.getElementById('recommendationEmpty').textContent.includes('Nessun film'),'ineligible explanation');
  },{raw:data.noEligible});
  await test('UX10 unavailable Recommendation input shows recoverable error',async h=>{
    await h.boot();Shell.navigate('recommendations');await h.pump();
    check(!document.getElementById('recommendationError').classList.contains('hidden'),'error panel visible');
    check(!!document.getElementById('recommendationRefresh'),'explicit retry control');
  },{raw:data.unavailable});
  await test('Ruota pool never invokes legacy eligibility',async h=>{await h.boot();const ids=wheelPool().map(c=>c.movie_id);deep(ids,h.state.view.ruota.eligibleMovieIds,'approved target pool');await Shell.perform('quickNight',ids[0]);eq(h.commands.at(-1).body.target.movie_id,ids[0],'stable UUID');});
  await test('UX9 empty TARGET wheel points to the Lista',async h=>{await h.boot();resetWheelFilters();Shell.navigate('wheel');eq(wheelBasePool().length,0,'no authoritative candidates');check(document.getElementById('wheelSpinBtn').disabled,'spin disabled');check(document.getElementById('wheelEmptyMessage').textContent.includes('Nessun film disponibile'),'empty explanation');check(!document.getElementById('wheelListAction').classList.contains('hidden'),'Lista access');check(document.getElementById('wheelResetAction').classList.contains('hidden'),'no false filter reset');openWheelList();eq(Shell.getDestination(),'groupList','TARGET Lista route');},{raw:data.absent});
  await test('UX9 filters empty wheel then reset and reactivate spin',async h=>{await h.boot();resetWheelFilters();Shell.navigate('wheel');check(wheelBasePool().length>0,'authoritative pool');h.controls.wire.vetoes.push({veto_id:uid(96999),person_id:data.N,movie_id:data.Q,week_key:h.controls.wire.temporal.week_key});const vetoInfo=document.getElementById('vetoInfo');vetoInfo.textContent='Obsolete veto';Shell.render();check(vetoInfo.hidden&&vetoInfo.textContent==='','no stale veto copy');const result=document.getElementById('wheelWinner');result.classList.remove('hidden');setDurationFilter('epic');eq(wheelPool().length,0,'filtered out');check(result.classList.contains('hidden'),'old result hidden');check(document.getElementById('wheelSpinBtn').disabled,'spin disabled');check(document.getElementById('wheelEmptyMessage').textContent.includes('filtri'),'filter explanation');check(!document.getElementById('wheelResetAction').classList.contains('hidden'),'filter reset visible');resetWheelFilters();check(wheelPool().length>0,'pool restored');check(!document.getElementById('wheelSpinBtn').disabled,'spin enabled');check(document.getElementById('wheelEmptyState').classList.contains('hidden'),'empty explanation hidden');});
  await test('UX9 result keeps quick choice command with Guardiamolo copy',async h=>{await h.boot();resetWheelFilters();Shell.navigate('wheel');const winner=h.state.view.ruota.eligibleContents[0],result=document.getElementById('wheelWinner');renderWheelWinner(result,winner,Shell.presentation());check(result.innerHTML.includes('Guardiamolo')&&!result.innerHTML.includes('>Oggi</button>'),'approved choice label');await Shell.perform('quickNight',winner.movie_id);eq(h.commands.at(-1).body.intent,'QUICK_NIGHT','same date-free command');check(!document.getElementById('wheelPanel').innerHTML.includes('openSurprisePicker'),'misleading Surprise entry absent');});
  await test('captured action request input cannot change later',async h=>{await h.boot();h.controls.holdCommand=true;const input={rating:0,review:''};const result=Shell.perform('setMyEvaluation',data.M,input);await tick();input.rating=10;h.commands[0].resolve();await result;eq(h.commands[0].body.parameters.rating,0,'captured command meaning');});
  await test('bulk reports per-film partial results',async h=>{await h.boot();let n=0;const ui=Shell.createShell({session:h.host,root:document,lookup:async title=>{if(++n===2)h.controls.commandOutcome='STALE';return{title};}});const results=await ui.bulk(['Synthetic one','Synthetic two']);eq(results.length,2,'independent results');eq(results[0].content.outcome,'SUCCESS','first');eq(results[1].content.outcome,'STALE','second');eq(h.commands.length,2,'two commands');});
  await test('target command rejection cannot invoke legacy writer',async h=>{await h.boot();h.controls.commandOutcome='FORBIDDEN';const r=await Shell.perform('recordSeen',data.M);check(r.outcome!=='SUCCESS','rejected');eq(h.legacyEvents.length,0,'no fallback');});
  await test('Auth refresh failure never starts legacy',async h=>{await h.boot();authClient(data.N);sb.auth.getUser=async()=>({data:{user:null},error:{status:401}});await refreshAuthConnection();await h.pump();eq(h.state.phase,'AUTH_INVALIDATING','closed');eq(h.legacyEvents.length,0,'no fallback');});
  await test('schedule failure cannot manufacture a close ticket',async h=>{await h.boot();const token=await h.pending();h.controls.commandOutcome='STALE';const r=await h.host.scheduleMatchedMovie(token,{date:'2027-01-05'});eq(r.closeTicket,null,'no close ticket');eq(h.matchCalls.filter(c=>c.request.p_action==='close').length,0,'no close');});
  await test('target event edit and review stay separate commands',async h=>{await h.boot();const r=await Shell.perform('completeNow',data.M,{participants:[data.N]});await h.pump();await Shell.perform('setGroupEvaluation',data.M,{rating:7});await h.pump();await Shell.perform('editNight',r.result.night_id,{snack:'After viewing'});await h.pump();deep(h.commands.map(c=>c.body.intent),['COMPLETE_NOW','SET_TOGETHER_EVALUATION','EDIT_NIGHT'],'no fake atomic command');});
  await test('controlled real SDK channel maps safe numeric version exactly',async h=>{
    await h.shutdown();authClient(data.N,h);const deps=modules.productionDependencies();deps.runtime.clock=h.targetDependencies.runtime.clock;deps.runtime.scheduler=h.targetDependencies.runtime.scheduler;deps.runtime.enqueue=deps.enqueue=h.targetDependencies.enqueue;
    const app=modules.createCoordinator({mode:'TARGET',target:deps,legacy:{start(){throw Error('Legacy');},stop(){},refresh(){throw Error('Legacy');}},enqueue:deps.enqueue});modules.install(app);
    try{await app.startAuthenticated(data.N);await h.pump();const channel=sb.channels[0];channel.status('SUBSCRIBED');await h.pump();let v=h.controls.wire.versions.entries.find(v=>v.scope_kind==='content');if(!v){v={scope_kind:'content',scope_id:data.M,entity_id:data.M,version:'0',tombstone:false};h.controls.wire.versions.entries.push(v);}v.version='2';h.controls.wire.catalog[0].title='SDK numeric signal';channel.callbacks[0].fn({eventType:'UPDATE',new:{...v,version:2}});await h.pump();eq(app.getState().view.catalog.getContent(data.M).content.title,'SDK numeric signal','accepted refresh');channel.status('CHANNEL_ERROR');const reads=h.snapshots.length;channel.status('SUBSCRIBED');await h.pump();check(h.snapshots.length>reads,'reconnect revalidation');check(app.getState().phase==='READY','reconnect callback supported');
      v.version='9007199254740993';h.controls.wire.catalog[0].title='Exact Snapshot recovery';channel.callbacks[0].fn({eventType:'UPDATE',new:{...v,version:Number(v.version)}});await h.pump();eq(app.getState().view.catalog.getContent(data.M).content.title,'Exact Snapshot recovery','unrepresentable signal causes coherent recovery');await app.action(app.capture(),'updateMetadata',data.M,{title:'Exact CAS'});await h.pump();eq(h.commands.at(-1).body.expected_versions[0].version,'9007199254740993','CAS retains exact Snapshot version');
      let touched=0;const malformed={...v,version:3};Object.defineProperty(malformed,'scope_id',{enumerable:true,get(){touched++;return data.M;}});channel.callbacks[0].fn({eventType:'UPDATE',new:malformed});await h.pump();eq(touched,0,'SDK normalization never evaluates payload getters');}finally{await app.dispose();}
  });
  await test('explicit legacy fixture stays LEGACY through real Auth refresh',async h=>{
    modules.install(modules.originalSession);const f=authClient(data.N);
    try{showApp();await h.pump();eq(ProductionSession.getState().mode,'LEGACY','normal mode');check(!html().includes('Lista personale'),'legacy render not overwritten');check(!f.client.calls.some(c=>c[0]==='rpc'),'no target probe');await refreshAuthConnection();await h.pump();eq(ProductionSession.getState().mode,'LEGACY','same authority');eq(f.client.channels.length,1,'one legacy shared channel');openRecommendationView();check(!ProductionSession.isTarget(),'Recommendation remains legacy');openWheelView();check(!ProductionSession.isTarget(),'Ruota remains legacy');}finally{await modules.originalSession.invalidateAuth();modules.install(h.host);}
  });
  await test('retired legacy Realtime callbacks and pending resync are inert',async h=>{
    modules.install(modules.originalSession);const f=authClient(data.N);showApp();await h.pump();const old=f.client.channels[0];old.callbacks[0].fn();check(resyncTimer!==null,'pending debounce');await modules.originalSession.invalidateAuth();eq(resyncTimer,null,'debounce cancelled');modules.install(h.host);await h.boot();const reads=f.client.calls.length;old.status('SUBSCRIBED');for(const binding of old.callbacks)binding.fn();await h.pump();eq(f.client.calls.length,reads,'no retired legacy read');eq(h.state.phase,'READY','target unaffected');
  });
  await test('late legacy writer result cannot patch retired domain objects',async h=>{
    modules.install(modules.originalSession);authClient(data.N);const old={id:data.M,title:'Old legacy title',seen_n:false,seen_v:false};movies=[old];let reply;sb.from=()=>({update:()=>({eq:()=>({select:()=>new Promise(resolve=>{reply=resolve;})})})});const pending=updateMovie(data.M,{title:'Late legacy title'}).then(()=>null,e=>e);await tick();modules.install(h.host);await h.boot();const before=h.state.view;reply({data:[{...old,title:'Late legacy title'}],error:null});const error=await pending;check(error instanceof TypeError,'late legacy result rejected');eq(old.title,'Old legacy title','retired object not patched');eq(h.state.view,before,'target view unchanged');
  });
  await test('retired legacy Match callbacks cannot reopen channel or resync',async h=>{
    modules.install(modules.originalSession);const fixture=authClient(data.N);dbMode='supabase';matchAvailable=true;matchProbeDone=true;openMatchChannel();const old=fixture.client.channels[0];await modules.originalSession.invalidateAuth();modules.install(h.host);await h.boot();const calls=fixture.client.calls.length;old.status('SUBSCRIBED');for(const binding of old.callbacks)binding.fn();await h.pump();eq(matchChannel,null,'retired channel stays detached');eq(fixture.client.calls.length,calls,'no retired Match read');eq(matchResyncTimer,null,'no pending legacy Match resync');
  });
  await test('group replacement clears old view and Match ownership',async h=>{await h.boot();await h.enterMatch();await h.replace(data.N,data.other);eq(h.state.context.groupId,data.other,'new group');eq(h.state.match.reason,'GROUP_REPLACEMENT_UNSUPPORTED','no multi-group adoption');});
  await test('Match UI uncertainty retries exact swipe without shared mutation',async h=>{await h.boot();await h.enterMatch();const before=h.state.view,card=h.state.match.derived.currentCard;h.controls.matchBefore='swipe';const r=await Shell.performMatch('swipe',card,true);eq(r.category,'TRANSPORT_UNCERTAIN','uncertain Match');const request=copy(h.matchCalls.at(-1).request);await Shell.performMatch('retry',r.retryHandle);deep(h.matchCalls.at(-1).request,request,'exact operation');eq(h.state.view,before,'shared unchanged');eq(h.commands.length,0,'no shared writer');});
  await test('uncertain Match start reconciles instead of auto-starting again',async h=>{await h.boot();h.controls.matchUncertain='start';const r=await Shell.performMatch('enter');await h.pump();eq(r.category,'TRANSPORT_UNCERTAIN','uncertain start');eq(h.matchCalls.filter(c=>c.request.p_action==='start').length,1,'no blind retry');check(!!h.state.match.authoritative.session,'reconciled authoritative session');});
  await test('H1 UI uncertain retry preserves exact observed movie',async h=>{await h.boot();const observed=await h.pending();h.controls.matchUncertain='acknowledge-match';const r=await Shell.performMatch('acknowledge',observed);eq(r.category,'TRANSPORT_UNCERTAIN','uncertain ack');await Shell.performMatch('retry',r.retryHandle);deep(h.matchCalls.at(-1).request.p_parameters,observed,'exact session and movie');});
  await test('H1 old UI observation cannot acknowledge newer pending',async h=>{await h.boot();const old=await h.pending(),id=h.matchServer.session.deck.find(id=>id!==old.matched_movie_id);for(const person of ['N','V'])h.matchServer.swipes.push({id:uid(person==='N'?87001:87002),session_id:old.session_id,movie_id:id,person,liked:true,created_at:data.at});await h.state.matchCommands.reconcile();await h.pump();eq((await Shell.performMatch('acknowledge',old)).category,'INVALID_INPUT','old observation rejected');eq(h.matchCalls.filter(c=>c.request.p_action==='acknowledge-match').length,0,'no accidental newer ack');});
  await test('actual uncertain-action CTA retries the exact captured request',async h=>{
    await h.boot();h.controls.holdSnapshot=true;h.controls.uncertain=true;const before=h.state.view,result=await Shell.perform('recordSeen',data.M);eq(result.outcome,'TRANSPORT_UNCERTAIN','uncertain');const nodes=[];const visit=n=>{nodes.push(n);for(const child of n._children??Array.from(n.children??[]))visit(child);};visit(document.getElementById('targetFeedback'));const retry=nodes.filter(n=>n.textContent==='Riprova la stessa operazione').at(-1);check(!!retry,'retry control visible in feedback panel');const original=copy(h.commands[0].body);await retry.onclick();deep(h.commands[1].body,original,'same UUID body and CAS');deep(h.state.view.personal.caller.seen,before.personal.caller.seen,'no optimistic seen');deep(h.state.view.counts,before.counts,'no optimistic counts');
  });
  // Actual product dialog/participant/double-submit gestures are exercised over
  // real HTTP DOM by verify-product-target-http.cjs (not this non-parsing stub).
  await test('CACHE is visibly stale and cannot authorize shell writes',async h=>{await h.boot();eq(h.state.runtime.source,'CACHE','cache');check(document.getElementById('targetFeedbackMessage').textContent.includes('Dati salvati')&&document.getElementById('syncNotice').textContent.includes('verifica online'),'explicit cache presentation');eq((await Shell.perform('recordSeen',data.M)).outcome,'NOT_READY','runtime rejects writes');eq(h.commands.length,0,'no mutation');await h.reply();eq(h.state.runtime.source,'ONLINE','accepted online');},{cached:true});
  await test('UX2 Home chooses open events by explicit creation, never clock expiry',async h=>{
    const event=(id,status,created,date=null)=>({night_id:id,movie_id:data.M,status,created_at:created,date,time:date?'21:30':null,snack:'Poke',location:'Casa sintetica',proposed_by_person_id:data.N});
    const a=event(data.NIGHT,'confirmed','2027-01-03T22:30:00Z');
    const b=event(data.observer,'confirmed','2027-01-03T23:00:00Z','2027-02-01');
    const proposal=event(data.other,'proposed','2027-01-04T10:00:00Z');
    const context=(events,at)=>ProductContext.create({view:{kind:'AVAILABLE',context:{caller:{personId:data.N,legacyLabel:'N'},observedPerson:{personId:data.N},temporal:{as_of:at,timezone:'Europe/Rome',local_date:at.slice(0,10)}},catalog:{contents:[{movie_id:data.M,title:'Shutter Island'}]},getRecommendationInput:()=>({kind:'AVAILABLE',input:{users:[]}}),getCard:()=>({group:{events:events.map(event=>({event,participants:[]}))}})},session:{capture:()=>({}),current:()=>true},perform(){throw Error('Read-only selector');},edit(){throw Error('Read-only selector');}});
    for(const at of ['2027-01-03T22:30:00Z','2027-01-04T01:30:00Z','2027-01-11T12:00:00Z']){
      const events=[a,b,proposal],before=JSON.stringify(events),pick=context(events,at).homeNightPick();
      eq(pick.nightId,b.night_id,'newest confirmed beats newer proposal');eq(pick.snack,'Poke','event snack');eq(pick.location,'Casa sintetica','event location');eq(JSON.stringify(events),before,'no event mutation');
      eq(context([a],at).homeNightPick().nightId,a.night_id,'one event survives midnight/days');
    }
    eq(context([proposal],data.at).homeNightPick().night_confirmed,false,'fallback remains proposed');
    eq(context([{...b,created_at:a.created_at},a],data.at).homeNightPick().nightId,a.night_id,'creation tie uses ascending nightId');
    eq(context([{...a,status:'completed'},{...b,status:'cancelled'}],data.at).homeNightPick(),null,'terminal events excluded');
    eq(h.commands.length,0,'selection sends no commands');
  });
  await test('UX2 navigation names are contextual and All remains hidden',async h=>{
    await h.boot();Shell.navigate('groupList');syncLibraryNavigation();
    check(document.getElementById('tabAll').classList.contains('!hidden'),'All hidden after navigation styling');
    eq(document.getElementById('libraryPageTitle').textContent,'Da vedere insieme','group collection title');
    Shell.navigate('personalList');eq(document.getElementById('libraryPageTitle').textContent,'Il mio cinema','personal entry');
    eq(document.getElementById('targetPersonalList').textContent,'Da vedere','own collection label');
    Shell.navigate('together');eq(document.getElementById('libraryPageTitle').textContent,'Visti insieme','shared memory title');
    eq(h.commands.length,0,'navigation sends no domain command');
  });
  await test('UX3 shared cards expose choice first and relation removal separately',async h=>{
    await h.boot();Shell.navigate('groupList');const context=Shell.presentation(),movie=context.getMovie(data.M),ops=context.cardOperationsHtml(movie);
    check(ops.includes('Guardiamolo')&&ops.includes('Pianifica'),'two direct daily actions');
    check(ops.includes('movie-list-withdraw')&&ops.includes('Togli dai Da vedere insieme'),'secondary relationship removal');
    check(!/Programmazione|Gestione|Ritira candidatura|Proponi al gruppo|Elimina film/.test(ops),'no technical or delete panel');
    const initial=context.scheduleInitial(movie);eq(initial.selectCandidate,true,'selection capture remains explicit');eq(initial.selectionView,h.state.view,'same committed view');
    eq(h.commands.length,0,'render never creates a relation or night');
  });
  await test('UX3 existing quick is state, not a duplicate-choice CTA',async h=>{
    await h.boot();Shell.navigate('groupList');const context=Shell.presentation(),ops=context.cardOperationsHtml(context.getMovie(data.M));
    check(ops.includes('FILM SCELTO')&&ops.includes('Da vedere insieme'),'approved quick state');
    check(ops.includes('Apri In programma')&&!ops.includes('Guardiamolo'),'no duplicate-choice button for active event');
    eq(h.state.view.events.scheduled[0].event.night_id,data.NIGHT,'original event');eq(h.commands.length,0,'state is read only');
  },{raw:data.quickCard});
  for(const [name,raw,primary] of data.detailCases)await test('UX5 detail '+name,async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),html=context.detailActions(movie);
    check((html.match(/data-detail-primary=/g)||[]).length<=1,'at most one primary');
    if(['together','repeat'].includes(name))check(!html.includes('data-detail-primary=')&&!html.includes('Apri la serata'),'Together star replaces duplicate primary');
    check(!/Il mio percorso|<h4>Il gruppo|Ritira candidatura|Proponi al gruppo|Correggi metadati|Visto insieme ora/.test(html),'no command wall or metadata Add bridge');
    check(!html.includes('Vieta questa settimana')&&!html.includes('>Sorpresa<'),'no residual creation');
    check(html.includes('detail-menu-controls')&&html.includes('Rimuovi film')&&!html.includes('detail-danger-area'),'delete shares management grid');
    check(!html.includes('detail-token-row'),'tokens are in shared film header');
    for(const n of raw.nights)check(html.includes('data-night-id="'+n.night_id+'"'),'each event retains identity');
    eq(h.commands.length,0,'render never writes');
  },{raw});
  await test('UX5 multiple open events require explicit selection',async h=>{
    await h.boot();const context=Shell.presentation(),html=context.detailActions(context.getMovie(data.M));
    check(html.includes('Scegli la serata'),'no arbitrary first event');check(!html.includes('data-detail-primary="complete"'),'no accidental completion');
  },{raw:(()=>{const wire=JSON.parse(JSON.stringify(data.detailCases.find(x=>x[0]==='due')[1]));const n={...wire.nights[0],night_id:'00000000-0000-4000-8000-000000020010'};wire.nights.push(n);wire.versions.entries.push({scope_kind:'night',scope_id:data.G,entity_id:n.night_id,version:'1',tombstone:false});wire.group.states[0].active_night_ids.push(n.night_id);wire.group.collections.scheduled_night_ids.push(n.night_id);wire.coverage.counts.nights++;wire.coverage.counts.version_entries++;return wire;})()});
  await test('UX5 nested editor stays above film detail and returns to it',async h=>{
    await h.boot();Shell.detail(data.M);Shell.edit('setMyEvaluation',data.M);
    const detail=document.getElementById('detailModal'),review=document.getElementById('reviewModal');
    check(Number(review.style.zIndex)>Number(detail.style.zIndex),'nested editor above detail');
    closeModal('reviewModal');check(!detail.classList.contains('hidden'),'origin remains open');
    eq(detail.style.zIndex,'50','remaining modal stack ordered');
  });
  await test('UX5 PO detail choices reuse compact card controls',async h=>{
    await h.boot();const context=Shell.presentation(),html=context.detailActions(context.getMovie(data.M));
    check(html.includes('movie-list-actions detail-choice-actions'),'paired card row');
    check(html.includes('fa-ticket')&&html.includes('fa-calendar-days'),'same ticket and calendar icons');
    check(html.includes('movie-list-primary')&&html.includes('movie-list-secondary'),'same card button styles');
    check(html.includes('Per me')&&html.includes('Per noi')&&html.includes('Altre azioni'),'human scopes distinguished');
  },{raw:data.detailCases.find(x=>x[0]==='shared')[1]});
  await test('UX5 PO confirmations identify the completed command',async h=>{
    await h.boot();await Shell.perform('setMyEvaluation',data.M,{rating:0});
    check(document.getElementById('targetFeedbackMessage').textContent.includes('Giudizio personale aggiornato.'),'judgment confirmation');
    await Shell.perform('addToMyList',data.M);check(document.getElementById('targetFeedbackMessage').textContent.includes('Aggiunto ai tuoi Da vedere'),'list confirmation');
    await Shell.perform('recordSeen',data.M);check(document.getElementById('targetFeedbackMessage').textContent.includes('Aggiunto ai miei Visti.'),'seen confirmation');
    h.controls.commandOutcome='STALE';await Shell.perform('removeSeen',data.M);check(!document.getElementById('targetFeedbackMessage').textContent.includes('Rimosso dai miei Visti'),'no success on rejected operation');
  });
  await test('UX6 agenda groups four events without changing them',async h=>{
    await h.boot();Shell.navigate('scheduled');const page=html();
    const sections=['Da concludere','Proposte in attesa','Scelte senza data','Prossime serate'];
    let previous=-1;for(const title of sections){const position=page.indexOf('aria-label="'+title+'"');check(position>previous,'ordered section '+title);previous=position;}
    for(const n of data.agenda.nights)check(page.includes('data-night-id="'+n.night_id+'"'),'event identity '+n.night_id);
    check(page.includes('FILM SCELTO')&&page.includes('Da vedere insieme'),'quick choice wording');
    check(!page.includes('Data non fissata')&&!page.includes('Scelte rapide (oggi)'),'no misleading quick wording');
    eq(h.state.view.events.scheduled.length,4,'all events remain open');eq(h.commands.length,0,'render is read only');
  },{raw:data.agenda});
  await test('UX6 past proposal has no completion and event details stay scoped',async h=>{
    await h.boot();const context=Shell.presentation(),proposal=context.nights.find(n=>n.status==='proposed');
    const actions=context.eventActions(proposal);check(actions.includes('Annulla proposta')&&!actions.includes('Completa serata'),'past proposal cannot complete');
    for(const night of context.nights)check(night.snack==='Poke'&&night.location==='Casa','event details retained');
    Shell.navigate('calendar');check(html().includes('data-night-id="'+data.agenda.nights[2].night_id+'"'),'calendar quick identity');
    check(html().includes('Scelte senza data')&&html().includes('FILM SCELTO'),'calendar quick wording');
    eq(h.commands.length,0,'calendar is read only');
  },{raw:data.agenda});
  await test('UX6 selected night opens inside its film detail',async h=>{
    await h.boot();const selectedId=data.agenda.nights[2].night_id,body=document.getElementById('detailBody');let focused=null;
    const summary={focus(){focused=selectedId;},scrollIntoView(){}};
    const row={dataset:{nightId:selectedId},open:false,querySelector:()=>summary};
    const list={open:false,querySelectorAll:()=>[row],querySelector:()=>summary};
    body.querySelector=selector=>selector==='[data-detail-nights]'?list:null;
    detailTransitionActive=false;
    Shell.detail(data.M,null,selectedId);
    check(list.open&&row.open&&focused===selectedId,'selected night expanded and focused: '+[list.open,row.open,focused,body.innerHTML.includes('SCHEDA FILM'),Shell.presentation().current()].join(','));
    eq(h.commands.length,0,'opening detail does not write');
  },{raw:data.agenda});
  await test('UX7 one completed night has a single film archive access',async h=>{
    await h.boot();Shell.navigate('together');const context=Shell.presentation(),movie=context.getMovie(data.M);
    eq(context.completedNights(movie).length,1,'one completed event');
    check(!html().includes('1 serata')&&html().includes('together-star'),'star replaces card count');
    check(context.togetherPopupHtml(movie).includes('Le nostre visioni'),'completed night is in Together popup');
    check(!context.detailActions(movie).includes('Apri la serata'),'no parallel detail access');
    eq(h.commands.length,0,'archive rendering is read only');
  },{raw:data.detailCases.find(x=>x[0]==='together')[1]});
  await test('UX7 rewatch count and detail order exclude open event',async h=>{
    await h.boot();Shell.navigate('together');const context=Shell.presentation(),movie=context.getMovie(data.M),completed=context.completedNights(movie);
    eq(completed.length,2,'only completed nights counted');check(!html().includes('2 serate')&&context.togetherPopupHtml(movie).includes('Le nostre visioni · 2'),'count moved into popup');
    const detail=context.detailActions(movie),first=detail.indexOf('data-night-id="'+completed[0].night.id+'"'),second=detail.indexOf('data-night-id="'+completed[1].night.id+'"');
    check(first>=0&&second>first,'completed nights ordered newest first');
    check(detail.indexOf('Altre serate')>second,'open event separated after completed');
    check(completed.every(entry=>entry.night.status==='completed'),'status remains event specific');
    eq(h.commands.length,0,'no event or judgment changes');
  },{raw:(()=>{const wire=JSON.parse(JSON.stringify(data.multiple));const completed=wire.nights.filter(n=>n.status==='completed');completed[0].date='2027-01-02';completed[1].date='2027-01-03';return wire;})()});
  await test('UX7 multi-night access expands existing detail list',async h=>{
    await h.boot();Shell.navigate('together');const body=document.getElementById('detailBody');let focused=false;
    const summary={focus(){focused=true;},scrollIntoView(){}};
    const list={open:false,querySelectorAll:()=>[],querySelector:()=>summary};
    body.querySelector=selector=>selector==='[data-detail-nights]'?list:null;
    detailTransitionActive=false;Shell.detail(data.M,null,null,true);
    check(list.open&&focused,'completed list expanded and reachable');eq(h.commands.length,0,'detail access is read only');
  },{raw:data.multiple});
  for(const [name,wire,visible,completed,open] of [
    ['only cancelled',data.cancelledOnly,0,0,0],
    ['cancelled with completed',data.cancelledCompleted,1,1,0],
    ['cancelled with open',data.cancelledOpen,1,0,1]
  ])await test('cancelled film nights hidden: '+name,async h=>{
    await h.boot();const rawBefore=copy(h.controls.wire.nights),context=Shell.presentation(),markup=context.detailActions(context.getMovie(data.M));
    const rows=[...markup.matchAll(/data-night-id="([^"]+)"/g)].map(match=>match[1]);
    eq(rows.length,visible,'visible row count');check(!markup.includes('Serata annullata'),'cancelled label absent');
    if(visible){check(markup.includes('Le serate · '+visible),'summary count');check(!markup.includes('Le serate · '+(visible+1)),'cancelled excluded from count');}
    else check(!markup.includes('data-detail-nights')&&!markup.includes('Le serate')&&!markup.includes('Altre serate'),'empty nights section absent');
    if(completed)check(markup.includes('Serate concluse · '+completed),'completed group retained');
    if(open)check(markup.includes('Altre serate'),'open group retained');
    deep(h.controls.wire.nights,rawBefore,'persistent cancelled event untouched');eq(h.commands.length,0,'presentation read only');
  },{raw:wire});
  await test('cancelled selected night cannot reopen after Snapshot reconciliation',async h=>{
    await h.boot();const selected=data.cancelledMixed.nights.find(n=>n.status==='proposed').night_id;
    const body=document.getElementById('detailBody'),summary={focus(){},scrollIntoView(){}};
    const row={dataset:{nightId:selected},open:false,querySelector:()=>summary};
    const list={open:false,querySelectorAll:()=>[row],querySelector:()=>summary};
    body.querySelector=selector=>selector==='[data-detail-nights]'?list:null;
    detailTransitionActive=false;Shell.detail(data.M,null,selected);check(list.open&&row.open,'selected open event initially reached');
    await Shell.perform('cancelNight',selected);await h.pump();
    list.open=false;row.open=false;const context=Shell.presentation(),markup=context.detailActions(context.getMovie(data.M));
    check(!markup.includes('data-night-id="'+selected+'"'),'cancelled row removed after resync');
    check(markup.includes('Le serate · 1'),'remaining completed count');
    context.openDetailNights(selected);check(!list.open&&!row.open,'stale nightId cannot reopen cancelled event');
    eq(h.state.view.getEvent(selected).event.event.status,'cancelled','domain record retained');
  },{raw:data.cancelledMixed});
  const clickProduct=(context,markup,label)=>{
    const tag=[...markup.matchAll(/<button[^>]*data-product-action="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].find(match=>match[2].includes(label));
    check(!!tag,'action '+label+' exists');
    const node={dataset:{productAction:tag[1],listRemoval:label.startsWith('Togli dai')?'true':undefined},disabled:false,isConnected:true,innerHTML:label,closest:()=>null,focus(){},setAttribute(){},removeAttribute(){}};
    context.bind({querySelectorAll:selector=>selector==='[data-product-action]'?[node]:[]});
    return node.onclick({stopPropagation(){}});
  };
  for(const [name,route,raw,intent,label] of [['shared','groupList',data.raw,'WITHDRAW_GROUP_CANDIDACY','Togli dai Da vedere insieme'],['personal','personalList',data.selfList,'REMOVE_PERSONAL_LIST','Togli dai miei Da vedere']])
    await test('UX12 list removal '+name+' cancel then confirm',async h=>{
      await h.boot();Shell.navigate(route);const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.cardOperationsHtml(movie);
      check(markup.includes('>'+label+'</button>')&&!markup.includes('movie-list-minus'),'plain text action');
      const original=showConfirmModal;let question='';
      try{
        showConfirmModal=(title)=>{question=title;return Promise.resolve(false);};await clickProduct(context,markup,label);eq(h.commands.length,0,'cancel writes nothing');check(question.includes(movie.title),'film in prompt');
        showConfirmModal=(title)=>{question=title;return Promise.resolve(true);};await clickProduct(context,markup,label);await h.pump();eq(h.commands.length,1,'one confirmed write');eq(h.commands[0].body.intent,intent,'relation only');
        check(question.includes(name==='shared'?'Da vedere insieme':'tuoi Da vedere'),'list in prompt');
        check(document.getElementById('targetFeedbackMessage').textContent.includes('Rimosso')||document.getElementById('targetFeedbackMessage').textContent.includes('Tolto'),'feedback outside grid');
        Shell.navigate('home');eq(document.getElementById('targetFeedbackMessage').textContent,'','no feedback in other collection');
      }finally{showConfirmModal=original;}
    },{raw});
  await test('UX12 Ponyo from Valeria Seen adds same catalog film to shared List',async h=>{
    await h.boot();h.host.setObservedPerson(data.V);await h.pump();Shell.navigate('personalSeen');const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.detailActions(movie);
    check(markup.includes('Vorrei vederlo insieme'),'inverse action visible');
    await clickProduct(context,markup,'Vorrei vederlo insieme');await h.pump();
    eq(h.commands.length,1,'one write');eq(h.commands[0].body.intent,'PROPOSE_TO_GROUP','group relation');eq(h.commands[0].body.target.movie_id,data.M,'same catalog id');
    eq(document.getElementById('targetFeedbackMessage').textContent,'Aggiunto a Da vedere insieme','visible outcome');
  },{raw:data.seenOther});
  const tokenCases=[
    ['nobody seen',{},false],['only N seen',{nSeen:true},false],['only V seen',{vSeen:true},false],
    ['both separately seen',{nSeen:true,vSeen:true},false],['N rating',{nSeen:true,nRating:8.6},false],
    ['N positive preference',{nPreference:true},false],['N negative preference',{nPreference:false},false],
    ['V preference',{vSeen:true,vPreference:true},false],['both judgments',{nRating:8.6,vPreference:false},false],
    ['N preference and V rating',{nPreference:true,vRating:7.5},false],
    ['Together without personal seen',{},true],['Together with N seen',{nSeen:true},true],
    ['Together with both seen',{nSeen:true,vSeen:true},true],['Together without rating',{},true],
    ['Together with rating',{groupRating:8.8},true],['judgment without seen',{nRating:7.3},false],
    ['Together N rating and V preference',{nRating:8.6,vPreference:true,groupRating:8.2},true],
    ['Together N preference and V rating',{nPreference:true,vRating:7.5,groupRating:8.2},true]
  ];
  for(const [name,options,together]of tokenCases){
    const raw=copy(together?data.cancelledCompleted:data.absent);
    raw.personal[0].states[0].seen=!!options.nSeen;raw.personal[1].states[0].seen=!!options.vSeen;
    if(options.nRating!=null)raw.personal[0].states[0].judgment.rating=options.nRating;
    if(options.nPreference!=null)raw.personal[0].states[0].judgment.preference=options.nPreference;
    if(options.vRating!=null)raw.personal[1].states[0].judgment.rating=options.vRating;
    if(options.vPreference!=null)raw.personal[1].states[0].judgment.preference=options.vPreference;
    if(options.groupRating!=null)raw.group.judgments.push({movie_id:data.M,rating:options.groupRating,review:null});
    finish(raw);
    await test('UX12 tokens '+name,async h=>{
      await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.viewingStatusHtml(movie);
      check(markup.includes('person-token-n')&&markup.includes('person-token-v'),'both identity tokens');
      check(markup.includes('person-token-n '+(options.nSeen?'is-seen':'is-outline')),'N seen independent');
      check(markup.includes('person-token-v '+(options.vSeen?'is-seen':'is-outline')),'V seen independent');
      eq(markup.includes('together-cluster'),together,'gold only completed');eq(markup.includes('together-star'),together,'star only completed');
      check(!markup.includes('/10'),'no card scale suffix');
      check(!markup.includes('fa-pen')&&!markup.includes('person-token-edit'),'no permanent edit affordance');
      if(options.nRating!=null)check(markup.includes('fa-star')&&markup.includes(String(options.nRating).replace('.',',')),'personal numeric rating has a star');
      if(options.nRating!=null)check(markup.includes(String(options.nRating).replace('.',',')),'N rating visible');
      if(options.nPreference!=null)check(markup.includes(options.nPreference?'fa-thumbs-up':'fa-thumbs-down'),'N preference visible');
      if(options.vRating!=null)check(markup.includes(String(options.vRating).replace('.',',')),'V rating visible');
      if(options.vPreference!=null)check(markup.includes(options.vPreference?'fa-thumbs-up':'fa-thumbs-down'),'V preference visible');
      if(options.groupRating!=null)check(markup.includes(String(options.groupRating).replace('.',',')),'Together rating is own value');
      if(together)check(markup.includes('fa-users')&&markup.includes('together-star'),'group icon opens Together');
      if(together)eq(markup.includes('together-rating'),options.groupRating!=null,'group star only accompanies numeric rating');
      check(markup.includes('aria-label="Apri il tuo Visto e giudizio'),'one caller context label');
      eq((markup.match(/class="person-token person-token-n/g)||[]).length,1,'one caller token');
      check(!markup.includes('aria-label="Valuta il film · '+movie.title+'" class="person-token-v'),'other read only');
    },{raw});
  }
  await test('UX12 Together popup one completed night is read first',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.togetherPopupHtml(movie);
    check(markup.includes('Il nostro giudizio')&&markup.includes('Le nostre visioni'),'narrative sections');
    eq((markup.match(/data-night-id=/g)||[]).length,1,'only completed night');
    check(!markup.includes('Serata annullata')&&!markup.includes('Racconto della serata'),'no cancelled or fake memory');
    check(markup.includes('Modifica serata')&&markup.includes('data-night-id="'+data.cancelledCompleted.nights[0].night_id+'"'),'existing night identity');
    Shell.together(data.M);eq(modalStackTop(),'togetherModal','star opens modal');closeModal('togetherModal');
  },{raw:data.cancelledCompleted});
  await test('UX12 Together popup multiple nights remain event scoped',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.togetherPopupHtml(movie);
    eq((markup.match(/data-night-id=/g)||[]).length,2,'only completed nights listed');
    for(const n of data.multiple.nights.filter(n=>n.status==='completed'))check(markup.includes('data-night-id="'+n.night_id+'"'),'completed night id');
    check(!markup.includes('data-night-id="'+data.multiple.nights.find(n=>n.status==='proposed').night_id+'"'),'open proposal excluded');
    check(!context.viewingStatusHtml(movie).includes('2 serate'),'card has no count');
  },{raw:data.multiple});
  await test('UX12 Together read view keeps movie judgment and event details separate',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.togetherPopupHtml(movie);
    check(markup.includes('Una recensione del film')&&markup.includes('★ 8,8'),'movie-based judgment');
    eq((markup.match(/★ 8,8/g)||[]).length,1,'Together rating only in header');
    check(markup.includes('Casa')&&markup.includes('🍿 Poke'),'event-specific context');
    check(!markup.includes('Registrata il')&&!markup.includes('La data della visione resta'),'narrative night copy');
    check(!context.viewingStatusHtml(movie).includes('Una recensione del film'),'review is in popup, not cluster');
    eq(h.commands.length,0,'reading is not a write');
  },{raw:(()=>{const wire=copy(data.cancelledCompleted);wire.group.judgments.push({movie_id:data.M,rating:8.8,review:'Una recensione del film'});wire.nights[0].location='Casa';wire.nights[0].snack='Poke';return finish(wire);})()});
  await test('UX12 completed night edit reuses its event editor without date mutation',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.togetherPopupHtml(movie);
    await clickProduct(context,markup,'Modifica serata');
    eq(modalStackTop(),'scheduleModal','existing night editor');
    eq(document.getElementById('scheduleModalTitle').textContent,'Dettagli della serata','night editing context');
    check(document.getElementById('scheduleDateField').classList.contains('hidden'),'completed date stays protected');
    check(document.getElementById('scheduleHint').textContent.includes('data e l’ora'),'constraint explained only in editor');
    eq(h.commands.length,0,'opening editor does not write');closeModal('scheduleModal');
  },{raw:data.cancelledCompleted});
  await test('UX12 Together star is a keyboard button and popup closes',async h=>{
    await h.boot();const context=Shell.presentation(),markup=context.viewingStatusHtml(context.getMovie(data.M));
    const match=markup.match(/<button[^>]*data-product-action="([^"]+)"[^>]*class="together-star"/);check(!!match,'semantic star button');
    check(markup.includes('aria-label="Apri Insieme e le serate'),'accessible star name');
    const node={dataset:{productAction:match[1]},closest:()=>null,focus(){},setAttribute(){},removeAttribute(){}};
    context.bind({querySelectorAll:selector=>selector==='[data-product-action]'?[node]:[]});node.onclick({stopPropagation(){}});
    eq(modalStackTop(),'togetherModal','star opens Together modal');closeModal('togetherModal');eq(modalStackTop(),null,'modal closes');
    check(modules.css.includes('.together-star:focus-visible')&&modules.modalsSource.includes("'togetherModal'")&&modules.modalsSource.includes("'personalStatusModal'"),'focus ring and Tab trap');
  },{raw:data.cancelledCompleted});
  await test('UX12 whole personal token opens seen and judgment context',async h=>{
    await h.boot();const context=Shell.presentation(),markup=context.viewingStatusHtml(context.getMovie(data.M));
    const own=markup.match(/<button[^>]*data-product-action="([^"]+)"[^>]*class="person-token person-token-n/);check(!!own,'whole caller token is button');
    check(markup.includes('<span class="person-token person-token-v'),'other token is read only');
    check(!markup.includes('person-token-identity')&&!markup.includes('person-token-judgment'),'no internal controls');
    const node={dataset:{productAction:own[1]},closest:()=>null,focus(){},setAttribute(){},removeAttribute(){}};
    context.bind({querySelectorAll:selector=>selector==='[data-product-action]'?[node]:[]});node.onclick({stopPropagation(){}});
    eq(modalStackTop(),'personalStatusModal','token opens personal context');
    const content=document.getElementById('personalStatusBody').innerHTML;
    check(content.includes('Segna come visto')&&content.includes('Valuta il film'),'both independent actions available');closeModal('personalStatusModal');
  },{raw:data.absent});
  await test('UX12 own judgment opens from the unified token context',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.viewingStatusHtml(movie);
    eq(context.cardReviewsHtml(movie),'','no review accordion or preview on card');
    check(!context.detailActions(movie).includes('Recensione di'),'no parallel detail judgment entry');
    const match=markup.match(/<button[^>]*data-product-action="([^"]+)"[^>]*class="person-token person-token-n/);check(!!match,'one own token');
    const node={dataset:{productAction:match[1]},closest:()=>null,focus(){},setAttribute(){},removeAttribute(){}};
    context.bind({querySelectorAll:selector=>selector==='[data-product-action]'?[node]:[]});node.onclick({stopPropagation(){}});
    eq(modalStackTop(),'personalStatusModal','personal context opens first');
    await clickProduct(context,context.personalStatusHtml(movie),'Modifica giudizio');
    eq(modalStackTop(),'reviewModal','own editor');eq(document.getElementById('reviewText').value,'Recensione mia','own review prefilled');
    closeModal('reviewModal');
  },{raw:(()=>{const wire=copy(data.absent);wire.personal[0].states[0].judgment.rating=7.5;wire.personal[0].states[0].judgment.review='Recensione mia';return finish(wire);})()});
  for(const [name,judgment,visible]of [
    ['review',{rating:null,preference:null,review:'Recensione di Valeria'},'Recensione di Valeria'],
    ['rating',{rating:7.5,preference:null,review:null},'★ 7,5'],
    ['preference',{rating:null,preference:false,review:null},'👎 Non mi è piaciuto']
  ])await test('UX12 other member '+name+' opens read only',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.viewingStatusHtml(movie);
    eq(context.cardReviewsHtml(movie),'','no card review');
    const match=markup.match(/<button[^>]*data-product-action="([^"]+)"[^>]*class="person-token person-token-v/);check(!!match,'other token is a read control');
    const node={dataset:{productAction:match[1]},closest:()=>null,focus(){},setAttribute(){},removeAttribute(){}};
    context.bind({querySelectorAll:selector=>selector==='[data-product-action]'?[node]:[]});node.onclick({stopPropagation(){}});
    eq(modalStackTop(),'otherJudgmentModal','read-only popup');
    const content=document.getElementById('otherJudgmentBody').innerHTML;
    check(content.includes(visible),'correct other judgment');
    check(!content.includes('data-product-action')&&!content.includes('<input')&&!content.includes('<textarea'),'no other-person writer');
    eq(h.commands.length,0,'read only');closeModal('otherJudgmentModal');
  },{raw:(()=>{const wire=copy(data.absent);wire.personal[1].states[0].judgment={...judgment};return finish(wire);})()});
  await test('UX12 Together popup omits redundant film action over film detail',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M);
    check(context.togetherPopupHtml(movie).includes('Apri dettaglio film'),'outside detail access remains');
    check(!context.togetherPopupHtml(movie,{fromDetail:true}).includes('Apri dettaglio film'),'underlying detail needs no duplicate');
    Shell.detail(data.M);Shell.together(data.M);
    check(!document.getElementById('togetherPopupBody').innerHTML.includes('Apri dettaglio film'),'shell detects underlying detail');
    closeModal('togetherModal');closeModal('detailModal');
  },{raw:data.cancelledCompleted});
  await test('UX12 320px cluster uses wrap without a fixed card height',async h=>{
    await h.boot();const css=modules.css;
    check(css.includes('.personal-tokens { display:flex; align-items:center; flex-wrap:wrap'),'token wrapping');
    check(css.includes('@media(max-width:360px){ .together-cluster { max-width:100%; justify-content:center'),'narrow cluster rule');
    check(css.includes('.together-cluster .person-token-face,.together-cluster .person-token.is-seen .person-token-face { min-height:28px; padding:2px 6px; border:0; background:transparent'),'no nested pills');
    check(css.includes('.together-star { display:inline-flex;')&&css.includes('background:transparent; color:inherit'),'star shares one gold surface');
    check(!css.includes('.movie-ticket { height:'),'no fixed whole-card height');
  },{raw:data.cancelledCompleted});
  await test('UX12 TARGET card film identity precedes ratings and state',async h=>{
    await h.boot();Shell.navigate('personalList');
    const context=Shell.presentation(),movie=context.getMovie(data.M),card=createMovieCard(movie,[],context),markup=card.innerHTML;
    const order=['card-poster','card-title-band','card-director','card-genres','rating-holo','personal-tokens','movie-list-choices'];
    for(let index=1;index<order.length;index++)check(markup.indexOf(order[index-1])<markup.indexOf(order[index]),order[index-1]+' before '+order[index]);
    check(markup.includes('IMDb')&&markup.includes('RT')&&markup.includes('MC'),'all external providers retained');
    check(!markup.includes('movie-card-review')&&!markup.includes('>Recensione<'),'no inline reviews');
    check(card.className.includes('collection-personalList'),'collection layout context');
  },{raw:(()=>{const wire=copy(data.selfList);Object.assign(wire.catalog[0],{title:'Christiane F. - Noi, i ragazzi dello zoo di Berlino',director:'Uli Edel',genres:['Dramma','Biografico'],imdb_rating:'7.5',rt_rating:'64%',metacritic_rating:'62'});return finish(wire);})()});
  await test('UX12 sparse Together card collapses absent film metadata',async h=>{
    await h.boot();Shell.navigate('together');
    const context=Shell.presentation(),movie=context.getMovie(data.M),card=createMovieCard(movie,[],context),markup=card.innerHTML;
    check(card.className.includes('collection-together')&&markup.includes('together-cluster'),'Together card preserves its cluster');
    check(!markup.includes('card-director')&&!markup.includes('card-genres')&&markup.includes('IMDb n.d.')&&markup.includes('RT n.d.')&&markup.includes('MC n.d.'),'missing film metadata retains provider slots');
    check(!markup.includes('movie-card-review')&&!markup.includes('1 serata'),'compact Together presentation');
  },{raw:(()=>{const wire=copy(data.cancelledCompleted);Object.assign(wire.catalog[0],{title:'Detachment',director:null,genres:[],imdb_rating:null,rt_rating:null,metacritic_rating:null,collection_id:null});return finish(wire);})()});
  await test('UX12 Ponyo personal card keeps preference and wrapping genres',async h=>{
    await h.boot();Shell.navigate('personalList');
    const context=Shell.presentation(),markup=createMovieCard(context.getMovie(data.M),[],context).innerHTML;
    check(markup.includes('Ponyo sulla scogliera')&&markup.includes('Animazione')&&markup.includes('Fantastico')&&markup.includes('Avventura'),'film identity retained');
    check(markup.includes('fa-thumbs-up')&&!markup.includes('together-cluster'),'personal preference stays separate');
    check(markup.indexOf('card-genres')<markup.indexOf('personal-tokens'),'genres before personal state');
  },{raw:(()=>{const wire=copy(data.selfList);Object.assign(wire.catalog[0],{title:'Ponyo sulla scogliera',director:'Hayao Miyazaki',genres:['Animazione','Fantastico','Avventura']});wire.personal[0].states[0].judgment.preference=true;return finish(wire);})()});
  await test('UX12 Dune shared card keeps choices Saga and list removal',async h=>{
    await h.boot();Shell.navigate('groupList');
    const context=Shell.presentation(),card=createMovieCard(context.getMovie(data.M),[],context),markup=card.innerHTML;
    check(markup.includes('Dune')&&markup.includes('personal-tokens')&&!markup.includes('together-cluster'),'personal rating without Together');
    check(markup.includes('Guardiamolo')&&markup.includes('Pianifica'),'primary choices retained');
    check(markup.includes('saga-entry-compact')&&markup.includes('movie-list-withdraw'),'secondary actions retained');
    check(markup.indexOf('movie-list-actions')<markup.indexOf('movie-list-secondary-strip'),'primary before secondary');
    check(card.className.includes('collection-groupList'),'shared collection aligns actions');
  },{raw:(()=>{const wire=copy(data.absent);Object.assign(wire.catalog[0],{title:'Dune',director:'Denis Villeneuve',genres:['Fantascienza'],collection_id:'123',collection_name:'Dune',imdb_rating:'8.0'});Object.assign(wire.group.states[0],{effective_candidacy:true,list_visible:true,eligibility:{match_base:true,ruota_base:true}});wire.personal[0].states[0].judgment.rating=8.6;return finish(wire);})()});
  await test('UX12 Scary Movie Together card retains Saga and star access',async h=>{
    await h.boot();Shell.navigate('together');
    const context=Shell.presentation(),markup=createMovieCard(context.getMovie(data.M),[],context).innerHTML;
    check(markup.includes('Scary Movie')&&markup.includes('together-cluster')&&markup.includes('together-star'),'Together state preserved');
    check(markup.includes('saga-entry-compact')&&!markup.includes('1 serata'),'Saga without card night count');
    check(markup.indexOf('card-genres')<markup.indexOf('together-cluster'),'film identity before Together');
  },{raw:(()=>{const wire=copy(data.cancelledCompleted);Object.assign(wire.catalog[0],{title:'Scary Movie',director:'Keenen Ivory Wayans',genres:['Commedia','Horror'],collection_id:'456',collection_name:'Scary Movie'});wire.personal[0].states[0].judgment.rating=7.3;wire.group.judgments.push({movie_id:data.M,rating:8.2,review:null});return finish(wire);})()});
  for(const [title,judgments,expected] of [
    ['(500) giorni insieme',[{rating:7.3},{rating:8.2}],['7,3','8,2']],
    ['1917',[{preference:true},{}],['fa-thumbs-up']],
    ['2012',[{},{}],['person-token-n','person-token-v']]
  ])await test('UX12 sparse and dual-judgment card '+title,async h=>{
    await h.boot();Shell.navigate('personalList');const context=Shell.presentation(),markup=createMovieCard(context.getMovie(data.M),[],context).innerHTML;
    check(markup.includes(title),'movie title');for(const value of expected)check(markup.includes(value),'state '+value);
    check(!markup.includes('together-cluster')&&!markup.includes('movie-card-review'),'no invented Together or inline review');
  },{raw:(()=>{const wire=copy(data.selfList);Object.assign(wire.catalog[0],{title,director:null,genres:[],imdb_rating:null,rt_rating:null,metacritic_rating:null,collection_id:null});for(let index=0;index<2;index++)Object.assign(wire.personal[index].states[0].judgment,judgments[index]);return finish(wire);})()});
  await test('UX12 card layout rules keep narrow and long content fluid',async h=>{
    await h.boot();const css=modules.css;
    check(css.includes('.is-target-card .card-director')&&css.includes('overflow-wrap:anywhere'),'long director wraps');
    check(css.includes('.is-target-card .rating-holo')&&css.includes('background:none; animation:none'),'ratings are quiet metadata');
    check(css.includes('.is-target-card .card-genres')&&css.includes('flex-wrap'),'genres wrap');
    check(css.includes('@media (max-width:360px)')&&css.includes('.is-target-card .movie-list-actions { grid-template-columns:minmax(0,1fr); }'),'320px actions stack');
    check(css.includes('.movie-ticket.is-target-card::before')&&css.includes('.is-target-card .ticket-seam { border-top:0; }'),'poster seam removed');
    check(!css.includes('.movie-ticket.is-target-card { height:'),'no fixed card height');
  },{raw:data.absent});
  await test('UX12 unified desktop grid and mobile card rules',async h=>{
    await h.boot();const css=modules.css;
    check(css.includes('#movieGrid:has(> .is-target-card) { grid-auto-rows:1fr; align-items:stretch; }'),'desktop rows share track size');
    check(css.includes('.is-target-card .card-actions { display:flex; flex-direction:column; justify-content:flex-end; min-height:108px; margin-top:auto; }'),'action zone anchors to bottom');
    check(css.includes('#movieGrid:has(> .is-target-card) { grid-auto-rows:auto; align-items:start; }'),'mobile uses natural height');
    check(css.includes('.is-target-card .card-actions { min-height:0; }'),'mobile removes reserved action space');
  },{raw:data.absent});
  await test('UX12 Seen card has own contextual actions without legacy menu',async h=>{
    await h.boot();h.host.setObservedPerson(data.V);Shell.navigate('personalSeen');
    const context=Shell.presentation(),movie=context.getMovie(data.M),markup=createMovieCard(movie,[],context).innerHTML;
    check(markup.includes('Voglio vederlo')&&markup.includes('Vorrei vederlo insieme'),'caller list actions available');
    check(!markup.includes('L’ho visto anch’io')&&!context.detailActions(movie).includes('L’ho visto anch’io'),'personal seen managed only through own token');
    check(!markup.includes('movie-list-overflow')&&!markup.includes('fa-ellipsis'),'no Seen overflow menu');
    check(markup.includes('personal-tokens')&&!markup.includes('together-cluster'),'other Seen remains separate from Together');
    eq(h.commands.length,0,'render is read only');
  },{raw:data.seenOther});
  for(const [label,intent] of [['Voglio vederlo','ADD_PERSONAL_LIST'],['Vorrei vederlo insieme','PROPOSE_TO_GROUP']])
    await test('UX12 other member Seen card action '+label+' writes caller or group only',async h=>{
      await h.boot();h.host.setObservedPerson(data.V);Shell.navigate('personalSeen');
      const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.cardOperationsHtml(movie);
      const otherBefore=copy(h.controls.wire.personal.find(p=>p.person_id===data.V).states[0]);
      await clickProduct(context,markup,label);await h.pump();
      eq(h.commands.length,1,'one action command');eq(h.commands[0].body.intent,intent,'expected relation intent');
      deep(h.controls.wire.personal.find(p=>p.person_id===data.V).states[0],otherBefore,'observed person remains read only');
    },{raw:data.seenOther});
  await test('UX12 Seen card hides already existing list relations',async h=>{
    await h.boot();Shell.navigate('personalSeen');
    const context=Shell.presentation(),movie=context.getMovie(data.M),markup=createMovieCard(movie,[],context).innerHTML;
    check(!markup.includes('Voglio vederlo')&&!markup.includes('Voglio rivederlo')&&!markup.includes('Vorrei vederlo insieme'),'no duplicate relation actions');
    check(!markup.includes('movie-list-overflow'),'no management menu');
  },{raw:(()=>{const wire=copy(data.selfList);wire.personal[0].states[0].seen=true;Object.assign(wire.group.states[0],{effective_candidacy:true,list_visible:true});return finish(wire);})()});
  await test('UX12 cinema metadata has one location on card and detail',async h=>{
    await h.boot();Shell.navigate('groupList');
    const context=Shell.presentation(),movie=context.getMovie(data.M),markup=createMovieCard(movie,[],context).innerHTML;
    eq((markup.match(/Al cinema \/ prossimamente/g)||[]).length,1,'cinema card media overlay only');
    check(!markup.includes('bg-amber-600/80'),'no legacy orange body badge');
    Shell.detail(data.M);const detail=document.getElementById('detailBody').innerHTML;
    eq((detail.match(/Al cinema \/ prossimamente/g)||[]).length,1,'cinema detail metadata only');
    check(!detail.includes('bg-amber-600/80'),'detail badge removed');
  },{raw:(()=>{const wire=copy(data.absent);Object.assign(wire.catalog[0],{title:'Digger',cinema_watchlist:true});return finish(wire);})()});
  await test('UX12 Movie Detail reuses ratings and token row in film header',async h=>{
    await h.boot();Shell.detail(data.M);const markup=document.getElementById('detailBody').innerHTML;
    const order=['detail-cover','detail-title','detail-meta','card-director','card-genres','external-ratings','detail-token-row'];
    for(let index=1;index<order.length;index++)check(markup.indexOf(order[index-1])<markup.indexOf(order[index]),'detail '+order[index-1]+' before '+order[index]);
    eq((markup.match(/external-ratings/g)||[]).length,1,'one shared rating component');
    eq((markup.match(/class="detail-token-row"/g)||[]).length,1,'one token row');
    check(!markup.includes('Visti insieme ·'),'no parallel Together label');
  },{raw:(()=>{const wire=copy(data.selfList);Object.assign(wire.catalog[0],{title:'Ponyo',director:'Hayao Miyazaki',genres:['Animazione','Avventura'],imdb_rating:'7.7',rt_rating:'91%',metacritic_rating:'86'});return finish(wire);})()});
  await test('UX12 trailer appears once inside the detail header',async h=>{
    await h.boot();Shell.detail(data.M);const markup=document.getElementById('detailBody').innerHTML;
    const header=markup.indexOf('detail-header-actions'),trailer=markup.indexOf('Guarda il trailer'),story=markup.indexOf('data-detail-story');
    check(header>=0&&trailer>header&&story>trailer,'trailer before story in header');
    eq((markup.match(/Guarda il trailer/g)||[]).length,1,'no second trailer below');
    check(markup.includes('target="_blank" rel="noopener"')&&markup.includes('fa-play'),'existing link behavior and icon');
    check(modules.css.includes('.detail-header-actions { grid-column:1 / -1; display:flex;')&&modules.css.includes('flex-wrap:wrap; gap:8px 14px;'),'header wraps when space is narrow');
  },{raw:(()=>{const wire=copy(data.absent);wire.catalog[0].trailer_url='https://example.test/trailer';wire.catalog[0].overview='Una storia.';return finish(wire);})()});
  await test('UX12 Together detail uses star without parallel completed-night CTAs',async h=>{
    await h.boot();Shell.navigate('together');Shell.detail(data.M);const markup=document.getElementById('detailBody').innerHTML;
    check(markup.includes('together-star')&&markup.includes('detail-nights-deeplink'),'star and deep-link night list coexist');
    check(!markup.includes('Apri la serata')&&!markup.includes('Visti insieme ·'),'duplicate completed access removed');
    check(modules.css.includes('.target-film-detail .detail-nights-deeplink:not([open]) { display:none; }'),'completed list only appears for explicit night selection');
    check(Shell.presentation().togetherPopupHtml(Shell.presentation().getMovie(data.M)).includes('Le nostre visioni'),'completed access retained in popup');
  },{raw:data.cancelledCompleted});
  await test('UX12 outline identity records only caller Seen',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.viewingStatusHtml(movie);
    check(markup.includes('class="person-token person-token-n is-outline"')&&markup.includes('Apri il tuo Visto e giudizio'),'outline personal context control');
    const other=copy(h.controls.wire.personal.find(p=>p.person_id===data.V).states[0]);
    await clickProduct(context,context.personalStatusHtml(movie),'Segna come visto');await h.pump();
    eq(h.commands.length,1,'one command');eq(h.commands[0].body.intent,'RETROSPECTIVE_SEEN','personal seen intent');
    eq(h.controls.wire.personal[0].states[0].judgment.rating,null,'Seen does not create a rating');
    eq(h.controls.wire.personal[0].states[0].judgment.preference,null,'Seen does not create a preference');
    eq(h.controls.wire.nights.length,0,'no night');eq(h.controls.wire.group.judgments.length,0,'no Together judgment');
    deep(h.controls.wire.personal.find(p=>p.person_id===data.V).states[0],other,'other member unchanged');
    check(Shell.presentation().viewingStatusHtml(Shell.presentation().getMovie(data.M)).includes('person-token-n is-seen'),'accepted state fills own token');
  },{raw:data.absent});
  await test('UX12 judgment from the personal context does not record Seen',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M);
    await clickProduct(context,context.personalStatusHtml(movie),'Valuta il film');
    eq(modalStackTop(),'reviewModal','existing evaluation editor');closeModal('reviewModal');
    await Shell.perform('setMyEvaluation',data.M,{rating:9});await h.pump();
    eq(h.commands[0].body.intent,'SET_PERSONAL_EVALUATION','evaluation only');
    eq(h.controls.wire.personal[0].states[0].seen,false,'personal Seen remains absent');
  },{raw:data.absent});
  await test('UX12 completed Together keeps three independent token targets',async h=>{
    await h.boot();const context=Shell.presentation(),markup=context.viewingStatusHtml(context.getMovie(data.M));
    const own=markup.match(/<button[^>]*data-product-action="([^"]+)"[^>]*class="person-token person-token-n/);
    const group=markup.match(/<button[^>]*data-product-action="([^"]+)"[^>]*class="together-star/);
    const other=markup.match(/<button[^>]*data-product-action="([^"]+)"[^>]*class="person-token person-token-v/);
    check(!!own&&!!group&&!!other&&new Set([own[1],group[1],other[1]]).size===3,'N, group, V are separate buttons');
    const node=id=>({dataset:{productAction:id},closest:()=>null,focus(){},setAttribute(){},removeAttribute(){}});
    const n=node(own[1]),g=node(group[1]),v=node(other[1]);context.bind({querySelectorAll:selector=>selector==='[data-product-action]'?[n,g,v]:[]});
    n.onclick({stopPropagation(){}});eq(modalStackTop(),'personalStatusModal','N opens own context');closeModal('personalStatusModal');
    g.onclick({stopPropagation(){}});eq(modalStackTop(),'togetherModal','group opens Together');closeModal('togetherModal');
    v.onclick({stopPropagation(){}});eq(modalStackTop(),'otherJudgmentModal','V judgment is read only');closeModal('otherJudgmentModal');
    eq(h.commands.length,0,'opening targets does not write');
  },{raw:(()=>{const wire=copy(data.cancelledCompleted);wire.personal[1].states[0].judgment.rating=8.5;return finish(wire);})()});
  await test('UX12 filled identity removal requires confirmation and preserves judgment',async h=>{
    await h.boot();const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.personalStatusHtml(movie);
    check(markup.includes('Rimuovi dai miei Visti')&&context.viewingStatusHtml(movie).includes('Apri il tuo Visto e giudizio'),'removal only in own context');
    const original=showConfirmModal;
    try{
      showConfirmModal=()=>Promise.resolve(false);await clickProduct(context,markup,'Rimuovi dai miei Visti');eq(h.commands.length,0,'cancel is read only');
      showConfirmModal=()=>Promise.resolve(true);await clickProduct(context,markup,'Rimuovi dai miei Visti');await h.pump();
      eq(h.commands.length,1,'confirmed once');eq(h.commands[0].body.intent,'REMOVE_PERSONAL_SEEN','only Seen relation removed');
      eq(h.controls.wire.personal[0].states[0].judgment.rating,8.6,'judgment preserved');
      check(!context.detailActions(movie).includes('Rimuovi dai miei Visti'),'no parallel detail seen action');
    }finally{showConfirmModal=original;}
  },{raw:(()=>{const wire=copy(data.absent);wire.personal[0].states[0].seen=true;wire.personal[0].states[0].judgment.rating=8.6;return finish(wire);})()});
  await test('UX12 human intent copy and TARGET commands stay distinct',async h=>{
    await h.boot();Shell.navigate('personalSeen');const context=Shell.presentation(),movie=context.getMovie(data.M),card=context.cardOperationsHtml(movie);
    check(card.includes('Voglio rivederlo')&&card.includes('Vorrei vederlo insieme'),'seen leads to rewatch intent and separate shared proposal');
    await clickProduct(context,card,'Voglio rivederlo');await h.pump();eq(h.commands[0].body.intent,'ADD_PERSONAL_LIST','personal intention only');
    await clickProduct(context,card,'Vorrei vederlo insieme');await h.pump();eq(h.commands[1].body.intent,'PROPOSE_TO_GROUP','shared intention only');
    Shell.navigate('groupList');const choices=Shell.presentation().cardOperationsHtml(Shell.presentation().getMovie(data.M));
    check(choices.includes('Guardiamolo')&&choices.includes('Pianifica'),'choice and scheduling remain distinct');
  },{raw:(()=>{const wire=copy(data.absent);wire.personal[0].states[0].seen=true;return finish(wire);})()});
  await test('UX12 missing ratings slot and detail hierarchy',async h=>{
    await h.boot();Shell.navigate('personalSeen');const context=Shell.presentation(),movie=context.getMovie(data.M);
    const card=createMovieCard(movie,[],context).innerHTML;
    check(card.includes('IMDb n.d.')&&card.includes('RT n.d.')&&card.includes('MC n.d.')&&card.indexOf('IMDb n.d.')<card.indexOf('personal-tokens'),'provider slots before status');
    Shell.detail(data.M);const detail=document.getElementById('detailBody').innerHTML;
    check(detail.includes('IMDb n.d.')&&detail.includes('RT n.d.')&&detail.includes('MC n.d.')&&detail.includes('Per me')&&detail.includes('Per noi')&&detail.includes('Altre azioni'),'same ratings slot and human sections');
    check(!detail.includes('Aggiungi ai miei Visti')&&!detail.includes('Rimuovi dai miei Visti'),'Seen actions only in token');
    check(modules.css.includes('.is-target-card .external-ratings,.target-film-detail .external-ratings { min-height:16px; }'),'ratings slot has consistent height');
  },{raw:data.absent});
  await test('UX12 visual token dimensions share one geometry',async h=>{
    await h.boot();const css=modules.css;
    check(css.includes('height:44px; min-height:44px; max-height:44px; width:96px; min-width:96px; max-width:96px')&&!css.includes('.person-token.has-rating .person-token-face'),'same fixed outer size regardless of judgment');
    check(css.includes('.person-token-face { display:inline-flex;')&&css.includes('width:92px; height:28px; min-height:28px; padding:2px 6px; border:1px solid currentColor; border-radius:999px'),'shared height padding and radius');
    check(!css.includes('.person-token-identity')&&!css.includes('.person-token-judgment'),'no reserved internal hit zones');
    const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.viewingStatusHtml(movie);
    check(markup.includes('person-token-n')&&markup.includes('person-token-v')&&!markup.includes('together-cluster'),'personal tokens rendered without changing Together rule');
  },{raw:data.absent});
  await test('UX12 visual ratings keep three provider positions',async h=>{
    await h.boot();Shell.navigate('personalList');const context=Shell.presentation(),movie=context.getMovie(data.M);
    const markup=createMovieCard(movie,[],context).innerHTML;
    check(markup.includes('IMDb 7.7')&&markup.includes('RT n.d.')&&markup.includes('MC n.d.'),'partial ratings retain missing providers');
    eq((markup.match(/external-ratings/g)||[]).length,1,'single ratings strip');
    check(!markup.includes('Valutazioni non disponibili'),'no separate empty sentence');
  },{raw:(()=>{const wire=copy(data.selfList);Object.assign(wire.catalog[0],{imdb_rating:'7.7',rt_rating:null,metacritic_rating:null});return finish(wire);})()});
  await test('UX12 visual Movie Detail is group first with candidate actions',async h=>{
    await h.boot();Shell.detail(data.M);const detail=document.getElementById('detailBody').innerHTML;
    check(detail.indexOf('Per noi')<detail.indexOf('Per me')&&detail.indexOf('Per me')<detail.indexOf('Altre azioni'),'group then personal then technical');
    check(detail.includes('Guardiamolo')&&detail.includes('Pianifica')&&detail.includes('Togli dai Da vedere insieme'),'candidate action hierarchy');
    check(!detail.includes('<p>Da vedere insieme</p>'),'no redundant candidate status');
    check(modules.css.includes('.intent-action.is-shared')&&modules.css.includes('.detail-intent-personal .intent-action'),'distinct action weights');
  },{raw:data.detailCases.find(x=>x[0]==='shared')[1]});
  await test('UX12 Seen primary row remains separate from Saga footer',async h=>{
    await h.boot();Shell.navigate('personalSeen');const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.cardOperationsHtml(movie);
    check(markup.includes('movie-list-actions movie-seen-actions')&&markup.includes('movie-list-secondary-strip movie-seen-secondary')&&markup.includes('saga-entry-compact')&&markup.includes('is-shared')&&markup.includes('is-personal'),'two primary actions above Saga footer');
    eq((markup.match(/movie-seen-primary/g)||[]).length,2,'both Seen buttons use the same row geometry');
    check(markup.indexOf('Vorrei vederlo insieme')<markup.indexOf('Voglio rivederlo')&&markup.indexOf('Voglio rivederlo')<markup.indexOf('movie-seen-secondary'),'group then personal above Saga footer');
    check(modules.css.includes('.is-target-card .movie-list-actions > button { min-height:52px;')&&modules.css.includes('.is-target-card .movie-seen-secondary,.is-target-card .movie-rewatch-secondary { min-height:44px; }'),'shared action geometry and stable footer');
  },{raw:(()=>{const wire=copy(data.absent);wire.personal[0].states[0].seen=true;wire.catalog[0].collection_id='123';wire.catalog[0].collection_name='Saga';return finish(wire);})()});
  await test('UX12 visual Seen footer without Saga keeps the same slot',async h=>{
    await h.boot();Shell.navigate('personalSeen');const context=Shell.presentation(),markup=context.cardOperationsHtml(context.getMovie(data.M));
    check(markup.includes('movie-list-actions movie-seen-actions')&&markup.includes('movie-list-secondary-strip movie-seen-secondary')&&!markup.includes('saga-entry-compact'),'same footer with Saga absent');
    check(markup.includes('Voglio rivederlo')&&markup.includes('Vorrei vederlo insieme'),'both quick actions remain');
    check(modules.css.includes('.is-target-card .movie-seen-secondary:empty { display:flex; }'),'footer slot remains when empty');
  },{raw:(()=>{const wire=copy(data.absent);wire.personal[0].states[0].seen=true;return finish(wire);})()});
  await test('UX12 Seen unseen caller uses the same two-column action slot',async h=>{
    await h.boot();h.host.setObservedPerson(data.V);await h.pump();Shell.navigate('personalSeen');
    const context=Shell.presentation(),markup=context.cardOperationsHtml(context.getMovie(data.M));
    check(markup.includes('movie-list-actions movie-seen-actions')&&markup.includes('Voglio vederlo'),'same action row for first viewing intent');
    check(markup.indexOf('Vorrei vederlo insieme')<markup.indexOf('Voglio vederlo'),'group-first even when viewing other member');
    check(markup.includes('movie-list-secondary-strip movie-seen-secondary')&&!markup.includes('saga-entry-compact'),'footer remains below the row');
    check(modules.css.includes('.is-target-card .movie-list-actions > button { min-height:52px; padding:7px 8px; gap:6px; border-radius:var(--radius-lg); font-size:13px; }'),'shared geometry independent of Saga');
  },{raw:data.seenOther});
  await test('UX12 poster fades into the card without affecting media controls',async h=>{
    await h.boot();Shell.navigate('groupList');const context=Shell.presentation(),markup=createMovieCard(context.getMovie(data.M),[],context).innerHTML,css=modules.css;
    check(css.includes('.is-target-card .card-poster { overflow:visible; background:transparent; }')&&css.includes('.is-target-card .card-poster img,')&&css.includes('.is-target-card .card-poster > .absolute.inset-0'),'image and backdrop fade into the shared card surface');
    check(css.includes('-webkit-mask-image:linear-gradient')&&css.includes('mask-image:linear-gradient')&&css.includes('.is-target-card .ticket-seam { border-top:0; }'),'controlled cross-browser fade without dashed seam');
    check(markup.includes('card-poster')&&markup.includes('Trailer')&&markup.includes('fa-tv'),'poster crop, trailer and metadata markup retained');
  },{raw:(()=>{const wire=copy(data.raw);wire.catalog[0].trailer_url='https://example.test/trailer';return finish(wire);})()});
  for(const [name,saga,open] of [['Saga and proposal',true,false],['proposal only',false,false],['Saga only',true,true],['neither',false,true]])
    await test('UX12 Rewatch footer '+name,async h=>{
      await h.boot();Shell.navigate('rewatch');const context=Shell.presentation(),markup=context.cardOperationsHtml(context.getMovie(data.M));
      if(open)check(markup.includes('Apri In programma')&&!markup.includes('Guardiamolo'),'open event keeps its existing state action');
      else check(markup.includes('movie-list-actions')&&markup.includes('Guardiamolo')&&markup.includes('Pianifica'),'choice pair remains primary');
      check(markup.includes('movie-list-secondary-strip movie-rewatch-secondary'),'stable footer slot');
      eq(markup.includes('saga-entry-compact'),saga,'Saga availability');
      eq(markup.includes('Vorrei vederlo insieme'),!open,'proposal only without an open event');
      if(saga&&!open)check(markup.indexOf('Saga')<markup.indexOf('Vorrei vederlo insieme'),'Saga left proposal right');
      check(markup.indexOf(open?'movie-list-state':'movie-list-actions')<markup.indexOf('movie-rewatch-secondary'),'primary area before footer');
      check(modules.css.includes('.is-target-card .movie-rewatch-secondary:empty { display:flex; }')&&modules.css.includes('#movieGrid:has(> .is-target-card) { grid-auto-rows:1fr; align-items:stretch; }'),'empty footer and desktop baseline');
    },{raw:(()=>{const wire=copy(data.rewatch);wire.catalog[0].collection_id=saga?'555':null;wire.catalog[0].collection_name=saga?'Saga':null;
      if(open){const night=copy(data.agenda.nights[0]);wire.nights.push(night);wire.versions.entries.push(copy(data.agenda.versions.entries.find(row=>row.scope_kind==='night'&&row.entity_id===night.night_id)));}
      return finish(wire);})()});
  await test('UX12 My Seen candidate keeps personal actions separate from Rewatch choice',async h=>{
    await h.boot();Shell.navigate('personalSeen');const context=Shell.presentation(),markup=context.cardOperationsHtml(context.getMovie(data.M));
    check(markup.includes('movie-list-actions movie-seen-actions')&&!markup.includes('Guardiamolo')&&!markup.includes('Pianifica'),'Seen card does not reuse Rewatch choice');
    check(!markup.includes('Vorrei vederlo insieme'),'no duplicate proposal when candidate');
    check(markup.includes('movie-list-secondary-strip movie-seen-secondary'),'secondary footer retained');
  },{raw:(()=>{const wire=copy(data.absent);wire.personal[0].states[0].seen=true;Object.assign(wire.group.states[0],{effective_candidacy:true,list_visible:true});return finish(wire);})()});
  await test('UX12 personal interest alone does not present a shared choice in detail',async h=>{
    await h.boot();Shell.detail(data.M);const context=Shell.presentation(),movie=context.getMovie(data.M),markup=context.detailActions(movie);
    check(markup.includes('Vorrei vederlo insieme')&&!markup.includes('Guardiamolo')&&!markup.includes('Pianifica'),'proposal represents first shared step');
    check(markup.includes('Nei tuoi Da vedere'),'personal intention retained');
  },{raw:data.selfList});
  await test('UX12 Detail story and cast precede decisions',async h=>{
    await h.boot();Shell.detail(data.M);const markup=document.getElementById('detailBody').innerHTML;
    const order=['detail-head','data-detail-story','data-detail-cast','Per noi','Per me','Altre azioni'];
    for(let i=1;i<order.length;i++)check(markup.indexOf(order[i-1])<markup.indexOf(order[i]),order[i-1]+' before '+order[i]);
    check(markup.includes('data-story-toggle')&&markup.includes('detail-story-copy is-clamped')&&markup.includes('hidden>Leggi tutto'),'story toggle waits for layout measurement');
    check(markup.includes('Vedi tutto il cast')&&markup.includes('detailCastList'),'long cast has its own expander');
    check(!markup.includes('La storia e il cast'),'old combined accordion removed');
    check(modules.css.includes('-webkit-line-clamp:4')&&modules.css.includes('li:nth-child(n+7)'),'four story lines and first six cast names');
  },{raw:(()=>{const wire=copy(data.absent);wire.catalog[0].overview='Una storia di cinema e di persone. '.repeat(14);wire.catalog[0].cast_names=['Uno','Due','Tre','Quattro','Cinque','Sei','Sette','Otto'];return finish(wire);})()});
  await test('UX12 Detail short story and cast need no expanders',async h=>{
    await h.boot();Shell.detail(data.M);const markup=document.getElementById('detailBody').innerHTML;
    check(markup.includes('data-detail-story')&&markup.includes('data-detail-cast'),'both content sections shown');
    check(markup.includes('hidden>Leggi tutto')&&!markup.includes('Vedi tutto il cast'),'short story control starts hidden');
    check(markup.indexOf('data-detail-story')<markup.indexOf('data-detail-cast')&&markup.indexOf('data-detail-cast')<markup.indexOf('Per noi'),'editorial content first');
    check(!markup.includes('Cosa facciamo'),'redundant heading absent');
  },{raw:(()=>{const wire=copy(data.absent);wire.catalog[0].overview='Una storia breve.';wire.catalog[0].cast_names=['Uno','Due'];return finish(wire);})()});
  await test('UX12 story toggle follows measured clipping at different widths',async h=>{
    await h.boot();const modal=document.getElementById('detailModal'),original=modal.querySelector;
    const flags=new Set(),copy={clientHeight:96,scrollHeight:96};
    const button={hidden:true,textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;}};
    const section={classList:{contains:k=>flags.has(k),add:k=>flags.add(k),remove:k=>flags.delete(k)},querySelector:s=>s==='.detail-story-copy'?copy:button};
    modal.classList.remove('hidden');modal.querySelector=s=>s==='[data-detail-story]'?section:null;
    try{
      syncDetailStoryOverflow();check(button.hidden,'fully visible story has no link');
      copy.scrollHeight=144;syncDetailStoryOverflow();check(!button.hidden&&button.textContent==='Leggi tutto','narrow layout exposes real truncation');
      flags.add('is-expanded');syncDetailStoryOverflow();check(!button.hidden&&button.textContent==='Mostra meno'&&button.attributes['aria-expanded']==='true','expanded state persists when clipped');
      copy.scrollHeight=96;syncDetailStoryOverflow();check(button.hidden&&!flags.has('is-expanded'),'wide layout hides ineffective link');
    }finally{modal.querySelector=original;modal.classList.add('hidden');}
  },{raw:data.absent});
  await test('UX12 Detail story and cast expand and survive same-film render',async h=>{
    await h.boot();const body=document.getElementById('detailBody'),original=body.querySelector;
    const section=()=>{const marks=new Set(),button={textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;}};
      return {button,classList:{contains:key=>marks.has(key),add:key=>marks.add(key),toggle(key){if(marks.has(key)){marks.delete(key);return false;}marks.add(key);return true;}},querySelector:()=>button};};
    const story=section(),cast=section();
    body.querySelector=selector=>selector==='[data-detail-story]'?story:selector==='[data-detail-cast]'?cast:null;
    try{
      Shell.detail(data.M);eq(story.button.textContent,'Leggi tutto','story starts collapsed');eq(cast.button.textContent,'Vedi tutto il cast','cast starts compact');
      story.button.onclick();cast.button.onclick();check(story.classList.contains('is-expanded')&&cast.classList.contains('is-expanded'),'both sections expand');
      eq(story.button.attributes['aria-expanded'],'true','story accessibility state');eq(cast.button.attributes['aria-expanded'],'true','cast accessibility state');
      const context=Shell.presentation();renderMovieDetail(context.getMovie(data.M),context);
      eq(story.button.textContent,'Mostra meno','story expansion retained');eq(cast.button.textContent,'Mostra meno','cast expansion retained');
    }finally{body.querySelector=original;}
  },{raw:(()=>{const wire=copy(data.absent);wire.catalog[0].overview='Una storia di cinema e di persone. '.repeat(14);wire.catalog[0].cast_names=['Uno','Due','Tre','Quattro','Cinque','Sei','Sette'];return finish(wire);})()});
  await test('UX12 Detail delete is the fourth management button and requires confirmation',async h=>{
    await h.boot();const context=Shell.presentation(),markup=context.detailActions(context.getMovie(data.M));
    const grid=markup.split('<div class="detail-menu-controls"')[1].split('</div>')[0];
    const names=['Continua la saga','Sposta al cinema','Aggiorna informazioni da TMDb','Rimuovi film'];
    for(let i=1;i<names.length;i++)check(grid.indexOf(names[i-1])<grid.indexOf(names[i]),'management button '+i+' before '+(i+1));
    check(!markup.includes('detail-danger-area')&&grid.includes('data-feedback-zone="danger"'),'danger remains in same grid');
    const original=showConfirmModal;
    try{showConfirmModal=()=>Promise.resolve(false);await clickProduct(context,markup,'Rimuovi film');eq(h.commands.length,0,'cancel is read only');
      showConfirmModal=()=>Promise.resolve(true);await clickProduct(context,markup,'Rimuovi film');await h.pump();eq(h.commands[0].body.intent,'CONTENT_DELETE','confirmed delete uses existing command');
    }finally{showConfirmModal=original;}
  },{raw:(()=>{const wire=copy(data.absent);Object.assign(wire.catalog[0],{collection_id:'123',collection_name:'Saga',tmdb_id:'777'});return finish(wire);})()});
  await test('UX12 visual Together card has subtle gold identity only',async h=>{
    await h.boot();Shell.navigate('together');const context=Shell.presentation(),markup=createMovieCard(context.getMovie(data.M),[],context).innerHTML;
    check(markup.includes('together-cluster')&&markup.includes('together-star')&&!markup.includes('1 serata'),'single Together entry point');
    check(markup.includes('movie-together-label')&&markup.includes('INSIEME')&&modules.css.includes('.is-target-card .movie-together-label'),'micro gold label lives in secondary footer');
    check(!modules.css.includes('.is-target-card.collection-together .card-poster::before'),'poster label removed');
    check(!markup.includes('Snack')&&!markup.includes('Apri serata'),'no duplicated night data');
  },{raw:data.cancelledCompleted});
  await test('UX12 Together label and Rewatch proposal share secondary footer grammar',async h=>{
    await h.boot();let context=Shell.presentation();Shell.navigate('together');context=Shell.presentation();
    const togetherCard=createMovieCard(context.getMovie(data.M),[],context).innerHTML;
    check(togetherCard.includes('movie-list-secondary-strip movie-together-secondary')&&togetherCard.includes('movie-together-label'),'Together label in footer');
    check(!togetherCard.includes('card-poster::before'),'no second poster label');
    Shell.navigate('rewatch');context=Shell.presentation();
    const rewatch=context.cardOperationsHtml(context.getMovie(data.M));
    check(rewatch.includes('movie-rewatch-propose')&&rewatch.includes('fa-users')&&!rewatch.includes('intent-action is-shared'),'proposal is text footer action');
    check(rewatch.indexOf('movie-list-actions')<rewatch.indexOf('movie-rewatch-secondary'),'primary row precedes footer');
    check(modules.css.includes('.movie-rewatch-propose:focus-visible')&&modules.css.includes('min-height:44px'),'touch and focus treatment');
  },{raw:(()=>{const wire=copy(data.cancelledCompleted);wire.personal[0].states[0].seen=true;wire.personal[1].states[0].seen=true;wire.group.states[0].rewatch_visible=true;wire.group.states[0].rewatch_semantic=true;return finish(wire);})()});
  await test('UX12 detail ambient layers cover the content-sized surface',async h=>{
    await h.boot();const source=modules.indexSource,css=modules.css;
    const start=source.indexOf('<div id="detailPanel"'),surface=source.indexOf('<div class="detail-surface">',start),ambient=source.indexOf('id="detailAmbient"',surface),overlay=source.indexOf('id="detailOverlay"',ambient),body=source.indexOf('id="detailBody"',overlay);
    check(start>=0&&surface>start&&ambient>surface&&overlay>ambient&&body>overlay,'ambient and overlay share the content wrapper');
    check(css.includes('.detail-surface { position:relative; min-height:100%; padding-bottom:env(safe-area-inset-bottom); isolation:isolate; }'),'layers cover scroll content and the safe area');
    check(css.includes('.ambient-bg {')&&css.includes('background-size: cover;')&&css.includes('filter: blur(18px)'),'existing poster treatment retained');
  },{raw:data.absent});
  await test('UX12 final detail intent buttons share geometry and separate emphasis',async h=>{
    await h.boot();const context=Shell.presentation(),markup=context.detailActions(context.getMovie(data.M));
    check(markup.indexOf('Per noi')<markup.indexOf('Per me'),'group first');
    check(markup.includes('fa-users')&&markup.includes('fa-user'),'group and personal intent icons');
    check(markup.includes('intent-action is-shared detail-intent-action')&&markup.includes('intent-action is-personal detail-intent-action'),'one button family');
    check(modules.css.includes('.intent-action { display:inline-flex;')&&modules.css.includes('.intent-action.is-shared')&&modules.css.includes('.detail-intent-personal .intent-action'),'same dimensions, different emphasis');
  },{raw:(()=>{const wire=copy(data.absent);wire.personal[0].states[0].seen=true;return finish(wire);})()});
  await test('UX12 final detail Saga and technical actions share a grid',async h=>{
    await h.boot();const context=Shell.presentation(),markup=context.detailActions(context.getMovie(data.M));
    check(markup.includes('detail-film-action saga-entry-detail')&&markup.includes('Continua la saga')&&!markup.includes('Continua la saga ·'),'compact Saga caption');
    check(markup.includes('Sposta al cinema')&&markup.includes('Aggiorna informazioni da TMDb'),'existing technical actions');
    check(modules.css.includes('.detail-menu-controls { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));')&&modules.css.includes('.detail-menu-controls > button { display:inline-flex;'),'shared button geometry');
    check(modules.css.includes('@media(max-width:480px){ .detail-menu-controls { grid-template-columns:minmax(0,1fr); } }'),'mobile single column');
  },{raw:(()=>{const wire=copy(data.absent);Object.assign(wire.catalog[0],{collection_id:'123',collection_name:'Dune – Collezione',tmdb_id:'777'});return finish(wire);})()});
  await test('UX12 final Together compact zone and desktop baseline rules',async h=>{
    await h.boot();const css=modules.css;
    check(css.includes('.is-target-card.collection-together .card-actions { min-height:44px; }'),'Together reserves only one footer row');
    check(css.includes('#movieGrid:has(> .is-target-card) { grid-auto-rows:1fr; align-items:stretch; }'),'desktop cards share track height');
    check(css.includes('.is-target-card .card-actions { display:flex; flex-direction:column; justify-content:flex-end; min-height:108px; margin-top:auto; }'),'actions anchor to bottom');
    check(css.includes('.is-target-card.collection-together .card-actions { min-height:0; }'),'mobile Together height natural');
  },{raw:data.cancelledCompleted});
  await test('UX12 visual wheel result uses card grammar without changing commands',async h=>{
    await h.boot();const source=modules.wheelSource;
    check(source.includes('fa-ticket')&&source.includes('fa-calendar-days')&&source.includes('Guardiamolo</button>')&&source.includes('Pianifica</button>'),'wheel result copy and icons');
    check(source.includes("TargetShell.edit('quickNight'")&&source.includes("TargetShell.edit('scheduleNight'"),'existing TARGET commands');
    check(source.includes('function wheelPool()')&&source.includes('function spinWheel()'),'wheel pool and spin remain');
  },{raw:data.absent});
  for(const [name,patch] of [['rating',{rating:8.6}],['preference',{preference:true}],['review',{review:'Una recensione personale'}]])
    await test('UX12 feedback personal '+name+' auto dismisses',async h=>{
      await h.boot();modules.clearTimers();
      document.getElementById('targetFeedback').querySelector=()=>null;
      await Shell.perform('setMyEvaluation',data.M,patch);await h.pump();
      const message=document.getElementById('targetFeedbackMessage');
      eq(message.textContent,'Giudizio personale aggiornato.','success appears once');
      modules.advanceTime(2500);eq(message.textContent,'Giudizio personale aggiornato.','readable before timeout');
      modules.advanceTime(100);eq(message.textContent,'','success auto dismisses at 2.6 seconds');
      check(document.getElementById('targetFeedback').hidden,'fixed toast hidden');
    });
  await test('UX12 feedback second judgment replaces first timer and message',async h=>{
    await h.boot();modules.clearTimers();
    await Shell.perform('setMyEvaluation',data.M,{rating:8});await h.pump();
    modules.advanceTime(1000);
    await Shell.perform('setMyEvaluation',data.M,{rating:9});await h.pump();
    const message=document.getElementById('targetFeedbackMessage');
    eq(message.textContent,'Giudizio personale aggiornato.','one current toast');
    modules.advanceTime(1600);eq(message.textContent,'Giudizio personale aggiornato.','old timer cannot dismiss new toast');
    modules.advanceTime(1000);eq(message.textContent,'','latest timer dismisses');
  });
  await test('UX12 feedback navigation and modal changes clear success',async h=>{
    await h.boot();modules.clearTimers();
    const message=document.getElementById('targetFeedbackMessage');
    await Shell.perform('setMyEvaluation',data.M,{rating:8});Shell.navigate('personalList');eq(message.textContent,'','collection change clears toast');
    await Shell.perform('setMyEvaluation',data.M,{rating:9});Shell.detail(data.M);eq(message.textContent,'','opening film detail clears toast');
    await Shell.perform('setMyEvaluation',data.M,{rating:7});eq(document.getElementById('detailFeedback').textContent,'','detail does not duplicate global toast');closeModal('detailModal');eq(message.textContent,'','closing modal clears toast');
    await Shell.perform('setMyEvaluation',data.M,{rating:6});openModal('reviewModal');eq(message.textContent,'','opening modal clears toast');closeModal('reviewModal');
  });
  await test('UX12 feedback editor auto close preserves short success toast',async h=>{
    await h.boot();modules.clearTimers();Shell.edit('setMyEvaluation',data.M);
    document.getElementById('reviewRating').value='8,6';
    await document.getElementById('reviewSaveButton').onclick();await h.pump();
    check(document.getElementById('reviewModal').classList.contains('hidden'),'editor closes after save');
    eq(document.getElementById('targetFeedbackMessage').textContent,'Giudizio personale aggiornato.','toast survives automatic editor close');
    modules.advanceTime(2600);eq(document.getElementById('targetFeedbackMessage').textContent,'','editor toast expires');
  });
  await test('UX12 feedback resync cannot resurrect dismissed success',async h=>{
    await h.boot();modules.clearTimers();await Shell.perform('setMyEvaluation',data.M,{rating:8});await h.pump();
    await h.refresh();check(document.getElementById('targetFeedbackMessage').textContent.includes('Giudizio personale'),'resync keeps active toast until timeout');
    modules.advanceTime(2600);Shell.render();eq(document.getElementById('targetFeedbackMessage').textContent,'','rerender does not restore old feedback');
    check(!html().includes('Giudizio personale aggiornato.'),'card grid has no persistent feedback');
  });
  await test('UX12 feedback error stays readable beyond success timeout',async h=>{
    await h.boot();modules.clearTimers();h.controls.commandOutcome='STALE';
    await Shell.perform('setMyEvaluation',data.M,{rating:8});await h.pump();
    const message=document.getElementById('targetFeedbackMessage');
    check(message.textContent.includes('I dati sono cambiati'),'error visible');
    modules.advanceTime(10000);check(message.textContent.includes('I dati sono cambiati'),'error not auto dismissed');
  });
  return {cases,assertions};
}
module.exports={fixtureData,runChecks};
if(require.main===module){
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
 const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
 const graph=[...read('index.html').matchAll(/<script src="(js\/[^\"]+)"/g)].map(m=>m[1]);
 const smoke=read('scripts/smoke.js');let dom=smoke.slice(smoke.indexOf('function makeEl('),smoke.indexOf('const localStore ='));
 dom=dom.replace("get innerHTML() { return this._innerHTML + this._children.map(c => (c._innerHTML || '')).join(''); }", "get innerHTML() { return this._innerHTML + this._text + this._children.map(c => c.innerHTML).join(''); }");
 dom=dom.replace('id, _value:', "get parentElement() { return makeEl('parent'); }, add(c) { this._children.push(c); }, get options() { return this._children; }, before() {}, removeAttribute(k) { delete this[k]; }, id, _value:");
 dom=dom.replace('appendChild(c) {', 'replaceChildren(...items) { this._children=[];this._innerHTML="";for(const item of items)this.appendChild(item); }, appendChild(c) {');
 dom=dom.replace('appendChild(c) {', 'insertAdjacentHTML(position, html) { this._innerHTML += html; }, appendChild(c) {');
 const pendingTimers=new Map();let timerSerial=0,virtualTime=0;
 const advanceTime=ms=>{virtualTime+=ms;for(const [id,job] of [...pendingTimers])if(job.at<=virtualTime){pendingTimers.delete(id);job.fn();}};
 const clearTimers=()=>{pendingTimers.clear();virtualTime=0;};
 const context=vm.createContext({console,URL,URLSearchParams,AbortController,crypto:require('node:crypto').webcrypto,
   setTimeout:(fn,ms=0)=>{const id=++timerSerial;pendingTimers.set(id,{fn,at:virtualTime+Number(ms)});return id;},
   clearTimeout:id=>pendingTimers.delete(id),setInterval:()=>1,clearInterval(){}});
 vm.runInContext(dom+`const localStorage={getItem:()=>null,setItem(){},removeItem(){}};const sessionStorage=localStorage;const document=documentStub;const Option=function(text,value){const el=makeEl('option');el.textContent=text;el.value=value;return el;};const window={addEventListener(){},scrollTo(){}};const location={search:'',hash:'',href:'https://fixture.invalid/',reload(){}};const navigator={};const performance={now:()=>0};`,context);
 for(const f of graph)vm.runInContext(f==='js/config.js'?`const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'',OMDB_API_KEY:'',PEOPLE:{N:{label:'Nicholas',badgeClass:''},V:{label:'Valeria',badgeClass:''}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};`:read(f),context,{filename:f});
 const code=`(${runChecks.toString()})({Core:SnapshotCore,Cache:SnapshotCache,Engine:RecommendationEngine,Shell:TargetShell,originalSession:ProductionSession,createCoordinator:ProductionSession.createCoordinator,productionDependencies:ProductionSession.productionDependencies,install: app=>{ProductionSession=app;TargetShell.dispose();},advanceTime,clearTimers,css:${JSON.stringify(read('css/style.css'))},indexSource:${JSON.stringify(read('index.html'))},wheelSource:${JSON.stringify(read('js/wheel.js'))},modalsSource:${JSON.stringify(read('js/ui/modals.js'))},html:()=>document.getElementById('movieGrid').innerHTML},${JSON.stringify(fixtureData())},name=>console.log('PASS '+name),name=>name.includes(${JSON.stringify(process.argv[2]||'')}))`;
 context.advanceTime=advanceTime;context.clearTimers=clearTimers;
 vm.runInContext(code,context).then(r=>console.log('PRODUCTION SHELL VM '+JSON.stringify(r)+' PASS')).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
