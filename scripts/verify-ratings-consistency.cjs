'use strict';
// Actual API/renderer code, synthetic transport and controllable clock only.
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const detail={id:44001,title:'Film sintetico',imdb_id:'tt1234567',vote_average:7.6,genres:[],credits:{crew:[],cast:[]}};
const ratings={Response:'True',imdbID:'tt1234567',imdbRating:'8.2',Ratings:[{Source:'Rotten Tomatoes',Value:'93%'},{Source:'Metacritic',Value:'84'}]};
function fixture({data=detail,omdb=ratings}={}){
 let time=Date.UTC(2026,10,10),gate=null;const calls={tmdb:0,omdb:0},state={data:structuredClone(data),omdb:structuredClone(omdb)};
 const context={CONFIG:{TMDB_API_KEY:'synthetic',OMDB_API_KEY:'synthetic'},AbortController,setTimeout,clearTimeout,URL,Date:class extends Date{static now(){return time;}},console,escapeHtml:x=>String(x),fetch:async url=>{const u=new URL(url),isOmdb=u.hostname.includes('omdbapi');calls[isOmdb?'omdb':'tmdb']++;if(gate)await gate;return {ok:true,json:async()=>structuredClone(isOmdb?state.omdb:state.data)};}};
 vm.createContext(context);for(const file of ['js/api/omdb.js','js/api/tmdb.js','js/ui/render/cards.js','js/ui/render/detail.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
 return {context,calls,state,run:code=>vm.runInContext(code,context),advance:ms=>time+=ms,hold(){let release;gate=new Promise(r=>release=r);return ()=>{gate=null;release();};}};
}
test('ordinary explicit open fetches TMDb then IMDb-id OMDb; renderer keeps source ratings separate',async()=>{
 const f=fixture();await f.run('fetchTmdbDetailsById(44001)');a.deepEqual(f.calls,{tmdb:1,omdb:1});const html=f.run('externalRatingsHtml({tmdb_id:44001,imdb_rating:"6.0",seen_rating_n:2,seen_rating_together:3},true)');for(const value of ['TMDb 7,6','IMDb 8.2','RT 93%','MC 84'])a.ok(html.includes(value));a.ok(!html.includes('Together'));a.equal((html.match(/rating-holo/g)||[]).length,1);
});
test('Discovery enrichment already has IMDb id: only OMDb is missing, no second TMDb request',async()=>{
 const f=fixture();f.context.raw=detail;f.run('TmdbDetailCache.remember(tmdbMetadataFromDetail(raw));');const d=await f.run('fetchTmdbDetailsById(44001)');a.equal(d.imdbRating,'8.2');a.deepEqual(f.calls,{tmdb:0,omdb:1});await f.run('fetchTmdbDetailsById(44001)');a.equal(f.calls.omdb,1);
});
test('acquisition and ordinary reopening use same cached values; render does no I/O',async()=>{
 const f=fixture();await f.run('fetchTmdbDetailsById(44001)');const before=f.run('externalRatingsHtml({tmdb_id:44001,tmdb_rating:7.6},true)');for(let i=0;i<20;i++)f.run('externalRatingsHtml({tmdb_id:44001},true)');const after=f.run('externalRatingsHtml({tmdb_id:"44001",imdb_rating:"8.2",rt_rating:"93%",metacritic_rating:"84"},true)');a.equal(before,after);await f.run('fetchTmdbDetailsById("44001")');a.deepEqual(f.calls,{tmdb:1,omdb:1});
});
test('expired detail and ratings cache refresh once on reopen, not every render',async()=>{
 const f=fixture();await f.run('fetchTmdbDetailsById(44001)');f.advance(3600001);f.state.data.vote_average=7.7;f.state.omdb.imdbRating='8.3';await Promise.all([f.run('fetchTmdbDetailsById(44001)'),f.run('fetchTmdbDetailsById(44001)')]);a.deepEqual(f.calls,{tmdb:2,omdb:2});a.ok(f.run('externalRatingsHtml({tmdb_id:44001},true)').includes('TMDb 7,7'));a.ok(f.run('externalRatingsHtml({tmdb_id:44001},true)').includes('IMDb 8.3'));
});
test('missing and N/A sources stay n.d.; negative cache prevents repeated lookups',async()=>{
 const f=fixture({omdb:{Response:'False'}});await f.run('fetchTmdbDetailsById(44001)');for(let i=0;i<3;i++)await f.run('fetchTmdbDetailsById(44001)');a.deepEqual(f.calls,{tmdb:1,omdb:1});let html=f.run('externalRatingsHtml({tmdb_id:44001},true)');for(const name of ['IMDb n.d.','RT n.d.','MC n.d.'])a.ok(html.includes(name));
 f.advance(300001);f.state.omdb={Response:'True',imdbRating:'N/A',Metascore:'N/A',Ratings:[{Source:'Rotten Tomatoes',Value:'N/A'}]};await f.run('fetchTmdbDetailsById(44001)');a.deepEqual(f.calls,{tmdb:1,omdb:2});html=f.run('externalRatingsHtml({tmdb_id:44001},true)');a.ok(!html.includes('N/A'));a.ok(html.includes('IMDb n.d.'));
});
test('negative OMDb refresh does not indefinitely extend TMDb freshness',async()=>{
 const f=fixture({omdb:{Response:'False'}});await f.run('fetchTmdbDetailsById(44001)');for(let i=0;i<12;i++){f.advance(300001);await f.run('fetchTmdbDetailsById(44001)');}a.equal(f.calls.tmdb,2);a.equal(f.calls.omdb,13);
});
test('no IMDb id has no speculative title match and no OMDb request',async()=>{
 const f=fixture({data:{...detail,imdb_id:null,vote_average:null}});await f.run('fetchTmdbDetailsById(44001)');await f.run('fetchTmdbDetailsById(44001)');a.deepEqual(f.calls,{tmdb:1,omdb:0});a.ok(!f.run('externalRatingsHtml({tmdb_id:44001},true)').includes('TMDb '));
});
test('concurrent metadata readers and OMDb readers share real requests',async()=>{
 const f=fixture(),release=f.hold(),one=f.run('fetchTmdbDetailsById(44001)'),two=f.run('fetchTmdbDetailsById("44001")');release();await Promise.all([one,two]);a.deepEqual(f.calls,{tmdb:1,omdb:1});f.advance(3600001);await Promise.all([f.run('fetchOmdbByImdbId("tt1234567")'),f.run('fetchOmdbByImdbId("tt1234567")')]);a.equal(f.calls.omdb,2);
});
test('Metascore fallback and missing individual RT/MC values use normal extraction',()=>{
 const f=fixture();const result=f.run('extractRatings({imdbRating:"7.1",Metascore:"72",Ratings:[]})');a.equal(result.imdbRating,'7.1');a.equal(result.metacriticRating,'72');a.equal(result.rtRating,'');a.equal(f.run('extractRatings({Ratings:[null,{Source:"Rotten Tomatoes",Value:"N/A"}]})').rtRating,'');
});
test('ordinary detail loader updates only source rating slot; close, identity and auth context discard late UI',async()=>{
 const f=fixture();let visible=true,id='film-a',external=null,current=true,markup='',updates=0,reads=0;const node={set outerHTML(s){markup=s;updates++;}},body={dataset:{get movieId(){return id;},get externalId(){return external;}},querySelector:()=>node};f.context.document={getElementById:key=>key==='detailBody'?body:{classList:{contains:()=>!visible}}};f.context.load=async()=>{reads++;return {matched:true};};f.context.ctx={current:()=>current};
 await f.run('loadMovieDetailRatings({id:"film-a",tmdb_id:44001},ctx,load)');a.equal(updates,1);a.ok(markup.includes('IMDb n.d.'));visible=false;await f.run('loadMovieDetailRatings({id:"film-a",tmdb_id:44001},ctx,load)');id='film-b';visible=true;await f.run('loadMovieDetailRatings({id:"film-a",tmdb_id:44001},ctx,load)');id='film-a';current=false;await f.run('loadMovieDetailRatings({id:"film-a",tmdb_id:44001},ctx,load)');a.equal(updates,1);a.equal(reads,4);
});
