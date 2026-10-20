'use strict';
// Synchronous injected storage only. A cache record never proves authorization.
const SnapshotCache = (() => {
const commonJS = typeof module !== 'undefined' && !!module.exports;
// Lexical redeclaration rejects duplicate scripts; reject object namespaces too.
if (!commonJS && 'SnapshotCache' in globalThis) throw new TypeError('SnapshotCache namespace already installed');
const Core = commonJS ? require('./core') : (typeof SnapshotCore !== 'undefined' ? SnapshotCore : null);
if (!Core || typeof Core.createContext !== 'function') throw new TypeError('SnapshotCache requires SnapshotCore');
const own = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) &&
  Reflect.ownKeys(x).length === keys.length && keys.every(k => {
    const d = Object.getOwnPropertyDescriptor(x, k);
    return d && d.enumerable && Object.hasOwn(d, 'value');
  });
function canonicalInstant(x) {
  if (typeof x !== 'string' || x.startsWith('0000-') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(x)) return false;
  const d = new Date(x);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 23) === x.slice(0, 23);
}
function createCacheAdapter(storage) {
  if (!storage || !['getItem', 'setItem', 'removeItem'].every(k => typeof storage[k] === 'function')) throw new TypeError('Injected storage required');
  const key = context => {
    const checked = Core.createContext(context);
    if (!checked.ok) throw new TypeError('Invalid cache context');
    return 'scorochiatu_snapshot_v1:' + context.callerId + ':' + context.groupId;
  };
  return Object.freeze({
    load(context) {
      const k = key(context);
      try {
        const value = storage.getItem(k);
        if (value === null) return Object.freeze({ kind: 'MISS' });
        if (typeof value !== 'string') return Object.freeze({ kind: 'REJECTED' });
        const r = JSON.parse(value);
        if (!own(r, ['cache_format_version', 'caller_id', 'group_id', 'contract_version', 'saved_at', 'snapshot']) ||
          r.cache_format_version !== 1 || r.contract_version !== context.contractVersion || r.caller_id !== context.callerId ||
          r.group_id !== context.groupId || !canonicalInstant(r.saved_at)) return Object.freeze({ kind: 'REJECTED' });
        const decoded = Core.decodeSnapshotEnvelope(r.snapshot, context);
        return decoded.kind === 'DECODED_SNAPSHOT' ? Object.freeze({ kind: 'HIT', root: decoded.candidate, savedAt: r.saved_at }) : Object.freeze({ kind: 'REJECTED' });
      } catch (_) { return Object.freeze({ kind: 'REJECTED' }); }
    },
    // The controller calls this exclusively after online ACCEPT; cache candidates
    // have no acceptance metadata and cannot be persisted through this boundary.
    write(root, savedAt) {
      if (!root?.acceptance || !Object.isFrozen(root) || !canonicalInstant(savedAt)) throw new TypeError('Accepted online root required');
      Core.getPerson(root, root.context.callerId);
      const k = key(root.context);
      try {
        storage.setItem(k, JSON.stringify({ cache_format_version: 1, caller_id: root.context.callerId,
          group_id: root.context.groupId, contract_version: root.context.contractVersion, saved_at: savedAt, snapshot: root.snapshot }));
        return Object.freeze({ ok: true });
      } catch (_) { return Object.freeze({ ok: false, code: 'CACHE_WRITE_FAILED' }); }
    }
  });
}
return Object.freeze({ createCacheAdapter });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SnapshotCache;
