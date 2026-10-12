#!/usr/bin/env node
// Pure pagination/pipeline and in-memory state; no network, DB or DOM mutation.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ctx = vm.createContext({ console, setTimeout, clearTimeout, currentTab: 'all', dashboardView: 'library', currentUser: 'N', document: { getElementById: () => null }, movies: [], movieNights: [], activeNights: () => [], normalListEligible: m => m.in_shared_list, isRewatch: () => false, togetherSeen: () => false });
for (const f of ['js/filters.js', 'js/ui/render/library.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const run = code => { const value = vm.runInContext(code, ctx); return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); };
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
for (const n of [0, ...Array.from({length:24},(_,i)=>i+1), 25, 48, 49, 436]) test('Boundaries, disjoint complete pages: ' + n, () => {
  ctx.rows = Array.from({ length: n }, (_, id) => ({ id }));
  const pages = run('Array.from({length:Math.max(1,Math.ceil(rows.length/PAGE_SIZE))},(_,i)=>paginateResults(rows,i))');
  assert.equal(pages.flatMap(p => p.items).length, n);
  assert.equal(new Set(pages.flatMap(p => p.items.map(m => m.id))).size, n);
  for (const [i, p] of pages.entries()) {
    assert(p.items.length <= 24); assert.equal(p.totalResults, n); assert.equal(p.pageIndex, i);
    assert.equal(p.hasPrevious, i > 0); assert.equal(p.hasNext, i + 1 < pages.length);
    assert.equal(p.pageCount, Math.ceil(n / 24)); assert.equal(p.rangeEnd, Math.min(n, (i + 1) * 24));
  }
  assert.equal(ctx.rows.length, n);
});
test('Clamp negative, fractional, invalid and oversized indices', () => {
  ctx.rows = Array.from({ length: 25 }, (_, id) => ({ id }));
  for (const [index, expected] of [['-5',0],['NaN',0],['Infinity',0],['0.9',0],['1.9',1],['999',1]]) assert.equal(run(`paginateResults(rows,${index}).pageIndex`), expected);
});
test('Global query/filter/sort precede pagination, counters and options use full selection', () => {
  ctx.movies = Array.from({ length: 436 }, (_, id) => ({ id, title: 'Film ' + String(id).padStart(3,'0'), genres: [id % 2 ? 'Commedia' : 'Dramma'], added_by: id % 2 ? 'V' : 'N', in_shared_list: true }));
  assert.equal(run("paginateResults(sortMovies(filterMovies(movies,{query:'435'}),'title','asc')).items[0].id"), 435);
  const p = run("paginateResults(sortMovies(filterMovies(movies,{genre:'Commedia'}),'title','desc'),1)");
  assert.equal(p.totalResults,218); assert.equal(p.items[0].id,387);
  const combined = run("paginateResults(sortMovies(filterMovies(movies,{query:'film 4',genre:'Commedia',proposer:'V'}),'title','desc'),1)");
  const expected = ctx.movies.filter(m => m.id % 2 && m.title.includes('4')).reverse();
  assert.equal(combined.totalResults,expected.length); assert.equal(combined.pageIndex,1);
  assert.deepEqual(combined.items.map(m=>m.id),expected.slice(24,48).map(m=>m.id));
  assert.equal(run("deriveFilterOptions(movies).genres.find(g=>g.value==='Commedia').count"),218);
});
test('Independent tabs/history, equivalent render and dataset clamp', () => {
  run("currentTab='all';currentResultsModel(movies);resultPages.get('all').pageIndex=4;currentTab='watchlist';currentResultsModel(movies);resultPages.get('watchlist').pageIndex=1;");
  assert.equal(run("currentTab='all';currentResultsModel(movies).pageIndex"),4);
  assert.equal(run("currentTab='watchlist';currentResultsModel(movies).pageIndex"),1);
  run("currentTab='history_n';currentResultsModel(movies);resultPages.get('history_n').pageIndex=6;currentTab='history_v';currentResultsModel(movies)");
  assert.equal(run("currentTab='history_n';currentResultsModel(movies).pageIndex"),6);
  assert.equal(run("currentResultsModel(movies.slice(0,25)).pageIndex"),1);
  assert.equal(run("currentResultsModel([]).pageCount"),0);
});
test('Criteria invalidate scope without invalidating other scope; reset clears all', () => {
  run("currentTab='all';currentResultsModel(movies);resultPages.get('all').pageIndex=4;resetResultPages('history');currentTab='watchlist'");
  assert.equal(run("currentResultsModel(movies).pageIndex"),1);
  assert.equal(run("currentTab='all';currentResultsModel(movies).pageIndex"),4);
  run("resetResultPages('library')"); assert.equal(run('resultPages.size'),0);
  run("currentResultsModel(movies);resetPaginationUI()"); assert.equal(run('resultPages.size'),0);
});
test('Search callback cannot render after identity generation changes', () => {
  let callback, rendered = 0;
  ctx.setTimeout = fn => { callback = fn; return 1; };
  ctx.clearTimeout = () => {};
  ctx.render = () => rendered++;
  ctx.isAppAuthorized = () => true;
  ctx.authEpoch = 1;
  run('scheduleListingSearch(true)');
  ctx.authEpoch++;
  callback();
  assert.equal(rendered,0);
});
console.log(`Pagination: ${checks}/${checks} PASS`);
