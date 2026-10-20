#!/usr/bin/env node
'use strict';
// Real disposable PostgreSQL ACL/RLS/publication tests. Not a Realtime server
// delivery test: hosted Realtime semantics remain an explicit deployment gate.
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {fixture,read,uid,N,V,X,G}=require('./person-group-command-test-support.cjs');
const Core=require('../js/snapshot/core');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
const connection=arg('connection'),psql=arg('psql')||'psql';
if(!connection)throw Error('Requires EMPTY disposable loopback --connection sc_person_group_test*');
const u=new URL(connection);
assert(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&/^\/sc_person_group_test[a-z0-9_]*$/.test(u.pathname)&&!u.search);
const options=['-X','--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=1','--dbname',connection];
const env={...process.env,PGSSLMODE:'disable',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'3'};
const lit=x=>"'"+String(x).replaceAll("'","''")+"'";
function raw(s){return spawnSync(psql,options,{input:"SET statement_timeout='15s'; "+s,env,encoding:'utf8',maxBuffer:32*1024*1024});}
function sql(s){const r=raw(s);if(r.error||r.status)throw Error(r.error?.message||r.stderr);return r.stdout.trim();}
function refuses(s,re=/permission denied/){const r=raw(s);assert.notEqual(r.status,0);assert.match(r.stderr,re);}
const as=(person,s,role='authenticated')=>`BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub=${lit(person||'')}; ${s} COMMIT;`;
const select=(person,where='true',role)=>sql(as(person,`SELECT count(*) FROM public.domain_versions WHERE ${where};`,role));
const signal=read('database/supabase-runtime-realtime-invalidation.sql');
const publication=()=>sql("SELECT string_agg(c.relname,',' ORDER BY c.relname) FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid WHERE p.pubname='supabase_realtime';");
const acl=()=>sql("SELECT string_agg(oid::text||coalesce(proacl::text,''),',' ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace;");
const audit=()=>JSON.parse(sql('SELECT public.runtime_4a4_audit();'));
let checks=0,e;
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
const tx=(s)=>sql('BEGIN; '+s+' ROLLBACK;');
(async()=>{
 assert.equal(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','public') AND c.relkind IN ('r','p');"),'0');
 e=await fixture();
 sql(e.bootstrapSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated;',()=>"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;"));
 for(const f of ['supabase-migration-person-group-snapshot.sql','supabase-migration-runtime-contracts.sql','supabase-runtime-write-fence.sql','supabase-initialize-person-group-night-versions.sql','supabase-runtime-target-activation.sql'])sql(read('database/'+f));
 sql('CREATE PUBLICATION supabase_realtime FOR TABLE public.movies,public.movie_nights,public.vetoes,public.swipe_sessions,public.swipes;');
 const priorPublication=publication(),priorACL=acl();
 await test('P01 absent signal before candidate',()=>assert(!priorPublication.includes('domain_versions')));
 sql(signal);
 await test('P02 exact additive publication',()=>assert.equal(publication(),['domain_versions',...priorPublication.split(',')].sort().join(',')));
 await test('P03 rerun safe and function ACL unchanged',()=>{sql(signal);assert.equal(acl(),priorACL);});
 await test('S01 dormant installation preserves legacy mode and no facade activation',()=>{
  assert.equal(sql('SELECT mode FROM app_protocol_state'),'legacy');
  for(const f of ['get_app_runtime_context(integer)','get_person_group_snapshot(uuid,integer)','execute_app_command(jsonb)','execute_match_action(integer,text,jsonb)'])assert.equal(sql(`SELECT has_function_privilege('authenticated',${lit(f)},'EXECUTE');`),'f');
  refuses(as(N,'SELECT * FROM domain_versions;')); // bootstrap EXECUTE still revoked
 });
 // Use the actual 4A4 operator boundaries, not a substitute activation model.
 sql('SELECT runtime_4a4_apply_fence();');
 await test('F01 new read surface leaves fence proof intact',()=>{const a=audit();assert(a.manifest_ok&&a.legacy_clear);});
 const proof=sql('SELECT runtime_4a4_capture_drain();');
 sql(`SELECT runtime_4a4_initialize_nights(${lit(proof)}::jsonb);`);
 await test('F02 read_only still inaccessible before facade grant',()=>refuses(as(N,'SELECT * FROM domain_versions;')));
 sql(`SELECT runtime_4a4_activate_target(${lit(proof)}::jsonb);`);
 await test('F03 4A4 activation succeeds unchanged',()=>{assert.equal(sql('SELECT mode FROM app_protocol_state'),'target');assert(audit().legacy_clear);});
 const listCommand=`SELECT domain_command(${lit(uid(802001))},'ADD_PERSONAL_LIST',${lit(uid(95))},NULL,0,'{}') \\g /dev/null\n`;
 const wireCases=[['baseline SELF',N,''],['baseline OTHER',V,''],['SELF List',N,listCommand],
  ['OTHER List',V,listCommand],['large Decimal',N,`INSERT INTO domain_versions VALUES('content',${lit(uid(95))},${lit(uid(95))},9223372036854775807,false);`],
  ['content tombstone',N,`INSERT INTO domain_versions VALUES('content',${lit(uid(802002))},${lit(uid(802002))},1,true);`]];
 for(const [label,caller,setup]of wireCases)await test('WIRE '+label,()=>{
  const snapshot=JSON.parse(sql(`BEGIN; SET LOCAL request.jwt.claim.sub=${lit(N)}; ${setup}
   SET LOCAL request.jwt.claim.sub=${lit(caller)}; SELECT get_person_group_snapshot(${lit(G)},1); ROLLBACK;`));
  const decoded=Core.decodeSnapshotEnvelope(snapshot,{callerId:caller,groupId:G,contractVersion:1,contextEpoch:1});
  assert.equal(decoded.kind,'DECODED_SNAPSHOT',JSON.stringify(decoded));
 });
 const group2=uid(3002),m=uid(95),gone=uid(800001),orphan=uid(800002),night=uid(2032);
 sql(`INSERT INTO groups(id) VALUES(${lit(group2)}); INSERT INTO group_memberships(group_id,person_id) VALUES(${lit(group2)},${lit(V)});
  INSERT INTO domain_versions(scope_kind,scope_id,entity_id,version,tombstone) VALUES
  ('person_film',${lit(N)},${lit(m)},1,false),('person_film',${lit(V)},${lit(m)},1,false),
  ('person_film',${lit(X)},${lit(m)},1,false),('person_film',${lit(N)},${lit(orphan)},1,false),
  ('person_film',${lit(N)},${lit(gone)},1,true),
  ('group_film',${lit(G)},${lit(m)},1,false),('group_film',${lit(group2)},${lit(m)},1,false),
  ('group_film',${lit(X)},${lit(m)},1,false),('group_film',${lit(G)},${lit(orphan)},1,false),
  ('group_film',${lit(G)},${lit(gone)},1,true),
  ('content',${lit(m)},${lit(m)},1,false),('content',${lit(orphan)},${lit(orphan)},1,false),
  ('content',${lit(gone)},${lit(gone)},1,true),
  ('night',${lit(group2)},${lit(night)},1,false),('night',${lit(G)},${lit(orphan)},1,false),
  ('night',${lit(G)},${lit(gone)},1,true),('night',${lit(X)},${lit(gone)},1,true);`);
 const is=(kind,scope,entity=m)=>`scope_kind=${lit(kind)} AND scope_id=${lit(scope)} AND entity_id=${lit(entity)}`;
 await test('A01 PUBLIC-only role denied',()=>{sql("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='realtime_public_probe') THEN CREATE ROLE realtime_public_probe; END IF; END $$;");refuses(as(null,'SELECT * FROM domain_versions;','realtime_public_probe'));});
 await test('A02 anon denied',()=>refuses(as(N,'SELECT * FROM domain_versions;','anon')));
 await test('A03 no mapping denied even without client filters',()=>assert.equal(select(X),'0'));
 await test('A04 no JWT denied',()=>assert.equal(select(null),'0'));
 for(const [caller,other]of [[N,V],[V,N]]){
  await test('A05 own personal scope '+caller,()=>assert.equal(select(caller,is('person_film',caller)),'1'));
  await test('A06 other personal scope '+caller,()=>assert.equal(select(caller,is('person_film',other)),'0'));
 }
 await test('A07 authorized current group',()=>assert.equal(select(N,is('group_film',G)),'1'));
 await test('A08 unrelated group denied',()=>assert.equal(select(N,is('group_film',group2)),'0'));
 await test('A09 other membership does not widen selected Snapshot context',()=>assert.equal(select(V,is('group_film',group2)),'0'));
 await test('A10 orphan group denied',()=>assert.equal(select(N,is('group_film',X)),'0'));
 await test('A11 night authorized',()=>assert.equal(select(N,is('night',G,night)),'1'));
 await test('A12 wrong-group night denied',()=>assert.equal(select(N,is('night',group2,night)),'0'));
 await test('A13 invalid entity non-tombstones denied',()=>assert.equal(select(N,`entity_id=${lit(orphan)}`),'0'));
 await test('A14 active mapping removed denies all',()=>tx(`DELETE FROM app_members WHERE user_id=${lit(N)}; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; DO $$ BEGIN IF EXISTS(SELECT FROM domain_versions) THEN RAISE EXCEPTION 'LEAK'; END IF; END $$;`));
 await test('A15 inactive membership denies all',()=>tx(`UPDATE group_memberships SET active=false WHERE person_id=${lit(N)}; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; DO $$ BEGIN IF EXISTS(SELECT FROM domain_versions) THEN RAISE EXCEPTION 'LEAK'; END IF; END $$;`));
 await test('A16 removed membership denies all',()=>tx(`DELETE FROM group_memberships WHERE person_id=${lit(N)}; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; DO $$ BEGIN IF EXISTS(SELECT FROM domain_versions) THEN RAISE EXCEPTION 'LEAK'; END IF; END $$;`));
 await test('A17 archived group denies all',()=>tx(`UPDATE groups SET status='archived' WHERE id=${lit(G)}; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; DO $$ BEGIN IF EXISTS(SELECT FROM domain_versions) THEN RAISE EXCEPTION 'LEAK'; END IF; END $$;`));
 await test('C01 relationless content is inside actual Snapshot catalog coverage',()=>{
  const s=JSON.parse(sql(as(N,`SELECT get_person_group_snapshot(${lit(G)},1);`)));
  assert.equal(s.outcome,'OK');assert(s.catalog.some(x=>x.movie_id===m));assert.equal(select(N,is('content',m)),'1');
 });
 await test('C02 content requires active current group, no global unauthenticated feed',()=>assert.equal(select(X,"scope_kind='content'"),'0'));
 await test('T01 legitimate tombstones retained by context',()=>{for(const [k,s]of [['person_film',N],['group_film',G],['content',gone],['night',G]])assert.equal(select(N,is(k,s,gone)),'1');});
 await test('T02 unrelated night tombstone denied',()=>assert.equal(select(N,is('night',X,gone)),'0'));
 await test('T03 wrong-group existing night denied even if tombstoned',()=>tx(`UPDATE domain_versions SET version=2,tombstone=true WHERE ${is('night',group2,night)}; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; DO $$ BEGIN IF EXISTS(SELECT FROM domain_versions WHERE scope_kind='night' AND scope_id=${lit(group2)}) THEN RAISE EXCEPTION 'LEAK'; END IF; END $$;`));
 await test('T04 raw version DELETE forbidden to operator by durable guard',()=>refuses(`DELETE FROM domain_versions WHERE ${is('content',m)};`,/DOMAIN_VERSION_RETENTION_REQUIRED/));
 await test('T05 real CONTENT_DELETE preserves observable updated version row',()=>{
  const id=uid(801000);const request={protocol_version:1,request_id:uid(801001),intent:'CONTENT_CREATE',target:{movie_id:null,group_id:null,night_id:null},expected_versions:[],parameters:{title:'Synthetic signal deletion'}};
  const created=JSON.parse(sql(as(N,`SELECT execute_app_command(${lit(JSON.stringify(request))});`)));assert.equal(created.outcome,'SUCCESS');
  const movie=created.result.movie_id;assert.equal(select(N,is('content',movie,movie)),'1');
  const del={...request,request_id:id,intent:'CONTENT_DELETE',target:{movie_id:movie,group_id:null,night_id:null},expected_versions:[{scope_kind:'content',scope_id:movie,entity_id:movie,version:'1'}],parameters:{}};
  const removed=JSON.parse(sql(as(N,`SELECT execute_app_command(${lit(JSON.stringify(del))});`)));assert.equal(removed.outcome,'SUCCESS');assert.equal(removed.affected_versions[0].version,'2');
  assert.equal(sql(as(N,`SELECT version::text||':'||tombstone::text FROM domain_versions WHERE ${is('content',movie,movie)};`)),'2:true');
  assert.equal(sql(`SELECT count(*) FROM movies WHERE id=${lit(movie)};`),'0');
 });
 for(const [name,s]of [['INSERT',`INSERT INTO domain_versions VALUES('content',${lit(orphan)},${lit(orphan)},1,false)`],['UPDATE','UPDATE domain_versions SET version=version+1'],['DELETE','DELETE FROM domain_versions'],['TRUNCATE','TRUNCATE domain_versions']])await test('W '+name+' denied',()=>refuses(as(N,s+';')));
 await test('W05 no column-write/sequence/schema bypass',()=>{
  assert.equal(sql("SELECT has_any_column_privilege('authenticated','domain_versions','INSERT,UPDATE,REFERENCES');"),'f');
  assert.equal(sql("SELECT has_schema_privilege('authenticated','public','CREATE');"),'f');
  assert.equal(sql("SELECT count(*) FROM pg_class WHERE relkind='S' AND relnamespace='public'::regnamespace AND (has_sequence_privilege('authenticated',oid,'USAGE,UPDATE') OR has_sequence_privilege('anon',oid,'USAGE,UPDATE'));"),'0');
 });
 await test('W06 internal helper denied',()=>refuses(as(N,`SELECT domain_bump('content',${lit(m)},${lit(m)});`)));
 await test('F04 legacy and Match DML stay fenced',()=>{for(const s of ['UPDATE movies SET title=title','DELETE FROM movie_nights','DELETE FROM vetoes','DELETE FROM swipes','UPDATE swipe_sessions SET status=status'])refuses(as(N,s+';'));});
 await test('F05 actual fence rerun preserves authorized SELECT only',()=>{sql('SELECT runtime_4a4_enter_maintenance(); SELECT runtime_4a4_apply_fence();');assert(audit().legacy_clear);assert.equal(select(N),'0');});
 await test('F06 legacy mode with retained bootstrap EXECUTE still exposes no rows',()=>{
  tx(`UPDATE app_protocol_state SET mode='legacy'; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=${lit(N)}; DO $$ BEGIN IF EXISTS(SELECT FROM domain_versions) THEN RAISE EXCEPTION 'LEAK'; END IF; END $$;`);
 });
 await test('P04 installation rerun changes no target grants',()=>{const a=acl(),p=publication();sql(signal);assert.equal(acl(),a);assert.equal(publication(),p);assert(audit().manifest_ok&&audit().legacy_clear);});
 const incompatible=async(name,setup,re)=>test(name,()=>{
  // Candidate has its own transaction. A failed preflight must preserve the
  // altered fixture exactly; restore via transaction rollback in a single psql.
  const withoutBoundary=signal.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
  refuses('BEGIN; '+setup+' '+withoutBoundary+' ROLLBACK;',re);
 });
 await incompatible('P05 missing publication fails closed','DROP PUBLICATION supabase_realtime;',/INVALIDATION_PUBLICATION_INCOMPATIBLE/);
 await incompatible('P06 ALL TABLES fails closed','DROP PUBLICATION supabase_realtime; CREATE PUBLICATION supabase_realtime FOR ALL TABLES;',/INVALIDATION_PUBLICATION_INCOMPATIBLE/);
 await incompatible('P07 non-update publication fails closed',"ALTER PUBLICATION supabase_realtime SET (publish='insert');",/INVALIDATION_PUBLICATION_INCOMPATIBLE/);
 await incompatible('P08 private publication member fails closed','ALTER PUBLICATION supabase_realtime ADD TABLE domain_command_receipts;',/INVALIDATION_PUBLICATION_DRIFT/);
 await incompatible('P09 schema-wide publication fails closed','DROP PUBLICATION supabase_realtime; CREATE PUBLICATION supabase_realtime FOR TABLES IN SCHEMA public;',/INVALIDATION_PUBLICATION_INCOMPATIBLE/);
 await incompatible('P10 version publication row filter fails closed',"ALTER PUBLICATION supabase_realtime DROP TABLE domain_versions; ALTER PUBLICATION supabase_realtime ADD TABLE domain_versions WHERE (scope_kind='content');",/INVALIDATION_PUBLICATION_DRIFT/);
 await incompatible('S02 extra signal field fails closed','ALTER TABLE domain_versions ADD COLUMN secret text;',/INVALIDATION_SIGNAL_SCHEMA_DRIFT/);
 await incompatible('S03 permissive competing policy fails closed','CREATE POLICY leaked ON domain_versions FOR SELECT USING(true);',/INVALIDATION_SIGNAL_SCHEMA_DRIFT/);
 await incompatible('S04 missing durable delete guard fails closed','ALTER TABLE domain_versions DISABLE TRIGGER domain_version_foundation_guard;',/INVALIDATION_SIGNAL_SCHEMA_DRIFT/);
 await incompatible('S05 replica identity FULL refused','ALTER TABLE domain_versions REPLICA IDENTITY FULL;',/INVALIDATION_SIGNAL_SCHEMA_DRIFT/);
 await incompatible('S06 PUBLIC SELECT refused','GRANT SELECT ON domain_versions TO PUBLIC;',/INVALIDATION_PUBLIC_OR_ANON_PRIVILEGE/);
 await incompatible('S07 anon column SELECT refused','GRANT SELECT(scope_id) ON domain_versions TO anon;',/INVALIDATION_PUBLIC_OR_ANON_PRIVILEGE/);
 await incompatible('S08 inherited write authority refused','CREATE ROLE realtime_unsafe_writer; GRANT UPDATE ON domain_versions TO realtime_unsafe_writer; GRANT realtime_unsafe_writer TO authenticated;',/INVALIDATION_UNSAFE_ROLE_OR_WRITE_PRIVILEGE/);
 await test('S09 all five fields are invalidation metadata only',()=>assert.equal(sql("SELECT string_agg(attname,',' ORDER BY attnum) FROM pg_attribute WHERE attrelid='domain_versions'::regclass AND attnum>0 AND NOT attisdropped;"),'scope_kind,scope_id,entity_id,version,tombstone'));
 console.log(`Realtime security PostgreSQL: ${checks}/${checks} PASS. No hosted Realtime delivery or live Supabase tested.`);
})().catch(x=>{console.error(x.stack);process.exitCode=1;}).finally(async()=>{if(e)await e.db.close();});
