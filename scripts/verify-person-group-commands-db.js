#!/usr/bin/env node
// In-memory PostgreSQL semantics; these are NOT multi-backend race tests.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {fixture,read,uid,N,V,X,G}=require('./person-group-command-test-support.cjs');
let env,count=0;
(async()=>{
 env=await fixture();const {q,exec,call,rev}=env;
 const test=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
 const ok=r=>assert.equal(r.outcome,'SUCCESS',JSON.stringify(r));
 const personal=(p,m)=>rev('person_film',p,m), group=m=>rev('group_film',G,m), night=n=>rev('night',G,n);
 const add=async(p,m)=>call(p,'ADD_PERSONAL_LIST',m,null,await personal(p,m));
 const remove=async(p,m)=>call(p,'REMOVE_PERSONAL_LIST',m,null,await personal(p,m));
 const propose=async(p,m)=>call(p,'PROPOSE_TO_GROUP',m,G,await group(m));
 const candidate=async m=>(await q('SELECT domain_candidate($1,$2) value',[G,m]))[0].value;
 const entry=async(p,m)=>(await q('SELECT * FROM personal_list_entries WHERE person_id=$1 AND movie_id=$2',[p,m]))[0];
 const schedule=async(m,select=false,extra={})=>call(N,'SCHEDULE_NIGHT',m,G,null,{date:'2099-01-01',time:'21:30',...extra,
   ...(select?{select_candidate:true,expected_candidate_revision:await group(m)}:{})});
 const complete=async(m,id,people=[N,V],request)=>call(N,'COMPLETE_NIGHT',m,G,await night(id),{night_id:id,participants:people},request);
 const initialMovies=await q('SELECT * FROM movies ORDER BY id');
 const guardBefore=(await q("SELECT pg_get_functiondef('guard_movie_watch()'::regprocedure) value"))[0].value;
 await test('PostgreSQL runner bootstrap transcript replays on an independent fresh embedded instance',async()=>{
   const other=new env.db.constructor();await other.waitReady;
   try {await other.exec(env.bootstrapSQL);assert.equal((await other.query('SELECT count(*)::int n FROM movies')).rows[0].n,95);}
   finally {await other.close();}
 });
 await test('candidate installation preserves legacy values, RPC, grants and protocol',async()=>{
   assert.deepEqual(await env.preservation(),env.beforeCommands);
   console.log('COMMAND MIGRATION PRESERVATION SHA256: '+crypto.createHash('sha256').update(JSON.stringify(env.beforeCommands)).digest('hex'));
   assert.equal((await q('SELECT mode FROM app_protocol_state'))[0].mode,'legacy');
   for(const role of ['anon','authenticated']) assert.equal((await q("SELECT has_function_privilege($1,'domain_command(uuid,text,uuid,uuid,bigint,jsonb)','EXECUTE') value",[role]))[0].value,false);
   assert(!/domain_revision/.test(read('database/supabase-migration-person-group-commands.sql')));
   assert.equal((await q("SELECT pg_get_functiondef('guard_movie_watch()'::regprocedure) value"))[0].value,guardBefore);
 });
 await test('authorization and payload boundary reject identity/cycle/fingerprint injection',async()=>{
   for(const who of [X,null]) assert.equal((await call(who,'ADD_PERSONAL_LIST',uid(10))).outcome,'FORBIDDEN');
   for(const params of [{person_id:V},{caller_id:V},{cycle:{}},{payload_fingerprint:'x'}]) assert.equal((await call(N,'ADD_PERSONAL_LIST',uid(10),null,0,params)).outcome,'VALIDATION_ERROR');
   assert.equal((await call(N,'PROPOSE_TO_GROUP',uid(10),uid(3999),0)).outcome,'FORBIDDEN');
 });
 const m=uid(10),req=crypto.randomUUID();
 await test('add, replay, no-op, stale, request reuse and revision authority',async()=>{
   const r=await call(N,'ADD_PERSONAL_LIST',m,null,0,{},req);ok(r);
   assert.equal((await entry(N,m)).generation,1);
   assert.deepEqual(await call(N,'ADD_PERSONAL_LIST',m,null,0,{},req),{...r,replayed:true});
   assert.equal((await call(N,'ADD_PERSONAL_LIST',m,null,0)).outcome,'STALE');
   assert.equal((await call(N,'ADD_PERSONAL_LIST',m,null,1)).outcome,'ALREADY_IN_TARGET_STATE');
   assert.equal(await personal(N,m),1);
   assert.equal((await call(N,'REMOVE_PERSONAL_LIST',m,null,1,{},req)).outcome,'REQUEST_ID_REUSE');
   assert.equal(await candidate(m),true); // preserved legacy support, not invented intention
 });
 await test('generation remove/re-add advances once; seen and judgment stay independent',async()=>{
   ok(await remove(N,m));ok(await add(N,m));assert.equal((await entry(N,m)).generation,2);
   assert.equal((await q('SELECT seen_n,seen_rating_n FROM movies WHERE id=$1',[m]))[0].seen_n,false);
 });
 const fresh=uid(95);
 await test('first interest alone is not candidacy; second converges without explicit support',async()=>{
   ok(await add(N,fresh));assert.equal(await candidate(fresh),false);
   ok(await add(V,fresh));assert.equal(await candidate(fresh),true);
   assert.equal((await q('SELECT count(*)::int n FROM group_movie_states WHERE movie_id=$1',[fresh]))[0].n,0);
   assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[fresh]))[0].in_shared_list,false);
 });
 await test('withdraw suppresses C across re-read/no-op ADD; break/reform creates C2',async()=>{
   ok(await call(N,'WITHDRAW_GROUP_CANDIDACY',fresh,G,await group(fresh)));
   const old=(await q('SELECT suppressed_cycle FROM group_movie_states WHERE movie_id=$1',[fresh]))[0].suppressed_cycle;
   assert.equal(await candidate(fresh),false);
   assert.equal((await add(V,fresh)).outcome,'ALREADY_IN_TARGET_STATE');assert.equal(await candidate(fresh),false);
   ok(await remove(N,fresh));ok(await add(N,fresh));assert.equal(await candidate(fresh),true);
   assert.notDeepEqual((await q('SELECT domain_cycle($1,$2) c',[G,fresh]))[0].c,old);
 });
 await test('explicit support overrides suppression; withdrawal preserves personal intentions',async()=>{
   ok(await call(N,'WITHDRAW_GROUP_CANDIDACY',fresh,G,await group(fresh)));ok(await propose(V,fresh));
   assert.equal(await candidate(fresh),true);ok(await remove(N,fresh));assert.equal(await candidate(fresh),true);
   ok(await call(V,'WITHDRAW_GROUP_CANDIDACY',fresh,G,await group(fresh)));assert.equal(await candidate(fresh),false);
   assert.equal((await entry(V,fresh)).active,true);
   assert.equal((await call(V,'WITHDRAW_GROUP_CANDIDACY',fresh,G,await group(fresh))).outcome,'ALREADY_IN_TARGET_STATE');
 });
 await test('proposal of seen film requires no judgment; replacement creates a new support token',async()=>{
   ok(await call(N,'RETROSPECTIVE_SEEN',uid(11),null,0));ok(await propose(N,uid(11)));
   const first=(await q('SELECT autonomous_support_id FROM group_movie_states WHERE movie_id=$1',[uid(11)]))[0].autonomous_support_id;
   ok(await propose(V,uid(11)));
   assert.notEqual((await q('SELECT autonomous_support_id FROM group_movie_states WHERE movie_id=$1',[uid(11)]))[0].autonomous_support_id,first);
 });
 let sched;
 await test('future scheduling captures precise generations; night starts at scoped version 1',async()=>{
   ok(await add(N,uid(12)));ok(await add(V,uid(12)));const r=await schedule(uid(12),true);ok(r);sched=r.night_id;
   assert.equal(await night(sched),1);
   assert.equal((await q('SELECT count(*)::int n FROM movie_night_intentions WHERE night_id=$1',[sched]))[0].n,2);
   assert.equal((await q('SELECT count(*)::int n FROM movie_night_participants WHERE night_id=$1',[sched]))[0].n,0);
 });
 await test('confirm checks membership/author/CAS; no-op creates receipt without increment',async()=>{
   assert.equal((await call(N,'CONFIRM_NIGHT',uid(12),G,1,{night_id:sched})).outcome,'FORBIDDEN');
   ok(await call(V,'CONFIRM_NIGHT',uid(12),G,1,{night_id:sched}));
   assert.equal((await call(V,'CONFIRM_NIGHT',uid(12),G,2,{night_id:sched})).outcome,'ALREADY_IN_TARGET_STATE');
   assert.equal(await night(sched),2);
 });
 await test('completion satisfies only actual participants; retry and new request do not repeat effects',async()=>{
   const request=crypto.randomUUID(),params={night_id:sched,participants:[N]};
   const r=await call(N,'COMPLETE_NIGHT',uid(12),G,2,params,request);ok(r);
   assert.equal(await night(sched),3);assert.equal((await entry(N,uid(12))).end_reason,'satisfied');
   assert.equal((await entry(V,uid(12))).active,true);
   assert.deepEqual(await call(N,'COMPLETE_NIGHT',uid(12),G,2,params,request),{...r,replayed:true});
   assert.equal((await complete(uid(12),sched,[N])).outcome,'ALREADY_IN_TARGET_STATE');
   assert.equal((await complete(uid(12),sched,[N,V])).outcome,'VALIDATION_ERROR');
   assert.equal(await night(sched),3);
   assert.equal((await q('SELECT seen_n,seen_v,seen_rating_together FROM movies WHERE id=$1',[uid(12)]))[0].seen_n,false);
 });
 await test('remove/re-add A to B preserves B at completion; later support also survives',async()=>{
   const f=uid(13);ok(await add(N,f));const r=await schedule(f,true);ok(r);
   ok(await remove(N,f));ok(await add(N,f));ok(await propose(N,f));
   const support=(await q('SELECT autonomous_support_id FROM group_movie_states WHERE movie_id=$1',[f]))[0].autonomous_support_id;
   ok(await complete(f,r.night_id));assert.equal((await entry(N,f)).generation,2);assert.equal((await entry(N,f)).active,true);
   const state=(await q('SELECT * FROM group_movie_states WHERE movie_id=$1',[f]))[0];
   assert.equal(state.autonomous_support_id,support);assert.equal(state.support_state,'active');
 });
 await test('schedule edit invalidates A without recapture; stale completion cannot mutate',async()=>{
   const f=uid(14);ok(await add(N,f));const r=await schedule(f);ok(r);
   ok(await call(N,'EDIT_NIGHT',f,G,1,{night_id:r.night_id,date:'2099-02-02'}));
   assert.equal((await q('SELECT invalidated_at IS NOT NULL yes FROM movie_night_intentions WHERE night_id=$1',[r.night_id]))[0].yes,true);
   assert.equal((await call(N,'COMPLETE_NIGHT',f,G,1,{night_id:r.night_id,participants:[N]})).outcome,'STALE');
   ok(await complete(f,r.night_id));assert.equal((await entry(N,f)).active,true);
 });
 await test('cancel preserves support/intention; direct schedule and cancelled completion do not invent candidacy',async()=>{
   const f=uid(15),r=await schedule(f,true);ok(r);
   ok(await call(N,'CANCEL_NIGHT',f,G,1,{night_id:r.night_id}));assert.equal(await candidate(f),true);
   assert.equal((await complete(f,r.night_id)).outcome,'VALIDATION_ERROR');
   const direct=await schedule(fresh);ok(direct);ok(await call(N,'CANCEL_NIGHT',fresh,G,1,{night_id:direct.night_id}));assert.equal(await candidate(fresh),false);
 });
 await test('retrodated/time-less schedule and quick do not capture intentions',async()=>{
   const f=uid(16);ok(await add(N,f));
   const old=await schedule(f,false,{date:'2000-01-01'});ok(old);
   const noTime=await schedule(f,false,{time:null});ok(noTime);
   const quick=await call(N,'QUICK_NIGHT',f,G,null,{});ok(quick);
   for(const r of [old,noTime,quick]) assert.equal((await q('SELECT count(*)::int n FROM movie_night_intentions WHERE night_id=$1',[r.night_id]))[0].n,0);
 });
 await test('Rome unique/gap/fold and non-future capture preserve exact generations deterministically',async()=>{
   const instant=async local=>(await q("SELECT domain_unique_rome_instant($1::timestamp)::text value",[local]))[0].value;
   assert.equal(await instant('2027-10-31 02:30'),null);
   assert.equal(await instant('2027-03-28 02:30'),null);
   assert.equal(await instant('infinity'),null);
   assert.equal((await q("SELECT domain_unique_rome_instant('2027-01-02 21:30')='2027-01-02 20:30Z'::timestamptz ok"))[0].ok,true);
   for(const role of ['anon','authenticated']) assert.equal((await q("SELECT has_function_privilege($1,'domain_unique_rome_instant(timestamp)','EXECUTE') ok",[role]))[0].ok,false);
   // Pin ONLY the capture decision clock in this isolated test database. Keep
   // lifecycle timestamps/triggers real; restore the exact installed definition.
   // No client-controlled clock hook is added to the production command.
   const definition=(await q("SELECT pg_get_functiondef('domain_command(uuid,text,uuid,uuid,bigint,jsonb)'::regprocedure) value"))[0].value;
   const seam='future_start>clock_timestamp()';
   assert.equal(definition.split(seam).length,2);
   await exec(definition.replace(seam,"future_start>'2027-01-01 00:00Z'::timestamptz"));
   try {
     for(const [i,date,time,capture] of [[50,'2027-01-02','21:30',true],[51,'2027-10-31','02:30',false],
       [52,'2027-03-28','02:30',false],[53,'2026-12-31','21:30',false],[54,'2027-01-01','01:00',false]]) {
       const f=uid(i);ok(await add(N,f));const before=await entry(N,f);
       const r=await schedule(f,false,{date,time});ok(r);
       const refs=await q('SELECT * FROM movie_night_intentions WHERE night_id=$1',[r.night_id]);
       assert.equal(refs.length,capture?1:0);
       if(capture) {assert.equal(refs[0].generation,before.generation);assert.equal((await entry(N,f)).active,true);}
       ok(await complete(f,r.night_id,[N]));
       const after=await entry(N,f);assert.equal(after.generation,before.generation);
       assert.equal(after.active,!capture);assert.equal(after.end_reason,capture?'satisfied':null);
       if(!capture) assert.deepEqual(after,before);
     }
   } finally {await exec(definition);}
   assert.equal((await q("SELECT pg_get_functiondef('domain_command(uuid,text,uuid,uuid,bigint,jsonb)'::regprocedure) value"))[0].value,definition);
 });
 await test('complete-now preserves personal list; distinct request creates distinct rewatch event',async()=>{
   const f=uid(17);ok(await add(N,f));const request=crypto.randomUUID(),params={participants:[V,N]};
   const a=await call(N,'COMPLETE_NOW',f,G,null,params,request);ok(a);
   assert.equal((await call(N,'COMPLETE_NOW',f,G,null,{participants:[N,V]},request)).replayed,true);
   const b=await call(N,'COMPLETE_NOW',f,G,null,params);ok(b);assert.notEqual(a.night_id,b.night_id);
   assert.equal((await entry(N,f)).active,true);assert.equal(await night(a.night_id),1);
 });
 await test('invalid participants rolls back the newly created event and receipt',async()=>{
   const f=uid(18);ok(await add(N,f));const scheduled=await schedule(f,true);ok(scheduled);
   const snapshot=async()=>({
     nights:await q('SELECT * FROM movie_nights WHERE movie_id=$1 ORDER BY id',[f]),
     participants:await q('SELECT p.* FROM movie_night_participants p JOIN movie_nights n ON n.id=p.night_id WHERE n.movie_id=$1 ORDER BY p.night_id,p.person_id',[f]),
     intentions:await q('SELECT * FROM movie_night_intentions WHERE movie_id=$1 ORDER BY night_id,person_id',[f]),
     personal:await q('SELECT * FROM personal_list_entries WHERE movie_id=$1 ORDER BY person_id',[f]),
     support:await q('SELECT * FROM group_movie_states WHERE movie_id=$1 ORDER BY group_id',[f]),
     versions:await q('SELECT * FROM domain_versions WHERE entity_id=$1 OR entity_id IN (SELECT id FROM movie_nights WHERE movie_id=$1) ORDER BY scope_kind,scope_id,entity_id',[f]),
     receipts:await q('SELECT * FROM domain_command_receipts WHERE movie_id=$1 ORDER BY id',[f])
   });
   const before=await snapshot();assert.equal(before.personal[0].active,true);assert.equal(before.support[0].support_state,'active');
   for(const [kind,expected,params] of [['COMPLETE_NOW',null,{participants:[X],select_candidate:true,expected_candidate_revision:await group(f)}],
     ['COMPLETE_NIGHT',1,{night_id:scheduled.night_id,participants:[X]}]]) {
     const request=crypto.randomUUID();
     assert.equal((await call(N,kind,f,G,expected,params,request)).outcome,'VALIDATION_ERROR');
     assert.equal((await q('SELECT count(*)::int n FROM domain_command_receipts WHERE caller_id=$1 AND request_id=$2',[N,request]))[0].n,0);
     assert.deepEqual(await snapshot(),before);
   }
 });
 await test('retrospective seen preserves list; personal new viewing satisfies only matching generation',async()=>{
   const f=uid(19);ok(await add(N,f));ok(await call(N,'RETROSPECTIVE_SEEN',f,null,await personal(N,f)));assert.equal((await entry(N,f)).active,true);
   ok(await remove(N,f));ok(await add(N,f));
   assert.equal((await call(N,'NEW_PERSONAL_VIEWING',f,null,await personal(N,f),{generation:1})).outcome,'ALREADY_IN_TARGET_STATE');assert.equal((await entry(N,f)).active,true);
   ok(await call(N,'NEW_PERSONAL_VIEWING',f,null,await personal(N,f),{generation:2}));
   ok(await call(N,'REMOVE_PERSONAL_SEEN',f,null,await personal(N,f)));assert.equal((await entry(N,f)).active,false);
 });
 await test('personal judgment independent, rating zero, preference clearing, removal and review isolation',async()=>{
   const f=uid(20);
   for(const [k,value] of [['PERSONAL_PREFERENCE',true],['PERSONAL_RATING',0],['PERSONAL_REVIEW','Keep'],['PERSONAL_RATING',null]])
     ok(await call(N,k,f,null,await personal(N,f),{value}));
   const row=(await q('SELECT seen_n,personal_liked_n,seen_rating_n,review_text_n FROM movies WHERE id=$1',[f]))[0];
   assert.deepEqual(row,{seen_n:false,personal_liked_n:null,seen_rating_n:null,review_text_n:'Keep'});
   ok(await call(N,'PERSONAL_PREFERENCE',f,null,await personal(N,f),{value:false}));
   ok(await call(N,'PERSONAL_RATING',f,null,await personal(N,f),{value:null})); // NULL->NULL still clears preference
   assert.equal((await q('SELECT personal_liked_n FROM movies WHERE id=$1',[f]))[0].personal_liked_n,null);
   for(const [k,value] of [['PERSONAL_RATING',11],['PERSONAL_PREFERENCE','true'],['PERSONAL_REVIEW',42]]) assert.equal((await call(N,k,f,null,await personal(N,f),{value})).outcome,'VALIDATION_ERROR');
 });
 await test('Together judgment is movie-based and never changes night version',async()=>{
   const f=uid(17);const before=await q("SELECT * FROM domain_versions WHERE scope_kind='night' ORDER BY entity_id");
   ok(await call(N,'TOGETHER_RATING',f,G,await group(f),{value:0}));
   ok(await call(V,'TOGETHER_REVIEW',f,G,await group(f),{value:'Group opinion'}));
   ok(await call(N,'TOGETHER_RATING',f,G,await group(f),{value:null}));
   assert.deepEqual(await q("SELECT * FROM domain_versions WHERE scope_kind='night' ORDER BY entity_id"),before);
 });
 await test('atomic completion changes each affected scope once, consumes selected support and preserves projection',async()=>{
   const f=uid(22);ok(await add(N,f));ok(await add(V,f));const r=await schedule(f,true);ok(r);
   const beforeN=await personal(N,f),beforeV=await personal(V,f),beforeG=await group(f);
   const result=await complete(f,r.night_id);ok(result);
   assert.equal(new Set(result.affected_versions.map(v=>[v.scope_kind,v.scope_id,v.entity_id].join(':'))).size,result.affected_versions.length);
   assert.equal(await personal(N,f),beforeN+1);assert.equal(await personal(V,f),beforeV+1);assert.equal(await group(f),beforeG+1);assert.equal(await night(r.night_id),2);
   assert.equal((await q('SELECT support_state FROM group_movie_states WHERE movie_id=$1',[f]))[0].support_state,'consumed');
   assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[f]))[0].in_shared_list,true);
 });
 await test('residual convergence is consumed without satisfying uncaptured generations; C2 survives old selection',async()=>{
   const f=uid(23);ok(await add(N,f));ok(await add(V,f));
   const r=await schedule(f,true,{date:'2000-01-01'});ok(r);ok(await complete(f,r.night_id));
   assert.equal((await entry(N,f)).active,true);assert.equal((await entry(V,f)).active,true);assert.equal(await candidate(f),false);
   ok(await remove(N,f));ok(await add(N,f));assert.equal(await candidate(f),true);
   const next=await schedule(f,true,{date:'2000-01-01'});ok(next);ok(await remove(V,f));ok(await add(V,f));
   ok(await complete(f,next.night_id));assert.equal(await candidate(f),true);
 });
 await test('complete-now consumes only selected support and never captures/satisfies intentions',async()=>{
   const f=uid(24);ok(await add(N,f));const r=await call(N,'COMPLETE_NOW',f,G,null,{participants:[N],select_candidate:true,expected_candidate_revision:await group(f)});ok(r);
   assert.equal((await entry(N,f)).active,true);assert.equal(await candidate(f),false);
   assert.equal((await q('SELECT count(*)::int n FROM movie_night_intentions WHERE night_id=$1',[r.night_id]))[0].n,0);
 });
 await test('deprecated night column cannot influence CAS; failed CAS and malformed commands have no receipts',async()=>{
   const f=uid(25),r=await schedule(f);ok(r);
   await q('UPDATE movie_nights SET domain_revision=999 WHERE id=$1',[r.night_id]);
   const request=crypto.randomUUID(),before=(await q('SELECT count(*)::int n FROM domain_command_receipts'))[0].n;
   assert.equal((await call(N,'CANCEL_NIGHT',f,G,999,{night_id:r.night_id},request)).outcome,'STALE');
   assert.equal((await q('SELECT count(*)::int n FROM domain_command_receipts'))[0].n,before);
   ok(await call(N,'CANCEL_NIGHT',f,G,1,{night_id:r.night_id},request));
   assert.equal((await q('SELECT domain_revision::int value FROM movie_nights WHERE id=$1',[r.night_id]))[0].value,999);
   for(const params of [{date:'bad'}, {date:'2099-01-01',snack:{}},{date:'2099-01-01',time:'25:00'},{date:'2099-01-01',select_candidate:true,expected_candidate_revision:null}])
     assert.equal((await call(N,'SCHEDULE_NIGHT',f,G,null,params)).outcome,'VALIDATION_ERROR');
 });
 await test('protected delete, new-table DML closed, legacy writer remains callable',async()=>{
   await assert.rejects(q('DELETE FROM movies WHERE id=$1',[m]),/foreign key/);
   await exec('SET ROLE authenticated');
   try {await assert.rejects(q('INSERT INTO personal_list_entries(person_id,movie_id) VALUES($1,$2)',[N,uid(21)]),/permission denied/);}
   finally {await exec('RESET ROLE');}
   await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[N]);
   await q("SELECT manage_movie_night('propose',$1,p_date=>'2099-01-01')",[uid(21)]);
   assert.equal((await q('SELECT mode FROM app_protocol_state'))[0].mode,'legacy');
 });
 await test('tombstone is not an implicit zero revision or permission to resurrect an aggregate',async()=>{
   const f=uid(26);await q("INSERT INTO domain_versions(scope_kind,scope_id,entity_id,version,tombstone) VALUES('person_film',$1,$2,4,true)",[N,f]);
   assert.equal((await call(N,'ADD_PERSONAL_LIST',f,null,4)).outcome,'VALIDATION_ERROR');
   assert.equal(await entry(N,f),undefined);assert.equal(await personal(N,f),4);
 });
 await test('cancel returns only still-supported convergence; active scheduling never creates support',async()=>{
   const f=uid(27);ok(await call(N,'WITHDRAW_GROUP_CANDIDACY',f,G,await group(f)));
   ok(await add(N,f));ok(await add(V,f));assert.equal(await candidate(f),true);
   const first=await schedule(f,true);ok(first);ok(await remove(V,f));
   ok(await call(N,'CANCEL_NIGHT',f,G,1,{night_id:first.night_id}));assert.equal(await candidate(f),false);
   ok(await add(V,f));const second=await schedule(f,true);ok(second);
   ok(await call(N,'CANCEL_NIGHT',f,G,1,{night_id:second.night_id}));assert.equal(await candidate(f),true);
 });
 await test('inactive remove is no-op and its replay cannot remove a later activation',async()=>{
   const f=uid(28),request=crypto.randomUUID();
   const r=await call(N,'REMOVE_PERSONAL_LIST',f,null,0,{},request);assert.equal(r.outcome,'ALREADY_IN_TARGET_STATE');
   assert.equal(await entry(N,f),undefined);assert.equal(await personal(N,f),0);
   ok(await add(N,f));assert.equal((await call(N,'REMOVE_PERSONAL_LIST',f,null,0,{},request)).replayed,true);
   assert.equal((await entry(N,f)).active,true);assert.equal(await personal(N,f),1);
 });
 await test('legacy metadata/preferences outside intentional command fields preserved',async()=>{
   const now=await q('SELECT * FROM movies ORDER BY id');
   const keys=['id','title','tmdb_id','watched_by','review_by','rating','review_text','added_by','created_at'];
   const select=row=>Object.fromEntries(keys.map(k=>[k,row[k]]));
   assert.deepEqual(now.map(select),initialMovies.map(select));
 });
 console.log(`Commands DB: ${count}/${count} PASS; single backend, no concurrency claims.`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(env)await env.db.close();});
