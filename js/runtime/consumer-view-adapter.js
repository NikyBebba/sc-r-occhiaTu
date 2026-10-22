'use strict';
// Dormant presentation only. Every relation comes from an immutable facade.
const ConsumerViewAdapter = (() => {
  if (!(typeof module !== 'undefined' && module.exports) && 'ConsumerViewAdapter' in globalThis) throw new TypeError('ConsumerViewAdapter namespace already installed');
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const item of Object.values(value)) freeze(item);
      Object.freeze(value);
    }
    return value;
  };
  function createConsumerView(bundle, { labels = {} } = {}) {
    if (!bundle || !Object.isFrozen(bundle)) throw new TypeError('Immutable ConsumerFacade bundle required');
    const names = Object.freeze({ N: typeof labels.N === 'string' ? labels.N : null, V: typeof labels.V === 'string' ? labels.V : null });
    if (bundle.kind !== 'AVAILABLE') return freeze({ kind: bundle.kind, reason: bundle.reason, freshness: bundle.freshness });
    const identity = personId => {
      const item = bundle.people.getIdentity(personId);
      return freeze({ ...item, label: item.legacyLabel === null ? null : names[item.legacyLabel] ?? item.legacyLabel });
    };
    const context = freeze({ ...bundle.context, caller: identity(bundle.context.caller.personId), observedPerson: identity(bundle.context.observedPerson.personId) });
    const eventViews = new Map();
    const eventView = item => {
      const event = item.event;
      if (!eventViews.has(event.night_id)) eventViews.set(event.night_id, freeze({
        eventId: event.night_id, movieId: event.movie_id, event, participants: item.participants,
        content: bundle.catalog.getContent(event.movie_id)
      }));
      return eventViews.get(event.night_id);
    };
    const completedEvents = Object.freeze(bundle.memories.completedEvents.map(eventView));
    const scheduledEvents = Object.freeze(bundle.group.scheduledEvents.map(eventView));
    const card = movieId => {
      const found = bundle.catalog.getContent(movieId);
      if (found.kind !== 'AVAILABLE') return found;
      const events = bundle.group.getEventsForMovie(movieId);
      const candidacy = bundle.group.getCandidacy(movieId);
      return freeze({ kind: 'AVAILABLE', movieId, content: found.content,
        personal: { caller: bundle.personal.getState(context.caller.personId, movieId), observed: bundle.personal.getState(context.observedPerson.personId, movieId) },
        group: { candidacy, rewatch: bundle.group.getRewatchState(movieId), judgment: bundle.group.getJudgment(movieId),
          events: events.events.map(eventView), hasTogetherHistory: events.events.some(item => item.event.status === 'completed') },
        // Presentable intents only; never server permissions or guard replicas.
        intents: { group: candidacy.actions, personalActorId: context.caller.personId }
      });
    };
    return freeze({ kind: 'AVAILABLE', context, freshness: bundle.freshness,
      counts: bundle.counts, catalog: bundle.catalog, personal: bundle.personal, group: bundle.group,
      home: { personal: { caller: bundle.personal.caller.kind === 'AVAILABLE' ? freeze({ kind: 'AVAILABLE', counts: bundle.personal.caller.counts }) : bundle.personal.caller,
        observed: bundle.personal.observed.kind === 'AVAILABLE' ? freeze({ kind: 'AVAILABLE', counts: bundle.personal.observed.counts }) : bundle.personal.observed },
        counts: bundle.counts, memories: { completedEvents: bundle.counts.completedEvents, togetherFilms: bundle.counts.togetherFilms } },
      events: { scheduled: scheduledEvents, completed: completedEvents }, memories: { completedEvents }, statistics: bundle.statistics,
      search: { contents: bundle.catalog.contents },
      ruota: { eligibleContents: bundle.ruota.eligibleContents, eligibleMovieIds: bundle.ruota.eligibleContents.map(item => item.movie_id) },
      getCard: card,
      getEvent(eventId) {
        if (eventViews.has(eventId)) return freeze({ kind: 'AVAILABLE', event: eventViews.get(eventId) });
        for (const content of bundle.catalog.contents) {
          const item = bundle.group.getEventsForMovie(content.movie_id).events.find(item => item.event.night_id === eventId);
          if (item) return freeze({ kind: 'AVAILABLE', event: eventView(item) });
        }
        return Object.freeze({ kind: 'NOT_IN_CONTEXT' });
      },
      getIdentity: identity, getVetoForMovie: bundle.getVetoForMovie,
      getRecommendationInput: bundle.getRecommendationInput, getMatchInput: bundle.getMatchInput
    });
  }
  return Object.freeze({ createConsumerView });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ConsumerViewAdapter;
