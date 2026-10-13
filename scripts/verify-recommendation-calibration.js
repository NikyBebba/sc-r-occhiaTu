#!/usr/bin/env node
// Reproducible synthetic sanity comparison; historical baseline read from Git, no live I/O.
const fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process'),assert=require('node:assert/strict');
const E=require('../js/recommendation/core'),A=require('../js/recommendation/adapters');
const baseline='635f17e2b2e03c5386f0b0e446aeb3e4923ee474';
const sandbox=vm.createContext({});
for(const f of ['config','core','adapters'])vm.runInContext(cp.execFileSync('git',['show',baseline+':js/recommendation/'+f+'.js'],{encoding:'utf8'}),sandbox);
const old=vm.runInContext('({E:RecommendationEngine,A:RecommendationAdapters})',sandbox);
const seed=20261013;let randomState=seed;
const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
const movies=Array.from({length:437},(_,i)=>({id:'synthetic-'+String(i).padStart(3,'0'),title:'Synthetic '+i,in_shared_list:i>=389,seen_n:i<355,seen_v:i<12,
 genres:['Genre '+Math.floor(random()*6)],director:'Director '+Math.floor(random()*8),cast_names:['Actor '+Math.floor(random()*12)],duration:[90,110,130,160][Math.floor(random()*4)]+' min',release_year:1980+Math.floor(random()*5)*10,collection_id:i%8===0?1+i%3:null}));
for(let i=0;i<20;i++)movies[i].seen_rating_n=[4.5,6,8,9.5][i%4];
for(let i=25;i<32;i++)movies[i].seen_rating_v=[5.4,6.5,7,9][i%4];
for(let i=35;i<38;i++)movies[i].seen_rating_together=[6,8,9][i-35];
for(let i=389;i<437;i++)if(i%7===0){delete movies[i].genres;delete movies[i].director;delete movies[i].cast_names;delete movies[i].duration;delete movies[i].release_year;}
const summary=rows=>{const conf=p=>rows.map(r=>r.personal[p].confidence),covered=p=>rows.filter(r=>r.personal[p].score!==null).length;
 return {coverageN:covered('N'),coverageV:covered('V'),meanConfidenceN:conf('N').reduce((a,b)=>a+b,0)/rows.length,meanConfidenceV:conf('V').reduce((a,b)=>a+b,0)/rows.length};};
const top=(rows,k=10)=>rows.slice(0,k).map(r=>r.movieId);
const report={seed,baseline,model:E.configuration().modelVersion,syntheticOnly:true,scenarios:[]};
let previous=null;
for(const [n,v] of [[0,0],[25,5],[50,10],[100,20],[200,20]]){
 const data=structuredClone(movies);
 for(let i=0;i<n;i++)data[50+i].personal_liked_n=i%5!==0;
 for(let i=0;i<v;i++)data[270+i].personal_liked_v=i%3!==0;
 const input={movies:data,asOf:'2026-10-13T08:30:34.517Z'};
 const before=old.E.recommend(old.A.fromMovies(input)),ctx=A.fromMovies(input),after=E.recommend(ctx);
 const oldRanks=new Map(before.map((r,i)=>[r.movieId,i]));const d2=after.reduce((s,r,i)=>s+(i-oldRanks.get(r.movieId))**2,0);const count=after.length;
 const swapped=structuredClone(ctx);[swapped.personalSignals.N,swapped.personalSignals.V]=[swapped.personalSignals.V,swapped.personalSignals.N];
 const inverse=E.recommend(swapped);assert.deepEqual(after.map(r=>r.group),inverse.map(r=>r.group));assert.deepEqual(top(after),top(inverse));
 const changedMatch=structuredClone(ctx);for(const p of ['N','V'])changedMatch.personalSignals[p].match=Array.from({length:300},(_,i)=>({contentId:data[389+i%48].id,liked:i%2===0,sessionId:'session'+i,createdAt:'2026-10-13T12:00:00Z'}));assert.deepEqual(E.recommend(changedMatch),after);
 const current=summary(after);
 if(previous)for(const field of ['coverageN','coverageV','meanConfidenceN','meanConfidenceV'])assert(current[field]>=previous[field]);
 previous=current;
 report.scenarios.push({preferencesN:n,preferencesV:v,candidates:count,top10Overlap:top(after).filter(id=>top(before).includes(id)).length,spearman:1-6*d2/(count*(count*count-1)),old:summary(before),aligned:summary(after),swap:'IDENTICAL',match:'IDENTICAL'});
}
const values=[...Array(19).fill(9.5),8],center=E.ratingCenter(values);
report.F1={center,relative:E.relativeRatingAffinity(8,center),polarity:E.ratingPolarity(8),stableSignal:E.ratingSignal(8,center),oldIndex:5+5*old.E.ratingSignal(8,center),alignedIndex:5+5*E.ratingSignal(8,center)};
console.log(JSON.stringify(report,null,2));
