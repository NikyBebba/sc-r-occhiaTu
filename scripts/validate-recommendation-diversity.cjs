// Paired experiment on the unchanged seven fixtures. No network or private data.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,metrics,run}=require('./benchmark-recommendation-ranking-v2.cjs');
const Adapter=require('../js/recommendation/adapters'),Bridge=require('../js/recommendation/ranking-v2-input'),Core=require('../js/recommendation/ranking-v2');
const variants={withoutDiversity:{config:{diversityPenalty:0}},current:Core.experiments.legacyV1,constrained:Core.experiments.constrainedV1};
function validate(){const original=run(),stored=require('../docs/RECOMMENDATION_CORE_V2_BENCHMARK.json');assert.deepEqual(original,stored,'Original benchmark must reproduce exactly');
 const scenarios=original.scenarios.map(s=>{const {movies,truth}=fixture(s.name),input=Bridge.fromProjection(Adapter.fromMovies({movies,userIds:{N:'a',V:'b'},constraints:{context:'all'}})),before=JSON.stringify(input),outputs={};
 for(const [name,options] of Object.entries(variants))outputs[name]=Core.recommend({...input,...options});
 assert.equal(JSON.stringify(input),before);const baseline=outputs.current;
 const results=Object.fromEntries(Object.entries(outputs).map(([name,r])=>{assert.deepEqual(r.ranked,baseline.ranked,'Scoring must be identical');assert.deepEqual(r.excluded,baseline.excluded,'Eligibility must be identical');
   assert.deepEqual(r,Core.recommend({...input,...variants[name],candidates:[...input.candidates].reverse()}));
   const next=Core.recommend({...input,...variants[name],shownIds:r.nextShownIds});const repeats=next.batch.filter(c=>r.nextShownIds.includes(c.id)).length;assert.equal(repeats,0);
   if(name==='constrained')for(const row of r.batch)assert.ok(row.batch.relevanceLoss<=r.config.relevanceWindow+1e-12);
   const first=metrics(r.batch,truth,repeats),relevanceSum=r.batch.reduce((sum,c)=>sum+c.score,0);
   return [name,{...first,relevanceSum,top5UniqueCollections:new Set(r.batch.flatMap(c=>c.features.collection)).size,top5:r.batch.map((c,i)=>({position:i+1,id:c.id,relevancePosition:r.ranked.findIndex(x=>x.id===c.id)+1,score:c.score,penalty:c.batch.diversityPenalty,finalPosition:i+1,expectedRating:truth[c.id],binaryRelevant:truth[c.id]>=7,personal:Object.fromEntries(Object.entries(c.personal).map(([id,p])=>[id,p.affinity])),referenceScore:c.batch.referenceScore??null,relevanceLoss:c.batch.relevanceLoss??null}))}];}));
 return {name:s.name,candidateCount:baseline.ranked.length,results};});
 const sensitivity=[0,.01,.02,.04,.08,.15].map(window=>({window,scenarios:original.scenarios.map(s=>{const {movies,truth}=fixture(s.name),input=Bridge.fromProjection(Adapter.fromMovies({movies,userIds:{N:'a',V:'b'},constraints:{context:'all'}})),r=Core.recommend({...input,diversityVersion:'near-relevance-v1',config:{relevanceWindow:window}});return {name:s.name,...metrics(r.batch,truth,0)};})}));
 return {experimentVersion:'diversity-validation-v1',baselineReproduced:true,fixturesUnchanged:true,eligibilityAndScoringIdentical:true,window:.02,scenarios,sensitivity};}
if(require.main===module){const report=validate(),json=JSON.stringify(report,null,2)+'\n';if(process.argv.includes('--write'))fs.writeFileSync('docs/RECOMMENDATION_DIVERSITY_VALIDATION.json',json);process.stdout.write(json);}
module.exports={validate};
