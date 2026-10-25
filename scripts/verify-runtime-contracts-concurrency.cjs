#!/usr/bin/env node
'use strict';
// Disposable, EMPTY, loopback PostgreSQL only. No hosted database/config access.
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture,read,uid,N,V,G}=require('./person-group-command-test-support.cjs');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
const connection=arg('connection'),psql=arg('psql')||'psql';
if(!connection){console.error('Requires --connection to an EMPTY sc_person_group_test* local PostgreSQL database.');process.exit(2);}
const url=new URL(connection);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||!/^\/sc_person_group_test[a-z0-9_]*$/.test(url.pathname)||url.search)throw Error('Disposable IPv4 loopback database required');
const opts=['-X','--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=1','--dbname',connection];
const env={...process.env,PGSSLMODE:'disable',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'3'};
const lit=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
function sql(s){const r=spawnSync(psql,opts,{input:s,encoding:'utf8',env,maxBuffer:32*1024*1024});if(r.error||r.status)throw Error(r.error?.message||r.stderr);return r.stdout.trim();}
const json=s=>JSON.parse(sql(s));
function session(){
 const child=spawn(psql,opts,{env});let out='',err='';const watchers=[];
 function check(){for(const w of [...watchers])if(w.re.test(out)){clearTimeout(w.timer);watchers.splice(watchers.indexOf(w),1);w.resolve(out);}}
 child.stdout.on('data',b=>{out+=b;check();});child.stderr.on('data',b=>err+=b);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{for(const w of watchers){clearTimeout(w.timer);w.reject(Error('Session ended before barrier: '+err));}code?reject(Error(err)):resolve({out,err});});});done.catch(()=>{});
 return {write:s=>child.stdin.write(s+'\n'),end:s=>{if(!child.stdin.writableEnded)child.stdin.end((s||'')+'\n');},done,
  wait:re=>new Promise((resolve,reject)=>{const w={re,resolve,reject,timer:setTimeout(()=>reject(Error('Barrier timeout: '+out+' '+err)),12000)};watchers.push(w);check();})};
}
const token=(k,s,e)=>({scope_kind:k,scope_id:s,entity_id:e,version:sql(`SELECT coalesce((SELECT version FROM domain_versions WHERE scope_kind=${lit(k)} AND scope_id=${lit(s)} AND entity_id=${lit(e)}),0)::text;`)});
const body=(kind,m,g=null,n=null,p={},versions=[],id=crypto.randomUUID())=>({protocol_version:1,request_id:id,intent:kind,target:{movie_id:m,group_id:g,night_id:n},expected_versions:versions,parameters:p});
const app=(b,person=N)=>`SET LOCAL request.jwt.claim.sub=${lit(person)}; SELECT 'RESULT:'||public.execute_app_command(${lit(JSON.stringify(b))}::jsonb)::text;`;
const match=(action,p,person=N)=>`SET LOCAL request.jwt.claim.sub=${lit(person)}; SELECT 'RESULT:'||public.execute_match_action(1,${lit(action)},${lit(JSON.stringify(p))}::jsonb)::text;`;
const one=s=>JSON.parse(sql('BEGIN; '+s+' COMMIT;').split('\n').find(x=>x.startsWith('RESULT:')).slice(7));
const result=o=>JSON.parse(o.out.split('\n').find(x=>x.startsWith('RESULT:')).slice(7));
const success=r=>assert(['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(r.outcome),JSON.stringify(r));
let counter=81000,fixtureDB,count=0;
function create(){const m=uid(++counter);sql(`SET request.jwt.claim.sub=${lit(N)}; INSERT INTO movies(id,title) VALUES(${lit(m)},'Synthetic concurrency content');`);return m;}
function request(k,m,g=null,n=null,p={},person=N){let versions=[];
 if(!['SCHEDULE_NIGHT','QUICK_NIGHT','COMPLETE_NOW','COMPLETE_NOW_WITH_CONTEXT','CONTENT_CREATE'].includes(k)){
  const scope=n?'night':k.startsWith('CONTENT_')?'content':g?'group_film':'person_film';versions=[token(scope,n?G:scope==='content'?m:g||person,n||m)];
 }return body(k,m,g,n,p,versions);
}
const movie=m=>json(`SELECT to_jsonb(t) FROM movies t WHERE id=${lit(m)};`);
const versions=m=>json(`SELECT coalesce(jsonb_agg(jsonb_build_object('kind',scope_kind,'scope',scope_id,'version',version::text,'dead',tombstone) ORDER BY scope_kind,scope_id),'[]') FROM domain_versions WHERE entity_id=${lit(m)};`);
const receipts=()=>sql('SELECT count(*) FROM domain_command_receipts;');
async function pair(a,b,{wait=true,beforeRelease=null}={}){
 const allVersions=()=>json("SELECT coalesce(jsonb_object_agg(scope_kind||':'||scope_id||':'||entity_id,version::text),'{}') FROM domain_versions;");
 const before=allVersions();
 const A=session(),B=session();
 try{
  A.write("BEGIN; SET LOCAL statement_timeout='10s'; SELECT 'PID:'||pg_backend_pid(); "+a+" SELECT 'A_HELD';");
  const ao=await A.wait(/A_HELD\n/),pidA=Number(ao.match(/PID:(\d+)/)[1]);
  B.write("BEGIN; SET LOCAL statement_timeout='10s'; SELECT 'PID:'||pg_backend_pid(); "+b+" SELECT 'B_FINISHED';");
  const bo=await B.wait(/PID:\d+\n/),pidB=Number(bo.match(/PID:(\d+)/)[1]);assert.notEqual(pidA,pidB);
  if(wait){
   // An observer statement proves B is blocked by A, rather than trusting a sleep.
   let observed=false;
   for(let i=0;i<100&&!observed;i++)observed=sql(`SELECT ${pidA}=ANY(pg_blocking_pids(${pidB}));`)==='t';
   assert(observed,'Expected actual PostgreSQL lock wait between independent backends');
  }else await B.wait(/B_FINISHED\n/);
  if(beforeRelease)beforeRelease();
  A.end('COMMIT;');await A.done;B.end('COMMIT;');const [ra,rb]=await Promise.all([A.done,B.done]);
  for(const r of [ra,rb])assert(!/ERROR:|deadlock|statement timeout/i.test(r.err),r.err);
  const results=[result(ra),result(rb)],bumps=new Map();
  for(const r of results){assert.notEqual(r.error?.code,'TRANSIENT_FAILURE');const entries=r.affected_versions||[];
   assert.equal(new Set(entries.map(x=>[x.scope_kind,x.scope_id,x.entity_id].join(':'))).size,entries.length,'One bump per scope per command');
   for(const x of entries){assert.equal(typeof x.version,'string');if(!r.replayed){const key=[x.scope_kind,x.scope_id,x.entity_id].join(':');bumps.set(key,(bumps.get(key)||0n)+1n);}}
  }
  const after=allVersions();for(const key of new Set([...Object.keys(before),...Object.keys(after)]))
   assert.equal(BigInt(after[key]||'0')-BigInt(before[key]||'0'),bumps.get(key)||0n,'Exact committed scoped bumps: '+key);
  console.log(`  backends ${pidA}/${pidB}; ${wait?'lock wait proven':'independent progress proven'}; ${results.map(r=>r.outcome).join('/')}`);
  return results;
 }finally{A.end('ROLLBACK;');B.end('ROLLBACK;');await Promise.allSettled([A.done,B.done]);}
}
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
const schedule=m=>{const r=one(app(request('SCHEDULE_NIGHT',m,G,null,{date:'2099-01-01',time:'21:30'})));success(r);return r.result.night_id;};
const completion=(m,n,evaluation)=>{const b=request('COMPLETE_NIGHT_WITH_CONTEXT',m,G,n,{participants:[N],...(evaluation?{evaluation}:{})});if(evaluation)b.expected_versions.push(token('group_film',G,m));return b;};
(async()=>{
 assert.equal(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m');"),'0','Database must be EMPTY');
 fixtureDB=await fixture();const boot=fixtureDB.bootstrapSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated;',()=>"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
 sql(boot);sql(read('database/supabase-migration-runtime-contracts.sql'));sql("UPDATE app_protocol_state SET mode='target',minimum_client_protocol=1;");
 await test('marker is backend-local and restored on reused connection/rollback',async()=>{
  const m=create(),a=session(),b=session();
  try{
   a.write("BEGIN; SELECT set_config('scorochiatu.content_write','on',true); SELECT 'MARKER_HELD';");await a.wait(/MARKER_HELD\n/);
   b.write("BEGIN; SELECT 'ISOLATED:'||coalesce(current_setting('scorochiatu.content_write',true),'absent'); SELECT 'OTHER_READY';");
   assert.match(await b.wait(/OTHER_READY\n/),/ISOLATED:absent/);
   a.write("ROLLBACK; BEGIN; SET LOCAL request.jwt.claim.sub="+lit(N)+"; SELECT app_content_write("+lit(m)+",'{\"duration\":\"pooled\"}',false,'N'); SELECT 'RESTORED:'||coalesce(current_setting('scorochiatu.content_write',true),''); SELECT 'WRITE_DONE';");
   const out=await a.wait(/WRITE_DONE\n/);assert.match(out,/RESTORED:\n/);
   a.write("ROLLBACK; BEGIN; SELECT 'ROLLED_BACK:'||(SELECT duration IS DISTINCT FROM 'pooled' FROM movies WHERE id="+lit(m)+"); SET LOCAL request.jwt.claim.sub="+lit(N)+"; SELECT app_content_write("+lit(m)+",'{\"duration\":\"committed\"}',false,'N'); COMMIT; BEGIN; SELECT 'REUSED:'||coalesce(current_setting('scorochiatu.content_write',true),''); SELECT 'REUSE_DONE';");const reused=await a.wait(/REUSE_DONE\n/);assert.match(reused,/REUSED:\n/);assert.match(reused,/ROLLED_BACK:true/);
   a.end('COMMIT;');b.end('COMMIT;');for(const r of await Promise.all([a.done,b.done]))assert(!r.err.includes('ERROR:'),r.err);
   assert.equal(movie(m).duration,'committed');
  }finally{a.end('ROLLBACK;');b.end('ROLLBACK;');await Promise.allSettled([a.done,b.done]);}
 });
 await test('statement cancellation unwinds writer marker before reuse',async()=>{
  const m=create(),before=movie(m);
  sql(`BEGIN; SET LOCAL request.jwt.claim.sub=${lit(N)}; SELECT set_config('scorochiatu.content_write','neutral',true);
   CREATE FUNCTION pg_temp.slow_content_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$;
   CREATE TRIGGER cancel_content_test AFTER UPDATE ON movies FOR EACH ROW EXECUTE FUNCTION pg_temp.slow_content_write();
   SET LOCAL statement_timeout='50ms';
   DO $$ BEGIN BEGIN PERFORM app_content_write(${lit(m)},'{"duration":"cancel"}',false,'N'); RAISE EXCEPTION 'CANCEL_EXPECTED'; EXCEPTION WHEN query_canceled THEN NULL; END;
    IF current_setting('scorochiatu.content_write',true)<>'neutral' THEN RAISE EXCEPTION 'CANCEL_MARKER_LEAK';END IF; END $$;
   ROLLBACK;`);assert.deepEqual(movie(m),before);
 });
 await test('A01 existing duplicate admission/replay has one effect and receipt',async()=>{
  const m=create(),b=request('ADD_PERSONAL_LIST',m),before=Number(receipts()),r=await pair(app(b),app(b));success(r[0]);assert.equal(r[1].replayed,true);assert.equal(Number(receipts()),before+1);assert.equal(versions(m).find(x=>x.kind==='person_film').version,'1');
 });
 await test('A02 different request same existing CAS',async()=>{const m=create(),a=request('PERSONAL_REVIEW',m,null,null,{value:'first'}),b=request('PERSONAL_REVIEW',m,null,null,{value:'second'}),r=await pair(app(a),app(b));assert.deepEqual(r.map(x=>x.outcome),['SUCCESS','STALE']);assert.equal(movie(m).review_text_n,'first');});
 await test('B01 existing vs related composite',async()=>{const m=create(),a=request('PERSONAL_RATING',m,null,null,{value:7}),b=request('SET_PERSONAL_EVALUATION',m,null,null,{rating:8,review:'second'}),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'STALE');assert.equal(movie(m).seen_rating_n,7);assert.equal(movie(m).review_text_n,null);});
 await test('C01 composites same person-film max +1 and atomic loser',async()=>{const m=create(),a=request('SET_PERSONAL_EVALUATION',m,null,null,{rating:7,review:'first'}),b=request('RECORD_PERSONAL_SEEN_WITH_EVALUATION',m,null,null,{rating:8,review:'second'}),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'STALE');assert.equal(movie(m).seen_n,false);assert.equal(movie(m).review_text_n,'first');assert.equal(versions(m).find(x=>x.kind==='person_film').version,'1');});
 await test('D01 group evaluation vs completion',async()=>{const m=create();success(one(app(request('COMPLETE_NOW',m,G,null,{participants:[N]}))));const n=schedule(m),a=request('SET_TOGETHER_EVALUATION',m,G,null,{rating:6}),b=completion(m,n,{rating:9}),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'STALE');assert.equal(movie(m).seen_rating_together,6);assert.equal(sql(`SELECT status FROM movie_nights WHERE id=${lit(n)}`),'proposed');});
 await test('D02 completion first rejects stale group evaluation',async()=>{const m=create(),n=schedule(m),a=completion(m,n,{rating:8,review:'atomic'}),b=request('SET_TOGETHER_EVALUATION',m,G,null,{rating:4}),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'STALE');assert.equal(movie(m).seen_rating_together,8);assert.equal(sql(`SELECT count(*) FROM movie_night_participants WHERE night_id=${lit(n)}`),'1');});
 await test('D03 duplicate composite completion has one satisfaction/receipt',async()=>{const m=create();success(one(app(request('ADD_PERSONAL_LIST',m))));success(one(app(request('ADD_PERSONAL_LIST',m,null,null,{},V),V)));const n=schedule(m),a=completion(m,n,{review:'once'}),before=Number(receipts()),r=await pair(app(a),app(a));assert.equal(r[1].replayed,true);assert.equal(Number(receipts()),before+1);assert.equal(sql(`SELECT count(*) FROM movie_night_participants WHERE night_id=${lit(n)}`),'1');assert.equal(sql(`SELECT active FROM personal_list_entries WHERE movie_id=${lit(m)} AND person_id=${lit(N)}`),'f');assert.equal(sql(`SELECT active FROM personal_list_entries WHERE movie_id=${lit(m)} AND person_id=${lit(V)}`),'t');});
 await test('E01 edit vs contextual completion preserves intention',async()=>{const m=create();success(one(app(request('ADD_PERSONAL_LIST',m))));const n=schedule(m),a=request('EDIT_NIGHT',m,G,n,{night_id:n,date:'2099-02-02'}),b=completion(m,n),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'STALE');assert.equal(sql(`SELECT count(*) FROM movie_night_participants WHERE night_id=${lit(n)}`),'0');assert.equal(sql(`SELECT active FROM personal_list_entries WHERE movie_id=${lit(m)}`),'t');});
 await test('E02 completion first rejects stale edit without partial context',async()=>{const m=create(),n=schedule(m),a=completion(m,n,{review:'completed'}),b=request('EDIT_NIGHT',m,G,n,{night_id:n,snack:'late'}),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'STALE');assert.equal(sql(`SELECT snack IS NULL FROM movie_nights WHERE id=${lit(n)}`),'t');});
 const week=()=>sql('SELECT app_current_week();');
 const veto=(k,m,p={},person=N)=>app(request(k,m,G,null,{expected_week_key:week(),...p},person),person);
 const resetVeto=()=>sql('DELETE FROM vetoes;');
 await test('F01 same caller/week different movies serializes person/week',async()=>{resetVeto();const a=create(),b=create(),r=await pair(veto('VETO_ADD',a),veto('VETO_ADD',b));assert.equal(r[1].error.code,'VETO_ALREADY_USED');assert.equal(sql('SELECT count(*) FROM vetoes'),'1');assert.equal(versions(b).length,0);});
 await test('F02 same caller/film duplicate ADD',async()=>{resetVeto();const m=create(),a=veto('VETO_ADD',m),b=veto('VETO_ADD',m),r=await pair(a,b);assert.equal(r[1].outcome,'STALE');assert.equal(sql('SELECT count(*) FROM vetoes'),'1');assert.equal(versions(m)[0].version,'1');});
 await test('F03 ADD vs observed REMOVE cannot remove new identity',async()=>{resetVeto();const m=create(),r=await pair(veto('VETO_ADD',m),veto('VETO_REMOVE',m,{veto_id:uid(99999)}));assert.equal(r[1].outcome,'STALE');assert.equal(sql('SELECT count(*) FROM vetoes'),'1');});
 await test('F04 old REMOVE concurrent with replacement cannot delete new identity',async()=>{resetVeto();const m=create();success(one(veto('VETO_ADD',m)));const id=sql('SELECT id FROM vetoes');success(one(veto('VETO_REMOVE',m,{veto_id:id})));const a=veto('VETO_ADD',m),b=request('VETO_REMOVE',m,G,null,{expected_week_key:week(),veto_id:id});
  // Even a supplied revision equal to the upcoming ADD cannot defeat identity.
  b.expected_versions[0].version=(BigInt(b.expected_versions[0].version)+1n).toString();const r=await pair(a,app(b));assert.equal(r[1].outcome,'ALREADY_IN_TARGET_STATE');assert.notEqual(sql('SELECT id FROM vetoes'),id);});
 await test('F05 week changes while waiting on person/week admission',async()=>{
  resetVeto();const m=create(),w=week(),control=session(),worker=session();
  sql(`CREATE TABLE public.test_week_clock(value text); INSERT INTO public.test_week_clock VALUES(${lit(w)});
   CREATE OR REPLACE FUNCTION public.app_current_week() RETURNS text LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT value FROM public.test_week_clock $$;`);
  try{control.write(`BEGIN; SELECT pg_advisory_xact_lock(473104,hashtext(${lit(N+':'+w)})); SELECT 'HELD';`);await control.wait(/HELD\n/);
   worker.write("BEGIN; SET LOCAL statement_timeout='10s'; SELECT 'PID:'||pg_backend_pid(); "+veto('VETO_ADD',m)+" SELECT 'DONE';");const out=await worker.wait(/PID:\d+\n/),pid=Number(out.match(/PID:(\d+)/)[1]);let blocked=false;for(let i=0;i<100&&!blocked;i++)blocked=sql(`SELECT cardinality(pg_blocking_pids(${pid}))>0;`)==='t';assert(blocked);
   // Test-only clock data changes after the wait is observed. Replacing an SQL
   // function while a backend is inside it would test cached code, not rollover.
   sql("UPDATE public.test_week_clock SET value='2999-W01';");
   control.end('COMMIT;');await control.done;worker.end('COMMIT;');assert.equal(result(await worker.done).outcome,'STALE');assert.equal(sql('SELECT count(*) FROM vetoes'),'0');
  }finally{control.end();worker.end();await Promise.allSettled([control.done,worker.done]);sql("CREATE OR REPLACE FUNCTION public.app_current_week() RETURNS text LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT to_char(clock_timestamp() AT TIME ZONE 'Europe/Rome','IYYY-\"W\"IW') $$; DROP TABLE public.test_week_clock;");}
 });
 await test('F06 different callers make independent progress',async()=>{resetVeto();const a=create(),b=create(),r=await pair(veto('VETO_ADD',a),veto('VETO_ADD',b,{},V),{wait:false});assert(r.every(x=>x.outcome==='SUCCESS'));assert.equal(sql('SELECT count(*) FROM vetoes'),'2');});
 await test('F07 veto vs group-film mutation shares exact CAS',async()=>{resetVeto();const m=create(),a=veto('VETO_ADD',m),b=app(request('PROPOSE_TO_GROUP',m,G)),r=await pair(a,b);assert.equal(r[1].outcome,'STALE');assert.equal(versions(m)[0].version,'1');});
 await test('G01 concurrent stable-ID create has one content, one version',async()=>{const p={title:'Stable external identity',tmdb_id:'87654321'},a=body('CONTENT_CREATE',null,null,null,p),b=body('CONTENT_CREATE',null,null,null,{...p,title:'Do not overwrite'}),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'ALREADY_IN_TARGET_STATE');assert.equal(r[0].result.movie_id,r[1].result.movie_id);assert.equal(sql('SELECT count(*) FROM movies WHERE tmdb_id=87654321'),'1');assert.equal(versions(r[0].result.movie_id)[0].version,'1');});
 await test('G02 metadata identity contenders serialize without duplicate identity',async()=>{const m=create(),n=create(),a=request('CONTENT_UPDATE_METADATA',m,null,null,{tmdb_id:'87654322'}),b=request('CONTENT_UPDATE_METADATA',n,null,null,{tmdb_id:'87654322'}),r=await pair(app(a),app(b));assert.equal(r[1].error.code,'CONFLICT');assert.equal(sql('SELECT count(*) FROM movies WHERE tmdb_id=87654322'),'1');assert.equal(movie(n).tmdb_id,null);});
 await test('H01 update vs delete stale CAS cannot delete newer content',async()=>{const m=create(),a=request('CONTENT_UPDATE_METADATA',m,null,null,{title:'Updated'}),b=request('CONTENT_DELETE',m),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'STALE');assert.equal(movie(m).title,'Updated');});
 await test('H02 delete vs update cannot resurrect content',async()=>{const m=create(),a=request('CONTENT_DELETE',m),b=request('CONTENT_UPDATE_METADATA',m,null,null,{title:'Never resurrect'}),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'ERROR');assert.equal(sql(`SELECT count(*) FROM movies WHERE id=${lit(m)}`),'0');assert.deepEqual(versions(m).map(x=>[x.version,x.dead]),[['1',true]]);});
 await test('I01 relation creation protects concurrent delete',async()=>{const m=create(),a=request('ADD_PERSONAL_LIST',m),b=request('CONTENT_DELETE',m),r=await pair(app(a),app(b));assert.equal(r[1].error.code,'CONTENT_PROTECTED');assert.equal(sql(`SELECT active FROM personal_list_entries WHERE movie_id=${lit(m)}`),'t');});
 await test('I02 delete first prevents orphan relation',async()=>{const m=create(),a=request('CONTENT_DELETE',m),b=request('ADD_PERSONAL_LIST',m),r=await pair(app(a),app(b));assert.equal(r[1].outcome,'ERROR');assert.equal(sql(`SELECT count(*) FROM personal_list_entries WHERE movie_id=${lit(m)}`),'0');});
 const matchSetup=()=>{sql("UPDATE swipe_sessions SET status='closed' WHERE status IN ('open','matched');");const m=create();success(one(app(request('PROPOSE_TO_GROUP',m,G))));return m;};
 await test('J01 concurrent Match start preserves one frozen deck/session',async()=>{const m=matchSetup(),before=receipts(),v=versions(m),r=await pair(match('start',{seed:1,deck:[m]}),match('start',{seed:2,deck:[m]},V));assert.equal(r[0].session.id,r[1].session.id);assert.equal(r[1].session.seed,1);assert.equal(receipts(),before);assert.deepEqual(versions(m),v);});
 await test('J02 duplicate swipe first write wins',async()=>{const m=matchSetup(),s=one(match('start',{seed:1,deck:[m]})).session.id,r=await pair(match('swipe',{session_id:s,movie_id:m,liked:true}),match('swipe',{session_id:s,movie_id:m,liked:false}));assert.equal(r[1].outcome,'ALREADY_IN_TARGET_STATE');assert.equal(sql(`SELECT liked FROM swipes WHERE session_id=${lit(s)}`),'t');});
 await test('J03 two-device swipes/acknowledgments preserve recognized match',async()=>{const m=matchSetup(),s=one(match('start',{seed:1,deck:[m]})).session.id;await pair(match('swipe',{session_id:s,movie_id:m,liked:true}),match('swipe',{session_id:s,movie_id:m,liked:true},V));const r=await pair(match('acknowledge-match',{session_id:s,matched_movie_id:m}),match('acknowledge-match',{session_id:s,matched_movie_id:m},V));assert.equal(r[0].session.matched_movie_id,m);assert.equal(r[1].outcome,'ALREADY_IN_TARGET_STATE');assert.equal(sql(`SELECT status FROM swipe_sessions WHERE id=${lit(s)}`),'done');});
 await test('J04 concurrent close is conditional and preserves frozen deck',async()=>{const m=matchSetup(),s=one(match('start',{seed:1,deck:[m]})).session.id,r=await pair(match('close',{session_id:s}),match('close',{session_id:s},V));assert.equal(r[1].outcome,'STALE');assert.deepEqual(r[0].session.deck,[m]);assert.equal(r[0].session.matched_movie_id,null);});
 await test('J05 concurrent reconcile-done has one transition',async()=>{const m=matchSetup(),s=one(match('start',{seed:1,deck:[m]})).session.id;one(match('swipe',{session_id:s,movie_id:m,liked:false}));one(match('swipe',{session_id:s,movie_id:m,liked:false},V));const r=await pair(match('reconcile-done',{session_id:s}),match('reconcile-done',{session_id:s},V));assert.equal(r[1].outcome,'ALREADY_IN_TARGET_STATE');assert.equal(r[1].session.status,'done');assert.equal(r[1].session.matched_movie_id,null);});
 await test('J06 mode revoked during session wait prevents waiting Match write',async()=>{const m=matchSetup(),s=one(match('start',{seed:1,deck:[m]})).session.id;
  try{const r=await pair(match('swipe',{session_id:s,movie_id:m,liked:true}),match('swipe',{session_id:s,movie_id:m,liked:true},V),{beforeRelease:()=>sql("UPDATE app_protocol_state SET mode='legacy';")});assert.equal(r[1].outcome,'ERROR');assert.equal(sql(`SELECT count(*) FROM swipes WHERE session_id=${lit(s)}`),'1');}
  finally{sql("UPDATE app_protocol_state SET mode='target';");}
 });
 const matchPair=()=>{const a=matchSetup(),b=create();success(one(app(request('PROPOSE_TO_GROUP',b,G))));return {a,b,s:one(match('start',{seed:1,deck:[a,b]})).session.id};};
 const like=(s,m,p)=>one(match('swipe',{session_id:s,movie_id:m,liked:true},p));
 const doubleLike=(s,m)=>{success(like(s,m,N));success(like(s,m,V));};
 const pending=s=>json(`SELECT app_match_progress(${lit(s)},${lit(G)},app_current_week());`).pending_movie_id;
 await test('H1-J07 acknowledgment before new swipe recognizes only observed A',async()=>{
  const {a,b,s}=matchPair();doubleLike(s,a);success(like(s,b,N));
  const r=await pair(match('acknowledge-match',{session_id:s,matched_movie_id:a}),match('swipe',{session_id:s,movie_id:b,liked:true},V));assert(r.every(x=>x.outcome==='SUCCESS'));assert.equal(r[0].session.matched_movie_id,a);assert.equal(pending(s),b);
  const retry=one(match('acknowledge-match',{session_id:s,matched_movie_id:a},V));assert.equal(retry.outcome,'ALREADY_IN_TARGET_STATE');assert.deepEqual(retry.session,r[0].session);assert.equal(pending(s),b);
 });
 await test('H1-J08 new swipe before acknowledgment makes observed A stale, never B',async()=>{
  const {a,b,s}=matchPair();doubleLike(s,a);success(like(s,b,N));const r=await pair(match('swipe',{session_id:s,movie_id:b,liked:true},V),match('acknowledge-match',{session_id:s,matched_movie_id:a}));
  assert.equal(r[1].outcome,'STALE');assert.equal(r[1].session.matched_movie_id,null);assert.equal(pending(s),b);
 });
 await test('H1-J09 concurrent duplicate observed acknowledgment is idempotent',async()=>{
  const {a,s}=matchPair();doubleLike(s,a);const r=await pair(match('acknowledge-match',{session_id:s,matched_movie_id:a}),match('acknowledge-match',{session_id:s,matched_movie_id:a},V));
  assert.equal(r[0].outcome,'SUCCESS');assert.equal(r[1].outcome,'ALREADY_IN_TARGET_STATE');assert.deepEqual(r[1].session,r[0].session);
 });
 await test('H1-J10 two-device retry while B becomes pending leaves B untouched',async()=>{
  const {a,b,s}=matchPair(),before=receipts();doubleLike(s,a);const p={session_id:s,matched_movie_id:a};success(one(match('acknowledge-match',p)));success(like(s,b,N));
  const r=await pair(match('acknowledge-match',p,V),match('swipe',{session_id:s,movie_id:b,liked:true} ,V));assert.equal(r[0].outcome,'ALREADY_IN_TARGET_STATE');assert.equal(pending(s),b);assert.equal(r[1].session.matched_movie_id,a);
  const next=one(match('acknowledge-match',{session_id:s,matched_movie_id:b}));assert.equal(next.outcome,'SUCCESS');assert.equal(next.session.matched_movie_id,b);const old=one(match('acknowledge-match',p,V));assert.equal(old.outcome,'STALE');assert.deepEqual(old.session,next.session);assert.equal(receipts(),before);
 });
 await test('H1-J11 close wins against unacknowledged observed match',async()=>{
  const {a,s}=matchPair();doubleLike(s,a);const r=await pair(match('close',{session_id:s}),match('acknowledge-match',{session_id:s,matched_movie_id:a},V));assert.equal(r[1].outcome,'STALE');assert.equal(r[1].session.matched_movie_id,null);assert.equal(r[1].session.status,'closed');
 });
 await test('H1-J12 acknowledgment wins before close; retry never reopens',async()=>{
  const {a,s}=matchPair();doubleLike(s,a);const r=await pair(match('acknowledge-match',{session_id:s,matched_movie_id:a}),match('close',{session_id:s},V));assert(r.every(x=>x.outcome==='SUCCESS'));const retry=one(match('acknowledge-match',{session_id:s,matched_movie_id:a},V));assert.equal(retry.outcome,'ALREADY_IN_TARGET_STATE');assert.deepEqual(retry.session,r[1].session);assert.equal(retry.session.status,'closed');
 });
 console.log(`Runtime contracts real PostgreSQL concurrency: ${count}/${count} PASS; independent backend/lock evidence; no live I/O.`);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(fixtureDB)await fixtureDB.db.close();});
