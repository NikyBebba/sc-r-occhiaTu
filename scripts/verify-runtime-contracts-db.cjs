#!/usr/bin/env node
'use strict';
// 4A2 only: synthetic SQL bootstrap + injected transport tests. No live I/O.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,read,uid,N,V,X,G}=require('./person-group-command-test-support.cjs');
const Core=require('../js/snapshot/core'),T=require('../js/snapshot/transport');
const crypto=require('node:crypto');
const {inspectSettings,checkSettings}=require('./verify-runtime-contracts-installability.cjs');
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
  const before=await preserved(),functions=await definitions();
  const settings=await e.q('SELECT name,context FROM pg_settings'),installer={superuser:false,parameterSet:[]};
  assert.deepEqual(checkSettings(inspectSettings(migration),settings,installer),{pass:true,issues:[]});
  await e.exec(migration);
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
  await testDB('D22 historical functions unchanged except scoped content trigger bridge',async()=>{const after=await definitions();for(const f of functions){const a=after.find(x=>x.oid===f.oid);if(f.definition.includes('FUNCTION public.guard_movie_watch()')){
   assert.deepEqual(a.proacl,f.proacl);
   const restored=a.definition.replace(/ DECLARE content_status_exception boolean:=false;\n BEGIN\n[\s\S]*? IF NOT content_status_exception THEN\n([\s\S]*?) END IF;\n END;\n/,'$1');
   assert.notEqual(restored,a.definition,'Expected exactly the approved status wrapper');assert.equal(restored,f.definition,'All legacy source and metadata outside the wrapper must be exact');
  }else assert.deepEqual(a,f);}});
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
  await testDB('D27 candidate has no fence, grants, activation or new entities',()=>{
   const sql=migration.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
   assert(!/CREATE TABLE|CREATE POLICY|CREATE EXTENSION|ALTER PUBLICATION|UPDATE public\.app_protocol_state|GRANT EXECUTE/.test(sql));
   assert(sql.includes('CREATE FUNCTION public.execute_app_command'));assert(sql.includes('CREATE FUNCTION public.execute_match_action'));
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
(async()=>{await databaseTests();await transportTests();await writerTests();assert.equal(dbCount,27);assert.equal(transportCount,36);console.log(`Runtime contracts: DB ${dbCount}/27; transport ${transportCount}/36; writers ${writerCount} PASS; dormant/local only.`);})().catch(e=>{console.error(e.stack);process.exitCode=1;});

let writerCount=0;
async function writerTests(){
 const e=await fixture();let requestCounter=1000000,movieCounter=500000;
 const test=async(name,fn)=>{await e.exec('BEGIN');try{await fn();writerCount++;console.log('PASS WRITER '+name);}finally{await e.exec('ROLLBACK');}};
 const revision=async(k,s,m)=>(await e.q('SELECT coalesce((SELECT version::text FROM domain_versions WHERE scope_kind=$1 AND scope_id=$2 AND entity_id=$3),\'0\') v',[k,s,m]))[0].v;
 const token=async(k,s,m)=>({scope_kind:k,scope_id:s,entity_id:m,version:await revision(k,s,m)});
 const create=async()=>{const m=uid(++movieCounter);await e.q("SELECT set_config('request.jwt.claim.sub',$1,false)",[N]);await e.q('INSERT INTO movies(id,title) VALUES($1,$2)',[m,'Writer fixture '+movieCounter]);return m;};
 const body=(kind,m,g=null,n=null,p={},versions=[])=>({protocol_version:1,request_id:uid(++requestCounter),intent:kind,target:{movie_id:m,group_id:g,night_id:n},expected_versions:versions,parameters:p});
 const app=async(r,person=N)=>{await e.q("SELECT set_config('request.jwt.claim.sub',$1,false)",[person||'']);const out=(await e.q('SELECT execute_app_command($1) r',[JSON.stringify(r)]))[0].r;
  let prepared;try{prepared=T.prepareCommand(r,{callerId:person,groupId:G,contractVersion:1,contextEpoch:1});}catch(_){}
  if(prepared)assert.equal(T.decodeCommandResponse(out,prepared).category,'SEMANTIC_RESULT',JSON.stringify(out));return out;};
 const cmd=async(kind,m,g=null,n=null,p={},person=N)=>app(body(kind,m,g,n,p,
  ['SCHEDULE_NIGHT','QUICK_NIGHT','COMPLETE_NOW','CONTENT_CREATE','COMPLETE_NOW_WITH_CONTEXT'].includes(kind)?[]:
   [await token(n?'night':kind.startsWith('CONTENT_')?'content':g?'group_film':'person_film',n?g:kind.startsWith('CONTENT_')?m:g||person,n||m)]),person);
 const movie=async m=>(await e.q('SELECT * FROM movies WHERE id=$1',[m]))[0];
 const receipts=async()=>Number((await e.q('SELECT count(*) c FROM domain_command_receipts'))[0].c);
 const effectState=async m=>(await e.q(`SELECT jsonb_build_object(
  'movie',(SELECT to_jsonb(t)-'created_at'-'personal_liked_updated_at_n'-'personal_liked_updated_at_v' FROM movies t WHERE id=$1),
  'personal',(SELECT jsonb_agg(jsonb_build_array(person_id,active,generation,revision,end_reason) ORDER BY person_id) FROM personal_list_entries WHERE movie_id=$1),
  'group',(SELECT jsonb_agg(jsonb_build_array(group_id,revision,support_origin,support_state,proposed_by,suppressed_cycle) ORDER BY group_id) FROM group_movie_states WHERE movie_id=$1),
  'nights',(SELECT jsonb_agg(jsonb_build_array(group_id,date,time,snack,location,proposed_by,status,created_by_caller_id,selected_support_id IS NOT NULL,selected_convergence_cycle) ORDER BY created_at,id) FROM movie_nights WHERE movie_id=$1),
  'participants',(SELECT jsonb_agg(person_id ORDER BY person_id) FROM movie_night_participants p JOIN movie_nights n ON n.id=p.night_id WHERE n.movie_id=$1),
  'intentions',(SELECT jsonb_agg(jsonb_build_array(person_id,generation,invalidated_at IS NOT NULL) ORDER BY person_id) FROM movie_night_intentions WHERE movie_id=$1),
  'versions',(SELECT jsonb_agg(jsonb_build_array(scope_kind,scope_id,version,tombstone) ORDER BY scope_kind,scope_id,version) FROM domain_versions WHERE entity_id=$1 OR entity_id IN(SELECT id FROM movie_nights WHERE movie_id=$1))) state`,[m]))[0].state;
 const successful=r=>assert(['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(r.outcome),JSON.stringify(r));
 const assertAffected=async r=>{assert.equal(new Set(r.affected_versions.map(v=>[v.scope_kind,v.scope_id,v.entity_id].join('|'))).size,r.affected_versions.length);for(const v of r.affected_versions){assert.equal(typeof v.version,'string');assert.equal(v.version,await revision(v.scope_kind,v.scope_id,v.entity_id));}};
 const schedule=async(m,select=false)=>{
  const p={date:'2099-01-01',time:'21:30'};const versions=[];
  if(select){p.select_candidate=true;p.expected_candidate_revision=await revision('group_film',G,m);versions.push(await token('group_film',G,m));}
  const r=await app(body('SCHEDULE_NIGHT',m,G,null,p,versions));successful(r);return r.result.night_id;
 };
 try{
  await e.exec(migration);await e.exec("UPDATE app_protocol_state SET mode='target',minimum_client_protocol=1");
  const cases=['ADD_PERSONAL_LIST','REMOVE_PERSONAL_LIST','RETROSPECTIVE_SEEN','REMOVE_PERSONAL_SEEN','NEW_PERSONAL_VIEWING','PERSONAL_PREFERENCE','PERSONAL_RATING','PERSONAL_REVIEW',
   'PROPOSE_TO_GROUP','WITHDRAW_GROUP_CANDIDACY','TOGETHER_RATING','TOGETHER_REVIEW','SCHEDULE_NIGHT','QUICK_NIGHT','CONFIRM_NIGHT','CANCEL_NIGHT','EDIT_NIGHT','COMPLETE_NIGHT','COMPLETE_NOW'];
  for(const kind of cases)await test('compatibility '+kind,async()=>{
   const m=await create();let n=null,g=null,p={},person=N,expected;
   if(kind==='REMOVE_PERSONAL_LIST'||kind==='NEW_PERSONAL_VIEWING')successful(await cmd('ADD_PERSONAL_LIST',m));
   if(kind==='REMOVE_PERSONAL_SEEN')successful(await cmd('RETROSPECTIVE_SEEN',m));
   if(kind==='WITHDRAW_GROUP_CANDIDACY')successful(await cmd('PROPOSE_TO_GROUP',m,G));
   if(kind.startsWith('TOGETHER_'))successful(await cmd('COMPLETE_NOW',m,G,null,{participants:[N,V]}));
   if(['CONFIRM_NIGHT','CANCEL_NIGHT','EDIT_NIGHT','COMPLETE_NIGHT'].includes(kind)){n=await schedule(m);p.night_id=n;}
   if(kind==='CONFIRM_NIGHT')person=V;
   if(kind==='NEW_PERSONAL_VIEWING')p.generation='1';
   if(kind==='PERSONAL_PREFERENCE')p.value=false;
   if(kind.endsWith('RATING'))p.value=0;
   if(kind.endsWith('REVIEW'))p.value='Synthetic review';
   if(kind==='SCHEDULE_NIGHT'){p.date='2099-01-01';p.time='21:30';}
   if(kind==='EDIT_NIGHT')p.date='2099-01-02';
   if(kind.startsWith('COMPLETE_'))p.participants=[N,V];
   if(['PROPOSE_TO_GROUP','WITHDRAW_GROUP_CANDIDACY'].includes(kind)||kind.startsWith('TOGETHER_')||kind.includes('NIGHT')||kind==='COMPLETE_NOW')g=G;
   expected=['SCHEDULE_NIGHT','QUICK_NIGHT','COMPLETE_NOW'].includes(kind)?null:await revision(n?'night':g?'group_film':'person_film',n?G:g||person,n||m);
   const versions=expected===null?[]:[await token(n?'night':g?'group_film':'person_film',n?G:g||person,n||m)];
   const r=body(kind,m,g,n,p,versions),internal=clone(p);if(internal.generation)internal.generation=1;
   await e.exec('SAVEPOINT compare_raw');const old=await e.call(person,kind,m,g,expected,internal,r.request_id);const state=await effectState(m);await e.exec('ROLLBACK TO compare_raw');
   const current=await app(r,person);assert.equal(current.outcome,old.outcome,JSON.stringify(current));assert.deepEqual(await effectState(m),state);await assertAffected(current);
   const before=await effectState(m),count=await receipts(),replayed=await app(r,person);assert.equal(replayed.replayed,true);assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
   if(expected!==null){const stale=clone(r);stale.request_id=uid(++requestCounter);assert.equal((await app(stale,person)).outcome,'STALE');assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);}
   r.parameters.extra='reuse';assert.equal((await app(r,person)).outcome,'REQUEST_ID_REUSE');
  });
  await test('historical receipt replay, no rewrite and cross-family collision',async()=>{
   const m=await create(),rid=uid(++requestCounter);const r=await e.call(N,'ADD_PERSONAL_LIST',m,null,0,{},rid);successful(r);
   const receipt=(await e.q('SELECT to_jsonb(t) r FROM domain_command_receipts t WHERE request_id=$1',[rid]))[0].r;
   const b=body('ADD_PERSONAL_LIST',m,null,null,{},[{scope_kind:'person_film',scope_id:N,entity_id:m,version:'0'}]);b.request_id=rid;
   assert.equal((await app(b)).replayed,true);assert.deepEqual((await e.q('SELECT to_jsonb(t) r FROM domain_command_receipts t WHERE request_id=$1',[rid]))[0].r,receipt);
   b.intent='SET_PERSONAL_EVALUATION';b.parameters={review:'collision'};assert.equal((await app(b)).outcome,'REQUEST_ID_REUSE');
  });
  await test('personal composite full/partial/null/omission/noop/max+1',async()=>{
   const m=await create();successful(await cmd('SET_PERSONAL_EVALUATION',m,null,null,{preference:true,review:'keep'}));assert.equal((await movie(m)).seen_n,false);
   const a=await cmd('SET_PERSONAL_EVALUATION',m,null,null,{rating:0});successful(a);assert.equal(a.affected_versions.length,1);await assertAffected(a);
   assert.equal((await movie(m)).personal_liked_n,null);assert.equal((await movie(m)).review_text_n,'keep');assert.equal(Number((await movie(m)).seen_rating_n),0);
   successful(await cmd('SET_PERSONAL_EVALUATION',m,null,null,{rating:null,review:null}));const r=await cmd('SET_PERSONAL_EVALUATION',m,null,null,{rating:null,review:null});assert.equal(r.outcome,'ALREADY_IN_TARGET_STATE');assert.deepEqual(r.affected_versions,[]);
  });
  await test('personal composite stale/replay/reuse/invalid patch leaves no effects',async()=>{
   const m=await create(),b=body('SET_PERSONAL_EVALUATION',m,null,null,{rating:5,review:'one'},[await token('person_film',N,m)]);
   successful(await app(b));const before=await effectState(m),count=await receipts();assert.equal((await app(b)).replayed,true);
   const stale=clone(b);stale.request_id=uid(++requestCounter);assert.equal((await app(stale)).outcome,'STALE');
   for(const p of [{rating:11},{rating:1.01},{rating:5,preference:true},{review:123},{extra:true}])assert.equal((await cmd('SET_PERSONAL_EVALUATION',m,null,null,p)).outcome,'ERROR');
   assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
  });
  await test('seen+evaluation is retrospective and never satisfies active generation',async()=>{
   const m=await create();successful(await cmd('ADD_PERSONAL_LIST',m));const r=await cmd('RECORD_PERSONAL_SEEN_WITH_EVALUATION',m,null,null,{rating:7.5,review:'seen'});successful(r);await assertAffected(r);
   const h=(await e.q('SELECT * FROM personal_list_entries WHERE movie_id=$1',[m]))[0];assert.equal(h.active,true);assert.equal(h.generation,1);assert.equal((await movie(m)).seen_n,true);
   assert.equal((await e.q('SELECT count(*) c FROM movie_nights WHERE movie_id=$1',[m]))[0].c,0);
  });
  await test('Together evaluation is movie/group based and patchable',async()=>{
   const m=await create();successful(await cmd('COMPLETE_NOW',m,G,null,{participants:[N]}));
   const r=await cmd('SET_TOGETHER_EVALUATION',m,G,null,{rating:0,review:'Together'});successful(r);await assertAffected(r);assert.equal(r.affected_versions.length,1);
   successful(await cmd('SET_TOGETHER_EVALUATION',m,G,null,{rating:null}));assert.equal((await movie(m)).review_text_together,'Together');
   successful(await cmd('SET_TOGETHER_EVALUATION',m,G,null,{review:null}));assert.equal((await movie(m)).seen_n,false);
  });
  await test('Together composite requires completed fact and atomic rollback',async()=>{
   const m=await create(),count=await receipts(),before=await effectState(m);assert.equal((await cmd('SET_TOGETHER_EVALUATION',m,G,null,{rating:5})).outcome,'ERROR');
   assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
  });
  await test('completion context consumes/satisfies once with actual partial participants',async()=>{
   const m=await create();successful(await cmd('ADD_PERSONAL_LIST',m));successful(await cmd('ADD_PERSONAL_LIST',m,null,null,{},V));const n=await schedule(m,true);
   const p={participants:[N],snack:'Synthetic snack',location:'Synthetic room',evaluation:{rating:8,review:'Together'}};
   const b=body('COMPLETE_NIGHT_WITH_CONTEXT',m,G,n,p,[await token('night',G,n),await token('group_film',G,m)]),r=await app(b);successful(r);await assertAffected(r);
   assert.equal(await revision('night',G,n),'2');assert.equal((await e.q('SELECT count(*) c FROM movie_night_participants WHERE night_id=$1',[n]))[0].c,1);
   const list=await e.q('SELECT person_id,active,generation FROM personal_list_entries WHERE movie_id=$1 ORDER BY person_id',[m]);assert.deepEqual(list.map(x=>x.active),[false,true]);
   const final=await effectState(m),count=await receipts();assert.equal((await app(b)).replayed,true);assert.deepEqual(await effectState(m),final);assert.equal(await receipts(),count);
   const c=body('COMPLETE_NIGHT_WITH_CONTEXT',m,G,n,{participants:[N],snack:'changed'},[await token('night',G,n)]);assert.equal((await app(c)).outcome,'ERROR');assert.deepEqual(await effectState(m),final);
  });
  await test('completion context optional group CAS only for actual judgment change',async()=>{
   const m=await create(),n=await schedule(m);const r=await cmd('COMPLETE_NIGHT_WITH_CONTEXT',m,G,n,{participants:[N]});successful(r);
   const m2=await create(),n2=await schedule(m2),before=await effectState(m2);assert.equal((await cmd('COMPLETE_NIGHT_WITH_CONTEXT',m2,G,n2,{participants:[N],evaluation:{rating:5}})).outcome,'ERROR');assert.deepEqual(await effectState(m2),before);
  });
  await test('invalid participants/late evaluation rollback every derived effect',async()=>{
   for(const parameters of [{participants:[]},{participants:[N,N]},{participants:[X]},{participants:[N],evaluation:{rating:12}},{participants:[N],snack:'x'.repeat(81)}]){
    const m=await create();successful(await cmd('ADD_PERSONAL_LIST',m));const n=await schedule(m),before=await effectState(m),count=await receipts();
    const b=body('COMPLETE_NIGHT_WITH_CONTEXT',m,G,n,parameters,[await token('night',G,n),await token('group_film',G,m)]);assert.equal((await app(b)).outcome,'ERROR');assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
   }
  });
  await test('edit invalidation and successor generation are not satisfied',async()=>{
   const m=await create();successful(await cmd('ADD_PERSONAL_LIST',m));const n=await schedule(m);successful(await cmd('EDIT_NIGHT',m,G,n,{night_id:n,date:'2099-01-02'}));
   successful(await cmd('REMOVE_PERSONAL_LIST',m));successful(await cmd('ADD_PERSONAL_LIST',m));successful(await cmd('COMPLETE_NIGHT_WITH_CONTEXT',m,G,n,{participants:[N]}));
   const h=(await e.q('SELECT * FROM personal_list_entries WHERE movie_id=$1',[m]))[0];assert.equal(h.generation,2);assert.equal(h.active,true);
  });
  await test('complete-now context creates new event v1, never captures/satisfies List',async()=>{
   const m=await create();successful(await cmd('ADD_PERSONAL_LIST',m));const b=body('COMPLETE_NOW_WITH_CONTEXT',m,G,null,{participants:[N],snack:'now',evaluation:{review:'now'}},[await token('group_film',G,m)]);
   const r=await app(b);successful(r);await assertAffected(r);assert.equal(await revision('night',G,r.result.night_id),'1');
   assert.equal((await e.q('SELECT active FROM personal_list_entries WHERE movie_id=$1',[m]))[0].active,true);assert.equal((await e.q('SELECT count(*) c FROM movie_night_intentions WHERE movie_id=$1',[m]))[0].c,0);
  });
  await test('every composite reuses/rolls back/stales and has one bump per scope',async()=>{
   for(const kind of ['SET_PERSONAL_EVALUATION','RECORD_PERSONAL_SEEN_WITH_EVALUATION','SET_TOGETHER_EVALUATION','COMPLETE_NIGHT_WITH_CONTEXT','COMPLETE_NOW_WITH_CONTEXT']){
    const m=await create();let g=null,n=null,p={review:'composite'},versions=[await token('person_film',N,m)];
    if(kind==='SET_TOGETHER_EVALUATION'){g=G;successful(await cmd('COMPLETE_NOW',m,G,null,{participants:[N]}));versions=[await token('group_film',G,m)];}
    if(kind.startsWith('COMPLETE_')){g=G;p={participants:[N],evaluation:{review:'composite'}};versions=[await token('group_film',G,m)];if(kind==='COMPLETE_NIGHT_WITH_CONTEXT'){n=await schedule(m);versions=[await token('night',G,n),await token('group_film',G,m)];}}
    const b=body(kind,m,g,n,p,versions),r=await app(b);successful(r);await assertAffected(r);assert.equal((await app(b)).replayed,true);
    const before=await effectState(m),count=await receipts(),reuse=clone(b);reuse.parameters.review='collision';assert.equal((await app(reuse)).outcome,'REQUEST_ID_REUSE');
    const old=clone(b);old.request_id=uid(++requestCounter);assert.equal((await app(old)).outcome,'STALE');assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
   }
  });
  await test('late receipt failure rolls back all composite effects and bumps',async()=>{
   const m=await create();successful(await cmd('ADD_PERSONAL_LIST',m));const n=await schedule(m),before=await effectState(m),count=await receipts();
   await e.exec("CREATE FUNCTION public.test_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END $$;CREATE TRIGGER test_late BEFORE INSERT ON domain_command_receipts FOR EACH ROW EXECUTE FUNCTION public.test_late_failure();");
   const r=await app(body('COMPLETE_NIGHT_WITH_CONTEXT',m,G,n,{participants:[N],evaluation:{rating:9}},[await token('night',G,n),await token('group_film',G,m)]));
   assert.equal(r.outcome,'ERROR');assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
  });
  await test('veto add/noop/limit/remove/replay/old identity/ownership/week',async()=>{
   const m=await create(),other=await create(),week=(await e.q('SELECT app_current_week() w'))[0].w;
   successful(await cmd('VETO_ADD',m,G,null,{expected_week_key:week}));assert.equal((await cmd('VETO_ADD',m,G,null,{expected_week_key:week})).outcome,'ALREADY_IN_TARGET_STATE');
   assert.equal((await cmd('VETO_ADD',other,G,null,{expected_week_key:week})).error.code,'VETO_ALREADY_USED');
   const v=(await e.q('SELECT * FROM vetoes WHERE movie_id=$1',[m]))[0],remove=body('VETO_REMOVE',m,G,null,{expected_week_key:week,veto_id:v.id},[await token('group_film',G,m)]);
   successful(await app(remove));successful(await cmd('VETO_ADD',m,G,null,{expected_week_key:week}));const current=(await e.q('SELECT * FROM vetoes WHERE movie_id=$1',[m]))[0];assert.notEqual(current.id,v.id);
   assert.equal((await app(remove)).replayed,true);assert.equal((await cmd('VETO_REMOVE',m,G,null,{expected_week_key:week,veto_id:v.id})).outcome,'ALREADY_IN_TARGET_STATE');
   assert.equal((await cmd('VETO_REMOVE',m,G,null,{expected_week_key:week,veto_id:current.id},V)).outcome,'ALREADY_IN_TARGET_STATE');
   assert.equal((await cmd('VETO_ADD',m,G,null,{expected_week_key:'1900-W01'})).outcome,'STALE');assert.equal((await e.q('SELECT count(*) c FROM vetoes WHERE movie_id=$1',[m]))[0].c,1);
  });
  await test('content create dedupe, relationless, attribution and separate relation failure',async()=>{
   const b=body('CONTENT_CREATE',null,null,null,{title:'New content',tmdb_id:'9007199254740993'}),r=await app(b);successful(r);await assertAffected(r);
   const m=r.result.movie_id,row=await movie(m);assert.equal(row.added_by,'N');assert.equal(row.seen_n,false);assert.equal(row.in_shared_list,false);
   const duplicate=await app(body('CONTENT_CREATE',null,null,null,{title:'No overwrite',tmdb_id:'9007199254740993'}));assert.equal(duplicate.outcome,'ALREADY_IN_TARGET_STATE');assert.equal(duplicate.result.movie_id,m);assert.equal((await movie(m)).title,'New content');
   const title=await app(body('CONTENT_CREATE',null,null,null,{title:'New content'}));successful(title);assert.notEqual(title.result.movie_id,m);
   assert.equal((await cmd('SET_PERSONAL_EVALUATION',m,null,null,{rating:99})).outcome,'ERROR');assert(await movie(m));assert.equal((await app(b)).replayed,true);
  });
  await test('content metadata strict allowlist and exact IDs',async()=>{
   for(const p of [{title:null},{title:'x',seen_n:true},{title:'x',in_shared_list:true},{title:'x',status:'watched'},{title:'x',participants:[N]},{title:'x',tmdb_id:1},{title:'x',duration:123},{title:'x',matched:'yes'}])assert.equal((await app(body('CONTENT_CREATE',null,null,null,p))).outcome,'ERROR');
   const m=await create();for(const p of [{seen_n:true},{personal_liked_n:true},{surprise_by:'V'},{scheduled_date:'2099-01-01'},{tmdb_id:'01'}])assert.equal((await cmd('CONTENT_UPDATE_METADATA',m,null,null,p)).outcome,'ERROR');
  });
  await test('content marker restores absent/neutral values before a second write',async()=>{
   const m=await create();await schedule(m);
   assert.notEqual((await e.q("SELECT current_setting('scorochiatu.content_write',true) v"))[0].v,'on');
   for(const value of ['', 'off', 'neutral']){
    await e.q("SELECT set_config('scorochiatu.content_write',$1,true)",[value]);
    successful(await cmd('CONTENT_UPDATE_METADATA',m,null,null,{duration:value+' min'}));
    assert.equal((await e.q("SELECT current_setting('scorochiatu.content_write',true) v"))[0].v,value);
    await e.q("UPDATE movies SET status='watchlist' WHERE id=$1",[m]);assert.equal((await movie(m)).status,'tonight');
   }
  });
  await test('ambient on is rejected before any command effect or receipt',async()=>{
   const m=await create(),before=await effectState(m),count=await receipts();
   await e.q("SELECT set_config('scorochiatu.content_write','on',true)");
   const r=await app(body('CONTENT_SET_CINEMA',m,null,null,{value:true},[await token('content',m,m)]));
   assert.equal(r.error.code,'FORBIDDEN');assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
   assert.equal((await e.q("SELECT current_setting('scorochiatu.content_write',true) v"))[0].v,'on');
  });
  await test('writer error/savepoint rollback restores marker and all writes',async()=>{
   const m=await create(),before=await movie(m);
   await e.q("SELECT set_config('scorochiatu.content_write','neutral',true)");
   await e.exec('SAVEPOINT marker_error');
   await assert.rejects(e.q("SELECT app_content_write($1,'{\"title\":null}',false,'N')",[m]),/null value/);
   await e.exec('ROLLBACK TO SAVEPOINT marker_error');
   assert.equal((await e.q("SELECT current_setting('scorochiatu.content_write',true) v"))[0].v,'neutral');assert.deepEqual(await movie(m),before);
   await e.exec('SAVEPOINT marker_success');
   await e.q("SELECT app_content_write($1,'{\"title\":\"temporary\"}',false,'N')",[m]);
   await e.exec('ROLLBACK TO SAVEPOINT marker_success');assert.deepEqual(await movie(m),before);
   assert.equal((await e.q("SELECT current_setting('scorochiatu.content_write',true) v"))[0].v,'neutral');
  });
  await test('nested writer restores outer marker and rejects nested public command',async()=>{
   const outer=await create(),inner=await create();await schedule(outer);await schedule(inner);
   await e.exec(`CREATE FUNCTION pg_temp.nested_content_writer() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
     IF NEW.id='${outer}'::uuid THEN
      IF current_setting('scorochiatu.content_write',true)<>'on' THEN RAISE EXCEPTION 'OUTER_MARKER_MISSING';END IF;
      IF public.execute_app_command('{}')->'error'->>'code'<>'FORBIDDEN' THEN RAISE EXCEPTION 'NESTED_COMMAND_ADMITTED';END IF;
      PERFORM public.app_content_write('${inner}','{"duration":"nested"}',false,'N');
      BEGIN
       PERFORM public.app_content_write('${inner}','{"title":null}',false,'N');
       RAISE EXCEPTION 'INNER_FAILURE_EXPECTED';
      EXCEPTION WHEN not_null_violation THEN NULL; END;
      IF current_setting('scorochiatu.content_write',true)<>'on' THEN RAISE EXCEPTION 'OUTER_MARKER_LOST';END IF;
     END IF; RETURN NEW;
    END $$; CREATE TRIGGER nested_content_test AFTER UPDATE ON movies FOR EACH ROW EXECUTE FUNCTION pg_temp.nested_content_writer();`);
   successful(await cmd('CONTENT_UPDATE_METADATA',outer,null,null,{duration:'outer'}));
   assert.equal((await movie(inner)).duration,'nested');assert.equal((await movie(inner)).status,'watchlist');
   assert.notEqual((await e.q("SELECT current_setting('scorochiatu.content_write',true) v"))[0].v,'on');
  });
  await test('public content failure restores marker before subsequent legacy write',async()=>{
   const m=await create();await schedule(m);const before=await effectState(m),count=await receipts();
   const r=await cmd('CONTENT_UPDATE_METADATA',m,null,null,{tmdb_id:'777777'});
   assert.equal(r.error.code,'FORBIDDEN');assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
   assert.notEqual((await e.q("SELECT current_setting('scorochiatu.content_write',true) v"))[0].v,'on');
   await e.q("UPDATE movies SET duration='after failure' WHERE id=$1",[m]);assert.equal((await movie(m)).status,'tonight');
  });
  await test('legacy and maintenance owner writes ignore forged marker',async()=>{
   const m=await create();await schedule(m);
   for(const mode of ['legacy','read_only']){
    await e.q('UPDATE app_protocol_state SET mode=$1',[mode]);
    await e.q("SELECT set_config('scorochiatu.content_write','on',true)");
    await e.q("UPDATE movies SET platform=$2,status='watchlist' WHERE id=$1",[m,mode]);assert.equal((await movie(m)).status,'tonight');
   }
   await e.exec('DELETE FROM app_protocol_state');
   await e.q("UPDATE movies SET status='watchlist' WHERE id=$1",[m]);assert.equal((await movie(m)).status,'tonight');
  });
  await test('authenticated forged marker neither reads protocol state nor skips guard',async()=>{
   const m=await create();await schedule(m);
   await e.exec('GRANT SELECT,UPDATE ON movies TO authenticated; SET LOCAL ROLE authenticated');
   await e.q("SELECT set_config('scorochiatu.content_write','on',true)");
   await e.q("UPDATE movies SET status='watchlist' WHERE id=$1",[m]);assert.equal((await movie(m)).status,'tonight');
   await e.exec('RESET ROLE');
  });
  await test('content CAS/update/noop, status bridge and legacy guard preserved',async()=>{
   const m=await create();await schedule(m);assert.equal((await movie(m)).status,'watchlist');
   const b=body('CONTENT_UPDATE_METADATA',m,null,null,{duration:'120 min'},[await token('content',m,m)]);successful(await app(b));assert.equal((await movie(m)).status,'watchlist');
   assert.equal((await app({...b,request_id:uid(++requestCounter)})).outcome,'STALE');assert.equal((await cmd('CONTENT_UPDATE_METADATA',m,null,null,{duration:'120 min'})).outcome,'ALREADY_IN_TARGET_STATE');
   await e.q("UPDATE movies SET duration='121 min' WHERE id=$1",[m]);assert.equal((await movie(m)).status,'tonight');
   assert.notEqual((await e.q("SELECT current_setting('scorochiatu.content_write',true) flag"))[0].flag,'on');
  });
  await test('content surprise/cinema attribution and boolean boundaries',async()=>{
   const m=await create();successful(await cmd('CONTENT_SET_SURPRISE',m,null,null,{enabled:true}));assert.equal((await movie(m)).surprise_by,'N');
   assert.equal((await cmd('CONTENT_SET_SURPRISE',m,null,null,{enabled:true},V)).outcome,'ERROR');successful(await cmd('CONTENT_SET_SURPRISE',m,null,null,{enabled:false},V));
   const r=await cmd('CONTENT_SET_CINEMA',m,null,null,{value:true});successful(r);await assertAffected(r);assert.equal((await movie(m)).cinema_watchlist,true);
   assert.equal((await cmd('CONTENT_SET_CINEMA',m,null,null,{value:1})).outcome,'ERROR');
  });
  await test('relationless content delete retains tombstone and CREATE replay',async()=>{
   const b=body('CONTENT_CREATE',null,null,null,{title:'Delete me'}),r=await app(b),m=r.result.movie_id;successful(r);
   const d=await cmd('CONTENT_DELETE',m);successful(d);assert.equal(await movie(m),undefined);await assertAffected(d);
   assert.deepEqual((await e.q("SELECT version::text v,tombstone FROM domain_versions WHERE scope_kind='content' AND entity_id=$1",[m]))[0],{v:'2',tombstone:true});
   const replay=await app(b);assert.equal(replay.replayed,true);assert.equal(replay.result.movie_id,m);assert.equal(await movie(m),undefined);
   assert.equal((await e.q("SELECT count(*) c FROM domain_command_receipts WHERE command_kind='CONTENT_CREATE' AND movie_id IS NOT NULL"))[0].c,0);
  });
  await test('delete protection covers every legacy and target relation family',async()=>{
   const setups=[
    m=>e.q('UPDATE movies SET seen_n=true WHERE id=$1',[m]),m=>e.q('UPDATE movies SET seen_rating_n=0 WHERE id=$1',[m]),m=>e.q("UPDATE movies SET review_text_n='memory' WHERE id=$1",[m]),
    m=>e.q('UPDATE movies SET personal_liked_n=false WHERE id=$1',[m]),m=>e.q('INSERT INTO personal_list_entries(person_id,movie_id) VALUES($1,$2)',[N,m]),
    m=>e.q('INSERT INTO group_movie_states(group_id,movie_id) VALUES($1,$2)',[G,m]),m=>e.q("INSERT INTO movie_nights(movie_id,group_id,status) VALUES($1,$2,'cancelled')",[m,G]),
    m=>e.q("INSERT INTO votes(movie_id,person,liked) VALUES($1,'N',true)",[m]),m=>e.q("INSERT INTO vetoes(movie_id,person,week_key) VALUES($1,'N','1900-W01')",[m]),
    m=>e.q("INSERT INTO swipe_sessions(seed,deck,status) VALUES(1,ARRAY[$1::uuid],'closed')",[m]),
    m=>e.q("INSERT INTO domain_command_receipts(caller_id,request_id,command_kind,payload_fingerprint,result_status,result,movie_id) VALUES($1,$2,'TEST',repeat('a',64),'success','{}',$3)",[N,uid(++requestCounter),m])];
   for(const setup of setups){const m=await create();await setup(m);const before=await movie(m),count=await receipts();const r=await cmd('CONTENT_DELETE',m);assert.equal(r.outcome,'ERROR');assert.equal(r.error.code,'CONTENT_PROTECTED');assert.deepEqual(await movie(m),before);assert.equal(await receipts(),count);}
  });
  await test('delete protects participants/intention/satisfaction and Together judgment',async()=>{
   const m=await create();successful(await cmd('ADD_PERSONAL_LIST',m));const n=await schedule(m);successful(await cmd('COMPLETE_NIGHT_WITH_CONTEXT',m,G,n,{participants:[N]}));
   assert.equal((await cmd('CONTENT_DELETE',m)).error.code,'CONTENT_PROTECTED');assert.equal((await e.q('SELECT count(*) c FROM movie_night_participants WHERE night_id=$1',[n]))[0].c,1);
   assert.equal((await e.q('SELECT count(*) c FROM movie_night_intentions WHERE night_id=$1',[n]))[0].c,1);
  });
  await test('public protocol/auth/ACL do not expose generic mutation',async()=>{
   const m=await create(),r=body('SET_PERSONAL_EVALUATION',m,null,null,{rating:5},[await token('person_film',N,m)]);
   assert.equal((await app(r,X)).outcome,'ERROR');assert.equal((await app(r,null)).outcome,'ERROR');
   await e.exec("UPDATE app_protocol_state SET mode='legacy'");assert.equal((await app(r)).error.code,'MAINTENANCE');await e.exec("UPDATE app_protocol_state SET mode='read_only'");assert.equal((await app(r)).error.code,'MAINTENANCE');
   for(const fn of ['execute_app_command(jsonb)','execute_match_action(integer,text,jsonb)','app_phase2_effects(uuid,text,uuid,uuid,bigint,jsonb)','app_content_write(uuid,jsonb,boolean,text)'])
    assert.equal((await e.q("SELECT has_function_privilege('authenticated',$1,'EXECUTE') p",['public.'+fn]))[0].p,false);
  });
  await test('facade rejects null scope and checks every supplied creation CAS',async()=>{
   const m=await create(),bad=body('PERSONAL_REVIEW',m,null,null,{value:'never'},[await token('person_film',N,m),{scope_kind:null,scope_id:N,entity_id:m,version:'0'}]);
   assert.equal((await app(bad)).outcome,'ERROR');assert.equal((await movie(m)).review_text_n,null);
   successful(await cmd('PROPOSE_TO_GROUP',m,G));
   const b=body('SCHEDULE_NIGHT',m,G,null,{date:'2099-01-01',time:'21:30'},[{scope_kind:'group_film',scope_id:G,entity_id:m,version:'0'}]);
   const before=await effectState(m),count=await receipts();assert.equal((await app(b)).outcome,'STALE');assert.deepEqual(await effectState(m),before);assert.equal(await receipts(),count);
  });
  await test('large exact versions and no domain_revision dependency',async()=>{
   const m=await create();await e.q("INSERT INTO domain_versions(scope_kind,scope_id,entity_id,version) VALUES('person_film',$1,$2,9223372036854775806)",[N,m]);
   const r=await cmd('SET_PERSONAL_EVALUATION',m,null,null,{review:'large'});successful(r);assert.equal(r.affected_versions[0].version,'9223372036854775807');
  });
  const match=async(action,p,person=N)=>{await e.q("SELECT set_config('request.jwt.claim.sub',$1,false)",[person||'']);return(await e.q('SELECT execute_match_action(1,$1,$2) r',[action,JSON.stringify(p)]))[0].r;};
  const matchSetup=async()=>{await e.exec("UPDATE swipe_sessions SET status='closed' WHERE status IN ('open','matched')");const m=await create();successful(await cmd('PROPOSE_TO_GROUP',m,G));return m;};
  await test('Match start/duplicate/frozen deck/attribution and no domain writes',async()=>{
   const m=await matchSetup(),count=await receipts(),versions=await e.q('SELECT * FROM domain_versions ORDER BY scope_kind,scope_id,entity_id');
   const a=await match('start',{seed:17,deck:[m]});successful(a);assert.equal(a.session.created_by,'N');assert.deepEqual(a.session.deck,[m]);
   const b=await match('start',{seed:23,deck:[m]},V);assert.equal(b.outcome,'ALREADY_IN_TARGET_STATE');assert.equal(b.session.id,a.session.id);assert.equal(b.session.seed,17);
   assert.equal(await receipts(),count);assert.deepEqual(await e.q('SELECT * FROM domain_versions ORDER BY scope_kind,scope_id,entity_id'),versions);
  });
  await test('Match swipe duplicate, pending, acknowledge, matched identity and close',async()=>{
   const m=await matchSetup(),s=(await match('start',{seed:1,deck:[m]})).session;
   successful(await match('swipe',{session_id:s.id,movie_id:m,liked:true}));assert.equal((await match('swipe',{session_id:s.id,movie_id:m,liked:false})).outcome,'ALREADY_IN_TARGET_STATE');
   successful(await match('swipe',{session_id:s.id,movie_id:m,liked:true},V));assert.equal((await match('reconcile-done',{session_id:s.id})).session.status,'open');
   const ack=await match('acknowledge-match',{session_id:s.id,matched_movie_id:m});assert.equal(ack.session.matched_movie_id,m);assert.equal(ack.session.status,'done');
   assert.equal((await match('acknowledge-match',{session_id:s.id,matched_movie_id:m},V)).outcome,'ALREADY_IN_TARGET_STATE');assert.equal((await match('close',{session_id:s.id})).outcome,'STALE');
   const next=await match('start',{seed:2,deck:[]});successful(next);const closed=await match('close',{session_id:next.session.id});assert.equal(closed.session.status,'closed');
  });
  const matchPair=async()=>{const a=await matchSetup(),b=await create();successful(await cmd('PROPOSE_TO_GROUP',b,G));return {a,b,s:(await match('start',{seed:1,deck:[a,b]})).session.id};};
  const doubleLike=async(s,m)=>{for(const person of [N,V])successful(await match('swipe',{session_id:s,movie_id:m,liked:true},person));};
  const progress=async s=>(await e.q('SELECT app_match_progress($1,$2,app_current_week()) p',[s,G]))[0].p;
  await test('H1 permanent reproducer: identical acknowledgment A never recognizes pending B',async()=>{
   const {a,b,s}=await matchPair(),count=await receipts(),versions=await e.q('SELECT * FROM domain_versions ORDER BY scope_kind,scope_id,entity_id');
   await doubleLike(s,a);const p={session_id:s,matched_movie_id:a};const first=await match('acknowledge-match',p);assert.equal(first.outcome,'SUCCESS');assert.equal(first.session.status,'open');
   await doubleLike(s,b);assert.equal((await progress(s)).pending_movie_id,b);
   for(const caller of [N,V]){const retry=await match('acknowledge-match',p,caller);assert.equal(retry.outcome,'ALREADY_IN_TARGET_STATE');assert.deepEqual(retry.session,first.session);assert.equal((await progress(s)).pending_movie_id,b);}
   const next=await match('acknowledge-match',{session_id:s,matched_movie_id:b},V);assert.equal(next.outcome,'SUCCESS');assert.equal(next.session.matched_movie_id,b);assert.equal(next.session.status,'done');
   const old=await match('acknowledge-match',p);assert.equal(old.outcome,'STALE');assert.deepEqual(old.session,next.session);
   assert.deepEqual((await match('acknowledge-match',{session_id:s,matched_movie_id:b})).session,next.session);
   assert.equal(await receipts(),count);assert.deepEqual(await e.q('SELECT * FROM domain_versions ORDER BY scope_kind,scope_id,entity_id'),versions);
  });
  await test('H1 acknowledgment requires explicit canonical observed identity',async()=>{
   const {a,s}=await matchPair();await doubleLike(s,a);
   for(const p of [{session_id:s},{session_id:s,matched_movie_id:null},{session_id:s,matched_movie_id:'N'},{session_id:s,matched_movie_id:a,extra:true}])assert.equal((await match('acknowledge-match',p)).outcome,'ERROR');
   assert.equal((await progress(s)).pending_movie_id,a);
  });
  await test('H1 wrong movie/session or unproven match cannot be acknowledged',async()=>{
   const {a,b,s}=await matchPair();await doubleLike(s,a);
   for(const p of [{session_id:s,matched_movie_id:b},{session_id:s,matched_movie_id:uid(999)},{session_id:uid(999),matched_movie_id:a}])assert.equal((await match('acknowledge-match',p)).outcome,'STALE');
   assert.equal((await progress(s)).pending_movie_id,a);
  });
  await test('H1 stale observed A cannot substitute newer pending B',async()=>{
   const {a,b,s}=await matchPair();await doubleLike(s,a);await doubleLike(s,b);
   const r=await match('acknowledge-match',{session_id:s,matched_movie_id:a});assert.equal(r.outcome,'STALE');assert.equal(r.session.matched_movie_id,null);assert.equal((await progress(s)).pending_movie_id,b);
  });
  await test('H1 older retry cannot roll recognition back after later content becomes ineligible',async()=>{
   const a=await matchSetup(),b=await create(),c=await create();for(const m of [b,c])successful(await cmd('PROPOSE_TO_GROUP',m,G));
   const s=(await match('start',{seed:1,deck:[a,b,c]})).session.id,p={session_id:s,matched_movie_id:a};await doubleLike(s,a);successful(await match('acknowledge-match',p));
   await doubleLike(s,b);const next=await match('acknowledge-match',{session_id:s,matched_movie_id:b});assert.equal(next.session.status,'open');
   await e.q('UPDATE movies SET cinema_watchlist=true WHERE id=$1',[b]);assert.equal((await progress(s)).pending_movie_id,a);
   const retry=await match('acknowledge-match',p,V);assert.equal(retry.outcome,'STALE');assert.deepEqual(retry.session,next.session);
  });
  await test('H1 acknowledgment authorization precedes retry and sensitive result',async()=>{
   const {a,s}=await matchPair();await doubleLike(s,a);const p={session_id:s,matched_movie_id:a};successful(await match('acknowledge-match',p));
   for(const person of [X,null]){const r=await match('acknowledge-match',p,person);assert.equal(r.outcome,'ERROR');assert(!Object.hasOwn(r,'session'));}
   await e.q('UPDATE group_memberships SET active=false WHERE person_id=$1',[V]);const r=await match('acknowledge-match',p,V);assert.equal(r.outcome,'ERROR');assert(!Object.hasOwn(r,'session'));
  });
  await test('H1 close prevents new acknowledgment; identical recognized retry never reopens',async()=>{
   const first=await matchPair();await doubleLike(first.s,first.a);successful(await match('close',{session_id:first.s}));assert.equal((await match('acknowledge-match',{session_id:first.s,matched_movie_id:first.a})).outcome,'STALE');
   const {a,s}=await matchPair();await doubleLike(s,a);successful(await match('acknowledge-match',{session_id:s,matched_movie_id:a}));const closed=await match('close',{session_id:s});
   const retry=await match('acknowledge-match',{session_id:s,matched_movie_id:a},V);assert.equal(retry.outcome,'ALREADY_IN_TARGET_STATE');assert.deepEqual(retry.session,closed.session);
  });
  await test('Match authorization, parameter injection, no arbitrary patches',async()=>{
   const m=await matchSetup();assert.equal((await match('start',{seed:1,deck:[m]},X)).outcome,'ERROR');
   for(const p of [{seed:1,deck:[m],created_by:'V'},{seed:-1,deck:[m]},{seed:1,deck:[m,m]},{seed:1,deck:[uid(999)]}])assert.equal((await match('start',p)).outcome,'ERROR');
   assert.equal((await match('update',{status:'matched'})).outcome,'ERROR');
  });
  await test('Match reconcile parity with pure current client algorithm',async()=>{
   const m=await matchSetup(),s=(await match('start',{seed:1,deck:[m]})).session;
   const vm=require('node:vm'),algorithm=vm.runInNewContext(read('js/match.js')+';({currentIndex,pendingMatch})',{choiceEligible:x=>!!x?.in_shared_list});
   for(const steps of [[],[{person:'N',liked:true}],[{person:'N',liked:false},{person:'V',liked:false}]]){
    await e.q('DELETE FROM swipes WHERE session_id=$1',[s.id]);for(const step of steps)await e.q('INSERT INTO swipes(session_id,movie_id,person,liked) VALUES($1,$2,$3,$4)',[s.id,m,step.person,step.liked]);
    const swipes=steps.map(x=>({...x,movie_id:m})),progress=(await e.q('SELECT app_match_progress($1,$2,app_current_week()) p',[s.id,G]))[0].p;
    assert.equal(progress.done,algorithm.currentIndex([m],swipes,[{id:m,in_shared_list:true}])===1);assert.equal(progress.pending_movie_id,algorithm.pendingMatch(s,swipes,[m],[{id:m,in_shared_list:true}]));
   }
   const done=await match('reconcile-done',{session_id:s.id});assert.equal(done.session.status,'done');assert.equal(done.session.matched_movie_id,null);
  });
 }finally{await e.db.close();}
}
