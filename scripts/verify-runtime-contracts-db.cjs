#!/usr/bin/env node
'use strict';
// 4A2 only: synthetic SQL bootstrap + injected transport tests. No live I/O.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,read,uid,N,V,X,G}=require('./person-group-command-test-support.cjs');
const Core=require('../js/snapshot/core'),T=require('../js/snapshot/transport');
const migration=read('database/supabase-migration-runtime-contracts.sql');
const ctx=()=>({callerId:N,groupId:G,contractVersion:1,contextEpoch:1});
const clone=x=>JSON.parse(JSON.stringify(x));
const boot=(mode='target',minimum=1)=>({bootstrap_contract_version:1,outcome:'OK',caller:{person_id:N,legacy_person:'N'},selected_group:{group_id:G},
 protocol:{client_protocol:1,supported_protocol:1,minimum_client_protocol:minimum,snapshot_contract_version:1},runtime:{mode,activation_allowed:mode==='target'}});
const request=()=>({protocol_version:1,request_id:uid(95001),intent:'PERSONAL_RATING',target:{movie_id:uid(1),group_id:null,night_id:null},
 expected_versions:[{scope_kind:'person_film',scope_id:N,entity_id:uid(1),version:'0'}],parameters:{value:0}});
const response=(r=request())=>({protocol_version:1,request_id:r.request_id,outcome:'SUCCESS',replayed:false,result:{movie_id:r.target.movie_id,night_id:null},affected_versions:[{...r.expected_versions[0],version:'1'}]});
let dbCount=0,transportCount=0;
const testDB=async(name,fn)=>{await fn();dbCount++;console.log('PASS DB '+name);};
const testTransport=async(name,fn)=>{await fn();transportCount++;console.log('PASS TRANSPORT '+name);};
function frozen(x){if(x&&typeof x==='object'){assert(Object.isFrozen(x));for(const v of Object.values(x))frozen(v);}}
async function databaseTests(){
 const e=await fixture();
 const call=async(person=N,protocol=1)=>{await e.q("SELECT set_config('request.jwt.claim.sub',$1,false)",[person||'']);return(await e.q('SELECT public.get_app_runtime_context($1) r',[protocol]))[0].r;};
 const error=(r,code)=>assert.deepEqual(r,{bootstrap_contract_version:1,outcome:'ERROR',error:{code}});
 const tx=async fn=>{await e.exec('BEGIN');try{return await fn();}finally{await e.exec('ROLLBACK');}};
 const tables=['auth.users','app_members','movies','movie_nights','votes','vetoes','swipe_sessions','swipes','groups','group_memberships',
 'personal_list_entries','group_movie_states','movie_night_participants','movie_night_intentions','domain_versions','domain_command_receipts','app_protocol_state'];
 const preserved=async()=>{const out={};for(const table of tables)out[table]=await e.q(`SELECT to_jsonb(t) r FROM ${table} t ORDER BY to_jsonb(t)::text`);return out;};
 const definitions=()=>e.q("SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname<>'get_app_runtime_context' ORDER BY p.oid");
 try{
  const before=await preserved(),functions=await definitions();await e.exec(migration);
  await testDB('D01 no Auth',async()=>error(await call(null),'UNAUTHENTICATED'));
  await testDB('D02 missing app member',async()=>error(await call(X),'MEMBERSHIP_REQUIRED'));
  await testDB('D03 uninitialized protocol/foundation',()=>tx(async()=>{await e.exec('DELETE FROM app_protocol_state');error(await call(),'FOUNDATION_NOT_READY');}));
  await testDB('D04 no configured current group',()=>tx(async()=>{await e.exec('UPDATE app_protocol_state SET current_group_id=NULL');error(await call(),'NO_ACTIVE_GROUP');}));
  await testDB('D05 archived current group',()=>tx(async()=>{await e.q("UPDATE groups SET status='archived' WHERE id=$1",[G]);error(await call(),'NO_ACTIVE_GROUP');}));
  await testDB('D06 inactive caller',()=>tx(async()=>{await e.q('UPDATE group_memberships SET active=false WHERE person_id=$1',[N]);error(await call(),'NO_ACTIVE_GROUP');}));
  await testDB('D07 non-member caller',()=>tx(async()=>{await e.q('DELETE FROM group_memberships WHERE person_id=$1',[N]);error(await call(),'NO_ACTIVE_GROUP');}));
  await testDB('D08 legacy mode preserves schema baseline zero',async()=>{const r=await call();assert.deepEqual(r,boot('legacy',0));assert.equal(T.decodeBootstrapEnvelope(r,N).category,'BOOTSTRAP_RESULT');});
  await testDB('D09 read_only maintenance',()=>tx(async()=>{await e.exec("UPDATE app_protocol_state SET mode='read_only'");error(await call(),'MAINTENANCE');}));
  await testDB('D10 target is tested only in rollback fixture',()=>tx(async()=>{await e.exec("UPDATE app_protocol_state SET mode='target',minimum_client_protocol=1");assert.deepEqual(await call(),boot());}));
  await testDB('D11 below minimum',()=>tx(async()=>{await e.exec('UPDATE app_protocol_state SET minimum_client_protocol=2');error(await call(),'PROTOCOL_UNSUPPORTED');}));
  await testDB('D12 unsupported/null client protocol',async()=>{for(const p of [0,-1,2,null])error(await call(N,p),'PROTOCOL_UNSUPPORTED');});
  await testDB('D13 authorization order hides configuration and protocol',()=>tx(async()=>{
   await e.exec('DELETE FROM app_protocol_state');error(await call(X,2),'MEMBERSHIP_REQUIRED');error(await call(null,2),'UNAUTHENTICATED');
  }));
  await testDB('D14 membership precedes protocol, protocol precedes mode',()=>tx(async()=>{
   await e.exec("UPDATE app_protocol_state SET mode='read_only'");error(await call(N,2),'PROTOCOL_UNSUPPORTED');
   await e.q('UPDATE group_memberships SET active=false WHERE person_id=$1',[N]);error(await call(N,2),'NO_ACTIVE_GROUP');
  }));
  await testDB('D15 identity comes from Auth, no caller/group RPC parameter',async()=>{
   const r=await call(V);assert.equal(r.caller.person_id,V);assert.equal(r.caller.legacy_person,'V');
   const p=(await e.q("SELECT proargnames,pronargs FROM pg_proc WHERE oid='public.get_app_runtime_context(integer)'::regprocedure"))[0];
   assert.equal(p.pronargs,1);assert.deepEqual(p.proargnames,['p_client_protocol']);
  });
  await testDB('D16 no group information in rejection',async()=>{const r=await call(X);assert.deepEqual(Object.keys(r).sort(),['bootstrap_contract_version','error','outcome']);assert(!JSON.stringify(r).includes(G));});
  await testDB('D17 exact success shape and nullable legacy adapter contract',async()=>{
   const r=await call();assert.equal(T.decodeBootstrapEnvelope(r,N).category,'BOOTSTRAP_RESULT');
   // Production app_members has NOT NULL N/V; NULL is a supported wire variant,
   // not a reason to weaken or mutate that existing mapping constraint.
   r.caller.legacy_person=null;assert.equal(T.decodeBootstrapEnvelope(r,N).category,'BOOTSTRAP_RESULT');
  });
  await testDB('D18 stable/definer/empty search_path',async()=>{
   const p=(await e.q("SELECT provolatile,prosecdef,proconfig FROM pg_proc WHERE oid='public.get_app_runtime_context(integer)'::regprocedure"))[0];
   assert.equal(p.provolatile,'s');assert.equal(p.prosecdef,true);assert(p.proconfig.includes('search_path=""'));
  });
  await testDB('D19 dormant EXECUTE ACL for all browser roles',async()=>{
   for(const role of ['anon','authenticated'])assert.equal((await e.q("SELECT has_function_privilege($1,'public.get_app_runtime_context(integer)','EXECUTE') v",[role]))[0].v,false);
   const acl=(await e.q("SELECT EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.get_app_runtime_context(integer)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') allowed"))[0].allowed;assert.equal(acl,false);
  });
  await testDB('D20 no configuration SELECT granted',async()=>{for(const role of ['anon','authenticated'])assert.equal((await e.q("SELECT has_table_privilege($1,'public.app_protocol_state','SELECT') v",[role]))[0].v,false);});
  await testDB('D21 read-only success/failure and preservation',async()=>{
   for(const person of [N,null,X]){await e.exec('BEGIN READ ONLY');try{const r=await call(person);assert.equal(r.outcome,person===N?'OK':'ERROR');}finally{await e.exec('ROLLBACK');}}
   assert.deepEqual(await preserved(),before);
  });
  await testDB('D22 existing function bodies and ACL unchanged',async()=>assert.deepEqual(await definitions(),functions));
  await testDB('D23 caller search_path cannot forge membership',()=>tx(async()=>{
   await e.exec("CREATE TEMP TABLE app_members(user_id uuid,person text); SET LOCAL search_path=pg_temp,public;");await e.q("INSERT INTO pg_temp.app_members VALUES($1,'N')",[X]);
   error(await call(X),'MEMBERSHIP_REQUIRED');
  }));
  await testDB('D24 definer authorization while config table remains unreadable',()=>tx(async()=>{
   await e.exec('GRANT EXECUTE ON FUNCTION public.get_app_runtime_context(integer) TO authenticated; SET LOCAL ROLE authenticated');
   const r=await call(N);assert.equal(r.caller.person_id,N);
   assert.equal((await e.q("SELECT has_table_privilege(current_user,'public.app_protocol_state','SELECT') v"))[0].v,false);
  }));
  await testDB('D25 fixture returns to original legacy mode, all data preserved',async()=>{assert.deepEqual(await preserved(),before);assert.deepEqual(await call(),boot('legacy',0));});
  await testDB('D26 prerequisite absence aborts installation atomically',async()=>{
   const dep=process.argv.find(a=>a.startsWith('--pglite='))?.slice(9)||'@electric-sql/pglite';const {PGlite}=require(dep);const empty=new PGlite();await empty.waitReady;
   try{await assert.rejects(empty.exec(migration),/RUNTIME_CONTRACT_PREREQUISITE/);await empty.exec('ROLLBACK');assert.equal((await empty.query("SELECT to_regprocedure('public.get_app_runtime_context(integer)') f")).rows[0].f,null);}finally{await empty.close();}
  });
  await testDB('D27 SQL contains only bootstrap object and no runtime activation',()=>{
   const sql=migration.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
   assert.equal((sql.match(/CREATE FUNCTION/g)||[]).length,1);assert(!/\b(?:INSERT|UPDATE|DELETE|GRANT|CREATE TABLE|CREATE POLICY|CREATE EXTENSION|PUBLICATION)\b/.test(sql));
  });
 }finally{await e.db.close();}
}
async function transportTests(){
 await testTransport('T01 exact immutable bootstrap, raw mutation isolated',()=>{const raw=boot(),d=T.decodeBootstrapEnvelope(raw,N);assert.equal(d.category,'BOOTSTRAP_RESULT');frozen(d);raw.caller.person_id=V;assert.equal(d.bootstrap.caller.person_id,N);assert(!Object.isFrozen(raw));});
 await testTransport('T02 all bootstrap errors classified',()=>{
  const codes={UNAUTHENTICATED:'AUTH_INVALIDATING',MEMBERSHIP_REQUIRED:'AUTH_INVALIDATING',NO_ACTIVE_GROUP:'CONTEXT_BLOCKING',PROTOCOL_UNSUPPORTED:'PROTOCOL_BLOCKING',MAINTENANCE:'MAINTENANCE',FOUNDATION_NOT_READY:'SERVER_NOT_READY'};
  for(const [code,category]of Object.entries(codes))assert.deepEqual(T.decodeBootstrapEnvelope({bootstrap_contract_version:1,outcome:'ERROR',error:{code}},N),{category,code});
 });
 await testTransport('T03 bootstrap required/unknown fields at every object',()=>{
  for(const locate of [b=>b,b=>b.caller,b=>b.selected_group,b=>b.protocol,b=>b.runtime]){
   const raw=boot();locate(raw).extra=true;assert.equal(T.decodeBootstrapEnvelope(raw,N).category,'SERVER_CONTRACT_ERROR');
   for(const key of Object.keys(locate(boot()))){const s=boot();delete locate(s)[key];assert.equal(T.decodeBootstrapEnvelope(s,N).category,'SERVER_CONTRACT_ERROR');}
  }
 });
 await testTransport('T04 invalid protocol/outcome/mode/activation/UUID/owner',()=>{
  const cases=[b=>b.bootstrap_contract_version=2,b=>b.outcome='NOPE',b=>b.caller.person_id=N.toUpperCase().replace('a','A')+'x',b=>b.caller.person_id=V,b=>b.caller.legacy_person='X',
   b=>b.protocol.client_protocol=2,b=>b.protocol.minimum_client_protocol=-1,b=>b.protocol.minimum_client_protocol=2,b=>b.protocol.minimum_client_protocol=0.5,
   b=>b.protocol.supported_protocol='1',b=>b.runtime.mode='other',b=>b.runtime.activation_allowed=false,b=>b.runtime.activation_allowed=1,b=>b.runtime.mode='read_only'];
  for(const change of cases){const raw=boot();change(raw);assert.equal(T.decodeBootstrapEnvelope(raw,N).category,'SERVER_CONTRACT_ERROR');}
 });
 await testTransport('T05 nullable label and legacy mode minimum zero',()=>{
  const raw=boot('legacy',0);raw.caller.legacy_person=null;assert.equal(T.decodeBootstrapEnvelope(raw,N).category,'BOOTSTRAP_RESULT');
 });
 await testTransport('T06 bootstrap accessors never execute',()=>{let reads=0;const raw=boot();Object.defineProperty(raw,'caller',{enumerable:true,get(){reads++;return {};}});assert.equal(T.decodeBootstrapEnvelope(raw,N).category,'SERVER_CONTRACT_ERROR');assert.equal(reads,0);});
 await testTransport('T07 exact Decimal accepted bounds',()=>{for(const value of ['0','1','12','9007199254740993','9223372036854775807'])assert(T.validateExactDecimal(value));});
 await testTransport('T08 every unsafe Decimal encoding rejected',()=>{for(const value of ['-1','+1',' 1','1 ','1.0','1e3','01','','9223372036854775808',0,1,Number.MAX_SAFE_INTEGER+1,1n,null,undefined,NaN,Infinity,{},[]])assert.equal(T.validateExactDecimal(value),false);});
 await testTransport('T09 immutable prepared ownership, zero/null/omission preserved',()=>{
  const raw=request();raw.parameters={rating:0,preference:false,review:null,extra:{values:['',null,0,false]}};const before=clone(raw),p=T.prepareCommand(raw,ctx());frozen(p);assert.deepEqual(raw,before);assert(!Object.isFrozen(raw));
  raw.parameters.extra.values.push('changed');assert.deepEqual(p.request.parameters,before.parameters);assert(!Object.hasOwn(p.request.parameters,'omitted'));assert(Object.hasOwn(p.request.parameters,'review'));
 });
 await testTransport('T10 invalid request envelope, UUID and scope context reject',()=>{
  for(const change of [r=>r.extra=1,r=>delete r.request_id,r=>r.request_id='N',r=>r.protocol_version=2,r=>r.intent='',r=>r.target.group_id=uid(7000),r=>r.target.extra=true,r=>r.parameters=null]){const r=request();change(r);assert.throws(()=>T.prepareCommand(r,ctx()),TypeError);}
 });
 await testTransport('T11 exact expected revision strings only',()=>{for(const value of [0,1,Number.MAX_SAFE_INTEGER+1,1n,'01','-1','9223372036854775808',null,undefined]){const r=request();r.expected_versions[0].version=value;assert.throws(()=>T.prepareCommand(r,ctx()),TypeError);}});
 await testTransport('T12 known generation/candidate revision fields exact',()=>{
  for(const key of ['generation','expected_candidate_revision'])for(const value of [1,1n,null,'01','9223372036854775808']){const r=request();r.parameters[key]=value;assert.throws(()=>T.prepareCommand(r,ctx()),TypeError);}
  const r=request();r.parameters.generation='9223372036854775807';assert.equal(T.prepareCommand(r,ctx()).request.parameters.generation,r.parameters.generation);
 });
 await testTransport('T13 non-JSON structures/sparse/accessors fail without hooks',()=>{
  let reads=0;const a=[{}];Object.defineProperty(a,'0',{enumerable:true,get(){reads++;return {};}});
  for(const values of [new Array(1),[{},,],a]){const r=request();r.expected_versions=values;assert.throws(()=>T.prepareCommand(r,ctx()),TypeError);}
  for(const value of [undefined,Infinity,NaN,new Date(),new Map(),()=>0,Symbol('x')]){const r=request();r.parameters.extra=value;assert.throws(()=>T.prepareCommand(r,ctx()),TypeError);}
  const r=request();r.parameters.self=r.parameters;assert.throws(()=>T.prepareCommand(r,ctx()),TypeError);assert.equal(reads,0);
 });
 await testTransport('T14 command success/noop/replay exact affected vector',()=>{
  const p=T.prepareCommand(request(),ctx());for(const outcome of ['SUCCESS','ALREADY_IN_TARGET_STATE'])for(const replayed of [true,false]){
   const r=response();r.outcome=outcome;r.replayed=replayed;r.affected_versions[0].version='9223372036854775807';const d=T.decodeCommandResponse(r,p);
   assert.equal(d.category,'SEMANTIC_RESULT');assert.equal(d.response.replayed,replayed);assert(Core.normalizeAffectedVersions(ctx(),d.response.affected_versions).ok);frozen(d);
  }
 });
 await testTransport('T15 stale exact current_versions',()=>{
  const p=T.prepareCommand(request(),ctx()),r={protocol_version:1,request_id:p.request.request_id,outcome:'STALE',current_versions:[{...p.request.expected_versions[0],version:'9007199254740993'}]};
  assert.equal(T.decodeCommandResponse(r,p).response.current_versions[0].version,'9007199254740993');r.current_versions[0].version=9007199254740992;assert.equal(T.decodeCommandResponse(r,p).category,'SERVER_CONTRACT_ERROR');
 });
 await testTransport('T16 request reuse and domain error stay semantic',()=>{const p=T.prepareCommand(request(),ctx());for(const r of [{protocol_version:1,request_id:p.request.request_id,outcome:'REQUEST_ID_REUSE'},{protocol_version:1,request_id:p.request.request_id,outcome:'ERROR',error:{code:'VALIDATION_ERROR'}}])assert.equal(T.decodeCommandResponse(r,p).category,'SEMANTIC_RESULT');});
 await testTransport('T17 malformed responses never become success',()=>{
  const p=T.prepareCommand(request(),ctx());for(const change of [r=>r.extra=true,r=>r.protocol_version=2,r=>r.request_id=uid(88000),r=>r.outcome='REPLAY',r=>r.replayed=1,r=>r.affected_versions[0].version=1,r=>r.affected_versions=new Array(1),r=>r.result.revision=1]){const r=response();change(r);assert.equal(T.decodeCommandResponse(r,p).category,'SERVER_CONTRACT_ERROR');}
 });
 await testTransport('T18 bootstrap injected RPC name/args, caller stays local',async()=>{
  const calls=[],t=T.createTransport({rpc:async(name,args)=>{calls.push({name,args});return{data:boot(),error:null};}});assert.equal((await t.bootstrap({callerId:N})).category,'BOOTSTRAP_RESULT');
  assert.deepEqual(calls,[{name:'get_app_runtime_context',args:{p_client_protocol:1}}]);
 });
 await testTransport('T19 Snapshot provider exact args, raw identity, no duplicate decoder',async()=>{
  const raw={notASnapshot:true},calls=[],t=T.createTransport({rpc:async(name,args)=>{calls.push({name,args});return{data:raw,error:null};}});
  const p=t.createSnapshotProvider(T.decodeBootstrapEnvelope(boot(),N));const result=await p.read({...ctx(),requestSequence:1,reason:'INITIAL'});
  assert.strictEqual(result,raw);assert.deepEqual(calls,[{name:'get_person_group_snapshot',args:{p_group_id:G,p_contract_version:1}}]);
 });
 await testTransport('T20 provider needs decoded target bootstrap and matching context',async()=>{
  const t=T.createTransport({rpc:async()=>assert.fail('Unexpected RPC')});assert.throws(()=>t.createSnapshotProvider({category:'BOOTSTRAP_RESULT',bootstrap:boot()}));
  assert.throws(()=>t.createSnapshotProvider(T.decodeBootstrapEnvelope(boot('legacy',0),N)));
  const p=t.createSnapshotProvider(T.decodeBootstrapEnvelope(boot(),N));await assert.rejects(p.read({...ctx(),groupId:uid(8000),requestSequence:1,reason:'INITIAL'}));
 });
 await testTransport('T21 retry keeps same immutable request after uncertainty',async()=>{
  const calls=[],raw=request(),p=T.prepareCommand(raw,ctx());let attempt=0;
  const t=T.createTransport({rpc:async(name,args)=>{calls.push({name,args,body:JSON.stringify(args)});if(attempt++===0)throw Error('Synthetic timeout after possible commit');return{data:response(p.request),error:null};}});
  assert.equal((await t.execute(p)).category,'TRANSPORT_UNCERTAIN');raw.request_id=uid(40000);raw.parameters.value=10;
  assert.equal((await t.execute(p)).category,'SEMANTIC_RESULT');assert.equal(calls.length,2);assert.equal(calls[0].name,'execute_app_command');assert.equal(calls[0].body,calls[1].body);assert.strictEqual(calls[0].args.p_request,calls[1].args.p_request);
 });
 await testTransport('T22 no implicit retry or fabricated prepared identity',async()=>{
  let calls=0;const t=T.createTransport({rpc:async()=>{calls++;throw Error('Synthetic connection loss');}});
  await assert.rejects(t.execute({context:ctx(),request:request()}));assert.equal(calls,0);
  const p=T.prepareCommand(request(),ctx());assert.equal((await t.execute(p)).category,'TRANSPORT_UNCERTAIN');await Promise.resolve();assert.equal(calls,1);
 });
 await testTransport('T23 auth executor failures distinct from semantic errors',async()=>{
  for(const error of [{status:401},{status:403},{code:'42501'},{code:'PGRST301'}]){
   const t=T.createTransport({rpc:async()=>({data:null,error})});assert.equal((await t.bootstrap({callerId:N})).category,'AUTH_INVALIDATING');
   assert.equal((await t.execute(T.prepareCommand(request(),ctx()))).category,'AUTH_INVALIDATING');
  }
 });
 await testTransport('T24 malformed executor envelopes fail closed',async()=>{
  for(const reply of [null,{},[],{data:boot(),error:null,extra:true},{data:null,error:'broken'}]){
   const t=T.createTransport({rpc:async()=>reply});assert.equal((await t.bootstrap({callerId:N})).category,'SERVER_CONTRACT_ERROR');
  }
 });
 await testTransport('T25 provider failure exposes safe category only',async()=>{
  const t=T.createTransport({rpc:async()=>{throw Error('Do not expose internal details');}}),p=t.createSnapshotProvider(T.decodeBootstrapEnvelope(boot(),N));
  await assert.rejects(p.read({...ctx(),requestSequence:1,reason:'INITIAL'}),e=>e.category==='TRANSPORT_UNCERTAIN'&&!e.message.includes('internal details'));
 });
 await testTransport('T26 unknown scopes delegate to SnapshotCore',()=>{
  const r=request();r.expected_versions[0].scope_kind='global';assert.throws(()=>T.prepareCommand(r,ctx()));
  const p=T.prepareCommand(request(),ctx()),s=response();s.affected_versions[0].scope_kind='global';assert.equal(T.decodeCommandResponse(s,p).category,'SERVER_CONTRACT_ERROR');
 });
 await testTransport('T27 no implicit I/O/clock/runtime imports',()=>{
  const file=path.join(__dirname,'../js/snapshot/transport.js'),code=fs.readFileSync(file,'utf8');
  assert(!/\b(?:window|document|localStorage|sessionStorage|fetch|supabase|setTimeout|setInterval|addEventListener)\b|Date\.now\s*\(/.test(code));
  assert(Object.isFrozen(T));assert.deepEqual(Object.keys(T).sort(),['createTransport','decodeBootstrapEnvelope','validateExactDecimal','prepareCommand','decodeCommandResponse'].sort());
 });
 await testTransport('T28 malformed bootstrap errors never become empty context',()=>{
  for(const error of [{code:'UNKNOWN'},{code:null},{code:{}},{code:'UNAUTHENTICATED',extra:1}])
   assert.equal(T.decodeBootstrapEnvelope({bootstrap_contract_version:1,outcome:'ERROR',error},N).category,'SERVER_CONTRACT_ERROR');
 });
 await testTransport('T29 affected-vector accessors and inherited holes are never executed',()=>{
  let reads=0;const p=T.prepareCommand(request(),ctx()),r=response(),items=[{}];Object.defineProperty(items,'0',{enumerable:true,get(){reads++;return {};}});r.affected_versions=items;
  assert.equal(T.decodeCommandResponse(r,p).category,'SERVER_CONTRACT_ERROR');assert.equal(reads,0);
  const proto=Object.create(Array.prototype);Object.defineProperty(proto,'0',{get(){reads++;return {};}});const sparse=new Array(1);Object.setPrototypeOf(sparse,proto);r.affected_versions=sparse;
  assert.equal(T.decodeCommandResponse(r,p).category,'SERVER_CONTRACT_ERROR');assert.equal(reads,0);
 });
 await testTransport('T30 Snapshot error payload remains raw for SnapshotCore',async()=>{
  const data={contract_version:1,outcome:'ERROR',error:{code:'FORBIDDEN'}},t=T.createTransport({rpc:async()=>({data,error:null})});
  const p=t.createSnapshotProvider(T.decodeBootstrapEnvelope(boot(),N));assert.strictEqual(await p.read({...ctx(),requestSequence:1,reason:'INITIAL'}),data);
 });
 await testTransport('T31 malformed/error metadata and conflicting data reject without getters',async()=>{
  let reads=0;const error={};Object.defineProperty(error,'code',{get(){reads++;return '42501';}});
  for(const reply of [{data:null,error},{data:undefined,error:null},{data:boot(),error:{status:401}}]){
   const t=T.createTransport({rpc:async()=>reply});assert.equal((await t.bootstrap({callerId:N})).category,'SERVER_CONTRACT_ERROR');
  }assert.equal(reads,0);
 });
 await testTransport('T32 command response is defensive and immutable',()=>{
  const p=T.prepareCommand(request(),ctx()),r=response(),d=T.decodeCommandResponse(r,p);frozen(d);r.affected_versions[0].version='99';r.result.movie_id=uid(777);
  assert.equal(d.response.affected_versions[0].version,'1');assert.equal(d.response.result.movie_id,uid(1));assert(!Object.isFrozen(r));
 });
 await testTransport('T33 prepared context has no mutable caller alias',()=>{
  const c=ctx(),r=request(),p=T.prepareCommand(r,c);c.groupId=uid(888);r.expected_versions[0].version='99';
  assert.equal(p.context.groupId,G);assert.equal(p.request.expected_versions[0].version,'0');
 });
 await testTransport('T34 dense empty vectors keep explicit empty semantics',()=>{
  const r=request();r.expected_versions=[];const p=T.prepareCommand(r,ctx()),s=response();s.affected_versions=[];s.outcome='ALREADY_IN_TARGET_STATE';
  assert.deepEqual(T.decodeCommandResponse(s,p).response.affected_versions,[]);
 });
 await testTransport('T35 property hooks and symbols cannot normalize command input',()=>{
  let reads=0;const values=[{toJSON(){reads++;return null;}},{valueOf(){reads++;return 0;}}];
  const hidden={};Object.defineProperty(hidden,'value',{value:0});values.push(hidden);const sym={};sym[Symbol('x')]=0;values.push(sym);
  for(const extra of values){const r=request();r.parameters.extra=extra;assert.throws(()=>T.prepareCommand(r,ctx()),TypeError);}assert.equal(reads,0);
 });
 await testTransport('T36 delayed executor remains explicit and generates no replacement request',async()=>{
  let resolve,calls=0;const t=T.createTransport({rpc:()=>{calls++;return new Promise(r=>{resolve=r;});}}),p=T.prepareCommand(request(),ctx()),pending=t.execute(p);
  await Promise.resolve();assert.equal(calls,1);assert.equal(p.request.request_id,uid(95001));resolve({data:response(),error:null});assert.equal((await pending).category,'SEMANTIC_RESULT');assert.equal(calls,1);
 });
}
(async()=>{await databaseTests();await transportTests();assert.equal(dbCount,27);assert.equal(transportCount,36);console.log(`Runtime contracts: DB ${dbCount}/27; transport ${transportCount}/36 PASS; dormant/local only.`);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
