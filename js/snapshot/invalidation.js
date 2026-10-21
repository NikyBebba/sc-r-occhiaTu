'use strict';
// Dormant invalidation only. No SDK, state projection, clock, or fetch ownership.
const SnapshotInvalidation = (() => {
  const commonJS = typeof module !== 'undefined' && !!module.exports;
  if (!commonJS && 'SnapshotInvalidation' in globalThis) throw new TypeError('SnapshotInvalidation namespace already installed');
  const Core = commonJS ? require('./core') : (typeof SnapshotCore !== 'undefined' ? SnapshotCore : null);
  if (!Core || typeof Core.getExpectedRevision !== 'function') throw new TypeError('SnapshotInvalidation requires SnapshotCore');
  const events = new WeakSet();
  const kinds = ['content', 'person_film', 'group_film', 'night'];
  const keys = ['scope_kind', 'scope_id', 'entity_id', 'version', 'tombstone'];
  const key = t => t.scope_kind + '|' + t.scope_id + '|' + t.entity_id;
  const same = (a, b) => a && b && ['callerId', 'groupId', 'contractVersion', 'contextEpoch'].every(k => a[k] === b[k]);
  function normalizeVersionEvent(row, context) {
    const checked = Core.createContext(context);
    if (!checked.ok || row === null || typeof row !== 'object' || Array.isArray(row) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(row)) || Reflect.ownKeys(row).length !== keys.length)
      throw new TypeError('Exact version event/context required');
    const owned = {};
    for (const k of keys) {
      const d = Object.getOwnPropertyDescriptor(row, k);
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('Own event data properties required');
      owned[k] = d.value;
    }
    if (!kinds.includes(owned.scope_kind) || !Core.validateUUID(owned.scope_id).ok || !Core.validateUUID(owned.entity_id).ok ||
      typeof owned.version !== 'string' || !Core.validateNonNegativeDecimal(owned.version).ok || typeof owned.tombstone !== 'boolean' ||
      (owned.scope_kind === 'content' && owned.scope_id !== owned.entity_id)) throw new TypeError('Invalid version event');
    const event = Object.freeze({ ...owned, context: checked.value });
    events.add(event); return event;
  }
  function createInvalidationPolicy({ controller, enqueue, requestId }) {
    if (!controller || !['getState', 'requireVersions', 'requestRefresh'].every(k => typeof controller[k] === 'function') ||
      typeof enqueue !== 'function' || !Core.validateUUID(requestId).ok) throw new TypeError('Injected controller, deferred enqueue and observer UUID required');
    const checked = Core.createContext(controller.getState().context);
    if (!checked.ok) throw new TypeError('Active verified context required');
    const context = checked.value;
    // Only a short-lived burst buffer. Durable pending thresholds belong to the
    // controller; there is no independent committed vector or retry scheduler.
    const queued = new Map();
    let disposed = false, scheduled = false, ready = false, everReady = false, revalidate = null;
    const counts = { accepted: 0, ignoredVersion: 0, irrelevant: 0, submissions: 0, revalidations: 0, dispatchFailures: 0 };
    function active() {
      const state = controller.getState();
      return !disposed && same(state.context, context) && !['AUTH_INVALID', 'CONTEXT_INVALID'].includes(state.status);
    }
    const relevant = e => e.scope_kind === 'content' || e.scope_id === (e.scope_kind === 'person_film' ? context.callerId : context.groupId);
    function classify(e, state, pending) {
      if (!relevant(e)) return 'IRRELEVANT';
      const threshold = pending.get(key(e));
      if (threshold !== undefined && Core.compareDecimals(e.version, threshold) <= 0) return 'KNOWN';
      const root = state.view?.root;
      if (!root) return 'EXPANSION';
      const revision = Core.getExpectedRevision(root, e.scope_kind, e.scope_id, e.entity_id);
      // CACHE is last-known data, never proof of online threshold satisfaction.
      if (state.view.source === 'ONLINE' && ['AVAILABLE', 'TOMBSTONED', 'DEFAULT_ZERO'].includes(revision.kind) &&
        Core.compareDecimals(e.version, revision.version) <= 0) return 'KNOWN';
      return ['OUT_OF_COVERAGE', 'UNAVAILABLE'].includes(revision.kind) ? 'EXPANSION' : 'ORDINARY';
    }
    const pendingOf = state => new Map((state.pending.thresholds?.entries || []).map(t => [key(t), t.minimum_version]));
    function put(e) {
      const prior = queued.get(key(e));
      if (!prior || Core.compareDecimals(e.version, prior.version) > 0) queued.set(key(e), e);
    }
    function flush() {
      scheduled = false;
      if (!active()) { queued.clear(); revalidate = null; return; }
      const state = controller.getState(), pending = pendingOf(state), ordinary = [], expansion = [];
      const batch = [...queued.values()].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
      queued.clear(); const reason = revalidate; revalidate = null;
      for (const e of batch) {
        const classification = classify(e, state, pending);
        if (classification === 'KNOWN') { counts.ignoredVersion++; continue; }
        if (classification === 'IRRELEVANT') { counts.irrelevant++; continue; }
        const entry = Object.freeze({ scope_kind: e.scope_kind, scope_id: e.scope_id, entity_id: e.entity_id, version: e.version });
        (classification === 'EXPANSION' ? expansion : ordinary).push(entry);
      }
      try {
        // At most two batched calls. The controller owns physical single-flight
        // and dirty follow-up; the adapter never starts a provider read itself.
        if (expansion.length && active()) { controller.requireVersions({ requestId, affectedVersions: expansion }, { coverageExpansion: true }); counts.submissions++; }
        if (ordinary.length && active()) { controller.requireVersions({ requestId, affectedVersions: ordinary }); counts.submissions++; }
        if (reason && !ordinary.length && !expansion.length && active()) { controller.requestRefresh(reason); counts.revalidations++; }
      } catch (_) {
        counts.dispatchFailures++;
        // No retry loop. Retain the undispatched batch for a later explicit
        // lifecycle/event trigger; already-submitted entries dedupe via Core.
        if (active()) { for (const e of batch) put(e); revalidate = reason; }
      }
    }
    function schedule() {
      if (scheduled || !active()) return;
      scheduled = true; let synchronous = true;
      try { enqueue(() => { if (synchronous) throw new TypeError('enqueue must defer'); flush(); }); }
      catch (e) { scheduled = false; throw e; }
      finally { synchronous = false; }
    }
    return Object.freeze({
      context,
      isActive: active,
      accept(event) {
        if (!active()) return 'INACTIVE';
        if (!events.has(event)) throw new TypeError('Normalized owned event required');
        if (!same(event.context, context)) return 'INACTIVE';
        const state = controller.getState(), classification = classify(event, state, pendingOf(state));
        if (classification === 'IRRELEVANT') { counts.irrelevant++; return 'IRRELEVANT'; }
        if (classification === 'KNOWN') { counts.ignoredVersion++; return 'KNOWN'; }
        const prior = queued.get(key(event));
        if (prior && Core.compareDecimals(event.version, prior.version) <= 0) { counts.ignoredVersion++; return 'KNOWN'; }
        put(event); counts.accepted++; schedule(); return 'QUEUED';
      },
      ready() {
        if (!active() || ready) return;
        ready = true; revalidate = everReady ? 'RECONNECT' : 'INVALIDATION'; everReady = true; schedule();
      },
      disconnected() { if (active()) ready = false; },
      dispose() { disposed = true; queued.clear(); revalidate = null; },
      getDiagnostics: () => Object.freeze({ ...counts, queued: queued.size, ready, disposed })
    });
  }
  function createRealtimeInvalidationAdapter({ controller, subscribe, enqueue, requestId }) {
    // subscribe owns the external channel. onReady means change-source readiness,
    // not merely WebSocket SUBSCRIBED; it must recur after source reconnection.
    // Even this readiness is not freshness: policy always revalidates Snapshot.
    if (typeof subscribe !== 'function' || typeof controller?.subscribe !== 'function') throw new TypeError('Injected subscription boundaries required');
    const policy = createInvalidationPolicy({ controller, enqueue, requestId });
    let stopped = false, unsubscribe = null, unobserve = null, malformed = 0, unsupported = 0;
    function dispose() {
      if (stopped) return;
      stopped = true; policy.dispose();
      if (unobserve) { unobserve(); unobserve = null; }
      if (unsubscribe) { const stop = unsubscribe; unsubscribe = null; stop(); }
    }
    unobserve = controller.subscribe(() => { if (!policy.isActive()) dispose(); });
    try {
      const stop = subscribe(Object.freeze({ table: 'domain_versions', context: policy.context,
        onChange(payload) {
          if (stopped || !policy.isActive()) return;
          // SDK envelope metadata is discarded. Never evaluate payload getters.
          const type = payload && Object.getOwnPropertyDescriptor(payload, 'eventType');
          const row = payload && Object.getOwnPropertyDescriptor(payload, 'new');
          if (!type || !Object.hasOwn(type, 'value') || !['INSERT', 'UPDATE'].includes(type.value)) { unsupported++; return; }
          if (!row || !Object.hasOwn(row, 'value')) { malformed++; return; }
          let event;
          try { event = normalizeVersionEvent(row.value, policy.context); }
          catch (_) { malformed++; return; }
          policy.accept(event);
        },
        onReady: () => { if (!stopped) policy.ready(); },
        onDisconnected: () => { if (!stopped) policy.disconnected(); }
      }));
      if (typeof stop !== 'function') throw new TypeError('Subscription must return unsubscribe');
      if (stopped) stop(); else unsubscribe = stop;
    } catch (e) { dispose(); throw e; }
    return Object.freeze({ dispose, getDiagnostics: () => Object.freeze({ ...policy.getDiagnostics(), malformed, unsupported }) });
  }
  return Object.freeze({ normalizeVersionEvent, createInvalidationPolicy, createRealtimeInvalidationAdapter });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SnapshotInvalidation;
