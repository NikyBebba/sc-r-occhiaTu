#!/usr/bin/env node
// Moduli reali, SDK sintetico: solo patch di valutazione, nessun I/O remoto.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const context = {
  console, movies: [], movieNights: [], currentUser: 'N', authEpoch: 1,
  CONFIG: { PEOPLE: { N: { label: 'N' }, V: { label: 'V' } } },
  requireAppIdentity() {}, assertAuthEpoch() {}, handleDataAuthError() {},
  isAppAuthorized: () => true, saveLocal() {}, loads: 0, calls: [], dialogs: [], errors: [],
  loadMovies: async () => { context.loads++; }, showActionError: message => context.errors.push(message),
  document: { getElementById: () => ({ classList: { contains: () => true } }) },
  closeModalNow() {}, sharedPeopleLabel: () => 'N+V',
  showConfirmModal: async (...args) => { context.dialogs.push(args); return typeof context.answer === 'function' ? context.answer() : context.answer; }
};
context.sb = { from(table) {
  assert.equal(table, 'movies');
  return { update(patch) { context.calls.push(structuredClone(patch)); return { eq(column, id) {
    assert.equal(column, 'id');
    Object.assign(context.movies.find(movie => movie.id === id), patch);
    return { select: async () => ({ data: [{ id }], error: null }) };
  } }; } };
} };
vm.createContext(context);
for (const file of ['js/format.js', 'js/store/viewing.js', 'js/store/movies.js', 'js/ui/actions/viewing.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const baseline = { id: 'scary', tmdb_id: 4247, title: 'Scary Movie', seen_n: true, seen_v: false,
  seen_rating_n: 7.3, review_text_n: 'CULT', seen_rating_v: 6.1, review_text_v: 'Testo V',
  seen_rating_together: 8.2, review_text_together: 'Testo condiviso', in_shared_list: false, status: 'watched' };
function reset(person = 'N') {
  context.currentUser = person; context.movies = [structuredClone(baseline)];
  context.movieNights = [{ id: 'completed', movie_id: 'scary', status: 'completed' }];
  context.calls = []; context.dialogs = []; context.errors = []; context.authEpoch = 1; context.loads = 0;
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  for (const person of ['N', 'V']) for (const by of [person, 'both']) for (const part of ['rating', 'text', 'both']) {
    await test(`${person}/${by}: remove ${part}, exact patch and no other changes`, async () => {
      reset(person); context.answer = part;
      const before = structuredClone(context.movies[0]), nights = structuredClone(context.movieNights);
      await context.removeEvaluationUI('scary', by);
      const suffix = by === 'both' ? 'together' : by.toLowerCase();
      const patch = by === 'both' ? {} : { ['seen_rating_' + suffix]: part === 'text' ? before['seen_rating_' + suffix] : null };
      if (by === 'both' && part !== 'text') patch.seen_rating_together = null;
      if (part !== 'rating') patch['review_text_' + suffix] = '';
      assert.deepEqual(context.calls, [patch]); assert.deepEqual(context.movies[0], { ...before, ...patch });
      assert.deepEqual(context.movieNights, nights); assert.equal(context.loads, 1);
      assert.deepEqual(Array.from(context.dialogs[0][2], option => option.value), ['rating', 'text', 'both']);
    });
  }
  for (const person of ['N', 'V']) for (const by of [person, 'both']) for (const only of ['rating', 'text']) {
    await test(`${person}/${by}: only ${only}, confirm or cancel`, async () => {
      reset(person); const suffix = by === 'both' ? 'together' : by.toLowerCase();
      context.movies[0]['seen_rating_' + suffix] = only === 'rating' ? 0 : null;
      context.movies[0]['review_text_' + suffix] = only === 'text' ? 'Solo testo' : '';
      context.answer = false; const before = structuredClone(context.movies[0]);
      await context.removeEvaluationUI('scary', by); assert.deepEqual(context.calls, []); assert.deepEqual(context.movies[0], before);
      assert.equal(context.dialogs[0][2], undefined);
      context.answer = true; await context.removeEvaluationUI('scary', by); assert.equal(context.calls.length, 1);
      assert.equal(context.movies[0]['seen_rating_' + suffix], null); assert.equal(context.movies[0]['review_text_' + suffix], '');
      assert.equal(context.movies[0].seen_n, true); assert.equal(context.movies[0].seen_v, false);
    });
  }
  await test('Cancel multi-choice, changed Auth epoch, missing data and invalid context never write', async () => {
    for (const answer of [false, () => { context.authEpoch++; return 'both'; }]) {
      reset(); context.answer = answer; await context.removeEvaluationUI('scary', 'N'); assert.deepEqual(context.calls, []);
    }
    reset(); context.answer = 'both'; await context.removeEvaluationUI('scary', 'V'); assert.deepEqual(context.calls, []); assert.deepEqual(context.dialogs, []);
    assert.equal(await context.removeEvaluationData('scary', 'V', 'both'), false);
    assert.equal(await context.removeEvaluationData('scary', 'N', 'invalid'), false);
    context.movieNights = []; assert.equal(await context.removeEvaluationData('scary', 'both', 'both'), false);
    context.movies[0].seen_rating_n = null; context.movies[0].review_text_n = '';
    await context.removeEvaluationUI('scary', 'N'); assert.deepEqual(context.calls, []); assert.deepEqual(context.dialogs, []);
  });
  await test('Existing personal removal entry points reuse isolated patches', async () => {
    reset(); context.answer = true; await context.removePersonalRating('scary');
    assert.deepEqual(context.calls, [{ seen_rating_n: null }]); assert.equal(context.movies[0].review_text_n, 'CULT');
    reset(); context.answer = true; await context.removePersonalText('scary');
    assert.deepEqual(context.calls, [{ seen_rating_n: 7.3, review_text_n: '' }]);
  });
  console.log(`Evaluation removal: ${checks}/${checks} PASS; all writes simulated`);
})().catch(error => { console.error(error); process.exitCode = 1; });
