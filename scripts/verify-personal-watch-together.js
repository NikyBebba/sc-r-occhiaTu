#!/usr/bin/env node
'use strict';
// Real application modules, synthetic SDK; no network or live writes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const makeEl=()=>({value:'',classList:{contains:()=>true,add(){},remove(){}}});
const context={console,movies:[],movieNights:[],currentUser:'N',authEpoch:1,document:{getElementById:()=>makeEl()},CONFIG:{PEOPLE:{N:{label:'N'},V:{label:'V'}}},calls:[],loads:0,errors:[],saveLocal(){},requireAppIdentity(){},assertAuthEpoch(){},handleDataAuthError(){},loadMovies:async()=>{context.loads++;},closeModalNow(){},showActionError:m=>context.errors.push(m),openModal(){throw Error('TOGETHER_MUST_NOT_OPEN_RATING_MODAL');},escapeHtml:String,jsAttrEscape:String};
context.sb={from(table){
 assert.equal(table,'movies');
 return {update(patch){
  context.calls.push(structuredClone(patch));
  return {eq(column,id){
   assert.equal(column,'id');
   return {select:async()=>{
    Object.assign(context.movies.find(m=>m.id===id),patch);
    return {data:[{id}],error:null};
   }};
  }};
 }};
}};
vm.createContext(context);
// Load the real authority guards added after the historical component fixture.
vm.runInContext(fs.readFileSync('js/store.js','utf8').split('function assertLegacyDomainAccess()')[1].replace(/^/, 'function assertLegacyDomainAccess()'),context);
for(const file of ['js/format.js','js/store/viewing.js','js/store/movies.js','js/ui/render/cards.js','js/ui/actions/viewing.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
const fixtures=[{tmdb_id:74308,title:'Detachment'},{tmdb_id:1248832,title:'Digger'},{tmdb_id:4247,title:'Scary Movie',seen_rating_n:7.3,review_text_n:'CULT'}];
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
(async()=>{
 for(const person of ['N','V'])for(const fixture of fixtures){
  const movie={id:'fixture-'+fixture.tmdb_id,status:'watched',seen_n:false,seen_v:false,in_shared_list:false,added_by:'V',seen_rating_n:null,seen_rating_v:8.1,review_text_n:null,review_text_v:'Preservare V',seen_rating_together:9.2,review_text_together:'Preservare Together',...fixture};
  context.movies=[movie];context.movieNights=[{id:'night',movie_id:movie.id,status:'completed',date:'2026-10-01',completed_at:'2026-10-01T21:00:00Z'}];context.currentUser=person;context.calls=[];
  const before=structuredClone(movie),nights=structuredClone(context.movieNights);const own='seen_'+person.toLowerCase();
  test(`${fixture.title} ${person}: valid independent Together and personal state`,()=>{assert.deepEqual(JSON.parse(JSON.stringify(context.viewingState(movie))),{N:false,V:false,together:true});assert(context.personalWatchButtonHtml(movie).includes('markSeenUI'));assert.equal((context.viewingStatusHtml(movie).match(/is-together/g)||[]).length,2);});
  await context.markSeenUI(movie.id);
  test(`${fixture.title} ${person}: UI sends only own seen=true and preserves every other field/event`,()=>{assert.deepEqual(context.calls,[{[own]:true}]);assert.deepEqual(movie,{...before,[own]:true});assert.deepEqual(context.movieNights,nights);assert(context.personalWatchButtonHtml(movie).includes('undoSeenUI'));assert.equal((context.viewingStatusHtml(movie).match(/is-together/g)||[]).length,2);});
  await context.undoMovieSeen(movie.id,person);
  test(`${fixture.title} ${person}: undo sends only own seen=false; ratings/reviews/completed survive`,()=>{assert.deepEqual(context.calls[1],{[own]:false});assert.deepEqual(movie,before);assert.deepEqual(context.movieNights,nights);assert(context.personalWatchButtonHtml(movie).includes('markSeenUI'));});
 }
 test('surprise masking still hides personal action',()=>{context.currentUser='N';assert.equal(context.personalWatchButtonHtml({id:'secret',surprise_by:'V',seen_n:false}),'');});
 test('no personal flag derived from global watched status alone',()=>{context.movieNights=[];assert.deepEqual(JSON.parse(JSON.stringify(context.viewingState({status:'watched',seen_n:false,seen_v:false}))),{N:false,V:false,together:false});});
 const path='db-exports/personal-watch-together/live-cases.json';
 if(fs.existsSync(path)){const live=JSON.parse(fs.readFileSync(path));for(const m of live.movies)test('read-only live snapshot: '+m.title,()=>{context.movieNights=live.movie_nights;assert(context.togetherSeen(m));assert.equal(m.seen_n,false);assert.equal(m.seen_v,false);context.currentUser='N';assert(context.personalWatchButtonHtml(m).includes('markSeenUI'));context.currentUser='V';assert(context.personalWatchButtonHtml(m).includes('markSeenUI'));});}
 assert.equal(context.errors.length,0);console.log(`${checks}/${checks} PASS; all writes simulated.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
