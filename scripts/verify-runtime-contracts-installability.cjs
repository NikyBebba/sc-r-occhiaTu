#!/usr/bin/env node
'use strict';
// Local PostgreSQL only. Also exports a fail-closed source/proconfig preflight.
// This does not connect to Supabase or authorize any migration execution.
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {fixture,read}=require('./person-group-command-test-support.cjs');

function tokens(sql){
 const out=[];let i=0;
 while(i<sql.length){
  if(/\s/.test(sql[i])){i++;continue;}
  if(sql.startsWith('--',i)){i=sql.indexOf('\n',i);if(i<0)break;continue;}
  if(sql.startsWith('/*',i)){let depth=1;i+=2;while(depth&&i<sql.length){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}if(depth)throw Error('Unclosed SQL comment');continue;}
  const dollar=sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/);
  if(dollar){const end=sql.indexOf(dollar[0],i+dollar[0].length);if(end<0)throw Error('Unclosed dollar quote');out.push({kind:'body',value:sql.slice(i+dollar[0].length,end)});i=end+dollar[0].length;continue;}
  const escaped=/^[eE]'/.test(sql.slice(i));
  if(sql[i]==="'"||escaped){if(escaped)i++;let value='',closed=false;i++;while(i<sql.length){if(escaped&&sql[i]==='\\'){value+=sql.slice(i,i+2);i+=2;}else if(sql[i]==="'"){if(sql[i+1]==="'"){value+="'";i+=2;}else{i++;closed=true;break;}}else value+=sql[i++];}if(!closed)throw Error('Unclosed SQL string');out.push({kind:'string',value});continue;}
  if(sql[i]==='"'){let value='';i++;while(i<sql.length){if(sql[i]==='"'){if(sql[i+1]==='"'){value+='"';i+=2;}else{ i++;break;}}else value+=sql[i++];}out.push({kind:'identifier',value});continue;}
  const word=sql.slice(i).match(/^[a-zA-Z_][a-zA-Z_0-9$]*/);if(word){out.push({kind:'word',value:word[0]});i+=word[0].length;}else out.push({kind:'symbol',value:sql[i++]});
 }
 return out;
}
function inspectSettings(source){
 const persisted=[],runtime=[],unresolved=[];
 function scan(sql,origin='source',depth=0){
  if(depth>6){unresolved.push('SQL nesting exceeds supported inspection depth');return;}
  const ts=tokens(sql),word=i=>ts[i]?.kind==='word'?ts[i].value.toUpperCase():'';
  for(let i=0;i<ts.length;i++){
   if(word(i)==='EXECUTE'){
    const literal=word(i+1)==='FORMAT'&&ts[i+2]?.value==='('?ts[i+3]:ts[i+1];
    if(literal?.kind!=='string')unresolved.push(origin+': nonliteral EXECUTE requires explicit review');
    else if(ts[i+2]?.value==='||'||(word(i+1)==='FORMAT'&&ts[i+4]?.value==='||'))unresolved.push(origin+': assembled EXECUTE requires explicit review');
    else if(!/^(?:CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\b|ALTER\s+FUNCTION\b|REVOKE\b)/i.test(literal.value.trim()))unresolved.push(origin+': unrecognized EXECUTE template requires explicit review');
    else if(/^(?:CREATE|ALTER)\b/i.test(literal.value.trim())&&literal.value.split(/\bAS\b/i)[0].includes('%'))unresolved.push(origin+': dynamic FUNCTION header requires explicit review');
   }
   if(word(i)==='SET_CONFIG'||word(i)==='CURRENT_SETTING'){
    const args=[];let arg=[],level=0;
    for(let k=i+2;k<ts.length;k++){const t=ts[k];if(t.value===')'&&level===0){args.push(arg);break;}if(t.value===','&&level===0){args.push(arg);arg=[];continue;}arg.push(t);if(t.value==='(')level++;if(t.value===')')level--;}
    const parameter=args[0]?.length===1&&args[0][0].kind==='string'?args[0][0].value:null;
    const local=args[2]?.length===1?args[2][0].value.toLowerCase():null;
    runtime.push({operation:word(i).toLowerCase(),parameter,custom:parameter===null?null:parameter.includes('.'),scope:word(i)==='CURRENT_SETTING'?'read':local==='true'?'transaction':local==='false'?'session':'dynamic/review',origin});
   }
   if(!['CREATE','ALTER'].includes(word(i)))continue;
   let j=i+1;if(word(j)==='OR'&&word(j+1)==='REPLACE')j+=2;
   if(word(j)!=='FUNCTION')continue;
   const operation=word(i);j++;
   while(j<ts.length&&ts[j].value!==';'){
    // PostgreSQL accepts SET both before and after AS/body/LANGUAGE.
    // Quoted bodies are single tokens, so body-local SET is not proconfig.
    if(word(j)==='SET'){
     let name='',k=j+1;
     while(ts[k]&&!(ts[k].value==='='||['TO','FROM'].includes(word(k)))){name+=ts[k].value;k++;}
     if(!name||!/^[a-zA-Z_][a-zA-Z_0-9]*(?:\.[a-zA-Z_][a-zA-Z_0-9]*)*$/.test(name)||!ts[k])unresolved.push(origin+': unresolved FUNCTION SET parameter');
     else persisted.push({operation,parameter:name.toLowerCase(),origin,custom:name.includes('.'),fromCurrent:word(k)==='FROM'});
     j=k;
    }
    j++;
   }
  }
  // Includes DO bodies and literal CREATE/ALTER templates passed to format().
  for(const t of ts)if(['body','string'].includes(t.kind)&&/\b(?:CREATE|ALTER|EXECUTE|set_config|current_setting)\b/i.test(t.value))scan(t.value,origin+'/'+t.kind,depth+1);
 }
 scan(source);return {persisted,runtime,unresolved};
}
function checkSettings(inventory,catalog,installer){
 const issues=[...inventory.unresolved];
 for(const setting of inventory.persisted){const registered=catalog.find(x=>x.name.toLowerCase()===setting.parameter),hasSet=installer.parameterSet.some(x=>x.toLowerCase()===setting.parameter);
  if(!registered){if(!installer.superuser&&!hasSet)issues.push('UNKNOWN_OR_CUSTOM_PARAMETER_SET_PRIVILEGE_REQUIRED:'+setting.parameter);}
  else if(registered.context!=='user'&&!(registered.context==='superuser'&&(installer.superuser||hasSet)))issues.push('UNSUPPORTED_PARAMETER_CONTEXT_OR_PRIVILEGE:'+setting.parameter);
  if(setting.fromCurrent)issues.push('FROM_CURRENT_REQUIRES_VALUE_REVIEW:'+setting.parameter);
 }
 return {pass:issues.length===0,issues};
}
module.exports={inspectSettings,checkSettings};

