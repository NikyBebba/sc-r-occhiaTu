// Factual, compact copy. No NLP or claims about critic reviews/awards.
const DiscoveryCopy = (() => {
  const norm=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  function describe(c,row,source,index=0){const text=String(c.overview||'').replace(/\s+/g,' ').trim();const narrative=text?text.length>150?text.slice(0,147).replace(/\s+\S*$/,'')+'…':text:'';
    const options=[];for(const r of row.reasons||[]){if(r.code!=='FEATURE_AFFINITY'||r.contribution<=0||r.support<2)continue;
      const s=r.scope==='together'?source.input.sharedSignals:source.input.personalSignals[r.personId],ratings=new Map((s?.ratings||[]).map(x=>[String(x.contentId),x.value])),likes=new Map((s?.preferences||[]).map(x=>[String(x.contentId),x.value]));
      const evidence=(r.evidenceMovieIds||[]).find(id=>ratings.has(id)?ratings.get(id)>=7:likes.get(id)===true),film=source.catalog.find(f=>String(f.movie_id??f.id)===evidence);if(!film)continue;
      let label='';const f=c.features;if(r.family==='genre')label=f.genres.find(x=>norm(x)===r.featureId)||'';
      if(r.family==='genre_pair'){const names=r.featureId.split('|').map(t=>f.genres.find(x=>norm(x)===t));if(names.every(Boolean))label=names.join(' e ');}
      if(r.family==='director')label=f.directors.find(x=>norm(x)===r.featureId)||'';if(r.family==='cast')label=f.cast.find(x=>norm(x)===r.featureId)||'';
      if(r.family==='runtime'&&Number.isFinite(f.runtimeMinutes)&&String([100,120,150].filter(n=>f.runtimeMinutes>=n).length)===r.featureId)label=['Meno di 100 minuti','Tra 100 e 119 minuti','Tra 120 e 149 minuti','150 minuti o più'][Number(r.featureId)];
      if(r.family==='decade'&&Number.isInteger(f.releaseYear)&&String(Math.floor(f.releaseYear/10)*10)===r.featureId)label='Cinema degli anni '+r.featureId;
      if(r.family==='collection'&&f.collectionId!=null&&String(f.collectionId)===r.featureId)label='La stessa saga';
      if(!label||r.scope==='together'&&row.sharedTieBreak!==undefined&&row.sharedTieBreak<=0)continue;
      const personal=Object.values(row.personal||{}),minimum=personal.length?Math.min(...personal.map(p=>p.affinity)):null;
      const binding=r.scope==='personal'&&minimum>0&&Math.max(...personal.map(p=>p.affinity))-minimum>1e-9&&row.personal?.[r.personId]?.affinity===minimum;
      options.push({scope:r.scope,personId:r.personId,strength:r.contribution,binding,family:r.family,featureId:r.featureId,feature:label,evidenceId:evidence,copy:`${label}: un filo comune con «${film.title}» tra i film apprezzati insieme.`});
    }
    options.sort((a,b)=>b.strength-a.strength||String(a.personId??a.scope).localeCompare(String(b.personId??b.scope))||a.feature.localeCompare(b.feature));
    const channels=new Map();for(const o of options)if(!channels.has(o.personId??o.scope))channels.set(o.personId??o.scope,o);const best=options[0]?.strength||0;
    const near=[...channels.values()].filter(o=>o.strength>=best*.8),binding=[...channels.values()].filter(o=>o.binding);
    // Different channels affect different parts of the group ordering: a binding
    // personal affinity or an applied Together tie-break must not vanish merely
    // because its raw feature magnitude is below another person's contribution.
    const choices=[...channels.values()].filter(o=>near.includes(o)||o.binding||o.scope==='together'&&row.sharedTieBreak>0)
      .sort((a,b)=>Number(b.binding)-Number(a.binding)||b.strength-a.strength||String(a.personId??a.scope).localeCompare(String(b.personId??b.scope)));
    // UI claims require shared, specific evidence. Personal diagnostics stay internal.
    const selected=options.find(o=>o.scope==='together'&&['genre_pair','director','cast','collection'].includes(o.family)&&
      new Set((row.reasons.find(r=>r.scope==='together'&&r.family===o.family&&r.featureId===o.featureId&&r.support>=2)?.evidenceMovieIds||[]).filter(id=>
        source.catalog.some(f=>String(f.movie_id??f.id)===String(id))&&(source.input.sharedSignals?.ratings||[]).some(x=>String(x.contentId)===String(id)&&x.value>=7))).size>=2);
    const affinity=selected?.copy||'';
    const shared=(row.reasons||[]).filter(r=>r.scope==='together'&&r.code==='FEATURE_AFFINITY');
    const specific=shared.filter(r=>r.contribution>0&&r.support>=2&&['genre_pair','director','cast','collection'].includes(r.family));
    const sharedObservations=(source.input.sharedSignals?.ratings||[]).filter(x=>Number.isFinite(x.value)&&x.value>=0&&x.value<=10).length;
    const collectiveState=selected?'SUPPORTED':!shared.length?(sharedObservations===0?'ABSENT':sharedObservations<2?'INSUFFICIENT_SUPPORT':'NO_MATCHING_EVIDENCE'):specific.length&&row.sharedTieBreak!==undefined&&row.sharedTieBreak<=0?'SUPPRESSED_BY_NEGATIVE':specific.length?'UNVERIFIABLE':'WEAK_OR_GENERIC';
    return {narrative,affinity,text:[narrative,affinity].filter(Boolean).join(' '),personalized:!!selected,
      evidence:selected?{scope:'together',movieId:selected.evidenceId,family:selected.family}:null,
      diagnostics:{collectiveState,channels:[...channels.values()].map(({scope,personId,strength,binding,family})=>({scope,personId,strength,binding,family})),comparableChannels:near.map(o=>o.personId??o.scope)}};
  }
  return Object.freeze({describe});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=DiscoveryCopy;
