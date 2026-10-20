'use strict';
// Shadow orchestration. All I/O, clocks and scheduling are injected.
const Core = require('./core');
const { createProjection } = require('./projection');
const { createCacheAdapter } = require('./cache');
const freeze = x => {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
  return x;
};
const REASONS = ['INITIAL', 'MANUAL', 'COMMAND', 'INVALIDATION', 'FOREGROUND', 'RECONNECT', 'TEMPORAL', 'DIRTY_FOLLOWUP', 'RETRY'];
function createShadowController({ provider, clock, scheduler, storage = null, timeoutMs = 10000 }) {
  if (!provider || typeof provider.read !== 'function' || !clock || typeof clock.nowInstant !== 'function' ||
    !scheduler || typeof scheduler.scheduleAt !== 'function' || typeof scheduler.cancel !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('Injected dependencies required');
  const cache = storage === null ? null : createCacheAdapter(storage);
  const pendingEmpty = () => freeze({ thresholds: null, requestIds: [] });
  let state = freeze({ context: null, status: 'UNINITIALIZED', view: null, pending: pendingEmpty(),
    freshness: { validatedOnline: false, temporalCurrent: false }, diagnostics: [] });
  let current = null, epoch = -1, disposed = false;
  // Admission remains occupied until the physical promise settles, including timeout.
  const flights = new Map();
  const identity = c => c.callerId + '|' + c.groupId + '|' + c.contractVersion;
  const now = () => {
    const value = clock.nowInstant();
    if (typeof value !== 'string' || value.startsWith('0000-') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 23) !== value.slice(0, 23)) throw new TypeError('Canonical injected clock required');
    return value;
  };
  const plus = (instant, ms) => new Date(Date.parse(instant) + ms).toISOString().slice(0, -1) + instant.slice(23, 26) + 'Z';
  const valid = ctx => !disposed && current === ctx && ctx.enabled;
  function publish(changes, diagnostic = null) {
    state = freeze({ ...state, ...changes, diagnostics: diagnostic ? [...state.diagnostics.slice(-31), freeze(diagnostic)] : state.diagnostics });
  }
  function cancel(ctx, name) {
    if (ctx?.[name] !== null && ctx?.[name] !== undefined) scheduler.cancel(ctx[name]);
    if (ctx) ctx[name] = null;
  }
  function stopTimers(ctx) {
    cancel(ctx, 'temporal'); cancel(ctx, 'retry');
    if (ctx?.flight?.timeout !== null && ctx?.flight?.timeout !== undefined) {
      scheduler.cancel(ctx.flight.timeout); ctx.flight.timeout = null;
    }
  }
  function invalidate(status, code) {
    const ctx = current; stopTimers(ctx); ctx.enabled = false; ctx.dirty = false;
    publish({ status, view: null, pending: pendingEmpty(), freshness: { validatedOnline: false, temporalCurrent: false } }, { code });
  }
  function retry(ctx) {
    if (!valid(ctx) || ctx.retry !== null || ctx.attempt >= 2) return;
    const delay = [250, 1000][ctx.attempt++];
    ctx.retry = scheduler.scheduleAt(plus(now(), delay), () => {
      ctx.retry = null;
      if (valid(ctx)) refresh('RETRY', false);
    });
  }
  function failed(ctx, status, code, retryable) {
    if (!valid(ctx)) return;
    publish({ status, freshness: { ...state.freshness, temporalCurrent: false } }, { code });
    if (retryable) retry(ctx);
  }
  function armTemporal(ctx, view) {
    cancel(ctx, 'temporal');
    const deadline = view.root.snapshot.temporal.next_temporal_invalidation_at;
    const task = () => {
      ctx.temporal = null;
      if (!valid(ctx) || state.view !== view) return;
      if (now() < deadline) { ctx.temporal = scheduler.scheduleAt(deadline, task); return; }
      publish({ status: 'STALE', freshness: { ...state.freshness, temporalCurrent: false } }, { code: 'TEMPORAL_EXPIRED' });
      refresh('TEMPORAL', false);
    };
    if (now() < deadline) ctx.temporal = scheduler.scheduleAt(deadline, task);
    // Expired cache stays stale; it does not arm an immediate repeating timer.
  }
  function applyResponse(ctx, ticket, raw) {
    if (!valid(ctx) || ticket.expired) return;
    const decoded = Core.decodeSnapshotEnvelope(raw, ctx.context);
    const prior = state.view;
    if (prior?.source === 'CACHE' && decoded.kind === 'DECODED_SNAPSHOT') {
      const comparison = Core.compareSnapshotVersions(prior.root, decoded.candidate);
      if (comparison.contradictions.length) { failed(ctx, 'CONTRACT_INVALID', 'TOMBSTONE_CONTRADICTION', false); return; }
      if (comparison.regressions.length || comparison.authorityLost.length) { failed(ctx, 'STALE', 'CACHE_VERSION_REGRESSION', true); return; }
    }
    const decision = Core.evaluateAcceptance({ decoded, current: prior?.source === 'ONLINE' ? prior.root : null,
      expectedContext: ctx.context, requestMeta: { context: ctx.context, requestSequence: ticket.requestSequence },
      latestRequestSequence: ctx.sequence, thresholds: state.pending.thresholds, nowInstant: now() });
    if (decision.outcome === 'ACCEPT') {
      let projection;
      try { projection = createProjection(decision.nextRoot); }
      catch (_) { failed(ctx, 'CONTRACT_INVALID', 'PROJECTION_FAILED', false); return; }
      const view = freeze({ root: decision.nextRoot, source: 'ONLINE', projection, selectors: projection.selectors });
      const next = freeze({ ...state, status: 'READY', view, pending: pendingEmpty(),
        freshness: { validatedOnline: true, temporalCurrent: true },
        diagnostics: [...state.diagnostics.slice(-31), freeze({ code: 'ACCEPT', requestSequence: ticket.requestSequence })] });
      state = next; // Domain root, projection, selectors and thresholds commit together.
      cancel(ctx, 'retry'); ctx.attempt = 0;
      armTemporal(ctx, view);
      if (cache) {
        const written = cache.write(view.root, now());
        if (!written.ok) publish({}, { code: written.code });
      }
      return;
    }
    if (decision.outcome === 'SERVER_ERROR') {
      const code = decision.code;
      if (code === 'UNAUTHENTICATED') invalidate('AUTH_INVALID', code);
      else if (['FORBIDDEN', 'INVALID_GROUP', 'UNSUPPORTED_GROUP'].includes(code)) invalidate('CONTEXT_INVALID', code);
      else failed(ctx, code === 'FOUNDATION_NOT_READY' ? (state.view ? 'DEGRADED' : 'UNINITIALIZED') : 'CONTRACT_INVALID', code, false);
    } else if (decision.outcome === 'DISCARD_CONTEXT') invalidate('CONTEXT_INVALID', decision.reason);
    else if (decision.outcome === 'CONTRACT_ERROR') failed(ctx, 'CONTRACT_INVALID', 'CONTRACT_ERROR', false);
    else if (['RETRY_THRESHOLD', 'DISCARD_VERSION_REGRESSION', 'TEMPORALLY_STALE'].includes(decision.outcome))
      failed(ctx, state.view ? 'STALE' : 'UNINITIALIZED', decision.outcome, true);
    // Obsolete responses have no state effects.
  }
  function refresh(reason, external) {
    if (!REASONS.includes(reason)) throw new TypeError('Unknown refresh reason');
    const ctx = current;
    if (!ctx || !valid(ctx)) return null;
    if (reason === 'FOREGROUND' && state.view) {
      const temporal = Core.isSnapshotTemporallyCurrent(state.view.root, now());
      if (!temporal.ok || !temporal.value.current) publish({ status: 'STALE',
        freshness: { ...state.freshness, temporalCurrent: false } }, { code: 'FOREGROUND_STALE' });
    }
    if (external) { ctx.attempt = 0; cancel(ctx, 'retry'); }
    const key = identity(ctx.context), running = flights.get(key);
    if (running) { ctx.dirty = true; return running.publicTicket; }
    cancel(ctx, 'retry');
    const requestSequence = ++ctx.sequence;
    if (!Number.isSafeInteger(requestSequence)) throw new RangeError('Request sequence exhausted');
    const publicTicket = freeze({ contextEpoch: ctx.context.contextEpoch, requestSequence });
    const ticket = { publicTicket, requestSequence, expired: false, timeout: null };
    ctx.flight = ticket;
    flights.set(key, ticket);
    publish({ status: state.view ? state.status : 'LOADING' }, { code: 'READ', reason, requestSequence });
    ticket.timeout = scheduler.scheduleAt(plus(now(), timeoutMs), () => {
      ticket.timeout = null;
      if (!valid(ctx)) return;
      ticket.expired = true;
      failed(ctx, state.view ? 'DEGRADED' : 'UNINITIALIZED', 'TIMEOUT', false);
    });
    // Invoke asynchronously so a synchronous provider throw is a transport failure.
    Promise.resolve().then(() => provider.read({ ...ctx.context, requestSequence, reason })).then(
      raw => applyResponse(ctx, ticket, raw),
      () => { if (valid(ctx) && !ticket.expired) failed(ctx, state.view ? 'DEGRADED' : 'UNINITIALIZED', 'TRANSPORT_FAILURE', true); }
    ).catch(() => {
      if (valid(ctx) && !ticket.expired) failed(ctx, 'CONTRACT_INVALID', 'ORCHESTRATION_ERROR', false);
    }).finally(() => {
      if (ticket.timeout !== null) scheduler.cancel(ticket.timeout);
      if (ctx.flight === ticket) ctx.flight = null;
      if (flights.get(key) === ticket) flights.delete(key);
      const active = current;
      if (!active || !valid(active) || identity(active.context) !== key) return;
      if (active.dirty) {
        active.dirty = false; refresh('DIRTY_FOLLOWUP', false);
      } else if (active === ctx && ticket.expired) retry(ctx);
    });
    return publicTicket;
  }
  function clearContext(reason = 'CLEARED') {
    if (current) { stopTimers(current); current.enabled = false; current.dirty = false; }
    current = null;
    publish({ context: null, status: 'UNINITIALIZED', view: null, pending: pendingEmpty(),
      freshness: { validatedOnline: false, temporalCurrent: false } }, { code: reason });
  }
  return Object.freeze({
    getState: () => state,
    requestRefresh(reason = 'MANUAL') { return refresh(reason, !['RETRY', 'DIRTY_FOLLOWUP', 'TEMPORAL'].includes(reason)); },
    setContext(input) {
      if (disposed) throw new TypeError('Disposed controller');
      const checked = Core.createContext(input);
      if (!checked.ok) throw new TypeError('Invalid context');
      clearContext('CONTEXT_SWITCH');
      epoch = Math.max(epoch + 1, checked.value.contextEpoch);
      if (!Number.isSafeInteger(epoch)) throw new RangeError('Context epoch exhausted');
      const context = freeze({ ...checked.value, contextEpoch: epoch });
      current = { context, enabled: true, dirty: false, sequence: 0, attempt: 0, temporal: null, retry: null, flight: null };
      publish({ context });
      if (cache) {
        const loaded = cache.load(context);
        if (loaded.kind === 'HIT') {
          const projection = createProjection(loaded.root);
          const view = freeze({ root: loaded.root, source: 'CACHE', projection, selectors: projection.selectors });
          publish({ view, status: 'STALE' }, { code: 'CACHE_HIT' });
          armTemporal(current, view);
        } else if (loaded.kind === 'REJECTED') publish({}, { code: 'CACHE_REJECTED' });
      }
      return context;
    },
    clearContext,
    requireVersions({ requestId, affectedVersions }) {
      if (!current || !valid(current)) throw new TypeError('Active verified context required');
      if (!Core.validateUUID(requestId).ok) throw new TypeError('Canonical request UUID required');
      const normalized = Core.normalizeAffectedVersions(state.context, affectedVersions);
      if (!normalized.ok) throw new TypeError('Invalid affected versions');
      const merged = state.pending.thresholds === null ? normalized : Core.mergeThresholds(state.pending.thresholds, normalized.value);
      if (!merged.ok) throw new TypeError('Invalid threshold context');
      const pending = freeze({ thresholds: merged.value, requestIds: [...new Set([...state.pending.requestIds, requestId])].sort() });
      publish({ pending, status: state.view ? 'STALE' : state.status });
      return refresh('COMMAND', true);
    },
    dispose() { clearContext('DISPOSED'); disposed = true; }
  });
}
module.exports = Object.freeze({ createShadowController });
