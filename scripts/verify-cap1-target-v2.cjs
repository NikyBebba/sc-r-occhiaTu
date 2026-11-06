#!/usr/bin/env node
'use strict';
// Synthetic local PostgreSQL only. No network, Supabase credentials or live data.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {fixture,read,uid,N,V,X,G}=require('./person-group-command-test-support.cjs');
const Core=require('../js/snapshot/core');
const Transport=require('../js/snapshot/transport');
const Cache=require('../js/snapshot/cache');
const Adapter=require('../js/runtime/action-adapter');
let count=0;
const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{count++;console.log('PASS '+name);});
const request=(intent,m,n,parameters,version,id=crypto.randomUUID())=>({protocol_version:1,request_id:id,intent,
  target:{movie_id:m,group_id:G,night_id:n},expected_versions:[{scope_kind:n?'night':'group_film',scope_id:G,entity_id:n||m,version:String(version)}],
  parameters:{...(['RECORD_PAST_TOGETHER','EDIT_PAST_TOGETHER'].includes(intent)?{client_snapshot_contract_version:2}:{}),...parameters}});
async function main(){
 const e=await fixture();
 try {
  const m=uid(60701);await e.q('INSERT INTO movies(id,title) VALUES($1,$2)',[m,'CAP-1 synthetic']);
  await e.exec(read('database/supabase-migration-person-group-snapshot.sql'));
  await e.exec(read('database/supabase-migration-runtime-contracts.sql'));
  await e.exec("UPDATE app_protocol_state SET mode='target',minimum_client_protocol=1");
  const existing=(await e.q('SELECT id,date,status,completed_at FROM movie_nights ORDER BY id'));
  await e.exec(read('database/supabase-migration-cap1-target-v2.sql'));
  const login=async person=>e.q("SELECT set_config('request.jwt.claim.sub',$1,false)",[person]);
  const send=async body=>(await e.q('SELECT public.execute_app_command($1::jsonb) r',[JSON.stringify(body)]))[0].r;
  const snapshot=async version=>(await e.q('SELECT public.get_person_group_snapshot($1,$2) s',[G,version]))[0].s;
  const version=async(kind,id)=>(await e.q('SELECT version FROM domain_versions WHERE scope_kind=$1 AND scope_id=$2 AND entity_id=$3',[kind,G,id]))[0]?.version??0;
  await login(N);
  await check('migration keeps existing nights ordinary and protocol floor 1',async()=>{
    const rows=await e.q('SELECT id,date,status,completed_at,retrospective,night_memory FROM movie_nights ORDER BY id');
    assert.deepEqual(rows.map(x=>({id:x.id,date:x.date,status:x.status,completed_at:x.completed_at})),existing);
    assert(rows.every(x=>x.retrospective===false&&x.night_memory===null));
    assert.equal((await e.q('SELECT minimum_client_protocol FROM app_protocol_state'))[0].minimum_client_protocol,1);
  });
  await check('v69 bootstrap unchanged; explicit v2 bootstrap and narrow ACL',async()=>{
    const old=(await e.q('SELECT public.get_app_runtime_context(1) b'))[0].b;
    const next=(await e.q('SELECT public.get_app_runtime_context(1,2) b'))[0].b;
    assert.equal(old.protocol.snapshot_contract_version,1);assert.equal(next.protocol.snapshot_contract_version,2);
    assert.equal(Transport.decodeBootstrapEnvelope(old,N).category,'BOOTSTRAP_RESULT');
    assert.equal(Transport.decodeBootstrapEnvelope(next,N,2).category,'BOOTSTRAP_RESULT');
    const calls=[],transport=Transport.createTransport({rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='get_app_runtime_context')return {data:(await e.q(args.p_snapshot_contract_version===2?
        'SELECT public.get_app_runtime_context($1,$2) b':'SELECT public.get_app_runtime_context($1) b',
        args.p_snapshot_contract_version===2?[1,2]:[1]))[0].b,error:null};
      return {data:(await e.q('SELECT public.get_person_group_snapshot($1,$2) b',[args.p_group_id,args.p_contract_version]))[0].b,error:null};
    }});
    const legacy=await transport.bootstrap({callerId:N}),v2=await transport.bootstrap({callerId:N,snapshotContractVersion:2});
    assert.deepEqual(Object.keys(calls[0].args),['p_client_protocol']);
    assert.deepEqual(Object.keys(calls[1].args),['p_client_protocol','p_snapshot_contract_version']);
    assert.equal(legacy.category,'BOOTSTRAP_RESULT');assert.equal(v2.category,'BOOTSTRAP_RESULT');
    const provider=transport.createSnapshotProvider(v2);
    await assert.rejects(provider.read({callerId:N,groupId:G,contractVersion:1,contextEpoch:1,requestSequence:1,reason:'test'}));
    assert.equal((await provider.read({callerId:N,groupId:G,contractVersion:2,contextEpoch:1,requestSequence:1,reason:'test'})).contract_version,2);
    for(const name of ['execute_app_command_base_v1(jsonb)','cap1_execute_app_command(jsonb)'])
      assert.equal((await e.q('SELECT has_function_privilege($1,$2,$3) allowed',['authenticated','public.'+name,'EXECUTE']))[0].allowed,false);
    for(const name of ['execute_app_command_base_v1(jsonb)','cap1_execute_app_command(jsonb)','get_app_runtime_context(integer,integer)'])
      assert.equal((await e.q('SELECT has_function_privilege($1,$2,$3) allowed',['service_role','public.'+name,'EXECUTE']))[0].allowed,false);
    assert.equal((await e.q('SELECT has_function_privilege($1,$2,$3) allowed',['service_role','public.execute_app_command(jsonb)','EXECUTE']))[0].allowed,true);
    assert.equal((await e.q('SELECT has_function_privilege($1,$2,$3) allowed',['authenticated','public.get_app_runtime_context(integer,integer)','EXECUTE']))[0].allowed,true);
    const audit=(await e.q('SELECT public.runtime_4a4_audit() a'))[0].a;
    assert(!audit.issues.some(issue=>issue.startsWith('UNKNOWN_FUNCTION:')));
    assert(!audit.surfaces.some(surface=>surface.role==='authenticated'&&
      /execute_app_command_base_v1|cap1_execute_app_command/.test(surface.object||'')));
  });
  await check('ordinary snapshots still decode on v1 and v2',async()=>{
    for(const v of [1,2]){const s=await snapshot(v);assert.equal(s.contract_version,v);assert.equal(Core.decodeSnapshotEnvelope(s,{callerId:N,groupId:G,contractVersion:v,contextEpoch:1}).kind,'DECODED_SNAPSHOT');
      const hash=(await e.q("SELECT encode(sha256(convert_to(($1::jsonb #- '{payload_signature}' #- '{temporal,as_of}' #- '{temporal,next_temporal_invalidation_at}')::text,'UTF8')),'hex') value",[JSON.stringify(s)]))[0].value;
      assert.equal(s.payload_signature.value,hash);
      for(const n of s.nights)assert.equal(Object.hasOwn(n,'retrospective'),v===2);}
  });
  const beforeMovie=(await e.q('SELECT to_jsonb(m) v FROM movies m WHERE id=$1',[m]))[0].v;
  const active=await send(request('SCHEDULE_NIGHT',m,null,{date:'2099-01-01',time:'21:30'},0));
  await check('existing scheduling command remains available',()=>assert.equal(active.outcome,'SUCCESS'));
  const activeId=active.result.night_id;
  const groupBefore=await e.q('SELECT to_jsonb(s) v FROM group_movie_states s WHERE movie_id=$1',[m]);
  const personalBefore=await e.q('SELECT to_jsonb(s) v FROM personal_list_entries s WHERE movie_id=$1',[m]);
  const knownBody=request('RECORD_PAST_TOGETHER',m,null,{date:'2020-03-12',participants:[V,N],night_memory:'Cinema insieme',location:'Sala',snack:'Popcorn'},await version('group_film',m));
  const known=await send(knownBody);
  await check('past date creates distinct completed with N and V, no other domain mutation',async()=>{
    assert.equal(known.outcome,'SUCCESS');assert.notEqual(known.result.night_id,activeId);
    const row=(await e.q('SELECT * FROM movie_nights WHERE id=$1',[known.result.night_id]))[0];
    assert.equal(row.status,'completed');assert.equal(row.retrospective,true);assert.equal(row.time,null);assert.equal(row.date.toISOString().slice(0,10),'2020-03-12');
    assert.equal(row.night_memory,'Cinema insieme');assert.equal(row.selected_support_id,null);assert.equal(row.selected_convergence_cycle,null);
    assert.equal((await e.q('SELECT status FROM movie_nights WHERE id=$1',[activeId]))[0].status,'proposed');
    assert.deepEqual((await e.q('SELECT person_id FROM movie_night_participants WHERE night_id=$1 ORDER BY person_id',[known.result.night_id])).map(x=>x.person_id),[N,V]);
    assert.deepEqual((await e.q('SELECT to_jsonb(m) v FROM movies m WHERE id=$1',[m]))[0].v,beforeMovie);
    assert.deepEqual(await e.q('SELECT to_jsonb(s) v FROM group_movie_states s WHERE movie_id=$1',[m]),groupBefore);
    assert.deepEqual(await e.q('SELECT to_jsonb(s) v FROM personal_list_entries s WHERE movie_id=$1',[m]),personalBefore);
    assert.equal((await e.q('SELECT count(*)::int n FROM movie_night_intentions WHERE movie_id=$1',[m]))[0].n,0);
    const legacy=(await snapshot(1)).nights.find(x=>x.night_id===known.result.night_id);
    assert.equal(legacy.date,'2020-03-12');
    const calendar=vm.runInNewContext(read('js/ui/calendar.js')+';({nightsByDayKey})');
    assert(calendar.nightsByDayKey([{...legacy,id:legacy.night_id}],[{id:m}],2020,2).byDay['2020-03-12']);
  });
  await check('same request replay; new request allows same movie and day',async()=>{
    const replay=await send(knownBody);assert.equal(replay.outcome,'SUCCESS');assert.equal(replay.replayed,true);assert.equal(replay.result.night_id,known.result.night_id);
    const second=await send(request('RECORD_PAST_TOGETHER',m,null,{date:'2020-03-12',participants:[N,V]},await version('group_film',m)));
    assert.equal(second.outcome,'SUCCESS');assert.notEqual(second.result.night_id,known.result.night_id);
    const parallel=request('RECORD_PAST_TOGETHER',m,null,{date:'2020-03-12',participants:[N,V]},await version('group_film',m));
    const pair=await Promise.all([send(parallel),send(parallel)]);
    assert(pair.every(x=>x.outcome==='SUCCESS'));assert.equal(pair[0].result.night_id,pair[1].result.night_id);
    assert.equal((await e.q('SELECT count(*)::int n FROM movie_nights WHERE creation_request_id=$1',[parallel.request_id]))[0].n,1);
  });
  const unknown=await send(request('RECORD_PAST_TOGETHER',m,null,{date:null,participants:[N,V]},await version('group_film',m)));
  await check('unknown date v1 is exact and never displays registration day',async()=>{
    assert.equal(unknown.outcome,'SUCCESS');const s=await snapshot(1),n=s.nights.find(x=>x.night_id===unknown.result.night_id);
    assert.equal(n.date,null);assert.equal(n.completed_at,null);assert.equal(Object.hasOwn(n,'retrospective'),false);
    assert.equal(Core.decodeSnapshotEnvelope(s,{callerId:N,groupId:G,contractVersion:1,contextEpoch:1}).kind,'DECODED_SNAPSHOT');
    assert(s.group.collections.together_movie_ids.includes(m));
    const memories=vm.runInNewContext(read('js/ui/render/memories.js')+';({nightTimelineDate,completedNightLabel})');
    const calendar=vm.runInNewContext(read('js/ui/calendar.js')+';({nightsByDayKey})');
    const legacy={...n,id:n.night_id};
    assert.equal(memories.nightTimelineDate(legacy),null);assert.equal(memories.completedNightLabel({night:legacy,timelineDate:null}),'Data non registrata');
    assert.equal(calendar.nightsByDayKey([legacy],[{id:m}],2026,10).byDay['2026-11-03'],undefined);
  });
  await check('v2 retains technical timestamp, memory and strict validator',async()=>{
    const s=await snapshot(2),n=s.nights.find(x=>x.night_id===unknown.result.night_id);
    assert.equal(n.retrospective,true);assert.equal(n.date,null);assert.match(n.completed_at,/^2026-/);
    assert.equal(Core.decodeSnapshotEnvelope(s,{callerId:N,groupId:G,contractVersion:2,contextEpoch:1}).kind,'DECODED_SNAPSHOT');
    const bad=structuredClone(s);delete bad.nights[0].retrospective;
    assert.equal(Core.decodeSnapshotEnvelope(bad,{callerId:N,groupId:G,contractVersion:2,contextEpoch:1}).kind,'INVALID');
  });
  await check('invalid future date, participants, memory and payload are rejected',async()=>{
    for(const parameters of [
      {date:'2099-01-01',participants:[N,V]}, {date:null,participants:[N,X]},
      {date:null,participants:[N,N]}, {date:null,participants:[N,V],night_memory:'x'.repeat(1001)},
      {date:null,participants:[N,V],rating:9}
    ]){const r=await send(request('RECORD_PAST_TOGETHER',m,null,parameters,await version('group_film',m)));assert.equal(r.outcome,'ERROR',JSON.stringify(r));}
  });
  await check('wrong caller and stale CAS fail without writes',async()=>{
    await login(X);const forbidden=await send(request('RECORD_PAST_TOGETHER',m,null,{date:null,participants:[N,V]},await version('group_film',m)));assert.equal(forbidden.outcome,'ERROR');
    await login(N);const stale=await send(request('RECORD_PAST_TOGETHER',m,null,{date:null,participants:[N,V]},0));assert.equal(stale.outcome,'STALE');
  });
  await check('retro edit uses night CAS and only allowed fields',async()=>{
    const id=unknown.result.night_id,initial=await version('night',id);
    const r=await send(request('EDIT_PAST_TOGETHER',m,id,{date:'2020-03-13',night_memory:'Un ricordo',location:'Casa',snack:'Pizza'},initial));
    assert.equal(r.outcome,'SUCCESS');assert.equal(await version('night',id),Number(initial)+1);
    const row=(await e.q('SELECT date,night_memory,location,snack FROM movie_nights WHERE id=$1',[id]))[0];
    assert.equal(row.date.toISOString().slice(0,10),'2020-03-13');assert.equal(row.night_memory,'Un ricordo');
    const stale=await send(request('EDIT_PAST_TOGETHER',m,id,{date:null},initial));assert.equal(stale.outcome,'STALE');
    const sameId=request('EDIT_PAST_TOGETHER',m,id,{location:'Riprova'},await version('night',id));
    const first=await send(sameId),afterFirst=await version('night',id),replay=await send(sameId);
    assert.equal(first.outcome,'SUCCESS');assert.equal(replay.replayed,true);assert.equal(await version('night',id),afterFirst);
    for(const p of [{participants:[N,V]},{time:'20:00'},{night_memory:'x'.repeat(1001)}])
      assert.equal((await send(request('EDIT_PAST_TOGETHER',m,id,p,await version('night',id)))).outcome,'ERROR');
    assert.equal((await send(request('EDIT_PAST_TOGETHER',m,activeId,{date:null},await version('night',activeId)))).outcome,'ERROR');
    const otherMovie=uid(60702);await e.q('INSERT INTO movies(id,title) VALUES($1,$2)',[otherMovie,'Other synthetic film']);
    assert.equal((await send(request('EDIT_PAST_TOGETHER',otherMovie,id,{location:'No'},await version('night',id)))).outcome,'ERROR','a different movie cannot target this night');
    const otherGroup=uid(3002);
    const wrongGroup=request('EDIT_PAST_TOGETHER',m,id,{location:'No'},await version('night',id));wrongGroup.target.group_id=otherGroup;
    wrongGroup.expected_versions[0].scope_id=otherGroup;
    assert.equal((await send(wrongGroup)).outcome,'ERROR','a different group is rejected by selected-group authority');
    const wrongNight=request('EDIT_PAST_TOGETHER',m,activeId,{location:'No'},await version('night',activeId));
    assert.equal((await send(wrongNight)).outcome,'ERROR','nightId outside retrospective-completed scope is rejected');
    const noV=request('EDIT_PAST_TOGETHER',m,id,{location:'No'},await version('night',id));delete noV.parameters.client_snapshot_contract_version;
    const missingV2=await send(noV);assert.equal(missingV2.outcome,'ERROR','server requires explicit v2 compatibility declaration');
    await login(X);assert.equal((await send(request('EDIT_PAST_TOGETHER',m,id,{location:'No'},await version('night',id)))).outcome,'ERROR','nonmember cannot edit');
    await login(N);
    await e.q('UPDATE group_memberships SET active=false WHERE group_id=$1 AND person_id=$2',[G,V]);
    const inactiveMember=await send(request('RECORD_PAST_TOGETHER',m,null,{date:null,participants:[N,V]},await version('group_film',m)));
    assert.equal(inactiveMember.outcome,'ERROR','inactive group membership cannot be recorded as a participant');
    await e.q('UPDATE group_memberships SET active=true WHERE group_id=$1 AND person_id=$2',[G,V]);
    const ordinary=(await e.q("SELECT id,movie_id FROM movie_nights WHERE status='completed' AND NOT retrospective ORDER BY id LIMIT 1"))[0];
    if(ordinary){const ordinaryVersion=await version('night',ordinary.id);
      assert.equal((await send(request('EDIT_PAST_TOGETHER',ordinary.movie_id,ordinary.id,{location:'No'},ordinaryVersion))).outcome,'ERROR','ordinary completed night remains immutable');}
  });
  await check('v1/v2 cache keys isolated and accepted snapshots decode',async()=>{
    const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
    const cache=Cache.createCacheAdapter(storage),saved_at='2026-11-03T21:00:00.000000Z';
    for(const v of [1,2]){const context={callerId:N,groupId:G,contractVersion:v,contextEpoch:1},s=await snapshot(v);
      data.set('scorochiatu_snapshot_v'+v+':'+N+':'+G,JSON.stringify({cache_format_version:1,caller_id:N,group_id:G,contract_version:v,saved_at,snapshot:s}));
      assert.equal(cache.load(context).kind,'HIT');}
    assert.equal(data.size,2);
  });
  await check('adapter CAP-1 remains unavailable on v1 and requires online v2',async()=>{
    const make=v=>{const context={callerId:N,groupId:G,contractVersion:v,contextEpoch:1};const root=Core.decodeSnapshotEnvelope(awaitSnapshot[v],context).candidate;
      const state={generation:1,phase:'READY',controllerState:{context,view:{source:'ONLINE',root}}};
      const commands=[],runtime={getState:()=>state,executeIntent:cmd=>{commands.push(cmd);return Promise.resolve({category:'SEMANTIC_RESULT',response:{outcome:'SUCCESS',request_id:cmd.requestId}});},retryCommand:()=>{}};
      return {adapter:Adapter.createActionAdapter({runtime,newRequestId:()=>crypto.randomUUID()}),commands,state};};
    const awaitSnapshot={1:await snapshot(1),2:await snapshot(2)};
    const one=make(1),h1=one.adapter.captureContext();assert.equal((await one.adapter.recordPastTogether(h1,m,{date:null,participants:[N,V]})).outcome,'NOT_READY');
    const two=make(2),h2=two.adapter.captureContext();await two.adapter.recordPastTogether(h2,m,{date:null,participants:[N,V]});
    assert.equal(two.commands[0].intent,'RECORD_PAST_TOGETHER');assert.equal(two.commands[0].parameters.client_snapshot_contract_version,2);assert.equal(two.commands[0].expectedVersions.length,1);
    two.state.controllerState.view.source='CACHE';assert.equal((await two.adapter.recordPastTogether(h2,m,{date:null,participants:[N,V]})).outcome,'NOT_READY');
  });
  console.log('CAP1_TARGET_V2_PASS '+count);
 } finally {await e.db.close();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
