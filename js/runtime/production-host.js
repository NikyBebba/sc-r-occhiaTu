'use strict';
// Dormant whole-session ownership. The future shell explicitly chooses a mode.
const ProductionHost = (() => {
  const cjs = typeof module !== 'undefined' && !!module.exports;
  if (!cjs && 'ProductionHost' in globalThis) throw new TypeError('ProductionHost namespace already installed');
  const Integration = cjs ? require('./target-integration-host') : (typeof TargetIntegrationHost !== 'undefined' ? TargetIntegrationHost : null);
  const Views = cjs ? require('./consumer-view-adapter') : (typeof ConsumerViewAdapter !== 'undefined' ? ConsumerViewAdapter : null);
  if (!Integration || !Views) throw new TypeError('ProductionHost requires TargetIntegrationHost and ConsumerViewAdapter');
  const frozen = Object.freeze;
  const unavailable = () => frozen({ kind: 'UNAVAILABLE', reason: 'NO_APPLICATION_SESSION' });
  const obsolete = () => frozen({ outcome: 'OBSOLETE', code: 'APPLICATION_SESSION_REPLACED' });
  const matchObsolete = () => frozen({ category: 'OBSOLETE', code: 'APPLICATION_SESSION_REPLACED' });
  const actions = ['addToMyList', 'removeFromMyList', 'recordSeen', 'removeSeen', 'recordPersonalViewing', 'setMyEvaluation', 'setMyRating', 'setMyPreference', 'setMyReview',
    'proposeToGroup', 'withdrawGroupCandidacy', 'setGroupEvaluation', 'setGroupRating', 'setGroupReview', 'scheduleNight', 'quickNight', 'confirmNight', 'cancelNight',
    'editNight', 'completeScheduled', 'completeNow', 'createContent', 'updateMetadata', 'deleteContent', 'setCinema', 'setSurprise', 'addVeto', 'removeVeto', 'retry'];
  const matchMethods = ['enter', 'leave', 'start', 'swipe', 'acknowledge', 'reconcile', 'close', 'retry'];
  function createProductionHost({ legacy, target, enqueue, labels = {} }) {
    if (!legacy || !['start', 'stop', 'refresh'].every(k => typeof legacy[k] === 'function') || typeof enqueue !== 'function') throw new TypeError('Injected lifecycle and deferred enqueue required');
    const legacyLifecycle = frozen({ start: legacy.start, stop: legacy.stop, refresh: legacy.refresh });
    const presentationLabels = frozen({ N: labels.N, V: labels.V });
    let current = null, generation = 0, phase = 'STOPPED', mode = null, disposed = false, notifying = false, scheduled = false, reason = null;
    let queue = Promise.resolve(), teardownFailed = false, installationGroup = null;
    const listeners = new Set();
    const mutable = () => { if (notifying) throw new TypeError('Host mutation during publication is forbidden'); if (disposed) throw new TypeError('Disposed ProductionHost'); };
    const active = s => !!s && !disposed && current === s && s.generation === generation;
    function publish() {
      if (disposed || scheduled) return;
      scheduled = true; let synchronous = true;
      enqueue(() => {
        if (synchronous) throw new TypeError('ProductionHost enqueue must defer');
        scheduled = false; if (disposed) return;
        const value = getState(); notifying = true;
        try { for (const listener of [...listeners]) if (listeners.has(listener)) { try { listener(value); } catch (_) { /* isolated */ } } }
        finally { notifying = false; }
      }); synchronous = false;
    }
    function sync(s) {
      if (!active(s) || s.mode !== 'TARGET' || !s.host) return;
      if (s.startFailure) { phase = 'BLOCKED'; reason = s.startFailure; return; }
      const state = s.host.getState();
      s.targetState = state;
      if (state.runtime.phase === 'READY' && state.context) {
        if (installationGroup === null) installationGroup = state.context.groupId;
        s.matchBlocked = state.context.groupId !== installationGroup;
      }
      if (s.bundle !== state.bundle) { s.bundle = state.bundle; s.view = Views.createConsumerView(state.bundle, { labels: presentationLabels }); }
      phase = state.runtime.phase === 'READY' ? 'READY' : state.runtime.phase === 'AUTH_INVALIDATING' ? 'AUTH_INVALIDATING'
        : state.runtime.phase === 'BLOCKED' ? 'BLOCKED' : ['STOPPED', 'DISPOSED'].includes(state.runtime.phase) ? 'STOPPED' : 'STARTING';
      reason = state.runtime.lastError;
    }
    const safelyInvoke = (s, match, fn) => {
      if (!active(s)) return Promise.resolve(match ? matchObsolete() : obsolete());
      let result;
      try { result = fn(); } catch (_) { return Promise.resolve(frozen(match ? { category: 'INVALID_INPUT', code: 'INVALID_OPERATION' } : { outcome: 'INVALID_INPUT', code: 'INVALID_OPERATION' })); }
      return Promise.resolve(result).then(value => active(s) ? value : match ? matchObsolete() : obsolete(), () => active(s) ? frozen(match ? { category: 'ERROR', code: 'OPERATION_FAILED' } : { outcome: 'ERROR', code: 'OPERATION_FAILED' }) : match ? matchObsolete() : obsolete());
    };
    function surfaces(s) {
      const actionAPI = {}, matchAPI = {};
      for (const name of actions) actionAPI[name] = (...args) => {
        if (!active(s)) return Promise.resolve(obsolete()); mutable(); sync(s);
        return safelyInvoke(s, false, () => s.targetState?.actions ? s.targetState.actions[name](...args) : frozen({ outcome: 'OBSOLETE', code: 'TARGET_CONTEXT_UNAVAILABLE' }));
      };
      for (const name of matchMethods) matchAPI[name] = (...args) => {
        if (!active(s)) return Promise.resolve(matchObsolete()); mutable(); sync(s);
        return safelyInvoke(s, true, () => s.targetState?.matchCommands && !s.matchBlocked ? s.targetState.matchCommands[name](...args) : frozen({ category: 'OBSOLETE', code: 'TARGET_CONTEXT_UNAVAILABLE' }));
      };
      s.actions = frozen(actionAPI); s.matchCommands = frozen(matchAPI);
    }
    async function retire(s) {
      if (!s) return;
      if (s.mode === 'TARGET') { if (s.unsubscribe) s.unsubscribe(); if (s.host) s.host.dispose(); }
      else await legacyLifecycle.stop(frozen({ generation: s.generation }));
    }
    function replaceAuthenticatedSession({ mode: selected, target: dependencies = target }) {
      mutable();
      if (!['LEGACY', 'TARGET'].includes(selected)) throw new TypeError('Explicit application session mode required');
      const old = current, id = ++generation;
      if (old?.mode === 'TARGET') old.cancelStart?.();
      current = null; mode = selected; phase = 'STARTING'; reason = null; publish();
      // Await a previous start before teardown. Async legacy startup cannot
      // finish after its cleanup and coexist with a replacement target session.
      const work = queue.then(async () => {
        try { await retire(old); if (teardownFailed) throw new Error('Prior teardown failed'); }
        catch (_) { teardownFailed = true; if (id === generation && !disposed) { phase = 'BLOCKED'; reason = frozen({ code: 'SESSION_TEARDOWN_FAILED' }); publish(); } return; }
        if (disposed || id !== generation) return;
        const s = { mode: selected, generation: id, host: null, unsubscribe: null, targetState: null, view: unavailable() };
        const cancelled = new Promise(resolve => { s.cancelStart = resolve; });
        current = s;
        try {
          if (selected === 'LEGACY') { await legacyLifecycle.start(frozen({ generation: id })); if (active(s)) phase = 'READY'; }
          else {
            s.host = Integration.createTargetIntegrationHost(dependencies); surfaces(s);
            s.unsubscribe = s.host.subscribe(() => { if (active(s)) { sync(s); publish(); } });
            await Promise.race([s.host.start(), cancelled]); sync(s);
          }
        } catch (_) {
          if (active(s)) {
            s.startFailure = frozen({ code: 'SESSION_START_FAILED' }); s.view = unavailable(); s.targetState = null;
            if (s.unsubscribe) s.unsubscribe();
            try { if (s.host) s.host.dispose(); } catch (_) { teardownFailed = true; }
            phase = 'BLOCKED'; reason = s.startFailure;
          }
        }
        if (active(s)) publish();
      });
      queue = work.catch(() => {});
      return work.then(getState);
    }
    function getState() {
      const s = current; if (s) sync(s);
      const t = s?.mode === 'TARGET' && !s.startFailure ? s.targetState : null;
      return frozen({ mode, phase: disposed ? 'DISPOSED' : phase, generation, reason,
        runtime: t?.runtime ?? null, context: t?.context ?? null, view: s?.view ?? unavailable(),
        actions: t?.actions ? s.actions : null, match: s?.matchBlocked ? frozen({ kind: 'UNAVAILABLE', reason: 'GROUP_REPLACEMENT_UNSUPPORTED' }) : t?.match ?? frozen({ kind: 'UNAVAILABLE', reason: 'NO_TARGET_CONTEXT' }), matchCommands: t?.matchCommands && !s.matchBlocked ? s.matchCommands : null });
    }
    function handoff(name, args) {
      mutable(); const s = current; if (s) sync(s);
      const result = safelyInvoke(s, true, () => s.mode === 'TARGET' && !s.matchBlocked ? s.host[name](...args) : matchObsolete());
      return name === 'scheduleMatchedMovie' ? result.then(value => Object.hasOwn(value, 'actionResult') ? value
        : frozen({ actionResult: frozen({ outcome: value.category, code: value.code }), closeTicket: null })) : result;
    }
    function stop(auth = false) {
      mutable(); const old = current; ++generation; current = null;
      phase = auth ? 'AUTH_INVALIDATING' : 'STOPPED'; reason = null; publish();
      // Target invalidation is synchronous, even if legacy teardown is queued.
      if (old?.mode === 'TARGET' && old.host) { old.cancelStart?.(); old.host.invalidateAuth(); }
      const work = queue.then(() => retire(old)); queue = work.catch(() => {});
      return work.then(getState, () => { teardownFailed = true; if (!disposed) { phase = 'BLOCKED'; reason = frozen({ code: 'SESSION_TEARDOWN_FAILED' }); publish(); } return getState(); });
    }
    return frozen({
      startLegacy: () => replaceAuthenticatedSession({ mode: 'LEGACY' }),
      startTarget: () => replaceAuthenticatedSession({ mode: 'TARGET' }), replaceAuthenticatedSession,
      setObservedPerson(personId) { mutable(); const s = current; if (!active(s) || s.mode !== 'TARGET' || !s.host) throw new TypeError('Target session required'); s.host.setObservedPerson(personId); sync(s); publish(); },
      requestRefresh() {
        mutable(); const s = current;
        if (!active(s)) return Promise.resolve(obsolete());
        return safelyInvoke(s, false, () => s.mode === 'TARGET' ? s.host.requestRefresh() : Promise.resolve(legacyLifecycle.refresh(frozen({ generation: s.generation }))).then(() => frozen({ outcome: 'LEGACY_REFRESHED' })));
      },
      scheduleMatchedMovie: (...args) => handoff('scheduleMatchedMovie', args),
      closeScheduledMatch: (...args) => handoff('closeScheduledMatch', args),
      getState,
      subscribe(listener) { mutable(); if (typeof listener !== 'function') throw new TypeError('Listener required'); listeners.add(listener); return () => listeners.delete(listener); },
      invalidateAuth: () => stop(true), stop: () => stop(false),
      dispose() { if (disposed) return Promise.resolve(); mutable(); const work = stop(); disposed = true; listeners.clear(); return work; }
    });
  }
  return frozen({ createProductionHost });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ProductionHost;
