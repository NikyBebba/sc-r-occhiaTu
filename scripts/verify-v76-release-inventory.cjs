'use strict';
// Inventory only: never stages files or reads private import artefacts.
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const baseline='b1c3f5103bcd5129006afa8db1732c66b799e8fa';
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'});
const tracked=git('diff','--name-only',baseline,'--').trim().split('\n').filter(Boolean);
const untracked=git('ls-files','--others','--exclude-standard','-z').split('\0').filter(Boolean);
const approvedNew=p=>/^js\/(recommendation|ui)\/(profiles|ranking-v2(?:-input)?|cinematic-quality|discovery-[a-z-]+)\.js$/.test(p)
 || p==='database/20261110012012_completed_nights_memory.sql'
 || /^docs\/(COMPLETED_NIGHTS_UNIFICATION|DISCOVERY_[A-Z0-9_]+|RATINGS_CONSISTENCY_NATIVE_LAYOUT|RECOMMENDATION_(CORE_V2(?:_BENCHMARK)?|DIVERSITY_VALIDATION)|TASTE_PROFILES_V1|TMDB_DISCOVERY_RETRIEVAL|V76_[A-Z_]+)\.(md|json|sql)$/.test(p)
 || /^scripts\/(verify-(completed-unified-browser|discovery-[a-z-]+|ratings-consistency|recommendation-(profiles|ranking-v2|diversity)|v76-[a-z-]+)|benchmark-recommendation-ranking-v2|compare-discovery-(retrieval|six)|diagnose-discovery-native|validate-recommendation-diversity|local-postgres-fixture)\.cjs$/.test(p)
 || /^scripts\/fixtures\/discovery-(live-findings|retrieval-before)\.cjs$/.test(p);
const selected=[...new Set([...tracked,...untracked.filter(approvedNew)])].sort();
assert.equal(git('diff','--cached','--name-only').trim(),'','No staging allowed');
assert.equal(git('diff',baseline,'--','js/config.js'),'','Runtime configuration must remain unchanged');
const frozen=['js/recommendation/core.js','js/recommendation/adapters.js','js/recommendation/config.js','js/auth.js','js/wheel.js','js/ui/match.js'];
for(const p of frozen)assert(!selected.includes(p),'Frozen file changed: '+p);
const findings=[];
const files=selected.filter(p=>p!=='docs/V76_RELEASE_INVENTORY.json').map(p=>{
 assert(!/history[-_]n|__pycache__|(?:^|\/)(?:backup|tmp|db-exports)(?:\/|$)|\.bak$/i.test(p),'Excluded artefact in release inventory');
 const body=fs.readFileSync(p),text=body.toString();
 for(const [rule,re]of [['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['service-role-jwt',/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/],['provider-secret',/\b(?:sb_secret_|sk_live_|ghp_)[A-Za-z0-9_]{15,}/]])if(re.test(text))findings.push({path:p,rule});
 return {path:p,status:tracked.includes(p)?'modified':'new',sha256:crypto.createHash('sha256').update(body).digest('hex')};
});
assert.deepEqual(findings,[],'Potential secrets require review; values are never logged');
const report={baseline,scope:'Local v76 candidate; no staging, commit or publication',files,excludedUntrackedCount:untracked.filter(p=>!approvedNew(p)).length,excludedCategories:['history N imports and private fixtures','icon & mascotte assets','Python cache and unrelated artefacts'],checks:{noStaging:true,configUnchanged:true,frozenFilesUnchanged:true,newSecretPatterns:0},self:'docs/V76_RELEASE_INVENTORY.json (generated inventory; no recursive hash)'};
if(process.argv.includes('--write'))fs.writeFileSync('docs/V76_RELEASE_INVENTORY.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({candidateFiles:files.length,excludedUntracked:report.excludedUntrackedCount,...report.checks}));
