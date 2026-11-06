'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const cap1=require('../js/ui/cap1-nights.js');
const nights=[
  {location:'Cinema',snack:'Popcorn',date:'2024-01-01'},
  {location:'cinema',snack:'popcorn',date:'2025-01-01'},
  {location:'Casa',snack:'Popcorn',date:'2026-01-01'},
  {location:'Cinemino',date:'2026-02-01'},
  {location:'Cineforum',date:'2026-03-01'},
  {location:'Cineclub',date:null,created_at:'2026-04-01T10:00:00Z'},
  {location:'Cinepark',date:'2026-05-01'},
  {location:'Cineplex',date:'2026-06-01'}
];
assert.deepEqual(cap1.rankHistorySuggestions(nights,'location','c'),[]);
assert.deepEqual(cap1.rankHistorySuggestions(nights,'location','ci'),['cinema','Cineplex','Cinepark','Cineclub','Cineforum']);
assert.deepEqual(cap1.rankHistorySuggestions(nights,'snack','po'),['Popcorn']);
const html=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('css/style.css','utf8'),js=fs.readFileSync('js/ui/cap1-nights.js','utf8');
const cards=fs.readFileSync('js/ui/render/cards.js','utf8');
assert.match(cards,/class="fa-solid fa-users"/);assert.doesNotMatch(cards,/<span>Insieme<\/span>/);
const groupIcon='<i class="fa-solid fa-users" aria-hidden="true"></i>';
assert.match(html,/<details class="cap1-accordion" id="pastNightEvaluation">/);
assert.match(html,/<details class="cap1-accordion" id="pastNightDetails" open>/);
const evaluation=html.slice(html.indexOf('<details class="cap1-accordion" id="pastNightEvaluation">'),html.indexOf('<details class="cap1-accordion" id="pastNightDetails"'));
assert.match(evaluation,/<fieldset id="pastNightEvaluationContent" class="cap1-fields">/);
assert.match(evaluation,/id="pastNightTogetherRating"/);assert.match(evaluation,/id="pastNightTogetherReview"/);
assert.doesNotMatch(evaluation,/sola lettura|Modifica in arrivo|salvataggio separato|non viene salvato con la serata/);
for(const prefix of ['pastNight','pastEdit'])for(const field of ['Location','Snack']){
  assert.match(html,new RegExp('id="'+prefix+field+'"[^>]*aria-controls="'+prefix+field+'Suggestions"'));
  assert.match(js,new RegExp("bindAutocomplete\\('"+prefix+"','"+field.toLowerCase()+"'\\)"));
}
assert.match(css,/\.together-cluster \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(js,/perform\('recordPastTogether',selectedMovieId,input\)/);
assert.doesNotMatch(js,/perform\('setGroup(?:Rating|Review|Evaluation)'/);
console.log('V72_FRONTEND_PASS ranking, scope, form structure and optional atomic evaluation');
if(process.argv.includes('--browser'))(async()=>{
  const {chromium}=require('/private/tmp/sc-playwright-driver/node_modules/playwright-core');
  const browser=await chromium.launch({headless:true});
  try{const page=await browser.newPage();const form=html.slice(html.indexOf('<div id="pastNightModal"'),html.indexOf('<div id="nightDetailModal"'));
    await page.setContent('<style>'+css+'</style>'+form+'<span id="groupIconReference">'+groupIcon+' Gruppo</span><div class="personal-tokens together-cluster"><button class="person-token"><span class="person-token-face">N</span></button><button class="together-star" aria-label="Apri Insieme">'+groupIcon+'<span class="together-rating">★ 10</span></button><button class="person-token"><span class="person-token-face">V</span></button></div>');
    await page.addStyleTag({url:'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'});
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('#pastNightEvaluation').evaluate(e=>e.open),false);
    assert.equal(await page.locator('#pastNightDetails').evaluate(e=>e.open),true);
    await page.locator('#pastNightEvaluation summary').click();
    assert.equal(await page.locator('#pastNightEvaluation').evaluate(e=>e.open),true);
    assert.equal(await page.locator('#pastNightDetails').evaluate(e=>e.open),true);
    await page.evaluate(()=>{window.escapeHtml=x=>String(x);window.formatMovieRating=x=>Number(x).toLocaleString('it-IT',{maximumFractionDigits:1});window.parseMovieRating=x=>/^\d{1,2}(?:[.,]\d)?$/.test(x.trim())&&Number(x.replace(',','.'))<=10?Number(x.replace(',','.')):null;window.openModal=id=>document.getElementById(id).classList.remove('hidden');window.closeModal=()=>{};});
    await page.addScriptTag({content:js});
    await page.evaluate(()=>{const nights=[{location:'Cinema',snack:'Popcorn',date:'2025-01-01'},{location:'cinema',snack:'popcorn',date:'2026-01-01'}];const view={context:{temporal:{local_date:'2026-11-06'}},getRecommendationInput:()=>({input:{users:[{id:'n'},{id:'v'}]}}),getIdentity:id=>({label:id})};const movie={id:'film-1',title:'Film sintetico',release_year:2024,poster:null};const ctx={view,nights,movies:[movie],getMovie:id=>id===movie.id?movie:null,hidden:()=>false,togetherRating:()=>8.9,reviewTextFor:()=> 'Recensione esistente'};window.cap1TestContext=ctx;window.cap1Calls=[];const session={getState:()=>({phase:'READY',view:{kind:'AVAILABLE',context:{contractVersion:2},freshness:{source:'ONLINE'}},runtime:{source:'ONLINE'}}),capture:()=>({}),current:()=>true};window.cap1Test=Cap1Nights.create({root:document,session,context:()=>ctx,perform:async(name,id,input)=>{cap1Calls.push({name,id,input});return {outcome:'TRANSPORT_UNCERTAIN'};},waitFor:()=>{}});cap1Test.openRegistration();});
    assert.equal(await page.locator('#pastNightTogetherRating').inputValue(),'');assert.equal(await page.locator('#pastNightTogetherReview').inputValue(),'');
    await page.locator('#pastNightSearch').fill('Film sintetico');await page.locator('#pastNightResults button').click();
    assert.equal(await page.locator('#pastNightTogetherRating').inputValue(),'8,9');assert.equal(await page.locator('#pastNightTogetherReview').inputValue(),'Recensione esistente');
    assert.equal(await page.locator('#pastNightTogetherRating').isEnabled(),true);assert.equal(await page.locator('#pastNightTogetherReview').isEnabled(),true);
    await page.locator('#pastNightUnknown').check();
    await page.evaluate(()=>document.getElementById('pastNightSave').onclick());
    assert.equal(await page.evaluate(()=>cap1Calls[0].name),'recordPastTogether');
    assert.equal(await page.evaluate(()=>Object.hasOwn(cap1Calls[0].input,'evaluation')),false);
    await page.locator('#pastNightEvaluation summary').click();
    await page.locator('#pastNightTogetherRating').fill('7,2');await page.locator('#pastNightTogetherReview').fill('');
    await page.evaluate(()=>document.getElementById('pastNightSave').onclick());
    assert.deepEqual(await page.evaluate(()=>cap1Calls[1].input.evaluation),{rating:7.2,review:null});
    await page.locator('#pastNightTogetherRating').fill('7,22');
    await page.evaluate(()=>document.getElementById('pastNightSave').onclick());
    assert.equal(await page.evaluate(()=>cap1Calls.length),2);
    await page.evaluate(()=>{cap1TestContext.togetherRating=()=>null;cap1TestContext.reviewTextFor=()=>'';cap1Test.openRegistration();});
    await page.locator('#pastNightSearch').fill('Film sintetico');await page.locator('#pastNightResults button').click();
    assert.equal(await page.locator('#pastNightTogetherRating').inputValue(),'');assert.equal(await page.locator('#pastNightTogetherReview').inputValue(),'');
    await page.locator('#pastNightLocation').fill('ci');assert.equal(await page.locator('#pastNightLocationSuggestions [role=option]').count(),1);
    await page.locator('#pastNightLocation').press('ArrowDown');await page.locator('#pastNightLocation').press('Enter');assert.equal(await page.locator('#pastNightLocation').inputValue(),'cinema');
    await page.locator('#pastNightSnack').fill('Nuovo snack');assert.equal(await page.locator('#pastNightSnack').inputValue(),'Nuovo snack');
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:800});await page.locator('.together-star').evaluate(e=>{if(!e.querySelector('.together-rating'))e.insertAdjacentHTML('beforeend','<span class="together-rating">★ 10</span>');});for(const missing of [false,true]){if(missing)await page.locator('.together-rating').evaluate(e=>e.remove());const layout=await page.locator('.together-cluster').evaluate(e=>{const cells=[...e.children].map(x=>x.getBoundingClientRect()),icon=e.querySelector('.together-star .fa-users'),box=icon.getBoundingClientRect();return {width:e.getBoundingClientRect().width,columns:getComputedStyle(e).gridTemplateColumns.split(' ').map(parseFloat),overflow:e.scrollWidth>e.clientWidth,centers:cells.map(x=>x.y+x.height/2),singleRow:cells.every(x=>Math.abs(x.y-cells[0].y)<2),noWrap:[...e.children].every(x=>getComputedStyle(x).flexWrap!=='wrap'),iconVisible:box.width>0&&box.height>0&&getComputedStyle(icon,'::before').content===getComputedStyle(document.querySelector('#groupIconReference .fa-users'),'::before').content&&getComputedStyle(icon,'::before').content!=='none'&&document.fonts.check('900 12px "Font Awesome 6 Free"'),iconFirst:e.querySelector('.together-star').firstElementChild===icon};});assert.equal(layout.columns.length,3);assert.ok(Math.max(...layout.columns)-Math.min(...layout.columns)<2);assert.ok(Math.max(...layout.centers)-Math.min(...layout.centers)<2);assert.equal(layout.singleRow,true);assert.equal(layout.noWrap,true);assert.equal(layout.overflow,false);assert.equal(layout.iconVisible,true);assert.equal(layout.iconFirst,true);}}
    console.log('V72_BROWSER_PASS accordions, autocomplete keyboard/free text and pill at 320/390/1280');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
