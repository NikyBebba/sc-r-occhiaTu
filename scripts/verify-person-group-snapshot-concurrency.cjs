#!/usr/bin/env node
// Disposable loopback PostgreSQL only. The NOTICE is emitted AFTER an actual
// table read and pg_current_snapshot(), BEFORE waiting on the test-only barrier.
// STABLE wrapper + STABLE RPC inherit that same calling statement snapshot.
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {fixture,read,uid,N,V,G}=require('./person-group-command-test-support.cjs');
const arg=n=>process.argv.find(a=>a.startsWith('--'+n+'='))?.slice(n.length+3);
const connection=arg('connection'),psql=arg('psql')||'psql';
if(!connection){console.error('Requires real local PostgreSQL --connection and an EMPTY sc_person_group_test* database.');process.exit(2);}
const url=new URL(connection);
if(!['postgresql:','postgres:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||!/^\/sc_person_group_test[a-z0-9_]*$/.test(url.pathname)||url.search)
 throw Error('Only explicit disposable IPv4 loopback accepted');
const opts=['-X','--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=1','--dbname',connection];
const env={...process.env,PGHOSTADDR:'127.0.0.1',PGSSLMODE:'disable',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'3'};
const lit=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
function sql(s){const r=spawnSync(psql,opts,{input:`SET request.jwt.claim.sub=${lit(N)}; `+s,encoding:'utf8',env,maxBuffer:64*1024*1024});
 if(r.error||r.status!==0)throw Error(r.error?.message||r.stderr);return r.stdout.trim();}
const json=s=>JSON.parse(sql(s));
function session(){
 const p=spawn(psql,opts,{env});let out='',err='';const watchers=[];
 const check=()=>{for(const w of [...watchers])if(w.pattern.test(out+'\n'+err)){clearTimeout(w.timer);watchers.splice(watchers.indexOf(w),1);w.resolve({out,err});}};
 p.stdout.on('data',b=>{out+=b;check();});p.stderr.on('data',b=>{err+=b;check();});
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>{
  for(const w of watchers){clearTimeout(w.timer);w.reject(Error('Session ended before barrier: '+err));}
  code?reject(Error(err)):resolve({out,err});});});
 done.catch(()=>{});
 return {write:s=>p.stdin.write(s+'\n'),end:s=>{if(!p.stdin.writableEnded)p.stdin.end((s||'')+'\n');},done,
  wait:pattern=>new Promise((resolve,reject)=>{const w={pattern,resolve,reject,timer:setTimeout(()=>reject(Error('Barrier timeout: '+out+' '+err)),15000)};watchers.push(w);check();})};
}
const command=(p,k,m,g,expected,params={})=>`SELECT set_config('request.jwt.claim.sub',${lit(p)},true); SELECT 'RESULT:'||public.domain_command(${lit(crypto.randomUUID())},${lit(k)},${lit(m)},${lit(g)},${expected===null?'NULL':expected},${lit(JSON.stringify(params))}::jsonb)::text;`;
const one=s=>JSON.parse(sql('BEGIN; '+s+' COMMIT;').split('\n').find(x=>x.startsWith('RESULT:')).slice(7));
const snap=()=>json(`BEGIN READ ONLY; SELECT set_config('request.jwt.claim.sub',${lit(N)},true) IS NOT NULL \\g /dev/null
 SELECT public.get_person_group_snapshot(${lit(G)},1); COMMIT;`);
