#!/usr/bin/env node
// F01–F36: isolated synthetic databases, no config, imports, HTTP or live data.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {fixture,read,uid,N,V,X,G}=require('./person-group-command-test-support.cjs');
const migration=read('database/supabase-migration-person-group-snapshot.sql');
const tables=['auth.users','app_members','movies','movie_nights','votes','vetoes','swipe_sessions','swipes',
 'groups','group_memberships','personal_list_entries','group_movie_states','movie_night_participants','movie_night_intentions',
 'domain_versions','domain_command_receipts','app_protocol_state'];
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function preserved(e){const data={};for(const t of tables)data[t]=await e.q(`SELECT to_jsonb(t) v FROM ${t} t ORDER BY to_jsonb(t)::text`);return digest(data);}
async function legacyDefinitions(e){return e.q(`SELECT p.oid,p.proacl,pg_get_functiondef(p.oid) definition FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`);}
const snap=async(e,person=N,group=G,version=1)=>{
 await e.q("SELECT set_config('request.jwt.claim.sub',$1,false)",[person||'']);
 return (await e.q('SELECT public.get_person_group_snapshot($1,$2) s',[group,version]))[0].s;
};
const ok=s=>{assert.equal(s.outcome,'OK',JSON.stringify(s));assert.equal(s.coverage.complete,true);return s;};
const error=(s,c)=>assert.deepEqual(s,{contract_version:1,outcome:'ERROR',error:{code:c}});
const personal=(s,m,p=N)=>s.personal.find(x=>x.person_id===p).states.find(x=>x.movie_id===m);
const group=(s,m)=>s.group.states.find(x=>x.movie_id===m);
const ver=(s,k,p,m)=>s.versions.entries.find(x=>x.scope_kind===k&&x.scope_id===p&&x.entity_id===m)?.version??s.versions.defaults[k];
const create=async(e,i=1)=>{const m=uid(60000+i);await e.q('INSERT INTO movies(id,title) VALUES($1,$2)',[m,'Snapshot synthetic '+i]);return m;};
async function cmd(e,p,k,m,g=null,parameters={},expected){
 if(expected===undefined)expected=g===null?await e.rev('person_film',p,m):await e.rev('group_film',g,m);
 const r=await e.call(p,k,m,g,expected,parameters);assert.equal(r.outcome,'SUCCESS',JSON.stringify(r));return r;
}
async function list(e,m,both=false){await cmd(e,N,'ADD_PERSONAL_LIST',m);if(both)await cmd(e,V,'ADD_PERSONAL_LIST',m);}
async function schedule(e,m,extra={}){return (await cmd(e,N,'SCHEDULE_NIGHT',m,G,{date:'2099-01-01',time:'21:30',...extra},null)).night_id;}
async function complete(e,m,n,participants=[N,V]){return cmd(e,N,'COMPLETE_NIGHT',m,G,{night_id:n,participants},await e.rev('night',G,n));}
async function clock(e,instant){
 const def=e.snapshotOriginalFn??(await e.q("SELECT pg_get_functiondef('public.get_person_group_snapshot(uuid,integer)'::regprocedure) d"))[0].d;
 e.snapshotOriginalFn=def;
 assert.equal(def.split('statement_timestamp()').length,2);
 await e.exec(def.replace('statement_timestamp()',()=>`'${instant}'::timestamptz`));
}
function completeness(s){
 const c=s.coverage.counts;
 assert.equal(c.catalog,s.catalog.length);assert.equal(c.people,s.people.length);assert.equal(c.personal_views,s.personal.length);
 assert.equal(c.personal_states,s.personal.reduce((n,p)=>n+p.states.length,0));assert.equal(c.personal_states,c.personal_views*c.catalog);
 assert.equal(c.group_states,c.catalog);assert.equal(s.group.states.length,c.catalog);
 for(const [k,a] of Object.entries({group_judgments:s.group.judgments,nights:s.nights,participants:s.participants,exposure:s.exposure,
  vetoes:s.vetoes,version_entries:s.versions.entries,night_tokens_unavailable:s.versions.unavailable_night_ids}))assert.equal(c[k],a.length);
 const ids=a=>a.map(x=>x.movie_id);
 assert.deepEqual(s.group.collections.list_movie_ids,ids(s.group.states.filter(x=>x.list_visible)));
 assert.deepEqual(s.group.collections.rewatch_movie_ids,ids(s.group.states.filter(x=>x.rewatch_visible)));
 assert.deepEqual(s.group.collections.together_movie_ids,ids(s.group.states.filter(x=>x.completed_night_ids.length)));
 assert.deepEqual(s.group.collections.scheduled_night_ids,s.nights.filter(x=>['proposed','confirmed'].includes(x.status)).map(x=>x.night_id));
 for(const p of s.personal){assert.deepEqual(p.collections.list_movie_ids,ids(p.states.filter(x=>x.list.active)));
  assert.deepEqual(p.collections.seen_movie_ids,ids(p.states.filter(x=>x.seen)));assert.deepEqual(ids(p.states),ids(s.catalog));}
 for(const a of [s.catalog,s.group.states,...s.personal.map(x=>x.states)])assert.equal(new Set(ids(a)).size,a.length);
}
let count=0;
async function test(id,name,fn){const e=await fixture();try{
 const before=await preserved(e),defs=await legacyDefinitions(e);await e.exec(migration);
 e.installBefore=before;e.legacyDefs=defs;
 await fn(e);count++;console.log('PASS '+id+' '+name);
}finally{await e.db.close();}}
(async()=>{
 await test('F01','migration preservation; STABLE, definer, empty search_path and denied ACL',async e=>{
  assert.equal(await preserved(e),e.installBefore);
  const after=await legacyDefinitions(e);assert.deepEqual(after.filter(x=>e.legacyDefs.some(d=>d.oid===x.oid)),e.legacyDefs);
  for(const f of ['public.get_person_group_snapshot(uuid,integer)','public.snapshot_v1_night_instant(date,text)']){
   const a=(await e.q('SELECT provolatile,prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure',[f]))[0];assert.equal(a.provolatile,'s');
   assert(a.proconfig.includes('search_path=""'));assert.equal(a.prosecdef,f.includes('get_person'));
   for(const role of ['anon','authenticated'])assert.equal((await e.q("SELECT has_function_privilege($1,$2,'EXECUTE') v",[role,f]))[0].v,false);
  }
  await assert.rejects(e.as(N,'SELECT get_person_group_snapshot($1,1)',[G]),/permission denied/);
 });
 await test('F02','unauthenticated/nonmember failure envelopes',async e=>{error(await snap(e,null),'UNAUTHENTICATED');error(await snap(e,X),'FORBIDDEN');});
 await test('F03','contract and null group validation',async e=>{error(await snap(e,N,G,2),'UNSUPPORTED_CONTRACT');error(await snap(e,N,G,null),'UNSUPPORTED_CONTRACT');error(await snap(e,N,null),'INVALID_GROUP');});
 await test('F04','forbidden group existence/lifecycle/membership without leakage',async e=>{
  error(await snap(e,N,uid(9999)),'FORBIDDEN');await e.q("UPDATE groups SET status='archived' WHERE id=$1",[G]);error(await snap(e),'FORBIDDEN');
  await e.q("UPDATE groups SET status='active' WHERE id=$1",[G]);await e.q('UPDATE group_memberships SET active=false WHERE group_id=$1 AND person_id=$2',[G,N]);error(await snap(e),'FORBIDDEN');
 });
 await test('F05','authorized but unsupported group',async e=>{const g=uid(3002);await e.q('INSERT INTO groups(id) VALUES($1)',[g]);await e.q('INSERT INTO group_memberships VALUES($1,$2,true)',[g,N]);error(await snap(e,N,g),'UNSUPPORTED_GROUP');});
 await test('F06','missing backfill/config fails closed',async e=>{
  await e.exec('DELETE FROM app_protocol_state');error(await snap(e),'FOUNDATION_NOT_READY');await e.q('INSERT INTO app_protocol_state(current_group_id) VALUES($1)',[G]);
  await e.q('UPDATE movie_nights SET group_id=NULL WHERE id=$1',[uid(2050)]);error(await snap(e),'FOUNDATION_NOT_READY');
 });
 await test('F07','relationless catalog retained and ordered',async e=>{const s=ok(await snap(e)),m=uid(95);assert(s.catalog.some(x=>x.movie_id===m));assert(!group(s,m).effective_candidacy);assert(!personal(s,m).list.active);assert.equal(personal(s,m).seen,false);
  assert.deepEqual(s.catalog.map(x=>x.movie_id),s.catalog.map(x=>x.movie_id).sort());completeness(s);
 });
 await test('F08','P×C SELF/OTHER authorization and generation privacy',async e=>{const m=await create(e);await list(e,m,true);const n=ok(await snap(e)),v=ok(await snap(e,V));assert.equal(personal(n,m).list.generation,'1');assert.equal(personal(n,m,V).list.generation,null);assert.equal(personal(v,m).list.generation,null);assert.equal(personal(v,m,V).list.generation,'1');completeness(n);});
 await test('F09','absent, generation zero and terminated heads',async e=>{const m=await create(e);assert.equal(personal(ok(await snap(e)),m).list.generation,null);
  await e.q('INSERT INTO personal_list_entries(person_id,movie_id) VALUES($1,$2)',[N,m]);assert.equal(personal(ok(await snap(e)),m).list.generation,'0');await list(e,m);await cmd(e,N,'REMOVE_PERSONAL_LIST',m);
  assert.deepEqual(personal(ok(await snap(e)),m).list,{active:false,generation:'1'});
 });
 await test('F10','historical participant remains visible but not personally readable',async e=>{
  await e.q('UPDATE group_memberships SET active=false WHERE group_id=$1 AND person_id=$2',[G,V]);const s=ok(await snap(e));assert.equal(s.people.find(p=>p.person_id===V).personal_readable,false);
  assert(!s.personal.some(p=>p.person_id===V));assert(s.exposure.some(x=>x.person_id===V&&x.sources.includes('SELECTED_GROUP_TOGETHER')));
 });
 await test('F11','list commands reflected without manufacturing seen/judgment',async e=>{const m=await create(e);await list(e,m);let s=ok(await snap(e));assert(personal(s,m).list.active);assert.equal(personal(s,m).seen,false);assert.deepEqual(personal(s,m).judgment,{rating:null,preference:null,review:null});await cmd(e,N,'REMOVE_PERSONAL_LIST',m);assert(!personal(ok(await snap(e)),m).list.active);});
 await test('F12','convergence exactly equals authoritative helper',async e=>{const m=await create(e);await list(e,m);assert(!group(ok(await snap(e)),m).effective_candidacy);await cmd(e,V,'ADD_PERSONAL_LIST',m);
  const s=ok(await snap(e));for(const x of s.group.states)assert.equal(x.effective_candidacy,(await e.q('SELECT domain_candidate($1,$2) c',[G,x.movie_id]))[0].c);
 });
 await test('F13','withdrawal suppresses C; reader never recreates it',async e=>{const m=await create(e);await list(e,m,true);await cmd(e,N,'WITHDRAW_GROUP_CANDIDACY',m,G);const before=await preserved(e);
  for(let i=0;i<3;i++){const s=ok(await snap(e));assert(!group(s,m).effective_candidacy);assert(personal(s,m).list.active);assert(personal(s,m,V).list.active);}assert.equal(await preserved(e),before);
 });
 await test('F14','new generation reforms convergence independently from old suppression',async e=>{const m=await create(e);await list(e,m,true);await cmd(e,N,'WITHDRAW_GROUP_CANDIDACY',m,G);await cmd(e,N,'REMOVE_PERSONAL_LIST',m);await cmd(e,N,'ADD_PERSONAL_LIST',m);
  const s=ok(await snap(e));assert(group(s,m).effective_candidacy);assert.equal(personal(s,m).list.generation,'2');
 });
 await test('F15','explicit proposal independent of personal state',async e=>{const m=await create(e);await cmd(e,N,'PROPOSE_TO_GROUP',m,G);const s=ok(await snap(e));assert(group(s,m).list_visible);assert(!personal(s,m).seen);assert(!personal(s,m).list.active);assert.equal(personal(s,m).judgment.rating,null);});
 await test('F16','schedule hides candidacy, keeps intention and exposes night token',async e=>{const m=await create(e);await list(e,m,true);const n=await schedule(e,m);const s=ok(await snap(e));assert(group(s,m).effective_candidacy);assert(!group(s,m).list_visible);assert.deepEqual(group(s,m).active_night_ids,[n]);assert.equal(ver(s,'night',G,n),'1');assert(personal(s,m).list.active);});
 await test('F17','cancel returns supported candidate; direct scheduling invents none',async e=>{const m=await create(e);await cmd(e,N,'PROPOSE_TO_GROUP',m,G);let n=await schedule(e,m);await cmd(e,N,'CANCEL_NIGHT',m,G,{night_id:n},1);assert(group(ok(await snap(e)),m).list_visible);
  const m2=await create(e,2);n=await schedule(e,m2);await cmd(e,N,'CANCEL_NIGHT',m2,G,{night_id:n},1);assert(!group(ok(await snap(e)),m2).effective_candidacy);
 });
 await test('F18','edit invalidates captures and reader exposes no references',async e=>{const m=await create(e);await list(e,m);const n=await schedule(e,m);await cmd(e,N,'EDIT_NIGHT',m,G,{night_id:n,time:'22:00'},1);
  const refs=await e.q('SELECT * FROM movie_night_intentions WHERE night_id=$1',[n]);assert.equal(refs.length,1);assert(refs[0].invalidated_at);assert.equal(refs[0].generation,1);
  const s=ok(await snap(e));assert(!JSON.stringify(s).includes('invalidated_at'));await complete(e,m,n);assert(personal(ok(await snap(e)),m).list.active);
 });
 await test('F19','completed Together, actual participants, precise satisfaction and consumption',async e=>{const m=await create(e);await list(e,m,true);await cmd(e,N,'PROPOSE_TO_GROUP',m,G);const n=await schedule(e,m,{select_candidate:true,expected_candidate_revision:2});await complete(e,m,n,[N]);
  const s=ok(await snap(e));assert.deepEqual(s.participants.filter(p=>p.night_id===n),[{night_id:n,person_id:N}]);assert(!personal(s,m).list.active);assert(personal(s,m,V).list.active);assert.equal(personal(s,m).seen,false);assert(s.exposure.some(x=>x.movie_id===m&&x.person_id===N));assert(!s.exposure.some(x=>x.movie_id===m&&x.person_id===V));
  assert.equal((await e.q('SELECT end_reason FROM personal_list_entries WHERE person_id=$1 AND movie_id=$2',[N,m]))[0].end_reason,'satisfied');
  assert.equal((await e.q('SELECT support_state FROM group_movie_states WHERE group_id=$1 AND movie_id=$2',[G,m]))[0].support_state,'consumed');completeness(s);
 });
 await test('F20','captured A cannot satisfy current B',async e=>{const m=await create(e);await list(e,m);const n=await schedule(e,m);await cmd(e,N,'REMOVE_PERSONAL_LIST',m);await cmd(e,N,'ADD_PERSONAL_LIST',m);await complete(e,m,n);
  const s=ok(await snap(e));assert.deepEqual(personal(s,m).list,{active:true,generation:'2'});assert.equal((await e.q('SELECT generation FROM movie_night_intentions WHERE night_id=$1',[n]))[0].generation,1);
 });
 await test('F21','complete-now/retrospective preserve; precise new personal viewing satisfies',async e=>{const m=await create(e);await list(e,m);await cmd(e,N,'COMPLETE_NOW',m,G,{participants:[N,V]},null);assert(personal(ok(await snap(e)),m).list.active);assert.equal((await e.q('SELECT count(*)::int n FROM movie_night_intentions'))[0].n,0);await cmd(e,N,'RETROSPECTIVE_SEEN',m);assert(personal(ok(await snap(e)),m).list.active);
  await cmd(e,N,'NEW_PERSONAL_VIEWING',m,null,{generation:1});assert(!personal(ok(await snap(e)),m).list.active);
  await cmd(e,N,'REMOVE_PERSONAL_SEEN',m);const s=ok(await snap(e));assert(!personal(s,m).list.active);assert.equal(personal(s,m).seen,false);assert.equal(group(s,m).completed_night_ids.length,1);
 });
 await test('F22','judgments preserve rating zero, false preference, review and independence',async e=>{const m=await create(e);await cmd(e,N,'PERSONAL_PREFERENCE',m,null,{value:false});assert.equal(personal(ok(await snap(e)),m).judgment.preference,false);
  await cmd(e,N,'PERSONAL_RATING',m,null,{value:0});await cmd(e,N,'PERSONAL_REVIEW',m,null,{value:'Synthetic review'});
  await cmd(e,N,'COMPLETE_NOW',m,G,{participants:[N,V]},null);await cmd(e,N,'TOGETHER_RATING',m,G,{value:0});let s=ok(await snap(e));assert.equal(personal(s,m).judgment.rating,0);assert.equal(personal(s,m).judgment.preference,null);assert.equal(personal(s,m).seen,false);assert(!group(s,m).effective_candidacy);assert.equal(s.group.judgments.find(x=>x.movie_id===m).rating,0);
  await cmd(e,N,'PERSONAL_RATING',m,null,{value:null});s=ok(await snap(e));assert.equal(personal(s,m).judgment.review,'Synthetic review');assert.equal(personal(s,m).judgment.preference,null);
 });
 await test('F23','Rewatch membership, visibility and eligibility remain distinct',async e=>{const m=await create(e);await cmd(e,N,'RETROSPECTIVE_SEEN',m);await cmd(e,V,'RETROSPECTIVE_SEEN',m);let s=ok(await snap(e));assert(group(s,m).rewatch_visible);assert(!group(s,m).eligibility.match_base);
  await cmd(e,N,'PROPOSE_TO_GROUP',m,G);s=ok(await snap(e));assert(group(s,m).rewatch_visible&&group(s,m).list_visible);const n=await schedule(e,m);s=ok(await snap(e));assert(group(s,m).rewatch_semantic);assert(!group(s,m).rewatch_visible);await complete(e,m,n);s=ok(await snap(e));assert(!group(s,m).rewatch_semantic);assert(!group(s,m).eligibility.ruota_base);
 });
 await test('F24','single clock, Rome calendar, ISO year/week and veto coverage',async e=>{await clock(e,'2027-01-03T22:59:59Z');let s=ok(await snap(e));assert.equal(s.temporal.local_date,'2027-01-03');assert.equal(s.temporal.week_key,'2026-W53');
  await e.q("INSERT INTO vetoes(person,movie_id,week_key) VALUES('N',$1,'2027-W01')",[uid(1)]);assert.equal(ok(await snap(e)).vetoes.length,0);
  await clock(e,'2027-01-03T23:00:00Z');s=ok(await snap(e));assert.equal(s.temporal.local_date,'2027-01-04');assert.equal(s.temporal.week_key,'2027-W01');assert.equal(s.vetoes.length,1);
 });
 await test('F25','unique/legacy seconds, gap/fold/invalid time and deadline',async e=>{
  for(const [d,t] of [['2027-10-31','02:30'],['2027-03-28','02:30'],['2027-01-01','24:00'],['2027-01-01','bad'],['infinity','21:30']])assert.equal((await e.q('SELECT snapshot_v1_night_instant($1,$2) t',[d,t]))[0].t,null);
  assert.equal((await e.q("SELECT snapshot_v1_night_instant('2027-01-01','21:30:00')=snapshot_v1_night_instant('2027-01-01','21:30') b"))[0].b,true);
  await clock(e,'2027-01-01T19:00:00Z');const m=await create(e);await e.q("INSERT INTO movie_nights(movie_id,group_id,date,time) VALUES($1,$2,'2027-01-01','21:30')",[m,G]);const s=ok(await snap(e));assert.equal(s.temporal.next_temporal_invalidation_at,'2027-01-01T20:30:00.000000Z');
 });
 await test('F26','legacy night readable without CAS; deprecated revision never read',async e=>{await e.exec('UPDATE movie_nights SET domain_revision=999');const s=ok(await snap(e));assert.equal(s.versions.unavailable_night_ids.length,4);assert(!JSON.stringify(s).includes('domain_revision'));assert.equal(ver(s,'night',G,uid(2032)),null);});
 await test('F27','baseline defaults and affected_versions authoritative mapping',async e=>{const m=await create(e);let s=ok(await snap(e));assert.equal(ver(s,'person_film',N,m),'0');assert.equal(ver(s,'content',m,m),'0');const r=await cmd(e,N,'ADD_PERSONAL_LIST',m);s=ok(await snap(e));for(const v of r.affected_versions)assert.equal(ver(s,v.scope_kind,v.scope_id,v.entity_id),String(v.version));});
 await test('F28','authorized retained tombstones, forbidden scopes excluded',async e=>{const missing=uid(999991);await e.q("INSERT INTO domain_versions VALUES('person_film',$1,$2,7,true),('group_film',$3,$2,8,true),('content',$2,$2,9,true),('night',$3,$2,10,true),('person_film',$4,$2,11,true),('group_film',$5,$2,12,true)",[N,missing,G,X,uid(3002)]);
  const s=ok(await snap(e));assert.equal(s.versions.entries.length,4);assert(s.versions.entries.every(v=>v.tombstone));assert(!s.versions.entries.some(v=>[X,uid(3002)].includes(v.scope_id)));
 });
 await test('F29','deterministic semantic signature, metadata and veto changes without vector bump',async e=>{const a=ok(await snap(e)),b=ok(await snap(e));assert.equal(a.payload_signature.value,b.payload_signature.value);
  const encoded=JSON.stringify(a);const d=(await e.q("SELECT encode(sha256(convert_to(($1::jsonb-'payload_signature' #- '{temporal,as_of}' #- '{temporal,next_temporal_invalidation_at}')::text,'UTF8')),'hex') h",[encoded]))[0].h;assert.equal(a.payload_signature.value,d);
  await e.q("UPDATE movies SET overview='Changed synthetic metadata' WHERE id=$1",[uid(1)]);const c=ok(await snap(e));assert.notEqual(c.payload_signature.value,a.payload_signature.value);assert.deepEqual(c.versions,a.versions);
  await e.q("INSERT INTO vetoes(person,movie_id,week_key) VALUES('N',$1,$2)",[uid(1),c.temporal.week_key]);const v=ok(await snap(e));assert.notEqual(v.payload_signature.value,c.payload_signature.value);assert.deepEqual(v.versions,c.versions);
 });
 await test('F30','empty catalog and collections remain complete arrays',async e=>{
  // Separate empty synthetic fixture via TRUNCATE is test setup, never RPC behavior.
  await e.exec('TRUNCATE movies,movie_nights,group_movie_states,personal_list_entries,movie_night_participants,movie_night_intentions,domain_command_receipts,vetoes,votes,swipes CASCADE');const s=ok(await snap(e));assert.deepEqual(s.catalog,[]);assert.deepEqual(s.group.states,[]);assert.equal(s.personal.length,2);completeness(s);
 });
 await test('F31','malformed source cannot silently disappear',async e=>{const week=ok(await snap(e)).temporal.week_key;await e.q('INSERT INTO vetoes(person,movie_id,week_key) VALUES(NULL,$1,$2)',[uid(1),week]);error(await snap(e),'SNAPSHOT_DATA_INVALID');await e.q('DELETE FROM vetoes WHERE person IS NULL');
  await e.q('INSERT INTO movie_night_participants(night_id,person_id) VALUES($1,$2)',[uid(2050),N]);error(await snap(e),'SNAPSHOT_DATA_INVALID');
 });
 await test('F32','UTF-8 final envelope exact 16 MiB boundary without partial payload',async e=>{const m=await create(e);await e.q("UPDATE movies SET overview='' WHERE id=$1",[m]);
  const size=async()=>Number((await e.q('SELECT octet_length(convert_to(get_person_group_snapshot($1,1)::text,\'UTF8\')) n',[G]))[0].n);
  const base=await size(),pad=16777216-base;
  // Include multibyte characters, then pad to the exact encoded byte budget.
  await e.q("UPDATE movies SET overview='è'||repeat('x',$1) WHERE id=$2",[pad-3,m]);assert.equal(await size(),16777215);ok(await snap(e));
  await e.q("UPDATE movies SET overview=overview||'x' WHERE id=$1",[m]);assert.equal(await size(),16777216);ok(await snap(e));
  await e.q("UPDATE movies SET overview=overview||'x' WHERE id=$1",[m]);error(await snap(e),'SNAPSHOT_TOO_LARGE');
 });
 await test('F33','READ ONLY success/failure preserves all seventeen fixture tables',async e=>{let before=await preserved(e);await e.exec('BEGIN READ ONLY');try{ok(await snap(e));error(await snap(e,null),'UNAUTHENTICATED');error(await snap(e,N,G,2),'UNSUPPORTED_CONTRACT');}finally{await e.exec('ROLLBACK');}assert.equal(await preserved(e),before);
  await e.q('INSERT INTO movie_night_participants(night_id,person_id) VALUES($1,$2)',[uid(2050),N]);before=await preserved(e);
  await e.exec('BEGIN READ ONLY');try{error(await snap(e),'SNAPSHOT_DATA_INVALID');}finally{await e.exec('ROLLBACK');}assert.equal(await preserved(e),before);
 });
 await test('F34','bigint above JS safe integer remains exact Decimal string',async e=>{const m=await create(e);await e.q("INSERT INTO domain_versions VALUES('person_film',$1,$2,9007199254740993,false)",[N,m]);assert.equal(ver(ok(await snap(e)),'person_film',N,m),'9007199254740993');await e.q('UPDATE movies SET tmdb_id=9007199254740993 WHERE id=$1',[m]);assert.equal(ok(await snap(e)).catalog.find(x=>x.movie_id===m).tmdb_id,'9007199254740993');});
 await test('F35','public fields only, canonical ordering and multi-event uniqueness',async e=>{const m=await create(e);await schedule(e,m);await schedule(e,m);const s=ok(await snap(e));completeness(s);
  assert.deepEqual(Object.keys(s).sort(),['contract_version','outcome','caller','selected_group','temporal','coverage','catalog','people','personal','group','nights','participants','exposure','vetoes','versions','payload_signature'].sort());
  const text=JSON.stringify(s);for(const key of ['suppressed_cycle','selected_support_id','selected_convergence_cycle','payload_fingerprint','end_reason','activated_at','invalidated_at','creation_request_id','domain_revision'])assert(!text.includes('"'+key+'"'));
  assert.equal(group(s,m).active_night_ids.length,2);assert.equal(s.group.states.filter(x=>x.movie_id===m).length,1);
 });
 await test('F36','transactional rollback/reapply changes only the two snapshot objects',async e=>{const before=await preserved(e);await e.exec('DROP FUNCTION public.get_person_group_snapshot(uuid,integer); DROP FUNCTION public.snapshot_v1_night_instant(date,text)');
  await e.exec(migration.replace(/^COMMIT;$/m,'ROLLBACK;'));assert.equal((await e.q("SELECT to_regprocedure('public.get_person_group_snapshot(uuid,integer)') f"))[0].f,null);
  await e.exec(migration);ok(await snap(e));assert.equal(await preserved(e),before);
 });
 assert.equal(count,36);console.log('FUNCTIONAL CONTRACT: PASS — 36/36; isolated synthetic fixtures');
})().catch(e=>{console.error('FAIL snapshot contract:',e.stack);process.exitCode=1;});
