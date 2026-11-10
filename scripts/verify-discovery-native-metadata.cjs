'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Api=require('../js/api/tmdb'),View=require('../js/ui/discovery-view'),Save=require('../js/ui/discovery-save'),Retrieve=require('../js/recommendation/discovery-tmdb');
const raw={id:92101,title:'Film sintetico',release_date:'1997-04-12',poster_path:'/poster.jpg',overview:'Una restauratrice ritorna nella città natale e scopre il segreto custodito da una famiglia.',genres:[{id:18,name:'Dramma'}],runtime:121,vote_average:8.2,vote_count:2500,popularity:30,belongs_to_collection:{id:722,name:'Saga sintetica'},credits:{crew:[{job:'Director',department:'Directing',name:'Regista sintetico'}],cast:[{id:1,order:0,name:'Interprete sintetico'}]},videos:{results:[{site:'YouTube',type:'Trailer',key:'abcdefghijk',iso_639_1:'it'}]},'watch/providers':{results:{IT:{flatrate:[{provider_name:'Provider sintetico'}]}}}};
const features={genres:['Dramma'],directors:['Regista sintetico'],cast:['Interprete sintetico'],runtimeMinutes:121,releaseYear:1997,collectionId:722};
const b={escapeHtml:x=>String(x).replaceAll('<','&lt;'),TmdbDetailCache:Api.TmdbDetailCache,Number};vm.createContext(b);vm.runInContext(fs.readFileSync('js/ui/render/cards.js','utf8'),b);
const html=m=>b.externalRatingsHtml(m,true);
test('same TMDb mapper supplies all existing persistence fields without OMDb calls',async()=>{
 let omdb=0;const details=await Api.buildTmdbDetails(raw,null,{fetchOmdbByImdbId:async()=>{omdb++;return null;}});a.equal(omdb,0);
 a.equal(details.collection_name,raw.belongs_to_collection.name);a.equal(details.director,features.directors[0]);a.deepEqual(details.cast_names,features.cast);a.equal(details.duration,'121 min');a.equal(details.platform,'Provider sintetico');a.equal(details.trailerUrl,'https://www.youtube.com/watch?v=abcdefghijk');a.equal(details.tmdbRating,8.2);
 Api.TmdbDetailCache.remember({...details,imdbRating:'8.1',rtRating:'90%',metacriticRating:'82'});const model=View.movieModel({id:'tmdb:92101',tmdbId:92101,title:raw.title,overview:raw.overview,features,metadata:{...Api.TmdbDetailCache.read(raw.id),...details}});for(const k of ['title','overview','poster','director','cast_names','collection_id','collection_name','platform','trailerUrl'])a.deepEqual(model[k],details[k]);a.equal(model.tmdb_rating,8.2);a.equal(model.trailer_url,details.trailerUrl);a.equal(model.imdb_rating,'8.1');a.equal(model.rt_rating,'90%');a.equal(model.metacritic_rating,'82');
});
test('ratings share one component; all four sources, missing and invalid TMDb values',()=>{
 const all=html({imdb_rating:'8.1',rt_rating:'90%',metacritic_rating:'82',tmdb_rating:8.2});for(const label of ['IMDb 8.1','RT 90%','MC 82','TMDb 8,2'])a.ok(all.includes(label));a.equal((all.match(/rating-holo/g)||[]).length,1);
 for(const rating of [undefined,null,NaN,Infinity,-1,10.1,'8.2'])a.ok(!html({tmdb_rating:rating}).includes('TMDb '));a.ok(html({tmdb_rating:0}).includes('TMDb 0,0'));a.ok(html({tmdb_id:'92101'}).includes('TMDb 8,2'));
});
test('provider and trailer absence use ordinary behavior; malicious or unsupported videos never produce URLs',()=>{
 const empty=Api.tmdbMetadataFromDetail({id:92102,title:'Sparse',genres:null,credits:{cast:{},crew:null},videos:{results:[{site:'YouTube',type:'Trailer',key:'bad?x=<tag>'},{site:'Vimeo',key:'abcdefghijk'}]} });a.equal(Api.tmdbTrailerUrl([{site:'YouTube',type:'Featurette',key:'abcdefghijk'}]),'');a.equal(empty.trailerUrl,'');a.equal(empty.platform,'Streaming');a.equal(empty.director,null);a.equal(empty.cast_names,null);a.deepEqual(empty.genres,[]);
 a.equal(Api.tmdbTrailerUrl([{site:'YouTube',key:'abcdefghijk',type:'Trailer',iso_639_1:'en'},{site:'YouTube',key:'12345678901',type:'Trailer',iso_639_1:'it'}]),'https://www.youtube.com/watch?v=12345678901');
});
test('selected detail cache reuses retrieval metadata and coalesces requests without source mutation',async()=>{
 const copy=structuredClone(raw),d=Api.tmdbMetadataFromDetail(copy);Api.TmdbDetailCache.remember(d);const cached=await Api.fetchTmdbDetailsById(raw.id);a.deepEqual(cached,d);cached.genres.push('Changed');a.deepEqual(Api.TmdbDetailCache.read(raw.id).genres,['Dramma']);a.deepEqual(copy,raw);
 let loads=0,release;const gate=new Promise(r=>release=r),load=async()=>{loads++;await gate;return d;};const first=Api.TmdbDetailCache.acquire(92109,load),second=Api.TmdbDetailCache.acquire(92109,load);release();a.deepEqual(await first,await second);a.equal(loads,1);
});
test('retrieval retains videos providers collection and public rating using the same bounded detail calls',async()=>{
 let calls=0;const client=Retrieve.create({now:()=>Date.UTC(2026,10,10),transport:async spec=>{calls++;return spec.path==='/discover/movie'?{status:200,body:{total_pages:1,results:[{...raw,genre_ids:[18]}]}}:{status:200,body:raw};}});
 const result=await client.load();const c=result.candidates.find(x=>x.tmdbId===raw.id);a.ok(c?.metadata);a.equal(c.metadata.trailerUrl,'https://www.youtube.com/watch?v=abcdefghijk');a.equal(c.metadata.platform,'Provider sintetico');a.equal(c.metadata.collection_name,'Saga sintetica');a.ok(calls<=16);a.ok(result.stats.detailRequests<=4);
});
test('uncertain metadata cannot invite a new action until the exact patch is observed',async()=>{
 let calls=0;const record={movie_id:'persisted',tmdb_id:92111,director:null};const save=Save.create({getSource:()=>({catalog:[record],input:{candidates:[]},relationState:()=>false}),save:async()=>{calls++;return {movieId:'persisted',metadata:{outcome:'TRANSPORT_UNCERTAIN'},metadataExpected:{director:'Verified director'},relation:null};}});
 a.equal((await save.submit(92111,{},'recordSeen')).status,'UNCERTAIN');a.equal((await save.submit(92111,{},'addToMyList')).status,'BLOCKED_BY_PENDING_ACTION');a.equal(calls,1);record.director='Verified director';save.reconcile();a.equal(save.inspect(92111,'recordSeen').status,'READY_TO_PROPOSE');
});
test('list explanations need specific matching metadata and verifiable evidence, never individual names',()=>{
 const context={RecommendationConfig:{diversity:{defaultShortlistSize:5}}};vm.createContext(context);vm.runInContext(fs.readFileSync('js/ui/recommendations.js','utf8'),context);
 const reason={code:'FEATURE_AFFINITY',family:'director',token:'regista sintetico',polarity:'inferred_positive',evidenceMovieIds:['one','two']};const describe=r=>context.recommendationListReason({reasons:r},{director:'Regista sintetico'},id=>['one','two'].includes(id));a.ok(describe([reason]).includes('Regista sintetico'));
 for(const reasons of [[{...reason,family:'genre',token:'dramma'}],[{...reason,evidenceMovieIds:['one']}],[{...reason,token:'other director'}],[{code:'PERSONAL_RATING_POSITIVE',userIds:['N']}],[]])a.equal(describe(reasons),'Una proposta dalla Lista per la prossima visione.');
});
