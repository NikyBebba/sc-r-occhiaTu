'use strict';
// Protocol observations are online, short-lived authority. Storage and URL state
// never participate. Server fencing remains the protection between observations.
const ProtocolSession = (() => {
  const frozen = Object.freeze;
  function decode(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join() !== 'authority_epoch,minimum_client_protocol,mode,outcome,protocol_read_contract_version' ||
      value.protocol_read_contract_version !== 1 || value.outcome !== 'OK' ||
      !['LEGACY', 'READ_ONLY', 'TARGET'].includes(value.mode) ||
      ![0, 1].includes(value.minimum_client_protocol) ||
      typeof value.authority_epoch !== 'string' || !/^[a-f0-9]{64}$/.test(value.authority_epoch) ||
      (value.mode === 'LEGACY' && value.minimum_client_protocol !== 0) ||
      (value.mode === 'TARGET' && value.minimum_client_protocol !== 1)) throw new TypeError('INVALID_PROTOCOL_OBSERVATION');
    return frozen({ mode: value.mode, floor: value.minimum_client_protocol, epoch: value.authority_epoch });
  }
  function create({ readProtocol, createSession, clearViews, onState, now, schedule, cancel,
    pollMs = 5000, leaseMs = 10000, timeoutMs = 8000 }) {
    if (![readProtocol, createSession, clearViews, onState, now, schedule, cancel].every(x => typeof x === 'function')) throw new TypeError('Protocol dependencies required');
    let uid = null, mode = 'UNAVAILABLE', phase = 'STOPPED', reason = null, generation = 0;
    let session = null, off = null, proof = null, flight = null, serial = 0, poll = null, expiry = null, disposed = false;
    let queue = Promise.resolve(), teardownFailed = false;
    const floors = new Map(), listeners = new Set();
    const fresh = () => !!proof && now() >= proof.at && now() < proof.until;
    function getState() {
      const valid = fresh(), failedStart = phase === 'BLOCKED' && reason?.code === 'SESSION_START_FAILED';
      const child = valid && !failedStart ? session?.getState() : null;
      return frozen({ ...(child || {}), mode: valid ? mode : 'UNAVAILABLE', phase: valid ? child?.phase ?? phase : phase === 'STOPPED' ? phase : 'BLOCKED',
        generation, reason: valid ? child?.reason ?? reason : reason || frozen({ code: 'PROTOCOL_UNAVAILABLE' }),
        view: child?.view ?? frozen({ kind: 'UNAVAILABLE', reason: 'PROTOCOL_UNAVAILABLE' }),
        actions: valid && mode === 'TARGET' ? child?.actions ?? null : null,
        matchCommands: valid && mode === 'TARGET' ? child?.matchCommands ?? null : null });
    }
    function publish() { const state = getState(); try { onState(state); } catch (_) { /* presentation cannot grant authority */ } for (const fn of [...listeners]) { try { fn(state); } catch (_) { /* isolated observer */ } } }
    function clearTimers() { if (poll !== null) cancel(poll); if (expiry !== null) cancel(expiry); poll = expiry = null; }
    function retire(next, observation = null) {
      const old = session; session = null; if (off) off(); off = null;
      generation++; mode = 'UNAVAILABLE'; phase = 'BLOCKED'; proof = null;
      if (expiry !== null) cancel(expiry); expiry = null;
      // Revoke handles synchronously, before asynchronous channel teardown.
      let retiring;
      try { retiring = old?.dispose(); } catch (_) { teardownFailed = true; }
      try { clearViews(); } catch (_) { teardownFailed = true; reason = frozen({ code: 'SESSION_TEARDOWN_FAILED' }); } publish();
      const ticket = generation, identity = uid;
      queue = queue.catch(() => {}).then(async () => {
        try { await retiring; } catch (_) { teardownFailed = true; }
        if (disposed || ticket !== generation || uid !== identity) return;
        if (teardownFailed) { reason = frozen({ code: 'SESSION_TEARDOWN_FAILED' }); publish(); return; }
        if (!observation || next === 'UNAVAILABLE') return;
        if (now() - observation.at >= leaseMs) { reason = frozen({ code: 'PROTOCOL_EXPIRED' }); publish(); return; }
        mode = next; phase = 'STARTING'; setProof(observation);
        if (next === 'READ_ONLY') { phase = 'READY'; publish(); return; }
        const current = createSession(next);
        session = current;
        off = current.subscribe(() => { if (session === current && ticket === generation) publish(); });
        try { await current.startAuthenticated(identity); }
        catch (_) { if (session === current) { reason = frozen({ code: 'SESSION_START_FAILED' }); phase = 'BLOCKED'; } }
        if (session === current && ticket === generation) publish();
      });
      return queue;
    }
    function setProof(observation) {
      const at = observation.at; proof = { ...observation, at, until: at + leaseMs };
      if (expiry !== null) cancel(expiry);
      expiry = schedule(Math.max(0, proof.until - now()), () => {
        expiry = null;
        if (uid && !disposed && !fresh()) { reason = frozen({ code: 'PROTOCOL_EXPIRED' }); retire('UNAVAILABLE'); }
      });
    }
    function refresh(restart = false) {
      if (!uid || disposed) return Promise.resolve(getState());
      if (flight) return flight;
      if (poll !== null) cancel(poll); poll = null;
      const identity = uid, ticket = ++serial;
      let deadline;
      const request = Promise.race([
        Promise.resolve().then(() => readProtocol(identity)),
        new Promise((_, reject) => { deadline = schedule(timeoutMs, () => reject(new Error('PROTOCOL_TIMEOUT'))); })
      ]);
      const work = request.then(async value => {
        if (disposed || ticket !== serial || uid !== identity) return;
        const observation = { ...decode(value), at: now() };
        if (observation.floor < (floors.get(identity) || 0)) throw new TypeError('PROTOCOL_FLOOR_DOWNGRADE');
        floors.set(identity, observation.floor);
        reason = null;
        if (!fresh() || mode !== observation.mode || proof.epoch !== observation.epoch || restart) await retire(observation.mode, observation);
        else { setProof(observation); publish(); }
      }).catch(async () => {
        if (disposed || ticket !== serial || uid !== identity) return;
        reason = frozen({ code: 'PROTOCOL_UNAVAILABLE' }); await retire('UNAVAILABLE');
      }).finally(() => {
        cancel(deadline);
        if (flight === work) flight = null;
        if (!disposed && ticket === serial && uid === identity) poll = schedule(pollMs, () => { poll = null; refresh(); });
      }).then(getState);
      flight = work; return work;
    }
    const capture = () => frozen({ generation, mode: getState().mode, uid });
    const current = token => !!token && token.uid === uid && token.generation === generation && token.mode === getState().mode && fresh();
    function assertMode(expected) { if (!fresh() || mode !== expected || !session) throw new TypeError(expected === 'LEGACY' ? 'LEGACY_AUTHORITY_FORBIDDEN' : 'TARGET_AUTHORITY_FORBIDDEN'); }
    async function verify(expected) { await refresh(); assertMode(expected); if (getState().phase !== 'READY') throw new TypeError('SESSION_NOT_READY'); }
    async function dispatch(expected, fn) {
      const token = capture();
      try { await verify(expected); } catch (_) { return frozen({ outcome: 'NOT_READY', category: 'NOT_READY', code: 'PROTOCOL_UNAVAILABLE' }); }
      if (!current(token)) return frozen({ outcome: 'OBSOLETE', category: 'OBSOLETE', code: 'PROTOCOL_CONTEXT_CHANGED' });
      const owner = session, result = await fn(owner);
      return current(token) && owner === session ? result : frozen({ outcome: 'OBSOLETE', category: 'OBSOLETE' });
    }
    const api = {
      async startAuthenticated(identity) {
        serial++; flight = null; clearTimers(); uid = identity; reason = null;
        await retire('UNAVAILABLE'); return refresh();
      },
      refreshAuthenticated(identity) { return identity !== uid ? api.startAuthenticated(identity) : refresh(); },
      refresh: () => refresh(), retryStartup: () => refresh(true), requestRefresh: () => refresh().then(() => session?.requestRefresh()),
      invalidateAuth() { serial++; uid = null; flight = null; clearTimers(); phase = 'STOPPED'; return retire('UNAVAILABLE'); },
      isTarget: () => getState().mode === 'TARGET', assertLegacy: () => assertMode('LEGACY'), verifyLegacy: () => verify('LEGACY'),
      verifyTarget: () => verify('TARGET'), capture, current, getState,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      action(token, name, ...args) { if (!current(token)) return Promise.resolve(frozen({ outcome: 'OBSOLETE' })); return dispatch('TARGET', owner => owner.action(owner.capture(), name, ...args)); },
      match(token, name, ...args) { if (!current(token)) return Promise.resolve(frozen({ category: 'OBSOLETE' })); return dispatch('TARGET', owner => owner.match(owner.capture(), name, ...args)); },
      setObservedPerson(id) { assertMode('TARGET'); return session.setObservedPerson(id); },
      scheduleMatchedMovie: (...args) => dispatch('TARGET', owner => owner.scheduleMatchedMovie(...args)),
      closeScheduledMatch: (...args) => dispatch('TARGET', owner => owner.closeScheduledMatch(...args)),
      ownsCoordinator: owner => owner === session,
      dispose() { const pending = api.invalidateAuth(); disposed = true; listeners.clear(); return pending; }
    };
    return frozen(api);
  }
  return frozen({ create, decode });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ProtocolSession;
