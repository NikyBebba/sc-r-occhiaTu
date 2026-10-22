'use strict';
// The shipped entry is permanently LEGACY for this release. The factory is an
// injection boundary for isolated shell tests; no browser setting selects mode.
let ProductionSession = (() => {
  const Host = typeof module !== 'undefined' && module.exports ? require('./runtime/production-host') : ProductionHost;
  function productionDependencies() {
    const client = sb;
    const enqueue = fn => Promise.resolve().then(fn);
    const instant = () => new Date().toISOString().replace('Z', '000Z');
    const rpc = (name, args) => client.rpc(name, args);
    function changes(table, topic, callbacks) {
      let active = true, ready = false;
      const channel = client.channel(topic, { config: { private: true } })
        .on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
          if (!active) return;
          const descriptor = payload && Object.getOwnPropertyDescriptor(payload, 'new');
          const row = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
          const revision = row && typeof row === 'object' ? Object.getOwnPropertyDescriptor(row, 'version') : null;
          if (table === 'domain_versions' && revision && Object.hasOwn(revision, 'value') && typeof revision.value === 'number') {
            if (!Number.isSafeInteger(revision.value) || revision.value < 0) {
              // Never round an SDK bigint into a version floor. Treat it as a
              // lost signal and request coherent recovery through the owner.
              callbacks.onDisconnected?.(); enqueue(() => { if (active) ProductionSession.requestRefresh(); }); return;
            }
            const normalized = {};
            for (const key of ['scope_kind','scope_id','entity_id','version','tombstone']) {
              const field = Object.getOwnPropertyDescriptor(row,key);
              if (!field || !Object.hasOwn(field,'value') || !field.enumerable) return;
              normalized[key] = key === 'version' ? String(field.value) : field.value;
            }
            if (Reflect.ownKeys(row).length !== 5) return;
            const type = Object.getOwnPropertyDescriptor(payload,'eventType');
            if (!type || !Object.hasOwn(type,'value')) return;
            payload = { eventType: type.value, new: normalized };
          }
          callbacks.onChange(payload);
        })
        .subscribe(status => {
          if (!active) return;
          if (status === 'SUBSCRIBED') { (ready ? callbacks.onReconnect ?? callbacks.onReady : callbacks.onReady)(); ready = true; }
          else callbacks.onDisconnected?.();
        });
      return () => { active = false; client.removeChannel(channel); };
    }
    // One Match channel supplies both hints and ephemeral UUID Presence.
    let match = null;
    function matchChannel(context) {
      if (match && match.context !== context) throw new TypeError('Match lifecycle context mismatch');
      if (!match) {
        const entry = { context, realtime: null, presence: null, ready: false };
        const notify = () => {
          const ids = Object.values(entry.channel.presenceState()).flat().map(p => p.person_id);
          entry.presence?.onSync(ids);
        };
        entry.channel = client.channel('scorochiatu-match', { config: { private: true, presence: { key: context.callerId } } })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'swipe_sessions' }, () => entry.realtime?.onChange())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'swipes' }, () => entry.realtime?.onChange())
          .on('presence', { event: 'sync' }, notify).on('presence', { event: 'join' }, notify).on('presence', { event: 'leave' }, notify)
          .subscribe(status => {
            if (match !== entry) return;
            if (status === 'SUBSCRIBED') { (entry.ready ? entry.realtime?.onReconnect : entry.realtime?.onReady)?.(); entry.ready = true; entry.presence?.onReady(); }
            else { entry.realtime?.onDisconnected(); entry.presence?.onDisconnected(); }
          });
        match = entry;
      }
      return match;
    }
    function releaseMatch(entry) {
      if (entry.realtime || entry.presence) return;
      if (match === entry) match = null;
      client.removeChannel(entry.channel);
    }
    return {
      runtime: { auth: { async getVerifiedIdentity() { await validateCurrentAuth(); return { callerId: authIdentity.uid }; } }, rpc,
        clock: { nowInstant: instant }, scheduler: { scheduleAt(at, fn) { return setTimeout(fn, Math.max(0, Date.parse(at) - Date.now())); }, cancel: id => clearTimeout(id) },
        storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) },
        subscribeInvalidation: h => changes('domain_versions', 'scorochiatu-db-changes', h), enqueue, observerRequestId: crypto.randomUUID() },
      match: {
        async executeMatchAction(request) { const r = await rpc('execute_match_action', request); if (r.error) { const e = new Error('Match transport'); e.status = r.status; if (isAuthFailure(r.error)) e.category = 'AUTH_INVALIDATING'; throw e; } return r.data; },
        async readLatestMatchState() {
          const session = await client.from('swipe_sessions').select('*').order('created_at', { ascending: false }).limit(1);
          if (session.error) return { category: isAuthFailure(session.error) ? 'AUTH_INVALIDATING' : 'UNAVAILABLE' };
          const row = session.data?.[0] ?? null;
          if (!row) return { category: 'MATCH_STATE', session: null, swipes: [] };
          const rows = await client.from('swipes').select('*').eq('session_id', row.id);
          if (rows.error) return { category: isAuthFailure(rows.error) ? 'AUTH_INVALIDATING' : 'UNAVAILABLE' };
          // Two ordinary authorized reads, not an invented atomic Snapshot.
          return { category: 'MATCH_STATE', session: row, swipes: rows.data };
        },
        subscribeRealtime(h) { const entry = matchChannel(h.context); entry.realtime = h; if (entry.ready) enqueue(() => { if (entry.realtime === h) h.onReady(); }); return () => { entry.realtime = null; releaseMatch(entry); }; },
        subscribePresence(h) { const entry = matchChannel(h.context); entry.presence = h; return { track: id => entry.channel.track({ person_id: id }), untrack: () => entry.channel.untrack(), dispose() { entry.presence = null; releaseMatch(entry); } }; },
        newSeed: () => crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff, nowInstant: instant
      }, enqueue, newRequestId: () => crypto.randomUUID()
    };
  }
  function createCoordinator({ mode, target, legacy, enqueue = fn => Promise.resolve().then(fn), labels = {}, onPublication = state => { if (mode === 'TARGET' && typeof TargetShell !== 'undefined') TargetShell.publication(state); } }) {
    if (!['LEGACY', 'TARGET'].includes(mode)) throw new TypeError('Explicit session mode required');
    if (mode === 'TARGET' && target === undefined) target = productionDependencies();
    const host = Host.createProductionHost({ legacy, target, enqueue, labels });
    let authKey = null;
    const off = host.subscribe(state => {
      onPublication(state);
      if (mode === 'TARGET' && state.phase === 'AUTH_INVALIDATING') enqueue(() => {
        if (host.getState().generation !== state.generation || host.getState().phase !== 'AUTH_INVALIDATING') return;
        if (typeof ProductionSession !== 'undefined' && ProductionSession.ownsCoordinator?.(api)) {
          if (typeof isAppAuthorized === 'function' && isAppAuthorized()) lockApp('Sessione non valida. Accedi di nuovo.');
          else if (typeof showLanding === 'function') showLanding();
        }
      });
    });
    const api = Object.freeze({ mode, ownsCoordinator: other => other === api, isTarget: () => mode === 'TARGET', assertLegacy() { if (mode !== 'LEGACY') throw new TypeError('LEGACY_AUTHORITY_FORBIDDEN'); },
      async startAuthenticated(key) { authKey = key; return mode === 'LEGACY' ? host.startLegacy() : host.startTarget(); },
      async refreshAuthenticated(key) { if (key !== authKey) return this.startAuthenticated(key); return host.requestRefresh(); },
      invalidateAuth() { authKey = null; return host.invalidateAuth(); },
      retryStartup() { return mode === 'TARGET' ? this.startAuthenticated(authKey) : host.requestRefresh(); },
      getState: host.getState, subscribe: host.subscribe, requestRefresh: host.requestRefresh, setObservedPerson: host.setObservedPerson,
      capture() { const state = host.getState(); return Object.freeze({ generation: state.generation, mode }); },
      current(token) { return token?.mode === mode && token.generation === host.getState().generation; },
      async action(token, name, ...args) { if (!this.current(token)) return Object.freeze({ outcome: 'OBSOLETE', code: 'SHELL_CONTEXT_CHANGED' }); const api = host.getState().actions; return api?.[name] ? api[name](...args) : Object.freeze({ outcome: 'NOT_READY' }); },
      match(token, name, ...args) { if (!this.current(token)) return Promise.resolve(Object.freeze({ category: 'OBSOLETE' })); return host.getState().matchCommands?.[name]?.(...args) ?? Promise.resolve(Object.freeze({ category: 'INVALID_INPUT' })); },
      scheduleMatchedMovie: host.scheduleMatchedMovie, closeScheduledMatch: host.closeScheduledMatch,
      dispose() { off(); return host.dispose(); }
    });
    return api;
  }
  function stopLegacy() {
    unsubscribeRealtime();
    leaveMatch(true);
    if (matchResyncTimer) { clearTimeout(matchResyncTimer); matchResyncTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }
  let coordinator = null;
  function normal() {
    if (!coordinator) coordinator = createCoordinator({ mode: 'LEGACY', legacy: {
      start() {
        requireAppIdentity(); const epoch = authEpoch; subscribeRealtime();
        // v62 starts its load asynchronously; storeReady owns its loading UI.
        // Session teardown must not wait on a stalled network request.
        loadMovies().catch(() => {
          if (targetSessionActive() || !isAppAuthorized() || epoch !== authEpoch) return;
          dbMode = 'local'; lastSupabaseFailAt = Date.now();
          try { loadLocal(); } catch (_) { movies = []; votes = []; vetoes = []; movieNights = []; }
          render();
        });
      },
      async refresh() { subscribeRealtime(); await resyncQuiet(); if (currentTab === 'match' && !matchChannel) await enterMatch(); },
      stop: stopLegacy
    } });
    return coordinator;
  }
  return Object.freeze({ createCoordinator, productionDependencies, ownsCoordinator: other => coordinator === other,
    isTarget: () => coordinator?.mode === 'TARGET',
    assertLegacy() { if (coordinator?.mode === 'TARGET') throw new TypeError('LEGACY_AUTHORITY_FORBIDDEN'); },
    startAuthenticated: () => normal().startAuthenticated(authIdentity?.uid),
    refreshAuthenticated: () => normal().refreshAuthenticated(authIdentity?.uid),
    invalidateAuth() { if (!coordinator || coordinator.mode === 'LEGACY') stopLegacy(); return coordinator?.invalidateAuth(); }, action: (...args) => coordinator?.action(...args) ?? Promise.resolve(Object.freeze({outcome:'NOT_READY'})),
    match: (...args) => coordinator?.match(...args) ?? Promise.resolve(Object.freeze({category:'INVALID_INPUT'})),
    subscribe: listener => normal().subscribe(listener), setObservedPerson: id => coordinator?.setObservedPerson(id),
    scheduleMatchedMovie: (...args) => coordinator?.scheduleMatchedMovie(...args), closeScheduledMatch: ticket => coordinator?.closeScheduledMatch(ticket),
    capture: () => coordinator?.capture() ?? null, current: token => coordinator?.current(token) ?? false, retryStartup: () => coordinator?.retryStartup(), requestRefresh: () => coordinator?.requestRefresh(), getState: () => coordinator?.getState() ?? null
  });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ProductionSession;
