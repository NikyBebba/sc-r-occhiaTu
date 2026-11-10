// Public TMDb reputation signals only; not critic acclaim, awards, or personal taste.
const CinematicQuality = (() => {
  function evaluate(c,asOf,{establishedMin=6,nicheMin=10,nicheAge=3,nicheRecentMin=30,allowSynopsisRecovery=false,allowDetailRecovery=false}={}){if(!Number.isFinite(establishedMin)||establishedMin<0||establishedMin>10)throw new TypeError('Experimental rating threshold');if(![nicheMin,nicheAge,nicheRecentMin].every(x=>Number.isInteger(x)&&x>=0))throw new TypeError('Experimental niche bounds');const date=c.releaseDate,valid=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
    const released=valid&&date<=asOf,n=Math.max(0,c.voteCount||0),v=c.voteAverage,known=typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10;
    const age=valid?Number(asOf.slice(0,4))-Number(date.slice(0,4)):null;
    const complete=[!!c.overview,c.features?.genres?.length>0,!!c.posterPath,c.features?.runtimeMinutes>0,c.features?.directors?.length>0].filter(Boolean).length/5;
    let category=null;if(known&&n>=100&&v>=establishedMin)category='established';
    if(known&&age>=20&&n>=30&&v>=6.5)category='classic';
    else if(known&&age>=0&&age<=3&&n>=50&&v>=6.2)category='recent';
    else if(!category&&known&&n>=nicheMin&&(n>=nicheRecentMin||age>=nicheAge)&&v>=7&&(complete>=.6||allowSynopsisRecovery&&!informative(c.overview)&&complete>=.4))category='niche';
    // A tiny sample plus poster/plot is not enough to qualify an obscure feature.
    const lowSupport=category==='niche'&&n<nicheRecentMin;
    const featureVerified=c.enriched===true&&c.features?.runtimeMinutes>=60&&c.features?.directors?.length>0;
    const needsVerification=lowSupport&&!featureVerified;
    const confidence=n/(n+100),adjusted=known?(n*v+600)/(n+100):6;
    const score=.6*(adjusted/10)+.2*confidence+.1*Math.min(1,Math.log1p(Math.max(0,c.popularity||0))/Math.log1p(1000))+.1*complete;
    return {policyVersion:'cinematic-quality-v1.3',establishedMin,nicheMin,nicheAge,nicheRecentMin,eligible:released&&!!category&&!needsVerification,needsVerification:released&&needsVerification&&allowDetailRecovery,featureVerified:!!featureVerified,category,released,score,confidence,adjustedRating:adjusted,metadataCoverage:complete,
      code:!released?'UNRELEASED_OR_UNKNOWN_DATE':!category?'INSUFFICIENT_PUBLIC_REPUTATION':needsVerification?'LOW_SUPPORT_UNVERIFIED_FEATURE':'PUBLIC_SIGNALS'};
  }
  // A synopsis must contain actual prose, not a title/genre/year placeholder.
  function informative(text){const t=typeof text==='string'?text.replace(/\s+/g,' ').trim():'';
    return t.length>=40&&(t.match(/[\p{L}]+/gu)||[]).length>=8&&!/^(nessuna (trama|descrizione)|no (overview|description)|trama non disponibile|sinossi non disponibile)/i.test(t);}
  return Object.freeze({evaluate,informative});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=CinematicQuality;
