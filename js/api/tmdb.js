// ============================================
// TMDb API — poster, durata, streaming, trailer, collection, regista+anno
// (source primaria di ricerca e dettaglio)
// ============================================

// La chiave in CONFIG è reale e usata direttamente dal frontend: la guardia
// è attiva semplicemente se c'è una chiave non vuota.
function tmdbConfigured() {
  return !!(CONFIG.TMDB_API_KEY && CONFIG.TMDB_API_KEY.trim());
}

// Ricerca candidati per la scelta multipla (usata nell'aggiunta singola).
// Ritorna fino a 5 risultati grezzi con poster piccolo e anno, senza
// fare chiamate di dettaglio: quelle si fanno solo dopo che l'utente sceglie.
async function searchTmdbCandidates(title, { strict = false } = {}) {
  if (!tmdbConfigured()) {
    if (strict) throw new Error('TMDB_UNAVAILABLE');
    return [];
  }
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${CONFIG.TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=it-IT`
    );
    if (strict && !res.ok) throw new Error('TMDB_SEARCH_FAILED');
    const data = await res.json();
    if (strict && !Array.isArray(data.results)) throw new Error('TMDB_SEARCH_FAILED');
    if (!data.results) return [];
    return data.results.slice(0, 5).map(r => ({
      id: r.id,
      title: r.title,
      year: r.release_date ? r.release_date.slice(0, 4) : '—',
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : ''
    }));
  } catch (err) {
    console.error('Errore ricerca TMDb:', err);
    if (strict) throw err;
    return [];
  }
}

// Trasforma una risposta /movie/{id} nell'oggetto dettagli dell'app, incluse
// piattaforma IT, trailer e rating OMDb (più precisi per imdb_id).
// imdb_id fa parte della risposta base di TMDb, non serve append_to_response.
// Public TMDb metadata only: bounded in-memory cache, never judgments or DB records.
const TmdbDetailCache = (() => {
  const entries=new Map(),pending=new Map(),ttl=3600000,limit=100;
  const key=id=>/^[1-9]\d*$/.test(String(id))?String(id):null;
  const clone=x=>JSON.parse(JSON.stringify(x));
  return Object.freeze({read(id){const k=key(id),r=entries.get(k);if(!r)return null;if(Date.now()-r.at>=ttl){entries.delete(k);return null;}return clone(r.value);},
    remember(details,{preserveAge=false}={}){const k=key(details?.tmdb_id);if(!k||details.matched!==true)return;const at=preserveAge&&entries.has(k)?entries.get(k).at:Date.now();entries.delete(k);entries.set(k,{at,value:clone(details)});while(entries.size>limit)entries.delete(entries.keys().next().value);},
    acquire(id,load){const k=key(id);if(pending.has(k))return pending.get(k);const task=Promise.resolve().then(load).finally(()=>pending.delete(k));pending.set(k,task);return task;}});
})();
function tmdbTrailerUrl(videos) {
  const valid=(Array.isArray(videos)?videos:[]).filter(v=>v?.site==='YouTube'&&typeof v.key==='string'&&/^[A-Za-z0-9_-]{11}$/.test(v.key));
  const selected=valid.find(v=>v.type==='Trailer'&&v.iso_639_1==='it')||valid.find(v=>v.type==='Trailer')||valid.find(v=>v.type==='Teaser');
  return selected?'https://www.youtube.com/watch?v='+selected.key:'';
}
// Same mapper for ordinary addition and already-fetched Discovery enrichment. No I/O.
function tmdbMetadataFromDetail(detail,fallbackTitle) {
  const providers=detail['watch/providers']?.results?.IT?.flatrate;
  const provider=Array.isArray(providers)?providers.find(p=>typeof p?.provider_name==='string'&&p.provider_name.trim()):null;
  const genreNames=(Array.isArray(detail.genres)?detail.genres:[]).map(g=>g?.name).filter(g=>typeof g==='string'&&g.trim());
  const directors=(Array.isArray(detail.credits?.crew)?detail.credits.crew:[]).filter(p=>p?.job==='Director'&&(!p.department||p.department==='Directing')).map(p=>p.name).filter(n=>typeof n==='string'&&n.trim());
  const year=String(detail.release_date||'').match(/^\d{4}/),cast=(Array.isArray(detail.credits?.cast)?detail.credits.cast:[]).map(p=>p?.name).filter(n=>typeof n==='string'&&n.trim()).slice(0,8);
  return {imdbId:typeof detail.imdb_id==='string'&&/^tt\d{5,12}$/.test(detail.imdb_id)?detail.imdb_id:null,tmdb_id:detail.id,title:detail.title||fallbackTitle,collection_id:detail.belongs_to_collection?.id??null,collection_name:detail.belongs_to_collection?.name||null,
    genres:genreNames,duration:typeof detail.runtime==='number'&&detail.runtime>0?detail.runtime+' min':null,release_year:year&&Number(year[0])>0?Number(year[0]):null,
    director:directors.length?directors.join(', '):null,overview:typeof detail.overview==='string'&&detail.overview.trim()?detail.overview:null,cast_names:cast.length?cast:null,
    platform:provider?provider.provider_name.trim():'Streaming',poster:/^\/[\w./-]+$/.test(detail.poster_path||'')?'https://image.tmdb.org/t/p/w500'+detail.poster_path:'',
    trailerUrl:tmdbTrailerUrl(detail.videos?.results),matched:true,
    tmdbRating:typeof detail.vote_average==='number'&&Number.isFinite(detail.vote_average)&&detail.vote_average>=0&&detail.vote_average<=10?detail.vote_average:null};
}
function tmdbRatingsFresh(details,now=Date.now()) {
  return !!details&&(!details.imdbId||details.ratingsChecked===true&&Number.isFinite(details.ratingsCheckedAt)&&now-details.ratingsCheckedAt>=0&&now-details.ratingsCheckedAt<(details.ratingsUnavailable?300000:3600000));
}
async function completeTmdbRatings(details,options={}) {
  if(tmdbRatingsFresh(details))return details;
  const fetchOmdb=options.fetchOmdbByImdbId||(typeof fetchOmdbByImdbId==='function'?fetchOmdbByImdbId:null);
  const extractor=options.extractRatings||(typeof extractRatings==='function'?extractRatings:null);
  if(!fetchOmdb||!extractor)return details;
  let data=null;try{data=await fetchOmdb(details.imdbId);}catch(_){}
  return {...details,...extractor(data),ratingsChecked:true,ratingsCheckedAt:Date.now(),ratingsUnavailable:data===null};
}
async function buildTmdbDetails(detail,fallbackTitle,options={}) {
  const extractor=options.extractRatings||(typeof extractRatings==='function'?extractRatings:null);
  const base={...(extractor?extractor(null):{}),...tmdbMetadataFromDetail(detail,fallbackTitle)};
  const result=await completeTmdbRatings(base,options);TmdbDetailCache.remember(result);return result;
}
// Normal detail flow, also reused on explicit Discovery open when not enriched yet.
async function fetchTmdbDetailsById(id,options={}) {
  const cached=options.force?null:TmdbDetailCache.read(id);if(cached&&tmdbRatingsFresh(cached))return cached;
  return TmdbDetailCache.acquire(id,async()=>{if(cached){const result=await completeTmdbRatings(cached,options);TmdbDetailCache.remember(result,{preserveAge:true});return result;}const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);try{
    const response=await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${CONFIG.TMDB_API_KEY}&append_to_response=watch/providers,videos,credits&language=it-IT`,{signal:abort.signal});
    if(response.ok===false)throw Error('TMDB_DETAIL_FAILED');const detail=await response.json();if(String(detail.id)!==String(id))throw Error('TMDB_DETAIL_ID');
    return await buildTmdbDetails(detail,null,options);
  }catch(_){return {tmdb_id:id,title:'Errore',genres:[],duration:null,platform:'Streaming',poster:'',trailerUrl:'',matched:false,collection_id:null,collection_name:null,...(typeof emptyRatings==='object'?emptyRatings:{})};}finally{clearTimeout(timer);}});
}

