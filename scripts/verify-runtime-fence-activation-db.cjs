#!/usr/bin/env node
'use strict';
// Real disposable PostgreSQL only; includes functional + independent-backend races.
const {spawn,spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {fixture,read,uid,N,V,X,G}=require('./person-group-command-test-support.cjs');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
const connection=arg('connection'),psql=arg('psql')||'psql';
if(!connection){console.error('Requires EMPTY disposable loopback --connection sc_person_group_test* and local psql.');process.exit(2);}
const url=new URL(connection);if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||!/^\/sc_person_group_test[a-z0-9_]*$/.test(url.pathname)||url.search)throw Error('Disposable IPv4 loopback database required');
const opts=['-X','--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=1','--dbname',connection];
const env={...process.env,PGSSLMODE:'disable',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'3'};
const lit=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
function raw(s){const r=spawnSync(psql,opts,{input:"SET statement_timeout='12s'; "+s,env,encoding:'utf8',maxBuffer:32*1024*1024});if(r.error)throw r.error;return r;}
function sql(s){const r=raw(s);if(r.status)throw Error(r.stderr);return r.stdout.trim();}
const json=s=>JSON.parse(sql(s));
const denied=(s,pattern=/permission denied/)=>{const r=raw(s);assert.notEqual(r.status,0,'Expected refusal');assert.match(r.stderr,pattern);};
const client=(s,person=N)=>`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(person)}; ${s} COMMIT;`;
function session(){const child=spawn(psql,opts,{env});let out='',err='';const watchers=[];
 const check=()=>{for(const w of [...watchers])if(w.re.test(out)){clearTimeout(w.timer);watchers.splice(watchers.indexOf(w),1);w.resolve(out);}};
 child.stdout.on('data',b=>{out+=b;check();});child.stderr.on('data',b=>err+=b);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{for(const w of watchers){clearTimeout(w.timer);w.reject(Error(err||'Ended before barrier'));}resolve({out,err,code});});});
 return {write:s=>child.stdin.write(s+'\n'),end:s=>{if(!child.stdin.writableEnded)child.stdin.end((s||'')+'\n');},done,
  wait:re=>new Promise((resolve,reject)=>{const w={re,resolve,reject,timer:setTimeout(()=>reject(Error('Barrier timeout '+out+' '+err)),12000)};watchers.push(w);check();})};}
const candidates=['supabase-runtime-write-fence.sql','supabase-initialize-person-group-night-versions.sql','supabase-runtime-target-activation.sql'];
const legacyGrants="GRANT SELECT,INSERT,UPDATE,DELETE ON movies TO authenticated; GRANT SELECT,INSERT,DELETE ON vetoes TO authenticated; GRANT SELECT,INSERT ON swipe_sessions,swipes TO authenticated; GRANT UPDATE(status,matched_movie_id,matched_at) ON swipe_sessions TO authenticated; GRANT EXECUTE ON FUNCTION manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text) TO authenticated;";
const cp=()=>json('SELECT public.runtime_4a4_capture_drain();');
const call=(name,p)=>`SELECT public.${name}(${lit(JSON.stringify(p))}::jsonb);`;
const audit=()=>json('SELECT public.runtime_4a4_audit();');
const allData=()=>sql("SELECT encode(sha256(convert_to((SELECT string_agg(doc,'' ORDER BY name) FROM ("+['movies','movie_nights','vetoes','swipe_sessions','swipes','personal_list_entries','group_movie_states','movie_night_participants','movie_night_intentions','domain_versions','domain_command_receipts'].map(t=>`SELECT '${t}' name,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text doc FROM public.${t} t`).join(' UNION ALL ')+") x),'UTF8')),'hex');");
const proofJSON=r=>JSON.parse(r.out.split('\n').find(x=>x.startsWith('RESULT:')).slice(7));
let e,count=0,races=0,baselineProof;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
async function tx(name,s,pattern){await test(name,()=>{const text='BEGIN; '+s+' ROLLBACK;';if(pattern)denied(text,pattern);else sql(text);});}
async function waitBlocked(pid,blocker){let seen=false;for(let i=0;i<100&&!seen;i++)seen=sql(`SELECT ${blocker}=ANY(pg_blocking_pids(${pid}));`)==='t';assert(seen,'Actual lock wait required');}
async function overlap(name,a,b,check){const A=session(),B=session();try{
 A.write("BEGIN; SET LOCAL statement_timeout='10s'; SELECT 'PID:'||pg_backend_pid(); "+a+" SELECT 'HELD';");const x=await A.wait(/HELD\n/),pa=Number(x.match(/PID:(\d+)/)[1]);
 B.write("BEGIN; SET LOCAL statement_timeout='10s'; SELECT 'PID:'||pg_backend_pid(); "+b+" SELECT 'DONE';");const y=await B.wait(/PID:\d+\n/),pb=Number(y.match(/PID:(\d+)/)[1]);assert.notEqual(pa,pb);await waitBlocked(pb,pa);
 A.end('COMMIT;');const ra=await A.done;assert.equal(ra.code,0,ra.err);B.end('COMMIT;');const rb=await B.done;await check(ra,rb);races++;console.log(`PASS RACE ${name}; backends ${pa}/${pb}; lock wait proven`);
 }finally{A.end('ROLLBACK;');B.end('ROLLBACK;');await Promise.allSettled([A.done,B.done]);}}
