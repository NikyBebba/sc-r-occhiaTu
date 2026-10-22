'use strict';
// Dormant lifecycle composition. Domain outputs are references to committed
// immutable child outputs; command results never replace the consumer bundle.
const TargetIntegrationHost = (() => {
  const cjs = typeof module !== 'undefined' && !!module.exports;
  if (!cjs && 'TargetIntegrationHost' in globalThis) throw new TypeError('TargetIntegrationHost namespace already installed');
  const Runtime = cjs ? require('./target-runtime') : (typeof TargetRuntime !== 'undefined' ? TargetRuntime : null);
  const Facade = cjs ? require('./consumer-facade') : (typeof ConsumerFacade !== 'undefined' ? ConsumerFacade : null);
  const Actions = cjs ? require('./action-adapter') : (typeof ActionAdapter !== 'undefined' ? ActionAdapter : null);
  const Match = cjs ? require('./match-adapter') : (typeof MatchAdapter !== 'undefined' ? MatchAdapter : null);
  if (!Runtime || !Facade || !Actions || !Match) throw new TypeError('TargetIntegrationHost requires all four target boundaries');
  const freeze = Object.freeze;
  const unavailableMatch = reason => freeze({ kind: 'UNAVAILABLE', reason });
  const actionError = code => freeze({ outcome: 'OBSOLETE', code });
  const matchError = code => freeze({ category: 'OBSOLETE', code });
  const key = r => {
    const c = r.controllerState.context;
    return c ? [r.generation, c.callerId, c.groupId, c.contextEpoch, c.contractVersion].join('|') : null;
  };
  const methods = ['addToMyList', 'removeFromMyList', 'recordSeen', 'removeSeen', 'recordPersonalViewing',
    'setMyEvaluation', 'setMyRating', 'setMyPreference', 'setMyReview', 'proposeToGroup', 'withdrawGroupCandidacy',
    'setGroupEvaluation', 'setGroupRating', 'setGroupReview', 'scheduleNight', 'quickNight', 'confirmNight', 'cancelNight',
    'editNight', 'completeScheduled', 'completeNow', 'createContent', 'updateMetadata', 'deleteContent', 'setCinema', 'setSurprise', 'addVeto', 'removeVeto'];
  function createTargetIntegrationHost({ runtime: runtimeDependencies, match: matchDependencies, newRequestId, enqueue }) {
    if (!runtimeDependencies || !matchDependencies || typeof newRequestId !== 'function' || typeof enqueue !== 'function') throw new TypeError('Explicit integration dependencies required');
    for (const k of ['executeMatchAction', 'readLatestMatchState', 'subscribeRealtime', 'subscribePresence', 'newSeed', 'nowInstant'])
      if (typeof matchDependencies[k] !== 'function') throw new TypeError('Explicit Match dependencies required');
    const runtime = Runtime.createTargetRuntime(runtimeDependencies);
    let current = null, observedPersonId = null, disposed = false, notifying = false, scheduled = false, installationGroup = null;
    let runtimeState = runtime.getState(), bundle = Facade.createConsumerBundle(runtimeState);
    let bundleController = runtimeState.controllerState, bundlePhase = runtimeState.phase, bundleObserved = null;
    const listeners = new Set(), matchTokens = new WeakMap(), tickets = new WeakMap();
    const mutable = () => { if (notifying) throw new TypeError('Host mutation during publication is forbidden'); };
    const active = s => !disposed && !!s && current === s && s.enabled && key(runtime.getState()) === s.key;
    const lostAuth = s => !disposed && runtime.getState().generation === s.generation && runtime.getState().phase === 'AUTH_INVALIDATING';
    const actionResult = (s, value) => active(s) ? value : lostAuth(s) ? freeze({ outcome: 'AUTH_INVALIDATING', code: 'RUNTIME_AUTH_INVALID' }) : actionError('CONTEXT_CHANGED');
    const matchResult = (s, value) => active(s) ? value : lostAuth(s) ? freeze({ category: 'AUTH_INVALIDATING', code: 'RUNTIME_AUTH_INVALID' }) : matchError('CONTEXT_CHANGED');
    function defer(fn) {
      let synchronous = true;
      enqueue(() => { if (synchronous) throw new TypeError('Host enqueue must defer'); fn(); }); synchronous = false;
    }
    function publishLater() {
      if (disposed || scheduled) return;
      scheduled = true;
      defer(() => {
        scheduled = false; if (disposed) return;
        const state = getState(); notifying = true;
        try { for (const f of [...listeners]) if (listeners.has(f)) { try { f(state); } catch (_) { /* isolated consumer */ } } }
        finally { notifying = false; }
      });
    }
    function retire() {
      const old = current; current = null;
      if (!old) return;
      old.enabled = false; old.actions.dispose();
      if (old.match) { old.unmatch(); old.match.dispose(); }
      old.runtimeObservers.clear();
    }
    function collectMatch(s) {
      if (!s.match) return unavailableMatch(s.matchReason);
      const value = s.match.getState();
      if (value.derived?.pendingMatch) matchTokens.set(value.derived.pendingMatch, s);
      return value;
    }
    function invoke(s, name, args) {
      mutable(); sync();
      if (!active(s)) return Promise.resolve(actionError('CONTEXT_CHANGED'));
      let pending;
      try { pending = s.actions[name](s.actions.captureContext(), ...args); }
      catch (_) { return Promise.resolve(actionError('COMMITTED_CONTEXT_REQUIRED')); }
      return Promise.resolve(pending).then(result => actionResult(s, result));
    }
    function buildSession() {
      const s = { key: key(runtimeState), generation: runtimeState.generation, enabled: true, bundle, actions: Actions.createActionAdapter({ runtime, newRequestId }),
        match: null, unmatch: null, matchReason: 'ONLINE_TARGET_REQUIRED', runtimeObservers: new Set() };
      const actionAPI = {};
      for (const name of methods) actionAPI[name] = (...args) => invoke(s, name, args);
      actionAPI.retry = handle => {
        mutable(); sync(); if (!active(s)) return Promise.resolve(actionError('CONTEXT_CHANGED'));
        return s.actions.retry(handle).then(result => actionResult(s, result));
      };
      s.actionAPI = freeze(actionAPI); return s;
    }
    function ensureMatch(s) {
      if (s.match || runtimeState.phase !== 'READY' || runtimeState.controllerState.view?.source !== 'ONLINE') return;
      if (installationGroup !== null && installationGroup !== bundle.context.groupId) { s.matchReason = 'GROUP_REPLACEMENT_UNSUPPORTED'; return; }
      installationGroup = bundle.context.groupId;
      s.match = Match.createMatchAdapter({ ...matchDependencies, enqueue,
        getRuntimeState: () => runtime.getState(), getConsumerBundle: () => s.bundle,
        subscribeRuntime: f => { s.runtimeObservers.add(f); return () => s.runtimeObservers.delete(f); },
        onAuthInvalidating: () => { if (active(s)) runtime.invalidateAuth(); }
      });
      s.unmatch = s.match.subscribe(() => { if (active(s)) publishLater(); });
      const api = {};
      for (const name of ['enter', 'leave', 'start', 'swipe', 'acknowledge', 'reconcile', 'close', 'retry']) api[name] = (...args) => {
        mutable(); sync(); if (!active(s)) return Promise.resolve(matchError('CONTEXT_CHANGED'));
        return Promise.resolve(s.match[name](...args)).then(result => matchResult(s, result));
      };
      s.matchAPI = freeze(api);
    }
    function sync() {
      if (disposed) return;
      runtimeState = runtime.getState();
      const contextKey = key(runtimeState), view = runtimeState.controllerState.view;
      // The runtime's existing invalid controller statuses cannot authorize
      // target execution. Do not leave a separate Match command surface alive.
      const usable = ['STARTING', 'READY'].includes(runtimeState.phase) && !['AUTH_INVALID', 'CONTEXT_INVALID', 'CONTRACT_INVALID'].includes(runtimeState.controllerState.status);
      if (current && (current.key !== contextKey || !view || !usable)) { retire(); observedPersonId = null; }
      if (bundleController !== runtimeState.controllerState || bundlePhase !== runtimeState.phase || bundleObserved !== observedPersonId) {
        bundle = usable ? Facade.createConsumerBundle(runtimeState, { observedPersonId }) : freeze({ kind: 'UNAVAILABLE', reason: 'NO_TARGET_CONTEXT' });
        bundleController = runtimeState.controllerState; bundlePhase = runtimeState.phase; bundleObserved = observedPersonId;
      }
      if (bundle.kind === 'AVAILABLE' && usable) {
        if (!current) current = buildSession();
        current.bundle = bundle; ensureMatch(current);
      }
    }
    const unobserve = runtime.subscribe(event => {
      sync();
      if (current) for (const f of [...current.runtimeObservers]) { try { f(event); } catch (_) { /* Match owns its own failure result */ } }
      publishLater();
    });
    function getState() {
      sync();
      const c = runtimeState.controllerState;
      return freeze({ runtime: freeze({ phase: runtimeState.phase, generation: runtimeState.generation,
        context: current ? c.context : null, controllerStatus: c.status, source: current ? c.view?.source ?? null : null,
        freshness: c.freshness, pending: c.pending, lastError: runtimeState.lastError }), bundle, context: current ? bundle.context : null,
        actions: current?.actionAPI ?? null, match: current ? collectMatch(current) : unavailableMatch('NO_TARGET_CONTEXT'),
        matchCommands: current?.matchAPI ?? null });
    }
    return freeze({
      start() { mutable(); if (disposed) throw new TypeError('Disposed host'); return runtime.start(); },
      replaceContext() { mutable(); if (disposed) throw new TypeError('Disposed host'); return runtime.start(); },
      requestRefresh() { mutable(); if (!disposed) return runtime.requestRefresh(); },
      invalidateAuth() { mutable(); if (!disposed) runtime.invalidateAuth(); },
      setObservedPerson(personId) {
        mutable(); if (disposed) throw new TypeError('Disposed host');
        // Facade validates the UUID and preserves unavailable personal coverage.
        Facade.createConsumerBundle(runtime.getState(), { observedPersonId: personId });
        observedPersonId = personId; sync(); publishLater();
      },
      scheduleMatchedMovie(token, input, mode = 'schedule') {
        mutable(); sync(); const s = current;
        if (!active(s) || matchTokens.get(token) !== s) return Promise.resolve(freeze({ actionResult: actionError('OWNED_MATCH_OBSERVATION_REQUIRED'), closeTicket: null }));
        const m = s.match.getState(), pending = m.derived?.pendingMatch;
        if (!pending || pending.session_id !== token.session_id || pending.matched_movie_id !== token.matched_movie_id || !['schedule', 'quick'].includes(mode))
          return Promise.resolve(freeze({ actionResult: actionError('STALE_MATCH_OBSERVATION'), closeTicket: null }));
        const observedSession = m.observedSession, priorView = runtimeState.controllerState.view;
        return invoke(s, mode === 'schedule' ? 'scheduleNight' : 'quickNight', [token.matched_movie_id, input]).then(actionResult => {
          if (!active(s) || !['SUCCESS', 'ALREADY_IN_TARGET_STATE'].includes(actionResult.outcome) || !actionResult.result?.night_id)
            return freeze({ actionResult, closeTicket: null });
          const ticket = freeze({});
          tickets.set(ticket, { session: s, observedSession, movieId: token.matched_movie_id, nightId: actionResult.result.night_id, priorView });
          return freeze({ actionResult, closeTicket: ticket });
        });
      },
      closeScheduledMatch(ticket) {
        mutable(); sync(); const t = tickets.get(ticket);
        if (!t || !active(t.session)) return Promise.resolve(matchError('CONTEXT_CHANGED'));
        const view = runtimeState.controllerState.view;
        const event = bundle.kind === 'AVAILABLE' && bundle.group.scheduledEvents.find(x => x.event.night_id === t.nightId && x.event.movie_id === t.movieId);
        if (!view || view.source !== 'ONLINE' || view === t.priorView || runtimeState.controllerState.pending.thresholds !== null || !event)
          return Promise.resolve(freeze({ category: 'INVALID_INPUT', code: 'SCHEDULE_SNAPSHOT_REQUIRED' }));
        return t.session.match.close(t.observedSession).then(result => matchResult(t.session, result));
      },
      getState,
      subscribe(listener) {
        mutable(); if (disposed || typeof listener !== 'function') throw new TypeError('Active host listener required');
        listeners.add(listener); return () => listeners.delete(listener);
      },
      stop() { mutable(); if (!disposed) { retire(); runtime.stop(); sync(); publishLater(); } },
      dispose() {
        mutable(); if (disposed) return;
        retire(); unobserve(); runtime.dispose(); runtimeState = runtime.getState(); bundle = Facade.createConsumerBundle(runtimeState);
        observedPersonId = null; disposed = true; listeners.clear();
      }
    });
  }
  return freeze({ createTargetIntegrationHost });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TargetIntegrationHost;
