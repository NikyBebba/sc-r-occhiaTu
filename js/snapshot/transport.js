'use strict';
// Dormant injected RPC boundary. No application singleton or automatic retry.
const SnapshotTransport = (() => {
  const commonJS = typeof module !== 'undefined' && !!module.exports;
  if (!commonJS && 'SnapshotTransport' in globalThis) throw new TypeError('SnapshotTransport namespace already installed');
  const Core = commonJS ? require('./core') : (typeof SnapshotCore !== 'undefined' ? SnapshotCore : null);
  if (!Core || typeof Core.normalizeAffectedVersions !== 'function') throw new TypeError('SnapshotTransport requires SnapshotCore');
  const bootstrapErrors = Object.freeze({ UNAUTHENTICATED: 'AUTH_INVALIDATING', MEMBERSHIP_REQUIRED: 'AUTH_INVALIDATING',
    NO_ACTIVE_GROUP: 'CONTEXT_BLOCKING', PROTOCOL_UNSUPPORTED: 'PROTOCOL_BLOCKING', MAINTENANCE: 'MAINTENANCE', FOUNDATION_NOT_READY: 'SERVER_NOT_READY' });
  const prepared = new WeakSet(), bootstrapContexts = new WeakSet();
  const plain = x => x !== null && typeof x === 'object' &&
    (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
  const requireValue = (condition, label) => { if (!condition) throw new TypeError(label); };
  function shape(x, keys) {
    requireValue(plain(x) && Reflect.ownKeys(x).length === keys.length, 'Exact object shape required');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(x, key);
      requireValue(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'Own data property required');
    }
  }
  function freeze(x) {
    if (x && typeof x === 'object' && !Object.isFrozen(x)) { for (const v of Object.values(x)) freeze(v); Object.freeze(x); }
    return x;
  }
  // JSON-like owned data only. No accessors, coercions, sparse slots or hooks.
  function own(input) {
    const ancestors = new Set();
    function copy(value) {
      if (value === null || ['string','boolean'].includes(typeof value)) return value;
      if (typeof value === 'number') { requireValue(Number.isFinite(value) && !Object.is(value,-0), 'Exact JSON number required'); return value; }
      const array = Array.isArray(value);
      requireValue((array && Object.getPrototypeOf(value) === Array.prototype) || plain(value), 'JSON data required');
      requireValue(!ancestors.has(value), 'Cyclic input'); ancestors.add(value);
      const out = array ? [] : {};
      const keys = Reflect.ownKeys(value);
      if (array) requireValue(keys.length === value.length + 1, 'Dense array required');
      const add = key => {
        requireValue(typeof key === 'string', 'String property required');
        const d = Object.getOwnPropertyDescriptor(value,key);
        requireValue(d && d.enumerable && Object.hasOwn(d,'value'), 'Own data property required');
        Object.defineProperty(out,key,{value:copy(d.value),enumerable:true,writable:true,configurable:true});
      };
      if (array) for (let i=0;i<value.length;i++) add(String(i)); else for (const key of keys) add(key);
      ancestors.delete(value); return out;
    }
    return copy(input);
  }
  const uuid = x => requireValue(Core.validateUUID(x).ok, 'Canonical UUID required');
  function requireExactDecimal(value) {
    requireValue(typeof value === 'string' && Core.validateNonNegativeDecimal(value).ok, 'Canonical bigint Decimal string required');
    return value;
  }
  const validateExactDecimal = value => typeof value === 'string' && Core.validateNonNegativeDecimal(value).ok;
  const contractError = () => freeze({ category:'SERVER_CONTRACT_ERROR',code:'INVALID_SERVER_ENVELOPE' });
  const context = input => { const checked=Core.createContext(input);requireValue(checked.ok,'Verified context shape required');return checked.value; };
  function versionWire(entries, ctx) {
    requireValue(Array.isArray(entries), 'Version array required');
    for (const entry of entries) { shape(entry,['scope_kind','scope_id','entity_id','version']); requireExactDecimal(entry.version); }
    const checked = Core.normalizeAffectedVersions(ctx,entries);
    requireValue(checked.ok,'Invalid scoped version vector');
    return entries;
  }
  function exactFields(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key,item] of Object.entries(value)) {
      if (['version','revision','generation','expected_revision','expected_candidate_revision'].includes(key)) requireExactDecimal(item);
      else exactFields(item);
    }
  }
  function decodeBootstrapEnvelope(raw, expectedCallerId) {
    try {
      uuid(expectedCallerId); const b=own(raw);
      requireValue(b.bootstrap_contract_version===1,'Bootstrap version');
      if (b.outcome==='ERROR') {
        shape(b,['bootstrap_contract_version','outcome','error']);shape(b.error,['code']);
        requireValue(typeof b.error.code==='string'&&Object.hasOwn(bootstrapErrors,b.error.code),'Bootstrap error');
        return freeze({category:bootstrapErrors[b.error.code],code:b.error.code});
      }
      shape(b,['bootstrap_contract_version','outcome','caller','selected_group','protocol','runtime']);
      requireValue(b.outcome==='OK','Bootstrap outcome');shape(b.caller,['person_id','legacy_person']);uuid(b.caller.person_id);
      requireValue(b.caller.person_id===expectedCallerId,'Bootstrap caller mismatch');
      requireValue([null,'N','V'].includes(b.caller.legacy_person),'Legacy display label');shape(b.selected_group,['group_id']);uuid(b.selected_group.group_id);
      shape(b.protocol,['client_protocol','supported_protocol','minimum_client_protocol','snapshot_contract_version']);
      for(const value of Object.values(b.protocol)) requireValue(Number.isSafeInteger(value)&&value>=0&&value<=2147483647,'Protocol integer');
      requireValue(b.protocol.client_protocol===1&&b.protocol.supported_protocol===1&&b.protocol.snapshot_contract_version===1&&b.protocol.minimum_client_protocol<=1,'Protocol compatibility');
      shape(b.runtime,['mode','activation_allowed']);requireValue(['legacy','read_only','target'].includes(b.runtime.mode),'Runtime mode');
      requireValue(typeof b.runtime.activation_allowed==='boolean'&&b.runtime.activation_allowed===(b.runtime.mode==='target'),'Activation mismatch');
      requireValue(b.runtime.mode!=='read_only','Maintenance must be error envelope');
      const decoded=freeze({category:'BOOTSTRAP_RESULT',bootstrap:b});bootstrapContexts.add(decoded);return decoded;
    } catch (_) { return contractError(); }
  }
  function prepareCommand(request, expectedContext) {
    const ctx=context(expectedContext),body=own(request);
    shape(body,['protocol_version','request_id','intent','target','expected_versions','parameters']);
    requireValue(body.protocol_version===1,'Command protocol');uuid(body.request_id);
    requireValue(typeof body.intent==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(body.intent),'Command intent');
    shape(body.target,['movie_id','group_id','night_id']);
    for(const value of Object.values(body.target)) if(value!==null)uuid(value);
    requireValue(body.target.group_id===null||body.target.group_id===ctx.groupId,'Command group mismatch');
    versionWire(body.expected_versions,ctx);requireValue(plain(body.parameters),'Command parameters');
    // Only known exact-integer wire fields; intent semantics remain server-owned.
    exactFields(body.parameters);
    const result=freeze({context:ctx,request:body});prepared.add(result);return result;
  }
  function decodeCommandResponse(raw, command) {
    try {
      requireValue(prepared.has(command),'Prepared command required');const r=own(raw);
      requireValue(r.protocol_version===1&&r.request_id===command.request.request_id,'Command response identity');uuid(r.request_id);
      if(['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(r.outcome)) {
        shape(r,['protocol_version','request_id','outcome','replayed','result','affected_versions']);
        requireValue(typeof r.replayed==='boolean'&&plain(r.result),'Command result');exactFields(r.result);versionWire(r.affected_versions,command.context);
      } else if(r.outcome==='STALE') {
        shape(r,['protocol_version','request_id','outcome','current_versions']);versionWire(r.current_versions,command.context);
      } else if(r.outcome==='REQUEST_ID_REUSE')shape(r,['protocol_version','request_id','outcome']);
      else if(r.outcome==='ERROR') {
        shape(r,['protocol_version','request_id','outcome','error']);shape(r.error,['code']);
        requireValue(typeof r.error.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(r.error.code),'Domain error code');
      } else throw new TypeError('Command outcome');
      return freeze({category:'SEMANTIC_RESULT',response:r});
    } catch (_) { return contractError(); }
  }
  class RPCFailure extends Error {
    constructor(category) { super(category);this.name='SnapshotRPCFailure';this.category=category;Object.freeze(this); }
  }
  function createTransport({rpc}) {
    requireValue(typeof rpc==='function','Injected RPC executor required');
    async function invoke(name,args) {
      let reply;
      try { reply=await rpc(name,args); } catch (_) { throw new RPCFailure('TRANSPORT_UNCERTAIN'); }
      try { shape(reply,['data','error']); }
      catch (_) { throw new RPCFailure('SERVER_CONTRACT_ERROR'); }
      if(reply.data===undefined || (reply.error!==null && reply.data!==null))throw new RPCFailure('SERVER_CONTRACT_ERROR');
      if(reply.error!==null) {
        // Executor metadata, never domain ERROR codes. Do not expose raw details.
        try {
          const e=reply.error;requireValue(e!==null&&typeof e==='object'&&!Array.isArray(e),'RPC error metadata');
          const status=Object.getOwnPropertyDescriptor(e,'status'),code=Object.getOwnPropertyDescriptor(e,'code');
          for(const d of [status,code])if(d)requireValue(Object.hasOwn(d,'value'),'RPC metadata accessor');
          throw new RPCFailure([401,403].includes(status?.value)||['42501','PGRST301','PGRST302','PGRST303'].includes(code?.value)?'AUTH_INVALIDATING':'TRANSPORT_UNCERTAIN');
        } catch(e) { if(e instanceof RPCFailure)throw e;throw new RPCFailure('SERVER_CONTRACT_ERROR'); }
      }
      return reply.data;
    }
    return Object.freeze({
      async bootstrap({callerId,clientProtocol=1}) {
        uuid(callerId);requireValue(clientProtocol===1,'Supported client protocol required');
        try { return decodeBootstrapEnvelope(await invoke('get_app_runtime_context',freeze({p_client_protocol:clientProtocol})),callerId); }
        catch(e) { return freeze({category:e instanceof RPCFailure?e.category:'SERVER_CONTRACT_ERROR',code:'RPC_FAILURE'}); }
      },
      createSnapshotProvider(decodedBootstrap) {
        requireValue(bootstrapContexts.has(decodedBootstrap),'Decoded authorized bootstrap required');
        const b=decodedBootstrap.bootstrap;
        requireValue(b.runtime.activation_allowed,'Target bootstrap required');
        return Object.freeze({async read(metadata) {
          // Validate request context only; SnapshotCore alone decodes domain payload.
          const m=own(metadata);shape(m,['callerId','groupId','contractVersion','contextEpoch','requestSequence','reason']);
          const ctx=context({callerId:m.callerId,groupId:m.groupId,contractVersion:m.contractVersion,contextEpoch:m.contextEpoch});
          requireValue(ctx.callerId===b.caller.person_id&&ctx.groupId===b.selected_group.group_id,'Provider context mismatch');
          requireValue(Number.isSafeInteger(m.requestSequence)&&m.requestSequence>0&&typeof m.reason==='string','Provider request metadata');
          return invoke('get_person_group_snapshot',freeze({p_group_id:ctx.groupId,p_contract_version:ctx.contractVersion}));
        }});
      },
      async execute(command) {
        requireValue(prepared.has(command),'Prepared command required');
        try { return decodeCommandResponse(await invoke('execute_app_command',freeze({p_request:command.request})),command); }
        catch(e) { return freeze({category:e instanceof RPCFailure?e.category:'SERVER_CONTRACT_ERROR',code:'RPC_FAILURE'}); }
      }
    });
  }
  return Object.freeze({createTransport,decodeBootstrapEnvelope,validateExactDecimal,prepareCommand,decodeCommandResponse});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=SnapshotTransport;