// Cerca il film per titolo e ne restituisce il dettaglio -> null se TMDb non
// trova nulla. È il primo passo dell'import bulk/import script: NON far
// scegliere l'utente, prendere il primo risultato è una scelta deliberata
// (i casi dubbi restano matched:false e correggibili dopo). Attraversa la
// stessa pipeline buildTmdbDetails di fetchTmdbDetailsById così metadati,
// piattaforma IT, trailer e rating restano coerenti con l'app.
async function fetchTmdbDetailsByTitle(title) {
  if (!tmdbConfigured()) return null;
  try {
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${CONFIG.TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=it-IT`
    );
    const searchData = await searchRes.json();
    if (!searchData.results || searchData.results.length === 0) return null;

    const movie = searchData.results[0];
    const detailRes = await fetch(
      `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${CONFIG.TMDB_API_KEY}&append_to_response=watch/providers,videos,credits&language=it-IT`
    );
    const detail = await detailRes.json();
    return await buildTmdbDetails(detail, title);
  } catch (err) {
    console.error('Errore TMDb:', err);
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTmdbDetails };
}

// Phase 41 — collection su richiesta; fallimenti non memorizzati e log senza URL/chiavi.
const tmdbCollectionCache = new Map();
function tmdbCollectionReleaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 100) return null;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? value : null;
}

function normalizeTmdbCollection(data) {
  if (!data || !Number.isInteger(Number(data.id)) || Number(data.id) <= 0 || !Array.isArray(data.parts)) return null;
  const seen = new Set();
  const parts = data.parts.filter(part => {
    if (!part) return false;
    const id = Number(part.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) return false;
    seen.add(id); return true;
  }).map(part => ({
    id: Number(part.id), title: part.title || part.original_title || 'Titolo non disponibile',
    release_date: tmdbCollectionReleaseDate(part.release_date),
    poster: part.poster_path ? 'https://image.tmdb.org/t/p/w200' + part.poster_path : ''
  })).sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999') || a.id - b.id);
  return { id: Number(data.id), name: data.name || 'La saga', parts };
}

async function fetchTmdbCollection(id) {
  id = Number(id);
  if (!tmdbConfigured() || !Number.isInteger(id) || id <= 0) return null;
  const cached = tmdbCollectionCache.get(id);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.data;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  try {
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => { if (controller) controller.abort(); resolve(null); }, 8000);
    });
    const request = (async () => {
      const response = await fetch(`https://api.themoviedb.org/3/collection/${id}?api_key=${CONFIG.TMDB_API_KEY}&language=it-IT`,
        controller ? { signal: controller.signal } : {});
      if (!response.ok) return null;
      const data = normalizeTmdbCollection(await response.json());
      return data && data.id === id ? data : null;
    })().catch(() => null);
    const data = await Promise.race([request, timeout]);
    if (data) tmdbCollectionCache.set(id, { data, at: Date.now() });
    return data;
  } finally { clearTimeout(timer); }
}

if(typeof module!=='undefined'&&module.exports)module.exports={tmdbMetadataFromDetail,tmdbTrailerUrl,TmdbDetailCache,buildTmdbDetails,fetchTmdbDetailsById,tmdbRatingsFresh};