const command=(kind,m,n,expected,person=N,p={})=>`SET LOCAL request.jwt.claim.sub=${lit(person)}; SELECT 'RESULT:'||public.domain_command('${uid(900000+Number(expected))}',${lit(kind)},${lit(m)},${lit(G)},${expected},${lit(JSON.stringify({...n?{night_id:n}:{},...p}))}::jsonb)::text;`;
(async()=>{
 assert.equal(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m');"),'0','Database must be EMPTY');
 e=await fixture();sql(e.bootstrapSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated;',()=>"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;"));
 sql(read('database/supabase-migration-person-group-snapshot.sql'));sql(read('database/supabase-migration-runtime-contracts.sql'));sql(legacyGrants);
 const before=allData();for(const f of candidates)sql(read('database/'+f));
 await test('F01 installation dormant: data/mode/legacy grants preserved',()=>{assert.equal(allData(),before);assert.equal(sql('SELECT mode FROM app_protocol_state'),'legacy');assert.equal(sql("SELECT has_table_privilege('authenticated','movies','UPDATE')"),'t');assert.equal(sql("SELECT has_function_privilege('authenticated','execute_app_command(jsonb)','EXECUTE')"),'f');});
 await test('F02 preflight maps actual effective/column/function legacy surfaces',()=>{const a=audit();assert(a.manifest_ok);assert(!a.legacy_clear);for(const name of ['movies','vetoes','swipe_sessions','swipes','manage_movie_night'])assert(JSON.stringify(a.surfaces).includes(name));});
 await test('F03 real authorized legacy writer works before fence',()=>sql(client("UPDATE movies SET platform='Before fence' WHERE id="+lit(uid(95))+';')));
 await tx('F04 unknown relation manifest fails closed',"CREATE TABLE public.unknown_writer(id int); SELECT runtime_4a4_apply_fence();",/FENCE_MANIFEST_DRIFT/);
 await tx('F05 unknown PUBLIC function fails closed',"CREATE FUNCTION public.unknown_writer() RETURNS void LANGUAGE sql AS $$ SELECT $$; SELECT runtime_4a4_apply_fence();",/FENCE_MANIFEST_DRIFT/);
 await test('F06 fence applies/reruns with no target grant',()=>{sql('SELECT runtime_4a4_apply_fence();');sql('SELECT runtime_4a4_apply_fence();');assert(audit().legacy_clear);assert.equal(sql('SELECT mode FROM app_protocol_state'),'read_only');assert.equal(sql("SELECT has_function_privilege('authenticated','execute_match_action(integer,text,jsonb)','EXECUTE')"),'f');});
 baselineProof=cp();
 for(const isolation of ['REPEATABLE READ','SERIALIZABLE'])for(const expression of ['runtime_4a4_audit()','runtime_4a4_apply_fence()','runtime_4a4_capture_drain()',`runtime_4a4_verify_drain(${lit(JSON.stringify(baselineProof))})`,'runtime_4a4_target_used()',`runtime_4a4_initialize_nights(${lit(JSON.stringify(baselineProof))})`,`runtime_4a4_activate_target(${lit(JSON.stringify(baselineProof))})`,'runtime_4a4_enter_maintenance()'])await test('MVCC '+isolation+' refuses '+expression.split('(')[0],()=>denied('BEGIN ISOLATION LEVEL '+isolation+'; SELECT public.'+expression+'; ROLLBACK;',/OPERATOR_READ_COMMITTED_REQUIRED/));
 await test('DRAIN admitted legacy RPC without movie lock or real XID is captured',async()=>{
  sql("UPDATE app_protocol_state SET mode='legacy'; GRANT EXECUTE ON FUNCTION manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text) TO authenticated;");
  const definition=sql("SELECT pg_get_functiondef('public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)'::regprocedure);");
  sql(definition.replace('\nBEGIN\n','\nBEGIN\n PERFORM pg_catalog.pg_advisory_xact_lock(473107,1);\n'));
  const control=session(),worker=session();try{
   control.write("SELECT 'PID:'||pg_backend_pid(); SELECT pg_advisory_lock(473107,1); SELECT 'HELD';");const out=await control.wait(/HELD\n/),pid=Number(out.match(/PID:(\d+)/)[1]);
   worker.write(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; SELECT 'PID:'||pg_backend_pid(); SELECT manage_movie_night('edit',${lit(uid(92))},${lit(uid(2032))},p_snack=>'Drained RPC');`);
   const wo=await worker.wait(/PID:\d+\n/),wp=Number(wo.match(/PID:(\d+)/)[1]);await waitBlocked(wp,pid);
   assert.equal(sql(`SELECT backend_xid IS NULL FROM pg_stat_activity WHERE pid=${wp}`),'t','Admitted RPC has not assigned a real XID');
   sql('SELECT runtime_4a4_apply_fence();');const p=cp();denied(call('runtime_4a4_verify_drain',p),/DRAIN_PENDING/);denied(client(`SELECT manage_movie_night('edit',${lit(uid(92))},${lit(uid(2032))});`));
   control.end('SELECT pg_advisory_unlock_all();');await control.done;worker.end('COMMIT;');const r=await worker.done;assert.equal(r.code,0,r.err);assert.equal(sql(call('runtime_4a4_verify_drain',p)),'t');races++;
  }finally{control.end('SELECT pg_advisory_unlock_all();');worker.end('ROLLBACK;');await Promise.allSettled([control.done,worker.done]);sql(definition);}
 });
 baselineProof=cp();
 for(const role of ['anon','authenticated'])for(const table of ['movies','movie_nights','vetoes','swipe_sessions','swipes'])for(const op of ['INSERT','UPDATE','DELETE'])await test(`F07 ${role} ${table} ${op} revoked`,()=>assert.equal(sql(`SELECT has_table_privilege(${lit(role)},${lit(table)},${lit(op)})`),'f'));
 await test('F08 direct real INSERT/UPDATE/DELETE denied after fence',()=>{for(const s of ["INSERT INTO movies(title) VALUES('Denied');","UPDATE movies SET title='Denied';","DELETE FROM movies;","INSERT INTO swipe_sessions(seed,deck) VALUES(1,'{}');","DELETE FROM swipes;"])denied(client(s));});
 await test('F09 legacy RPC and raw domain/helper entrypoints denied',()=>{for(const signature of ['manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)','domain_command(uuid,text,uuid,uuid,bigint,jsonb)','app_phase2_effects(uuid,text,uuid,uuid,bigint,jsonb)','runtime_4a4_initialize_nights(jsonb)','runtime_4a4_activate_target(jsonb)'])assert.equal(sql(`SELECT has_function_privilege('authenticated',${lit(signature)},'EXECUTE')`),'f');denied(client("SELECT manage_movie_night('quick',"+lit(uid(95))+');'));});
 await tx('F10 PUBLIC column grant detected',"GRANT UPDATE(title) ON movies TO PUBLIC; DO $$ BEGIN IF (runtime_4a4_audit()->>'legacy_clear')::boolean THEN RAISE EXCEPTION 'FALSE_PASS'; END IF; END $$;");
 await tx('F11 sequence grant audited/revoked generically',"CREATE SEQUENCE public.fixture_sequence; GRANT USAGE,UPDATE ON SEQUENCE fixture_sequence TO PUBLIC; SELECT runtime_4a4_apply_fence(); DO $$ BEGIN IF has_sequence_privilege('authenticated','fixture_sequence','USAGE') THEN RAISE EXCEPTION 'FALSE_PASS'; END IF; END $$;");
 await tx('F12 inherited writer privilege refuses incomplete fence',"CREATE ROLE fixture_writer; GRANT UPDATE ON movies TO fixture_writer; GRANT fixture_writer TO authenticated; SELECT runtime_4a4_apply_fence();",/FENCE_INCOMPLETE/);
 await tx('F13 inherited helper EXECUTE is not silently accepted',"GRANT EXECUTE ON FUNCTION domain_bump(text,uuid,uuid) TO PUBLIC; SELECT runtime_4a4_apply_fence();",/FENCE_INCOMPLETE/);
 await test('F14 capture refuses same-transaction fence',()=>denied("BEGIN; UPDATE app_protocol_state SET mode='legacy'; SELECT runtime_4a4_apply_fence(); SELECT runtime_4a4_capture_drain(); COMMIT;",/FENCE_COMMIT_REQUIRED/));
 await test('F15 valid drain verifies; malformed/stale proof refuses',()=>{assert.equal(sql(call('runtime_4a4_verify_drain',baselineProof)),'t');for(const p of [null,{}, {...baselineProof,checkpoint_version:2},{...baselineProof,group_id:X},{...baselineProof,virtual_xids:[null]}])denied(call('runtime_4a4_verify_drain',p),/DRAIN_CHECKPOINT_INVALID/);});
 for(const end of ['COMMIT','ROLLBACK'])await test('DRAIN pre-fence RPC-like transaction / '+end,async()=>{
  // Operator explicitly restores only the known legacy grant for this isolated
  // fixture scenario. Never a candidate rollback path.
  sql("UPDATE app_protocol_state SET mode='legacy'; GRANT UPDATE ON movies TO authenticated;");
  const A=session();try{A.write("BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub="+lit(N)+"; UPDATE movies SET platform='In flight' WHERE id="+lit(uid(95))+"; SELECT 'HELD';");await A.wait(/HELD\n/);
   sql('SELECT runtime_4a4_apply_fence();');const proof=cp();assert(proof.virtual_xids.length>0);denied(call('runtime_4a4_verify_drain',proof),/DRAIN_PENDING/);denied(client("UPDATE movies SET platform='New denied';"));A.end(end+';');assert.equal((await A.done).code,0);assert.equal(sql(call('runtime_4a4_verify_drain',proof)),'t');races++;
  }finally{A.end('ROLLBACK;');await A.done;}
 });
 baselineProof=cp();
 await test('I01 all five states initialize to exact baseline one',()=>{sql(`SET request.jwt.claim.sub=${lit(N)}; INSERT INTO movie_nights(id,movie_id,group_id,status) VALUES(${lit(uid(80001))},${lit(uid(95))},${lit(G)},'proposed'),(${lit(uid(80002))},${lit(uid(95))},${lit(G)},'confirmed'),(${lit(uid(80003))},${lit(uid(95))},${lit(G)},'skipped');`);const r=json(call('runtime_4a4_initialize_nights',baselineProof));assert.equal(r.inserted,7);assert.equal(r.covered,7);assert.equal(sql("SELECT count(*) FROM domain_versions WHERE scope_kind='night' AND version=1 AND NOT tombstone"),'7');});
 await test('I02 rerun is exact no-op',()=>{const data=allData(),r=json(call('runtime_4a4_initialize_nights',baselineProof));assert.equal(r.inserted,0);assert.equal(allData(),data);});
 for(const [name,s]of [['newer',"UPDATE domain_versions SET version=2 WHERE scope_kind='night';"],['tombstone',"UPDATE domain_versions SET version=2,tombstone=true WHERE scope_kind='night';"],['scope',`INSERT INTO domain_versions(scope_kind,scope_id,entity_id,version) VALUES('night',${lit(X)},${lit(uid(2032))},1);`],['target-use',`INSERT INTO domain_command_receipts(caller_id,request_id,command_kind,payload_fingerprint,result_status,result) VALUES(${lit(N)},${lit(uid(89000))},'COMPLETE_NIGHT',repeat('a',64),'success','{}');`]])await tx('I03 refuses '+name,s+call('runtime_4a4_initialize_nights',baselineProof),/INITIALIZER_/);
 await test('I04 operator-only initializer is actually denied to browser',()=>denied(client(call('runtime_4a4_initialize_nights',baselineProof))));
 await overlap('C initializer / initializer',call('runtime_4a4_initialize_nights',baselineProof),call('runtime_4a4_initialize_nights',baselineProof),async(a,b)=>assert.equal(b.code,0,b.err));
 await overlap('D initializer / target night operator mutation',call('runtime_4a4_initialize_nights',baselineProof),command('CANCEL_NIGHT',uid(95),uid(80001),1),async(a,b)=>{assert.equal(b.code,0,b.err);assert.equal(proofJSON(b).outcome,'SUCCESS');assert.equal(sql(`SELECT version FROM domain_versions WHERE scope_kind='night' AND entity_id=${lit(uid(80001))}`),'2');});
 await test('I05 post-race initializer refuses target-used token',()=>denied(call('runtime_4a4_initialize_nights',baselineProof),/INITIALIZER_TARGET_USE_OR_AMBIGUITY/));
 // Restore the INITIAL synthetic fixture for activation testing by rolling back
 // an independent schema clone is unnecessary: use another synthetic night and
 // remove only this test command's receipt, then monotonically retain v2 in the
 // first fixture. Activation refusal is tested here; clean activation uses a new
 // EMPTY disposable DB supplied separately via --activation-connection.
 await test('A01 target-used fixture cannot activate',()=>denied(call('runtime_4a4_activate_target',baselineProof),/ACTIVATION_TARGET_USE_OR_AMBIGUITY/));
 const activationConnection=arg('activation-connection');
 if(!activationConnection)throw Error('Also requires --activation-connection to a second EMPTY disposable database');
 const au=new URL(activationConnection);assert(['postgres:','postgresql:'].includes(au.protocol));assert.equal(au.hostname,'127.0.0.1');assert.equal(au.host,url.host);assert(/^\/sc_person_group_test[a-z0-9_]*$/.test(au.pathname));assert.notEqual(au.pathname,url.pathname);assert.equal(au.search,'');
 // Same psql helpers now use the independent activation database, never reset
 // or delete target-used state. Both DBs are validated EMPTY before bootstrap.
 opts[opts.length-1]=activationConnection;
 assert.equal(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p');"),'0');
 sql(e.bootstrapSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated;',()=>"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;"));sql(read('database/supabase-migration-person-group-snapshot.sql'));sql(read('database/supabase-migration-runtime-contracts.sql'));sql(legacyGrants);for(const f of candidates)sql(read('database/'+f));
 await test('A02 legacy to target direct refuses',()=>denied(call('runtime_4a4_activate_target',{}),/ACTIVATION_PRE_TARGET_MODE_REQUIRED/));
 sql('SELECT runtime_4a4_apply_fence();');baselineProof=cp();
 await test('A03 missing night tokens refuses',()=>denied(call('runtime_4a4_activate_target',baselineProof),/ACTIVATION_NIGHT_TOKEN_INVALID/));
 sql(call('runtime_4a4_initialize_nights',baselineProof));
 await tx('A04 invalid membership refuses',`UPDATE group_memberships SET active=false WHERE person_id=${lit(V)};`+call('runtime_4a4_activate_target',baselineProof),/ACTIVATION_FOUNDATION_INVALID/);
 await tx('A05 invalid group refuses',"UPDATE groups SET status='archived';"+call('runtime_4a4_activate_target',baselineProof),/ACTIVATION_FOUNDATION_INVALID/);
 await tx('A05b missing completed participants refuses',`DELETE FROM movie_night_participants WHERE night_id=${lit(uid(2032))};`+call('runtime_4a4_activate_target',baselineProof),/ACTIVATION_FOUNDATION_INVALID/);
 for(const f of ['get_person_group_snapshot(uuid,integer)','execute_match_action(integer,text,jsonb)','execute_app_command(jsonb)'])await tx('A06 missing '+f,'DROP FUNCTION public.'+f+';'+call('runtime_4a4_activate_target',baselineProof),/ACTIVATION_RUNTIME_CONTRACT_INVALID|DRAIN_CHECKPOINT_INVALID|FENCE_REQUIRED|does not exist/);
 await tx('A07 fence broken refuses',"GRANT UPDATE(title) ON movies TO authenticated;"+call('runtime_4a4_activate_target',baselineProof),/FENCE_REQUIRED/);
 await tx('A08 protocol mismatch refuses',"UPDATE app_protocol_state SET minimum_client_protocol=2;"+call('runtime_4a4_activate_target',baselineProof),/ACTIVATION_PRE_TARGET_MODE_REQUIRED/);
 await test('A09 read_only bootstrap MAINTENANCE before activation',()=>{assert.equal(json(`SET request.jwt.claim.sub=${lit(N)}; SELECT get_app_runtime_context(1);`).error.code,'MAINTENANCE');});
 const baseConnection=activationConnection;
 const cloneActivation=suffix=>{const baseName=new URL(baseConnection).pathname.slice(1),name=baseName+'_'+suffix;assert(/^[a-z0-9_]+$/.test(name));const targetURL=new URL(baseConnection),admin=new URL(baseConnection);targetURL.pathname='/'+name;admin.pathname='/postgres';const ao=[...opts];ao[ao.length-1]=admin.toString();const r=spawnSync(psql,ao,{input:`CREATE DATABASE "${name}" TEMPLATE "${baseName}";`,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);opts[opts.length-1]=targetURL.toString();return cp();};
 await test('L01 fence/drain BEFORE backfill preserves empty protocol, attestation and candidacy',()=>{
  const source=read('database/supabase-backfill-person-group-foundation.sql'),boundary=e.bootstrapSQL.indexOf(source);assert(boundary>0);const prefix=e.bootstrapSQL.slice(0,boundary).replace('CREATE ROLE anon; CREATE ROLE authenticated;',()=>"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
  const name=new URL(baseConnection).pathname.slice(1)+'_backfill',admin=new URL(baseConnection),local=new URL(baseConnection);admin.pathname='/postgres';local.pathname='/'+name;const ao=[...opts];ao[ao.length-1]=admin.toString();const made=spawnSync(psql,ao,{input:`CREATE DATABASE "${name}";`,env,encoding:'utf8'});assert.equal(made.status,0,made.stderr);opts[opts.length-1]=local.toString();
  sql(prefix);sql(legacyGrants);sql(read('database/supabase-runtime-write-fence.sql'));sql('SELECT runtime_4a4_apply_fence();');assert.equal(sql('SELECT count(*) FROM app_protocol_state'),'0');const p=cp();assert.equal(sql(call('runtime_4a4_verify_drain',p)),'t');
  const settings={foundation_approved:'verified-preflight',foundation_group_id:G,foundation_n_user_id:N,foundation_v_user_id:V,foundation_completed_ids:JSON.stringify([uid(2032),uid(2033),uid(2034)])};const config=Object.entries(settings).map(([k,v])=>`SELECT set_config(${lit('scorochiatu.'+k)},${lit(v)},false);`).join('');
  denied("BEGIN; INSERT INTO app_protocol_state(mode) VALUES('read_only');"+config+source,/FOUNDATION_BACKFILL_EXPECTED_EMPTY/);assert.equal(sql('SELECT count(*) FROM app_protocol_state'),'0');
  sql(config+source);assert.equal(sql('SELECT mode FROM app_protocol_state'),'legacy');assert(audit().legacy_clear);assert.equal(sql('SELECT count(*) FROM personal_list_entries'),'0');assert.equal(sql('SELECT count(*) FROM movie_night_participants'),'6');assert.equal(sql("SELECT count(*) FROM group_movie_states WHERE support_origin='legacy'"),sql('SELECT count(*) FROM movies WHERE in_shared_list'));denied(call('runtime_4a4_verify_drain',p),/FENCE_REQUIRED|DRAIN_CHECKPOINT_INVALID/);
  for(const file of ['supabase-migration-person-group-commands.sql','supabase-migration-person-group-snapshot.sql','supabase-migration-runtime-contracts.sql'])sql(read('database/'+file));for(const file of candidates.slice(1))sql(read('database/'+file));sql('SELECT runtime_4a4_apply_fence();');const next=cp();assert.equal(json(call('runtime_4a4_initialize_nights',next)).covered,4);assert.equal(sql(call('runtime_4a4_activate_target',next)),'TARGET');opts[opts.length-1]=baseConnection;
 });
 let proof=cloneActivation('initializer_first');
 await overlap('E initializer first / activation',call('runtime_4a4_initialize_nights',proof),call('runtime_4a4_activate_target',proof),async(a,b)=>assert.equal(b.code,0,b.err));
 proof=cloneActivation('two_activation');
 await overlap('G two activation attempts',call('runtime_4a4_activate_target',proof),call('runtime_4a4_activate_target',proof),async(a,b)=>{assert.equal(b.code,3);assert.match(b.err,/ACTIVATION_PRE_TARGET_MODE_REQUIRED/);});
 proof=cloneActivation('mutation_first');
 await overlap('D target night mutation first / initializer',command('EDIT_NIGHT',uid(92),uid(2032),1,N,{snack:'Target first'}),call('runtime_4a4_initialize_nights',proof),async(a,b)=>{assert.equal(b.code,3);assert.match(b.err,/INITIALIZER_TARGET_USE_OR_AMBIGUITY/);assert.equal(sql(`SELECT version FROM domain_versions WHERE scope_kind='night' AND entity_id=${lit(uid(2032))}`),'2');});
 proof=cloneActivation('creation');
 await overlap('D initializer / night creation',call('runtime_4a4_initialize_nights',proof),command('SCHEDULE_NIGHT',uid(95),null,null,N,{date:'2099-01-01',time:'21:30'}),async(a,b)=>{assert.equal(b.code,0,b.err);const r=proofJSON(b);assert.equal(r.outcome,'SUCCESS');assert.equal(sql(`SELECT version FROM domain_versions WHERE scope_kind='night' AND entity_id=${lit(r.night_id)}`),'1');});
 proof=cloneActivation('grant_window');
 await test('F/H/I activation window blocks legacy, target command and Match until atomic commit',async()=>{
  const A=session(),B=session();try{A.write("BEGIN; SELECT 'PID:'||pg_backend_pid(); "+call('runtime_4a4_activate_target',proof)+" SELECT 'HELD';");const ao=await A.wait(/HELD\n/),pa=Number(ao.match(/PID:(\d+)/)[1]);
   B.write(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; SELECT 'PID:'||pg_backend_pid(); UPDATE movies SET platform='Forbidden during activation';`);const bo=await B.wait(/PID:\d+\n/),pb=Number(bo.match(/PID:(\d+)/)[1]);await waitBlocked(pb,pa);
   assert.equal(sql("SELECT has_table_privilege('authenticated','movies','UPDATE')"),'f');assert.equal(sql("SELECT has_function_privilege('authenticated','execute_app_command(jsonb)','EXECUTE')"),'f');
   denied(client("SELECT execute_app_command('{}');"));denied(client("SELECT execute_match_action(1,'start','{\"seed\":1,\"deck\":[]}');"));
   assert.equal(json(`SET request.jwt.claim.sub=${lit(N)}; SELECT execute_match_action(1,'start','{"seed":1,"deck":[]}');`).error.code,'MAINTENANCE');
   A.end('COMMIT;');assert.equal((await A.done).code,0);B.end('COMMIT;');const br=await B.done;assert.equal(br.code,3);assert.match(br.err,/permission denied/);assert(['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(json(client("SELECT execute_match_action(1,'start','{\"seed\":1,\"deck\":[]}');")).outcome));denied(client("UPDATE movies SET platform='Forbidden after activation';"));races+=3;
  }finally{A.end('ROLLBACK;');B.end('ROLLBACK;');await Promise.allSettled([A.done,B.done]);}
 });
 opts[opts.length-1]=baseConnection;baselineProof=cp();
 await overlap('E activation / initializer',call('runtime_4a4_activate_target',baselineProof),call('runtime_4a4_initialize_nights',baselineProof),async(a,b)=>{assert.equal(b.code,3);assert.match(b.err,/DRAIN_CHECKPOINT_INVALID|INITIALIZER_CONFIGURATION_INVALID/);});
 await test('A10 authenticated grants exact; PUBLIC/anon/internal remain blocked',()=>{for(const f of ['get_app_runtime_context(integer)','get_person_group_snapshot(uuid,integer)','execute_app_command(jsonb)','execute_match_action(integer,text,jsonb)']){assert.equal(sql(`SELECT has_function_privilege('authenticated',${lit(f)},'EXECUTE')`),'t');assert.equal(sql(`SELECT has_function_privilege('anon',${lit(f)},'EXECUTE')`),'f');}assert(audit().legacy_clear);denied(client('SELECT domain_bump(\'content\','+lit(uid(95))+','+lit(uid(95))+');'));});
 await test('A11 target bootstrap/Snapshot and unauthorized caller blocked',()=>{const r=json(client('SELECT get_app_runtime_context(1);'));assert.equal(r.runtime.mode,'target');assert.equal(r.runtime.activation_allowed,true);assert.equal(r.caller.person_id,N);assert.equal(json(client(`SELECT get_person_group_snapshot(${lit(G)},1);`)).outcome,'OK');assert.equal(json(client('SELECT get_app_runtime_context(1);',X)).outcome,'ERROR');denied(client("UPDATE movies SET title='Denied';"));denied(client('SELECT * FROM domain_versions;'));});
 await test('A12 target-used evidence conservative even before first command',()=>assert.equal(sql('SELECT runtime_4a4_target_used()'),'t'));
 await test('MATCH fence retains start/swipe/ack H1/close/reconcile via authorized facade',()=>{
  const match=(action,p,person=N)=>json(client(`SELECT execute_match_action(1,${lit(action)},${lit(JSON.stringify(p))});`,person));
  const content=uid(95);sql(`SET request.jwt.claim.sub=${lit(N)}; SELECT domain_command(${lit(uid(989000))},'PROPOSE_TO_GROUP',${lit(content)},${lit(G)},0,'{}'); UPDATE swipe_sessions SET status='closed' WHERE status IN ('open','matched');`);
  const s=match('start',{seed:1,deck:[content]}).session.id;for(const p of [N,V])assert.equal(match('swipe',{session_id:s,movie_id:content,liked:true},p).outcome,'SUCCESS');assert.equal(match('reconcile-done',{session_id:s}).session.status,'open');
  const ack={session_id:s,matched_movie_id:content};assert.equal(match('acknowledge-match',ack).session.matched_movie_id,content);assert.equal(match('acknowledge-match',ack,V).outcome,'ALREADY_IN_TARGET_STATE');
  const next=match('start',{seed:2,deck:[]});assert.equal(match('close',{session_id:next.session.id}).session.status,'closed');denied(client(`INSERT INTO swipes(session_id,movie_id,person,liked) VALUES(${lit(s)},${lit(content)},'N',false);`));
 });
 await test('J target command in flight / maintenance / rollback refusal',async()=>{
  const b={protocol_version:1,request_id:uid(989001),intent:'SET_PERSONAL_EVALUATION',target:{movie_id:uid(95),group_id:null,night_id:null},expected_versions:[{scope_kind:'person_film',scope_id:N,entity_id:uid(95),version:'0'}],parameters:{review:'Target durable state'}};
  const A=session();try{A.write(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; SELECT 'RESULT:'||execute_app_command(${lit(JSON.stringify(b))})::text; SELECT 'HELD';`);const out=await A.wait(/HELD\n/);assert.equal(proofJSON({out}).outcome,'SUCCESS');
   sql('SELECT runtime_4a4_enter_maintenance();');assert.equal(sql('SELECT runtime_4a4_target_used()'),'t');denied(call('runtime_4a4_activate_target',cp()),/ACTIVATION_PRE_TARGET_MODE_REQUIRED/);denied(client("UPDATE movies SET title='Unsafe rollback';"));
   A.end('COMMIT;');assert.equal((await A.done).code,0);assert.equal(sql(`SELECT count(*) FROM domain_command_receipts WHERE request_id=${lit(b.request_id)}`),'1');races++;
  }finally{A.end('ROLLBACK;');await A.done;}
 });
 await test('A13 maintenance never restores legacy or reduces protocol floor',()=>{sql('SELECT runtime_4a4_enter_maintenance();');assert.equal(sql('SELECT mode FROM app_protocol_state'),'read_only');assert.equal(sql('SELECT minimum_client_protocol FROM app_protocol_state'),'1');assert.equal(sql('SELECT runtime_4a4_target_used()'),'t');denied(call('runtime_4a4_activate_target',cp()),/ACTIVATION_PRE_TARGET_MODE_REQUIRED/);denied(call('runtime_4a4_initialize_nights',cp()),/INITIALIZER_CONFIGURATION_INVALID/);denied(client("UPDATE movies SET title='No rollback';"));assert(audit().legacy_clear);});
 console.log(`Fence/activation PostgreSQL: ${count}/${count} functional PASS; ${races}/${races} real-backend race groups PASS. LOCAL ONLY.`);
})().catch(x=>{console.error(x.stack);process.exitCode=1;}).finally(async()=>{if(e)await e.db.close();});
