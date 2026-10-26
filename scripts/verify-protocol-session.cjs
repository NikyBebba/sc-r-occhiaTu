'use strict';
const assert=require('node:assert/strict');
const Protocol=require('../js/runtime/protocol-session');
const N='00000000-0000-4000-8000-000000001001',V='00000000-0000-4000-8000-000000001002';
const reply=(mode='LEGACY',floor=mode==='TARGET'?1:0,epoch='a')=>({protocol_read_contract_version:1,outcome:'OK',mode,minimum_client_protocol:floor,authority_epoch:epoch.repeat(64)});
const tick=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function fixture() {
 let at=0,id=0,value=reply(),reads=0,clears=0,active=0,max=0,failDispose=false,failStart=false;
 const jobs=new Map(),events=[],children=[];let customRead=null;
 const app=Protocol.create({readProtocol:uid=>{reads++;return customRead?customRead(uid):typeof value==='function'?value():value;},
  createSession:mode=>{
   const child={mode,phase:'STARTING',generation:1,subscribe(){return()=>{};},getState(){return {mode,phase:this.phase,view:{kind:'AVAILABLE'},actions:{}};},
    async startAuthenticated(uid){events.push('start:'+mode+':'+uid);if(failStart)throw Error('start');this.phase='READY';active++;max=Math.max(max,active);},
    async dispose(){events.push('stop:'+mode);if(failDispose)throw Error('teardown');if(this.phase==='READY')active--;this.phase='STOPPED';},
    capture(){return{};},action:async()=>({outcome:'SUCCESS'}),match:async()=>({category:'SUCCESS'}),requestRefresh:async()=>{},setObservedPerson(){}};
   children.push(child);return child;
  },clearViews(){clears++;},onState:s=>events.push('state:'+s.mode),now:()=>at,schedule:(ms,fn)=>{jobs.set(++id,{when:at+ms,fn});return id;},cancel:i=>jobs.delete(i)});
 return {app,events,children,get reads(){return reads;},get active(){return active;},get max(){return max;},set value(v){value=v;},set read(fn){customRead=fn;},set failDispose(v){failDispose=v;},set failStart(v){failStart=v;},
  async advance(ms){at+=ms;for(const [i,j]of [...jobs])if(j.when<=at){jobs.delete(i);j.fn();}await tick();},async start(v=reply(),uid=N){value=v;await app.startAuthenticated(uid);},get clears(){return clears;}};
}
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
(async()=>{
 for(const [mode,floor]of [['LEGACY',0],['READ_ONLY',0],['TARGET',1],['READ_ONLY',1]])await test('positive '+mode+'/'+floor,async()=>{const h=fixture();await h.start(reply(mode,floor));assert.equal(h.app.getState().mode,mode);assert.equal(h.active,mode==='READ_ONLY'?0:1);});
 for(const [name,data]of [['missing',null],['permission',{error:{code:'42501'}}],['missing_RPC',{error:{code:'PGRST202'}}],['unknown_mode',reply('AUTO')],['future_floor',reply('TARGET',2)],['target_floor0',reply('TARGET',0)],['legacy_floor1',reply('LEGACY',1)],['contract2',{...reply(),protocol_read_contract_version:2}],['string_floor',{...reply(),minimum_client_protocol:'0'}],['extra_field',{...reply(),debug:true}],['bad_epoch',{...reply(),authority_epoch:'old'}],['bootstrap_failure',{outcome:'ERROR',code:'FOUNDATION_NOT_READY'}]])await test(name+' fails closed',async()=>{const h=fixture();await h.start(data);assert.equal(h.app.getState().mode,'UNAVAILABLE');assert.equal(h.active,0);assert.throws(()=>h.app.assertLegacy());});
 await test('network failure revokes legacy',async()=>{const h=fixture();await h.start();h.value=()=>Promise.reject(Error('network'));await h.app.refresh();assert.equal(h.active,0);assert.equal(h.app.getState().mode,'UNAVAILABLE');});
 await test('legacy read_only target has exclusive owners',async()=>{const h=fixture();await h.start();const old=h.app.capture();h.value=reply('READ_ONLY',0,'b');await h.app.refresh();assert(!h.app.current(old));assert.equal(h.active,0);h.value=reply('TARGET',1,'c');await h.app.refresh();assert.equal(h.app.getState().mode,'TARGET');assert.equal(h.max,1);assert.throws(()=>h.app.assertLegacy());});
 await test('target maintenance resume starts a fresh owner',async()=>{const h=fixture();await h.start(reply('TARGET'));const old=h.app.capture();h.value=reply('READ_ONLY',1,'b');await h.app.refresh();assert.equal(h.active,0);assert(!h.app.current(old));h.value=reply('TARGET',1,'c');await h.app.refresh();assert.equal(h.children.length,2);assert.equal(h.max,1);});
 await test('floor does not downgrade across logout/relogin same identity',async()=>{const h=fixture();await h.start(reply('TARGET'));await h.app.invalidateAuth();await h.start(reply('LEGACY'),N);assert.equal(h.app.getState().mode,'UNAVAILABLE');assert.equal(h.active,0);});
 await test('different authenticated identity renegotiates independently',async()=>{const h=fixture();await h.start(reply('TARGET'));await h.start(reply('LEGACY'),V);assert.equal(h.app.getState().mode,'LEGACY');assert.equal(h.max,1);});
 await test('same mode new server epoch invalidates late legacy callbacks',async()=>{const h=fixture();await h.start();const token=h.app.capture();h.value=reply('LEGACY',0,'b');await h.app.refresh();assert(!h.app.current(token));assert.equal(h.children.length,2);});
 await test('unchanged positive observation retains owner',async()=>{const h=fixture();await h.start();const token=h.app.capture();await h.app.refresh();assert(h.app.current(token));assert.equal(h.children.length,1);});
 await test('lease expiry exposes no authority or actions',async()=>{const h=fixture();await h.start();let release;h.read=()=>new Promise(r=>release=r);await h.advance(11000);assert.equal(h.app.getState().mode,'UNAVAILABLE');assert.equal(h.app.getState().actions,null);assert.throws(()=>h.app.assertLegacy());release(reply());await tick();});
 await test('request timeout blocks without selecting legacy',async()=>{const h=fixture();h.read=()=>new Promise(()=>{});const pending=h.app.startAuthenticated(N);await tick();await h.advance(8001);await pending;assert.equal(h.app.getState().mode,'UNAVAILABLE');});
 await test('late protocol response after logout cannot authorize',async()=>{const h=fixture();let release;h.read=()=>new Promise(r=>release=r);const pending=h.app.startAuthenticated(N);await tick();await h.app.invalidateAuth();release(reply('TARGET'));await pending;assert.equal(h.active,0);assert.equal(h.app.getState().mode,'UNAVAILABLE');});
 await test('stale previous-auth response cannot authorize new identity',async()=>{const h=fixture();let release;h.read=uid=>uid===N?new Promise(r=>release=r):reply();const old=h.app.startAuthenticated(N);await tick();await h.app.startAuthenticated(V);release(reply('TARGET'));await old;assert.equal(h.app.getState().mode,'LEGACY');assert(h.events.includes('start:LEGACY:'+V));});
 await test('teardown failure prevents a second writer',async()=>{const h=fixture();await h.start();h.failDispose=true;h.value=reply('TARGET',1,'b');await h.app.refresh();assert.equal(h.app.getState().mode,'UNAVAILABLE');assert.equal(h.children.length,1);});
 await test('slow teardown cannot renew an expired authority observation',async()=>{const h=fixture();await h.start();let release;h.children[0].dispose=()=>new Promise(r=>release=r);h.value=reply('TARGET',1,'b');const pending=h.app.refresh();await tick();await h.advance(11000);release();await pending;assert.equal(h.app.getState().mode,'UNAVAILABLE');assert.equal(h.children.length,1);});
 await test('start failure exposes neither ready view nor commands',async()=>{const h=fixture();h.failStart=true;await h.start(reply('TARGET'));assert.equal(h.app.getState().phase,'BLOCKED');assert.equal(h.app.getState().view.kind,'UNAVAILABLE');assert.equal((await h.app.action(h.app.capture(),'write')).outcome,'NOT_READY');});
 await test('target error cannot silently select legacy',async()=>{const h=fixture();await h.start(reply('TARGET'));h.value={outcome:'ERROR'};await h.app.refresh();h.value=reply();await h.app.refresh();assert.equal(h.app.getState().mode,'UNAVAILABLE');});
 await test('writes recheck protocol before dispatch',async()=>{const h=fixture();await h.start(reply('TARGET'));const token=h.app.capture();h.value=reply('READ_ONLY',1,'b');const result=await h.app.action(token,'write');assert.equal(result.outcome,'NOT_READY');assert.equal(h.active,0);});
 await test('no cache/storage/URL injection participates in decoder',async()=>{global.localStorage={getItem:()=> 'TARGET'};global.location={search:'?mode=TARGET'};const h=fixture();await h.start(reply());assert.equal(h.app.getState().mode,'LEGACY');delete global.localStorage;delete global.location;});
 console.log('PROTOCOL SESSION '+JSON.stringify({cases:count})+' PASS');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
