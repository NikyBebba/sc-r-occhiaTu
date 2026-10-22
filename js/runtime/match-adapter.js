'use strict';
// Dormant Match consumer. Match rows are server state; target eligibility is
// supplied by ConsumerFacade. No SDK, storage, timers or shared-domain writes.
const MatchAdapter = (() => {
  const cjs = typeof module !== 'undefined' && !!module.exports;
  if (!cjs && 'MatchAdapter' in globalThis) throw new TypeError('MatchAdapter namespace already installed');
  const Core = cjs ? require('../snapshot/core') : (typeof SnapshotCore !== 'undefined' ? SnapshotCore : null);
  if (!Core) throw new TypeError('MatchAdapter requires SnapshotCore');
  const fail = code => { throw new TypeError(code); };
  const own = (x, k) => Object.hasOwn(x, k);
  function copy(x, ancestors = new Set()) {
    if (x === null || ['string', 'boolean', 'number'].includes(typeof x)) return x;
    if (!x || typeof x !== 'object' || ancestors.has(x)) fail('PLAIN_DATA_REQUIRED');
    const array = Array.isArray(x);
    if (![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(x)) || (!array && Object.getPrototypeOf(x) === Array.prototype)) fail('PLAIN_DATA_REQUIRED');
    ancestors.add(x); const out = array ? [] : {};
    if (array && Reflect.ownKeys(x).length !== x.length + 1) fail('DENSE_ARRAY_REQUIRED');
    for (const k of array ? Array.from({ length: x.length }, (_, i) => String(i)) : Reflect.ownKeys(x)) {
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (typeof k !== 'string' || k === '__proto__' || !d?.enumerable || !own(d, 'value')) fail('PLAIN_DATA_REQUIRED');
      out[k] = copy(d.value, ancestors);
    }
    ancestors.delete(x); return Object.freeze(out);
  }
  const shape = (x, keys, required = keys) => {
    if (!x || Array.isArray(x) || typeof x !== 'object' || Object.keys(x).some(k => !keys.includes(k)) || required.some(k => !own(x, k))) fail('INVALID_SHAPE');
  };
  const uuid = x => { if (!Core.validateUUID(x).ok) fail('UUID_REQUIRED'); return x; };
  const instant = x => { if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x) || !Number.isFinite(Date.parse(x))) fail('INSTANT_REQUIRED'); return Date.parse(x); };
  const same = (a, b) => a && b && ['callerId', 'groupId', 'contextEpoch', 'contractVersion', 'generation'].every(k => a[k] === b[k]);
  const activeSession = s => s && ['open', 'matched'].includes(s.status);
  const envelope = (category, code, extra = {}) => copy({ category, ...(code ? { code } : {}), ...extra });
  function createMatchAdapter(d) {
    for (const k of ['executeMatchAction', 'readLatestMatchState', 'getRuntimeState', 'getConsumerBundle', 'subscribeRuntime', 'subscribeRealtime', 'subscribePresence', 'enqueue', 'newSeed', 'nowInstant', 'onAuthInvalidating']) if (typeof d?.[k] !== 'function') fail('INJECTED_DEPENDENCIES_REQUIRED');
    let disposed = false, notifying = false, epoch = 0, scope = null, installationGroup = null;
    let phase = 'UNINITIALIZED', session = null, swipes = [], presence = [], lastError = null;
    let realtime = null, presenceLife = null, readFlight = null, mutationFlight = null, scheduled = false, dirty = false, revision = 0, startNeedsReconcile = false;
    const listeners = new Set(), tokens = new WeakMap(), retries = new WeakMap();
    const mutable = () => { if (notifying) fail('MUTATION_DURING_PUBLICATION'); };
    function target() {
      const r = d.getRuntimeState(), b = d.getConsumerBundle();
      if (!r || !['READY', 'BOOTSTRAPPING'].includes(r.phase) || r.bootstrap?.runtime.mode !== 'target' || r.bootstrap?.runtime.activation_allowed !== true || b?.kind !== 'AVAILABLE' || !Object.isFrozen(b)) fail('TARGET_UNAVAILABLE');
      const i = b.getMatchInput(), c = i.context;
      uuid(c.callerId); uuid(c.groupId);
      if (c.contractVersion !== 1 || !Number.isSafeInteger(c.contextEpoch) || !Number.isSafeInteger(r.generation) ||
        b.context.caller.personId !== c.callerId || b.context.groupId !== c.groupId || b.context.contextEpoch !== c.contextEpoch ||
        !same({ ...r.controllerState.context, generation: r.generation }, { ...c, generation: r.generation })) fail('CONTEXT_MISMATCH');
      const labels = new Map(), people = new Set();
      for (const p of b.people.identities) {
        uuid(p.personId); if (people.has(p.personId)) fail('AMBIGUOUS_IDENTITY'); people.add(p.personId);
        if (p.legacyLabel !== null) { if (!['N', 'V'].includes(p.legacyLabel) || labels.has(p.legacyLabel)) fail('AMBIGUOUS_IDENTITY'); labels.set(p.legacyLabel, p.personId); }
      }
      if (labels.size !== 2 || people.size !== 2 || !people.has(c.callerId)) fail('IDENTITY_MAPPING_REQUIRED');
      return { context: copy({ ...c, generation: r.generation }), input: i, labels, people, online: r.phase === 'READY' && b.freshness.source === 'ONLINE' };
    }
    function detach() {
      const rt = realtime, p = presenceLife; realtime = null; presenceLife = null;
      try { if (p) Promise.resolve(p.untrack()).catch(() => {}); } catch (_) { /* cleanup cannot restore authority */ }
      try { if (p) p.dispose(); } catch (_) { /* other resources must still detach */ }
      try { if (rt) rt(); } catch (_) { /* detached callbacks are epoch guarded */ }
    }
    function clear(next, code) {
      epoch++; scope = null; detach(); phase = next; session = null; swipes = []; presence = []; lastError = code;
      dirty = false; scheduled = false; startNeedsReconcile = false; revision++; publish();
    }
    function valid(e = epoch) {
      if (disposed || !scope || e !== epoch) return false;
      try { if (same(scope, target().context)) return true; } catch (_) { /* fail closed */ }
      clear(d.getRuntimeState()?.phase === 'AUTH_INVALIDATING' ? 'AUTH_INVALIDATING' : 'CONTEXT_INVALID', 'CONTEXT_CHANGED'); return false;
    }
    function observed(kind, parameters) {
      const token = copy(parameters); tokens.set(token, { kind, epoch, context: scope }); return token;
    }
    function derived(t, candidateSession = session, candidateSwipes = swipes) {
      const session = candidateSession, swipes = candidateSwipes;
      if (!session) return copy({ view: 'LOBBY', currentCard: null, pendingMatch: null, exhausted: false, actionableMovieIds: [], agreement: { agreed: 0, total: 0, pct: null }, matches: 0 });
      const eligible = new Set(t.input.matchBaseIds), content = new Map(t.input.content.map(m => [m.movie_id, m]));
      const answers = new Map();
      for (const s of swipes) { if (!answers.has(s.movie_id)) answers.set(s.movie_id, new Map()); answers.get(s.movie_id).set(s.personId, s.liked); }
      const resolved = id => answers.get(id)?.size === t.people.size;
      const matched = id => resolved(id) && [...answers.get(id).values()].every(Boolean);
      const ids = session.deck.filter(id => eligible.has(id) && content.has(id));
      const index = session.deck.findIndex(id => ids.includes(id) && !resolved(id));
      const last = [...ids].reverse().find(matched) ?? null;
      const pending = last !== session.matched_movie_id ? last : null;
      let total = 0, agreed = 0, matches = 0;
      // Historical agreement retains the production catalog/non-cinema rule;
      // current action eligibility does not rewrite stored swipe history.
      for (const [id, a] of answers) if (content.has(id) && !content.get(id).cinema_watchlist && a.size === t.people.size) {
        total++; const values = [...a.values()]; if (values.every(v => v === values[0])) agreed++; if (values.every(Boolean)) matches++;
      }
      const enabled = activeSession(session), current = enabled && pending === null && index >= 0 ? session.deck[index] : null;
      return Object.freeze({ view: !enabled ? (session.status === 'closed' ? 'CLOSED' : 'DONE') : pending ? 'MATCH_PENDING' : index < 0 ? 'DONE' : 'SWIPE',
        currentCard: current ? observed('card', { session_id: session.id, movie_id: current }) : null,
        pendingMatch: enabled && pending ? observed('match', { session_id: session.id, matched_movie_id: pending }) : null,
        exhausted: index < 0, actionableMovieIds: copy(ids), agreement: copy({ agreed, total, pct: total ? Math.round(agreed / total * 100) : null }), matches });
    }
    function getState() {
      if (scope) valid();
      const t = scope ? target() : null;
      return Object.freeze({ phase, context: scope, authoritative: copy({ session, swipes }),
        derived: t ? derived(t) : null, observedSession: session && scope ? observed('session', { session_id: session.id }) : null,
        presence: copy(presence), pending: Object.freeze({ reading: !!readFlight, mutating: !!mutationFlight, dirty }), lastError });
    }
    function publish() {
      if (notifying || disposed) return;
      const state = getState(); notifying = true;
      try { for (const f of [...listeners]) if (listeners.has(f)) { try { f(state); } catch (_) { /* observers cannot undo server state */ } } }
      finally { notifying = false; }
    }
    function decodeState(raw, t) {
      const x = copy(raw); shape(x, ['session', 'swipes']);
      if (!Array.isArray(x.swipes)) fail('SWIPES_REQUIRED');
      if (x.session === null) { if (x.swipes.length) fail('ORPHAN_SWIPES'); return { session: null, swipes: [] }; }
      const s = x.session;
      shape(s, ['id', 'created_by', 'seed', 'deck', 'status', 'matched_movie_id', 'matched_at', 'created_at']);
      uuid(s.id); if (!['open', 'matched', 'done', 'closed'].includes(s.status) || !Number.isInteger(s.seed) || s.seed < 0 || s.seed > 2147483647 || !Array.isArray(s.deck)) fail('INVALID_SESSION');
      for (const id of s.deck) uuid(id);
      if (new Set(s.deck).size !== s.deck.length || (s.created_by !== null && !t.labels.has(s.created_by))) fail('INVALID_SESSION');
      if (s.matched_movie_id !== null) { uuid(s.matched_movie_id); if (!s.deck.includes(s.matched_movie_id)) fail('INVALID_RECOGNITION'); }
      instant(s.created_at); if (s.matched_at !== null) instant(s.matched_at);
      const seen = new Set(), rows = x.swipes.map(w => {
        shape(w, ['id', 'session_id', 'movie_id', 'person', 'liked', 'created_at']);
        uuid(w.id); uuid(w.session_id); uuid(w.movie_id); instant(w.created_at);
        if (w.session_id !== s.id || !s.deck.includes(w.movie_id) || !t.labels.has(w.person) || typeof w.liked !== 'boolean') fail('INVALID_SWIPE');
        const personId = t.labels.get(w.person), key = w.movie_id + personId;
        if (seen.has(key)) fail('DUPLICATE_SWIPE'); seen.add(key);
        return { id: w.id, session_id: w.session_id, movie_id: w.movie_id, personId, liked: w.liked, created_at: w.created_at };
      });
      rows.sort((a, b) => (a.movie_id + a.personId).localeCompare(b.movie_id + b.personId));
      return { session: copy({ ...s, created_by: s.created_by === null ? null : t.labels.get(s.created_by) }), swipes: copy(rows) };
    }
    function install(value) { session = value.session; swipes = value.swipes; revision++; phase = 'READY'; lastError = null; }
    function authError(code) { return ['UNAUTHENTICATED', 'MEMBERSHIP_REQUIRED', 'NO_ACTIVE_GROUP', 'FORBIDDEN', 'AUTH_INVALIDATING'].includes(code); }
    function defer(fn) { let sync = true; d.enqueue(() => { if (sync) fail('DEFERRED_ENQUEUE_REQUIRED'); fn(); }); sync = false; }
    function loseAuth(code) { clear('AUTH_INVALIDATING', code); defer(() => d.onAuthInvalidating(code)); }
    async function rpc(action, parameters, e) {
      let raw;
      try { raw = await d.executeMatchAction(copy({ p_protocol: 1, p_action: action, p_parameters: parameters })); }
      catch (error) {
        if (!valid(e)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
        if (authError(error?.category) || [401, 403].includes(error?.status)) { loseAuth('AUTH_INVALIDATING'); return envelope('AUTH_INVALIDATING', 'AUTH_INVALIDATING'); }
        return envelope('TRANSPORT_UNCERTAIN', 'MATCH_OUTCOME_UNKNOWN');
      }
      try {
        if (!valid(e)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
        const r = copy(raw);
        shape(r, ['outcome', 'session', 'swipes', 'error'], ['outcome']);
        if (r.outcome === 'ERROR') {
          shape(r, ['outcome', 'error']); shape(r.error, ['code']); if (typeof r.error.code !== 'string') fail('INVALID_ERROR');
          if (authError(r.error.code)) { loseAuth(r.error.code); return envelope('AUTH_INVALIDATING', r.error.code); }
        } else if (['SUCCESS', 'ALREADY_IN_TARGET_STATE'].includes(r.outcome)) {
          shape(r, ['outcome', 'session', 'swipes']); decodeState({ session: r.session, swipes: r.swipes }, target());
          if (!r.session || (action !== 'start' && r.session.id !== parameters.session_id)) fail('RESPONSE_SESSION_MISMATCH');
        } else if (r.outcome === 'STALE') {
          shape(r, ['outcome', 'session']); if (r.session !== null) decodeState({ session: r.session, swipes: [] }, target());
          if (r.session && r.session.id !== parameters.session_id) fail('RESPONSE_SESSION_MISMATCH');
        } else fail('INVALID_OUTCOME');
        return envelope('SEMANTIC_RESULT', null, r);
      } catch (error) {
        if (!valid(e)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
        return envelope('SERVER_CONTRACT_ERROR', error.message);
      }
    }
    function requestRead() {
      if (!valid()) return Promise.resolve(envelope('OBSOLETE', 'CONTEXT_CHANGED'));
      dirty = true;
      if (readFlight) return readFlight;
      if (mutationFlight || scheduled) return Promise.resolve(envelope('SEMANTIC_RESULT', 'RECONCILIATION_PENDING'));
      scheduled = true; const e = epoch;
      defer(() => { if (e !== epoch || !valid(e)) return; scheduled = false; if (!mutationFlight) readCycle(); });
      return Promise.resolve(envelope('SEMANTIC_RESULT', 'RECONCILIATION_PENDING'));
    }
    function readCycle() {
      if (readFlight) return readFlight;
      const e = epoch;
      const work = async () => {
        for (let pass = 0; pass < 2 && valid(e); pass++) {
          dirty = false; const before = revision; let reading = true;
          try {
            const r = await d.readLatestMatchState(copy(scope));
            reading = false;
            if (!valid(e)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
            if (before !== revision || mutationFlight) { dirty = true; continue; }
            const value = copy(r);
            if (value.category === 'AUTH_INVALIDATING') { loseAuth('AUTH_INVALIDATING'); return envelope('AUTH_INVALIDATING', 'AUTH_INVALIDATING'); }
            if (value.category === 'UNAVAILABLE') {
              shape(value, ['category', 'code'], ['category']); phase = 'UNAVAILABLE'; lastError = 'MATCH_READ_UNAVAILABLE'; publish();
              return envelope('TRANSPORT_UNCERTAIN', lastError);
            }
            shape(value, ['category', 'session', 'swipes']); if (value.category !== 'MATCH_STATE') fail('MATCH_READ_UNAVAILABLE');
            const decoded = decodeState({ session: value.session, swipes: value.swipes }, target());
            // Read tables are not an atomic Snapshot. Normalize through the
            // existing server operation only when exhaustion needs a transition.
            const state = derived(target(), decoded.session, decoded.swipes);
            if (decoded.session?.status === 'open' && state.exhausted && !state.pendingMatch) {
              const response = await rpc('reconcile-done', { session_id: decoded.session.id }, e);
              if (!valid(e)) return response;
              if (before !== revision || mutationFlight) { dirty = true; continue; }
              if (response.category !== 'SEMANTIC_RESULT' || !own(response, 'swipes')) { lastError = response.code ?? response.outcome; phase = 'UNAVAILABLE'; return response; }
              install(decodeState({ session: response.session, swipes: response.swipes }, target()));
            } else install(decoded);
            startNeedsReconcile = false; publish();
          } catch (error) {
            if (!valid(e)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
            if ([401, 403].includes(error?.status) || authError(error?.category)) { loseAuth('AUTH_INVALIDATING'); return envelope('AUTH_INVALIDATING', 'AUTH_INVALIDATING'); }
            lastError = !reading && error instanceof TypeError ? error.message : 'MATCH_READ_UNAVAILABLE'; phase = 'UNAVAILABLE'; publish();
            return envelope(!reading && error instanceof TypeError ? 'SERVER_CONTRACT_ERROR' : 'TRANSPORT_UNCERTAIN', lastError);
          }
          if (!dirty) break;
        }
        return envelope('SEMANTIC_RESULT', 'RECONCILED');
      };
      readFlight = Promise.resolve().then(work).finally(() => { readFlight = null; if (e === epoch) publish(); });
      return readFlight;
    }
    function checkToken(token, kind, requireCurrent = true) {
      const owned = tokens.get(token);
      if (!owned || owned.kind !== kind || owned.epoch !== epoch || !same(owned.context, scope)) fail('OWNED_OBSERVATION_REQUIRED');
      if (requireCurrent && (!session || token.session_id !== session.id)) fail('SESSION_REPLACED');
    }
    async function send(action, parameters, retry = null) {
      if (!valid()) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
      if (!target().online) return envelope('INVALID_INPUT', 'ONLINE_TARGET_REQUIRED');
      if (!['READY', 'DISCONNECTED'].includes(phase)) return envelope('INVALID_INPUT', 'RECONCILIATION_REQUIRED');
      if (mutationFlight) return envelope('INVALID_INPUT', 'OPERATION_IN_FLIGHT');
      const e = epoch, op = copy(parameters); revision++;
      const work = async () => {
        const r = await rpc(action, op, e);
        if (!valid(e)) return r.category === 'AUTH_INVALIDATING' ? r : envelope('OBSOLETE', 'CONTEXT_CHANGED');
        if (r.category === 'SEMANTIC_RESULT' && own(r, 'swipes')) {
          const value = decodeState({ session: r.session, swipes: r.swipes }, target());
          if (action === 'start' || !session || session.id === op.session_id) install(value);
          else dirty = true;
        }
        if (r.category === 'SERVER_CONTRACT_ERROR') { phase = 'UNAVAILABLE'; lastError = r.code; }
        if (r.category === 'TRANSPORT_UNCERTAIN') {
          // START intentionally has no retry handle. Its natural identity is
          // not stable once another participant terminates the created session.
          dirty = true;
          if (action === 'start') startNeedsReconcile = true;
          if (action !== 'start') {
            const handle = retry?.handle ?? Object.freeze({});
            const record = retry ?? { action, parameters: op, epoch: e, context: scope, handle, inFlight: null, eligible: true };
            retries.set(handle, record); record.eligible = true;
            return Object.freeze({ ...r, retryHandle: handle });
          }
        } else if (retry) retry.eligible = false;
        if (r.outcome === 'STALE') dirty = true;
        return r;
      };
      mutationFlight = Promise.resolve().then(work);
      try { return await mutationFlight; }
      finally { mutationFlight = null; if (e === epoch && valid(e)) { publish(); if (dirty) requestRead(); } }
    }
    function guarded(fn) {
      mutable(); if (disposed) return Promise.resolve(envelope('OBSOLETE', 'DISPOSED'));
      try { return Promise.resolve(fn()); } catch (e) { return Promise.resolve(envelope('INVALID_INPUT', e.message)); }
    }
    function start() { return guarded(() => {
      if (!valid()) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
      if (startNeedsReconcile) return envelope('INVALID_INPUT', 'RECONCILIATION_REQUIRED');
      const seed = d.newSeed(); if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) fail('SEED_REQUIRED');
      const deck = [...target().input.matchBaseIds];
      // Same production mulberry32 shuffle, driven only by injected seed.
      let a = seed; const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      return send('start', { seed, deck });
    }); }
    const unobserve = d.subscribeRuntime(() => {
      if (!scope || disposed) return;
      if (valid()) { publish(); requestRead(); }
    });
    return Object.freeze({
      enter() { return guarded(async () => {
        if (scope && valid()) { requestRead(); return envelope('SEMANTIC_RESULT', 'ALREADY_ENTERED'); }
        let t; try { t = target(); } catch (e) { return envelope('INVALID_INPUT', e.message); }
        if (installationGroup && installationGroup !== t.context.groupId) return envelope('INVALID_INPUT', 'GROUP_REPLACEMENT_UNSUPPORTED');
        installationGroup = t.context.groupId; scope = t.context; const e = ++epoch; phase = 'ENTERING'; publish();
        try {
          realtime = d.subscribeRealtime(Object.freeze({ context: scope,
            onReady: () => { if (valid(e)) requestRead(); }, onReconnect: () => { if (valid(e)) requestRead(); },
            onChange: () => { if (valid(e)) requestRead(); }, onDisconnected: () => { if (valid(e)) { phase = 'DISCONNECTED'; presence = []; publish(); } } }));
          const sync = ids => { if (!valid(e)) return; try { const values = copy(ids); if (!Array.isArray(values)) fail('PRESENCE_ARRAY_REQUIRED'); const people = target().people; presence = [...new Set(values.filter(id => typeof id === 'string' && people.has(id)))].sort(); publish(); } catch (_) { presence = []; publish(); } };
          presenceLife = d.subscribePresence(Object.freeze({ context: scope, onSync: sync,
            onJoin: id => sync([...presence, id]), onLeave: id => sync(presence.filter(p => p !== id)),
            onReady: () => { if (valid(e) && presenceLife) Promise.resolve(presenceLife.track(scope.callerId)).catch(() => {}); },
            onDisconnected: () => sync([]) }));
          if (typeof realtime !== 'function' || !presenceLife || !['track', 'untrack', 'dispose'].every(k => typeof presenceLife[k] === 'function')) fail('LIFECYCLE_REQUIRED');
          await presenceLife.track(scope.callerId);
          if (!valid(e)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
          await readCycle(); if (!valid(e)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
          if (phase !== 'READY') return envelope('INVALID_INPUT', 'MATCH_READ_UNAVAILABLE');
          if (activeSession(session)) {
            let last = instant(session.created_at); for (const w of swipes) last = Math.max(last, instant(w.created_at));
            if (instant(d.nowInstant()) - last < 6 * 3600000) return envelope('SEMANTIC_RESULT', 'RESUMED');
            const closed = await send('close', { session_id: session.id });
            if (!valid(e) || !['SUCCESS', 'ALREADY_IN_TARGET_STATE'].includes(closed.outcome)) return closed;
          }
          return start();
        } catch (error) { if (e === epoch) clear('UNAVAILABLE', error.message); return envelope('INVALID_INPUT', error.message); }
      }); },
      leave() { mutable(); if (!disposed) clear('LEFT', null); }, start,
      swipe(token, liked) { return guarded(() => {
        if (!valid()) return envelope('OBSOLETE', 'CONTEXT_CHANGED'); checkToken(token, 'card');
        if (typeof liked !== 'boolean' || !activeSession(session) || derived(target()).currentCard?.movie_id !== token.movie_id || swipes.some(s => s.movie_id === token.movie_id && s.personId === scope.callerId)) fail('STALE_CARD');
        return send('swipe', { session_id: token.session_id, movie_id: token.movie_id, liked });
      }); },
      acknowledge(token) { return guarded(() => {
        if (!valid()) return envelope('OBSOLETE', 'CONTEXT_CHANGED'); checkToken(token, 'match');
        if (!activeSession(session) || derived(target()).pendingMatch?.matched_movie_id !== token.matched_movie_id) fail('STALE_MATCH');
        return send('acknowledge-match', { session_id: token.session_id, matched_movie_id: token.matched_movie_id });
      }); },
      close(token) { return guarded(() => { if (!valid()) return envelope('OBSOLETE', 'CONTEXT_CHANGED'); checkToken(token, 'session'); return send('close', { session_id: token.session_id }); }); },
      reconcile() { return guarded(() => requestRead()); },
      retry(handle) { return guarded(async () => {
        const r = retries.get(handle);
        if (!r || !r.eligible) return envelope('INVALID_INPUT', 'OWNED_RETRY_REQUIRED');
        if (!valid(r.epoch) || !same(r.context, scope)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
        if (r.inFlight) return r.inFlight;
        r.inFlight = (async () => {
          await readCycle(); if (!valid(r.epoch)) return envelope('OBSOLETE', 'CONTEXT_CHANGED');
          if (phase !== 'READY') return envelope('INVALID_INPUT', 'RECONCILIATION_REQUIRED');
          if (!session || session.id !== r.parameters.session_id) return envelope('INVALID_INPUT', 'SESSION_REPLACED');
          if (r.action === 'swipe' && (!activeSession(session) || swipes.some(s => s.movie_id === r.parameters.movie_id && s.personId === scope.callerId))) return envelope('INVALID_INPUT', 'RETRY_NOT_NEEDED');
          if (r.action === 'close' && !activeSession(session)) return envelope('INVALID_INPUT', 'RETRY_NOT_NEEDED');
          return send(r.action, r.parameters, r);
        })().finally(() => { r.inFlight = null; });
        return r.inFlight;
      }); },
      getState,
      subscribe(listener) { mutable(); if (disposed || typeof listener !== 'function') fail('ACTIVE_LISTENER_REQUIRED'); listeners.add(listener); return () => listeners.delete(listener); },
      dispose() { mutable(); if (disposed) return; clear('DISPOSED', null); disposed = true; unobserve(); listeners.clear(); }
    });
  }
  return Object.freeze({ createMatchAdapter });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MatchAdapter;
