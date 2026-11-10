// Reconciles existing saveContent results. Never retries writes automatically.
const DiscoverySave = (() => {
  function create({save,getSource,refresh=()=>{},changed=()=>{}}){const records=new Map();let disposed=false;
    function content(tmdbId){try{return getSource()?.catalog?.find(c=>String(c.tmdb_id)===String(tmdbId))||null;}catch(_){return null;}}
    const relations=['proposeToGroup','addToMyList','recordSeen'];
    const keyOf=(id,relation)=>String(id)+'|'+relation;
    function projected(tmdbId,relation='proposeToGroup'){try{const s=getSource(),m=content(tmdbId);if(!m)return null;const id=String(m.movie_id??m.id);const applied=s.relationState?s.relationState(id,relation):relation==='proposeToGroup'&&s.input.candidates.some(c=>String(c.movieId)===id&&c.inSharedList);return applied?id:null;}catch(_){return null;}}
    function reconcile(notify=false){let dirty=false;for(const r of records.values()){const key=projected(r.tmdbId,r.relation),metadataReady=!r.result?.metadataExpected||Object.entries(r.result.metadataExpected).every(([k,v])=>JSON.stringify(content(r.tmdbId)?.[k==='matched'?'metadata_matched':k])===JSON.stringify(v));if(key&&r.status!=='PENDING'&&metadataReady&&(r.status!=='CONFIRMED'||!r.projected)){Object.assign(r,{status:'CONFIRMED',movieId:key,projected:true});dirty=true;}
      else if(r.status==='UNCERTAIN'&&r.result?.relation===null&&content(r.tmdbId)&&(!r.result.metadataExpected||Object.entries(r.result.metadataExpected).every(([k,v])=>JSON.stringify(content(r.tmdbId)[k==='matched'?'metadata_matched':k])===JSON.stringify(v)))){Object.assign(r,{status:'READY_TO_PROPOSE',movieId:String(content(r.tmdbId).movie_id??content(r.tmdbId).id)});dirty=true;}
    }if(dirty&&notify&&!disposed)changed();}
    function inspect(tmdbId,relation='proposeToGroup'){if(!relations.includes(relation))throw new TypeError('Native relation required');reconcile();const r=records.get(keyOf(tmdbId,relation));const existing=projected(tmdbId,relation);return r||{tmdbId,relation,status:existing?'CONFIRMED':'IDLE',movieId:existing,projected:!!existing,already:!!existing};}
    function busy(tmdbId){return [...records.values()].find(r=>String(r.tmdbId)===String(tmdbId)&&(['PENDING','UNCERTAIN'].includes(r.status)||r.status==='CONFIRMED'&&!r.projected))||null;}
    async function submit(tmdbId,details,relation='proposeToGroup'){if(!relations.includes(relation))throw new TypeError('Native relation required');const key=keyOf(tmdbId,relation);let r=records.get(key);reconcile();if(r&&['PENDING','UNCERTAIN','CONFIRMED'].includes(r.status))return r;
      if(busy(tmdbId))return {tmdbId,relation,status:'BLOCKED_BY_PENDING_ACTION'};
      const existing=projected(tmdbId,relation);if(existing){r={tmdbId,relation,status:'CONFIRMED',movieId:existing,projected:true,already:true};records.set(key,r);return r;}
      r={tmdbId,relation,status:'PENDING',projected:false};records.set(key,r);changed();
      try{const result=await save(details,relation);if(disposed)return r;r.result=result;r.movieId=result?.movieId??null;
        const outcome=result?.relation?.outcome??result?.metadata?.outcome??result?.content?.outcome??result?.outcome;
        if(['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(result?.relation?.outcome))Object.assign(r,{status:'CONFIRMED',already:result.relation.outcome==='ALREADY_IN_TARGET_STATE'});
        else if(outcome==='ERROR'&&(result?.relation?.error||result?.metadata?.error||result?.content?.error||result?.error)||['NOT_READY','RETRY_NOT_ALLOWED'].includes(outcome))r.status='ERROR';else r.status='UNCERTAIN';
      }catch(_){if(!disposed)r.status='UNCERTAIN';}
      if(!disposed){reconcile();changed();if(r.status==='UNCERTAIN'||r.status==='CONFIRMED'&&!r.projected)Promise.resolve().then(()=>{if(!disposed)refresh();});}return r;
    }
    return Object.freeze({inspect,submit,reconcile,busy,verify(){if(!disposed)refresh();},dispose(){disposed=true;}});
  }
  return Object.freeze({create});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=DiscoverySave;
