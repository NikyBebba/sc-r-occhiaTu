#!/usr/bin/env node
'use strict';
// Synthetic RPC/session boundaries; actual runtime/transport/controller/Core and
// ConsumerFacade. This is not a replacement for the server writer DB suite.
function fixtureData() {
  const F=require('./fixtures/snapshot-v1.cjs');
  const raw=F.scheduled();raw.catalog.push(F.content(F.Q));raw.group.states.push(F.groupState(F.Q));for(const p of raw.personal)p.states.push(F.personalState(F.Q));F.finish(raw);
  const afterSeen=JSON.parse(JSON.stringify(raw));afterSeen.personal[0].states[0].seen=true;afterSeen.versions.entries.find(v=>v.scope_kind==='person_film').version='2';F.finish(afterSeen);
  const matrix=[
    ['addToMyList',[F.M],'ADD_PERSONAL_LIST',{},['person_film']],
    ['removeFromMyList',[F.M],'REMOVE_PERSONAL_LIST',{},['person_film']],
    ['recordSeen',[F.M],'RETROSPECTIVE_SEEN',{},['person_film']],
    ['removeSeen',[F.M],'REMOVE_PERSONAL_SEEN',{},['person_film']],
    ['recordPersonalViewing',[F.M,{satisfyCurrentIntention:true}],'NEW_PERSONAL_VIEWING',{generation:'1'},['person_film']],
    ['setMyRating',[F.M,0],'PERSONAL_RATING',{value:0},['person_film']],
    ['setMyPreference',[F.M,false],'PERSONAL_PREFERENCE',{value:false},['person_film']],
    ['setMyReview',[F.M,''],'PERSONAL_REVIEW',{value:''},['person_film']],
    ['proposeToGroup',[F.M],'PROPOSE_TO_GROUP',{},['group_film']],
    ['withdrawGroupCandidacy',[F.M],'WITHDRAW_GROUP_CANDIDACY',{},['group_film']],
    ['setGroupRating',[F.M,0],'TOGETHER_RATING',{value:0},['group_film']],
    ['setGroupReview',[F.M,''],'TOGETHER_REVIEW',{value:''},['group_film']],
    ['scheduleNight',[F.M,{date:'2027-01-05',time:'21:30'}],'SCHEDULE_NIGHT',{date:'2027-01-05',time:'21:30'},[]],
    ['quickNight',[F.M],'QUICK_NIGHT',{},[]],
    ['confirmNight',[F.NIGHT],'CONFIRM_NIGHT',{night_id:F.NIGHT},['night']],
    ['cancelNight',[F.NIGHT],'CANCEL_NIGHT',{night_id:F.NIGHT},['night']],
    ['editNight',[F.NIGHT,{snack:null,location:'Synthetic place'}],'EDIT_NIGHT',{night_id:F.NIGHT,snack:null,location:'Synthetic place'},['night']],
    ['completeScheduled',[F.NIGHT,{participants:[F.N]}],'COMPLETE_NIGHT',{participants:[F.N],night_id:F.NIGHT},['night']],
    ['completeNow',[F.M,{participants:[F.V]}],'COMPLETE_NOW',{participants:[F.V]},[]],
    ['setMyEvaluation',[F.M,{rating:0,review:''}],'SET_PERSONAL_EVALUATION',{rating:0,review:''},['person_film']],
    ['recordSeen',[F.M,{preference:false}],'RECORD_PERSONAL_SEEN_WITH_EVALUATION',{preference:false},['person_film']],
    ['setGroupEvaluation',[F.M,{rating:null,review:''}],'SET_TOGETHER_EVALUATION',{rating:null,review:''},['group_film']],
    ['completeScheduled',[F.NIGHT,{participants:[F.N],snack:null,evaluation:{rating:8}}],'COMPLETE_NIGHT_WITH_CONTEXT',{snack:null,participants:[F.N],evaluation:{rating:8}},['night','group_film']],
    ['completeNow',[F.M,{participants:[F.V],location:null,evaluation:{review:''}}],'COMPLETE_NOW_WITH_CONTEXT',{location:null,participants:[F.V],evaluation:{review:''}},['group_film']],
    ['addVeto',[F.M],'VETO_ADD',{expected_week_key:raw.temporal.week_key},['group_film']],
    ['removeVeto',[F.M,F.uid(600)],'VETO_REMOVE',{veto_id:F.uid(600),expected_week_key:raw.temporal.week_key},['group_film']],
    ['createContent',[{title:'Synthetic new',tmdb_id:'9007199254740993'}],'CONTENT_CREATE',{title:'Synthetic new',tmdb_id:'9007199254740993'},[]],
    ['updateMetadata',[F.M,{overview:null,genres:['Drama',null]}],'CONTENT_UPDATE_METADATA',{overview:null,genres:['Drama',null]},['content']],
    ['setSurprise',[F.M,true],'CONTENT_SET_SURPRISE',{enabled:true},['content']],
    ['setCinema',[F.M,false],'CONTENT_SET_CINEMA',{value:false},['content']],
    ['deleteContent',[F.M],'CONTENT_DELETE',{},['content']]
  ];
  return {N:F.N,V:F.V,G:F.G,M:F.M,Q:F.Q,NIGHT:F.NIGHT,otherGroup:F.uid(3999),observer:F.uid(980001),ids:Array.from({length:20},(_,i)=>F.uid(980100+i)),raw,afterSeen,large:F.largeDecimals(),matrix};
}
async function runChecks(modules,data,onCase=()=>{}) {
  const {Adapter,Runtime,Facade,Core}=modules;let cases=0,assertions=0;
  const check=(ok,msg)=>{if(!ok)throw Error(msg);assertions++;};
  const eq=(a,b,msg)=>check(a===b,msg+': '+String(a)+' != '+String(b));
  const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const deep=(a,b,msg)=>eq(stable(a),stable(b),msg);
  const copy=x=>JSON.parse(JSON.stringify(x));
  const tick=async()=>{for(let i=0;i<64;i++)await Promise.resolve();};
  async function make(raw=data.raw,caller=data.N) {
    const calls=[],reads=[],handles=[],jobs=[],timers=new Map(),ids=[];let timerId=0;
    const host={caller,group:data.G,commandHandler:null,notReady:false};
    const adapt=wire=>{const s=copy(wire);s.caller.person_id=host.caller;s.selected_group.group_id=host.group;s.coverage.group_id=host.group;for(const v of s.versions.entries)if(['group_film','night'].includes(v.scope_kind))v.scope_id=host.group;for(const p of s.personal)if(p.person_id!==host.caller)for(const item of p.states)item.list.generation=null;return s;};
    const initial=adapt(raw);
    const runtime=Runtime.createTargetRuntime({auth:{async getVerifiedIdentity(){return {callerId:host.caller};}},
      rpc(name,args){
        if(name==='get_app_runtime_context')return Promise.resolve({data:{bootstrap_contract_version:1,outcome:'OK',caller:{person_id:host.caller,legacy_person:host.caller===data.N?'N':'V'},selected_group:{group_id:host.group},protocol:{client_protocol:1,supported_protocol:1,minimum_client_protocol:1,snapshot_contract_version:1},runtime:{mode:'target',activation_allowed:true}},error:null});
        if(name==='get_person_group_snapshot'){
          if(!reads.length){reads.push({initial:true});return Promise.resolve({data:initial,error:null});}
          return new Promise((resolve,reject)=>reads.push({args,resolve,reject}));
        }
        if(name==='execute_app_command'){
          if(host.commandHandler){calls.push({request:args.p_request});return host.commandHandler(args.p_request);}
          return new Promise((resolve,reject)=>calls.push({request:args.p_request,resolve,reject}));
        }
        throw Error('Unexpected RPC '+name);
      },clock:{nowInstant:()=>raw.temporal.as_of},scheduler:{scheduleAt(at,fn){timers.set(++timerId,{at,fn});return timerId;},cancel:id=>timers.delete(id)},subscribeInvalidation:h=>{handles.push(h);return()=>{};},enqueue:fn=>jobs.push(fn),observerRequestId:data.observer});
    const pump=async()=>{for(let i=0;i<16;i++){await tick();if(!jobs.length)break;for(const fn of jobs.splice(0))fn();}await tick();};
    await runtime.start();await pump();eq(runtime.getState().phase,'READY','real runtime ready');
    const adapter=Adapter.createActionAdapter({runtime,newRequestId:()=>{const id=data.ids[ids.length];ids.push(id);return id;}});
    const h={runtime,adapter,host,calls,reads,handles,ids,pump,adapt,ctx:adapter.captureContext(),
      bundle:observedPersonId=>Facade.createConsumerBundle(runtime.getState(),{observedPersonId:observedPersonId??host.caller}),
      wire(index=calls.length-1){return calls[index].request;},
      respond(outcome='SUCCESS',extra={},index=calls.length-1){const c=calls[index];const common={protocol_version:1,request_id:c.request.request_id,outcome};
        const body=['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(outcome)?{...common,replayed:false,result:{movie_id:data.M,night_id:null},affected_versions:[],...extra}:outcome==='STALE'?{...common,current_versions:[],...extra}:outcome==='ERROR'?{...common,error:{code:'VALIDATION_ERROR'},...extra}:{...common,...extra};c.resolve({data:body,error:null});},
      async action(method,args=[],outcome='SUCCESS',extra={}){const p=adapter[method](h.ctx,...args);await pump();check(calls.length>0,'command dispatched');h.respond(outcome,extra);const r=await p;await pump();return r;},
      async reply(raw,index=reads.length-1){reads[index].resolve({data:adapt(raw),error:null});await pump();},
      close(){adapter.dispose();runtime.dispose();}
    };return h;
  }
  async function test(name,fn,raw=data.raw,caller=data.N){const h=await make(raw,caller);try{await fn(h);cases++;onCase(name);}finally{h.close();}}
  for(const [method,args,intent,parameters,scopes] of data.matrix)await test('CONTRACT '+intent,async h=>{
    const before=h.bundle(),result=await h.action(method,args),wire=h.wire();
    eq(wire.intent,intent,'canonical intent');deep(wire.parameters,parameters,'exact parameters');
    deep(wire.expected_versions.map(v=>v.scope_kind).sort(),[...scopes].sort(),'required scope set');
    for(const v of wire.expected_versions){eq(typeof v.version,'string','exact revision');if(v.scope_kind==='person_film')eq(v.scope_id,h.host.caller,'caller scope');}
    eq(result.outcome,'SUCCESS','server result preserved');eq(wire.protocol_version,1,'approved protocol');
    eq(h.calls.length,1,'one public command');check(before.catalog.contents===h.bundle().catalog.contents,'no local state patch');
  });
  for(const caller of [data.N,data.V])await test('observing other person uses caller '+caller.slice(-4),async h=>{
    const other=caller===data.N?data.V:data.N,b=h.bundle(other);eq(b.context.observedPerson.personId,other,'observed context');
    for(const [method,args] of [['addToMyList',[data.Q]],['recordSeen',[data.Q]],['setMyEvaluation',[data.Q,{preference:false}]]]){
      await h.action(method,args);eq(h.wire().expected_versions[0].scope_id,caller,'not observed person');check(!('person' in h.wire().parameters)&&!('caller_id' in h.wire().parameters),'server derives identity');
    }
  },data.raw,caller);
  await test('patch zero false empty null omission preserved',async h=>{
    for(const patch of [{rating:0},{preference:false},{review:''},{rating:null,review:null},{preference:null},{}]){await h.action('setMyEvaluation',[data.M,patch]);deep(h.wire().parameters,patch,'no defaults/coercion');}
    check(!('seen' in h.wire().parameters),'judgment never implies seen');
  });
  await test('invalid evaluation cannot send',async h=>{for(const patch of [{rating:11},{rating:'0'},{rating:0,preference:null},{review:undefined},{personId:data.V},{preference:0}]){const r=await h.adapter.setMyEvaluation(h.ctx,data.M,patch);eq(r.outcome,'INVALID_INPUT','invalid patch');}eq(h.calls.length,0,'no RPC');eq(h.ids.length,0,'no identity generated');});
  await test('new viewing selects only explicit caller intention',async h=>{await h.action('recordPersonalViewing',[data.M]);deep(h.wire().parameters,{},'no inferred satisfaction');await h.action('recordPersonalViewing',[data.M,{satisfyCurrentIntention:false}]);deep(h.wire().parameters,{},'no generation');await h.action('recordPersonalViewing',[data.M,{satisfyCurrentIntention:true}]);eq(h.wire().parameters.generation,'1','captured own generation');});
  await test('missing intention never synthesized',async h=>{eq((await h.adapter.recordPersonalViewing(h.ctx,data.Q,{satisfyCurrentIntention:true})).outcome,'INVALID_INPUT','missing generation');eq(h.calls.length,0,'no guessed generation');});
  await test('propose when E false or true, withdrawal not caller owned',async h=>{for(const [method,id] of [['proposeToGroup',data.Q],['proposeToGroup',data.M],['withdrawGroupCandidacy',data.M],['withdrawGroupCandidacy',data.Q]]){await h.action(method,[id]);deep(h.wire().parameters,{},'no owner/provenance/cycle');eq(h.wire().target.group_id,data.G,'current group');}});
  await test('candidate selection is explicit and exact',async h=>{await h.action('scheduleNight',[data.M,{date:'2027-01-05',selectCandidate:true}]);eq(h.wire().parameters.expected_candidate_revision,'1','captured group CAS');eq(h.wire().expected_versions[0].scope_kind,'group_film','selection scope');await h.action('quickNight',[data.M]);deep(h.wire().expected_versions,[],'no inferred selection');check(!('select_candidate' in h.wire().parameters),'omission preserved');});
  await test('completion never infers participants',async h=>{for(const participants of [undefined,[],['N'],[data.N,data.N]]){const r=await h.adapter.completeNow(h.ctx,data.M,{participants});eq(r.outcome,'INVALID_INPUT','explicit valid participants required');}eq(h.calls.length,0,'no automatic N+V');});
  await test('participant input canonicalized without mutation',async h=>{const participants=[data.V,data.N],p=h.adapter.completeNow(h.ctx,data.M,{participants});participants.pop();await h.pump();deep(h.wire().parameters.participants,[data.N,data.V],'owned sorted participants');h.respond();await p;eq(participants.length,1,'caller array not frozen or edited');});
  await test('completion no local seen or List satisfaction',async h=>{const before=h.bundle(),p=h.adapter.completeScheduled(h.ctx,data.NIGHT,{participants:[data.N]});await h.pump();h.respond('SUCCESS',{},0);await p;eq(h.bundle().personal.caller.counts.listFilms,before.personal.caller.counts.listFilms,'intention not locally satisfied');eq(h.bundle().personal.getState(data.N,data.M).seen,false,'no personal seen');eq(h.bundle().group.completedEvents.length,0,'no local Together');});
  await test('completion context with no evaluation uses night CAS only',async h=>{await h.action('completeScheduled',[data.NIGHT,{participants:[data.N],location:null,snack:''}]);eq(h.wire().intent,'COMPLETE_NIGHT_WITH_CONTEXT','context composite');deep(h.wire().expected_versions.map(x=>x.scope_kind),['night'],'no unrelated CAS');});
  await test('event editing and opinion are independent results',async h=>{const a=await h.action('editNight',[data.NIGHT,{snack:null}]);const b=await h.action('setGroupEvaluation',[data.M,{review:'Synthetic'}],'STALE');eq(a.outcome,'SUCCESS','event success');eq(b.outcome,'STALE','opinion separate');eq(h.calls.length,2,'not one fake atomic command');});
  await test('content create cannot inject relations',async h=>{for(const field of ['seen_n','status','in_shared_list','participants','group_id','added_by']){const r=await h.adapter.createContent(h.ctx,{title:'Synthetic',[field]:true});eq(r.outcome,'INVALID_INPUT','relation rejected '+field);}eq(h.calls.length,0,'no injection');});
  await test('metadata exact IDs and allowlist',async h=>{await h.action('updateMetadata',[data.M,{tmdb_id:'9223372036854775807',collection_id:'-9223372036854775808'}]);eq(h.wire().parameters.tmdb_id,'9223372036854775807','exact ID');for(const tmdb_id of [9007199254740992,1n,'01','9223372036854775808'])eq((await h.adapter.updateMetadata(h.ctx,data.M,{tmdb_id})).outcome,'INVALID_INPUT','unsafe metadata ID');eq(h.calls.length,1,'only valid request');});
  await test('content input defensive nested copy',async h=>{const input={title:'Synthetic',genres:['Drama']},p=h.adapter.createContent(h.ctx,input);input.title='Changed';input.genres.push('Changed');await h.pump();eq(h.wire().parameters.title,'Synthetic','title captured');deep(h.wire().parameters.genres,['Drama'],'array captured');check(!Object.isFrozen(input.genres),'caller data not frozen');h.respond();await p;});
  await test('veto uses Snapshot week not device time',async h=>{await h.action('addVeto',[data.M]);eq(h.wire().parameters.expected_week_key,data.raw.temporal.week_key,'Snapshot temporal week');await h.action('removeVeto',[data.M,data.ids[10]]);eq(h.wire().parameters.veto_id,data.ids[10],'observed veto identity retained');});
  await test('Saga and bulk are per-film autonomous actions',async h=>{const a=await h.action('proposeToGroup',[data.M]);const b=await h.action('proposeToGroup',[data.Q],'ERROR',{error:{code:'FORBIDDEN'}});eq(a.outcome,'SUCCESS','first film retained');eq(b.outcome,'ERROR','second result explicit');eq(h.calls.length,2,'no aggregate or fallback command');});
  await test('Recommendation Ruota Match shared CTA use common methods',async h=>{for(const origin of ['Recommendation','Ruota','Match']){await h.action('quickNight',[data.M]);eq(h.wire().intent,'QUICK_NIGHT','same semantic command '+origin);deep(h.wire().parameters,{},'no origin authority');}check(!['swipe','startMatch','acknowledgeMatch','closeMatch'].some(k=>k in h.adapter),'no Match session methods');});
  await test('SUCCESS only visible after accepted Snapshot',async h=>{const before=h.bundle(),p=h.adapter.recordSeen(h.ctx,data.M);await h.pump();h.respond('SUCCESS',{affected_versions:[{scope_kind:'person_film',scope_id:data.N,entity_id:data.M,version:'2'}]});const result=await p;await h.pump();eq(result.outcome,'SUCCESS','command success');eq(h.bundle().personal.caller.seen.length,0,'not yet visible');check(h.runtime.getState().controllerState.pending.thresholds!==null,'runtime threshold');eq(h.reads.length,2,'own write refresh without Realtime');await h.reply(data.afterSeen);eq(h.bundle().personal.caller.seen.length,1,'visible from accepted Snapshot');eq(before.personal.caller.seen.length,0,'old immutable bundle intact');});
  await test('own command plus duplicate Realtime threshold harmless',async h=>{const p=h.adapter.recordSeen(h.ctx,data.M);await h.pump();h.respond('SUCCESS',{affected_versions:[{scope_kind:'person_film',scope_id:data.N,entity_id:data.M,version:'2'}]});await p;await h.pump();for(let i=0;i<2;i++)h.handles[0].onChange({eventType:'UPDATE',new:{scope_kind:'person_film',scope_id:data.N,entity_id:data.M,version:'2',tombstone:false}});await h.pump();eq(h.reads.length,2,'no duplicate reads');await h.reply(data.afterSeen);eq(h.bundle().personal.caller.counts.seenFilms,1,'one coherent effect');});
  await test('ALREADY is not an invented mutation',async h=>{const r=await h.action('addToMyList',[data.M],'ALREADY_IN_TARGET_STATE');eq(r.outcome,'ALREADY_IN_TARGET_STATE','no-op preserved');eq(h.reads.length,1,'empty vector no extra read');});
  await test('STALE refreshes but never writes again',async h=>{const r=await h.action('addToMyList',[data.M],'STALE');eq(r.outcome,'STALE','stale surfaced');eq(h.calls.length,1,'no blind write retry');eq(h.ids.length,1,'one request');eq(h.reads.length,2,'runtime revalidation');});
  await test('REQUEST_ID_REUSE fails closed',async h=>{const r=await h.action('addToMyList',[data.M],'REQUEST_ID_REUSE');eq(r.outcome,'REQUEST_ID_REUSE','reuse category');eq((await h.adapter.retry(r)).outcome,'INVALID_INPUT','no eligible retry handle');eq(h.calls.length,1,'no replacement');eq(h.ids.length,1,'no new UUID');});
  await test('uncertain exact retry one logical effect',async h=>{
    let receipt=null,effects=0;h.host.commandHandler=async body=>{if(!receipt){receipt=body;effects++;throw Error('Synthetic loss after commit');}check(body===receipt,'same prepared object');return {data:{protocol_version:1,request_id:body.request_id,outcome:'SUCCESS',replayed:true,result:{movie_id:data.M,night_id:null},affected_versions:[]},error:null};};
    const patch={rating:0},first=await h.adapter.setMyEvaluation(h.ctx,data.M,patch);await h.pump();patch.rating=9;
    eq(first.outcome,'TRANSPORT_UNCERTAIN','uncertainty surfaced');check(Object.isFrozen(first.retryHandle),'owned frozen retry');
    await h.reply(data.afterSeen);eq(Core.getExpectedRevision(h.runtime.getState().controllerState.view.root,'person_film',data.N,data.M).version,'2','new committed version before retry');
    const second=await h.adapter.retry(first.retryHandle);eq(second.outcome,'SUCCESS','replay');eq(second.replayed,true,'server receipt replay');eq(h.calls[0].request,h.calls[1].request,'same body, not rebuilt');eq(receipt.parameters.rating,0,'no new parameters');eq(h.ids.length,1,'no regenerated ID');eq(effects,1,'one logical server effect');
    eq(receipt.expected_versions[0].version,'1','retry does not adopt fresh CAS');
    eq((await h.adapter.retry(first.retryHandle)).outcome,'RETRY_NOT_ALLOWED','successful action cannot retry');
  });
  await test('auth failure disposes runtime and blocks later action',async h=>{const p=h.adapter.recordSeen(h.ctx,data.M);await h.pump();h.calls[0].resolve({data:null,error:{status:401}});eq((await p).outcome,'AUTH_INVALIDATING','auth category');eq(h.runtime.getState().controllerState.view,null,'sensitive view cleared');eq((await h.adapter.addToMyList(h.ctx,data.M)).outcome,'AUTH_INVALIDATING','old capture blocked');eq(h.calls.length,1,'no fallback');});
  await test('semantic maintenance error preserved after runtime clear',async h=>{const r=await h.action('proposeToGroup',[data.M],'ERROR',{error:{code:'MAINTENANCE'}});eq(r.outcome,'ERROR','semantic error retained');eq(r.error.code,'MAINTENANCE','code retained');eq(h.runtime.getState().phase,'BLOCKED','runtime owns lifecycle');});
  await test('context switch during command makes late result inert',async h=>{const p=h.adapter.recordSeen(h.ctx,data.M);await h.pump();h.host.group=data.otherGroup;await h.runtime.start();await h.pump();h.respond('SUCCESS',{affected_versions:[{scope_kind:'person_film',scope_id:data.N,entity_id:data.M,version:'2'}]});eq((await p).outcome,'OBSOLETE','old result');eq(h.runtime.getState().controllerState.pending.thresholds,null,'no old threshold');await h.reply(data.raw);eq(h.bundle().context.groupId,data.otherGroup,'new view');eq((await h.adapter.proposeToGroup(h.ctx,data.M)).outcome,'OBSOLETE','old winner/capture cannot act');eq(h.calls.length,1,'no old-context new command');});
  await test('dispose during command cannot apply or retry',async h=>{const p=h.adapter.recordSeen(h.ctx,data.M);await h.pump();h.adapter.dispose();h.respond();eq((await p).outcome,'OBSOLETE','disposed result inert');eq((await h.adapter.addToMyList(h.ctx,data.M)).outcome,'OBSOLETE','disposed capture');});
  await test('immutable output cannot change runtime',async h=>{const r=await h.action('setMyEvaluation',[data.M,{review:''}]);let throws=0;for(const fn of [()=>{r.outcome='SUCCESS_PATCHED';},()=>{r.context.callerId=data.V;},()=>{r.result.movie_id=data.Q;}])try{fn();}catch(_){throws++;}eq(throws,3,'frozen nested result');eq(h.runtime.getState().controllerState.context.callerId,data.N,'runtime identity intact');check(Object.isFrozen(h.adapter),'public API frozen');});
  await test('foreign capture rejected and no generic writer exposed',async h=>{eq((await h.adapter.recordSeen(Object.freeze({...h.ctx}),data.M)).outcome,'INVALID_INPUT','owned capture required');check(!('executeIntent' in h.adapter)&&!('rpc' in h.adapter),'UI semantic API only');eq(h.calls.length,0,'no bypass');});
  await test('exact revisions from Core, not UI versions',async h=>{await h.action('addToMyList',[data.M]);eq(h.wire().expected_versions[0].version,'9223372036854775807','exact bigint CAS');},data.large);
  await test('strict night inputs and missing tokens fail locally',async h=>{for(const [method,args] of [['scheduleNight',[data.M,{date:'2027-01-05',time:'25:00'}]],['quickNight',[data.M,{date:'2027-01-05'}]],['editNight',[data.NIGHT,{evaluation:{rating:8}}]],['completeNow',[data.M,{participants:[data.N],selectCandidate:'true'}]],['quickNight',[null]]])eq((await h.adapter[method](h.ctx,...args)).outcome,'INVALID_INPUT','invalid explicit night shape');eq(h.calls.length,0,'no malformed calls');});
  await test('completion selection plus evaluation has one group CAS',async h=>{await h.action('completeNow',[data.M,{participants:[data.N],selectCandidate:true,evaluation:{rating:0,review:null}}]);eq(h.wire().intent,'COMPLETE_NOW_WITH_CONTEXT','real composite');eq(h.wire().expected_versions.length,1,'one shared scope');eq(h.wire().parameters.expected_candidate_revision,'1','selection revision exact');});
  await test('server owns participant membership and content protection',async h=>{const p=await h.action('completeNow',[data.M,{participants:[data.ids[9]]}],'ERROR',{error:{code:'VALIDATION_ERROR'}});eq(p.outcome,'ERROR','server membership refusal');const d=await h.action('deleteContent',[data.M],'ERROR',{error:{code:'CONTENT_PROTECTED'}});eq(d.error.code,'CONTENT_PROTECTED','server protection refusal');eq(h.bundle().counts.catalogFilms,2,'no local delete');});
  await test('retry after context change never rebuilds request',async h=>{const p=h.adapter.recordSeen(h.ctx,data.M);await h.pump();h.calls[0].reject(Error('uncertain'));const first=await p;await h.pump();h.host.group=data.otherGroup;await h.runtime.start();await h.pump();eq((await h.adapter.retry(first.retryHandle)).outcome,'OBSOLETE','old logical request cannot cross context');eq(h.calls.length,1,'no retry RPC');eq(h.ids.length,1,'no replacement identity');});
  await test('duplicate concurrent retry has one physical mutation call',async h=>{const p=h.adapter.recordSeen(h.ctx,data.M);await h.pump();h.calls[0].reject(Error('uncertain'));const first=await p;await h.pump();const a=h.adapter.retry(first.retryHandle),b=h.adapter.retry(first.retryHandle);await h.pump();eq(h.calls.length,2,'original plus one retry');h.respond('SUCCESS',{replayed:true});eq((await a).replayed,true,'first waiter replay');eq((await b).replayed,true,'second waiter same replay');});
  await test('runtime NOT_READY retained without adapter permission engine',async h=>{h.runtime.requestRefresh();await h.pump();h.reads.at(-1).resolve({data:{malformed:true},error:null});await h.pump();eq((await h.adapter.addToMyList(h.ctx,data.M)).outcome,'NOT_READY','runtime rejects invalid read contract');eq(h.calls.length,0,'no writer fallback');});
  await test('unavailable night token cannot become zero CAS',async h=>{const r=await h.adapter.confirmNight(h.ctx,data.NIGHT);eq(r.outcome,'INVALID_INPUT','missing token fails closed');eq(h.calls.length,0,'no CAS guess');},(()=>{const raw=copy(data.raw);raw.versions.entries=raw.versions.entries.filter(v=>v.scope_kind!=='night');raw.versions.unavailable_night_ids=[data.NIGHT];raw.coverage.counts.version_entries--;raw.coverage.counts.night_tokens_unavailable=1;return raw;})());
  await test('context handle cannot supply observed authority or mutable versions',async h=>{const ctx=h.adapter.captureContext();check(Object.isFrozen(ctx),'capture frozen');eq(ctx.callerId,data.N,'caller UUID');check(!('observedPersonId' in ctx),'no observed identity authority');const r=await h.adapter.setMyEvaluation(ctx,data.M,{expected_versions:[]});eq(r.outcome,'INVALID_INPUT','UI cannot replace CAS');});
  return {cases,assertions,canonicalIntents:data.matrix.length};
}
module.exports={fixtureData,runChecks};
if(require.main===module)runChecks({Adapter:require('../js/runtime/action-adapter'),Runtime:require('../js/runtime/target-runtime'),Facade:require('../js/runtime/consumer-facade'),Core:require('../js/snapshot/core')},fixtureData(),name=>console.log('PASS '+name))
  .then(result=>console.log('Action adapter: '+JSON.stringify(result)+' PASS; synthetic/local only.'))
  .catch(error=>{console.error(error.stack);process.exitCode=1;});
