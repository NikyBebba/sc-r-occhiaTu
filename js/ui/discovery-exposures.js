// Per-device public exposure memory. Never stores profiles, accounts, ratings or titles.
const DiscoveryExposures = (() => {
  const key='scorochiatu_discovery_exposures_v1',ttlMs=7*86400000,limit=200;
  function normalize(rows,now){const map=new Map();for(const x of Array.isArray(rows)?rows:[]){if(!/^tmdb:[1-9]\d*$/.test(x?.id)||!Number.isFinite(x.at)||x.at>now||now-x.at>=ttlMs)continue;map.set(x.id,Math.max(map.get(x.id)||0,x.at));}
    return [...map].map(([id,at])=>({id,at})).sort((a,b)=>b.at-a.at||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,limit);}
  function create({storage,now=Date.now}={}){let memory=[];
    function read(){try{const saved=storage?.getItem(key);if(saved)memory=JSON.parse(saved);}catch(_){}memory=normalize(memory,now());return memory.map(x=>({...x}));}
    function record(ids){const at=now();memory=normalize([...read(),...ids.map(id=>({id,at}))],at);try{storage?.setItem(key,JSON.stringify(memory));}catch(_){}return read();}
    return Object.freeze({read,record});}
  return Object.freeze({create,normalize,key,ttlMs,limit});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=DiscoveryExposures;
