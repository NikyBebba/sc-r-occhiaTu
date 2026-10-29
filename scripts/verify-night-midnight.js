#!/usr/bin/env node
// Clock controllato, moduli reali, mirror/SDK sintetici; nessuna rete.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
if(!process.argv.includes('--zone')){
 for(const zone of ['Europe/Rome','UTC','America/Los_Angeles'])process.stdout.write(execFileSync(process.execPath,[__filename,'--zone'],{env:{...process.env,TZ:zone},encoding:'utf8'}));
 process.exit(0);
}
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
 vm.createContext(ctx);vm.runInContext('function assertLegacyDomainAccess()'+fs.readFileSync('js/store.js','utf8').split('function assertLegacyDomainAccess()')[1],ctx);for(const file of ['js/format.js','js/store/viewing.js','js/store/movies.js','js/store/nights.js','js/ui/render/cards.js','js/ui/render/memories.js','js/ui/render/projections.js','js/ui/actions/viewing.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
 return {ctx,el};
}
let checks=0;const test=async(name,fn)=>{await fn();checks++;console.log('PASS '+process.env.TZ+': '+name);};
(async()=>{
 for(const [day,hour,minute] of [[12,23,30],[13,0,1],[13,1,30]])await test(`Due at ${day}/${hour}:${minute}, no lost workflow`,()=>{
  at(day,hour,minute);const {ctx,el}=fixture();assert(ctx.nightIsDue(ctx.movieNights[0]));ctx.renderNextMovieBox();ctx.renderScheduled();
  assert(el('nextMovieBox').innerHTML.includes('finishTogetherNightUI')||el('scheduledList').innerHTML.includes('finishTogetherNightUI'));
  assert(ctx.createMovieCard(ctx.movies[0],[]).innerHTML.includes('finishTogetherNightUI'));assert.equal(ctx.movieNights.length,1);assert.equal(ctx.movieNights[0].date,'2026-10-12');
 });
 await test('Future date and future hour never due or offered as complete',()=>{
  at(12,21,30);const {ctx,el}=fixture();assert(!ctx.nightIsDue(ctx.movieNights[0]));ctx.renderNextMovieBox();assert(!el('nextMovieBox').innerHTML.includes('finishTogetherNightUI'));
  assert(!ctx.createMovieCard(ctx.movies[0],[]).innerHTML.includes('finishTogetherNightUI'));
  ctx.movieNights[0].date='2026-10-13';assert(!ctx.nightIsDue(ctx.movieNights[0]));
 });
 await test('Reload reconstructs due event from persisted fields',()=>{
  at(12,23,30);const first=fixture();const snapshot=JSON.parse(JSON.stringify({movies:first.ctx.movies,nights:first.ctx.movieNights}));at(13,0,1);const {ctx,el}=fixture(snapshot);ctx.renderScheduled();assert(ctx.nightIsDue(ctx.movieNights[0]));assert(el('scheduledList').innerHTML.includes("finishTogetherNightUI('film', 'night')"));
 });
 await test('Manual completion after midnight preserves schedule, seen and event count',async()=>{
  at(13,1,30);const {ctx}=fixture();const before=structuredClone(ctx.movieNights[0]);await ctx.finishTogetherNightUI('film','night');
  assert.equal(ctx.movieNights.length,1);assert.equal(ctx.movieNights[0].id,before.id);assert.equal(ctx.movieNights[0].status,'completed');assert.equal(ctx.movieNights[0].date,before.date);assert.equal(ctx.movieNights[0].time,before.time);assert.equal(ctx.movieNights[0].snack,before.snack);assert.equal(ctx.movies[0].seen_n,true);assert.equal(ctx.movies[0].seen_v,false);assert.equal(ctx.movies[0].in_shared_list,false);assert(ctx.togetherSeen(ctx.movies[0]));assert.equal(ctx.movieNights[0].completed_at,new ClockDate().toISOString());
 });
 await test('Together review after completion preserves the completed event',async()=>{
  at(13,1,30);const {ctx,el}=fixture();await ctx.completeNight('film',undefined,'night');const nights=JSON.stringify(ctx.movieNights);
  ctx.addReview('film');el('reviewRating').value='8,2';el('reviewText').value='Recensione insieme';el('reviewLocation').value='Casa';await ctx.confirmReview();
  assert.equal(ctx.movies[0].seen_rating_together,8.2);assert.equal(ctx.movies[0].review_text_together,'Recensione insieme');assert.equal(JSON.stringify(ctx.movieNights),nights);assert.equal(ctx.movies[0].seen_rating_n,7.3);assert.equal(ctx.movies[0].review_text_n,'CULT');assert.equal(ctx.movies[0].seen_v,false);
 });
 await test('Cancelled/completed/skipped never due; future completion handler no-op',async()=>{
  at(13,0,1);for(const status of ['cancelled','completed','skipped']){const {ctx}=fixture();ctx.movieNights[0].status=status;assert(!ctx.nightIsDue(ctx.movieNights[0]));}
  at(12,21,30);const {ctx}=fixture();await ctx.finishTogetherNightUI('film','night');assert.equal(ctx.movieNights[0].status,'confirmed');
 });
 await test('Quick pick survives midnight with UTC confirmation instant',()=>{
  at(12,23,30);const {ctx,el}=fixture();ctx.movieNights[0].date=null;ctx.movieNights[0].time=null;ctx.movieNights[0].confirmed_at=new ClockDate().toISOString();
  at(13,0,1);assert(ctx.nightIsDue(ctx.movieNights[0]));assert.equal(ctx.tonightPick(),null);ctx.renderScheduled();assert(el('scheduledList').innerHTML.includes('Completa serata'));
 });
 await test('Old pending nights compact, upcoming hero gets priority, no timeout',()=>{
  at(13,0,1);const {ctx,el}=fixture();ctx.movieNights[0].date='2020-01-01';ctx.renderNextMovieBox();assert.equal(el('nextMovieBox').innerHTML,'');ctx.renderScheduled();assert(el('scheduledList').innerHTML.includes('DA CONCLUDERE'));
  ctx.movies.push({id:'future',title:'Prossima'});ctx.movieNights.push({id:'future-night',movie_id:'future',date:'2026-10-14',time:'20:00',status:'confirmed'});assert.equal(ctx.homeNightPick().nightId,'future-night');assert.equal(ctx.movieNights[0].status,'confirmed');
 });
 await test('Overdue cancellation remains reachable and preserves schedule/personal data',async()=>{
  at(13,1,30);const {ctx,el}=fixture();ctx.renderScheduled();assert(el('scheduledList').innerHTML.includes('cancelNightUI'));
  await ctx.cancelNight('film','night');assert.equal(ctx.movieNights[0].status,'cancelled');assert.equal(ctx.movieNights[0].date,'2026-10-12');assert.equal(ctx.movieNights[0].time,'22:30');assert.equal(ctx.movies[0].seen_n,true);assert.equal(ctx.movies[0].seen_v,false);assert.equal(ctx.movieNights.length,1);assert(!ctx.nightIsDue(ctx.movieNights[0]));
 });
 await test('Local calendar and HH:mm:ss; invalid dates never normalize into due',()=>{
  at(13,0,1);const {ctx}=fixture();assert.equal(ctx.localDateKey(new ClockDate()),'2026-10-13');assert.equal(ctx.nightStartTime(ctx.movieNights[0]),new RealDate(2026,9,12,22,30).getTime());ctx.movieNights[0].time='22:30:00';assert(ctx.nightIsDue(ctx.movieNights[0]));ctx.movieNights[0].date='2026-02-30';assert(!ctx.nightIsDue(ctx.movieNights[0]));
 });
 console.log(`Midnight ${process.env.TZ}: ${checks}/${checks} PASS; controlled clock, simulated writes`);
})().catch(error=>{console.error(error);process.exitCode=1;});
