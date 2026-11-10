'use strict';
// Run only after the synthetic CAP-1 suite populated this disposable native DB.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3),connection=arg('connection'),url=new URL(connection);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||!/^\/sc_person_group_test[a-z0-9_]*$/.test(url.pathname)||url.password||url.search)throw Error('Disposable loopback PostgreSQL only');
const {Client}=require(arg('pg')||'pg'),N='00000000-0000-4000-8000-000000001001';
(async()=>{const clients=Array.from({length:3},()=>new Client({connectionString:connection,ssl:false}));try{
 await Promise.all(clients.map(c=>c.connect()));const [a,b,o]=clients;const row=(await o.query("SELECT to_jsonb(n) n,v.version::text version FROM movie_nights n JOIN domain_versions v ON v.scope_kind='night' AND v.scope_id=n.group_id AND v.entity_id=n.id WHERE n.status='completed' AND NOT n.retrospective ORDER BY n.id LIMIT 1")).rows[0];assert(row,'Synthetic completed fixture required');
 const before=(await o.query('SELECT count(*)::int n FROM movie_nights')).rows[0].n,night=row.n;
 const body=text=>({protocol_version:1,request_id:crypto.randomUUID(),intent:'EDIT_PAST_TOGETHER',target:{movie_id:night.movie_id,group_id:night.group_id,night_id:night.id},expected_versions:[{scope_kind:'night',scope_id:night.group_id,entity_id:night.id,version:row.version}],parameters:{night_memory:text,client_snapshot_contract_version:2}});
 const nonce=crypto.randomUUID(),firstText='Native CAS first '+nonce;
 const first=body(firstText),second=body('Native CAS second '+nonce);
 for(const c of [a,b]){await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='10s'");await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[N]);}
 const pidA=(await a.query('SELECT pg_backend_pid() pid')).rows[0].pid,pidB=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;assert.notEqual(pidA,pidB);
 assert.equal((await a.query('SELECT execute_app_command($1::jsonb) r',[JSON.stringify(first)])).rows[0].r.outcome,'SUCCESS');
 const pending=b.query('SELECT execute_app_command($1::jsonb) r',[JSON.stringify(second)]);pending.catch(()=>{});let blocked=false;for(let i=0;i<80&&!blocked;i++){blocked=(await o.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) waiting',[pidA,pidB])).rows[0].waiting;if(!blocked)await new Promise(r=>setTimeout(r,20));}assert(blocked,'Observed actual blocking between two independent PostgreSQL backends');await a.query('COMMIT');assert.equal((await pending).rows[0].r.outcome,'STALE');await b.query('COMMIT');
 await o.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[N]);const replay=(await o.query('SELECT execute_app_command($1::jsonb) r',[JSON.stringify(first)])).rows[0].r;assert(replay.replayed);assert.equal(replay.outcome,'SUCCESS');
 const after=(await o.query("SELECT to_jsonb(n) n,v.version::text version FROM movie_nights n JOIN domain_versions v ON v.scope_kind='night' AND v.scope_id=n.group_id AND v.entity_id=n.id WHERE n.id=$1",[night.id])).rows[0];assert.equal(BigInt(after.version),BigInt(row.version)+1n);assert.equal(after.n.night_memory,firstText);for(const k of Object.keys(night).filter(k=>k!=='night_memory'))assert.deepEqual(after.n[k],night[k]);assert.equal((await o.query('SELECT count(*)::int n FROM movie_nights')).rows[0].n,before);
 console.log('NATIVE_POSTGRES_RACE PASS: independent backends, observed lock wait, STALE loser, exact receipt replay, one version bump, unchanged event identity/history.');
 }finally{await Promise.all(clients.map(async c=>{try{await c.query('ROLLBACK');}catch(_){}await c.end();}));}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
