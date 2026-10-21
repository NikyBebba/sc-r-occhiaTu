'use strict';
// Dormant composition only. Session verification, RPC, source readiness, clocks,
// cache storage and microtask enqueue are supplied by the future host runtime.
const TargetRuntime = (() => {
  const commonJS = typeof module !== 'undefined' && !!module.exports;
  if (!commonJS && 'TargetRuntime' in globalThis) throw new TypeError('TargetRuntime namespace already installed');
  const Core = commonJS ? require('../snapshot/core') : (typeof SnapshotCore !== 'undefined' ? SnapshotCore : null);
  const Transport = commonJS ? require('../snapshot/transport') : (typeof SnapshotTransport !== 'undefined' ? SnapshotTransport : null);
  const Controller = commonJS ? require('../snapshot/controller') : (typeof SnapshotController !== 'undefined' ? SnapshotController : null);
  const Invalidation = commonJS ? require('../snapshot/invalidation') : (typeof SnapshotInvalidation !== 'undefined' ? SnapshotInvalidation : null);
  if (!Core || typeof Core.getExpectedRevision !== 'function') throw new TypeError('TargetRuntime requires SnapshotCore');
  if (!Transport || typeof Transport.prepareCommand !== 'function') throw new TypeError('TargetRuntime requires SnapshotTransport');
  if (!Controller || typeof Controller.createShadowController !== 'function') throw new TypeError('TargetRuntime requires SnapshotController');
  if (!Invalidation || typeof Invalidation.createRealtimeInvalidationAdapter !== 'function') throw new TypeError('TargetRuntime requires SnapshotInvalidation');
  const frozen = Object.freeze;
  const result = (category, code) => frozen({ category, code });
  const same = (a, b) => a && b && ['callerId', 'groupId', 'contractVersion', 'contextEpoch'].every(k => a[k] === b[k]);
  function createTargetRuntime({ auth, rpc, clock, scheduler, storage = null, subscribeInvalidation, enqueue, observerRequestId }) {
    if (typeof auth?.getVerifiedIdentity !== 'function' || typeof rpc !== 'function' || typeof subscribeInvalidation !== 'function' ||
      typeof enqueue !== 'function' || !Core.validateUUID(observerRequestId).ok) throw new TypeError('Explicit target dependencies required');
    let phase = 'UNINITIALIZED', generation = 0, current = null, disposed = false, notifying = false, inControllerPublication = false, lastError = null;
    const listeners = new Set(), bindings = new Map(), commands = new WeakMap();
    const active = scope => !!scope && !disposed && current === scope && scope.enabled;
    const assertMutable = () => { if (notifying) throw new TypeError('Runtime mutation during publication is forbidden'); };
    const defer = fn => {
      let synchronous = true;
      try { enqueue(() => { if (synchronous) throw new TypeError('enqueue must defer'); fn(); }); }
      finally { synchronous = false; }
    };
    // One controller for the entire runtime lifetime. Its physical-flight map
    // survives context replacement, including a same-identity new epoch.
    const controller = Controller.createShadowController({ clock, scheduler, storage,
      provider: { async read(metadata) {
        const scope = bindings.get(metadata.contextEpoch);
        if (!scope || !active(scope)) throw new TypeError('Obsolete provider context');
        try { return await scope.provider.read(metadata); }
        catch (e) {
          if (active(scope) && e?.category === 'AUTH_INVALIDATING') lose(scope, 'AUTH_INVALIDATING', 'AUTH_INVALIDATING');
          else if (active(scope) && e?.category === 'SERVER_CONTRACT_ERROR') lose(scope, 'BLOCKED', 'SNAPSHOT_TRANSPORT_CONTRACT_ERROR');
          throw e;
        }
      } }
    });
    function getState() {
      return frozen({ phase, generation, bootstrap: active(current) ? current.bootstrap?.bootstrap ?? null : null,
        controllerState: controller.getState(), lastError });
    }
    function emit(type, contextEpoch = controller.getState().context?.contextEpoch ?? generation) {
      if (disposed) return;
      const event = frozen({ type, contextEpoch, generation, state: getState() });
      const pass = [...listeners]; notifying = true;
      try { for (const registration of pass) if (listeners.has(registration)) {
        try { registration.listener(event); } catch (_) { /* Observer cannot undo committed state. */ }
      } } finally { notifying = false; }
    }
    function detach(scope) {
      if (!scope) return;
      scope.enabled = false; bindings.delete(scope.epoch);
      if (scope.invalidation) { scope.invalidation.dispose(); scope.invalidation = null; }
    }
    function lose(scope, nextPhase, code) {
      if (!active(scope)) return;
      detach(scope); phase = nextPhase; lastError = result(nextPhase, code);
      const clear = () => { if (current === scope && !scope.enabled && !disposed) controller.clearContext(code); };
      // Snapshot auth errors already cleared the sensitive view. Defer only the
      // cleanup that would otherwise reenter the controller publication pass.
      if (inControllerPublication) defer(clear); else clear();
      emit('LIFECYCLE_CHANGED');
    }
    const unobserve = controller.subscribe(event => {
      inControllerPublication = true;
      try {
        const state = event.state;
        if (active(current)) {
          if (state.status === 'AUTH_INVALID') lose(current, 'AUTH_INVALIDATING', 'SNAPSHOT_AUTH_INVALID');
          else if (state.status === 'CONTEXT_INVALID') lose(current, 'BLOCKED', 'SNAPSHOT_CONTEXT_INVALID');
          else if (event.type === 'VIEW_COMMITTED' && state.view?.source === 'ONLINE') phase = 'READY';
        }
        emit(event.type, event.contextEpoch);
      } finally { inControllerPublication = false; }
    });
    function reset(nextPhase, code = null) {
      detach(current); current = null;
      generation++;
      if (!Number.isSafeInteger(generation)) throw new RangeError('Runtime epoch exhausted');
      phase = nextPhase; lastError = code === null ? null : result(nextPhase, code);
      controller.clearContext(nextPhase); emit('LIFECYCLE_CHANGED');
    }
    async function begin() {
      reset('BOOTSTRAPPING');
      const scope = { enabled: true, epoch: generation, bootstrap: null, provider: null, transport: null, invalidation: null };
      current = scope;
      let identity;
      try { identity = await auth.getVerifiedIdentity(); }
      catch (_) {
        if (!active(scope)) return result('OBSOLETE', 'CONTEXT_CHANGED');
        lose(scope, 'BLOCKED', 'SESSION_VERIFICATION_UNAVAILABLE'); return result('BLOCKED', 'SESSION_VERIFICATION_UNAVAILABLE');
      }
      if (!active(scope)) return result('OBSOLETE', 'CONTEXT_CHANGED');
      const descriptor = identity && typeof identity === 'object' ? Object.getOwnPropertyDescriptor(identity, 'callerId') : null;
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Core.validateUUID(descriptor.value).ok) {
        lose(scope, 'AUTH_INVALIDATING', 'VERIFIED_IDENTITY_REQUIRED'); return result('AUTH_INVALIDATING', 'VERIFIED_IDENTITY_REQUIRED');
      }
      scope.transport = Transport.createTransport({ rpc: (name, args) => {
        if (!active(scope)) throw new TypeError('Obsolete RPC context');
        return rpc(name, args);
      } });
      const bootstrap = await scope.transport.bootstrap({ callerId: descriptor.value });
      if (!active(scope)) return result('OBSOLETE', 'CONTEXT_CHANGED');
      if (bootstrap.category !== 'BOOTSTRAP_RESULT') {
        lose(scope, bootstrap.category === 'AUTH_INVALIDATING' ? 'AUTH_INVALIDATING' : 'BLOCKED', bootstrap.code);
        return bootstrap;
      }
      if (!bootstrap.bootstrap.runtime.activation_allowed) {
        lose(scope, 'BLOCKED', 'TARGET_NOT_ACTIVE'); return result('BLOCKED', 'TARGET_NOT_ACTIVE');
      }
      scope.bootstrap = bootstrap; scope.provider = scope.transport.createSnapshotProvider(bootstrap);
      bindings.set(scope.epoch, scope); phase = 'STARTING';
      const context = controller.setContext({ callerId: bootstrap.bootstrap.caller.person_id,
        groupId: bootstrap.bootstrap.selected_group.group_id, contractVersion: bootstrap.bootstrap.protocol.snapshot_contract_version, contextEpoch: scope.epoch });
      // Controller may advance its epoch beyond a previous externally cleared
      // context. Route providers by its returned context, never guessed epochs.
      bindings.delete(scope.epoch); scope.epoch = context.contextEpoch; bindings.set(scope.epoch, scope);
      scope.context = context;
      try {
        scope.invalidation = Invalidation.createRealtimeInvalidationAdapter({ controller, subscribe: subscribeInvalidation,
          enqueue, requestId: observerRequestId });
      } catch (_) {
        lose(scope, 'BLOCKED', 'INVALIDATION_UNAVAILABLE'); return result('BLOCKED', 'INVALIDATION_UNAVAILABLE');
      }
      if (!active(scope)) return result('OBSOLETE', 'CONTEXT_CHANGED');
      controller.requestRefresh('INITIAL'); emit('LIFECYCLE_CHANGED');
      return result('STARTED', 'AWAITING_ONLINE_SNAPSHOT');
    }
    function writable(scope) {
      const state = controller.getState();
      return active(scope) && phase === 'READY' && state.view?.source === 'ONLINE' && same(state.context, scope.context) &&
        !['AUTH_INVALID', 'CONTEXT_INVALID', 'CONTRACT_INVALID'].includes(state.status);
    }
    function requireAffected(entries, requestId) {
      if (!entries.length) return;
      const state = controller.getState(), expansion = [], ordinary = [];
      for (const entry of entries) {
        const known = state.view ? Core.getExpectedRevision(state.view.root, entry.scope_kind, entry.scope_id, entry.entity_id) : { kind: 'OUT_OF_COVERAGE' };
        (['OUT_OF_COVERAGE', 'UNAVAILABLE'].includes(known.kind) ? expansion : ordinary).push(entry);
      }
      if (expansion.length) controller.requireVersions({ requestId, affectedVersions: expansion }, { coverageExpansion: true });
      if (ordinary.length) controller.requireVersions({ requestId, affectedVersions: ordinary });
    }
    function send(record) {
      if (record.inFlight) return record.inFlight;
      record.inFlight = (async () => {
        const received = await record.scope.transport.execute(record.prepared);
        if (!active(record.scope)) return result('OBSOLETE', 'CONTEXT_CHANGED');
        record.last = received;
        if (received.category === 'AUTH_INVALIDATING') lose(record.scope, 'AUTH_INVALIDATING', received.code);
        else if (received.category === 'SERVER_CONTRACT_ERROR') lose(record.scope, 'BLOCKED', received.code);
        else if (received.category === 'TRANSPORT_UNCERTAIN') controller.requestRefresh('COMMAND');
        else if (received.category === 'SEMANTIC_RESULT') {
          const response = received.response;
          if (['SUCCESS', 'ALREADY_IN_TARGET_STATE'].includes(response.outcome)) requireAffected(response.affected_versions, record.prepared.request.request_id);
          else if (response.outcome === 'STALE') controller.requestRefresh('COMMAND');
          else if (response.outcome === 'ERROR') {
            if (['UNAUTHENTICATED', 'MEMBERSHIP_REQUIRED'].includes(response.error.code)) lose(record.scope, 'AUTH_INVALIDATING', response.error.code);
            else if (['NO_ACTIVE_GROUP', 'INVALID_GROUP', 'UNSUPPORTED_GROUP', 'MAINTENANCE', 'PROTOCOL_UNSUPPORTED'].includes(response.error.code)) lose(record.scope, 'BLOCKED', response.error.code);
          }
        }
        return frozen({ ...received, command: record.handle });
      })().finally(() => { record.inFlight = null; });
      return record.inFlight;
    }
    return frozen({
      getState,
      subscribe(listener) {
        if (disposed || typeof listener !== 'function') throw new TypeError('Active runtime listener required');
        const registration = { listener }; listeners.add(registration); return () => listeners.delete(registration);
      },
      start() {
        assertMutable(); if (disposed) throw new TypeError('Disposed runtime');
        return begin();
      },
      requestRefresh(reason = 'MANUAL') { assertMutable(); return active(current) ? controller.requestRefresh(reason) : null; },
      executeIntent({ requestId, intent, target, expectedVersions, parameters }) {
        assertMutable(); const scope = current;
        if (!writable(scope)) return Promise.resolve(result('NOT_READY', 'ONLINE_TARGET_REQUIRED'));
        const prepared = Transport.prepareCommand({ protocol_version: 1, request_id: requestId, intent,
          target, expected_versions: expectedVersions, parameters }, scope.context);
        const handle = frozen({ requestId: prepared.request.request_id });
        const record = { scope, prepared, handle, last: null, inFlight: null }; commands.set(handle, record);
        return send(record);
      },
      retryCommand(handle) {
        assertMutable(); const record = commands.get(handle);
        if (!record) throw new TypeError('Owned prepared command handle required');
        if (!writable(record.scope)) return Promise.resolve(result('OBSOLETE', 'CONTEXT_CHANGED'));
        if (record.inFlight) return record.inFlight;
        if (record.last?.category !== 'TRANSPORT_UNCERTAIN') return Promise.resolve(result('RETRY_NOT_ALLOWED', 'EXPLICIT_NEW_DECISION_REQUIRED'));
        return send(record);
      },
      getRecommendationInput(options) { const view = controller.getState().view; return active(current) && view ? view.projection.getRecommendationInput(options) : null; },
      getMatchInputs() { const view = controller.getState().view; return active(current) && view ? view.projection.getMatchInputs() : null; },
      invalidateAuth() { assertMutable(); if (active(current)) lose(current, 'AUTH_INVALIDATING', 'SESSION_INVALIDATED'); },
      stop() { assertMutable(); if (!disposed) reset('STOPPED'); },
      dispose() {
        assertMutable(); if (disposed) return;
        reset('DISPOSED'); disposed = true; controller.dispose(); unobserve(); listeners.clear();
      }
    });
  }
  return frozen({ createTargetRuntime });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TargetRuntime;
