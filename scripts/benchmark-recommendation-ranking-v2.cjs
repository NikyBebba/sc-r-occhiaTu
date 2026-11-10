// Synthetic offline comparison; no network, private snapshots, or source mutations.
const fs=require('node:fs');const assert=require('node:assert/strict');
const Adapter=require('../js/recommendation/adapters'),Old=require('../js/recommendation/core'),Core=require('../js/recommendation/ranking-v2'),Bridge=require('../js/recommendation/ranking-v2-input');
const genre=['Drama','Comedy','Thriller','Adventure'];
function fixture(name){const train=Array.from({length:40},(_,i)=>({id:'train-'+String(i).padStart(2,'0'),title:'Training '+i,in_shared_list:false,genres:[genre[i%4]],director:'Director '+i%5,cast_names:['Actor '+i%7],duration:(90+i%4*20)+' min',release_year:1980+i%4*10,collection_id:name==='franchise'?1+i%2:null,
 seen_rating_n:name==='cold'?null: i%4===0?9:i%4===2?3:7,
 seen_rating_v:name==='cold'||name==='imbalanced'&&i>2?null:name==='opposed'?(i%4===0?2:i%4===2?9:6):(i%4===0?8:i%4===2?4:7)}));
 const candidates=Array.from({length:20},(_,i)=>({id:'candidate-'+String(i).padStart(2,'0'),title:'Candidate '+i,in_shared_list:true,genres:[genre[i%4]],director:'Director '+i%5,cast_names:['Actor '+i%7],duration:(90+i%4*20)+' min',release_year:1980+i%4*10,collection_id:name==='franchise'?1+i%2:null}));
 if(name==='sparse')for(let i=0;i<candidates.length;i+=2){candidates[i].genres=[];candidates[i].director=null;candidates[i].cast_names=null;candidates[i].duration=null;candidates[i].release_year=null;}
 // Truth is held outside the projection. Both persons' candidate judgments are hidden.
 const truth=Object.fromEntries(candidates.map((c,i)=>[c.id,name==='narrow'?(i%4===0?9:3):Math.min(i%4===0?9:i%4===2?3:7,name==='opposed'?(i%4===0?2:i%4===2?9:6):(i%4===0?8:i%4===2?4:7))]));
 candidates.push({id:'known-negative',title:'Known negative',in_shared_list:true,genres:['Drama'],seen_rating_n:1,seen_rating_v:9,seen_rating_together:10});
 return {movies:[...train,...candidates],truth};}
const dcg=xs=>xs.reduce((s,x,i)=>s+(2**(x>=7?1:0)-1)/Math.log2(i+2),0);
function metrics(rows,truth,repeat){const ids=rows.map(r=>r.id||r.movieId),relevant=Object.values(truth).filter(v=>v>=7).length,ideal=dcg(Array(Math.min(5,relevant)).fill(7));
 return {ndcg5:ideal?dcg(ids.slice(0,5).map(id=>truth[id]||0))/ideal:null,recall5:relevant?ids.slice(0,5).filter(id=>truth[id]>=7).length/relevant:null,
 top5UniqueGenres:new Set(rows.slice(0,5).flatMap(r=>r.features.genre)).size,top5UniqueDirectors:new Set(rows.slice(0,5).flatMap(r=>r.features.director)).size,
 repeatedAcrossBatches:repeat,top5:ids.slice(0,5)};}
function run(){const scenarios=[];
for(const name of ['balanced','imbalanced','opposed','cold','sparse','franchise','narrow']){
 const {movies,truth}=fixture(name),projection=Adapter.fromMovies({movies,userIds:{N:'a',V:'b'},constraints:{context:'all'}}),input=Bridge.fromProjection(projection),rawNew=Core.recommend(input),rawOld=Old.recommend(projection);
 const excluded=new Set(rawNew.excluded.map(r=>r.id)),commonOld=rawOld.filter(r=>!excluded.has(r.movieId)),commonNew=rawNew.ranked;
 assert.deepEqual(new Set(commonOld.map(r=>r.movieId)),new Set(commonNew.map(r=>r.id)));
 const oldFirst=Old.rerank(commonOld,5),oldSecond=Old.rerank(commonOld.filter(r=>!oldFirst.some(a=>a.movieId===r.movieId)),5),newFirst=rawNew.batch,newSecond=Core.recommend({...input,shownIds:rawNew.nextShownIds}).batch;
 const repeated=(one,two)=>two.filter(r=>one.some(x=>(x.id||x.movieId)===(r.id||r.movieId))).length;
 const perm={...input,candidates:[...input.candidates].reverse()};assert.deepEqual(rawNew,Core.recommend(perm));
 const known=new Set(movies.filter(m=>m.id.startsWith('train')).map(m=>m.id));known.add('known-negative');
 const reasonRefs=rawNew.ranked.flatMap(r=>r.reasons).flatMap(r=>r.evidenceMovieIds);assert.ok(reasonRefs.every(id=>known.has(id)));
 const perturb=Core.recommend({...input,candidates:[...input.candidates,{id:'irrelevant',features:{},inSharedList:false}]});assert.deepEqual(perturb.batch,rawNew.batch);
 const coverageNew=commonNew.filter(r=>Object.values(r.personal).every(p=>p.state==='INFERRED'||p.state==='OBSERVED')).length;
 const coverageOld=commonOld.filter(r=>Object.values(r.personal).every(p=>['INFERRED','OBSERVED'].includes(p.state))).length;
 scenarios.push({name,candidateCount:commonNew.length,old:metrics(oldFirst,truth,repeated(oldFirst,oldSecond)),core2:metrics(newFirst,truth,repeated(newFirst,newSecond)),
 coverage:{old:coverageOld,core2:coverageNew,note:'Evidence-state coverage, not calibrated predictive confidence'},negativeProtection:{oldOrdinaryPoolContainsKnownNegative:rawOld.some(r=>r.movieId==='known-negative'),core2OrdinaryPoolContainsKnownNegative:rawNew.ranked.some(r=>r.id==='known-negative')},reasonEvidenceReferencesValid:true,inputPermutationStable:true,irrelevantCandidateStable:true});
}
const report={syntheticOnly:true,seed:'closed-form-fixtures-v1',commonEligibility:true,judgmentsHidden:true,scenarios,limitations:['Seven deterministic scenarios, no statistical accuracy claim.','Synthetic truth correlates with genres; favors any content model and is not real-user validation.','Narrow changes the held-out taste distribution: deliberately measures the cost of diversification.','Franchise v75 caps at one per collection and returns two rows; Core 2 uses soft penalties and fills five.','Cold-start NDCG differences reflect tie-breaking, not learned quality.','State coverage definitions differ; neither is calibrated.','No API calls; API cost is zero and retrieval performance is outside this milestone.','Reason checks establish factual references, not usefulness to people.']};
return report;}
if(require.main===module){const json=JSON.stringify(run(),null,2)+'\n';if(process.argv.includes('--write'))fs.writeFileSync('docs/RECOMMENDATION_CORE_V2_BENCHMARK.json',json);process.stdout.write(json);}
module.exports={fixture,metrics,run};
