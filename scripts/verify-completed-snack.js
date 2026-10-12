#!/usr/bin/env node
// Snack completed: SDK e mirror simulati, nessuna rete o scrittura reale.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const RealDate=Date;let clock;
class ClockDate extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
const at=(day,hour,minute)=>{clock=new RealDate(2026,9,day,hour,minute).getTime();};
function fixture(snapshot=null){
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',className:'',dataset:{},classList:{contains:()=>true,add(){},remove(){},toggle(){}},setAttribute(){},focus(){},addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null});return elements.get(id);};
 const ctx={Date:ClockDate,console,authEpoch:1,currentUser:'N',currentTab:'all',dashboardView:'home',sb:null,
  movies:snapshot?.movies||[{id:'film',title:'Film della serata',status:'tonight',in_shared_list:true,seen_n:true,seen_v:false,seen_rating_n:7.3,review_text_n:'CULT'}],
  movieNights:snapshot?.nights||[{id:'night',movie_id:'film',date:'2026-10-12',time:'22:30',status:'confirmed',proposed_by:'N',snack:'Popcorn',location:'Casa',created_at:new RealDate(2026,9,12,18).toISOString()}],
  document:{getElementById:el,createElement:()=>({innerHTML:'',addEventListener(){},querySelectorAll:()=>[]}),querySelectorAll:()=>[]},
  CONFIG:{PEOPLE:{N:{label:'N'},V:{label:'V'}}},requireAppIdentity(){},assertAuthEpoch(){},handleDataAuthError(){},isAppAuthorized:()=>true,
  escapeHtml:String,jsAttrEscape:String,personBadge:()=>'',sagaButtonHtml:()=>'',isVetoed:false,
  vetoForMovieThisWeek:()=>null,loadMovies:async()=>{},saveLocal(){},openModal(){},closeModal(){},closeModalNow(){},suggestSagaAfterViewing(){},showActionError(message){throw Error(message);}
 };
 vm.createContext(ctx);for(const file of ['js/format.js','js/store/viewing.js','js/store/movies.js','js/store/nights.js','js/ui/render/cards.js','js/ui/render/memories.js','js/ui/render/projections.js','js/ui/actions/viewing.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
 return {ctx,el};
}
let checks=0;const test=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
(async()=>{
 at(13,1,30);
 const snap=ctx=>JSON.parse(JSON.stringify({movies:ctx.movies,nights:ctx.movieNights}));
 for(const person of ['N','V'])await test(person+': local completed A→B→NULL→A changes only snack',async()=>{
  const {ctx}=fixture();ctx.currentUser=person;await ctx.completeNight('film',undefined,'night');
  for(const snack of ['B',null,'A']){const before=snap(ctx);assert(await ctx.updateMovieNight('night',{snack}));before.nights[0].snack=snack;assert.deepEqual(snap(ctx),before);}
 });
 await test('SDK sends snack-only edit; preserves location, film and event identity',async()=>{
  const {ctx}=fixture();ctx.movieNights[0].status='completed';const before=snap(ctx);let calls=[];
  ctx.sb={rpc:async(name,args)=>{calls.push({name,args});return {data:{...ctx.movieNights[0],snack:args.p_snack},error:null};}};
  assert(await ctx.updateMovieNight('night',{snack:null}));assert.equal(calls.length,1);const a=calls[0].args;
  assert.equal(calls[0].name,'manage_movie_night');assert.equal(a.p_action,'edit');assert.equal(a.p_set_location,false);assert.equal(a.p_location,null);assert.equal(a.p_date,null);assert.equal(a.p_time,null);assert.equal(a.p_shared_rating,null);assert.equal(a.p_shared_text,null);assert.equal(a.p_movie_id,'film');assert.equal(a.p_night_id,'night');before.nights[0].snack=null;assert.deepEqual(snap(ctx),before);
 });
 await test('Location adapter preserves snack and current review contract',async()=>{
  const {ctx}=fixture();ctx.movieNights[0].status='completed';const before=snap(ctx);let args;
  ctx.sb={rpc:async(name,a)=>{args=a;return {data:{...ctx.movieNights[0],location:a.p_location},error:null};}};
  assert(await ctx.updateMovieNight('night',{location:'Terrazza'}));assert.equal(args.p_snack,'Popcorn');assert.equal(args.p_set_location,true);before.nights[0].location='Terrazza';assert.deepEqual(snap(ctx),before);
 });
 await test('Protected patches, mixed shared payload and snack limit reject without mutation',async()=>{
  const {ctx}=fixture();ctx.movieNights[0].status='completed';const before=snap(ctx);
  for(const key of ['movie_id','status','date','time','completed_at','proposed_by','seen_n','seen_rating_together'])assert.equal(await ctx.updateMovieNight('night',{snack:'B',[key]:'bad'}),false);
  for(const extra of [{date:'2030-01-01'},{time:'22:30'},{sharedRating:9},{sharedText:'bad'},{snack:'x'.repeat(81)}])assert.equal(await ctx.manageMovieNight('edit','film','night',{snack:'B',...extra}),null);
  assert.deepEqual(snap(ctx),before);
 });
 await test('RPC rejection cannot become local success',async()=>{
  const {ctx}=fixture();ctx.movieNights[0].status='completed';const before=snap(ctx);ctx.console={error(){}};ctx.sb={rpc:async()=>({data:null,error:{message:'COMPLETED_SNACK_FROZEN'}})};
  assert.equal(await ctx.updateMovieNight('night',{snack:'B'}),false);assert.deepEqual(snap(ctx),before);
 });
 await test('Cancelled/skipped remain closed',async()=>{
  for(const status of ['cancelled','skipped']){const {ctx}=fixture();ctx.movieNights[0].status=status;const before=snap(ctx);assert.equal(await ctx.updateMovieNight('night',{snack:'B'}),false);assert.deepEqual(snap(ctx),before);}
 });
 for(const [label,patch] of [['snack only',{snack:'B'}],['location only',{location:'Terrazza'}],['both',{snack:'B',location:'Terrazza'}],['clear',{snack:null}]])await test('N+V form '+label+': single edit RPC, unchanged movie',async()=>{
  const {ctx,el}=fixture();ctx.movieNights[0].status='completed';ctx.movies[0].seen_rating_together=8.2;ctx.movies[0].review_text_together='Together';const before=snap(ctx);const calls=[];
  ctx.sb={rpc:async(name,args)=>{calls.push({name,args});return {data:{...ctx.movieNights[0],snack:args.p_snack,...(args.p_set_location?{location:args.p_location}:{})},error:null};}};
  ctx.addReview('film');assert.equal(el('reviewSnack').value,'Popcorn');
  if(Object.hasOwn(patch,'snack'))el('reviewSnack').value=patch.snack||'';
  if(Object.hasOwn(patch,'location'))el('reviewLocation').value=patch.location;
  await ctx.confirmReview();assert.equal(calls.length,1);const a=calls[0].args;assert.equal(a.p_action,'edit');assert.equal(a.p_set_location,Object.hasOwn(patch,'location'));assert.equal(a.p_shared_rating,null);assert.equal(a.p_shared_text,null);assert.equal(a.p_date,null);assert.equal(a.p_time,null);Object.assign(before.nights[0],patch);assert.deepEqual(snap(ctx),before);
 });
 await test('Review night selection prefills both snack and location',()=>{
  const {ctx,el}=fixture();ctx.movieNights[0].status='completed';ctx.movieNights.push({...ctx.movieNights[0],id:'rewatch',snack:null,location:'Cinema'});ctx.addReview('film');el('reviewNightSelect').value='rewatch';ctx.selectReviewNight();assert.equal(el('reviewNightId').value,'rewatch');assert.equal(el('reviewSnack').value,'');assert.equal(el('reviewLocation').value,'Cinema');
 });
 await test('Initial Together completion saves edited snack without duplicating night',async()=>{
  const {ctx,el}=fixture();ctx.addReview('film');el('reviewRating').value='8,2';el('reviewSnack').value='Pizza';el('reviewLocation').value='Cinema';await ctx.confirmReview();assert.equal(ctx.movieNights.length,1);assert.equal(ctx.movieNights[0].status,'completed');assert.equal(ctx.movieNights[0].snack,'Pizza');assert.equal(ctx.movieNights[0].location,'Cinema');assert.equal(ctx.movieNights[0].date,'2026-10-12');assert.equal(ctx.movies[0].seen_n,true);assert.equal(ctx.movies[0].seen_v,false);assert.equal(ctx.movies[0].seen_rating_together,8.2);
 });
 await test('Unscheduled Together creation supports snack on complete_now',async()=>{
  const {ctx,el}=fixture();ctx.movieNights=[];ctx.addReview('film');el('reviewRating').value='8,2';el('reviewSnack').value='Pizza';await ctx.confirmReview();assert.equal(ctx.movieNights.length,1);assert.equal(ctx.movieNights[0].status,'completed');assert.equal(ctx.movieNights[0].snack,'Pizza');
 });
 console.log(`Completed snack SDK/mirror: ${checks}/${checks} PASS`);
})().catch(error=>{console.error(error);process.exitCode=1;});
