#!/usr/bin/env node
'use strict';
// The host and every child module are real. Fakes are restricted to verified
// identity, RPC/server state, storage, time and injected lifecycle boundaries.
function fixtureData() {
  const F = require('./fixtures/snapshot-v1.cjs');
  const raw = require('./verify-target-match-adapter.cjs').fixtureData().raw;
  const absent = F.relationless();
  const unavailable = JSON.parse(JSON.stringify(raw)); unavailable.people[1].personal_readable = false; unavailable.personal.pop(); F.finish(unavailable);
  return { raw, absent, unavailable, rewatch: F.rewatch(), multiple: F.multipleEvents(), N: F.N, V: F.V, G: F.G, M: F.M, Q: F.Q, R: F.uid(3), NIGHT: F.NIGHT, observer: F.uid(998000), other: F.uid(998001), at: F.AT };
}
async function runChecks(modules, data, onCase = () => {}) {
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
    const controls = { wire: copy(options.raw ?? data.raw), caller: options.caller ?? data.N, group: data.G, holdSnapshot: !!options.cached, holdCommand: false, commandOutcome: null, uncertain: false, snapshotError: null, matchUncertain: null, matchBefore: null, matchHold: false, matchCloseOutcome: null, satisfyOnComplete: false };
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
      readLatestMatchState: async () => { const value = { category: 'MATCH_STATE', session: copy(matchServer.session), swipes: copy(matchServer.swipes) }; matchReads.push(value); return value; },
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
  async function test(name, fn, options) { const h = await make(options); try { await fn(h); cases++; onCase(name); } finally { await h.shutdown(); } }
  const html = () => modules.html();
  await test('initial accepted Snapshot renders real shell',async h=>{await h.boot();eq(h.state.phase,'READY','ready');check(!html().includes('Lista personale'),'no duplicate navigation in grid');Shell.navigate('groupList');check(html().includes(data.raw.catalog[0].title),'catalog rendered in library');});
  for(const destination of ['home','personalList','personalSeen','groupList','rewatch','scheduled','together','memories','calendar','recommendations','wheel']) await test('real shell '+destination,async h=>{await h.boot();Shell.navigate(destination);eq(Shell.getDestination(),destination,'selected route');eq(h.commands.length,0,'render not command');});
  for(const caller of [data.N,data.V])for(const observed of [data.N,data.V])await test('shell observed '+caller+'/'+observed,async h=>{await h.boot();h.host.setObservedPerson(observed);await h.pump();eq(h.state.view.context.observedPerson.personId,observed,'read identity');await Shell.perform('addToMyList',data.M);await h.pump();eq(h.commands[0].body.expected_versions[0].scope_id,caller,'caller authority');},{caller});
  await test('card/detail uses semantic view',async h=>{await h.boot();Shell.detail(data.M);check(document.getElementById('detailBody').innerHTML.includes('SCHEDA FILM'),'product detail modal');check(!('status' in h.state.view.getCard(data.M).content),'no status');});
  await test('personal uncovered renders unavailable',async h=>{await h.boot();h.host.setObservedPerson(data.V);Shell.navigate('personalList');check(html().includes('non disponibili'),'not false empty');},{raw:data.unavailable});
  await test('Rewatch selector reaches screen',async h=>{await h.boot();Shell.navigate('rewatch');check(h.state.view.group.rewatch.length>0,'selector');check(html().includes(h.state.view.group.rewatch[0].title),'render');},{raw:data.rewatch});
  await test('Ricordi preserves repeat events',async h=>{await h.boot();Shell.navigate('memories');check(h.state.view.events.completed.length>h.state.view.counts.togetherFilms,'events versus films');},{raw:data.multiple});
  for(const [method,args,intent]of [['addToMyList',[data.M],'ADD_PERSONAL_LIST'],['removeFromMyList',[data.M],'REMOVE_PERSONAL_LIST'],['recordSeen',[data.M],'RETROSPECTIVE_SEEN'],['removeSeen',[data.M],'REMOVE_PERSONAL_SEEN'],['setMyEvaluation',[data.M,{rating:0,review:''}],'SET_PERSONAL_EVALUATION'],['proposeToGroup',[data.M],'PROPOSE_TO_GROUP'],['withdrawGroupCandidacy',[data.M],'WITHDRAW_GROUP_CANDIDACY'],['scheduleNight',[data.M,{date:'2027-01-05'}],'SCHEDULE_NIGHT'],['quickNight',[data.M],'QUICK_NIGHT'],['completeNow',[data.M,{participants:[data.N]}],'COMPLETE_NOW']])await test('shell action '+intent,async h=>{await h.boot();eq((await Shell.perform(method,...args)).outcome,'SUCCESS','result');await h.pump();eq(h.commands[0].body.intent,intent,'actual action path');});
  await test('SUCCESS is feedback only before Snapshot',async h=>{await h.boot();const before=h.state.view;h.controls.holdSnapshot=true;await Shell.perform('recordSeen',data.M);await h.pump();eq(h.state.view.personal.caller.seen.length,0,'no optimistic seen');eq(before.personal.caller.seen.length,0,'historical');await h.reply();eq(h.state.view.personal.caller.seen.length,1,'accepted Snapshot');});
  for(const outcome of ['STALE','REQUEST_ID_REUSE'])await test('shell '+outcome+' does not retry',async h=>{await h.boot();h.controls.commandOutcome=outcome;eq((await Shell.perform('recordSeen',data.M)).outcome,outcome,'semantic result');await h.pump();eq(h.commands.length,1,'no retry');});
  await test('uncertain exact request retry',async h=>{await h.boot();h.controls.uncertain=true;const r=await Shell.perform('recordSeen',data.M);eq(r.outcome,'TRANSPORT_UNCERTAIN','uncertain');const before=copy(h.commands[0].body);await Shell.perform('retry',r.retryHandle);deep(h.commands.at(-1).body,before,'exact request');});
  await test('content creation and explicit relation separate',async h=>{await h.boot();const r=await Shell.saveContent({title:'Synthetic new'},'addToMyList');await h.pump();eq(r.content.outcome,'SUCCESS','create');eq(r.relation.outcome,'SUCCESS','relation');deep(h.commands.map(c=>c.body.intent),['CONTENT_CREATE','ADD_PERSONAL_LIST'],'separate');});
  for(const [destination,intent] of [['personalList','ADD_PERSONAL_LIST'],['personalSeen','RETROSPECTIVE_SEEN'],['groupList','PROPOSE_TO_GROUP']])await test('Add primary save follows '+destination,async h=>{
    await h.boot();const ui=Shell.createShell({session:h.host,root:document,lookup:async title=>({title})});
    ui.navigate(destination);ui.edit('createContent',null);
    document.getElementById('addTitle').value='Synthetic contextual add';
    const originalSearch=searchTmdbCandidates;searchTmdbCandidates=async()=>[];
    try{await document.getElementById('addSaveBtn').onclick();await h.pump();deep(h.commands.map(c=>c.body.intent),['CONTENT_CREATE',intent],'explicit primary relation only');}
    finally{searchTmdbCandidates=originalSearch;ui.dispose();}
  });
  await test('metadata command reaches accepted catalog',async h=>{await h.boot();await Shell.perform('updateMetadata',data.M,{title:'Synthetic corrected'});await h.pump();eq(h.state.view.catalog.getContent(data.M).content.title,'Synthetic corrected','accepted metadata');});
  await test('Match enter/start',async h=>{await h.boot();Shell.navigate('match');await h.pump();check(!!h.state.match.authoritative.session,'session');eq(h.commands.length,0,'no shared writer');});
  await test('Match swipe pending H1 exact',async h=>{await h.boot();const token=await h.pending();eq((await h.state.matchCommands.acknowledge(token)).outcome,'SUCCESS','ack');deep(h.matchCalls.at(-1).request.p_parameters,token,'exact observed token');});
  await test('Match Presence separate',async h=>{await h.boot();await h.enterMatch();const before=h.state.view;h.presence[0].onSync([data.N,data.N,data.V]);await h.pump();deep(h.state.match.presence,[data.N,data.V],'UUID dedup');eq(h.state.view,before,'shared unchanged');});
  await test('Match reconnect revalidates',async h=>{await h.boot();await h.enterMatch();const n=h.matchReads.length;h.rt[0].onReconnect();await h.pump();check(h.matchReads.length>n,'read');});
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
  await test('Ruota pool never invokes legacy eligibility',async h=>{await h.boot();const ids=wheelPool().map(c=>c.movie_id);deep(ids,h.state.view.ruota.eligibleMovieIds,'approved target pool');await Shell.perform('quickNight',ids[0]);eq(h.commands.at(-1).body.target.movie_id,ids[0],'stable UUID');});
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
    await h.boot();h.controls.holdSnapshot=true;h.controls.uncertain=true;const before=h.state.view,result=await Shell.perform('recordSeen',data.M);eq(result.outcome,'TRANSPORT_UNCERTAIN','uncertain');const nodes=[];const visit=n=>{nodes.push(n);for(const child of n._children??Array.from(n.children??[]))visit(child);};visit(document.getElementById('movieGrid'));const retry=nodes.find(n=>n.textContent==='Riprova la stessa operazione');check(!!retry,'retry control visible');const original=copy(h.commands[0].body);await retry.onclick();deep(h.commands[1].body,original,'same UUID body and CAS');deep(h.state.view.personal.caller.seen,before.personal.caller.seen,'no optimistic seen');deep(h.state.view.counts,before.counts,'no optimistic counts');
  });
  // Actual product dialog/participant/double-submit gestures are exercised over
  // real HTTP DOM by verify-product-target-http.cjs (not this non-parsing stub).
  await test('CACHE is visibly stale and cannot authorize shell writes',async h=>{await h.boot();eq(h.state.runtime.source,'CACHE','cache');check(html().includes('Dati salvati'),'explicit cache presentation');eq((await Shell.perform('recordSeen',data.M)).outcome,'NOT_READY','runtime rejects writes');eq(h.commands.length,0,'no mutation');await h.reply();eq(h.state.runtime.source,'ONLINE','accepted online');},{cached:true});
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
 const context=vm.createContext({console,URL,URLSearchParams,AbortController,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
 vm.runInContext(dom+`const localStorage={getItem:()=>null,setItem(){},removeItem(){}};const sessionStorage=localStorage;const document=documentStub;const Option=function(text,value){const el=makeEl('option');el.textContent=text;el.value=value;return el;};const window={addEventListener(){},scrollTo(){}};const location={search:'',hash:'',href:'https://fixture.invalid/',reload(){}};const navigator={};const performance={now:()=>0};`,context);
 for(const f of graph)vm.runInContext(f==='js/config.js'?`const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'',OMDB_API_KEY:'',PEOPLE:{N:{label:'Nicholas',badgeClass:''},V:{label:'Valeria',badgeClass:''}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};`:read(f),context,{filename:f});
 const code=`(${runChecks.toString()})({Core:SnapshotCore,Cache:SnapshotCache,Engine:RecommendationEngine,Shell:TargetShell,originalSession:ProductionSession,createCoordinator:ProductionSession.createCoordinator,productionDependencies:ProductionSession.productionDependencies,install: app=>{ProductionSession=app;TargetShell.dispose();},html:()=>document.getElementById('movieGrid').innerHTML},${JSON.stringify(fixtureData())},name=>console.log('PASS '+name))`;
 vm.runInContext(code,context).then(r=>console.log('PRODUCTION SHELL VM '+JSON.stringify(r)+' PASS')).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
