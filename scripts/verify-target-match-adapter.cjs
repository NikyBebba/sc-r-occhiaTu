#!/usr/bin/env node
'use strict';
// Shared Node/classic/Safari checks. Real target runtime, Core, projection and
// ConsumerFacade; only RPC, Match server, clock and lifecycle sources are fakes.
function fixtureData() {
  const F = require('./fixtures/snapshot-v1.cjs');
  const raw = F.candidate();
  for (const id of [F.Q, F.uid(3)]) { raw.catalog.push(F.content(id)); raw.group.states.push({ ...F.groupState(id), effective_candidacy: true, list_visible: true, eligibility: { match_base: true, ruota_base: true } }); for (const p of raw.personal) p.states.push(F.personalState(id)); }
  F.finish(raw);
  const changes = {};
  for (const reason of ['eligibility', 'Together', 'scheduled', 'veto', 'cinema']) {
    const next = JSON.parse(JSON.stringify(raw)); next.group.states[0].eligibility.match_base = false;
    next.versions.entries[0].version = '2';
    if (reason === 'eligibility') { next.group.states[0].effective_candidacy = false; next.group.states[0].list_visible = false; }
    if (reason === 'cinema') next.catalog[0].cinema_watchlist = true;
    if (reason === 'veto') next.vetoes.push({ veto_id: F.uid(400), person_id: F.N, movie_id: F.M, week_key: next.temporal.week_key });
    if (reason === 'scheduled' || reason === 'Together') {
      const n = F.night(F.NIGHT, F.M, reason === 'Together' ? 'completed' : 'proposed'); next.nights.push(n);
      next.versions.entries.push(F.version('night', F.G, F.NIGHT));
      if (reason === 'scheduled') next.group.states[0].list_visible = false;
      else { next.participants.push({ night_id: F.NIGHT, person_id: F.N }); next.exposure.push({ person_id: F.N, movie_id: F.M, sources: ['SELECTED_GROUP_TOGETHER'] }); }
    }
    changes[reason] = F.finish(next);
  }
  return { raw, changes, N: F.N, V: F.V, G: F.G, M: F.M, Q: F.Q, R: F.uid(3), sid: F.uid(600), other: F.uid(601), observer: F.uid(990001), at: F.AT };
}
async function runChecks(modules, data, onCase = () => {}) {
  const { Adapter, Runtime, Facade, Action } = modules;
  let cases = 0, assertions = 0, worstReads = 0, worstConcurrent = 0;
  const check = (ok, m) => { if (!ok) throw Error(m); assertions++; };
  const eq = (a, b, m) => check(a === b, m + ': ' + String(a) + ' != ' + String(b));
  const stable = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  const deep = (a, b, m) => eq(stable(a), stable(b), m);
  const clone = x => JSON.parse(JSON.stringify(x));
  const tick = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  const frozen = x => { check(Object.isFrozen(x), 'frozen object'); for (const v of Object.values(x)) if (v && typeof v === 'object') frozen(v); };
  function session(id = data.sid, deck = [data.M, data.Q, data.R], status = 'open') { return { id, created_by: 'N', seed: 17, deck: [...deck], status, matched_movie_id: null, matched_at: null, created_at: data.at }; }
  async function make(options = {}) {
    const jobs = [], calls = [], reads = [], rt = [], pr = [], runtimeListeners = new Set(), timers = new Map();
    let timer = 0, currentReads = 0, peakReads = 0, seq = 100, tracks = 0, untracks = 0, detaches = 0;
    let wire = clone(data.raw); if (options.caller) wire.caller.person_id = options.caller;
    const host = { now: data.at, readHold: false, commandHold: false, readFailure: null, malformed: null, overrideResponse: null, uncertain: null, uncertainBefore: null, authNotifications: 0,
      serverSession: options.empty ? null : session(), serverSwipes: [], phase: null, generation: null, bundleOverride: null };
    const runtime = Runtime.createTargetRuntime({ auth: { async getVerifiedIdentity() { return { callerId: wire.caller.person_id }; } },
      rpc: async name => {
        if (name === 'get_app_runtime_context') return { data: { bootstrap_contract_version: 1, outcome: 'OK', caller: { person_id: wire.caller.person_id, legacy_person: wire.caller.person_id === data.N ? 'N' : 'V' }, selected_group: { group_id: wire.selected_group.group_id }, protocol: { client_protocol: 1, supported_protocol: 1, minimum_client_protocol: 1, snapshot_contract_version: 1 }, runtime: { mode: 'target', activation_allowed: true } }, error: null };
        if (name === 'get_person_group_snapshot') return { data: wire, error: null };
        throw Error('Unexpected shared-domain RPC ' + name);
      }, clock: { nowInstant: () => wire.temporal.as_of }, scheduler: { scheduleAt(at, fn) { timers.set(++timer, fn); return timer; }, cancel: id => timers.delete(id) }, subscribeInvalidation: () => () => {}, enqueue: f => jobs.push(f), observerRequestId: data.observer });
    const pump = async () => { for (let i = 0; i < 20; i++) { await tick(); if (!jobs.length) break; for (const f of jobs.splice(0)) f(); } await tick(); };
    await runtime.start(); await pump();
    const caller = () => wire.caller.person_id === data.N ? 'N' : 'V';
    const eligible = () => new Set(Facade.createConsumerBundle(runtime.getState()).getMatchInput().matchBaseIds);
    function progress(s) {
      const ids = s.deck.filter(id => eligible().has(id));
      const answers = id => host.serverSwipes.filter(w => w.session_id === s.id && w.movie_id === id);
      const last = [...ids].reverse().find(id => answers(id).filter(w => w.liked).length === 2) ?? null;
      return { pending: last !== s.matched_movie_id ? last : null, done: ids.every(id => answers(id).length === 2) };
    }
    const stateResponse = outcome => ({ outcome, session: clone(host.serverSession), swipes: clone(host.serverSwipes) });
    function server(req) {
      const a = req.p_action, p = req.p_parameters; let s = host.serverSession;
      if (a === 'start') {
        if (s && ['open', 'matched'].includes(s.status)) return stateResponse('ALREADY_IN_TARGET_STATE');
        s = session(s ? data.other : data.sid, p.deck); s.seed = p.seed; s.created_by = caller(); host.serverSession = s; host.serverSwipes = []; return stateResponse('SUCCESS');
      }
      if (!s || s.id !== p.session_id) return { outcome: 'STALE', session: null };
      if (a === 'swipe') {
        if (host.serverSwipes.some(w => w.movie_id === p.movie_id && w.person === caller())) return stateResponse('ALREADY_IN_TARGET_STATE');
        host.serverSwipes.push({ id: '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0'), session_id: s.id, movie_id: p.movie_id, person: caller(), liked: p.liked, created_at: host.now }); return stateResponse('SUCCESS');
      }
      if (a === 'close') { if (!['open', 'matched'].includes(s.status)) return { outcome: 'STALE', session: clone(s) }; s.status = 'closed'; return stateResponse('SUCCESS'); }
      const pgs = progress(s);
      if (a === 'reconcile-done') { if (s.status === 'open' && pgs.done && pgs.pending === null) { s.status = 'done'; return stateResponse('SUCCESS'); } return stateResponse('ALREADY_IN_TARGET_STATE'); }
      if (a === 'acknowledge-match') {
        const m = p.matched_movie_id;
        if (host.serverSwipes.filter(w => w.movie_id === m && w.liked).length !== 2) return { outcome: 'STALE', session: clone(s) };
        if (s.matched_movie_id === m) return stateResponse('ALREADY_IN_TARGET_STATE');
        if (s.deck.indexOf(s.matched_movie_id) > s.deck.indexOf(m) || pgs.pending !== m || !['open', 'matched'].includes(s.status)) return { outcome: 'STALE', session: clone(s) };
        s.matched_movie_id = m; s.matched_at = host.now; s.status = pgs.done ? 'done' : 'open'; return stateResponse('SUCCESS');
      }
      throw Error('Unexpected Match action');
    }
    const adapter = Adapter.createMatchAdapter({
      getRuntimeState: () => { const r = runtime.getState(); return host.phase || host.generation ? { ...r, phase: host.phase ?? r.phase, generation: host.generation ?? r.generation } : r; },
      getConsumerBundle: () => host.bundleOverride ?? Facade.createConsumerBundle(runtime.getState()),
      subscribeRuntime: f => { runtimeListeners.add(f); const stop = runtime.subscribe(f); return () => { runtimeListeners.delete(f); stop(); }; },
      executeMatchAction(req) {
        calls.push({ request: req }); const call = calls.at(-1);
        const apply = () => { if (host.uncertainBefore === req.p_action) { host.uncertainBefore = null; throw TypeError('Synthetic network failure before execution'); } const response = host.overrideResponse ?? server(req); if (host.uncertain === req.p_action) { host.uncertain = null; throw Error('Synthetic lost response'); } return response; };
        if (host.commandHold) return new Promise((resolve, reject) => { call.resolve = () => { try { resolve(apply()); } catch (e) { reject(e); } }; });
        return Promise.resolve().then(apply);
      },
      readLatestMatchState() {
        currentReads++; peakReads = Math.max(peakReads, currentReads);
        const value = { category: 'MATCH_STATE', session: clone(host.serverSession), swipes: clone(host.serverSwipes) };
        return new Promise((resolve, reject) => {
          const finish = (custom = value) => { currentReads--; host.readFailure ? reject(host.readFailure) : resolve(host.malformed ?? custom); };
          reads.push({ finish, value }); if (!host.readHold) finish();
        });
      },
      subscribeRealtime(h) { rt.push(h); return () => { detaches++; }; },
      subscribePresence(h) { pr.push(h); return { track: async id => { eq(id, wire.caller.person_id, 'UUID presence key'); tracks++; }, untrack: () => { untracks++; if (host.untrackThrows) throw Error('Synthetic cleanup failure'); return Promise.resolve(); }, dispose() { detaches++; } }; },
      enqueue: f => jobs.push(f), newSeed: () => 17, nowInstant: () => host.now, onAuthInvalidating() { host.authNotifications++; }
    });
    const h = { adapter, runtime, host, calls, reads, rt, pr, pump,
      get state() { return adapter.getState(); },
      async enter() { const r = await adapter.enter(); await pump(); return r; },
      async sync() { adapter.reconcile(); await pump(); },
      async update(mutator) { mutator(wire); const c = runtime.getState().controllerState.context; if (c.callerId !== wire.caller.person_id || c.groupId !== wire.selected_group.group_id) await runtime.start(); else runtime.requestRefresh(); await pump(); },
      notify() { for (const f of runtimeListeners) f(); },
      add(person, movie = data.M, liked = true) { host.serverSwipes.push({ id: '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0'), session_id: host.serverSession.id, movie_id: movie, person, liked, created_at: host.now }); },
      async double(movie = data.M) { h.add('N', movie); h.add('V', movie); await h.sync(); },
      async swipe(liked = true) { const r = await adapter.swipe(h.state.derived.currentCard, liked); await pump(); return r; },
      async close() { const r = await adapter.close(h.state.observedSession); await pump(); return r; },
      async heldRead() { host.readHold = true; adapter.reconcile(); await pump(); return reads.at(-1); },
      stats() { return { tracks, untracks, detaches, peakReads, currentReads, listeners: runtimeListeners.size }; },
      shutdown() { adapter.dispose(); runtime.dispose(); worstReads = Math.max(worstReads, reads.length); worstConcurrent = Math.max(worstConcurrent, peakReads); }
    }; return h;
  }
  async function test(name, fn, options) { const h = await make(options); try { await fn(h); cases++; onCase(name); } finally { h.shutdown(); } }
  for (const caller of [data.N, data.V]) await test('caller UUID ' + caller, async h => { await h.enter(); eq(h.state.context.callerId, caller, 'caller'); eq(h.state.context.groupId, data.G, 'group'); await h.swipe(); const p = h.calls.at(-1).request.p_parameters; deep(Object.keys(p).sort(), ['liked', 'movie_id', 'session_id'], 'server actor only'); }, { caller });
  await test('unknown mapping rejected', async h => { const b = Facade.createConsumerBundle(h.runtime.getState()); h.host.bundleOverride = Object.freeze({ ...b, people: { identities: b.people.identities.map(p => ({ ...p, legacyLabel: null })) } }); eq((await h.enter()).category, 'INVALID_INPUT', 'mapping'); eq(h.calls.length, 0, 'no writes'); });
  await test('ambiguous mapping rejected', async h => { const b = Facade.createConsumerBundle(h.runtime.getState()); h.host.bundleOverride = Object.freeze({ ...b, people: { identities: b.people.identities.map(p => ({ ...p, legacyLabel: 'N' })) } }); eq((await h.enter()).category, 'INVALID_INPUT', 'ambiguous'); });
  await test('new start', async h => { const r = await h.enter(); eq(r.outcome, 'SUCCESS', 'start'); eq(h.calls[0].request.p_action, 'start', 'actual action'); eq(h.state.authoritative.session.created_by, data.N, 'UUID attribution'); }, { empty: true });
  await test('duplicate start joins frozen deck', async h => { await h.enter(); const before = h.state.authoritative.session; const r = await h.adapter.start(); eq(r.outcome, 'ALREADY_IN_TARGET_STATE', 'join'); deep(h.state.authoritative.session.deck, before.deck, 'frozen order'); });
  await test('concurrent start bounded', async h => { await h.enter(); h.host.commandHold = true; const a = h.adapter.start(); await h.pump(); const b = await h.adapter.start(); eq(b.category, 'INVALID_INPUT', 'one mutation'); h.calls.at(-1).resolve(); await a; eq(h.calls.length, 1, 'one call'); });
  await test('second participant joins same session', async h => { await h.enter(); eq((await h.adapter.start()).session.id, data.sid, 'same session'); }, { caller: data.V });
  await test('start uncertainty reconciles no auto retry', async h => { h.host.uncertain = 'start'; const r = await h.enter(); await h.pump(); eq(r.category, 'TRANSPORT_UNCERTAIN', 'unknown'); check(!r.retryHandle, 'no start retry'); eq(h.calls.filter(x => x.request.p_action === 'start').length, 1, 'not repeated'); eq(h.state.authoritative.session.id, data.sid, 'discovered committed effect'); }, { empty: true });
  await test('terminal then explicit start', async h => { await h.enter(); await h.close(); eq(h.state.authoritative.session.status, 'closed', 'closed'); eq((await h.adapter.start()).outcome, 'SUCCESS', 'new explicit session'); eq(h.state.authoritative.session.id, data.other, 'new identity'); });
  for (const [hours, expired] of [[5.999, false], [6, true], [6.001, true]]) await test('expiry ' + hours, async h => { h.host.now = new Date(Date.parse(data.at) + hours * 3600000).toISOString(); await h.enter(); eq(h.calls.some(x => x.request.p_action === 'close'), expired, 'six-hour bound'); });
  await test('swipe activity extends expiry', async h => { h.host.now = new Date(Date.parse(data.at) + 5 * 3600000).toISOString(); h.add('V'); h.host.now = new Date(Date.parse(data.at) + 6 * 3600000).toISOString(); await h.enter(); eq(h.calls.length, 0, 'resume from last swipe'); });
  for (const liked of [true, false]) await test('swipe ' + liked, async h => { await h.enter(); const token = h.state.derived.currentCard; eq((await h.adapter.swipe(token, liked)).outcome, 'SUCCESS', 'server accepted'); eq(h.state.authoritative.swipes[0].liked, liked, 'server value'); });
  await test('opposite duplicate cannot replace first', async h => { await h.enter(); const card = h.state.derived.currentCard; await h.adapter.swipe(card, true); eq((await h.adapter.swipe(card, false)).category, 'INVALID_INPUT', 'already answered'); eq(h.state.authoritative.swipes[0].liked, true, 'first kept'); });
  await test('repeated exact swipe blocked after authority', async h => { await h.enter(); const card = h.state.derived.currentCard; await h.adapter.swipe(card, true); eq((await h.adapter.swipe(card, true)).category, 'INVALID_INPUT', 'no redundant write'); eq(h.calls.length, 1, 'one command'); });
  await test('compatible likes derive pending', async h => { await h.enter(); await h.swipe(); h.add('V'); await h.sync(); eq(h.state.derived.pendingMatch.matched_movie_id, data.M, 'pending'); eq(h.state.authoritative.session.matched_movie_id, null, 'not acknowledged'); });
  await test('pending uses highest deck position', async h => { await h.enter(); await h.double(data.M); await h.double(data.Q); eq(h.state.derived.pendingMatch.matched_movie_id, data.Q, 'deck order'); });
  await test('H1 immutable exact token', async h => { await h.enter(); await h.double(); const t = h.state.derived.pendingMatch; deep(t, { session_id: data.sid, matched_movie_id: data.M }, 'exact pair'); frozen(t); });
  await test('H1 acknowledge exact observed token', async h => { await h.enter(); await h.double(); const r = await h.adapter.acknowledge(h.state.derived.pendingMatch); eq(r.outcome, 'SUCCESS', 'ack'); deep(h.calls.at(-1).request.p_parameters, { session_id: data.sid, matched_movie_id: data.M }, 'exact parameters'); });
  await test('H1 foreign token rejected', async h => { await h.enter(); await h.double(); eq((await h.adapter.acknowledge({ ...h.state.derived.pendingMatch })).category, 'INVALID_INPUT', 'owned token'); });
  await test('old observed vs newer pending rejected', async h => { await h.enter(); await h.double(); const t = h.state.derived.pendingMatch; await h.double(data.Q); eq((await h.adapter.acknowledge(t)).category, 'INVALID_INPUT', 'stale observation'); eq(h.calls.length, 0, 'no substitute ack'); });
  await test('H1 uncertain exact retry never acknowledges successor', async h => { await h.enter(); await h.double(); const t = h.state.derived.pendingMatch; h.host.uncertain = 'acknowledge-match'; const first = await h.adapter.acknowledge(t); await h.pump(); eq(first.category, 'TRANSPORT_UNCERTAIN', 'ack lost after commit'); await h.double(data.Q); const r = await h.adapter.retry(first.retryHandle); eq(r.outcome, 'ALREADY_IN_TARGET_STATE', 'exact replay'); deep(h.calls.at(-1).request.p_parameters, t, 'old identity unchanged'); eq(h.state.derived.pendingMatch.matched_movie_id, data.Q, 'successor remains pending'); frozen(first.retryHandle); });
  await test('ack after close rejected', async h => { await h.enter(); await h.double(); const t = h.state.derived.pendingMatch; await h.close(); eq((await h.adapter.acknowledge(t)).category, 'INVALID_INPUT', 'terminal'); });
  await test('uncertain swipe reconciles committed first effect', async h => { await h.enter(); h.host.uncertain = 'swipe'; const r = await h.swipe(false); eq(r.category, 'TRANSPORT_UNCERTAIN', 'lost'); eq((await h.adapter.retry(r.retryHandle)).code, 'RETRY_NOT_NEEDED', 'observed first effect'); eq(h.calls.length, 1, 'no second mutation'); });
  await test('uncommitted uncertain swipe exact retry', async h => { await h.enter(); h.host.uncertainBefore = 'swipe'; const r = await h.swipe(false); eq(r.category, 'TRANSPORT_UNCERTAIN', 'network TypeError is uncertainty'); const before = h.calls[0].request; const retry = await h.adapter.retry(r.retryHandle); eq(retry.outcome, 'SUCCESS', 'explicit retry'); deep(h.calls[1].request, before, 'same action body'); eq(h.host.serverSwipes.length, 1, 'one logical effect'); eq(h.host.serverSwipes[0].liked, false, 'same direction'); });
  await test('missed event recovered explicitly', async h => { await h.enter(); h.add('N'); h.add('V'); eq(h.state.derived.pendingMatch, null, 'no optimistic inference'); await h.sync(); eq(h.state.derived.pendingMatch.matched_movie_id, data.M, 'recovered'); });
  await test('initial ready revalidation', async h => { await h.enter(); const count = h.reads.length; h.add('V'); h.rt[0].onReady(); await h.pump(); check(h.reads.length > count, 'read after readiness'); eq(h.state.authoritative.swipes.length, 1, 'establishment gap recovered'); });
  await test('reconnect revalidation', async h => { await h.enter(); h.rt[0].onDisconnected(); h.add('V'); h.rt[0].onReconnect(); await h.pump(); eq(h.state.phase, 'READY', 'ready after online read'); eq(h.state.authoritative.swipes.length, 1, 'missed row recovered'); });
  await test('burst before read coalesces', async h => { await h.enter(); const n = h.reads.length; for (let i = 0; i < 100; i++) h.rt[0].onChange({ forged: true }); await h.pump(); eq(h.reads.length - n, 1, 'one read'); });
  await test('one dirty follow-up and physical single-flight', async h => { await h.enter(); const n = h.reads.length, first = await h.heldRead(); for (let i = 0; i < 25; i++) h.rt[0].onChange(); await h.pump(); eq(h.reads.length - n, 1, 'single physical read'); first.finish(); await h.pump(); eq(h.reads.length - n, 2, 'one follow-up'); for (let i = 0; i < 25; i++) h.rt[0].onChange(); h.reads.at(-1).finish(); await h.pump(); eq(h.reads.length - n, 2, 'bounded even second read dirty'); eq(h.stats().peakReads, 1, 'physical peak one'); });
  await test('exhaustion reconciles server done', async h => { h.host.serverSession.deck = [data.M]; h.add('N', data.M, false); h.add('V', data.M, false); await h.enter(); check(h.calls.some(x => x.request.p_action === 'reconcile-done'), 'actual server reconcile'); });
  await test('pending prevents reconcile-done', async h => { h.host.serverSession.deck = [data.M]; h.add('N'); h.add('V'); await h.enter(); eq(h.calls.length, 0, 'pending remains open'); eq(h.state.derived.view, 'MATCH_PENDING', 'pending'); });
  await test('raw realtime rows never authority', async h => { await h.enter(); const before = stable(h.state.authoritative); h.rt[0].onChange({ new: { status: 'closed', deck: [] } }); eq(stable(h.state.authoritative), before, 'no patch'); await h.pump(); eq(h.state.authoritative.session.status, 'open', 'server wins'); });
  for (const mode of ['join', 'leave', 'sync', 'duplicates', 'unknown', 'disconnect']) await test('presence ' + mode, async h => { await h.enter(); const p = h.pr[0]; p.onSync([data.N, data.V]); if (mode === 'join') { p.onSync([data.N]); p.onJoin(data.V); } if (mode === 'leave') p.onLeave(data.V); if (mode === 'duplicates') p.onSync([data.N, data.N, data.V]); if (mode === 'unknown') p.onSync(['N', data.other, data.N]); if (mode === 'disconnect') p.onDisconnected(); const expected = mode === 'disconnect' ? [] : ['leave', 'unknown'].includes(mode) ? [data.N] : [data.N, data.V]; deep(h.state.presence, expected, 'UUID set'); eq(h.calls.length, 0, 'no domain transition'); });
  await test('absence of Presence does not authorize swipe', async h => { await h.enter(); eq(h.state.presence.length, 0, 'empty'); eq((await h.swipe()).outcome, 'SUCCESS', 'server authority unaffected'); });
  await test('close active server result', async h => { await h.enter(); eq((await h.close()).outcome, 'SUCCESS', 'closed'); eq(h.state.derived.view, 'CLOSED', 'terminal view'); });
  await test('close terminal returns STALE and rereads', async h => { await h.enter(); await h.close(); eq((await h.close()).outcome, 'STALE', 'terminal semantic response'); eq(h.state.authoritative.session.status, 'closed', 'not reopened'); });
  await test('leave is not close', async h => { await h.enter(); h.adapter.leave(); eq(h.host.serverSession.status, 'open', 'server session preserved'); eq(h.calls.length, 0, 'no mutation'); eq(h.state.authoritative.session, null, 'published state cleared'); check(h.stats().untracks > 0, 'untrack'); });
  await test('late swipe after external close cannot reopen', async h => { await h.enter(); h.host.commandHold = true; const p = h.adapter.swipe(h.state.derived.currentCard, true); await h.pump(); h.host.serverSession.status = 'closed'; h.calls.at(-1).resolve(); await p; eq(h.state.authoritative.session.status, 'closed', 'late history only'); eq(h.state.derived.currentCard, null, 'no next swipe'); });
  await test('late read cannot overwrite newer mutation response', async h => { await h.enter(); const held = await h.heldRead(); await h.close(); held.finish(); await h.pump(); eq(h.state.authoritative.session.status, 'closed', 'closed kept'); h.host.readHold = false; h.reads.at(-1).finish(); await h.pump(); });
  for (const kind of ['AUTH_INVALIDATING', 'caller', 'group', 'epoch', 'generation']) await test('context invalidation ' + kind, async h => { await h.enter(); const old = h.rt[0], p = h.pr[0], count = h.reads.length; if (kind === 'AUTH_INVALIDATING') h.host.phase = kind; else if (kind === 'generation') h.host.generation = 99; else await h.update(w => { if (kind === 'caller') w.caller.person_id = data.V; else if (kind === 'group') { w.selected_group.group_id = data.other; w.coverage.group_id = data.other; for (const v of w.versions.entries) if (v.scope_kind === 'group_film') v.scope_id = data.other; } else h.host.generation = 99; }); h.notify(); old.onChange(); p.onSync([data.N, data.V]); await h.pump(); eq(h.state.authoritative.session, null, 'sensitive state cleared'); eq(h.reads.length, count, 'old callback no new reads'); });
  await test('group replacement not silently adopted', async h => { await h.enter(); await h.update(w => { w.selected_group.group_id = data.other; w.coverage.group_id = data.other; for (const v of w.versions.entries) if (v.scope_kind === 'group_film') v.scope_id = data.other; }); eq((await h.enter()).code, 'GROUP_REPLACEMENT_UNSUPPORTED', 'single installation boundary'); });
  await test('dispose leaves no callbacks', async h => { await h.enter(); const old = h.rt[0], p = h.pr[0]; h.adapter.dispose(); old.onChange(); p.onJoin(data.V); await h.pump(); eq(h.state.phase, 'DISPOSED', 'disposed'); eq(h.stats().listeners, 0, 'runtime subscription removed'); eq((await h.adapter.start()).category, 'OBSOLETE', 'inert'); });
  await test('stale read result after leave inert', async h => { await h.enter(); const old = await h.heldRead(); h.adapter.leave(); old.finish(); await h.pump(); eq(h.state.authoritative.session, null, 'no resurrection'); });
  await test('stale mutation after leave inert', async h => { await h.enter(); h.host.commandHold = true; const p = h.adapter.swipe(h.state.derived.currentCard, true); await h.pump(); h.adapter.leave(); h.calls.at(-1).resolve(); eq((await p).category, 'OBSOLETE', 'old response'); eq(h.state.authoritative.session, null, 'cleared'); });
  await test('retry handle context bound', async h => { await h.enter(); await h.double(); h.host.uncertain = 'acknowledge-match'; const r = await h.adapter.acknowledge(h.state.derived.pendingMatch); h.adapter.leave(); eq((await h.adapter.retry(r.retryHandle)).category, 'OBSOLETE', 'no old retry'); });
  for (const reason of ['eligibility', 'Together', 'scheduled', 'veto', 'cinema']) await test('target refresh removes ' + reason, async h => { await h.enter(); const deck = h.state.authoritative.session.deck; await h.update(w => Object.assign(w, clone(data.changes[reason]))); eq(h.state.derived.currentCard.movie_id, data.Q, 'approved eligibility consumed'); deep(h.state.authoritative.session.deck, deck, 'history preserved'); });
  await test('newly eligible content not added to frozen deck', async h => { h.host.serverSession.deck = [data.M]; await h.enter(); eq(h.state.derived.actionableMovieIds.length, 1, 'deck intersection'); check(!h.state.derived.actionableMovieIds.includes(data.Q), 'new eligibility not injected'); });
  await test('unresolved catalog safely skips card preserving history', async h => { await h.enter(); const b = Facade.createConsumerBundle(h.runtime.getState()); h.host.bundleOverride = Object.freeze({ ...b, getMatchInput: () => ({ ...b.getMatchInput(), content: b.getMatchInput().content.filter(m => m.movie_id !== data.M) }) }); eq(h.state.derived.currentCard.movie_id, data.Q, 'unresolved skipped'); check(h.state.authoritative.session.deck.includes(data.M), 'not deleted'); });
  await test('stable handoff uses ActionAdapter captured context', async h => { await h.enter(); await h.double(); const id = h.state.derived.pendingMatch.matched_movie_id, commands = []; const actual = h.runtime;
    const actions = Action.createActionAdapter({ runtime: { getState: () => actual.getState(), executeIntent: request => { commands.push(request); return Promise.resolve({ category: 'SEMANTIC_RESULT', response: { outcome: 'SUCCESS', result: { movie_id: id, night_id: null } } }); }, retryCommand: () => { throw Error('unused'); } }, newRequestId: () => data.observer });
    const result = await actions.quickNight(actions.captureContext(), id); eq(result.outcome, 'SUCCESS', 'shared action result separate'); eq(commands[0].intent, 'QUICK_NIGHT', 'common action'); eq(commands[0].target.movie_id, id, 'stable UUID'); eq(h.calls.length, 0, 'Match has not scheduled or closed'); await h.close(); eq(h.calls[0].request.p_action, 'close', 'explicit subsequent close'); actions.dispose(); });
  await test('no shared-domain or Snapshot patch', async h => { await h.enter(); const root = h.runtime.getState().controllerState.view.root; await h.swipe(); eq(h.runtime.getState().controllerState.view.root, root, 'same immutable domain root'); check(!('scheduleNight' in h.adapter) && !('executeIntent' in h.adapter), 'no shared writer'); });
  await test('immutable state', async h => { await h.enter(); frozen(h.state); let rejected = false; try { h.state.authoritative.session.deck.push(data.other); } catch (_) { rejected = true; } check(rejected, 'mutation rejected'); eq(h.state.authoritative.session.deck.length, 3, 'unaffected'); });
  await test('immutable results and request', async h => { await h.enter(); const r = await h.swipe(); frozen(r); frozen(h.calls[0].request); });
  await test('input server arrays defensively isolated', async h => { await h.enter(); const state = h.state; h.host.serverSession.deck.pop(); eq(state.authoritative.session.deck.length, 3, 'old view isolated'); eq(h.state.authoritative.session.deck.length, 3, 'no patch from host mutation'); });
  await test('listener errors isolated and mutation protected', async h => { let observed = 0, rejected = 0; h.adapter.subscribe(() => { throw Error('observer'); }); const stop = h.adapter.subscribe(() => { observed++; try { h.adapter.leave(); } catch (_) { rejected++; } }); await h.enter(); check(observed > 0 && rejected === observed, 'reentrant mutations rejected'); eq(h.state.phase, 'READY', 'observer cannot undo'); stop(); });
  await test('read failure not empty session', async h => { h.host.readFailure = Error('network'); const r = await h.enter(); eq(r.code, 'MATCH_READ_UNAVAILABLE', 'failed read'); eq(h.calls.length, 0, 'no accidental start'); });
  await test('malformed read fails closed', async h => { h.host.malformed = { category: 'MATCH_STATE', session: null, swipes: [{ person: 'N' }] }; await h.enter(); eq(h.state.phase, 'UNAVAILABLE', 'malformed'); eq(h.calls.length, 0, 'no creation'); });
  await test('malformed RPC envelope rejected', async h => { await h.enter(); h.host.overrideResponse = { outcome: 'SUCCESS', session: null }; eq((await h.swipe()).category, 'SERVER_CONTRACT_ERROR', 'exact decode'); });
  await test('RPC auth invalidates and delegates', async h => { await h.enter(); h.host.overrideResponse = { outcome: 'ERROR', error: { code: 'FORBIDDEN' } }; eq((await h.swipe()).category, 'AUTH_INVALIDATING', 'auth'); await h.pump(); eq(h.state.authoritative.session, null, 'cleared'); eq(h.host.authNotifications, 1, 'host notification'); });
  await test('partial STALE does not erase swipes', async h => { await h.enter(); await h.double(); h.host.overrideResponse = { outcome: 'STALE', session: clone(h.host.serverSession) }; const r = await h.adapter.acknowledge(h.state.derived.pendingMatch); eq(r.outcome, 'STALE', 'partial response'); eq(h.state.authoritative.swipes.length, 2, 'not coerced to empty'); h.host.overrideResponse = null; await h.pump(); });
  await test('old session token invalid after replacement read', async h => { await h.enter(); const token = h.state.derived.currentCard; h.host.serverSession = session(data.other); await h.sync(); eq((await h.adapter.swipe(token, true)).category, 'INVALID_INPUT', 'old session'); });
  await test('no optimistic Match update during command', async h => { await h.enter(); h.host.commandHold = true; const p = h.adapter.swipe(h.state.derived.currentCard, true); await h.pump(); eq(h.state.authoritative.swipes.length, 0, 'no optimistic row'); h.calls.at(-1).resolve(); await p; eq(h.state.authoritative.swipes.length, 1, 'server state only'); });
  await test('no automatic startup', async h => { eq(h.reads.length, 0, 'no read before enter'); eq(h.calls.length, 0, 'no mutation'); eq(h.rt.length, 0, 'no realtime startup'); eq(h.pr.length, 0, 'no presence startup'); });
  await test('uncertain ack before commit keeps exact token after newer pending', async h => { await h.enter(); await h.double(); const token = h.state.derived.pendingMatch; h.host.uncertainBefore = 'acknowledge-match'; const first = await h.adapter.acknowledge(token); await h.pump(); await h.double(data.Q); const r = await h.adapter.retry(first.retryHandle); eq(r.outcome, 'STALE', 'server rejects old observation'); deep(h.calls.at(-1).request.p_parameters, token, 'no substitution'); eq(h.host.serverSession.matched_movie_id, null, 'neither acknowledged'); });
  await test('concurrent exact retry coalesces mutation', async h => { await h.enter(); h.host.uncertainBefore = 'swipe'; const first = await h.swipe(); h.host.commandHold = true; const a = h.adapter.retry(first.retryHandle), b = h.adapter.retry(first.retryHandle); await h.pump(); eq(h.calls.length, 2, 'one explicit retry call'); h.calls.at(-1).resolve(); eq((await a).outcome, 'SUCCESS', 'first waiter'); eq((await b).outcome, 'SUCCESS', 'second waiter'); });
  await test('failed reconciliation prevents swipe retry', async h => { await h.enter(); h.host.uncertainBefore = 'swipe'; const first = await h.swipe(); h.host.readFailure = Error('offline'); const r = await h.adapter.retry(first.retryHandle); eq(r.code, 'RECONCILIATION_REQUIRED', 'read required'); eq(h.calls.length, 1, 'no blind retry'); });
  await test('uncertain close first reconciles terminal state', async h => { await h.enter(); h.host.uncertain = 'close'; const r = await h.close(); eq(r.category, 'TRANSPORT_UNCERTAIN', 'close lost'); eq((await h.adapter.retry(r.retryHandle)).code, 'RETRY_NOT_NEEDED', 'terminal observed'); eq(h.calls.length, 1, 'not repeated'); });
  await test('RPC session mismatch fails closed', async h => { await h.enter(); h.host.overrideResponse = { outcome: 'SUCCESS', session: session(data.other), swipes: [] }; eq((await h.swipe()).category, 'SERVER_CONTRACT_ERROR', 'wrong response session'); eq(h.state.authoritative.session.id, data.sid, 'not substituted'); eq((await h.adapter.start()).code, 'RECONCILIATION_REQUIRED', 'writes blocked'); });
  await test('read with unknown historical actor rejected', async h => { h.add('X'); await h.enter(); eq(h.state.phase, 'UNAVAILABLE', 'unknown actor rejected'); eq(h.calls.length, 0, 'no writes'); });
  await test('explicit no-session read distinct from error', async h => { await h.enter(); h.host.serverSession = null; h.host.serverSwipes = []; await h.sync(); eq(h.state.phase, 'READY', 'available read'); eq(h.state.authoritative.session, null, 'no session'); eq(h.calls.length, 0, 'ordinary sync does not start'); });
  await test('re-enter preserves server session and new lifecycle', async h => { await h.enter(); const old = h.rt[0]; h.adapter.leave(); await h.enter(); const n = h.reads.length; old.onReady(); old.onChange(); await h.pump(); eq(h.reads.length, n, 'old binding inert'); eq(h.state.authoritative.session.id, data.sid, 'same session'); eq(h.calls.length, 0, 'no close/start'); });
  await test('context epoch advances using real runtime restart', async h => { await h.enter(); const old = h.state.context.contextEpoch; await h.runtime.start(); await h.pump(); eq(h.state.authoritative.session, null, 'old epoch cleared'); await h.enter(); check(h.state.context.contextEpoch > old, 'new epoch'); });
  await test('ready callback after dispose inert', async h => { await h.enter(); const r = h.rt[0], p = h.pr[0]; h.adapter.dispose(); const n = h.reads.length, tracks = h.stats().tracks; r.onReady(); r.onReconnect(); p.onReady(); await h.pump(); eq(h.reads.length, n, 'no reads'); eq(h.stats().tracks, tracks, 'no re-track'); });
  await test('read auth failure clears state', async h => { await h.enter(); h.host.readFailure = { status: 401 }; await h.sync(); eq(h.state.phase, 'AUTH_INVALIDATING', 'auth phase'); eq(h.state.authoritative.session, null, 'cleared'); eq(h.host.authNotifications, 1, 'delegated'); });
  await test('unknown Presence structure cannot change domain', async h => { await h.enter(); h.pr[0].onSync({ person: data.N }); deep(h.state.presence, [], 'invalid payload ignored'); eq(h.state.authoritative.session.status, 'open', 'no transition'); });
  await test('input observations cannot be mutated', async h => { await h.enter(); const card = h.state.derived.currentCard; let rejected = false; try { card.movie_id = data.Q; } catch (_) { rejected = true; } check(rejected, 'frozen observed card'); await h.adapter.swipe(card, true); eq(h.calls[0].request.p_parameters.movie_id, data.M, 'original identity'); });
  await test('explicit unavailable read never starts session', async h => { h.host.malformed = { category: 'UNAVAILABLE', code: 'OFFLINE' }; await h.enter(); eq(h.state.phase, 'UNAVAILABLE', 'unavailable'); eq(h.calls.length, 0, 'no start'); });
  await test('network TypeError on read remains transport failure', async h => { h.host.readFailure = TypeError('Synthetic network'); await h.enter(); eq(h.state.lastError, 'MATCH_READ_UNAVAILABLE', 'not malformed server contract'); eq(h.calls.length, 0, 'no start'); });
  await test('wrong RPC outcome does not publish session', async h => { await h.enter(); h.host.overrideResponse = { outcome: 'STARTED', session: session(), swipes: [] }; eq((await h.swipe()).category, 'SERVER_CONTRACT_ERROR', 'actual outcomes only'); eq(h.state.authoritative.swipes.length, 0, 'no rejected response publication'); });
  await test('old read remains inert after context replacement', async h => { await h.enter(); const read = await h.heldRead(); h.host.generation = 99; h.notify(); read.finish(); await h.pump(); eq(h.state.authoritative.session, null, 'old response discarded'); eq(h.state.phase, 'CONTEXT_INVALID', 'new context not overwritten'); });
  await test('runtime auth invalidation during mutation discards completion', async h => { await h.enter(); h.host.commandHold = true; const r = h.adapter.swipe(h.state.derived.currentCard, true); await h.pump(); h.runtime.invalidateAuth(); h.calls.at(-1).resolve(); eq((await r).category, 'OBSOLETE', 'late mutation inert'); eq(h.state.phase, 'AUTH_INVALIDATING', 'auth state retained'); eq(h.state.authoritative.session, null, 'cleared'); });
  await test('ack uncertain then terminal identical retry stays closed', async h => { await h.enter(); await h.double(); h.host.uncertain = 'acknowledge-match'; const r = await h.adapter.acknowledge(h.state.derived.pendingMatch); await h.pump(); await h.close(); eq((await h.adapter.retry(r.retryHandle)).outcome, 'ALREADY_IN_TARGET_STATE', 'natural retry'); eq(h.state.authoritative.session.status, 'closed', 'no reopen'); });
  await test('bounded dirty work recovers on later explicit trigger', async h => { await h.enter(); const first = await h.heldRead(); h.rt[0].onChange(); first.finish(); await h.pump(); h.rt[0].onChange(); h.reads.at(-1).finish(); await h.pump(); const n = h.reads.length; eq(h.state.pending.dirty, true, 'pending hint retained'); h.host.readHold = false; h.add('V'); await h.sync(); eq(h.reads.length, n + 1, 'one future read'); eq(h.state.authoritative.swipes.length, 1, 'recovered'); });
  await test('uncertain start blocks another start until successful read', async h => { await h.enter(); h.host.serverSession.status = 'closed'; h.host.uncertain = 'start'; h.host.readHold = true; const first = await h.adapter.start(); eq(first.category, 'TRANSPORT_UNCERTAIN', 'unknown creation'); eq((await h.adapter.start()).code, 'RECONCILIATION_REQUIRED', 'read first'); eq(h.calls.length, 1, 'no repeated start'); await h.pump(); h.host.readHold = false; h.reads.at(-1).finish(); await h.pump(); eq(h.state.authoritative.session.id, data.other, 'created session recovered'); });
  await test('cleanup continues after untrack throws', async h => { await h.enter(); h.host.untrackThrows = true; h.adapter.dispose(); eq(h.stats().detaches, 2, 'both lifecycle resources detached'); eq(h.stats().listeners, 0, 'runtime listener removed'); });
  await test('swipe validates exact boolean and owned observation', async h => { await h.enter(); const t = h.state.derived.currentCard; eq((await h.adapter.swipe(t, 1)).category, 'INVALID_INPUT', 'not boolean'); eq((await h.adapter.swipe({ ...t }, true)).category, 'INVALID_INPUT', 'not owned'); eq(h.calls.length, 0, 'no invalid writes'); });
  await test('semantic server error remains distinct and non-optimistic', async h => { await h.enter(); h.host.overrideResponse = { outcome: 'ERROR', error: { code: 'VALIDATION_ERROR' } }; const r = await h.swipe(); eq(r.category, 'SEMANTIC_RESULT', 'server semantic response'); eq(r.outcome, 'ERROR', 'actual outcome'); eq(r.error.code, 'VALIDATION_ERROR', 'code preserved'); eq(h.state.authoritative.swipes.length, 0, 'no local effect'); });
  return { cases, assertions, worstTotalReadsPerScenario: worstReads, worstConcurrentReads: worstConcurrent };
}
module.exports = { fixtureData, runChecks };
if (require.main === module) runChecks({ Adapter: require('../js/runtime/match-adapter'), Runtime: require('../js/runtime/target-runtime'), Facade: require('../js/runtime/consumer-facade'), Action: require('../js/runtime/action-adapter') }, fixtureData(), name => console.log('PASS ' + name))
  .then(r => console.log('MATCH ADAPTER ' + JSON.stringify(r) + ' PASS; synthetic/local only.')).catch(e => { console.error(e.stack); process.exitCode = 1; });
