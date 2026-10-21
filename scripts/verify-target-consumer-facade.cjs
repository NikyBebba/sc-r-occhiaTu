#!/usr/bin/env node
'use strict';
// Synthetic RPC/session/storage only. Real TargetRuntime, controller, Core and
// projection produce every committed input. Shared checks run in Node and Safari.
function fixtureData() {
  const F = require('./fixtures/snapshot-v1.cjs');
  const clone = x => JSON.parse(JSON.stringify(x));
  const personalSeen = F.relationless(); personalSeen.personal[0].states[0].seen = true;
  personalSeen.exposure.push({person_id:F.N,movie_id:F.M,sources:['PERSONAL_SEEN']}); F.finish(personalSeen);
  const both = F.completed(); both.personal[0].states[0].seen = true; both.exposure[0].sources = ['PERSONAL_SEEN','SELECTED_GROUP_TOGETHER']; F.finish(both);
  const unavailable = F.completed(); unavailable.people[1].personal_readable = false; unavailable.personal.pop(); F.finish(unavailable);
  const activeNoCandidate = F.scheduled(); activeNoCandidate.group.states[0].effective_candidacy = false; F.finish(activeNoCandidate);
  const rewatchActive = F.rewatch(); rewatchActive.nights.push(F.night()); rewatchActive.group.states[0].rewatch_visible = false; F.finish(rewatchActive);
  const recandidate = F.completed(); Object.assign(recandidate.group.states[0],{effective_candidacy:true,list_visible:true}); F.finish(recandidate);
  const judgment = F.relationless(); judgment.personal[0].states[0].judgment = {rating:0,preference:null,review:''}; F.finish(judgment);
  const nullJudgment = F.relationless(); nullJudgment.personal[0].states[0].seen = null; nullJudgment.personal[0].states[0].judgment = null; F.finish(nullJudgment);
  const preference = F.relationless(); preference.personal[0].states[0].judgment.preference = false; F.finish(preference);
  const groupJudgment = F.completed(); groupJudgment.group.judgments.push({movie_id:F.M,rating:7.5,review:'Synthetic group review'}); F.finish(groupJudgment);
  const multipleJudgments = F.multipleEvents(); multipleJudgments.group.judgments.push({movie_id:F.M,rating:7.5,review:null}); multipleJudgments.personal[0].states[0].judgment.rating=0; F.finish(multipleJudgments);
  const metadata = F.candidate(); Object.assign(metadata.catalog[0],{title:'Synthetic search',duration:'126 min',genres:['Drama'],director:'Synthetic director',cast_names:['Synthetic actor'],release_year:2026,added_by_person_id:F.N,collection_id:'123'}); F.finish(metadata);
  const generic = F.candidate(); generic.catalog[0].surprise_by_person_id = F.V; generic.vetoes.push({veto_id:F.uid(500),person_id:F.N,movie_id:F.M,week_key:generic.temporal.week_key}); generic.group.states[0].eligibility = {match_base:false,ruota_base:false}; F.finish(generic);
  const observedList = F.otherList();
  const callerV = F.relationless(); callerV.caller.person_id = F.V; F.finish(callerV);
  return {N:F.N,V:F.V,G:F.G,M:F.M,H:F.H,NIGHT:F.NIGHT,unknown:F.uid(900009),observer:F.uid(900010),
    base:F.relationless(),personalSeen,both,unavailable,activeNoCandidate,rewatchActive,recandidate,judgment,nullJudgment,preference,groupJudgment,multipleJudgments,metadata,generic,observedList,callerV,
    personalList:F.selfList(),candidate:F.candidate(),scheduled:F.scheduled(),together:F.completed(),rewatch:F.rewatch(),multiple:F.multipleEvents(),subset:F.partialParticipants(),tomb:F.tombstones(),empty:F.emptyCatalog(),large:F.largeDecimals(),
    // Internal histories are test annotations, NEVER facade inputs. The server
    // semantic wire view is intentionally identical for these three histories.
    equivalent:['explicit','convergence-only','legacy-unattributed'].map(history => ({history,wire:clone(F.candidate())}))};
}
async function runChecks(modules,data,onCase=()=>{}) {
  const {Facade,Runtime,Core,Cache,Engine} = modules;
  let cases=0,assertions=0,parity=0,differences=0;
  const check=(ok,message)=>{if(!ok)throw Error(message);assertions++;};
  const eq=(a,b,message)=>check(a===b,message+': '+String(a)+' != '+String(b));
  const deep=(a,b,message)=>eq(JSON.stringify(a),JSON.stringify(b),message);
  const throws=(fn,message)=>{let failed=false;try{fn();}catch(_){failed=true;}check(failed,message);};
  const tick=async()=>{for(let i=0;i<64;i++)await Promise.resolve();};
  const held=[];
  async function make(raw=data.base,{cached=false,hold=false}={}) {
    const records=new Map(),jobs=[],timers=new Map();let serial=0,pendingRead=null,source=null;
    const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
    if(cached){
      const context={callerId:raw.caller.person_id,groupId:raw.selected_group.group_id,contractVersion:1,contextEpoch:1};
      const decoded=Core.decodeSnapshotEnvelope(raw,context);
      const accepted=Core.evaluateAcceptance({decoded,current:null,expectedContext:context,requestMeta:{context,requestSequence:1},latestRequestSequence:1,thresholds:null,nowInstant:raw.temporal.as_of});
      eq(accepted.outcome,'ACCEPT','cache fixture accepted');Cache.createCacheAdapter(storage).write(accepted.nextRoot,raw.temporal.as_of);
    }
    const runtime=Runtime.createTargetRuntime({auth:{async getVerifiedIdentity(){return {callerId:raw.caller.person_id};}},
      rpc:async(name,args)=>{
        if(name==='get_app_runtime_context')return {data:{bootstrap_contract_version:1,outcome:'OK',caller:{person_id:raw.caller.person_id,legacy_person:raw.caller.person_id===data.N?'N':'V'},selected_group:{group_id:raw.selected_group.group_id},protocol:{client_protocol:1,supported_protocol:1,minimum_client_protocol:1,snapshot_contract_version:1},runtime:{mode:'target',activation_allowed:true}},error:null};
        if(name==='get_person_group_snapshot'){if(hold)return new Promise(resolve=>{pendingRead=resolve;});return {data:raw,error:null};}
        throw Error('Unexpected RPC '+name);
      },clock:{nowInstant:()=>raw.temporal.as_of},scheduler:{scheduleAt(at,fn){timers.set(++serial,{at,fn});return serial;},cancel:id=>timers.delete(id)},storage:cached?storage:null,
      subscribeInvalidation:h=>{source=h;return()=>{};},enqueue:fn=>jobs.push(fn),observerRequestId:data.observer});
    held.push(runtime);
    const pump=async()=>{for(let i=0;i<12;i++){await tick();if(!jobs.length)break;for(const fn of jobs.splice(0))fn();}await tick();};
    const h={runtime,pump,bundle:observedPersonId=>Facade.createConsumerBundle(runtime.getState(),observedPersonId===undefined?{}:{observedPersonId}),
      async pending(){hold=true;source.onChange({eventType:'UPDATE',new:{scope_kind:'content',scope_id:data.M,entity_id:data.M,version:'9',tombstone:false}});await pump();check(pendingRead!==null,'pending physical request');},timers};
    await runtime.start();await pump();return h;
  }
  async function test(name,kind,fn,raw=data.base,options={}) {
    const start=held.length;
    try {const h=await make(raw,options);await fn(h);cases++;if(kind==='PARITY')parity++;else differences++;onCase(kind+' '+name);}
    finally {for(const runtime of held.splice(start))runtime.dispose();}
  }
  for(const [caller,observed] of [[data.N,data.N],[data.N,data.V],[data.V,data.N],[data.V,data.V]]) {
    await test('caller '+caller.slice(-4)+' observes '+observed.slice(-4),'INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(observed);eq(b.context.caller.personId,caller,'stable caller');eq(b.context.observedPerson.personId,observed,'separate observer');eq(h.runtime.getState().controllerState.context.callerId,caller,'read does not change authority');},caller===data.N?data.base:data.callerV);
  }
  await test('personal seen only','PARITY',h=>{const b=h.bundle();eq(b.personal.caller.seen.length,1,'seen relation');eq(b.group.togetherFilms.length,0,'no Together');eq(b.personal.caller.list.length,0,'no intention inferred');},data.personalSeen);
  await test('Together only never implies personal seen','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.counts.togetherFilms,1,'Together known');eq(b.personal.caller.seen.length,0,'no inferred seen');eq(b.personal.getState(data.N,data.M).seen,false,'state false');},data.together);
  await test('personal seen and Together coexist','PARITY',h=>{const b=h.bundle();eq(b.personal.caller.seen.length,1,'seen preserved');eq(b.counts.togetherFilms,1,'Together preserved');},data.both);
  await test('personal List independent of group','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.personal.caller.list.length,1,'personal intention');eq(b.counts.groupListFilms,0,'no candidate invented');check(!('generation' in b.personal.getState(data.N,data.M).list),'internal generation not exported');},data.personalList);
  await test('available empty personal List','INTENTIONAL TARGET DIFFERENCE',h=>{const p=h.bundle().personal.caller;eq(p.kind,'AVAILABLE','available');eq(p.counts.listFilms,0,'known zero');});
  await test('unavailable observed coverage remains explicit','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(data.V);eq(b.personal.observed.kind,'OUT_OF_COVERAGE','not empty');eq(b.personal.getState(data.V,data.M).kind,'OUT_OF_COVERAGE','judgment not null-defaulted');check(!('counts' in b.personal.observed),'no invented zero');},data.unavailable);
  await test('observed personal List independent of caller','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(data.V);eq(b.personal.observed.list.length,1,'observed List');eq(b.personal.caller.list.length,0,'caller not changed');check(!('generation' in b.personal.getState(data.V,data.M).list),'other intention token absent');},data.observedList);
  await test('absent candidacy','INTENTIONAL TARGET DIFFERENCE',h=>{const c=h.bundle().group.getCandidacy(data.M);eq(c.effectiveCandidacy,false,'E false');eq(c.listVisible,false,'L false');eq(c.actions.withdraw,null,'no withdrawal');eq(c.actions.propose,'PROPOSE_TO_GROUP','proposal presentable');});
  await test('effective visible candidacy','INTENTIONAL TARGET DIFFERENCE',h=>{const c=h.bundle().group.getCandidacy(data.M);eq(c.effectiveCandidacy,true,'E true');eq(c.listVisible,true,'L true');eq(c.actions.propose,'PROPOSE_TO_GROUP','propose even when E true');eq(c.actions.withdraw,'WITHDRAW_GROUP_CANDIDACY','group withdrawal');},data.candidate);
  await test('candidate hidden by active night','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(),c=b.group.getCandidacy(data.M);eq(c.effectiveCandidacy,true,'candidate retained');eq(c.listVisible,false,'List hidden');eq(c.activeNightIds[0],data.NIGHT,'event identity');eq(b.group.visibleList.length,0,'not alias candidacy');check(!('visibility_reason' in c),'no duplicate reason');},data.scheduled);
  await test('active night does not invent candidacy','INTENTIONAL TARGET DIFFERENCE',h=>{const c=h.bundle().group.getCandidacy(data.M);eq(c.effectiveCandidacy,false,'E false');eq(c.activeNightIds.length,1,'event retained');eq(c.actions.withdraw,null,'no fictitious withdrawal');},data.activeNoCandidate);
  await test('explicit/convergence/legacy equivalent','INTENTIONAL TARGET DIFFERENCE',async()=>{
    const values=[];for(const fixture of data.equivalent){const h=await make(fixture.wire);values.push(h.bundle().group.getCandidacy(data.M));}
    deep(values[0],values[1],'explicit equals convergence');deep(values[1],values[2],'convergence equals unattributed legacy');
    deep(Object.keys(values[0]),['kind','movieId','effectiveCandidacy','listVisible','activeNightIds','actions'],'only RC fields');
  });
  await test('suppression is not consumer genealogy','INTENTIONAL TARGET DIFFERENCE',h=>{const c=h.bundle().group.getCandidacy(data.M);eq(c.effectiveCandidacy,false,'suppressed outcome represented as false');check(!JSON.stringify(c).includes('suppres'),'no cycle/reason');});
  await test('valid proposal after old consumption','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.group.getCandidacy(data.M).effectiveCandidacy,true,'recandidacy');eq(b.counts.togetherFilms,1,'history remains');check(!JSON.stringify(b.group.getCandidacy(data.M)).includes('consum'),'no permanent consumed state');},data.recandidate);
  await test('Rewatch from approved selector','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.group.rewatch.length,1,'collection');deep(b.group.getRewatchState(data.M).state,{semantic:true,visible:true},'selector state');},data.rewatch);
  await test('Rewatch semantic survives active visibility suppression','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.group.rewatch.length,0,'hidden');deep(b.group.getRewatchState(data.M).state,{semantic:true,visible:false},'no legacy recomputation');},data.rewatchActive);
  await test('scheduled stable lifecycle and metadata','PARITY',h=>{const n=h.bundle().group.scheduledEvents[0];eq(n.event.night_id,data.NIGHT,'night UUID');eq(n.event.status,'proposed','event lifecycle');eq(n.event.time,'21:30','calendar string');eq(n.participants.length,0,'participants not assumed');},data.scheduled);
  await test('repeated Together films versus events','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.counts.togetherFilms,1,'unique film');eq(b.counts.completedEvents,2,'two experiences');eq(b.counts.scheduledEvents,1,'active separate');eq(b.group.getEventsForMovie(data.M).events.length,3,'all events retained');},data.multiple);
  await test('actual participant subset','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(),p=b.group.completedEvents[0].participants;eq(p.length,1,'subset');eq(p[0].person_id,data.N,'actual person');eq(b.counts.participantAttendances,1,'one attendance');},data.subset);
  await test('personal judgment without seen','PARITY',h=>{const s=h.bundle().personal.getState(data.N,data.M);eq(s.seen,false,'not seen');eq(s.judgment.rating,0,'zero preserved');eq(s.judgment.preference,null,'no preference invented');eq(s.judgment.review,'','empty preserved');},data.judgment);
  await test('null judgment and nullable seen remain canonical','INTENTIONAL TARGET DIFFERENCE',h=>{const s=h.bundle().personal.getState(data.N,data.M);eq(s.judgment,null,'null not a false judgment');eq(s.seen,null,'unknown not false');},data.nullJudgment);
  await test('false preference remains distinct from null','PARITY',h=>{const j=h.bundle().personal.getState(data.N,data.M).judgment;eq(j.preference,false,'explicit negative');eq(j.rating,null,'no rating inferred');},data.preference);
  await test('group judgment distinct from personal','PARITY',h=>{const b=h.bundle();eq(b.group.getJudgment(data.M).judgment.rating,7.5,'group rating');eq(b.personal.getState(data.N,data.M).judgment.rating,null,'no personal propagation');},data.groupJudgment);
  await test('absent group judgment within known coverage','PARITY',h=>{const j=h.bundle().group.getJudgment(data.M);eq(j.kind,'AVAILABLE','covered');eq(j.judgment,null,'absent canonical null');});
  await test('memories keep event identity and deterministic grouping input','PARITY',h=>{const b=h.bundle(),rows=b.memories.completedEvents;eq(new Set(rows.map(x=>x.event.night_id)).size,2,'different events');eq(rows[0].event.movie_id,rows[1].event.movie_id,'same film');check(rows.every(x=>Object.hasOwn(x.event,'date')&&Object.hasOwn(x.event,'completed_at')),'calendar inputs retained');},data.multiple);
  await test('statistics no double counts','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.statistics.togetherFilms.length,1,'one film');eq(b.statistics.completedEvents.length,2,'two events');eq(b.counts.participantAttendances,3,'three attendances, not three people');eq(b.personal.caller.counts.seenFilms,0,'exposure not Visti');},data.multiple);
  await test('Recommendation UUID presentation','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(),r=b.getRecommendationInput();eq(r.kind,'AVAILABLE','target adapter');eq(b.people.getIdentity(data.N).legacyLabel,'N','UUID maps N');eq(b.people.getIdentity(data.V).legacyLabel,'V','UUID maps V');check(Object.keys(Engine.recommend(r.input)[0].personal).includes(data.N),'engine keyed by stable UUID');},data.metadata);
  await test('unknown person never becomes V','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(data.unknown);eq(b.people.getIdentity(data.unknown).kind,'UNKNOWN','unknown explicit');eq(b.people.getIdentity(data.unknown).legacyLabel,null,'no fallback V');eq(b.personal.observed.kind,'OUT_OF_COVERAGE','no invented relations');});
  await test('Ruota target eligibility only','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.ruota.eligibleContents.length,1,'eligible target set');eq(b.ruota.eligibleContents[0].movie_id,data.M,'stable content');},data.candidate);
  await test('Together recandidacy does not enter Ruota','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.group.getCandidacy(data.M).effectiveCandidacy,true,'candidate');eq(b.ruota.eligibleContents.length,0,'eligibility stays separate');},data.recandidate);
  await test('Match domain input only','INTENTIONAL TARGET DIFFERENCE',h=>{const input=h.bundle().getMatchInput();eq(input.matchBaseIds[0],data.M,'target eligibility');check(!['session','sessions','swipes','presence','pendingMatch'].some(k=>k in input),'no Match live authority');},data.candidate);
  await test('tombstone does not become active catalog content','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(),id=data.tomb.versions.entries.find(v=>v.scope_kind==='content').entity_id;eq(b.catalog.getContent(id).kind,'NOT_IN_CATALOG','not an entity from version marker');eq(b.group.getCandidacy(id).kind,'NOT_IN_CATALOG','no tombstone action hints');eq(b.personal.getState(data.N,id).kind,'NOT_IN_CATALOG','no invented personal relation');eq(b.counts.catalogFilms,1,'retained marker does not inflate catalog');eq(b.catalog.contents.length,1,'only live content');},data.tomb);
  await test('cache stale freshness delegated','INTENTIONAL TARGET DIFFERENCE',h=>{const state=h.runtime.getState(),b=h.bundle();eq(b.freshness.source,'CACHE','cache identity');check(b.freshness.freshness===state.controllerState.freshness,'same freshness');eq(b.freshness.freshness.validatedOnline,false,'not online');eq(b.group.getCandidacy(data.M).actions.propose,'PROPOSE_TO_GROUP','hint is not write authority');},data.candidate,{cached:true,hold:true});
  await test('pending threshold delegated without second machine','INTENTIONAL TARGET DIFFERENCE',async h=>{await h.pending();const b=h.bundle();check(b.freshness.pending===h.runtime.getState().controllerState.pending,'controller owns pending');eq(b.freshness.pending.thresholds.entries[0].minimum_version,'9','exact pending requirement');});
  await test('cleared context is unavailable not false candidacy','INTENTIONAL TARGET DIFFERENCE',h=>{h.runtime.stop();const b=h.bundle();eq(b.kind,'UNAVAILABLE','no committed context');check(!('group' in b)&&!('counts' in b),'no false empty/zero');});
  await test('loading without view is unavailable','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.kind,'UNAVAILABLE','not empty catalog');eq(b.freshness.source,null,'no source');},data.base,{hold:true});
  await test('immutable isolation across bundles','PARITY',h=>{
    const b=h.bundle(),before=JSON.stringify(h.runtime.getState().controllerState.view.root.snapshot);
    throws(()=>b.catalog.contents.push({}),'collection frozen');throws(()=>{b.catalog.contents[0].title='mutated';},'content frozen');
    throws(()=>{b.group.getCandidacy(data.M).actions.withdraw=null;},'intent frozen');throws(()=>{b.context.caller.personId=data.V;},'identity frozen');
    eq(JSON.stringify(h.runtime.getState().controllerState.view.root.snapshot),before,'source unchanged');eq(h.bundle().catalog.contents[0].title,b.catalog.contents[0].title,'future read unchanged');check(Object.isFrozen(b)&&Object.isFrozen(b.group),'frozen public bundle');
  },data.candidate);
  await test('content/search metadata no legacy rows','PARITY',h=>{const c=h.bundle().catalog.getContent(data.M).content;eq(c.title,'Synthetic search','title');eq(c.director,'Synthetic director','search director');eq(c.genres[0],'Drama','genres');check(!('status' in c)&&!('seen_n' in c)&&!('in_shared_list' in c),'no synthetic legacy model');},data.metadata);
  await test('deterministic captured view','PARITY',h=>{deep(h.bundle(data.V),h.bundle(data.V),'same view/context deterministic');eq(h.bundle().context.temporal.timezone,'Europe/Rome','server temporal context');});
  await test('generic veto and surprise','PARITY',h=>{const b=h.bundle();eq(b.getVetoForMovie(data.M).veto.person_id,data.N,'stable veto person');eq(b.catalog.getContent(data.M).content.surprise_by_person_id,data.V,'content attribution');eq(b.ruota.eligibleContents.length,0,'generic eligibility');},data.generic);
  await test('empty group and catalog coverage','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle();eq(b.kind,'AVAILABLE','empty is available');eq(b.counts.catalogFilms,0,'known empty catalog');eq(b.group.visibleList.length,0,'known empty group list');},data.empty);
  await test('strict identity inputs','INTENTIONAL TARGET DIFFERENCE',h=>{throws(()=>h.bundle('N'),'N is not identity');throws(()=>h.bundle().catalog.getContent('title'),'title not identity');throws(()=>Facade.createConsumerBundle({controllerState:{}}),'mutable input rejected');});
  await test('cross-epoch mixed bundle rejected','INTENTIONAL TARGET DIFFERENCE',h=>{const state=h.runtime.getState();const bad=Object.freeze({...state,controllerState:Object.freeze({...state.controllerState,context:Object.freeze({...state.controllerState.context,contextEpoch:999})})});throws(()=>Facade.createConsumerBundle(bad),'mixed generation');});
  await test('missing presentation label remains null','INTENTIONAL TARGET DIFFERENCE',async()=>{const raw=JSON.parse(JSON.stringify(data.base));raw.people[1].legacy_person=null;const h=await make(raw);const b=h.bundle(data.V);eq(b.context.observedPerson.legacyLabel,null,'no invented name');eq(b.getRecommendationInput().kind,'LEGACY_MAPPING_UNAVAILABLE','approved adapter coverage');});
  await test('exact metadata identifier preserved','PARITY',h=>{eq(h.bundle().catalog.getContent(data.M).content.tmdb_id,'9007199254740993','no Number conversion');},data.large);
  await test('no genealogy or private generation in public data','INTENTIONAL TARGET DIFFERENCE',h=>{const json=JSON.stringify(h.bundle());for(const key of ['support_origin','support_state','autonomous_support_id','suppressed_cycle','suppression_reason','selected_support','generation','seen_n','in_shared_list'])check(!json.includes('"'+key+'"'),'hidden '+key);},data.personalList);
  await test('judgments count films, not completed experiences','PARITY',h=>{const b=h.bundle();eq(b.statistics.groupJudgments.length,1,'one group judgment despite two events');eq(b.personal.getState(data.N,data.M).judgment.rating,0,'personal opinion separate');eq(b.statistics.completedEvents.length,2,'two events preserved');},data.multipleJudgments);
  await test('nested events and selector results immutable','PARITY',h=>{const b=h.bundle();throws(()=>b.memories.completedEvents[0].participants.push({person_id:data.V}),'participants frozen');throws(()=>{b.memories.completedEvents[0].event.snack='changed';},'event frozen');throws(()=>b.group.getEventsForMovie(data.M).events.pop(),'selector array frozen');eq(h.bundle().counts.participantAttendances,1,'later bundle unchanged');},data.subset);
  await test('captured bundle stays bound after runtime clears','INTENTIONAL TARGET DIFFERENCE',h=>{const b=h.bundle(data.V),context=b.context;h.runtime.invalidateAuth();eq(h.bundle().kind,'UNAVAILABLE','new read is cleared');check(b.context===context,'captured read has fixed identity');eq(b.context.caller.personId,data.N,'never silently changes caller');eq(b.context.observedPerson.personId,data.V,'observed context retained in captured value');});
  return {cases,assertions,parity,intentionalTargetDifferences:differences};
}
module.exports={fixtureData,runChecks};
if(require.main===module)runChecks({Facade:require('../js/runtime/consumer-facade'),Runtime:require('../js/runtime/target-runtime'),Core:require('../js/snapshot/core'),Cache:require('../js/snapshot/cache'),Engine:require('../js/recommendation/core')},fixtureData(),name=>console.log('PASS '+name))
  .then(result=>console.log('Consumer facade: '+JSON.stringify(result)+' PASS; synthetic/local only.'))
  .catch(error=>{console.error(error.stack);process.exitCode=1;});
