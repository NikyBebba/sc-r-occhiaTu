'use strict';
// Shadow-only derived views. No runtime registration and no persistence APIs.
const Core = require('./core');
const Recommendation = require('../recommendation/adapters');
const freeze = x => {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
  return x;
};
// Copy data, not Recommendation semantics: retain undefined and every numeric
// value so the existing engine remains responsible for semantic rejection.
function copyConstraints(input) {
  const plain = x => x !== null && typeof x === 'object' &&
    (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
  const ancestors = new Set();
  function copy(value) {
    if (value === null || ['undefined', 'string', 'boolean', 'number'].includes(typeof value)) return value;
    const array = Array.isArray(value);
    if ((!array && !plain(value)) || ancestors.has(value)) throw new TypeError('Unsupported constraint structure');
    if (array && Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('Unsupported constraint array prototype');
    ancestors.add(value);
    const out = array ? [] : Object.create(Object.getPrototypeOf(value));
    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) throw new TypeError('Dense constraint array required');
    const copyProperty = key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('Constraint data property required');
      Object.defineProperty(out, key, { value: copy(d.value), enumerable: true, writable: true, configurable: true });
    };
    if (array) for (let i = 0; i < value.length; i++) copyProperty(String(i));
    else for (const key of keys) {
      if (typeof key !== 'string') throw new TypeError('Constraint string key required');
      copyProperty(key);
    }
    ancestors.delete(value);
    return out;
  }
  return copy(input);
}
function createProjection(root) {
  Core.getPerson(root, root.context.callerId); // Require the decoded immutable facade.
  const s = root.snapshot, byMovie = new Map(s.catalog.map(m => [m.movie_id, m]));
  const tags = new Map(), persons = new Map(s.people.map(p => [p.person_id, p]));
  for (const p of s.people) if (p.legacy_person !== null) {
    if (tags.has(p.legacy_person)) throw new TypeError('Ambiguous legacy mapping');
    tags.set(p.legacy_person, p.person_id);
  }
  const legacyPerson = id => persons.get(id)?.legacy_person ?? null;
  const missingMappings = ['N', 'V'].filter(tag => !tags.has(tag) || !Core.getPersonalView(root, tags.get(tag)));
  const movies = s.catalog.map(m => {
    const { movie_id, added_by_person_id, surprise_by_person_id, metadata_matched, ...content } = m;
    const row = { ...content, id: movie_id, added_by: legacyPerson(added_by_person_id),
      surprise_by: legacyPerson(surprise_by_person_id), matched: metadata_matched,
      in_shared_list: Core.getGroupState(root, movie_id).effective_candidacy };
    for (const tag of ['N', 'V']) {
      const state = tags.has(tag) ? Core.getPersonalState(root, tags.get(tag), movie_id) : null;
      const suffix = tag.toLowerCase();
      row['seen_' + suffix] = state?.seen ?? null;
      row['seen_rating_' + suffix] = state?.judgment?.rating ?? null;
      row['personal_liked_' + suffix] = state?.judgment?.preference ?? null;
      row['review_text_' + suffix] = state?.judgment?.review ?? null;
    }
    const judgment = Core.getGroupJudgment(root, movie_id);
    row.seen_rating_together = judgment?.rating ?? null;
    row.review_text_together = judgment?.review ?? null;
    return freeze(row);
  });
  const movieNights = s.nights.map(n => {
    const { night_id, proposed_by_person_id, ...fields } = n;
    return freeze({ ...fields, id: night_id, proposed_by: legacyPerson(proposed_by_person_id) });
  });
  const vetoes = s.vetoes.map(v => freeze({ id: v.veto_id, movie_id: v.movie_id,
    person_id: v.person_id, person: legacyPerson(v.person_id), week_key: v.week_key }));
  const collection = ids => Object.freeze(ids.map(id => byMovie.get(id)));
  const personalMovies = (id, key) => {
    const view = Core.getPersonalView(root, id);
    return view ? freeze({ kind: 'AVAILABLE', movies: collection(view.collections[key]) }) : freeze({ kind: 'OUT_OF_COVERAGE' });
  };
  const movieParticipants = new Map(s.catalog.map(m => [m.movie_id, []]));
  for (const n of s.nights) if (n.status === 'completed') movieParticipants.get(n.movie_id).push(
    freeze({ night_id: n.night_id, participants: Core.getParticipants(root, n.night_id) }));
  for (const rows of movieParticipants.values()) Object.freeze(rows);
  const selectors = freeze({
    getPersonalSeenMovies: id => personalMovies(id, 'seen_movie_ids'),
    getPersonalListMovies: id => personalMovies(id, 'list_movie_ids'),
    getVisibleGroupListMovies: () => collection(s.group.collections.list_movie_ids),
    getScheduledNights: () => Object.freeze(s.group.collections.scheduled_night_ids.map(id => Core.getNight(root, id))),
    getTogetherMovies: () => collection(s.group.collections.together_movie_ids),
    getRewatchMovies: () => collection(s.group.collections.rewatch_movie_ids),
    getRewatchState: id => {
      const g = Core.getGroupState(root, id);
      return g ? freeze({ semantic: g.rewatch_semantic, visible: g.rewatch_visible }) : null;
    },
    getNightParticipants: id => Core.getParticipants(root, id),
    getMovieParticipants: id => { Core.getContent(root, id); return movieParticipants.get(id) ?? null; },
    getMatchBaseEligibility: id => Core.getGroupState(root, id)?.eligibility.match_base ?? null,
    getRuotaBaseEligibility: id => Core.getGroupState(root, id)?.eligibility.ruota_base ?? null
  });
  return freeze({ context: root.context,
    legacy: { mappingStatus: missingMappings.length ? 'PARTIAL' : 'COMPLETE', missingMappings, movies, movieNights, vetoes },
    selectors,
    getRecommendationInput: ({ constraints = { context: 'streaming' } } = {}) => {
      if (missingMappings.length) return freeze({ kind: 'LEGACY_MAPPING_UNAVAILABLE' });
      const ownedConstraints = copyConstraints(constraints);
      return freeze({ kind: 'AVAILABLE', input: Recommendation.fromMovies({ movies, movieNights,
        userIds: { N: tags.get('N'), V: tags.get('V') }, groupId: root.context.groupId, constraints: ownedConstraints }) });
    },
    getMatchInputs: () => freeze({ context: root.context, temporal: s.temporal, content: s.catalog,
      matchBaseIds: s.group.states.filter(g => g.eligibility.match_base).map(g => g.movie_id), vetoes: s.vetoes })
  });
}
module.exports = Object.freeze({ createProjection });
