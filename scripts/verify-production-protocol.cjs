'use strict';
// The real normal() entry and script graph; synthetic online backend only.
async function runChecks(data) {
 let cases=0,serial=1,mode='LEGACY',floor=0,protocolError=null,bootstrapError=null,uid=data.N,heldRead=null,heldMutation=null;
 const calls=[],channels=[];const tick=async()=>{for(let i=0;i<160;i++)await Promise.resolve();};
 const check=(ok,name)=>{if(!ok)throw Error(name);cases++;console.log('PASS '+name);};
 const copy=x=>JSON.parse(JSON.stringify(x));
 const authSession=()=>({access_token:'synthetic',user:{id:uid},expires_at:Math.floor(Date.now()/1000)+3600});
 const client={
  auth:{getSession:async()=>({data:{session:authSession()},error:null}),getUser:async()=>({data:{user:{id:uid}},error:null})},
  realtime:{setAuth:async()=>{}},
  async rpc(name,args){
   calls.push(name);
   if(name==='read_app_protocol'){
    if(heldRead)return new Promise(resolve=>heldRead.push(resolve));
    if(protocolError)return {data:null,error:protocolError};
    return {data:{protocol_read_contract_version:1,outcome:'OK',mode,minimum_client_protocol:floor,authority_epoch:serial.toString(16).padStart(64,'0')},error:null};
   }
   if(name==='get_app_runtime_context')return bootstrapError?{data:{outcome:'ERROR',bootstrap_contract_version:1,error:{code:bootstrapError}},error:null}:{data:{bootstrap_contract_version:1,outcome:'OK',caller:{person_id:uid,legacy_person:uid===data.N?'N':'V'},selected_group:{group_id:data.G},protocol:{client_protocol:1,supported_protocol:1,minimum_client_protocol:1,snapshot_contract_version:1},runtime:{mode:'target',activation_allowed:true}},error:null};
   if(name==='get_person_group_snapshot')return {data:copy(data.raw),error:null};
   throw Error('Unexpected writer RPC '+name);
  },
  from(table){const request={write:false,select(){return this;},order(){return this;},limit(){return this;},eq(){return this;},maybeSingle(){return Promise.resolve({data:{user_id:uid,person:uid===data.N?'N':'V'},error:null});},update(){this.write=true;return this;},
   then(resolve,reject){if(this.write&&heldMutation)return new Promise(r=>heldMutation.push(r)).then(resolve,reject);return Promise.resolve({data:[],error:null}).then(resolve,reject);}};return request;},
  channel(topic){const c={topic,removed:false,on(){return this;},subscribe(){return this;},presenceState:()=>({}),track:async()=>{},untrack:async()=>{}};channels.push(c);return c;},removeChannel(c){c.removed=true;}
 };
 sb=client;authIdentity={uid,person:'N',expiresAt:Date.now()+3600000};currentUser='N';authEpoch++;dbMode='supabase';
 const refresh=async()=>{await ProductionSession.refreshAuthenticated(uid);await tick();};
 const state=()=>ProductionSession.getState();
 await ProductionSession.startAuthenticated(uid);await tick();
 check(state().mode==='LEGACY','normal absent-protocol negotiated LEGACY');
 check(calls.includes('read_app_protocol')&&!calls.includes('get_app_runtime_context'),'no preactivation bootstrap call');
 check(!document.getElementById('appRoot').classList.contains('hidden'),'legacy view available');
 check(channels.filter(c=>!c.removed).length===1,'one legacy shared channel');
 const legacyToken=ProductionSession.capture();
 mode='READ_ONLY';serial++;await refresh();
 check(state().mode==='READ_ONLY','fenced empty protocol reads read_only/0');
 check(channels.every(c=>c.removed),'legacy realtime retired');
 check(document.getElementById('appRoot').classList.contains('hidden'),'mutation UI hidden in maintenance');
 check(!ProductionSession.current(legacyToken),'old legacy handle revoked');
 check(movies.length===0&&movieNights.length===0,'legacy arrays cleared');
 mode='TARGET';floor=1;serial++;await refresh();
 check(state().mode==='TARGET'&&state().phase==='READY','normal target bootstrap and snapshot ready');
 check(state().view.kind==='AVAILABLE','target view from actual server adapter');
 check(calls.includes('get_person_group_snapshot'),'target snapshot RPC read');
 let denied=false;try{assertLegacyDomainAccess();}catch(_){denied=true;}
 check(denied,'real legacy store guard denied');
 const targetToken=ProductionSession.capture();mode='READ_ONLY';serial++;await refresh();
 check(state().mode==='READ_ONLY','target maintenance read_only/1');
 check(!ProductionSession.current(targetToken),'old target handle revoked');
 check((await ProductionSession.action(targetToken,'recordSeen',data.M)).outcome==='OBSOLETE','no stale target mutation');
 mode='TARGET';serial++;await refresh();
 check(state().phase==='READY'&&state().view.kind==='AVAILABLE','resume fresh actual target runtime');
 bootstrapError='MAINTENANCE';await ProductionSession.retryStartup();await tick();
 check(state().mode==='TARGET'&&state().phase==='BLOCKED','target bootstrap failure stays blocked');
 check(!calls.includes('manage_movie_night'),'no legacy RPC fallback');
 bootstrapError=null;await ProductionSession.retryStartup();await tick();
 protocolError={code:'42501'};await refresh();
 check(state().mode==='UNAVAILABLE','protocol permission failure not legacy');
 check(document.getElementById('appRoot').classList.contains('hidden'),'permission failure exposes no mutation UI');
 protocolError={code:'PGRST202'};await refresh();check(state().mode==='UNAVAILABLE','missing negotiation RPC fails closed');
 protocolError=null;mode='LEGACY';floor=0;serial++;await refresh();check(state().mode==='UNAVAILABLE','normal entry refuses floor downgrade');
 await ProductionSession.invalidateAuth();
 // A different verified identity begins with its own online observation.
 uid=data.V;authIdentity={uid,person:'V',expiresAt:Date.now()+3600000};currentUser='V';authEpoch++;await ProductionSession.startAuthenticated(uid);await tick();
 check(state().mode==='LEGACY','relogin renegotiates different verified identity');
 // Same-mode epoch change models fence + restoration entirely between polls.
 movies=[{id:'legacy-late',title:'Original',seen_n:false,seen_v:false}];heldMutation=[];
 const pending=updateMovie('legacy-late',{title:'Late'}).then(()=>null,e=>e);await tick();check(heldMutation.length===1,'real legacy request admitted');
 serial++;await refresh();heldMutation[0]({data:[{id:'legacy-late',title:'Late'}],error:null});const failure=await pending;
 check(failure instanceof TypeError,'old response rejected after legacy authority epoch changed');
 check(!movies.some(m=>m.title==='Late'),'no stale legacy result into replacement session');heldMutation=null;
 await refreshAuthConnection();await tick();check(calls.filter(n=>n==='read_app_protocol').length>8,'real Auth restoration refresh renegotiates');
 await ProductionSession.invalidateAuth();
 return {cases,rpcCalls:calls.length,liveAccess:false};
}
module.exports={runChecks};
if(require.main===module){
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
 const data=require('./verify-production-shell.cjs').fixtureData();
 const RealDate=Date;class FixtureDate extends RealDate {constructor(...a){super(...(a.length?a:[data.at]));}static now(){return new RealDate(data.at).getTime();}}
 const smoke=read('scripts/smoke.js');let dom=smoke.slice(smoke.indexOf('function makeEl('),smoke.indexOf('const localStore ='));
 dom=dom.replace('appendChild(c) {', 'insertAdjacentHTML(position, html) { this._innerHTML += html; }, appendChild(c) {');
 const ctx=vm.createContext({console,Date:FixtureDate,URL,URLSearchParams,AbortController,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
 vm.runInContext(dom+`const document=documentStub;const window={addEventListener(){},scrollTo(){}};const localStorage={getItem:()=>null,setItem(){},removeItem(){}};const sessionStorage=localStorage;const location={search:'?mode=TARGET',hash:'',reload(){}};const navigator={};const performance={now:()=>0};`,ctx);
 const files=[...read('index.html').matchAll(/<script src="(js\/[^\"]+)"/g)].map(m=>m[1]);
 for(const f of files)vm.runInContext(f==='js/config.js'?`const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'',OMDB_API_KEY:'',PEOPLE:{N:{label:'Nicholas',badgeClass:''},V:{label:'Valeria',badgeClass:''}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};`:read(f),ctx,{filename:f});
 vm.runInContext(`(${runChecks.toString()})(${JSON.stringify(data)})`,ctx).then(r=>console.log('NORMAL PROTOCOL VM '+JSON.stringify(r)+' PASS')).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
