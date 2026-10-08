#!/usr/bin/env node
// PostgreSQL temporaneo PGlite. Nessuna connessione o credenziale live.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.argv.find(a=>a.startsWith('--pglite='))?.slice(9)||'@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'..','database',f),'utf8');
const migration=read('supabase-migration-individual-rewatch.sql'),rollback=read('supabase-rollback-individual-rewatch.sql');
const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
let checks=0;
(async()=>{
 const db=new PGlite();await db.waitReady;
 const q=async(s,p)=>(await db.query(s,p)).rows,exec=s=>db.exec(s);
 const test=async(name,fn)=>{await fn();console.log('PASS '+name);checks++;};
 const as=async(person,sql,params=[])=>{await exec(`SET ROLE ${person==='anon'?'anon':'authenticated'}; SELECT set_config('request.jwt.claim.sub','${person==='N'?uid(1001):person==='V'?uid(1002):person==='X'?uid(1003):''}',false)`);try{return await q(sql,params);}finally{await exec('RESET ROLE');}};
 const denied=async(person,sql,params=[])=>assert.rejects(as(person,sql,params),/permission denied|row-level security|OWNER_REQUIRED|PROTECTED|FROZEN|AUTH_REQUIRED|FORBIDDEN|IMMUTABLE|REQUIRED/);
 const rpc=(person,action,movie,night=null,extra={})=>{
  const fields={p_action:action,p_movie_id:movie,p_night_id:night,...extra};
  return as(person,'SELECT * FROM public.manage_movie_night('+Object.keys(fields).map((k,i)=>k+' => $'+(i+1)).join(',')+')',Object.values(fields));
 };
 await exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
 CREATE TABLE public.app_members(user_id uuid PRIMARY KEY,person text UNIQUE); ALTER TABLE app_members ENABLE ROW LEVEL SECURITY; GRANT SELECT ON app_members TO authenticated; CREATE POLICY self ON app_members FOR SELECT TO authenticated USING(user_id=auth.uid());
 CREATE FUNCTION public.app_person() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT person FROM public.app_members WHERE user_id=auth.uid() $$; REVOKE EXECUTE ON FUNCTION public.app_person() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.app_person() TO authenticated;
 INSERT INTO app_members VALUES('${uid(1001)}','N'),('${uid(1002)}','V');`);
 const tables=[...read('supabase-schema.sql').matchAll(/create table (movies|movie_nights) \([\s\S]*?\n\);/gi)].map(m=>m[0]).join('\n');await exec(tables);
 await exec('CREATE UNIQUE INDEX movies_tmdb_id_unique ON movies(tmdb_id) WHERE tmdb_id IS NOT NULL');
 for(const t of ['movies','movie_nights'])await exec(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ${t} TO authenticated; CREATE POLICY members ON ${t} FOR ALL TO authenticated USING(public.app_person() IS NOT NULL) WITH CHECK(public.app_person() IS NOT NULL);`);
 for(let i=1;i<=94;i++)await q('INSERT INTO movies(id,title,status,watched_by,review_by,seen_rating_n,seen_rating_together) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(i),'Fixture '+i,i>91?'watched':'watchlist',i>91?'both':i>79?'N':null,i>91?'both':null,i>=80&&i<=92?8.3:null,i>91?0:null]);
 for(let i=1;i<=34;i++)await q('INSERT INTO movie_nights(id,movie_id,status,date,completed_at) VALUES($1,$2,$3,$4,$5)',[uid(2000+i),uid(i<=31?i:i+60),i<=31?'cancelled':'completed',i<=31?null:'2026-10-08',i<=31?null:'2026-10-08T20:00:00Z']);
 await q("UPDATE movies SET review_text='Legacy shared', review_text_together=NULL WHERE id=$1",[uid(92)]);
 await q("UPDATE movies SET review_text='Frozen fallback',review_text_together='' WHERE id=$1",[uid(93)]);
 await q("UPDATE movies SET review_text='Different legacy',review_text_together='Modern text' WHERE id=$1",[uid(94)]);
 const eventsBefore=await q('SELECT * FROM movie_nights ORDER BY id');
 const before=await q('SELECT id,seen_rating_n,seen_rating_v,seen_rating_together,watched_by,review_by FROM movies ORDER BY id');
 await test('preflight blocca drift e rollback transazionale',async()=>{await q('INSERT INTO movies(id,title) VALUES($1,$2)',[uid(999),'Drift']);await assert.rejects(exec(migration),/nuovo audit/);await exec('ROLLBACK');await q('DELETE FROM movies WHERE id=$1',[uid(999)]);assert.equal((await q("SELECT to_regclass('app_watch_backup.checkpoint') AS t"))[0].t,null);});
 await exec(migration);
 await test('tutti i 34 eventi restano identici al backfill',async()=>assert.deepEqual(await q('SELECT * FROM movie_nights ORDER BY id'),eventsBefore));
 await test('testo moderno vuoto o esistente non sovrascritto dal legacy',async()=>{assert.equal((await q('SELECT review_text_together FROM movies WHERE id=$1',[uid(93)]))[0].review_text_together,'');assert.equal((await q('SELECT review_text_together FROM movies WHERE id=$1',[uid(94)]))[0].review_text_together,'Modern text');});
 await test('94 film, 34 eventi, backfill 79/12/3, 91 candidati e voti intatti',async()=>{assert.deepEqual(await q('SELECT id,seen_rating_n,seen_rating_v,seen_rating_together,watched_by,review_by FROM movies ORDER BY id'),before);assert.deepEqual((await q('SELECT count(*)::int AS total,count(*) FILTER(WHERE seen_n)::int AS n,count(*) FILTER(WHERE seen_v)::int AS v,count(*) FILTER(WHERE in_shared_list)::int AS pool FROM movies'))[0],{total:94,n:12,v:0,pool:91});assert.equal((await q('SELECT count(*)::int AS n FROM movie_nights'))[0].n,34);assert.deepEqual(await q('SELECT seen_n,seen_v,in_shared_list,count(*)::int AS n FROM movies GROUP BY seen_n,seen_v,in_shared_list ORDER BY n DESC'),[{seen_n:false,seen_v:false,in_shared_list:true,n:79},{seen_n:true,seen_v:false,in_shared_list:true,n:12},{seen_n:false,seen_v:false,in_shared_list:false,n:3}]);});
 await test('tre together senza dichiarazioni personali e fallback testo materializzato',async()=>{assert((await q("SELECT seen_n,seen_v FROM movies WHERE status='watched'")).every(m=>!m.seen_n&&!m.seen_v));assert.equal((await q('SELECT review_text_together FROM movies WHERE id=$1',[uid(92)]))[0].review_text_together,'Legacy shared');});
 await test('backup fuori accesso membri',()=>denied('N','SELECT * FROM app_watch_backup.checkpoint'));
 await test('rollback pre-uso conserva dati e grant originali',async()=>{await exec(rollback);assert.deepEqual(await q('SELECT id,seen_rating_n,seen_rating_v,seen_rating_together,watched_by,review_by FROM movies ORDER BY id'),before);assert.equal((await q("SELECT has_table_privilege('authenticated','movie_nights','UPDATE') AS allowed"))[0].allowed,true);assert.equal((await q('SELECT review_text_together FROM movies WHERE id=$1',[uid(92)]))[0].review_text_together,null);
 // Ricrea solo nel DB temporaneo per esercitare lo stesso candidato dopo rollback.
 await exec('ALTER TABLE movies DROP COLUMN seen_n,DROP COLUMN seen_v,DROP COLUMN in_shared_list; DROP SCHEMA app_watch_backup CASCADE');await exec(migration);});
 await test('migration ripetuta rifiuta nuovo backfill',async()=>{await assert.rejects(exec(migration),/Checkpoint/);await exec('ROLLBACK');});
 for(const p of ['N','V']){
  const other=p==='N'?'v':'n',own=p.toLowerCase();
  await test(p+': INSERT impersonificato negato',()=>denied(p,`INSERT INTO movies(title,seen_${other}) VALUES('Forbidden',true)`));
  await test(p+': INSERT voto/testo altrui negati',async()=>{await denied(p,`INSERT INTO movies(title,seen_rating_${other}) VALUES('Forbidden',0)`);await denied(p,`INSERT INTO movies(title,review_text_${other}) VALUES('Forbidden','')`);});
  await test(p+': UPDATE dichiarazione/voto/testo altrui negato',async()=>{for(const [f,v] of [['seen_'+other,p==='N'],['seen_rating_'+other,p==='N'?0:1],['review_text_'+other,'Changed']])await denied(p,`UPDATE movies SET ${f}=$1 WHERE id=$2`,[v,uid(70)]);});
  await test(p+': payload misto atomico',async()=>{await denied(p,`UPDATE movies SET platform='Forbidden',seen_${other}=${p==='N'?'true':'false'} WHERE id=$1`,[uid(70)]);assert.equal((await q('SELECT platform FROM movies WHERE id=$1',[uid(70)]))[0].platform,null);});
  await test(p+': INSERT/UPDATE personale consentito',async()=>{await as(p,`UPDATE movies SET seen_${own}=true,seen_rating_${own}=0,review_text_${own}='Own' WHERE id=$1`,[uid(70)]);});
 }
 await test('azzeramento voto/testo altrui negato',async()=>{await denied('N','UPDATE movies SET seen_rating_v=NULL,review_text_v=NULL WHERE id=$1',[uid(70)]);await denied('V','UPDATE movies SET seen_rating_n=NULL,review_text_n=NULL WHERE id=$1',[uid(70)]);});
 await test('rimozione dichiarazione conserva voto/testo',async()=>{await as('N','UPDATE movies SET seen_n=false WHERE id=$1',[uid(70)]);assert.deepEqual((await q('SELECT seen_n,seen_rating_n,review_text_n FROM movies WHERE id=$1',[uid(70)]))[0],{seen_n:false,seen_rating_n:'0',review_text_n:'Own'});await as('N','UPDATE movies SET seen_n=true WHERE id=$1',[uid(70)]);});
 await test('modifica personale conserva candidatura anche entrando in Rewatch',async()=>{await as('N','UPDATE movies SET seen_n=false WHERE id=$1',[uid(70)]);await as('N','UPDATE movies SET seen_n=true,in_shared_list=true WHERE id=$1',[uid(70)]);assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[uid(70)]))[0].in_shared_list,true);});
 await test('toggle condiviso e uscita personale conserva candidatura',async()=>{await as('V','UPDATE movies SET in_shared_list=true WHERE id=$1',[uid(70)]);assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[uid(70)]))[0].in_shared_list,true);await as('V','UPDATE movies SET seen_v=false WHERE id=$1',[uid(70)]);assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[uid(70)]))[0].in_shared_list,true);});
 await test('legacy e PK congelati, falso watched normalizzato',async()=>{await denied('N',"UPDATE movies SET watched_by='both' WHERE id=$1",[uid(70)]);await denied('N',"UPDATE movies SET review_by='both' WHERE id=$1",[uid(70)]);await denied('N','UPDATE movies SET id=$1 WHERE id=$2',[uid(777),uid(70)]);await as('N',"UPDATE movies SET status='watched' WHERE id=$1",[uid(70)]);assert.equal((await q('SELECT status FROM movies WHERE id=$1',[uid(70)]))[0].status,'watchlist');});
 await test('shared INSERT e voto senza completed negati',async()=>{await denied('N',"INSERT INTO movies(title,seen_rating_together) VALUES('Forbidden',8)");await denied('V','UPDATE movies SET seen_rating_together=8 WHERE id=$1',[uid(70)]);});
 await test('upsert non aggira guardia',()=>denied('N',`INSERT INTO movies(id,title) VALUES('${uid(70)}','Fixture') ON CONFLICT(id) DO UPDATE SET seen_v=true`));
 await test('DELETE dati altrui e cancelled negati',async()=>{await denied('V','DELETE FROM movies WHERE id=$1',[uid(70)]);await denied('N','DELETE FROM movies WHERE id=$1',[uid(1)]);});
 await test('cambio TMDb protetto da personali e storico cancelled',async()=>{await denied('V','UPDATE movies SET tmdb_id=100 WHERE id=$1',[uid(70)]);await denied('N','UPDATE movies SET tmdb_id=100 WHERE id=$1',[uid(1)]);});
 await test('correzione ed eliminazione film senza dati protetti consentite',async()=>{await as('N','UPDATE movies SET tmdb_id=99 WHERE id=$1',[uid(71)]);await as('V','DELETE FROM movies WHERE id=$1',[uid(71)]);});
 for(const p of ['N','V','X','anon'])await test(p+': DML diretto serate negato',async()=>{await denied(p,'INSERT INTO movie_nights(movie_id) VALUES($1)',[uid(70)]);await denied(p,"UPDATE movie_nights SET status='completed'");await denied(p,'DELETE FROM movie_nights');});
 await test('voto personale invalido rifiutato atomicamente',async()=>{for(const p of ['N','V'])for(const rating of [-1,11,8.34])await assert.rejects(as(p,'UPDATE movies SET seen_rating_'+p.toLowerCase()+'=$1 WHERE id=$2',[rating,uid(70)]),/check constraint/);});
 await test('TRUNCATE non può aggirare guardia film o serate',async()=>{for(const p of ['N','V','X','anon'])for(const table of ['movies','movie_nights'])await denied(p,'TRUNCATE '+table+' CASCADE');});
 await test('anon/terzo nessuna lettura o RPC',async()=>{await denied('anon','SELECT * FROM movies');assert.equal((await as('X','SELECT * FROM movies')).length,0);await denied('X','INSERT INTO movies(title) VALUES(\'Forbidden\')');await assert.rejects(rpc('X','quick',uid(70)),/AUTH_REQUIRED/);await assert.rejects(rpc('anon','quick',uid(70)),/permission denied/);});
 await test('RPC crea Oggi, autore Auth, normalizza status',async()=>{const [n]=await rpc('N','quick',uid(70));assert.equal(n.proposed_by,'N');assert.equal(n.date,null);assert.equal(n.status,'confirmed');assert.equal((await q('SELECT status FROM movies WHERE id=$1',[uid(70)]))[0].status,'tonight');});
 let proposal;
 await test('RPC proposta e conferma solo altro membro',async()=>{[proposal]=await rpc('N','propose',uid(70),null,{p_date:'2026-10-10'});await assert.rejects(rpc('N','confirm',uid(70),proposal.id),/OTHER_MEMBER_REQUIRED/);assert.equal((await rpc('V','confirm',uid(70),proposal.id))[0].status,'confirmed');});
 await test('RPC complete condivisa senza voto e idempotente',async()=>{const [first]=await rpc('N','complete',uid(70),proposal.id);const [second]=await rpc('V','complete',uid(70),proposal.id);assert.equal(String(first.completed_at),String(second.completed_at));assert.equal((await q('SELECT count(*)::int AS n FROM movie_nights WHERE id=$1',[proposal.id]))[0].n,1);assert.equal((await q('SELECT seen_rating_n FROM movies WHERE id=$1',[uid(70)]))[0].seen_rating_n,'0');});
 await test('RPC evento completed non riapribile/cancellabile/riassegnabile',async()=>{for(const action of ['confirm','cancel'])await assert.rejects(rpc('V',action,uid(70),proposal.id),/NIGHT_CLOSED/);await assert.rejects(rpc('V','complete',uid(72),proposal.id),/NIGHT_NOT_FOUND/);});
 await test('annullo rewatch successivo ripristina watched',async()=>{const [n]=await rpc('V','quick',uid(70));await rpc('N','cancel',uid(70),n.id);const [remaining]=await q("SELECT id FROM movie_nights WHERE movie_id=$1 AND status='confirmed'",[uid(70)]);await rpc('N','cancel',uid(70),remaining.id);assert.equal((await q('SELECT status FROM movies WHERE id=$1',[uid(70)]))[0].status,'watched');await assert.rejects(rpc('N','complete',uid(70),n.id),/NIGHT_CLOSED/);});
 await test('RPC testo/voto condivisi atomici e validazione',async()=>{const [n]=await rpc('N','quick',uid(72));await assert.rejects(rpc('V','complete',uid(72),n.id,{p_shared_rating:8.34}),/INVALID_RATING/);assert.equal((await q('SELECT status FROM movie_nights WHERE id=$1',[n.id]))[0].status,'confirmed');await rpc('V','complete',uid(72),n.id,{p_shared_rating:0,p_shared_text:''});assert.equal((await q('SELECT seen_rating_together FROM movies WHERE id=$1',[uid(72)]))[0].seen_rating_together,'0');});
 await test('RPC edit luogo completed conserva snack e data',async()=>{const [n]=await rpc('V','edit',uid(72),(await q("SELECT id FROM movie_nights WHERE movie_id=$1 AND status='completed'",[uid(72)]))[0].id,{p_location:'Casa',p_set_location:true});assert.equal(n.location,'Casa');await assert.rejects(rpc('N','edit',uid(72),n.id,{p_snack:'Different'}),/COMPLETED_SNACK_FROZEN/);});
 await test('RPC azioni invalide e parametri incrociati non scrivono',async()=>{await assert.rejects(rpc('N','delete',uid(72)),/INVALID_NIGHT_ACTION/);await assert.rejects(rpc('N','propose',uid(72)),/DATE_REQUIRED/);await assert.rejects(rpc('N','quick',uid(72),null,{p_shared_rating:8}),/UNEXPECTED_SHARED_REVIEW/);});
 for (const person of ['N','V']) {
  const own=person.toLowerCase();
  await test(person+': Solo Storico senza voto, candidatura richiede voto, zero valido',async()=>{
   const [m]=await as(person,`INSERT INTO movies(title,seen_${own},review_text_${own}) VALUES('History',true,'Keep') RETURNING *`);
   assert.equal(m.in_shared_list,false);assert.equal(m['seen_rating_'+own],null);
   await denied(person,'UPDATE movies SET in_shared_list=true WHERE id=$1',[m.id]);
   await as(person,`UPDATE movies SET in_shared_list=true,seen_rating_${own}=0 WHERE id=$1`,[m.id]);
   await as(person,`UPDATE movies SET seen_rating_${own}=NULL WHERE id=$1`,[m.id]);
   assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[m.id]))[0].in_shared_list,true);
   await as(person,'UPDATE movies SET in_shared_list=false WHERE id=$1',[m.id]);
   await denied(person,'UPDATE movies SET in_shared_list=true WHERE id=$1',[m.id]);
   assert.equal((await q(`SELECT review_text_${own} AS text FROM movies WHERE id=$1`,[m.id]))[0].text,'Keep');
   await denied(person,`INSERT INTO movies(title,seen_${own},in_shared_list) VALUES('Invalid',true,true)`);
  });
 }
 await test('seconda dichiarazione senza voto mantiene candidato e nessun personale duplicato',async()=>{
  const [m]=await as('N',"INSERT INTO movies(title,seen_n,seen_rating_n,in_shared_list) VALUES('Candidate',true,8,true) RETURNING *");
  await as('V','UPDATE movies SET seen_v=true WHERE id=$1',[m.id]);
  const [row]=await q('SELECT seen_n,seen_v,seen_rating_v,in_shared_list FROM movies WHERE id=$1',[m.id]);
  assert.deepEqual(row,{seen_n:true,seen_v:true,seen_rating_v:null,in_shared_list:true});
 });
 await test('completed consuma candidatura, retry non consuma ricandidatura',async()=>{
  const [m]=await as('N',"INSERT INTO movies(title,in_shared_list,seen_n,seen_rating_n) VALUES('Consume',true,true,0) RETURNING *");
  const [n]=await rpc('N','quick',m.id);await rpc('V','complete',m.id,n.id);
  assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[m.id]))[0].in_shared_list,false);
  await as('N','UPDATE movies SET in_shared_list=true WHERE id=$1',[m.id]);
  await rpc('N','complete',m.id,n.id);
  assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[m.id]))[0].in_shared_list,true);
  assert.equal((await q('SELECT seen_n FROM movies WHERE id=$1',[m.id]))[0].seen_n,true);
 });
 await test('complete_now nuova conclusione consuma, retry conserva ricandidatura',async()=>{
  const [m]=await as('V',"INSERT INTO movies(title,in_shared_list) VALUES('Immediate',true) RETURNING *");
  const [first]=await rpc('V','complete_now',m.id);
  assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[m.id]))[0].in_shared_list,false);
  await as('N','UPDATE movies SET in_shared_list=true WHERE id=$1',[m.id]);
  const [again]=await rpc('N','complete_now',m.id);assert.equal(again.id,first.id);
  assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[m.id]))[0].in_shared_list,true);
 });
 await test('Programma/Oggi e annullamento conservano candidatura true e false',async()=>{
  for(const candidate of [true,false]) {
   const [m]=await as('N','INSERT INTO movies(title,in_shared_list) VALUES($1,$2) RETURNING *',['Schedule',candidate]);
   for(const action of ['quick','propose']) {
    const [n]=await rpc('N',action,m.id,null,action==='propose'?{p_date:'2026-10-10'}:{});
    await rpc('V','cancel',m.id,n.id);
    assert.equal((await q('SELECT in_shared_list FROM movies WHERE id=$1',[m.id]))[0].in_shared_list,candidate);
   }
  }
 });
 await test('TMDb UNIQUE: gara recuperata con contributi personali distinti',async()=>{
  const [m]=await as('N',"INSERT INTO movies(title,tmdb_id,seen_n) VALUES('Same TMDb',999000,true) RETURNING *");
  await assert.rejects(as('V',"INSERT INTO movies(title,tmdb_id,seen_v) VALUES('Same TMDb',999000,true)"),/duplicate key/);
  await as('V','UPDATE movies SET seen_v=true WHERE tmdb_id=999000');
  const [row]=await q('SELECT seen_n,seen_v,in_shared_list FROM movies WHERE id=$1',[m.id]);
  assert.deepEqual(row,{seen_n:true,seen_v:true,in_shared_list:false});
 });
 await test('Solo Storico con voto e Togli/Rimetti conservano tutto il tripletto personale',async()=>{
  const [m]=await as('N',"INSERT INTO movies(title,seen_n,seen_rating_n,review_text_n) VALUES('Preserve',true,8.3,'Text') RETURNING *");
  for(const candidate of [true,false,true]) await as('N','UPDATE movies SET in_shared_list=$1 WHERE id=$2',[candidate,m.id]);
  const [row]=await q('SELECT seen_n,seen_rating_n,review_text_n,in_shared_list FROM movies WHERE id=$1',[m.id]);
  assert.deepEqual(row,{seen_n:true,seen_rating_n:'8.3',review_text_n:'Text',in_shared_list:true});
 });
 await test('rollback dopo uso bloccato',async()=>{await assert.rejects(exec(rollback),/dati successivi/);await exec('ROLLBACK');assert.equal((await q("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='movie_watch_guard'"))[0].n,1);});
 await db.close();console.log(`Individual/Rewatch DB: ${checks}/${checks} PASS (PostgreSQL locale)`);
})().catch(e=>{console.error('FAIL '+e.message);process.exitCode=1;});
