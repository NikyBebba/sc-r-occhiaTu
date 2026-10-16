#!/usr/bin/env node
// Phase 1: PostgreSQL/PGlite in memory, synthetic IDs only, no network or live data.
// node scripts/verify-person-group-foundation-db.js --pglite=/external/path/to/pglite
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PGlite } = require(process.argv.find(a => a.startsWith('--pglite='))?.slice(9) || '@electric-sql/pglite');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'database', name), 'utf8');
const uid = i => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
const N = uid(1001), V = uid(1002), X = uid(1003), G = uid(3001), G2 = uid(3002);
const foundation = read('supabase-migration-person-group-foundation.sql');
const backfill = read('supabase-backfill-person-group-foundation.sql');
const newTables = ['groups','group_memberships','domain_command_receipts','personal_list_entries',
  'group_movie_states','movie_night_participants','movie_night_intentions','domain_versions','app_protocol_state'];
const oldTables = ['movies','movie_nights','votes','vetoes','app_members','swipe_sessions','swipes'];
let checks = 0;
let testDatabase;

async function currentDatabase() {
  const db = new PGlite(); await db.waitReady;
  const exec = sql => db.exec(sql);
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  await exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`);
  for (const id of [N,V,X]) await q('INSERT INTO auth.users VALUES($1)', [id]);
  await exec(read('supabase-migration-auth-prepare.sql'));
  await q("INSERT INTO app_members VALUES($1,'N'),($2,'V')", [N,V]);
  const schema = read('supabase-schema.sql');
  await exec([...schema.matchAll(/create table (movies|movie_nights|votes|vetoes) \([\s\S]*?\n\);/gi)].map(m => m[0]).join('\n'));
  await exec('CREATE UNIQUE INDEX movies_tmdb_id_unique ON movies(tmdb_id) WHERE tmdb_id IS NOT NULL');
  for (const file of ['step4','step5b','step7']) await exec(read('supabase-migration-' + file + '.sql'));
  await exec([...read('supabase-migration-step6.sql').matchAll(/CREATE TABLE IF NOT EXISTS public\.(swipe_sessions|swipes) \([\s\S]*?\n\);/g)].map(m=>m[0]).join('\n'));
  for (const t of ['movies','movie_nights']) await exec(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ${t} TO authenticated;
    CREATE POLICY members ON ${t} FOR ALL TO authenticated USING(public.app_person() IS NOT NULL) WITH CHECK(public.app_person() IS NOT NULL);`);
  // Exact synthetic v54 prerequisite, not an inventory of production data.
  for (let i=1; i<=94; i++) await q(`INSERT INTO movies(id,title,status,watched_by,review_by,seen_rating_n,seen_rating_together)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [uid(i),'Foundation synthetic '+i,i>91?'watched':'watchlist',
      i>91?'both':i>79?'N':null,i>91?'both':null,i>=80&&i<=92?0:null,i>91?8.3:null]);
  for (let i=1; i<=34; i++) await q('INSERT INTO movie_nights(id,movie_id,status,completed_at) VALUES($1,$2,$3,$4)',
    [uid(2000+i),uid(i<=31?i:i+60),i<=31?'cancelled':'completed',i<=31?null:'2026-10-08T20:00:00Z']);
  for (const file of ['individual-rewatch','step38-decimal-ratings','completed-night-snack']) await exec(read('supabase-migration-'+file+'.sql'));
  await exec(`DROP POLICY members ON movies;
    CREATE POLICY members_read ON movies FOR SELECT TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);
    CREATE POLICY members_insert ON movies FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_person()) IS NOT NULL);
    CREATE POLICY members_update ON movies FOR UPDATE TO authenticated USING ((SELECT public.app_person()) IS NOT NULL) WITH CHECK ((SELECT public.app_person()) IS NOT NULL);
    CREATE POLICY members_delete ON movies FOR DELETE TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);`);
  // The historical cleanup is represented ONLY inside this synthetic setup.
  await q("DELETE FROM movie_nights WHERE status='cancelled'");
  await exec(read('supabase-migration-personal-preference.sql'));
  await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[N]);
  await q("INSERT INTO movies(id,title) VALUES($1,'Synthetic relationless catalog')",[uid(95)]);
  // A cancelled created AFTER T0 is data to preserve, not an instruction to clean.
  await q("INSERT INTO movie_nights(id,movie_id,status) VALUES($1,$2,'cancelled')",[uid(2050),uid(5)]);
  const as = async (person, sql, params=[]) => {
    await exec('SET ROLE authenticated');
    try { await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[person]); return await q(sql,params); }
    finally { await exec('RESET ROLE'); }
  };
  await as(N,"UPDATE movies SET personal_liked_n=false,review_text_n='Keep N' WHERE id=$1",[uid(1)]);
  await as(V,"UPDATE movies SET seen_v=true,seen_rating_v=9.1,review_text_v='Keep V' WHERE id=$1",[uid(2)]);
  await q("INSERT INTO votes(movie_id,person,liked) VALUES($1,'N',false)",[uid(1)]);
  await q("INSERT INTO vetoes(movie_id,person,week_key) VALUES($1,'V','2026-W41')",[uid(2)]);
  await q("INSERT INTO swipe_sessions(id,created_by,seed,deck) VALUES($1,'N',17,ARRAY[$2]::uuid[])",[uid(4001),uid(1)]);
  await q("INSERT INTO swipes(session_id,movie_id,person,liked) VALUES($1,$2,'N',true)",[uid(4001),uid(1)]);
  return { db,exec,q,as };
}

(async () => {
  const {db,exec,q,as} = await currentDatabase();
  testDatabase = db;
  const test = async (name, fn) => { await fn(); checks++; console.log('PASS '+name); };
  const reject = (sql,params=[],pattern=/constraint|IMMUTABLE|REQUIRED|TRANSITION|INITIAL_STATE/) => assert.rejects(q(sql,params),pattern);
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const oldNightColumns = (await q("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='movie_nights' ORDER BY ordinal_position")).map(r=>r.column_name);
  async function preservedData() {
    const data = {};
    for (const t of oldTables) data[t] = await q(`SELECT ${t==='movie_nights'?oldNightColumns.join(','):'*'} FROM ${t} ORDER BY ${t==='app_members'?'user_id':'id'}`);
    return data;
  }
  const legacyBefore=await preservedData(), legacyHash=digest(legacyBefore);
  async function currentContract() {
    return {
      functions: await q(`SELECT p.proname,pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN ('app_person','guard_movie_watch','clear_personal_preference_for_rating','manage_movie_night') ORDER BY p.proname`),
      triggers: await q("SELECT tgname,pg_get_triggerdef(oid) def FROM pg_trigger WHERE tgrelid IN ('movies'::regclass,'movie_nights'::regclass) AND NOT tgisinternal ORDER BY tgname"),
      security: await q("SELECT relname,relrowsecurity,relacl FROM pg_class WHERE oid IN ('movies'::regclass,'movie_nights'::regclass,'app_members'::regclass) ORDER BY relname"),
      policies: await q("SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN ('movies','movie_nights','app_members') ORDER BY tablename,policyname")
    };
  }
  const contractBefore=await currentContract();
  await test('missing current prerequisites fail before creating foundation',async()=>{
    const empty=new PGlite();await empty.waitReady;
    try {
      await assert.rejects(empty.exec(foundation),/FOUNDATION_PREREQUISITE/);
      await empty.exec('ROLLBACK');
      assert.equal((await empty.query("SELECT to_regclass('public.groups') obj")).rows[0].obj,null);
    } finally {await empty.close();}
  });
  await test('migration transaction can roll back, then apply',async()=>{
    await exec(foundation.replace(/^BEGIN;$/m,'BEGIN;').replace(/^COMMIT;$/m,'ROLLBACK;'));
    assert.equal((await q("SELECT to_regclass('public.groups') obj"))[0].obj,null);
    assert.deepEqual(await preservedData(),legacyBefore);
    await exec(foundation);
  });
  await test('one-shot reapply aborts atomically with no data loss',async()=>{
    await assert.rejects(exec(foundation),/already exists/); await exec('ROLLBACK');
    assert.equal(digest(await preservedData()),legacyHash);
  });
  await test('all new tables empty; old values, counts, guards, RPC, policies/grants unchanged',async()=>{
    for (const t of newTables) assert.equal((await q(`SELECT count(*)::int n FROM ${t}`))[0].n,0);
    assert.deepEqual(await preservedData(),legacyBefore);assert.deepEqual(await currentContract(),contractBefore);
  });
  await test('new RLS surfaces closed to authenticated/anon, including helper execution',async()=>{
    for (const t of newTables) {
      assert.equal((await q('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[t]))[0].relrowsecurity,true);
      for (const role of ['anon','authenticated']) assert.equal((await q("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[role,t]))[0].allowed,false);
      await assert.rejects(as(N,`SELECT * FROM ${t}`),/permission denied/);
    }
    assert.equal((await q("SELECT has_function_privilege('authenticated','public.foundation_valid_cycle(jsonb)','EXECUTE') allowed"))[0].allowed,false);
  });
  await test('new foreign keys restrict deletes; person/caller identities use UUID Auth',async()=>{
    const fks=await q("SELECT confdeltype FROM pg_constraint WHERE contype='f' AND conrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]))",[newTables]);
    assert(fks.length>0);assert(fks.every(f=>f.confdeltype==='r'));
    const identities=await q("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) AND column_name IN ('person_id','caller_id','proposed_by')",[newTables]);
    assert(identities.length>0);assert(identities.every(c=>c.data_type==='uuid'));
  });
  await test('backfill without parameters fails at parameter validation without partial writes',async()=>{
    await assert.rejects(exec(backfill),/VERIFIED_IDS_REQUIRED/);await exec('ROLLBACK');
    assert.equal((await q('SELECT count(*)::int n FROM groups'))[0].n,0);
  });
  const completed = [uid(2032),uid(2033),uid(2034)];
  const settings = {foundation_approved:'verified-preflight',foundation_group_id:G,foundation_n_user_id:N,
    foundation_v_user_id:V,foundation_completed_ids:JSON.stringify(completed)};
  for (const [key,value] of Object.entries(settings)) await q('SELECT set_config($1,$2,false)',['scorochiatu.'+key,value]);
  const backfillBody=backfill.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
  const abortedBackfill = async (setup,pattern,sql=backfillBody) => {
    await exec('BEGIN');
    try { await setup(); await assert.rejects(exec(sql),pattern); }
    finally { await exec('ROLLBACK'); }
    assert.deepEqual(await preservedData(),legacyBefore);
    for(const t of newTables) assert.equal((await q(`SELECT count(*)::int n FROM ${t}`))[0].n,0);
    assert.equal((await q('SELECT count(*)::int n FROM movie_nights WHERE group_id IS NOT NULL'))[0].n,0);
  };
  await test('operator gate fails before lock boundary; valid gate reaches that boundary',async()=>{
    // A test-only sentinel replaces the actual lock statement, inside the same DO.
    // This proves execution order, not multi-backend lock contention.
    const probe=backfillBody.replace(/LOCK TABLE[\s\S]*?IN SHARE ROW EXCLUSIVE MODE;/,
      "RAISE EXCEPTION 'TEST_LOCK_BOUNDARY_REACHED';");
    assert.notEqual(probe,backfillBody);
    await q("SELECT set_config('scorochiatu.foundation_approved','',false)");
    await abortedBackfill(async()=>{},/GATE_REQUIRED/,probe);
    await q("SELECT set_config('scorochiatu.foundation_approved','verified-preflight',false)");
    await abortedBackfill(async()=>{},/TEST_LOCK_BOUNDARY_REACHED/,probe);
  });
  await test('every required foundation table is mandatory; missing table aborts without partial writes',async()=>{
    // domain_versions is not used by the copy itself: omission must still fail.
    await abortedBackfill(()=>exec('DROP TABLE domain_versions'),/MISSING_FOUNDATION: domain_versions/);
    assert.notEqual((await q("SELECT to_regclass('public.domain_versions') obj"))[0].obj,null);
  });
  await test('disabled lifecycle guard is invalid foundation, not a missing or empty foundation',async()=>{
    await abortedBackfill(()=>exec('ALTER TABLE movie_night_intentions DISABLE TRIGGER night_intention_foundation_guard'),/INVALID_FOUNDATION/);
  });
  await test('incompatible legacy candidacy nullability/default/type/missing column aborts',async()=>{
    for(const drift of [
      'ALTER TABLE movies ALTER COLUMN in_shared_list DROP NOT NULL',
      'ALTER TABLE movies ALTER COLUMN in_shared_list SET DEFAULT true',
      'ALTER TABLE movies ALTER COLUMN in_shared_list DROP DEFAULT; ALTER TABLE movies ALTER COLUMN in_shared_list TYPE text USING in_shared_list::text',
      'ALTER TABLE movies DROP COLUMN in_shared_list'
    ]) await abortedBackfill(()=>exec(drift),/LEGACY_SOURCE_CONTRACT/);
  });
  await test('unexpected completed outside attested manifest aborts',async()=>{
    await abortedBackfill(()=>q("INSERT INTO movie_nights(id,movie_id,status,completed_at) VALUES($1,$2,'completed',now())",[uid(2051),uid(6)]),/MANIFEST_MISMATCH/);
  });
  await test('partially populated target aborts independently of backfill replay',async()=>{
    await abortedBackfill(()=>q('INSERT INTO groups(id) VALUES($1)',[G2]),/EXPECTED_EMPTY: groups/);
  });
  await test('missing or extra copied candidacy causes set-mismatch rollback',async()=>{
    for(const extra of [false,true]) await abortedBackfill(()=>exec(`
      CREATE FUNCTION test_candidacy_drift() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        ${extra ? `IF NEW.movie_id='${uid(1)}' THEN
          INSERT INTO group_movie_states(group_id,movie_id,revision,autonomous_support_id,support_origin,support_state,support_recorded_at)
          VALUES(NEW.group_id,'${uid(95)}',1,gen_random_uuid(),'legacy','active',now()); END IF;`
          : `IF NEW.movie_id='${uid(1)}' THEN RETURN NULL; END IF;`}
        RETURN NEW; END $$;
      CREATE TRIGGER test_candidacy_drift BEFORE INSERT ON group_movie_states
        FOR EACH ROW EXECUTE FUNCTION test_candidacy_drift();`),/CANDIDACY_SET_MISMATCH/);
  });
  await test('wrong Auth mapping aborts before writing',async()=>{
    await q("SELECT set_config('scorochiatu.foundation_n_user_id',$1,false)",[X]);
    await assert.rejects(exec(backfill),/MAPPING_MISMATCH/);await exec('ROLLBACK');
    await q("SELECT set_config('scorochiatu.foundation_n_user_id',$1,false)",[N]);
  });
  await test('wrong completed manifest aborts before writing',async()=>{
    await q("SELECT set_config('scorochiatu.foundation_completed_ids',$1,false)",[JSON.stringify([uid(2000),...completed.slice(1)])]);
    await assert.rejects(exec(backfill),/MANIFEST_MISMATCH/);await exec('ROLLBACK');
    await q("SELECT set_config('scorochiatu.foundation_completed_ids',$1,false)",[JSON.stringify(completed)]);
  });
  await test('parameterized backfill preserves legacy and creates only attested structure',async()=>{
    await exec(backfill);
    assert.deepEqual(await preservedData(),legacyBefore);
    assert.equal((await q('SELECT count(*)::int n FROM groups'))[0].n,1);
    assert.equal((await q('SELECT count(*)::int n FROM group_memberships'))[0].n,2);
    assert.equal((await q('SELECT count(*)::int n FROM movie_night_participants'))[0].n,6);
    assert.equal((await q('SELECT count(*)::int n FROM movie_nights WHERE group_id=$1',[G]))[0].n,legacyBefore.movie_nights.length);
    assert.equal((await q('SELECT count(*)::int n FROM group_movie_states'))[0].n,legacyBefore.movies.filter(m=>m.in_shared_list).length);
    assert.deepEqual((await q('SELECT movie_id FROM group_movie_states WHERE group_id=$1 ORDER BY movie_id',[G])).map(r=>r.movie_id),
      legacyBefore.movies.filter(m=>m.in_shared_list).map(m=>m.id).sort());
    assert.equal((await q("SELECT count(*)::int n FROM group_movie_states WHERE support_origin<>'legacy' OR proposed_by IS NOT NULL OR suppressed_cycle IS NOT NULL"))[0].n,0);
    for (const t of ['personal_list_entries','movie_night_intentions','domain_command_receipts','domain_versions']) assert.equal((await q(`SELECT count(*)::int n FROM ${t}`))[0].n,0);
  });
  await test('backfill reapply refused; original backfill survives',async()=>{
    await assert.rejects(exec(backfill),/EXPECTED_EMPTY/);await exec('ROLLBACK');
    assert.equal((await q('SELECT count(*)::int n FROM movie_night_participants'))[0].n,6);
  });
  await test('UUID membership unique, restrictive, and independent of N/V labels',async()=>{
    await reject('INSERT INTO group_memberships VALUES($1,$2,true)',[G,N],/unique/);
    await q('INSERT INTO groups(id) VALUES($1)',[G2]);
    await q('INSERT INTO group_memberships VALUES($1,$2,true)',[G2,X]);
    await reject('DELETE FROM groups WHERE id=$1',[G2],/foreign key/);
    await reject('DELETE FROM auth.users WHERE id=$1',[X],/foreign key/);
  });
  await test('protocol configuration is inert, singleton and cannot become a global counter',async()=>{
    assert.equal((await q('SELECT mode FROM app_protocol_state'))[0].mode,'legacy');
    await reject('INSERT INTO app_protocol_state DEFAULT VALUES',[],/unique/);
    await reject("UPDATE app_protocol_state SET mode='unknown'",[],/check constraint/);
    assert.equal((await q("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='app_protocol_state' AND column_name IN ('revision','version','commit_revision')"))[0].n,0);
  });
  const M=uid(3);
  await test('personal initial state and one row per person-film',async()=>{
    await q('INSERT INTO personal_list_entries(person_id,movie_id) VALUES($1,$2)',[N,M]);
    await reject('INSERT INTO personal_list_entries(person_id,movie_id) VALUES($1,$2)',[N,M],/unique/);
    await reject('INSERT INTO personal_list_entries(person_id,movie_id,generation) VALUES($1,$2,-1)',[V,M]);
    await reject('INSERT INTO personal_list_entries(person_id,movie_id,revision) VALUES($1,$2,-1)',[V,M]);
    await reject('INSERT INTO personal_list_entries(person_id,movie_id,active) VALUES($1,$2,true)',[V,M]);
  });
  const activate = async () => q(`UPDATE personal_list_entries SET active=true,generation=generation+1,revision=revision+1,
    activated_at=now(),ended_at=NULL,end_reason=NULL WHERE person_id=$1 AND movie_id=$2`,[N,M]);
  await test('activation A, no-op, CAS revision and generation constraints',async()=>{
    await activate();
    await q('UPDATE personal_list_entries SET active=active WHERE person_id=$1 AND movie_id=$2',[N,M]);
    assert.equal((await q('SELECT generation::int n FROM personal_list_entries WHERE person_id=$1 AND movie_id=$2',[N,M]))[0].n,1);
    await reject('UPDATE personal_list_entries SET active=false,ended_at=now(),end_reason=\'removed\' WHERE person_id=$1 AND movie_id=$2',[N,M],/REVISION_REQUIRED/);
    await reject('UPDATE personal_list_entries SET generation=2,revision=revision+1 WHERE person_id=$1 AND movie_id=$2',[N,M],/TRANSITION_REQUIRED/);
  });
  const scheduled=uid(2080);
  await test('future scheduled night captures active A, with film consistency and no satisfaction',async()=>{
    await q("INSERT INTO movie_nights(id,movie_id,status,date,group_id) VALUES($1,$2,'proposed','2099-01-01',$3)",[scheduled,uid(92),G]);
    await q('INSERT INTO movie_night_intentions(night_id,person_id,movie_id,generation) VALUES($1,$2,$3,1)',[scheduled,N,uid(92)]).then(()=>assert.fail('wrong head accepted'),e=>assert.match(e.message,/foreign key/));
    await q('INSERT INTO personal_list_entries(person_id,movie_id,active,generation,revision,activated_at) VALUES($1,$2,true,1,1,now())',[N,uid(92)]);
    await q('INSERT INTO movie_night_intentions(night_id,person_id,movie_id,generation) VALUES($1,$2,$3,1)',[scheduled,N,uid(92)]);
    await reject('INSERT INTO movie_night_intentions(night_id,person_id,movie_id,generation) VALUES($1,$2,$3,2)',[scheduled,N,uid(92)],/unique/);
    await reject('INSERT INTO movie_night_intentions(night_id,person_id,movie_id,generation) VALUES($1,$2,$3,1)',[completed[1],N,uid(92)],/foreign key/);
    assert.deepEqual((await q('SELECT active,end_reason FROM personal_list_entries WHERE person_id=$1 AND movie_id=$2',[N,uid(92)]))[0],{active:true,end_reason:null});
  });
  await test('head A can terminate/re-add B without changing captured A; invalidation one-way',async()=>{
    await q("UPDATE personal_list_entries SET active=false,revision=2,ended_at=now(),end_reason='removed' WHERE person_id=$1 AND movie_id=$2",[N,uid(92)]);
    await q('UPDATE personal_list_entries SET active=true,revision=3,generation=2,activated_at=now(),ended_at=NULL,end_reason=NULL WHERE person_id=$1 AND movie_id=$2',[N,uid(92)]);
    const before=(await q('SELECT * FROM movie_night_intentions WHERE night_id=$1',[scheduled]))[0];
    await reject('DELETE FROM movie_night_intentions WHERE night_id=$1',[scheduled],/RETENTION_REQUIRED/);
    for(const assignment of ['generation=2',`night_id='${completed[0]}'`,`person_id='${V}'`,`movie_id='${M}'`,"captured_at=captured_at+interval '1 second'"])
      await reject(`UPDATE movie_night_intentions SET ${assignment} WHERE night_id=$1`,[scheduled],/IMMUTABLE/);
    await reject("UPDATE movie_night_intentions SET invalidated_at=captured_at-interval '1 second' WHERE night_id=$1",[scheduled],/check constraint/);
    await q('UPDATE movie_night_intentions SET invalidated_at=now() WHERE night_id=$1',[scheduled]);
    await reject('UPDATE movie_night_intentions SET invalidated_at=NULL WHERE night_id=$1',[scheduled],/IMMUTABLE/);
    await reject("UPDATE movie_night_intentions SET invalidated_at=invalidated_at+interval '1 second' WHERE night_id=$1",[scheduled],/IMMUTABLE/);
    const after=(await q('SELECT * FROM movie_night_intentions WHERE night_id=$1',[scheduled]))[0];
    assert.notEqual(after.invalidated_at,null);
    assert.deepEqual({...after,invalidated_at:null},before);
    assert.equal(after.generation,1);
  });
  await test('personal lifecycle protects catalog/Auth; precise generation can end satisfied without receipt FK',async()=>{
    await reject('DELETE FROM auth.users WHERE id=$1',[N],/foreign key/);
    await reject('DELETE FROM personal_list_entries WHERE person_id=$1 AND movie_id=$2',[N,uid(92)],/RETENTION_REQUIRED/);
    await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[N]);
    await reject('DELETE FROM movies WHERE id=$1',[M],/foreign key/);
    await q("UPDATE personal_list_entries SET active=false,revision=revision+1,ended_at=now(),end_reason='satisfied' WHERE person_id=$1 AND movie_id=$2",[N,M]);
    assert.deepEqual((await q('SELECT active,generation::int generation,end_reason FROM personal_list_entries WHERE person_id=$1 AND movie_id=$2',[N,M]))[0],{active:false,generation:1,end_reason:'satisfied'});
    assert.equal((await q("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='personal_list_entries' AND column_name='satisfaction_receipt_id'"))[0].n,0);
  });
  const cycle = {version:1,members:[{person_id:N,generation:1},{person_id:V,generation:2}]};
  await test('cycle canonical form accepts ordered UUIDs and rejects malformed/duplicate/unsorted',async()=>{
    assert.equal((await q('SELECT foundation_valid_cycle($1::jsonb) ok',[JSON.stringify(cycle)]))[0].ok,true);
    for(const value of [{},null,{...cycle,version:0},{...cycle,members:[...cycle.members].reverse()},
      {...cycle,members:[cycle.members[0],cycle.members[0]]},{...cycle,members:[{person_id:N,generation:-1},cycle.members[1]]},
      {...cycle,extra:true},{...cycle,version:9223372036854775808n.toString()}]) {
      assert.equal((await q('SELECT foundation_valid_cycle($1::jsonb) ok',[JSON.stringify(value)]))[0].ok,false);
    }
  });
  await test('explicit support requires author, legacy preserves unknown author; suppression stored exactly',async()=>{
    await reject("INSERT INTO group_movie_states(group_id,movie_id,autonomous_support_id,support_origin,support_state,support_recorded_at) VALUES($1,$2,$3,'explicit','active',now())",[G2,M,uid(5001)],/check constraint/);
    await q("INSERT INTO group_movie_states(group_id,movie_id,revision,autonomous_support_id,support_origin,support_state,proposed_by,support_recorded_at,suppressed_cycle,suppression_reason,suppressed_at) VALUES($1,$2,1,$3,'explicit','active',$4,now(),$5,'withdrawn',now())",[G2,M,uid(5001),X,JSON.stringify(cycle)]);
    assert.deepEqual((await q('SELECT suppressed_cycle FROM group_movie_states WHERE group_id=$1 AND movie_id=$2',[G2,M]))[0].suppressed_cycle,cycle);
    await reject("UPDATE group_movie_states SET support_state='invalid',revision=2 WHERE group_id=$1 AND movie_id=$2",[G2,M],/check constraint/);
    await reject('UPDATE group_movie_states SET proposed_by=$1,revision=2 WHERE group_id=$2 AND movie_id=$3',[N,G2,M],/IMMUTABLE/);
    await reject('UPDATE group_movie_states SET suppressed_at=NULL,revision=2 WHERE group_id=$1 AND movie_id=$2',[G2,M],/check constraint/);
  });
  await test('closed support cannot reactivate with same identity; replacement uses new token',async()=>{
    await q("UPDATE group_movie_states SET revision=2,support_state='consumed',support_ended_at=now() WHERE group_id=$1 AND movie_id=$2",[G2,M]);
    await reject("UPDATE group_movie_states SET revision=3,support_state='active',support_ended_at=NULL WHERE group_id=$1 AND movie_id=$2",[G2,M],/IMMUTABLE/);
    await q("UPDATE group_movie_states SET revision=3,autonomous_support_id=$1,support_state='active',support_recorded_at=now(),support_ended_at=NULL WHERE group_id=$2 AND movie_id=$3",[uid(5002),G2,M]);
  });
  await test('autonomous support succession L consumed, E1 withdrawn, E2 active preserves distinct identities',async()=>{
    const snapshots=[];
    const take=async()=>snapshots.push((await q('SELECT autonomous_support_id,support_origin,support_state,proposed_by FROM group_movie_states WHERE group_id=$1 AND movie_id=$2',[G,uid(1)]))[0]);
    await take();
    await q("UPDATE group_movie_states SET revision=revision+1,support_state='consumed',support_ended_at=now() WHERE group_id=$1 AND movie_id=$2",[G,uid(1)]);
    await take();
    await q("UPDATE group_movie_states SET revision=revision+1,autonomous_support_id=$1,support_origin='explicit',support_state='active',proposed_by=$2,support_recorded_at=now(),support_ended_at=NULL WHERE group_id=$3 AND movie_id=$4",[uid(5011),N,G,uid(1)]);
    await take();
    await q("UPDATE group_movie_states SET revision=revision+1,support_state='withdrawn',support_ended_at=now() WHERE group_id=$1 AND movie_id=$2",[G,uid(1)]);
    await take();
    await q("UPDATE group_movie_states SET revision=revision+1,autonomous_support_id=$1,support_state='active',proposed_by=$2,support_recorded_at=now(),support_ended_at=NULL WHERE group_id=$3 AND movie_id=$4",[uid(5012),V,G,uid(1)]);
    await take();
    assert.deepEqual(snapshots.map(r=>r.support_state),['active','consumed','active','withdrawn','active']);
    assert.deepEqual(snapshots.map(r=>r.proposed_by),[null,null,N,N,V]);
    assert.equal(new Set([snapshots[0].autonomous_support_id,snapshots[2].autonomous_support_id,snapshots[4].autonomous_support_id]).size,3);
    assert.equal(snapshots[0].autonomous_support_id,snapshots[1].autonomous_support_id);
    assert.equal(snapshots[2].autonomous_support_id,snapshots[3].autonomous_support_id);
  });
  await test('suppressed C differs from C2 after real intention interruption and new generation',async()=>{
    const movie=uid(7);
    for(const person of [N,V]) await q('INSERT INTO personal_list_entries(person_id,movie_id,active,generation,revision,activated_at) VALUES($1,$2,true,1,1,now())',[person,movie]);
    const makeCycle=async()=>({version:1,members:(await q('SELECT person_id,generation::int generation FROM personal_list_entries WHERE movie_id=$1 AND active ORDER BY person_id',[movie]))});
    const c=await makeCycle();
    await q("UPDATE group_movie_states SET revision=revision+1,suppressed_cycle=$1,suppression_reason='withdrawn',suppressed_at=now() WHERE group_id=$2 AND movie_id=$3",[JSON.stringify(c),G,movie]);
    await q("UPDATE personal_list_entries SET active=false,revision=2,ended_at=now(),end_reason='removed' WHERE person_id=$1 AND movie_id=$2",[N,movie]);
    assert.equal((await makeCycle()).members.length,1);
    await q('UPDATE personal_list_entries SET active=true,generation=2,revision=3,activated_at=now(),ended_at=NULL,end_reason=NULL WHERE person_id=$1 AND movie_id=$2',[N,movie]);
    const c2=await makeCycle();
    assert.notDeepEqual(c,c2);
    const [row]=await q('SELECT suppressed_cycle, suppressed_cycle=$1::jsonb suppresses_c2 FROM group_movie_states WHERE group_id=$2 AND movie_id=$3',[JSON.stringify(c2),G,movie]);
    assert.deepEqual(row.suppressed_cycle,c);assert.equal(row.suppresses_c2,false);
    assert.equal((await q('SELECT foundation_valid_cycle($1::jsonb) ok',[JSON.stringify(c2)]))[0].ok,true);
  });
  await test('participants unique and protect historical events; no inferred participants',async()=>{
    await reject('INSERT INTO movie_night_participants VALUES($1,$2)',[completed[0],N],/unique/);
    await reject('DELETE FROM movie_nights WHERE id=$1',[completed[0]],/foreign key/);
  });
  await test('night selection tokens require group, and creation request is unique per caller',async()=>{
    for(const id of [uid(2090),uid(2091)]) await q("INSERT INTO movie_nights(id,movie_id,status) VALUES($1,$2,'proposed')",[id,M]);
    await reject('UPDATE movie_nights SET selected_support_id=$1 WHERE id=$2',[uid(5001),uid(2090)],/check constraint/);
    await reject('UPDATE movie_nights SET created_by_caller_id=$1 WHERE id=$2',[N,uid(2090)],/check constraint/);
    await q('UPDATE movie_nights SET group_id=$1,created_by_caller_id=$2,creation_request_id=$3,selected_support_id=$4 WHERE id=$5',[G,N,uid(7001),uid(5001),uid(2090)]);
    await reject('UPDATE movie_nights SET created_by_caller_id=$1,creation_request_id=$2 WHERE id=$3',[N,uid(7001),uid(2091)],/unique/);
    await q('UPDATE movie_nights SET created_by_caller_id=$1,creation_request_id=$2 WHERE id=$3',[V,uid(7001),uid(2091)]);
    assert.equal((await q('SELECT selected_support_id FROM movie_nights WHERE id=$1',[uid(2090)]))[0].selected_support_id,uid(5001));
  });
  const receipt=uid(6001), request=uid(6002);
  await test('receipt caller/request unique; payload SHA256 and scoped result supported',async()=>{
    const insert="INSERT INTO domain_command_receipts(id,caller_id,request_id,command_kind,payload_fingerprint,result_status,result,affected_versions,movie_id) VALUES($1,$2,$3,'test_only',$4,'success',$5,$6,$7)";
    const params=[receipt,N,request,'a'.repeat(64),JSON.stringify({generation:1}),JSON.stringify([{scope:'person_film',version:1}]),M];
    await q(insert,params);
    await reject(insert,[uid(6003),...params.slice(1)],/unique/);
    await reject(insert,[uid(6006),N,request,'b'.repeat(64),params[4],params[5],M],/unique/);
    await reject(insert,[uid(6004),N,uid(6005),'not-a-hash','{}','[]',M],/check constraint/);
    const before=(await q('SELECT * FROM domain_command_receipts WHERE caller_id=$1 AND request_id=$2',[N,request]))[0];
    assert.equal(before.payload_fingerprint,params[3]);assert.deepEqual(before.result,{generation:1});
    await reject("UPDATE domain_command_receipts SET result='{}' WHERE id=$1",[receipt],/APPEND_ONLY/);
    await reject('DELETE FROM domain_command_receipts WHERE id=$1',[receipt],/APPEND_ONLY/);
    assert.deepEqual((await q('SELECT * FROM domain_command_receipts WHERE caller_id=$1 AND request_id=$2',[N,request]))[0],before);
  });
  await test('scoped versions, increments and tombstones independent of entity existence',async()=>{
    // Phase 2 must decide authority between night-local revision and scoped versions.
    // This foundation test only proves structural scoped-version constraints.
    await q("INSERT INTO domain_versions VALUES('person_film',$1,$2,0,false)",[N,uid(9999)]);
    await reject("INSERT INTO domain_versions VALUES('person_film',$1,$2,1,false)",[N,uid(9999)],/unique/);
    await q("UPDATE domain_versions SET version=1,tombstone=true WHERE scope_kind='person_film' AND scope_id=$1 AND entity_id=$2",[N,uid(9999)]);
    await reject("UPDATE domain_versions SET version=0 WHERE scope_id=$1 AND entity_id=$2",[N,uid(9999)],/INCREMENT_REQUIRED/);
    await reject("INSERT INTO domain_versions VALUES('global',$1,$2,1,false)",[N,M],/check constraint/);
    await reject("INSERT INTO domain_versions VALUES('content',$1,$2,1,false)",[N,M],/check constraint/);
    await reject("INSERT INTO domain_versions VALUES('night',$1,$2,-1,false)",[G,uid(9998)],/check constraint/);
    await reject("DELETE FROM domain_versions WHERE scope_id=$1",[N],/RETENTION_REQUIRED/);
  });
  await test('legacy night RPC still proposes/confirms/completes/retries/edits after foundation',async()=>{
    const rpc=async(person,action,id,extra={})=>{
      const fields={p_action:action,p_movie_id:M,p_night_id:id,...extra};
      return (await as(person,'SELECT * FROM manage_movie_night('+Object.keys(fields).map((k,i)=>k+' => $'+(i+1)).join(',')+')',Object.values(fields)))[0];
    };
    const night=await rpc(N,'propose',null,{p_date:'2030-01-01'});
    assert.equal(night.group_id,null);assert.equal(night.created_by_caller_id,null);
    await rpc(V,'confirm',night.id);await rpc(N,'complete',night.id);await rpc(V,'complete',night.id);
    await rpc(N,'edit',night.id,{p_snack:'Synthetic B'});
    assert.equal((await q('SELECT count(*)::int n FROM movie_night_participants WHERE night_id=$1',[night.id]))[0].n,0);
    assert.equal((await q('SELECT count(*)::int n FROM movie_night_intentions WHERE night_id=$1',[night.id]))[0].n,0);
  });
  await test('legacy direct movie writes retain ownership/judgment guard and do not populate foundation',async()=>{
    await as(N,'UPDATE movies SET in_shared_list=true WHERE id=$1',[uid(4)]);
    await as(N,'UPDATE movies SET seen_n=true WHERE id=$1',[uid(4)]);
    await as(N,'UPDATE movies SET personal_liked_n=false WHERE id=$1',[uid(4)]);
    await as(N,'UPDATE movies SET seen_rating_n=0 WHERE id=$1',[uid(4)]);
    assert.equal((await q('SELECT personal_liked_n FROM movies WHERE id=$1',[uid(4)]))[0].personal_liked_n,null);
    await assert.rejects(as(V,'UPDATE movies SET seen_n=false WHERE id=$1',[uid(4)]),/OWNER_REQUIRED/);
    const [seenOnly]=await as(N,"INSERT INTO movies(title,seen_n) VALUES('Synthetic seen only',true) RETURNING id");
    await assert.rejects(as(N,'UPDATE movies SET in_shared_list=true WHERE id=$1',[seenOnly.id]),/FEEDBACK_REQUIRED/);
    assert.deepEqual(await currentContract(),contractBefore);
  });
  await test('no source/projection writer, publication change, seed, global counter or global mutex',async()=>{
    assert(!/CREATE\s+(?:OR REPLACE\s+)?FUNCTION\s+public\.(?:manage_movie_night|guard_movie_watch)/i.test(foundation));
    assert(!/ALTER\s+PUBLICATION|LOCK\s+TABLE|CREATE\s+SEQUENCE/i.test(foundation));
    assert(!/UPDATE\s+public\.movies|INSERT\s+INTO\s+public\./i.test(foundation));
    assert(!/viewing_contexts|viewing_intention_links|CREATE TABLE public.people/i.test(foundation));
    await exec('BEGIN');
    try {
      const rows=await q('SELECT id FROM movies WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[uid(2),uid(1)]]);
      assert.deepEqual(rows.map(r=>r.id),[uid(1),uid(2)]);
    } finally {await exec('ROLLBACK');}
  });
  console.log('PRESERVATION COUNTS: '+JSON.stringify(Object.fromEntries(Object.entries(legacyBefore).map(([t,rows])=>[t,rows.length]))));
  console.log('PRESERVATION SHA256 (pre-migration = post-migration = post-backfill): '+legacyHash);
  console.log('RESULT: '+checks+'/'+checks+' PASS; synthetic PostgreSQL only; no race claims.');
})().catch(error=>{console.error(error.message);process.exitCode=1;})
  .finally(async()=>{if(testDatabase)await testDatabase.close();});
