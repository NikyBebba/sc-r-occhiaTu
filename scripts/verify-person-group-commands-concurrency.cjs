#!/usr/bin/env node
// REQUIRES a disposable EMPTY local PostgreSQL database and psql. Never hosted DB.
// node ... --connection=postgresql://localhost/sc_person_group_test --pglite=/path
// Creates only synthetic fixture data; no teardown/deletes of an existing database.
const {spawn,spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {fixture,uid,N,V,G}=require('./person-group-command-test-support.cjs');
const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const connection=arg('connection'),psql=arg('psql')||'psql';
if(!connection){console.log('BLOCKED: requires independent local PostgreSQL connections; supply --connection to an EMPTY sc_person_group_test* database. PGlite is not a race substitute.');process.exit(2);}
const url=new URL(connection);
if(!['postgresql:','postgres:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/sc_person_group_test[a-z0-9_]*$/.test(url.pathname)||url.search) throw Error('Only explicit disposable loopback database accepted');
const options=['--no-psqlrc','--no-password','-X','-qAt','-v','ON_ERROR_STOP=1','--dbname',connection];
const environment={...process.env,PGSSLMODE:'disable',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'3'};
function sql(text){
 const r=spawnSync(psql,options,{input:text,encoding:'utf8',env:environment,maxBuffer:12*1024*1024});
 if(r.error)throw Error('Local psql unavailable: '+r.error.code);
 if(r.status!==0)throw Error('Local PostgreSQL assertion/setup failed: '+r.stderr.replaceAll(connection,'[local connection]'));
 return r.stdout.trim();
}
const lit=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
const command=(p,k,m,g,expected,params={},request=crypto.randomUUID())=>
 `SELECT set_config('request.jwt.claim.sub',${lit(p)},true); SELECT 'RESULT:'||domain_command(${lit(request)},${lit(k)},${lit(m)},${lit(g)},${expected===null?'NULL':expected},${lit(JSON.stringify(params))}::jsonb)::text;`;
function run(text,onResult){
 let output='',error='',seen=false;
 const child=spawn(psql,options,{env:environment});
 const done=new Promise((resolve,reject)=>{
   child.on('error',()=>reject(Error('Local psql spawn failed')));
   child.stdout.on('data',b=>{output+=b.toString();if(!seen&&output.includes('RESULT:')&&output.slice(output.indexOf('RESULT:')).includes('\n')){seen=true;onResult?.();}});
   child.stderr.on('data',b=>error+=b.toString());
   child.on('close',code=>code?reject(Error(error.replaceAll(connection,'[local connection]'))):resolve({
     pid:Number(output.match(/PID:(\d+)/)?.[1]),results:output.split('\n').filter(x=>x.startsWith('RESULT:')).map(x=>JSON.parse(x.slice(7)))}));
 });
 child.stdin.end(`BEGIN; SET LOCAL statement_timeout='8s'; SELECT 'PID:'||pg_backend_pid(); ${text} COMMIT;`);
 return done;
}
async function pair(a,b){
 let startB;const started=new Promise(resolve=>startB=resolve);let second;
 const first=run(a+" SELECT pg_sleep(0.5);",()=>{second=run(b);startB();});
 await Promise.race([started,first.then(()=>{throw Error('First backend did not reach command barrier');})]);
 const [ra,rb]=await Promise.all([first,second]);assert(ra.pid&&rb.pid&&ra.pid!==rb.pid);
 return [ra.results.at(-1),rb.results.at(-1)];
}
let localFixture;
(async()=>{
 assert.equal(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m');"),'0','Database must be EMPTY');
 localFixture=await fixture();
 const bootstrap=localFixture.bootstrapSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated;',
   () => "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
 sql(bootstrap);
 let count=0;
 const test=async(name,fn)=>{await fn();count++;console.log('PASS independent PostgreSQL backends: '+name);};
 const create=i=>{const m=uid(8000+i);sql(`SELECT set_config('request.jwt.claim.sub',${lit(N)},false); INSERT INTO movies(id,title) VALUES(${lit(m)},'Synthetic race ${i}');`);return m;};
 const one=text=>JSON.parse(sql('BEGIN; '+text+' COMMIT;').split('\n').find(x=>x.startsWith('RESULT:')).slice(7));
 const state=m=>JSON.parse(sql(`SELECT jsonb_build_object('personal',(SELECT jsonb_agg(to_jsonb(p)) FROM personal_list_entries p WHERE movie_id=${lit(m)}),'group',(SELECT to_jsonb(s) FROM group_movie_states s WHERE movie_id=${lit(m)}),'versions',(SELECT jsonb_agg(to_jsonb(v)) FROM domain_versions v WHERE entity_id=${lit(m)}));`));
 const scheduled=(i,autonomous=false)=>{const m=create(i);one(command(N,'ADD_PERSONAL_LIST',m,null,0));one(command(V,'ADD_PERSONAL_LIST',m,null,0));
   if(autonomous) assert.equal(one(command(N,'PROPOSE_TO_GROUP',m,G,1)).outcome,'SUCCESS');
   const r=one(command(N,'SCHEDULE_NIGHT',m,G,null,{date:'2099-01-01',time:'21:30',select_candidate:true,expected_candidate_revision:autonomous?2:1}));return {m,n:r.night_id};};
 const assertSingleCompletion=(m,n,result)=>{
   const final=JSON.parse(sql(`SELECT jsonb_build_object(
     'night',(SELECT to_jsonb(t) FROM movie_nights t WHERE id=${lit(n)}),
     'participants',(SELECT jsonb_agg(person_id ORDER BY person_id) FROM movie_night_participants WHERE night_id=${lit(n)}),
     'receipts',(SELECT jsonb_agg(to_jsonb(r)) FROM domain_command_receipts r WHERE movie_id=${lit(m)} AND command_kind='COMPLETE_NIGHT'),
     'total_receipts',(SELECT count(*) FROM domain_command_receipts WHERE movie_id=${lit(m)}),
     'night_version',(SELECT version FROM domain_versions WHERE scope_kind='night' AND scope_id=${lit(G)} AND entity_id=${lit(n)}),
     'refs',(SELECT jsonb_agg(to_jsonb(i)) FROM movie_night_intentions i WHERE night_id=${lit(n)}));`));
   const s=state(m);assert.equal(final.night.status,'completed');assert.equal(final.night_version,2);
   assert.deepEqual(final.participants,[N,V]);assert.equal(final.receipts.length,1);assert.equal(final.total_receipts,5);
   assert.deepEqual(final.receipts[0].result,result);assert.deepEqual(final.receipts[0].affected_versions,result.affected_versions);
   assert.equal(s.personal.length,2);
   assert(s.personal.every(p=>p.generation===1&&p.revision===2&&!p.active&&p.end_reason==='satisfied'&&p.ended_at));
   assert.equal(s.group.autonomous_support_id,final.night.selected_support_id);
   assert.equal(s.group.support_state,'consumed');assert.equal(s.group.revision,2);assert(s.group.support_ended_at);
   assert.equal(sql(`SELECT domain_candidate(${lit(G)},${lit(m)});`),'f');
   assert.equal(final.refs.length,2);assert(final.refs.every(i=>i.generation===1&&i.invalidated_at===null));
   const versions=s.versions.map(v=>[[v.scope_kind,v.scope_id,v.entity_id].join(':'),v.version]);
   assert.deepEqual(Object.fromEntries(versions),{
     [['person_film',N,m].join(':')]:2,[['person_film',V,m].join(':')]:2,[['group_film',G,m].join(':')]:4});
   const affected=result.affected_versions.map(v=>[[v.scope_kind,v.scope_id,v.entity_id].join(':'),v.version]);
   assert.equal(new Set(affected.map(x=>x[0])).size,4);
   assert.deepEqual(Object.fromEntries(affected),{...Object.fromEntries(versions),[['night',G,n].join(':')]:2});
 };
 await test('two same-person ADDs: one success, one stale, generation stays 1',async()=>{
   const m=create(1),r=await pair(command(N,'ADD_PERSONAL_LIST',m,null,0),command(N,'ADD_PERSONAL_LIST',m,null,0));
   assert.deepEqual(r.map(x=>x.outcome),['SUCCESS','STALE']);assert.equal(state(m).personal[0].generation,1);
 });
 await test('two members ADD: convergence built exactly once',async()=>{
   const m=create(2),r=await pair(command(N,'ADD_PERSONAL_LIST',m,null,0),command(V,'ADD_PERSONAL_LIST',m,null,0));assert(r.every(x=>x.outcome==='SUCCESS'));
   assert.equal(state(m).versions.find(v=>v.scope_kind==='group_film').version,1);
 });
 await test('ADD vs REMOVE stale state cannot undo new intention',async()=>{
   const m=create(3),r=await pair(command(N,'ADD_PERSONAL_LIST',m,null,0),command(N,'REMOVE_PERSONAL_LIST',m,null,0));assert.equal(r[1].outcome,'STALE');assert.equal(state(m).personal[0].active,true);
 });
 await test('two proposals: one support and one stale response',async()=>{
   const m=create(4),r=await pair(command(N,'PROPOSE_TO_GROUP',m,G,0),command(V,'PROPOSE_TO_GROUP',m,G,0));assert.equal(r[1].outcome,'STALE');assert.equal(state(m).group.revision,1);
 });
 await test('proposal vs stale withdrawal preserves new support',async()=>{
   const m=create(5),r=await pair(command(N,'PROPOSE_TO_GROUP',m,G,0),command(V,'WITHDRAW_GROUP_CANDIDACY',m,G,0));assert.equal(r[1].outcome,'STALE');assert.equal(state(m).group.support_state,'active');
 });
 await test('completion different requests: only one satisfaction/consumption',async()=>{
   const {m,n}=scheduled(6,true),r=await pair(command(N,'COMPLETE_NIGHT',m,G,1,{night_id:n,participants:[N,V]}),command(V,'COMPLETE_NIGHT',m,G,1,{night_id:n,participants:[N,V]}));
   assert.deepEqual(r.map(x=>x.outcome),['SUCCESS','STALE']);assertSingleCompletion(m,n,r[0]);
 });
 await test('same completion request races replay deterministically',async()=>{
   const {m,n}=scheduled(7,true),request=crypto.randomUUID(),cmd=command(N,'COMPLETE_NIGHT',m,G,1,{night_id:n,participants:[N,V]},request),r=await pair(cmd,cmd);
   assert.equal(r[1].replayed,true);assert.deepEqual({...r[0],replayed:true},r[1]);
   assertSingleCompletion(m,n,r[0]);
 });
 await test('proposal after scheduling survives competing completion',async()=>{
   const {m,n}=scheduled(8),r=await pair(command(N,'PROPOSE_TO_GROUP',m,G,2),command(V,'COMPLETE_NIGHT',m,G,1,{night_id:n,participants:[N,V]}));
   assert(r.every(x=>x.outcome==='SUCCESS'));assert.equal(state(m).group.support_state,'active');
 });
 await test('committed REMOVE then ADD/completion preserves successor in both serialized orders',async()=>{
   // Supported boundary: one request/receipt per transaction, never two entry
   // point calls in one BEGIN/COMMIT. Each pair overlaps distinct real backends.
   for(const completionFirst of [false,true]) {
     const {m,n}=scheduled(completionFirst?12:9);
     const requests=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
     assert.equal(new Set(requests).size,3);
     const references=()=>JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(i) ORDER BY person_id) FROM movie_night_intentions i WHERE night_id=${lit(n)};`));
     const details=()=>JSON.parse(sql(`SELECT jsonb_build_object('night',(SELECT to_jsonb(t) FROM movie_nights t WHERE id=${lit(n)}),
       'cycle',domain_cycle(${lit(G)},${lit(m)}),'candidate',domain_candidate(${lit(G)},${lit(m)}),
       'night_version',(SELECT version FROM domain_versions WHERE scope_kind='night' AND scope_id=${lit(G)} AND entity_id=${lit(n)}));`));
     const assertVersions=(result,expected)=>{
       assert.equal(result.outcome,'SUCCESS');
       const entries=result.affected_versions.map(v=>[[v.scope_kind,v.scope_id,v.entity_id].join(':'),v.version]);
       assert.equal(new Set(entries.map(x=>x[0])).size,entries.length);
       assert.deepEqual(Object.fromEntries(entries),expected);
     };
     const pn=['person_film',N,m].join(':'),pv=['person_film',V,m].join(':'),gf=['group_film',G,m].join(':'),nv=['night',G,n].join(':');
     const before=state(m),captured=references(),initial=details();
     assert(before.personal.every(p=>p.active&&p.generation===1));
     assert.equal(before.versions.find(v=>v.scope_kind==='group_film').version,2);
     assert.equal(initial.night_version,1);assert.equal(initial.night.selected_support_id,null);
     assert.deepEqual(initial.cycle,initial.night.selected_convergence_cycle);
     assert.equal(captured.length,2);assert(captured.every(i=>i.generation===1&&i.invalidated_at===null));
     // one() returns only after the psql process has committed and exited.
     const removed=one(command(N,'REMOVE_PERSONAL_LIST',m,null,1,{},requests[0]));
     assertVersions(removed,{[pn]:2,[gf]:3});
     const afterRemove=state(m),terminated=afterRemove.personal.find(p=>p.person_id===N);
     assert.equal(terminated.generation,1);assert.equal(terminated.active,false);
     assert.equal(terminated.end_reason,'removed');assert(terminated.ended_at);
     assert.equal(details().cycle,null);assert.equal(details().candidate,false);
     assert.equal(details().night_version,1);assert.deepEqual(references(),captured);
     const removeReceipt=JSON.parse(sql(`SELECT result FROM domain_command_receipts WHERE caller_id=${lit(N)} AND request_id=${lit(requests[0])};`));
     assert.deepEqual(removeReceipt,removed);
     const add=command(N,'ADD_PERSONAL_LIST',m,null,2,{},requests[1]);
     const complete=command(V,'COMPLETE_NIGHT',m,G,1,{night_id:n,participants:[N,V]},requests[2]);
     const results=await pair(completionFirst?complete:add,completionFirst?add:complete);
     const added=results[completionFirst?1:0],completed=results[completionFirst?0:1];
     assertVersions(added,completionFirst?{[pn]:3}:{[pn]:3,[gf]:4});
     assertVersions(completed,{[nv]:2,[pv]:2,[gf]:completionFirst?4:5});
     const final=state(m),p=final.personal.find(p=>p.person_id===N),partner=final.personal.find(p=>p.person_id===V);
     assert.equal(p.generation,2);assert.equal(p.active,true);assert.equal(p.end_reason,null);assert.equal(p.ended_at,null);
     assert.equal(partner.generation,1);assert.equal(partner.active,false);assert.equal(partner.end_reason,'satisfied');
     assert.equal(final.versions.find(v=>v.scope_kind==='group_film').version,completionFirst?4:5);
     assert.equal(final.group,null); // no autonomous support or invented suppression
     const end=details();assert.equal(end.night.status,'completed');assert.equal(end.night_version,2);
     assert.equal(end.cycle,null);assert.equal(end.candidate,false);
     assert.deepEqual(end.night.selected_convergence_cycle,initial.night.selected_convergence_cycle);
     assert.deepEqual(references(),captured); // A remains captured, never rewritten to B
     const receipts=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('request',request_id,'result',result)) FROM domain_command_receipts
       WHERE movie_id=${lit(m)} AND request_id IN (${requests.map(lit).join(',')});`));
     assert.equal(receipts.length,3);
     for(const [i,result] of [removed,added,completed].entries()) assert.deepEqual(receipts.find(r=>r.request===requests[i]).result,result);
     console.log(`  PASS scenario 9 ${completionFirst?'COMPLETE then ADD':'ADD then COMPLETE'}: REMOVE committed; captured A=1; active B=2 preserved; three independent command receipts`);
   }
 });
 await test('edit vs completion: stale completion cannot consume references',async()=>{
   const {m,n}=scheduled(10),r=await pair(command(N,'EDIT_NIGHT',m,G,1,{night_id:n,date:'2099-02-02'}),command(V,'COMPLETE_NIGHT',m,G,1,{night_id:n,participants:[N,V]}));
   assert.deepEqual(r.map(x=>x.outcome),['SUCCESS','STALE']);assert(state(m).personal.every(p=>p.active));
 });
 await test('same request different payload rejected across backends',async()=>{
   const m=create(11),request=crypto.randomUUID(),r=await pair(command(N,'ADD_PERSONAL_LIST',m,null,0,{},request),command(N,'REMOVE_PERSONAL_LIST',m,null,0,{},request));
   assert.equal(r[1].outcome,'REQUEST_ID_REUSE');assert.equal(state(m).personal[0].active,true);
 });
 console.log(`Concurrency PostgreSQL: ${count}/${count} PASS; independent backends, synthetic local DB only.`);
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(localFixture)await localFixture.db.close();});
