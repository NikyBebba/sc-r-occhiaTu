'use strict';
// Dormant read adapter. Input is one captured TargetRuntime.getState() result,
// supplied by a trusted host; this facade is neither Auth nor a wire decoder.
const ConsumerFacade = (() => {
  const commonJS = typeof module !== 'undefined' && !!module.exports;
  if (!commonJS && 'ConsumerFacade' in globalThis) throw new TypeError('ConsumerFacade namespace already installed');
  const Core = commonJS ? require('../snapshot/core') : (typeof SnapshotCore !== 'undefined' ? SnapshotCore : null);
  if (!Core || typeof Core.getGroupState !== 'function') throw new TypeError('ConsumerFacade requires SnapshotCore');
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const item of Object.values(value)) freeze(item);
      Object.freeze(value);
    }
    return value;
  };
  const uuid = value => { if (!Core.validateUUID(value).ok) throw new TypeError('Canonical UUID required'); return value; };
  const same = (a, b) => a && b && ['callerId', 'groupId', 'contractVersion', 'contextEpoch'].every(k => a[k] === b[k]);
  const missing = Object.freeze({ kind: 'NOT_IN_CATALOG' });
  const uncovered = Object.freeze({ kind: 'OUT_OF_COVERAGE' });
  function createConsumerBundle(runtimeState, { observedPersonId = null } = {}) {
    if (observedPersonId !== null) uuid(observedPersonId);
    const state = runtimeState?.controllerState;
    if (!Object.isFrozen(runtimeState) || !state || !Object.isFrozen(state) ||
      !Object.isFrozen(state.freshness) || !Object.isFrozen(state.pending)) throw new TypeError('Captured immutable runtime state required');
    const view = state.view;
    // Expose the existing status/source/pending values, never infer freshness
    // from the catalog or convert CACHE into ONLINE. Intent hints are not ACLs.
    const freshness = freeze({ runtimePhase: runtimeState.phase, controllerStatus: state.status,
      source: view?.source ?? null, freshness: state.freshness, pending: state.pending });
    if (!view) return freeze({ kind: 'UNAVAILABLE', reason: 'NO_COMMITTED_VIEW', freshness });
    const { root, projection, selectors } = view;
    if (!Object.isFrozen(view) || !['ONLINE', 'CACHE'].includes(view.source) ||
      !same(state.context, root?.context) || !same(projection?.context, root.context) ||
      !Object.isFrozen(projection) || selectors !== projection.selectors) throw new TypeError('Coherent committed bundle required');
    Core.getPerson(root, root.context.callerId);
    const snapshot = root.snapshot;
    const available = value => freeze({ kind: 'AVAILABLE', ...value });
    const identity = personId => {
      uuid(personId); const person = Core.getPerson(root, personId);
      return freeze({ kind: person ? 'KNOWN' : 'UNKNOWN', personId, legacyLabel: person?.legacy_person ?? null });
    };
    const content = movieId => { uuid(movieId); const item = Core.getContent(root, movieId); return item ? available({ content: item }) : missing; };
    const personal = personId => {
      uuid(personId);
      if (!Core.getPersonalView(root, personId)) return uncovered;
      const list = selectors.getPersonalListMovies(personId).movies;
      const seen = selectors.getPersonalSeenMovies(personId).movies;
      return available({ person: identity(personId), list, seen, counts: { listFilms: list.length, seenFilms: seen.length } });
    };
    const personalState = (personId, movieId) => {
      uuid(personId); uuid(movieId);
      if (!Core.getPersonalView(root, personId)) return uncovered;
      if (!Core.getContent(root, movieId)) return missing;
      const item = Core.getPersonalState(root, personId, movieId);
      // Do not flatten unknown/null judgments or export intention generations.
      return available({ personId, movieId, seen: item.seen, list: { active: item.list.active }, judgment: item.judgment });
    };
    const events = snapshot.nights.map(night => freeze({ event: night, participants: Core.getParticipants(root, night.night_id) }));
    const byNight = new Map(events.map(item => [item.event.night_id, item]));
    const completedEvents = Object.freeze(events.filter(item => item.event.status === 'completed'));
    const scheduledEvents = Object.freeze(selectors.getScheduledNights().map(night => byNight.get(night.night_id)));
    const visibleList = selectors.getVisibleGroupListMovies();
    const rewatch = selectors.getRewatchMovies();
    const togetherFilms = selectors.getTogetherMovies();
    const candidacy = movieId => {
      uuid(movieId); if (!Core.getContent(root, movieId)) return missing;
      const group = Core.getGroupState(root, movieId);
      return available({ movieId, effectiveCandidacy: group.effective_candidacy, listVisible: group.list_visible,
        activeNightIds: group.active_night_ids, actions: { propose: 'PROPOSE_TO_GROUP',
          withdraw: group.effective_candidacy ? 'WITHDRAW_GROUP_CANDIDACY' : null } });
    };
    const rewatchState = movieId => {
      uuid(movieId); return Core.getContent(root, movieId) ? available({ state: selectors.getRewatchState(movieId) }) : missing;
    };
    const groupJudgment = movieId => {
      uuid(movieId); return Core.getContent(root, movieId) ? available({ judgment: Core.getGroupJudgment(root, movieId) }) : missing;
    };
    const eventsForMovie = movieId => {
      uuid(movieId); return Core.getContent(root, movieId) ? available({ events: events.filter(item => item.event.movie_id === movieId) }) : missing;
    };
    const vetoForMovie = movieId => {
      uuid(movieId); return Core.getContent(root, movieId) ? available({ veto: Core.getVetoForMovie(root, movieId) }) : missing;
    };
    const counts = freeze({ catalogFilms: snapshot.catalog.length, groupListFilms: visibleList.length,
      rewatchFilms: rewatch.length, togetherFilms: togetherFilms.length, scheduledEvents: scheduledEvents.length,
      completedEvents: completedEvents.length, participantAttendances: completedEvents.reduce((n, item) => n + item.participants.length, 0) });
    return freeze({ kind: 'AVAILABLE',
      context: { caller: identity(root.context.callerId), observedPerson: identity(observedPersonId ?? root.context.callerId),
        groupId: root.context.groupId, contextEpoch: root.context.contextEpoch, contractVersion: root.context.contractVersion, temporal: snapshot.temporal },
      freshness,
      catalog: { contents: snapshot.catalog, getContent: content },
      people: { identities: snapshot.people.map(person => identity(person.person_id)), getIdentity: identity },
      personal: { caller: personal(root.context.callerId), observed: personal(observedPersonId ?? root.context.callerId), getPerson: personal, getState: personalState },
      group: { visibleList, rewatch, togetherFilms, scheduledEvents, completedEvents,
        getCandidacy: candidacy, getRewatchState: rewatchState, getJudgment: groupJudgment, getEventsForMovie: eventsForMovie },
      counts,
      memories: { completedEvents },
      statistics: { togetherFilms, completedEvents, groupJudgments: snapshot.group.judgments },
      ruota: { eligibleContents: snapshot.catalog.filter(item => selectors.getRuotaBaseEligibility(item.movie_id)) },
      getMatchInput: () => projection.getMatchInputs(),
      getRecommendationInput: options => projection.getRecommendationInput(options),
      getVetoForMovie: vetoForMovie
    });
  }
  return Object.freeze({ createConsumerBundle });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ConsumerFacade;
