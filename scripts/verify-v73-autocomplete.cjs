'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const autocomplete=require('../js/ui/history-autocomplete.js');
const html=fs.readFileSync('index.html','utf8'),sw=fs.readFileSync('service-worker.js','utf8');
const source=path=>fs.readFileSync(path,'utf8');
const ranked=autocomplete.rank([
  {snack:'Popcorn',date:'2025-01-01',created_at:'2025-01-01T20:00:00Z'},
  {snack:'popcorn',date:'2026-01-01',created_at:'2026-01-01T20:00:00Z'},
  {snack:'Poke',date:null,created_at:'2026-03-01T20:00:00Z'},
  {snack:'POKE',date:null,created_at:'2026-02-01T20:00:00Z'},
  ...Array.from({length:7},(_,i)=>({snack:'Po Snack '+i,date:`2026-0${(i%8)+1}-01`,created_at:'2026-01-01T00:00:00Z'}))
],'snack','po');
assert.equal(ranked.length,5);assert.equal(ranked[0],'Poke');assert.equal(ranked[1],'popcorn');assert.equal(ranked[2],'Po Snack 6');
assert.equal(new Set(ranked.map(value=>value.toLocaleLowerCase('it'))).size,ranked.length);
assert.deepEqual(autocomplete.rank([{location:'Sala'}],'location','s'),[]);
for(const field of ['scheduleCustomSnack','scheduleLocation','reviewSnack','reviewLocation','pastNightSnack','pastNightLocation','pastEditSnack','pastEditLocation']){
  assert.match(html,new RegExp(`id="${field}"`),`${field} exists`);
  const list=field==='scheduleCustomSnack'?'scheduleSnackSuggestions':`${field}Suggestions`;
  assert.match(html,new RegExp(`aria-controls="${list}"`),`${field} has combobox list relation`);
}
assert.match(source('js/ui/actions/nights.js'),/HistoryAutocomplete\.bind\(document\.getElementById\('scheduleCustomSnack'\)/);
assert.match(source('js/ui/actions/viewing.js'),/HistoryAutocomplete\.bind\(document\.getElementById\('reviewSnack'\)/);
assert.match(source('js/ui/product-editors.js'),/bindNightSuggestions\(el,\(\)=>context\.nights\)/);
assert.match(source('js/ui/cap1-nights.js'),/historyAutocomplete\.bind\(el\(prefix\+name\)/);
assert.match(html,/data-client-build="protocol-v1-v73"/);assert.match(sw,/scorochiatu-shell-v73/);assert.match(sw,/\/js\/ui\/history-autocomplete\.js/);
console.log('V73_AUTOCOMPLETE_STATIC_PASS: ranking, form coverage, providers and PWA shell');
if(process.argv.includes('--browser'))(async()=>{
  const {chromium}=require('/private/tmp/sc-playwright-driver/node_modules/playwright-core');
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:760},hasTouch:true});
    const fields=['scheduleCustomSnack','scheduleLocation','reviewSnack','reviewLocation','pastNightSnack','pastNightLocation','pastEditSnack','pastEditLocation'];
    const form=fields.map(id=>{const list=id==='scheduleCustomSnack'?'scheduleSnackSuggestions':`${id}Suggestions`;return `<label for="${id}">${id}</label><input id="${id}" role="combobox" aria-expanded="false" aria-controls="${list}"><div id="${list}" class="suggestions hidden" role="listbox"></div>`;}).join('');
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:8px;font:16px sans-serif}.field{width:100%}.suggestions{max-height:180px;overflow:auto;border:1px solid #555}.suggestions button{display:block;width:100%;min-height:44px;text-align:left}.hidden{display:none}</style>${form}`);
    await page.addScriptTag({path:require.resolve('../js/ui/history-autocomplete.js')});
    await page.evaluate(fields=>{
      window.scope={nights:[{snack:'Popcorn',location:'Cinema',date:'2025-01-01'},{snack:'popcorn',location:'cinema',date:'2026-01-01'},{snack:'Poke',location:'Casa',date:null,created_at:'2026-03-01T00:00:00Z'}]};
      for(const id of fields){const field=id.toLowerCase().includes('snack')?'snack':'location',list=id==='scheduleCustomSnack'?'scheduleSnackSuggestions':id+'Suggestions';HistoryAutocomplete.bind(document.getElementById(id),document.getElementById(list),field,()=>window.scope.nights);}
    },fields);
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:760});
      for(const id of fields){
        const input=page.locator('#'+id);await input.fill(id.toLowerCase().includes('snack')?'po':'ci');
        const list=id==='scheduleCustomSnack'?'scheduleSnackSuggestions':`${id}Suggestions`;
        assert.equal(await page.locator('#'+list+' [role="option"]').count(),id.toLowerCase().includes('snack')?2:1);
        await input.press('ArrowDown');await input.press('Enter');
        assert.equal(await input.inputValue(),id.toLowerCase().includes('snack')?'popcorn':'cinema');
        await input.fill('zz');assert.equal(await input.inputValue(),'zz','free text remains unchanged');
        assert.equal(await page.locator('#'+list).isVisible(),false);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no horizontal overflow at ${width}px`);
    }
    const mouseInput=page.locator('#scheduleCustomSnack');await mouseInput.fill('po');await page.locator('#scheduleSnackSuggestions button').first().click();assert.equal(await mouseInput.inputValue(),'popcorn','mouse selection');
    const input=page.locator('#pastNightLocation');await input.fill('ci');
    await page.evaluate(()=>{scope.nights=[{location:'Cinema nuovo',date:'2026-04-01'}];HistoryAutocomplete.refreshAll();});
    assert.equal(await input.inputValue(),'ci','resync does not replace draft');assert.equal(await page.locator('#pastNightLocationSuggestions button').innerText(),'Cinema nuovo');
    await input.fill('ci');await page.locator('#pastNightLocationSuggestions button').tap();assert.equal(await input.inputValue(),'Cinema nuovo','touch selection');
    console.log('V73_AUTOCOMPLETE_BROWSER_PASS: all eight field bindings, keyboard, mouse/touch selection, free typing and 320/390/1280px');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