async function main(){
 const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3),connection=arg('connection');
 if(!connection)throw Error('Requires EMPTY disposable loopback --connection sc_person_group_test*');
 const u=new URL(connection);assert(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&/^\/sc_person_group_test[a-z0-9_]*$/.test(u.pathname)&&!u.search);
 const opts=['-X','--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=1','--dbname',connection],env={...process.env,PGSSLMODE:'disable',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'3'};
 const raw=s=>spawnSync(arg('psql')||'psql',opts,{input:s,env,encoding:'utf8',maxBuffer:32*1024*1024});
 const sql=s=>{const r=raw(s);if(r.error||r.status)throw Error(r.error?.message||r.stderr);return r.stdout.trim();};
 assert.equal(sql("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p');"),'0','Must be EMPTY');
 const e=await fixture();try{
  sql(e.bootstrapSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated;',()=>"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;END $$;"));
  sql(read('database/supabase-migration-person-group-snapshot.sql'));
  // Test provisioning only: the migration must neither change nor elevate this role.
  const role='unit4_limited_installer';
  sql(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;END IF;END $$;
   ALTER SCHEMA public OWNER TO ${role}; ALTER SCHEMA auth OWNER TO ${role};
   DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT oid::regclass AS obj,relkind FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'auth'::regnamespace) AND relkind IN ('r','S') LOOP EXECUTE format('ALTER %s %s OWNER TO ${role}',CASE WHEN r.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,r.obj);END LOOP;
    FOR r IN SELECT oid::regprocedure obj FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'auth'::regnamespace) LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO ${role}',r.obj);END LOOP;
   END $$;`);
  const privileges=()=>sql(`SELECT row_to_json(r) FROM (SELECT rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolbypassrls,has_parameter_privilege(oid,'scorochiatu.content_write','SET') parameter_set FROM pg_roles WHERE rolname='${role}') r;`);
  const before=privileges();assert.deepEqual(JSON.parse(before),{rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolinherit:false,rolbypassrls:false,parameter_set:false});
  const existing=JSON.parse(sql("SELECT json_agg(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace;"));
  const old=raw(`\\set VERBOSITY verbose\n SET ROLE ${role}; CREATE FUNCTION public.old_content_marker_probe() RETURNS integer LANGUAGE sql SET scorochiatu.content_write='on' AS 'SELECT 1';`);
  assert.notEqual(old.status,0);assert.match(old.stderr,/42501/);assert.match(old.stderr,/permission denied to set parameter "scorochiatu.content_write"/);
  const source=read('database/supabase-migration-runtime-contracts.sql'),inventory=inspectSettings(source);
  const catalog=JSON.parse(sql('SELECT json_agg(json_build_object(\'name\',name,\'context\',context)) FROM pg_settings;'));
  const installer={superuser:false,parameterSet:[]};assert.deepEqual(checkSettings(inventory,catalog,installer),{pass:true,issues:[]});
  assert.equal(inventory.persisted.length,20,'18 literal definitions + 2 dynamic definitions');
  assert.equal(inventory.persisted.filter(x=>x.origin!=='source').length,2);
  assert(inventory.runtime.some(x=>x.operation==='set_config'&&x.parameter==='scorochiatu.content_write'));
  for(const bad of ["CREATE FUNCTION f() RETURNS int SET scorochiatu.content_write='on' AS 'SELECT 1' LANGUAGE sql;", "CREATE FUNCTION f() RETURNS int AS 'SELECT 1' LANGUAGE sql SET scorochiatu.content_write='on';", "DO $$ BEGIN EXECUTE format('ALTER FUNCTION public.f() SET scorochiatu.content_write=''on'''); END $$;", "DO $$ BEGIN EXECUTE ddl; END $$;", "DO $$ BEGIN EXECUTE 'ALTER FUNCTION f() SET ' || setting; END $$;", "DO $$ BEGIN EXECUTE format('%s FUNCTION f() SET search_path=''''','ALTER'); END $$;"]){assert.equal(checkSettings(inspectSettings(bad),catalog,installer).pass,false,bad);}
  // Unknown settings are not silently accepted, even if outside this migration.
  assert.equal(checkSettings(inspectSettings("ALTER FUNCTION f() SET unknown_custom.option='on'"),catalog,installer).pass,false);
  assert.equal(checkSettings(inspectSettings("ALTER FUNCTION f() SET log_statement_stats='on'"),catalog,installer).pass,false);
  assert.equal(checkSettings(inspectSettings("ALTER FUNCTION f() SET search_path=''"),catalog,installer).pass,true);
  assert.equal(checkSettings(inspectSettings("ALTER FUNCTION f() SET DateStyle='ISO, YMD'"),catalog,installer).pass,true);
  sql(`SET ROLE ${role};\n`+source);assert.equal(privileges(),before);
  const installed=JSON.parse(sql(`SELECT json_agg(json_build_object('name',proname,'owner',pg_get_userbyid(proowner),'definer',prosecdef,'configuration',proconfig,
   'browser_execute',has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE'),
   'public_execute',EXISTS(SELECT FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')))
   FROM pg_proc WHERE pronamespace='public'::regnamespace AND oid<>ALL(ARRAY[${existing.join(',')}]::oid[]);`));
  assert.equal(installed.length,19);assert.equal(new Set(installed.map(x=>x.name)).size,19);
  assert.equal(installed.filter(x=>x.definer).length,4);
  for(const f of installed){assert.equal(f.owner,role);assert.deepEqual(f.configuration,['search_path=""']);assert.equal(f.browser_execute,false);assert.equal(f.public_execute,false);}
  sql(`SET ROLE ${role}; BEGIN; SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001001',true);
   UPDATE app_protocol_state SET mode='target'; SELECT set_config('scorochiatu.content_write','neutral',true);
   SELECT app_content_write('00000000-0000-4000-8000-000000000095','{"duration":"limited role"}',false,'N');
   DO $$ BEGIN IF current_setting('scorochiatu.content_write',true)<>'neutral' THEN RAISE EXCEPTION 'LIMITED_ROLE_MARKER_LEAK'; END IF; END $$; ROLLBACK;`);
  assert.equal(privileges(),before);
  assert.equal(sql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proconfig::text LIKE '%scorochiatu.content_write=%');"),'0');
  assert.equal(sql("SELECT has_function_privilege('authenticated','app_content_write(uuid,jsonb,boolean,text)','EXECUTE');"),'f');
  const hashes=sql("SELECT json_agg(json_build_object('name',proname,'owner',pg_get_userbyid(proowner),'source_sha256',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex'),'configuration',proconfig) ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('guard_movie_watch','app_content_write','execute_app_command');");
  console.log('PostgreSQL '+sql('SHOW server_version;')+'; old pattern 42501 reproduced; new Unit 4 installed as non-superuser without parameter SET; role privileges unchanged.');
  console.log('Persisted configuration preflight: '+JSON.stringify(inventory));console.log('Expected function hashes: '+hashes);
  console.log('INSTALLABILITY_REGRESSION = PASS (tested server version reported above; no hosted Supabase equivalence claim)');
 }finally{await e.db.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
