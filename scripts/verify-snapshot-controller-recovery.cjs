#!/usr/bin/env node
'use strict';
// Shared deterministic checks run against the real CommonJS or classic modules.
// No network, real timer, application config, SDK, or database.
function fixtureData() {
  const F=require('./fixtures/snapshot-v1.cjs');
  const base=F.relationless(), ids=[F.Q,F.uid(3),F.uid(4)];
  function expanded(version='1',count=1,tombstone=false) {
    const s=F.relationless();
    for(const id of ids.slice(0,count)) {
      if(!tombstone){
        s.catalog.push({...base.catalog[0],movie_id:id});
        for(const p of s.personal)p.states.push({...JSON.parse(JSON.stringify(p.states[0])),movie_id:id});
        s.group.states.push({...JSON.parse(JSON.stringify(base.group.states[0])),movie_id:id});
      }
      s.versions.entries.push(F.version('content',id,id,version,tombstone));
    }
    return F.finish(s);
  }
  const shrunk=F.relationless();shrunk.personal=shrunk.personal.filter(p=>p.person_id===F.N);shrunk.people.find(p=>p.person_id===F.V).personal_readable=false;F.finish(shrunk);
  return {context:F.context(),base,ids,at:F.AT,expanded:expanded(),v2:expanded('2'),many:expanded('4',3),shrunk,
    tombstone:expanded('2',1,true),uuid:F.uid(900001),otherGroup:F.uid(3900),otherPerson:F.V};
}
async function runChecks(modules,data,onCase=()=>{}) {
  const {Core,Controller,Cache}=modules;
  let cases=0,assertions=0;
  const check=(ok,message)=>{if(!ok)throw Error(message);assertions++;};
  const eq=(a,b,message)=>check(a===b,message+': '+String(a)+' != '+String(b));
  const throws=(fn,message)=>{let failed=false;try{fn();}catch(_){failed=true;}check(failed,message);};
  const copy=x=>JSON.parse(JSON.stringify(x));
  const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
  const expand=(controller,requirements)=>controller.requireVersions(requirements,{coverageExpansion:true});
  const req=(version='1',index=0)=>({requestId:data.uuid,affectedVersions:[{scope_kind:'content',scope_id:data.ids[index],entity_id:data.ids[index],version}]});
  const make=(cache=false)=>{
    const reads=[],events=[],tasks=new Map(),records=new Map();let next=0,now=data.at;
    const storage={getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
    if(cache){
      const decoded=Core.decodeSnapshotEnvelope(data.base,data.context);
      const accepted=Core.evaluateAcceptance({decoded,current:null,expectedContext:data.context,requestMeta:{context:data.context,requestSequence:1},latestRequestSequence:1,thresholds:null,nowInstant:data.at});
      eq(accepted.outcome,'ACCEPT','cache seed');Cache.createCacheAdapter(storage).write(accepted.nextRoot,data.at);
    }
    const controller=Controller.createShadowController({storage:cache?storage:null,
      clock:{nowInstant:()=>now},scheduler:{scheduleAt(at,fn){tasks.set(++next,{at,fn});return next;},cancel:id=>tasks.delete(id)},
      provider:{read(args){return new Promise((resolve,reject)=>reads.push({args,resolve,reject}));}}});
    controller.setContext(data.context);controller.subscribe(e=>events.push(e));
    return {c:controller,reads,events,tasks,records,
      async ready(){controller.requestRefresh('INITIAL');await flush();reads[0].resolve(copy(data.base));await flush();eq(controller.getState().status,'READY','initial ready');},
      async reply(raw,index=reads.length-1){reads[index].resolve(copy(raw));await flush();},
      async tick(){const [id,task]=[...tasks].sort((a,b)=>a[1].at.localeCompare(b[1].at))[0];tasks.delete(id);now=task.at;task.fn();await flush();},
      state:()=>controller.getState(),close:()=>controller.dispose()};
  };
  const test=async(name,fn)=>{const h=make();try{await h.ready();await fn(h);cases++;onCase(name);}finally{h.close();}};
  const minimum=h=>h.state().pending.thresholds.entries.find(t=>t.entity_id===data.ids[0]).minimum_version;
  await test('C01 B2 generic reproducer still fail-closed',async h=>{h.c.requireVersions(req());await flush();await h.reply(data.base);eq(h.state().status,'CONTEXT_INVALID','normal missing coverage');eq(h.state().pending.thresholds,null,'normal cleared');});
  await test('C02 expansion stale first / accepted second',async h=>{
    const prior=h.state().view,commits=h.events.filter(e=>e.type==='VIEW_COMMITTED').length;
    expand(h.c,req());await flush();await h.reply(data.base);
    eq(h.state().status,'STALE','expansion stale');check(h.state().view===prior,'last coherent view');eq(minimum(h),'1','pending retained');
    eq(h.reads.length,3,'one followup');eq(h.events.filter(e=>e.type==='VIEW_COMMITTED').length,commits,'no stale commit');
    await h.reply(data.expanded);eq(h.state().status,'READY','expanded accepted');eq(h.state().pending.thresholds,null,'online clears');
    check(Core.getContent(h.state().view.root,data.ids[0])!==null,'only accepted content');
    const e=h.events.at(-1);eq(e.type,'VIEW_COMMITTED','commit once');check(e.state.view.root===h.state().view.root,'atomic root');check(e.state.view.selectors===e.state.view.projection.selectors,'atomic selectors');
    check(Object.isFrozen(e)&&Object.isFrozen(e.state),'immutable publication');
  });
  await test('C03 two absent responses stop bounded recovery',async h=>{expand(h.c,req());await flush();await h.reply(data.base);await h.reply(data.base);await flush();eq(h.reads.length,3,'no third expansion read');eq(h.state().status,'STALE','pending status');eq(minimum(h),'1','pending after exhaustion');eq([...h.tasks.values()].filter(t=>t.at<data.base.temporal.next_temporal_invalidation_at).length,0,'no retry timer');});
  await test('C04 stronger survives weaker before and during followup',async h=>{expand(h.c,req('2'));expand(h.c,req('1'));await flush();eq(minimum(h),'2','exact max');await h.reply(data.base);expand(h.c,req('1'));await h.reply(data.expanded);eq(minimum(h),'2','lower response rejected');eq(h.reads.length,3,'weak evidence no extra read');await flush();});
  await test('C05 multiple expansions coalesce',async h=>{expand(h.c,req());await flush();expand(h.c,req('1',1));expand(h.c,req('4',2));eq(h.reads.length,2,'single flight');await h.reply(data.base);eq(h.reads.length,3,'one dirty followup');await h.reply(data.many);eq(h.state().pending.thresholds,null,'all scopes satisfied');eq(h.reads.length,3,'no redundant read');});
  await test('C06 context switch / late response cannot leak',async h=>{expand(h.c,req());await flush();const before=h.reads.length;const ctx=h.c.setContext({...data.context,groupId:data.otherGroup});const state=h.state();await h.reply(data.base,1);check(h.state()===state,'old response no state write');eq(h.state().context.contextEpoch,ctx.contextEpoch,'epoch authoritative');eq(h.state().view,null,'private view cleared');eq(h.state().pending.thresholds,null,'A pending removed');eq(h.reads.length,before,'no A followup');});
  await test('C07 same identity / new epoch remains isolated',async h=>{expand(h.c,req());await flush();h.c.setContext(data.context);const state=h.state();await h.reply(data.base,1);check(h.state()===state,'old epoch does nothing');});
  await test('C08 caller switch removes requirements',async h=>{expand(h.c,req());await flush();h.c.setContext({...data.context,callerId:data.otherPerson});await h.reply(data.base,1);eq(h.state().context.callerId,data.otherPerson,'new caller');eq(h.state().pending.thresholds,null,'caller clears pending');});
  await test('C09 network failure preserves requirement and existing retry scheduler',async h=>{expand(h.c,req());await flush();h.reads[1].reject(Error('synthetic network'));await flush();eq(h.state().status,'DEGRADED','network status');eq(minimum(h),'1','network retains requirement');await h.tick();eq(h.reads.length,3,'existing scheduled retry');await h.reply(data.expanded);eq(h.state().status,'READY','network recovery');});
  await test('C10 malformed expansion rejected without mutation',async h=>{
    const before=h.state();for(const bad of [{...req(),requestId:'bad'},{...req(),affectedVersions:new Array(1)},{...req(),affectedVersions:[]},req(9007199254740992),req('01'),req('9223372036854775808')])throws(()=>expand(h.c,bad),'invalid expansion');
    check(h.state()===before,'invalid calls no state effects');eq(h.reads.length,1,'no invalid read');
    let getter=0;const accessor={get coverageExpansion(){getter++;return true;}};
    for(const options of [null,false,{},accessor,{coverageExpansion:false},{coverageExpansion:true,extra:1}])throws(()=>h.c.requireVersions(req(),options),'invalid opt-in');
    eq(getter,0,'opt-in accessor not executed');check(h.state()===before,'invalid opt-in no mutation');
  });
  await test('C11 expansion cannot bypass candidate group mismatch',async h=>{expand(h.c,req());await flush();const raw=copy(data.expanded);raw.selected_group.group_id=data.otherGroup;raw.coverage.group_id=data.otherGroup;await h.reply(raw);eq(h.state().status,'CONTEXT_INVALID','wrong group');eq(h.state().view,null,'mismatch clears sensitive view');});
  await test('C12 expansion cannot bypass contract mismatch',async h=>{expand(h.c,req());await flush();const raw=copy(data.expanded);raw.contract_version=2;await h.reply(raw);eq(h.state().status,'CONTRACT_INVALID','wrong contract');eq(h.reads.length,2,'no expansion retry for invalid contract');});
  await test('C13 authorization loss remains fail-closed',async h=>{expand(h.c,req());await flush();await h.reply({contract_version:1,outcome:'ERROR',error:{code:'UNAUTHENTICATED'}});eq(h.state().status,'AUTH_INVALID','auth loss');eq(h.state().view,null,'auth clears');eq(h.state().pending.thresholds,null,'auth clears requirement');});
  await test('C14 dispose blocks late callbacks and recovery',async h=>{expand(h.c,req());await flush();h.close();const state=h.state(),count=h.events.length;await h.reply(data.base,1);check(h.state()===state,'dispose state stable');eq(h.events.length,count,'dispose no event');eq(h.tasks.size,0,'dispose cancels timers');});
  await test('C15 publication listeners isolated / reentrancy protected',async h=>{
    let blocked=0,received=0;h.c.subscribe(()=>{try{expand(h.c,req());}catch(_){blocked++;}throw Error('listener');});h.c.subscribe(()=>received++);
    expand(h.c,req());await flush();await h.reply(data.expanded);check(blocked>0&&received>0,'observers isolated');eq(h.state().status,'READY','listener cannot roll back');
  });
  await test('C16 ordinary requirement demotes expansion on same tuple',async h=>{expand(h.c,req('2'));h.c.requireVersions(req('1'));await flush();eq(minimum(h),'2','strict still exact max');await h.reply(data.base);eq(h.state().status,'CONTEXT_INVALID','ordinary wins');});
  await test('C17 expansion cannot promote preexisting ordinary tuple',async h=>{h.c.requireVersions(req('2'));expand(h.c,req('1'));await flush();await h.reply(data.base);eq(h.state().status,'CONTEXT_INVALID','sticky strict');});
  await test('C18 mixed unknown ordinary scope cannot be hidden',async h=>{expand(h.c,req());h.c.requireVersions(req('1',1));await flush();await h.reply(data.base);eq(h.state().status,'CONTEXT_INVALID','unrelated generic remains strict');});
  await test('C19 explicit later trigger can recover after bounded exhaustion',async h=>{expand(h.c,req());await flush();await h.reply(data.base);await h.reply(data.base);h.c.requestRefresh('MANUAL');await flush();eq(h.reads.length,4,'external trigger allowed');await h.reply(data.expanded);eq(h.state().status,'READY','later manual recovers');});
  await test('C20 stronger evidence during followup yields one additional dirty batch',async h=>{expand(h.c,req());await flush();await h.reply(data.base);expand(h.c,req('2'));await h.reply(data.expanded);eq(h.reads.length,4,'new evidence one followup');await h.reply(data.v2);eq(h.state().status,'READY','v2 accepted');});
  await test('C21 tombstone satisfies through accepted Snapshot only',async h=>{expand(h.c,req('2'));await flush();await h.reply(data.tombstone);eq(h.state().status,'READY','retained marker accepted');eq(Core.getExpectedRevision(h.state().view.root,'content',data.ids[0],data.ids[0]).kind,'TOMBSTONED','tombstone authority');eq(Core.getContent(h.state().view.root,data.ids[0]),null,'no manufactured content');});
  await test('C22 existing ABC single-flight unchanged',async h=>{h.c.requestRefresh('MANUAL');await flush();h.c.requestRefresh('MANUAL');h.c.requestRefresh('MANUAL');eq(h.reads.length,2,'A only');await h.reply(data.base);eq(h.reads.length,3,'one followup');await h.reply(data.base);eq(h.reads.length,3,'no extra followup');});
  await test('C23 covered but behind expansion is bounded too',async h=>{expand(h.c,req('2'));await flush();await h.reply(data.expanded);await h.reply(data.expanded);eq(h.reads.length,3,'no repeated insufficient-version retries');eq(minimum(h),'2','behind requirement retained');});
  await test('C24 clearContext removes recovery',async h=>{expand(h.c,req());await flush();h.c.clearContext();await h.reply(data.base,1);eq(h.state().context,null,'explicit clear');eq(h.state().pending.thresholds,null,'clear removes requirements');eq(h.reads.length,2,'clear no followup');});
  await test('C25 unsupported coverage remains contract-invalid',async h=>{expand(h.c,req());await flush();const s=copy(data.expanded);s.coverage.catalog='PARTIAL';await h.reply(s);eq(h.state().status,'CONTRACT_INVALID','coverage contract');});
  await test('C26 exact bigint threshold stays string',async h=>{expand(h.c,req('9223372036854775807'));await flush();eq(minimum(h),'9223372036854775807','exact max');await h.reply(data.base);eq(minimum(h),'9223372036854775807','exact max retained');});
  await test('C28 reduced personal authorization never retains previous private view',async h=>{expand(h.c,req());await flush();await h.reply(data.shrunk);eq(h.state().status,'CONTEXT_INVALID','coverage authorization loss');eq(h.state().view,null,'sensitive prior view removed');eq(h.state().pending.thresholds,null,'authorization loss clears recovery');eq(h.reads.length,2,'no retry hides authorization loss');});
  const cached=make(true);try{
    eq(cached.state().view.source,'CACHE','cache identity');expand(cached.c,req());await flush();await cached.reply(data.base);
    eq(cached.state().view.source,'CACHE','cache cannot satisfy expansion');eq(minimum(cached),'1','cache retains threshold');await cached.reply(data.expanded);
    eq(cached.state().view.source,'ONLINE','online satisfies');eq(cached.state().pending.thresholds,null,'online clears cache pending');cases++;onCase('C27 cache cannot satisfy expansion');
  }finally{cached.close();}
  return {cases,assertions};
}
if(typeof module!=='undefined')module.exports={fixtureData,runChecks};
if(require.main===module)runChecks({Core:require('../js/snapshot/core'),Controller:require('../js/snapshot/controller'),Cache:require('../js/snapshot/cache')},fixtureData(),name=>console.log('PASS '+name))
 .then(r=>console.log('Controller recovery: '+r.cases+'/'+r.cases+' PASS; '+r.assertions+' assertions; deterministic/local only.'))
 .catch(e=>{console.error(e.stack);process.exitCode=1;});
