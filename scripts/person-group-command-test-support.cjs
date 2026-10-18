// Synthetic fixture shared with Phase 1, without changing its committed runner.
// No credentials, network, config.js or import artifacts are read.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const uid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const N=uid(1001),V=uid(1002),X=uid(1003),G=uid(3001);
async function fixture() {
  const statements=[];
  const sqlLiteral=x=>x===null?'NULL':typeof x==='boolean'?String(x):typeof x==='number'?String(x):"'"+String(x).replaceAll("'","''")+"'";
  const record=(sql,params=null)=>statements.push((params===null?sql:sql.replace(/\$(\d+)/g,(_,i)=>sqlLiteral(params[Number(i)-1])))+';');
  const source=read('scripts/verify-person-group-foundation-db.js');
  const boundary='(async () => {';
  if(source.split(boundary).length!==2) throw Error('Phase 1 fixture extraction drift');
  let prefix=source.slice(0,source.indexOf(boundary)).replace(/^#!.*\n/,'');
  const oldExec='const exec = sql => db.exec(sql);';
  const oldQuery='const q = async (sql, params = []) => (await db.query(sql, params)).rows;';
  if(!prefix.includes(oldExec)||!prefix.includes(oldQuery)) throw Error('Phase 1 recorder extraction drift');
  prefix=prefix.replace(oldExec,'const exec = sql => { record(sql); return db.exec(sql); };')
    .replace(oldQuery,'const q = async (sql, params = []) => { record(sql,params); return (await db.query(sql,params)).rows; };');
  const setup=new Function('require','__dirname','process','record',prefix+'\nreturn currentDatabase;');
  const env=await setup(require,__dirname,process,record)();
  // Optional SQL transcript for the independent PostgreSQL runner, generated
  // from this synthetic database only. Never contains production data.
  const q=env.q;
  const exec=env.exec;
  // The original adapters already record; keep their query behavior intact.
  env.q=q;env.exec=exec;
  await env.exec(read('database/supabase-migration-person-group-foundation.sql'));
  const settings={foundation_approved:'verified-preflight',foundation_group_id:G,foundation_n_user_id:N,foundation_v_user_id:V,
    foundation_completed_ids:JSON.stringify([uid(2032),uid(2033),uid(2034)])};
  for(const [k,v] of Object.entries(settings)) await env.q('SELECT set_config($1,$2,false)',['scorochiatu.'+k,v]);
  await env.exec(read('database/supabase-backfill-person-group-foundation.sql'));
  env.preservation=async()=>{
    const values={};
    for(const table of ['movies','movie_nights','votes','vetoes','app_members','swipe_sessions','swipes'])
      values[table]=await env.q(`SELECT * FROM ${table} ORDER BY ${table==='app_members'?'user_id':'id'}`);
    values.contract=await env.q(`SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc
      WHERE oid IN ('public.guard_movie_watch()'::regprocedure,'public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)'::regprocedure)
      ORDER BY proname`);
    return values;
  };
  env.beforeCommands=await env.preservation();
  await env.exec(read('database/supabase-migration-person-group-commands.sql'));
  env.bootstrapSQL=statements.join('\n');
  env.rev=async(k,s,e)=>(await env.q('SELECT version FROM domain_versions WHERE scope_kind=$1 AND scope_id=$2 AND entity_id=$3',[k,s,e]))[0]?.version||0;
  env.call=async(person,kind,movie,group=null,expected=0,params={},request=crypto.randomUUID())=>{
    await env.q("SELECT set_config('request.jwt.claim.sub',$1,false)",[person]);
    return (await env.q('SELECT domain_command($1,$2,$3,$4,$5,$6::jsonb) result',[request,kind,movie,group,expected,JSON.stringify(params)]))[0].result;
  };
  env.statements=statements;
  return env;
}
module.exports={fixture,read,uid,N,V,X,G};
