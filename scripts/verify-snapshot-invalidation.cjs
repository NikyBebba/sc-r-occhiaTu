#!/usr/bin/env node
'use strict';
// The same checks run against Node and real classic scripts. Synthetic only.
function fixtureData() {
  const F=require('./fixtures/snapshot-v1.cjs'),R=require('./verify-snapshot-controller-recovery.cjs').fixtureData();
  const wire=n=>{const s=F.relationless();s.versions.entries=[F.version('content',F.M,F.M,n)];return F.finish(s);};
  const expanded=JSON.parse(JSON.stringify(R.expanded));expanded.versions.entries.push(F.version('content',F.M,F.M,'4'));F.finish(expanded);
  const multi=wire('5');multi.versions.entries.push(F.version('person_film',F.N,F.M),F.version('group_film',F.G,F.M));F.finish(multi);
  const tomb=wire('8');tomb.catalog=[];tomb.personal.forEach(p=>p.states=[]);tomb.group.states=[];tomb.versions.entries[0].tombstone=true;F.finish(tomb);
  return {context:F.context(),at:F.AT,M:F.M,Q:F.Q,N:F.N,V:F.V,G:F.G,otherGroup:F.uid(3900),uuid:F.uid(910001),night:F.NIGHT,
    v4:wire('4'),v5:wire('5'),v6:wire('6'),v7:wire('7'),v9:wire('9'),expanded,multi,tomb,empty:F.emptyCatalog(),scheduled:F.scheduled()};
}
async function runChecks(modules,data,onCase=()=>{}) {
  const {Core,Controller,Cache,I}=modules;let cases=0,assertions=0;
  const check=(ok,m)=>{if(!ok)throw Error(m);assertions++;};
  const eq=(a,b,m)=>check(a===b,m+': '+String(a)+' != '+String(b));
  const throws=(fn,m)=>{let bad=false;try{fn();}catch(_){bad=true;}check(bad,m);};
  const copy=x=>JSON.parse(JSON.stringify(x));
  const drain=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
  const row=(version='5',kind='content',scope=data.M,entity=data.M,tombstone=false)=>({scope_kind:kind,scope_id:scope,entity_id:entity,version,tombstone});
  const make=async(cache=false)=>{
    const reads=[],calls=[],events=[],jobs=[],tasks=new Map(),records=new Map(),handles=[];let taskId=0,now=data.at,stops=0;
    const storage={getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
    if(cache){const decoded=Core.decodeSnapshotEnvelope(data.v7,data.context);const a=Core.evaluateAcceptance({decoded,current:null,expectedContext:data.context,requestMeta:{context:data.context,requestSequence:1},latestRequestSequence:1,thresholds:null,nowInstant:now});check(a.outcome==='ACCEPT','cache seed');Cache.createCacheAdapter(storage).write(a.nextRoot,now);}
    const c=Controller.createShadowController({storage:cache?storage:null,clock:{nowInstant:()=>now},
      scheduler:{scheduleAt(at,fn){tasks.set(++taskId,{at,fn});return taskId;},cancel:id=>tasks.delete(id)},
      provider:{read(args){return new Promise((resolve,reject)=>reads.push({args,resolve,reject}));}}});
    c.setContext(data.context);c.subscribe(e=>events.push(e));
    if(!cache){c.requestRefresh('INITIAL');await drain();reads[0].resolve(copy(data.v4));await drain();eq(c.getState().status,'READY','initial view');}
    const boundary=Object.freeze({getState:c.getState,subscribe:c.subscribe,
      requireVersions(req,options){calls.push({kind:'threshold',req,options});return c.requireVersions(req,options);},
      requestRefresh(reason){calls.push({kind:'refresh',reason});return c.requestRefresh(reason);}});
    const adapter=I.createRealtimeInvalidationAdapter({controller:boundary,enqueue:fn=>jobs.push(fn),requestId:data.uuid,
      subscribe(handle){handles.push(handle);return()=>{stops++;};}});
    const h={c,adapter,reads,calls,events,jobs,tasks,handles,state:c.getState,stops:()=>stops,
      change:r=>handles[0].onChange({eventType:'UPDATE',new:r,old:{private:'ignored'},unrelated:'not retained'}),
      async flush(){for(let i=0;jobs.length&&i<16;i++){const batch=jobs.splice(0);for(const fn of batch)fn();await drain();}await drain();eq(jobs.length,0,'finite coalescing');},
      async reply(raw,index=reads.length-1){reads[index].resolve(copy(raw));await drain();await h.flush();},
      async tick(){const [id,t]=[...tasks].sort((a,b)=>a[1].at.localeCompare(b[1].at))[0];tasks.delete(id);now=t.at;t.fn();await drain();},
      close(){adapter.dispose();c.dispose();}};return h;
  };
  const test=async(name,fn)=>{await fn();cases++;onCase(name);};
  const live=async(name,fn,cache=false)=>test(name,async()=>{const h=await make(cache);try{await fn(h);}finally{h.close();}});
  const threshold=(h,id=data.M)=>h.state().pending.thresholds?.entries.find(t=>t.entity_id===id)?.minimum_version;
  await test('N01 owned frozen exact event',()=>{const raw=row(),ctx=copy(data.context),e=I.normalizeVersionEvent(raw,ctx);check(Object.isFrozen(e)&&Object.isFrozen(e.context),'frozen');raw.version='9';ctx.groupId=data.otherGroup;eq(e.version,'5','owned version');eq(e.context.groupId,data.G,'owned context');check(!Object.isFrozen(raw),'caller not frozen');});
  await test('N02 strict Decimal and identifiers',()=>{
    for(const v of [0,1,9007199254740992,BigInt(1),null,undefined,-1,NaN,Infinity,'-1','+1','01','1e2','1.0',' 1','1 ','','9223372036854775808'])throws(()=>I.normalizeVersionEvent({...row(),version:v},data.context),'invalid revision '+String(v));
    for(const v of ['0','9007199254740993','9223372036854775807'])eq(I.normalizeVersionEvent(row(v),data.context).version,v,'exact revision');
    for(const bad of [{...row(),extra:1},{...row(),scope_kind:'match'},{...row(),scope_id:'BAD'},{...row(),entity_id:data.Q},{...row(),tombstone:1}])throws(()=>I.normalizeVersionEvent(bad,data.context),'invalid shape');
  });
  await test('N03 accessors rejected without execution',()=>{let count=0;const raw=row();Object.defineProperty(raw,'version',{enumerable:true,get(){count++;return '5';}});throws(()=>I.normalizeVersionEvent(raw,data.context),'accessor');eq(count,0,'getter untouched');});
  await live('V01 equal/lower ignored, higher ordinary',async h=>{h.change(row('4'));h.change(row('3'));await h.flush();eq(h.calls.length,0,'represented versions ignored');h.change(row('5'));await h.flush();eq(threshold(h),'5','threshold recorded');eq(h.calls[0].options,undefined,'ordinary path');eq(h.reads.length,2,'one refresh');});
  await live('V02 v5/v7/v6 and duplicate v7 coalesce to maximum',async h=>{for(const v of ['5','7','6','7'])h.change(row(v));await h.flush();eq(h.calls.length,1,'one batched submission');eq(threshold(h),'7','exact max');h.change(row('7'));h.change(row('6'));await h.flush();eq(h.calls.length,1,'pending dedupe');});
  await live('V03 version jump never reconstructs effects',async h=>{const old=h.state().view;h.change(row('9'));await h.flush();eq(threshold(h),'9','jump threshold');check(h.state().view===old,'no domain patch');await h.reply(data.v9);eq(h.state().status,'READY','authoritative snapshot');});
  await live('V04 stronger event in flight yields one dirty followup',async h=>{h.change(row('7'));await h.flush();h.change(row('9'));h.change(row('8'));await h.flush();eq(threshold(h),'9','stronger retained');eq(h.reads.length,2,'physical single-flight');await h.reply(data.v7);eq(h.reads.length,3,'one dirty followup');eq(threshold(h),'9','old response insufficient');await h.reply(data.v9);eq(h.state().pending.thresholds,null,'online satisfies');eq(h.reads.length,3,'no extra read');});
  await live('V05 stale v6 response retains v7 requirement',async h=>{h.change(row('7'));await h.flush();await h.reply(data.v6);eq(threshold(h),'7','stale response retains pending');eq(h.state().status,'STALE','not fresh');await h.tick();await h.reply(data.v7);eq(h.state().status,'READY','existing bounded retry');});
  await live('E01 new content uses explicit expansion and B2 recovery',async h=>{const old=h.state().view;h.change(row('1','content',data.Q,data.Q));await h.flush();check(h.calls[0].options.coverageExpansion===true,'explicit opt-in');await h.reply(data.v4);check(h.state().view===old,'old coherent view retained');eq(threshold(h,data.Q),'1','new requirement retained');eq(h.reads.length,3,'controller followup');await h.reply(data.expanded);eq(h.state().status,'READY','new entity accepted');check(Core.getContent(h.state().view.root,data.Q)!==null,'content only from snapshot');});
  await live('E02 two absent responses stop, reconnect can recover',async h=>{h.change(row('1','content',data.Q,data.Q));await h.flush();await h.reply(data.v4);await h.reply(data.v4);eq(h.reads.length,3,'bounded controller recovery');eq(threshold(h,data.Q),'1','pending survives');h.handles[0].onReady();await h.flush();eq(h.reads.length,4,'readiness revalidates');await h.reply(data.expanded);eq(h.state().status,'READY','eventual recovery');});
  for(const [kind,scope,entity]of [['person_film',data.N,data.Q],['group_film',data.G,data.Q],['night',data.G,data.night]])await live('E03 new relevant '+kind,async h=>{h.change(row('1',kind,scope,entity));await h.flush();check(h.calls[0].options.coverageExpansion,'unrepresented tuple expansion');});
  await live('E04 covered DEFAULT_ZERO uses Core knowledge, ordinary path',async h=>{h.change(row('1','person_film',data.N,data.M));await h.flush();eq(h.calls[0].options,undefined,'covered default ordinary');eq(threshold(h),'1','known zero upgraded');});
  await live('R01 unrelated personal/group/night ignored',async h=>{for(const [k,s]of [['person_film',data.V],['group_film',data.otherGroup],['night',data.otherGroup]])h.change(row('5',k,s,data.M));await h.flush();eq(h.calls.length,0,'no irrelevant effects');eq(h.adapter.getDiagnostics().irrelevant,3,'diagnostic only');});
  await live('T01 tombstone v8 then stale v7 never deletes locally',async h=>{const prior=h.state().view;h.change(row('8','content',data.M,data.M,true));h.change(row('7'));await h.flush();eq(threshold(h),'8','tombstone max retained');check(h.state().view===prior,'no local deletion');await h.reply(data.tomb);eq(Core.getContent(h.state().view.root,data.M),null,'snapshot determines absence');eq(Core.getExpectedRevision(h.state().view.root,'content',data.M,data.M).kind,'TOMBSTONED','marker retained');});
  await live('T02 raw DELETE ignored',async h=>{h.handles[0].onChange({eventType:'DELETE',old:row('8')});await h.flush();eq(h.calls.length,0,'no raw delete semantics');eq(h.adapter.getDiagnostics().unsupported,1,'diagnosed');});
  await live('B01 multiple scopes from one command batched',async h=>{h.change(row('5'));h.change(row('1','person_film',data.N,data.M));h.change(row('1','group_film',data.G,data.M));await h.flush();eq(h.calls.length,1,'one grouped ordinary submission');eq(h.calls[0].req.affectedVersions.length,3,'three tuples');eq(h.reads.length,2,'not per-event fetch');check(h.calls[0].req.affectedVersions.every(e=>Object.keys(e).length===4),'raw row metadata discarded');await h.reply(data.multi);eq(h.state().pending.thresholds,null,'one snapshot satisfies all');});
  await live('B02 mixed ordinary/expansion remains single-flight',async h=>{h.change(row('5'));h.change(row('1','content',data.Q,data.Q));await h.flush();eq(h.calls.length,2,'two semantic batches');eq(h.reads.length,2,'one physical read');await h.reply(data.v5);eq(h.reads.length,3,'at most one followup');});
  await live('L01 initial readiness always revalidates, repeated ready dedupes',async h=>{h.handles[0].onReady();h.handles[0].onReady();h.handles[0].onReady();await h.flush();eq(h.calls.length,1,'one readiness call');eq(h.calls[0].reason,'INVALIDATION','initial reason');eq(h.reads.length,2,'readiness not freshness');});
  await live('L02 initial snapshot/establishment mutation recovered without event',async h=>{h.handles[0].onReady();await h.flush();await h.reply(data.v7);eq(Core.getExpectedRevision(h.state().view.root,'content',data.M,data.M).version,'7','missed establishment mutation recovered');});
  await live('L03 event plus ready in one batch needs no separate refresh',async h=>{h.change(row('7'));h.handles[0].onReady();await h.flush();eq(h.calls.length,1,'readiness coalesced with threshold');eq(threshold(h),'7','event preserved');});
  await live('L04 READY while initial read in flight yields post-ready followup',async h=>{h.c.requestRefresh('MANUAL');await drain();h.handles[0].onReady();await h.flush();eq(h.reads.length,2,'one in flight');await h.reply(data.v4);eq(h.reads.length,3,'post-ready read');await h.reply(data.v7);eq(Core.getExpectedRevision(h.state().view.root,'content',data.M,data.M).version,'7','blind window recovered');});
  await live('L05 disconnect/unseen change/reconnect recovers',async h=>{h.handles[0].onReady();await h.flush();await h.reply(data.v4);h.handles[0].onDisconnected();h.handles[0].onReady();h.handles[0].onReady();await h.flush();eq(h.calls.at(-1).reason,'RECONNECT','reconnect reason');await h.reply(data.v9);eq(Core.getExpectedRevision(h.state().view.root,'content',data.M,data.M).version,'9','unseen change recovered');});
  await live('L06 reconnect preserves stronger observed threshold',async h=>{h.change(row('9'));await h.flush();h.handles[0].onReady();await h.flush();eq(threshold(h),'9','ready preserves max');h.handles[0].onDisconnected();h.handles[0].onReady();await h.flush();eq(threshold(h),'9','reconnect preserves max');eq(h.reads.length,2,'no competing scheduler');});
  await live('C01 context switch detaches, late A callbacks inert',async h=>{const old=h.handles[0];h.c.setContext({...data.context,groupId:data.otherGroup});const state=h.state();old.onChange({eventType:'UPDATE',new:row('9')});old.onReady();await h.flush();check(h.state()===state,'A cannot affect B');eq(h.stops(),1,'subscription detached');});
  await live('C02 queued A event cannot strengthen B',async h=>{h.change(row('9'));h.c.setContext({...data.context,callerId:data.V});const state=h.state();await h.flush();check(h.state()===state,'queued old event inert');eq(h.calls.length,0,'no old call');});
  await live('C03 old read response cannot publish into B',async h=>{h.change(row('9'));await h.flush();h.c.setContext({...data.context,groupId:data.otherGroup});const state=h.state();await h.reply(data.v9,1);check(h.state()===state,'old response inert');eq(h.state().pending.thresholds,null,'A threshold removed');});
  await live('C04 dispose/unsubscribe idempotent and late callbacks inert',async h=>{h.change(row('7'));h.adapter.dispose();h.adapter.dispose();h.handles[0].onReady();await h.flush();eq(h.calls.length,0,'disposed queue inert');eq(h.stops(),1,'exact unsubscribe');});
  await live('F01 malformed row does not alter pending or context',async h=>{const prior=h.state();h.change(row(7));h.change({...row(),secret:'not allowed'});let getter=0;h.handles[0].onChange({eventType:'UPDATE',get new(){getter++;return row();}});await h.flush();check(h.state()===prior,'malformed no state changes');eq(getter,0,'payload getter untouched');eq(h.adapter.getDiagnostics().malformed,3,'malformed diagnosed');});
  await live('F02 network failure preserves requirement; reconnect retries',async h=>{h.change(row('7'));await h.flush();h.reads[1].reject(Error('synthetic'));await drain();eq(threshold(h),'7','network keeps pending');h.handles[0].onReady();await h.flush();await h.reply(data.v7);eq(h.state().status,'READY','online recovery');});
  await live('K01 cache equal version cannot satisfy invalidation',async h=>{eq(h.state().view.source,'CACHE','cached source');h.change(row('7'));await h.flush();eq(threshold(h),'7','cache not proof');eq(h.reads.length,1,'online validation started');eq(h.state().view.source,'CACHE','not promoted early');await h.reply(data.v7);eq(h.state().view.source,'ONLINE','accepted online');},true);
  await live('P01 policy rejects unowned events and old context',async h=>{const jobs=[],policy=I.createInvalidationPolicy({controller:h.c,enqueue:fn=>jobs.push(fn),requestId:data.uuid});throws(()=>policy.accept({...row(),context:data.context}),'unowned event');const event=I.normalizeVersionEvent(row(),{...data.context,contextEpoch:99});eq(policy.accept(event),'INACTIVE','epoch-bound');eq(jobs.length,0,'no wrong epoch effects');policy.dispose();});
  await live('P02 enqueue must defer, no nested controller mutation',async h=>{const policy=I.createInvalidationPolicy({controller:h.c,enqueue:fn=>fn(),requestId:data.uuid});throws(()=>policy.accept(I.normalizeVersionEvent(row(),data.context)),'synchronous enqueue refused');eq(h.reads.length,1,'no sync fetch');policy.dispose();});
  await live('P03 later explicit snapshot read recovers missed event',async h=>{h.c.requestRefresh('MANUAL');await drain();await h.reply(data.v9);eq(Core.getExpectedRevision(h.state().view.root,'content',data.M,data.M).version,'9','missed event never corrupts domain');});
  return {cases,assertions};
}
module.exports={fixtureData,runChecks};
if(require.main===module)runChecks({Core:require('../js/snapshot/core'),Controller:require('../js/snapshot/controller'),Cache:require('../js/snapshot/cache'),I:require('../js/snapshot/invalidation')},fixtureData(),name=>console.log('PASS '+name))
 .then(r=>console.log('Snapshot invalidation: '+r.cases+'/'+r.cases+' PASS; '+r.assertions+' assertions; deterministic/local only.'))
 .catch(e=>{console.error(e.stack);process.exitCode=1;});
