'use strict';
// Dormant semantic actions. Captures reference committed views, never a second
// version store. A host supplies the runtime and a synchronous request UUID source.
const ActionAdapter = (() => {
  const commonJS = typeof module !== 'undefined' && !!module.exports;
  if (!commonJS && 'ActionAdapter' in globalThis) throw new TypeError('ActionAdapter namespace already installed');
  const Core = commonJS ? require('../snapshot/core') : (typeof SnapshotCore !== 'undefined' ? SnapshotCore : null);
  if (!Core || typeof Core.getExpectedRevision !== 'function') throw new TypeError('ActionAdapter requires SnapshotCore');
  const frozen = Object.freeze;
  const fail = code => { throw new TypeError(code); };
  const uuid = value => { if (!Core.validateUUID(value).ok) fail('UUID_REQUIRED'); return value; };
  const fields = (value, allowed, required = []) => {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('OBJECT_REQUIRED');
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!allowed.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value')) fail('UNEXPECTED_FIELD');
    }
    if (required.some(key => !Object.hasOwn(value, key))) fail('MISSING_FIELD');
    return value;
  };
  const same = (a, b) => a && b && ['callerId', 'groupId', 'contractVersion', 'contextEpoch'].every(key => a[key] === b[key]);
  function evaluation(patch, together = false) {
    fields(patch, together ? ['rating', 'review'] : ['rating', 'preference', 'review']);
    if (Object.hasOwn(patch, 'rating') && Object.hasOwn(patch, 'preference')) fail('RATING_PREFERENCE_EXCLUSIVE');
    if (Object.hasOwn(patch, 'rating') && patch.rating !== null &&
      (typeof patch.rating !== 'number' || !Number.isFinite(patch.rating) || patch.rating < 0 || patch.rating > 10 || !Number.isInteger(patch.rating * 10))) fail('INVALID_RATING');
    if (Object.hasOwn(patch, 'preference') && ![null, true, false].includes(patch.preference)) fail('INVALID_PREFERENCE');
    if (Object.hasOwn(patch, 'review') && patch.review !== null && typeof patch.review !== 'string') fail('INVALID_REVIEW');
    return { ...patch };
  }
  function nightDetails(input, keys) {
    fields(input, keys);
    const out = {};
    for (const key of ['date', 'time', 'snack', 'location']) if (Object.hasOwn(input, key)) {
      const value = input[key];
      if (value !== null && typeof value !== 'string') fail('INVALID_NIGHT_FIELD');
      if (key === 'date' && value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_DATE');
      if (key === 'time' && value !== null && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) fail('INVALID_TIME');
      if (value !== null && ((key === 'snack' && value.length > 80) || (key === 'location' && value.length > 120))) fail('INVALID_NIGHT_FIELD');
      out[key] = value;
    }
    return out;
  }
  function participants(values) {
    if (!Array.isArray(values) || !values.length || Object.getPrototypeOf(values) !== Array.prototype || Reflect.ownKeys(values).length !== values.length + 1) fail('EXPLICIT_PARTICIPANTS_REQUIRED');
    const out = [];
    for (let i = 0; i < values.length; i++) {
      const d = Object.getOwnPropertyDescriptor(values, String(i));
      if (!d || !Object.hasOwn(d, 'value')) fail('EXPLICIT_PARTICIPANTS_REQUIRED');
      out.push(uuid(d.value));
    }
    if (new Set(out).size !== out.length) fail('DUPLICATE_PARTICIPANT');
    return out.sort(); // Canonical order only; membership is checked by the server.
  }
  function contentParameters(input, creating) {
    const allowed = ['title', 'duration', 'platform', 'poster', 'trailer_url', 'matched', 'imdb_rating', 'rt_rating', 'metacritic_rating',
      'genre', 'tmdb_id', 'collection_id', 'collection_name', 'genres', 'release_year', 'director', 'overview', 'cast_names'];
    fields(input, creating ? [...allowed, 'cinema_watchlist'] : allowed, creating ? ['title'] : []);
    for (const [key, value] of Object.entries(input)) {
      if (value === null && key !== 'title') continue;
      if (['tmdb_id', 'collection_id'].includes(key)) {
        if (typeof value !== 'string' || !Core.validateMetadataIdentifierDecimal(value).ok) fail('EXACT_METADATA_ID_REQUIRED');
      } else if (['matched', 'cinema_watchlist'].includes(key)) { if (typeof value !== 'boolean') fail('BOOLEAN_REQUIRED'); }
      else if (key === 'release_year') { if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) fail('INVALID_YEAR'); }
      else if (['genres', 'cast_names'].includes(key)) {
        if (!Array.isArray(value)) fail('STRING_ARRAY_REQUIRED');
        for (let i = 0; i < value.length; i++) {
          const d = Object.getOwnPropertyDescriptor(value, String(i));
          if (!d || !Object.hasOwn(d, 'value') || (d.value !== null && typeof d.value !== 'string')) fail('STRING_ARRAY_REQUIRED');
        }
      } else if (typeof value !== 'string') fail('STRING_REQUIRED');
    }
    if (Object.hasOwn(input, 'title') && !input.title.trim()) fail('TITLE_REQUIRED');
    return { ...input };
  }
  function createActionAdapter({ runtime, newRequestId }) {
    if (!runtime || !['getState', 'executeIntent', 'retryCommand'].every(key => typeof runtime[key] === 'function') || typeof newRequestId !== 'function') fail('INJECTED_DEPENDENCIES_REQUIRED');
    const captures = new WeakMap(), retries = new WeakMap(); let disposed = false;
    const outcome = (name, code) => frozen({ outcome: name, code });
    function captureContext() {
      if (disposed) fail('ADAPTER_DISPOSED');
      const state = runtime.getState(), root = state.controllerState.view?.root;
      if (!root || !same(state.controllerState.context, root.context)) fail('COMMITTED_CONTEXT_REQUIRED');
      Core.getPerson(root, root.context.callerId);
      const handle = frozen({ ...root.context });
      captures.set(handle, { context: root.context, root, generation: state.generation });
      return handle;
    }
    function lifecycle(record) {
      if (disposed) return outcome('OBSOLETE', 'ADAPTER_DISPOSED');
      const state = runtime.getState();
      if (state.generation === record.generation && state.phase === 'AUTH_INVALIDATING') return outcome('AUTH_INVALIDATING', 'RUNTIME_AUTH_INVALID');
      if (state.generation !== record.generation || !same(state.controllerState.context, record.context)) return outcome('OBSOLETE', 'CONTEXT_CHANGED');
      return null;
    }
    function revision(record, kind, movieId, nightId = null) {
      const scope = kind === 'person_film' ? record.context.callerId : kind === 'content' ? movieId : record.context.groupId;
      const entity = kind === 'night' ? nightId : movieId;
      const token = Core.getExpectedRevision(record.root, kind, scope, entity);
      if (!['AVAILABLE', 'DEFAULT_ZERO'].includes(token.kind)) fail('REVISION_UNAVAILABLE');
      return { scope_kind: kind, scope_id: scope, entity_id: entity, version: token.version };
    }
    function command(record, intent, movieId, parameters, kind, nightId = null) {
      if (kind === 'new_content') { if (movieId !== null) fail('NEW_CONTENT_TARGET_REQUIRED'); }
      else uuid(movieId);
      const group = kind === 'group_film' || kind === 'night' || kind === 'new_night';
      return { intent, target: { movie_id: movieId, group_id: group ? record.context.groupId : null, night_id: nightId },
        expectedVersions: ['new_content', 'new_night'].includes(kind) ? [] : [revision(record, kind, movieId, nightId)], parameters };
    }
    function selection(record, cmd, input) {
      if (Object.hasOwn(input, 'selectCandidate')) {
        if (typeof input.selectCandidate !== 'boolean') fail('BOOLEAN_REQUIRED');
        cmd.parameters.select_candidate = input.selectCandidate;
        if (input.selectCandidate) {
          const token = revision(record, 'group_film', cmd.target.movie_id);
          cmd.expectedVersions.push(token); cmd.parameters.expected_candidate_revision = token.version;
        }
      }
      return cmd;
    }
    function mapResult(received, record, requestId, retryRecord = null) {
      if (disposed || runtime.getState().generation !== record.generation) return outcome('OBSOLETE', 'CONTEXT_CHANGED');
      const base = { requestId, context: record.context };
      if (received.category === 'AUTH_INVALIDATING' || runtime.getState().phase === 'AUTH_INVALIDATING')
        return frozen({ ...base, outcome: 'AUTH_INVALIDATING', code: received.code ?? received.response?.error?.code ?? 'RUNTIME_AUTH_INVALID' });
      if (received.category === 'SEMANTIC_RESULT') {
        const r = received.response;
        return frozen({ ...base, outcome: r.outcome, ...(Object.hasOwn(r, 'replayed') ? { replayed: r.replayed } : {}),
          ...(r.result ? { result: r.result } : {}), ...(r.current_versions ? { currentVersions: r.current_versions } : {}), ...(r.error ? { error: r.error } : {}) });
      }
      if (received.category === 'TRANSPORT_UNCERTAIN') {
        const owned = retryRecord ?? { record, requestId, runtimeHandle: received.command };
        if (!retryRecord) { owned.handle = frozen({ requestId }); retries.set(owned.handle, owned); }
        return frozen({ ...base, outcome: 'TRANSPORT_UNCERTAIN', retryHandle: owned.handle });
      }
      return frozen({ ...base, outcome: received.category, code: received.code });
    }
    function run(handle, build) {
      const record = captures.get(handle);
      if (!record) return Promise.resolve(outcome('INVALID_INPUT', 'OWNED_CONTEXT_REQUIRED'));
      const invalid = lifecycle(record); if (invalid) return Promise.resolve(invalid);
      let requestId, pending;
      try {
        const cmd = build(record);
        requestId = uuid(newRequestId());
        // TargetRuntime synchronously prepares a defensive immutable copy before
        // returning its Promise. This adapter never freezes or mutates UI inputs.
        pending = runtime.executeIntent({ requestId, ...cmd });
      } catch (error) { return Promise.resolve(outcome('INVALID_INPUT', error instanceof TypeError ? error.message : 'ACTION_INPUT_ERROR')); }
      return Promise.resolve(pending).then(received => mapResult(received, record, requestId));
    }
    const personal = (intent, handle, movieId, parameters = {}) => run(handle, r => command(r, intent, movieId, parameters, 'person_film'));
    const group = (intent, handle, movieId, parameters = {}) => run(handle, r => command(r, intent, movieId, parameters, 'group_film'));
    const night = (intent, handle, nightId, input = {}) => run(handle, r => {
      uuid(nightId); const event = Core.getNight(r.root, nightId); if (!event) fail('NIGHT_NOT_COVERED');
      const details = nightDetails(input, intent === 'EDIT_NIGHT' ? ['date', 'time', 'snack', 'location'] : []);
      return command(r, intent, event.movie_id, { night_id: nightId, ...details }, 'night', nightId);
    });
    function createNight(handle, movieId, input, scheduled) {
      return run(handle, r => {
        const p = nightDetails(input, scheduled ? ['date', 'time', 'snack', 'location', 'selectCandidate'] : ['snack', 'location', 'selectCandidate']);
        if (scheduled && !p.date) fail('DATE_REQUIRED');
        return selection(r, command(r, scheduled ? 'SCHEDULE_NIGHT' : 'QUICK_NIGHT', movieId, p, 'new_night'), input);
      });
    }
    function complete(handle, identity, input, now) {
      return run(handle, r => {
        const p = nightDetails(input, now ? ['participants', 'snack', 'location', 'evaluation', 'selectCandidate'] : ['participants', 'snack', 'location', 'evaluation']);
        p.participants = participants(input.participants);
        const contextual = ['snack', 'location', 'evaluation'].some(key => Object.hasOwn(input, key));
        let movieId = identity, nightId = null;
        if (!now) { uuid(identity); const event = Core.getNight(r.root, identity); if (!event) fail('NIGHT_NOT_COVERED'); movieId = event.movie_id; nightId = identity; }
        if (Object.hasOwn(input, 'evaluation')) p.evaluation = evaluation(input.evaluation, true);
        if (!now && !contextual) p.night_id = nightId;
        const intent = now ? (contextual ? 'COMPLETE_NOW_WITH_CONTEXT' : 'COMPLETE_NOW') : (contextual ? 'COMPLETE_NIGHT_WITH_CONTEXT' : 'COMPLETE_NIGHT');
        const cmd = command(r, intent, movieId, p, now ? 'new_night' : 'night', nightId);
        if (now) selection(r, cmd, input);
        // Explicit evaluation patches carry a conservative group CAS, including
        // a patch whose values the server may find already equal. No guard copy.
        if (p.evaluation && Object.keys(p.evaluation).length && !cmd.expectedVersions.some(v => v.scope_kind === 'group_film')) cmd.expectedVersions.push(revision(r, 'group_film', movieId));
        return cmd;
      });
    }
    return frozen({ captureContext,
      addToMyList: (h, id) => personal('ADD_PERSONAL_LIST', h, id),
      removeFromMyList: (h, id) => personal('REMOVE_PERSONAL_LIST', h, id),
      recordSeen: (h, id, patch) => patch === undefined ? personal('RETROSPECTIVE_SEEN', h, id) : run(h, r => command(r, 'RECORD_PERSONAL_SEEN_WITH_EVALUATION', id, evaluation(patch), 'person_film')),
      removeSeen: (h, id) => personal('REMOVE_PERSONAL_SEEN', h, id),
      recordPersonalViewing: (h, id, input = {}) => run(h, r => {
        fields(input, ['satisfyCurrentIntention']); const p = {};
        if (Object.hasOwn(input, 'satisfyCurrentIntention')) {
          if (typeof input.satisfyCurrentIntention !== 'boolean') fail('BOOLEAN_REQUIRED');
          if (input.satisfyCurrentIntention) {
            const state = Core.getPersonalState(r.root, r.context.callerId, uuid(id));
            if (!state?.list.active || state.list.generation === null) fail('INTENTION_NOT_AVAILABLE');
            p.generation = state.list.generation;
          }
        }
        return command(r, 'NEW_PERSONAL_VIEWING', id, p, 'person_film');
      }),
      setMyEvaluation: (h, id, patch) => run(h, r => command(r, 'SET_PERSONAL_EVALUATION', id, evaluation(patch), 'person_film')),
      setMyRating: (h, id, value) => run(h, r => { evaluation({ rating: value }); return command(r, 'PERSONAL_RATING', id, { value }, 'person_film'); }),
      setMyPreference: (h, id, value) => run(h, r => { evaluation({ preference: value }); return command(r, 'PERSONAL_PREFERENCE', id, { value }, 'person_film'); }),
      setMyReview: (h, id, value) => run(h, r => { evaluation({ review: value }); return command(r, 'PERSONAL_REVIEW', id, { value }, 'person_film'); }),
      proposeToGroup: (h, id) => group('PROPOSE_TO_GROUP', h, id),
      withdrawGroupCandidacy: (h, id) => group('WITHDRAW_GROUP_CANDIDACY', h, id),
      setGroupEvaluation: (h, id, patch) => run(h, r => command(r, 'SET_TOGETHER_EVALUATION', id, evaluation(patch, true), 'group_film')),
      setGroupRating: (h, id, value) => run(h, r => { evaluation({ rating: value }, true); return command(r, 'TOGETHER_RATING', id, { value }, 'group_film'); }),
      setGroupReview: (h, id, value) => run(h, r => { evaluation({ review: value }, true); return command(r, 'TOGETHER_REVIEW', id, { value }, 'group_film'); }),
      scheduleNight: (h, id, input) => createNight(h, id, input, true),
      quickNight: (h, id, input = {}) => createNight(h, id, input, false),
      confirmNight: (h, id) => night('CONFIRM_NIGHT', h, id), cancelNight: (h, id) => night('CANCEL_NIGHT', h, id),
      editNight: (h, id, input) => night('EDIT_NIGHT', h, id, input),
      completeScheduled: (h, id, input) => complete(h, id, input, false), completeNow: (h, id, input) => complete(h, id, input, true),
      createContent: (h, input) => run(h, r => command(r, 'CONTENT_CREATE', null, contentParameters(input, true), 'new_content')),
      updateMetadata: (h, id, input) => run(h, r => command(r, 'CONTENT_UPDATE_METADATA', id, contentParameters(input, false), 'content')),
      deleteContent: (h, id) => run(h, r => command(r, 'CONTENT_DELETE', id, {}, 'content')),
      setCinema: (h, id, value) => run(h, r => { if (typeof value !== 'boolean') fail('BOOLEAN_REQUIRED'); return command(r, 'CONTENT_SET_CINEMA', id, { value }, 'content'); }),
      setSurprise: (h, id, enabled) => run(h, r => { if (typeof enabled !== 'boolean') fail('BOOLEAN_REQUIRED'); return command(r, 'CONTENT_SET_SURPRISE', id, { enabled }, 'content'); }),
      addVeto: (h, id) => run(h, r => command(r, 'VETO_ADD', id, { expected_week_key: r.root.snapshot.temporal.week_key }, 'group_film')),
      removeVeto: (h, id, observedVetoId) => run(h, r => command(r, 'VETO_REMOVE', id, { veto_id: uuid(observedVetoId), expected_week_key: r.root.snapshot.temporal.week_key }, 'group_film')),
      retry(handle) {
        const owned = retries.get(handle); if (!owned) return Promise.resolve(outcome('INVALID_INPUT', 'OWNED_RETRY_REQUIRED'));
        const invalid = lifecycle(owned.record); if (invalid) return Promise.resolve(invalid);
        return runtime.retryCommand(owned.runtimeHandle).then(received => mapResult(received, owned.record, owned.requestId, owned));
      },
      dispose() { disposed = true; }
    });
  }
  return frozen({ createActionAdapter });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ActionAdapter;