const version=(k,s,e)=>Number(sql(`SELECT coalesce((SELECT version FROM domain_versions WHERE scope_kind=${lit(k)} AND scope_id=${lit(s)} AND entity_id=${lit(e)}),0);`));
let fixtureDB;
(async()=>{
 assert.equal(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m');"),'0');
 fixtureDB=await fixture();
 const bootstrap=fixtureDB.bootstrapSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated;',()=>
  "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
 assert(bootstrap.includes('DO $$ BEGIN'));assert(bootstrap.includes('END $$;'));
 sql(bootstrap);sql(read('database/supabase-migration-person-group-snapshot.sql'));
 const tables=['auth.users','app_members','movies','movie_nights','votes','vetoes','swipe_sessions','swipes',
  'groups','group_memberships','personal_list_entries','group_movie_states','movie_night_participants',
  'movie_night_intentions','domain_versions','domain_command_receipts','app_protocol_state'];
 const preservation=()=>sql(`SELECT encode(sha256(convert_to((${tables.map(t=>
  `(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text FROM ${t} t)`).join('||')}) ,'UTF8')),'hex');`);
 const beforeReads=preservation();okReadOnly();assert.equal(preservation(),beforeReads);
 function okReadOnly(){assert.equal(snap().outcome,'OK');const failure=json(`BEGIN READ ONLY;
  SET LOCAL request.jwt.claim.sub=''; SELECT get_person_group_snapshot(${lit(G)},1); COMMIT;`);
  assert.deepEqual(failure,{contract_version:1,outcome:'ERROR',error:{code:'UNAUTHENTICATED'}});}
 console.log('READ ONLY PostgreSQL: success/failure, 17 tables unchanged; SHA256 '+beforeReads);
 const wrapper=`CREATE FUNCTION pg_temp.read_at_barrier(g uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $test$
 DECLARE evidence jsonb;
 BEGIN
  SELECT jsonb_build_object('pid',pg_backend_pid(),'snapshot',pg_current_snapshot()::text,
   'catalog_count',count(*)) INTO evidence FROM public.movies;
  RAISE NOTICE 'SNAPSHOT_ACQUIRED:%',evidence::text;
  PERFORM pg_advisory_xact_lock(934217,1);
  RETURN public.get_person_group_snapshot(g,1);
 END $test$;`;
 let completed=0;
 async function race(name,write,check){
  const before=snap();assert.equal(before.outcome,'OK');
  const control=session(),reader=session();let result;
  try{
   control.write("SELECT pg_advisory_lock(934217,1); SELECT 'BARRIER_HELD';");await control.wait(/BARRIER_HELD/);
   reader.end(`${wrapper} BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; SELECT set_config('request.jwt.claim.sub',${lit(N)},true);
    SELECT 'SNAPSHOT_RESULT:'||pg_temp.read_at_barrier(${lit(G)})::text; COMMIT;`);
   const announced=await reader.wait(/SNAPSHOT_ACQUIRED:.*\n/);
   const proof=JSON.parse(announced.err.split('\n').find(l=>l.includes('SNAPSHOT_ACQUIRED:')).split('SNAPSHOT_ACQUIRED:')[1]);
   assert.equal(proof.catalog_count,before.catalog.length);
   const observed=json(`SELECT jsonb_build_object('xmin',backend_xmin::text,'wait',wait_event,'pid',pid) FROM pg_stat_activity WHERE pid=${proof.pid};`);
   assert(observed.xmin,'Actual statement snapshot must pin backend_xmin');
   assert.equal(observed.wait,'advisory');
   // Writer starts only AFTER snapshot evidence + table read + xmin are observed.
   const writer=session();writer.end(`BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL request.jwt.claim.sub=${lit(N)}; SELECT 'WRITER_PID:'||pg_backend_pid(); ${write}
    SELECT 'WRITER_XID:'||pg_current_xact_id()::text; COMMIT;`);
   const wr=await writer.done;
   assert(!/ERROR|deadlock|timeout/i.test(wr.err));
   const xid=wr.out.match(/WRITER_XID:(\d+)/)[1],pid=Number(wr.out.match(/WRITER_PID:(\d+)/)[1]);assert.notEqual(pid,proof.pid);
   assert.equal(sql(`SELECT pg_visible_in_snapshot(${lit(xid)}::xid8,${lit(proof.snapshot)}::pg_snapshot);`),'f');
   // No unproven "RPC started" barrier: the snapshot above predates this commit.
   control.end('SELECT pg_advisory_unlock(934217,1);');await control.done;
   result=await reader.done;
   const held=JSON.parse(result.out.split('\n').find(l=>l.startsWith('SNAPSHOT_RESULT:')).slice(16));
   assert.equal(held.outcome,'OK');assert.equal(held.payload_signature.value,before.payload_signature.value,'held statement must be entirely BEFORE');
   const after=snap();assert.equal(after.outcome,'OK');assert.notEqual(after.payload_signature.value,before.payload_signature.value);
   await check(before,after);
   // Opposite order: writer commit has already happened, new statement = AFTER.
   const opposite=snap();assert.equal(opposite.payload_signature.value,after.payload_signature.value);
   completed++;
   console.log('PASS '+name+' '+JSON.stringify({reader_pid:proof.pid,writer_pid:pid,statement_snapshot:proof.snapshot,writer_xid:xid,
    snapshot_pinned_xmin:observed.xmin,wait:observed.wait,before:before.payload_signature.value,after:after.payload_signature.value,
    command_results:wr.out.split('\n').filter(l=>l.startsWith('RESULT:')).map(l=>JSON.parse(l.slice(7)))}));
  }finally{
   control.end('SELECT pg_advisory_unlock_all();');reader.end();await Promise.allSettled([control.done,reader.done]);
  }
 }
 const create=i=>{const m=uid(70000+i);sql(`INSERT INTO movies(id,title) VALUES(${lit(m)},'Snapshot synthetic ${i}');`);return m;};
 const gs=(s,m)=>s.group.states.find(x=>x.movie_id===m);
 const ps=(s,m,p=N)=>s.personal.find(x=>x.person_id===p).states.find(x=>x.movie_id===m);
 let m=create(1);assert.equal(one(command(N,'ADD_PERSONAL_LIST',m,null,0)).outcome,'SUCCESS');
 await race('R01 second list/convergence',command(V,'ADD_PERSONAL_LIST',m,null,0),(b,a)=>{assert.equal(gs(b,m).effective_candidacy,false);assert.equal(gs(a,m).effective_candidacy,true);assert.equal(ps(a,m,V).list.active,true);});
 await race('R02 withdrawal/suppression',command(N,'WITHDRAW_GROUP_CANDIDACY',m,G,version('group_film',G,m)),(b,a)=>{assert(gs(b,m).effective_candidacy);assert(!gs(a,m).effective_candidacy);assert(ps(a,m).list.active);});
 m=create(3);one(command(N,'ADD_PERSONAL_LIST',m,null,0));one(command(V,'ADD_PERSONAL_LIST',m,null,0));let night;
 await race('R03 schedule',command(N,'SCHEDULE_NIGHT',m,G,null,{date:'2099-01-01',time:'21:30',select_candidate:true,expected_candidate_revision:version('group_film',G,m)}),(b,a)=>{
  assert(gs(b,m).list_visible);assert(!gs(a,m).list_visible);night=gs(a,m).active_night_ids[0];assert(night);assert.equal(sql(`SELECT count(*) FROM movie_night_intentions WHERE night_id=${lit(night)};`),'2');});
 await race('R04 completion/participants/satisfaction',command(N,'COMPLETE_NIGHT',m,G,1,{night_id:night,participants:[N,V]}),(b,a)=>{
  assert.equal(gs(b,m).completed_night_ids.length,0);assert.deepEqual(gs(a,m).completed_night_ids,[night]);assert.equal(a.participants.filter(p=>p.night_id===night).length,2);
  assert(!ps(a,m).list.active);assert(!ps(a,m,V).list.active);assert(!gs(a,m).effective_candidacy);assert.equal(version('night',G,night),2);});
 m=create(5);one(command(N,'ADD_PERSONAL_LIST',m,null,0));night=one(command(N,'SCHEDULE_NIGHT',m,G,null,{date:'2099-01-01',time:'21:30'})).night_id;
 await race('R05 edit/invalidation',command(N,'EDIT_NIGHT',m,G,1,{night_id:night,time:'22:30'}),(b,a)=>{
  assert.equal(b.nights.find(n=>n.night_id===night).time,'21:30');assert.equal(a.nights.find(n=>n.night_id===night).time,'22:30');
  assert.equal(sql(`SELECT count(*) FROM movie_night_intentions WHERE night_id=${lit(night)} AND invalidated_at IS NOT NULL;`),'1');assert(ps(a,m).list.active);});
 m=create(6);one(command(N,'ADD_PERSONAL_LIST',m,null,0));
 await race('R06a REMOVE commits independently',command(N,'REMOVE_PERSONAL_LIST',m,null,1),(b,a)=>{assert(ps(b,m).list.active);assert(!ps(a,m).list.active);assert.equal(ps(a,m).list.generation,'1');});
 await race('R06b re-add/new generation',command(N,'ADD_PERSONAL_LIST',m,null,2),(b,a)=>{assert(!ps(b,m).list.active);assert(ps(a,m).list.active);assert.equal(ps(a,m).list.generation,'2');});
 m=create(7);const vector=snap().versions;
 await race('R07 legacy veto/metadata',`UPDATE movies SET overview='Synthetic metadata revision' WHERE id=${lit(m)};
  INSERT INTO vetoes(person,movie_id,week_key) VALUES('N',${lit(m)},to_char(statement_timestamp() AT TIME ZONE 'Europe/Rome','IYYY-"W"IW'));`,(b,a)=>{
  assert.deepEqual(b.versions,vector);assert.deepEqual(a.versions,vector);assert(a.vetoes.some(v=>v.movie_id===m));assert.equal(a.catalog.find(x=>x.movie_id===m).overview,'Synthetic metadata revision');});
 assert.equal(completed,8); // R06 has two independent transitions, seven race families.
 assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle';"),'0');
 console.log('SINGLE-SNAPSHOT CONCURRENCY: PASS — R01–R07 (8 barriers), BEFORE + AFTER, independent backends');
 if(arg('performance')==='yes'){
  // Separate synthetic additions; no real data or materialized read model.
  for(const [c,n] of [[500,100],[2000,500]]){
   sql(`INSERT INTO movies(id,title) SELECT md5('perf-movie-'||i)::uuid,'Performance synthetic '||i FROM generate_series(1,${c}) i ON CONFLICT DO NOTHING;
    INSERT INTO movie_nights(id,movie_id,group_id,status,date,time) SELECT md5('perf-night-'||i)::uuid,md5('perf-movie-'||i)::uuid,${lit(G)},'confirmed','2099-01-01','21:30' FROM generate_series(1,${n}) i ON CONFLICT DO NOTHING;`);
   const times=[];let bytes;
   for(let i=0;i<5;i++){const start=performance.now();const s=snap();assert.equal(s.outcome,'OK');times.push(Math.round(performance.now()-start));bytes=Number(sql(`SELECT set_config('request.jwt.claim.sub',${lit(N)},false) IS NOT NULL \\g /dev/null
    SELECT octet_length(convert_to(get_person_group_snapshot(${lit(G)},1)::text,'UTF8'));`));}
   const explanation=sql(`SELECT set_config('request.jwt.claim.sub',${lit(N)},false) IS NOT NULL \\g /dev/null
    EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT get_person_group_snapshot(${lit(G)},1);`);
   const body=json("SELECT to_json(prosrc) FROM pg_proc WHERE oid='public.get_person_group_snapshot(uuid,integer)'::regprocedure;")
    .replace(/\bp_group_id\b/g,()=>lit(G)+'::uuid').replace(/\bp_contract_version\b/g,'1');
   const detail=json(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${body}`)[0];
   const scans=[];function visit(p){if(p['Relation Name'])scans.push({relation:p['Relation Name'],node:p['Node Type'],rows:p['Actual Rows'],loops:p['Actual Loops'],hits:p['Shared Hit Blocks']});for(const x of p.Plans||[])visit(x);}visit(detail.Plan);
   console.log('PERFORMANCE '+JSON.stringify({catalog:Number(sql('SELECT count(*) FROM movies;')),nights:Number(sql('SELECT count(*) FROM movie_nights;')),
    ms:times,bytes,explain:JSON.parse(explanation),compositional_query_ms:detail['Execution Time'],scans}));
  }
 }
})().catch(e=>{console.error('FAIL snapshot PostgreSQL validation:',e.stack);process.exitCode=1;})
 .finally(async()=>{if(fixtureDB)await fixtureDB.db.close();});
