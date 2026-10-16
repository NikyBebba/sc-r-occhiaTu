-- PHASE 1 LOCAL CANDIDATE ONLY. Never apply to production without a separate gate.
-- Prerequisites: Auth, Individual/Rewatch v54, completed-snack, Personal Preference v62.
-- Additive, deliberately one-shot: reapply/partial installation aborts atomically.
-- No seeds, backfill, publication, client grants, command RPC or v62 writer changes.
-- Phase 2 lock contract: lock movie rows FOR UPDATE in ascending UUID order,
-- then related heads/events in stable key order, then their scoped versions.
-- No revision/configuration row is acquired as a global domain mutex.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $pre$
BEGIN
 IF to_regclass('auth.users') IS NULL OR to_regclass('public.app_members') IS NULL
    OR to_regprocedure('public.app_person()') IS NULL
    OR to_regprocedure('public.guard_movie_watch()') IS NULL
    OR to_regprocedure('public.clear_personal_preference_for_rating()') IS NULL
    OR to_regprocedure('public.manage_movie_night(text,uuid,uuid,date,text,text,text,boolean,numeric,text)') IS NULL THEN
   RAISE EXCEPTION 'FOUNDATION_PREREQUISITE: v62 Auth/watch/preference/snack required';
 END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
     AND table_name='movies' AND column_name IN
     ('seen_n','seen_v','in_shared_list','personal_liked_n','personal_liked_v')) <> 5 THEN
   RAISE EXCEPTION 'FOUNDATION_PREREQUISITE: current movie fields required';
 END IF;
END $pre$;

CREATE TABLE public.groups (
 id uuid PRIMARY KEY, -- supplied stable ID; no invented current group seed
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
 convergence_version bigint NOT NULL DEFAULT 1 CHECK (convergence_version > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.group_memberships (
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE RESTRICT,
 person_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY (group_id,person_id)
);
CREATE INDEX group_memberships_person_idx ON public.group_memberships(person_id,group_id);

-- Receipts hold completed operations only. Handler transactions/replay come in Phase 2.
CREATE TABLE public.domain_command_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 command_kind text NOT NULL CHECK (length(btrim(command_kind)) BETWEEN 1 AND 80),
 payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
 result_status text NOT NULL CHECK (result_status IN ('success','already_in_target_state')),
 result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
 affected_versions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(affected_versions)='array'),
 movie_id uuid REFERENCES public.movies(id) ON DELETE RESTRICT,
 group_id uuid REFERENCES public.groups(id) ON DELETE RESTRICT,
 night_id uuid REFERENCES public.movie_nights(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (caller_id,request_id)
);
CREATE INDEX domain_command_receipts_movie_idx ON public.domain_command_receipts(movie_id);

CREATE TABLE public.personal_list_entries (
 person_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 movie_id uuid NOT NULL REFERENCES public.movies(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT false,
 generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
 revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
 activated_at timestamptz,
 ended_at timestamptz,
 end_reason text CHECK (end_reason IN ('removed','satisfied')),
 PRIMARY KEY (person_id,movie_id),
 CHECK (
   (generation=0 AND NOT active AND revision=0 AND activated_at IS NULL
     AND ended_at IS NULL AND end_reason IS NULL)
   OR (generation>0 AND revision>0 AND activated_at IS NOT NULL AND
     ((active AND ended_at IS NULL AND end_reason IS NULL)
      OR (NOT active AND ended_at IS NOT NULL AND ended_at>=activated_at AND end_reason IS NOT NULL)))
 )
);
CREATE INDEX personal_list_entries_movie_idx ON public.personal_list_entries(movie_id);
CREATE INDEX personal_list_entries_active_idx ON public.personal_list_entries(person_id,movie_id) WHERE active;

-- Canonical, comparable cycle within its group: version + ordered UUID/generation pairs.
-- This validates representation, NOT convergence policy or actual membership.
CREATE FUNCTION public.foundation_valid_cycle(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; previous_id text := ''; current_id text;
BEGIN
 IF jsonb_typeof(value)<>'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(value))<>2
    OR NOT (value ? 'version' AND value ? 'members') THEN RETURN false; END IF;
 IF jsonb_typeof(value->'version')<>'number' OR (value->>'version') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(value->'members')<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(value->'members')<2 THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(value->'members') LOOP
   IF jsonb_typeof(item)<>'object' THEN RETURN false; END IF;
   IF (SELECT count(*) FROM jsonb_object_keys(item))<>2
      OR NOT (item ? 'person_id' AND item ? 'generation') THEN RETURN false; END IF;
   current_id := item->>'person_id';
   IF jsonb_typeof(item->'person_id')<>'string'
      OR current_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR current_id COLLATE "C" <= previous_id COLLATE "C"
      OR jsonb_typeof(item->'generation')<>'number'
      OR (item->>'generation') !~ '^[1-9][0-9]*$' THEN RETURN false; END IF;
   -- Bound the representation to the generation/version column type.
   PERFORM (item->>'generation')::bigint;
   previous_id := current_id;
 END LOOP;
 PERFORM (value->>'version')::bigint;
 RETURN true;
EXCEPTION WHEN numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE TABLE public.group_movie_states (
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE RESTRICT,
 movie_id uuid NOT NULL REFERENCES public.movies(id) ON DELETE RESTRICT,
 revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
 autonomous_support_id uuid UNIQUE,
 support_origin text CHECK (support_origin IN ('legacy','explicit')),
 support_state text CHECK (support_state IN ('active','withdrawn','consumed')),
 proposed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 support_recorded_at timestamptz,
 support_ended_at timestamptz,
 suppressed_cycle jsonb CHECK (public.foundation_valid_cycle(suppressed_cycle)),
 suppression_reason text CHECK (suppression_reason IN ('withdrawn','consumed')),
 suppressed_at timestamptz,
 PRIMARY KEY (group_id,movie_id),
 CHECK (
  (autonomous_support_id IS NULL AND support_origin IS NULL AND support_state IS NULL
   AND proposed_by IS NULL AND support_recorded_at IS NULL AND support_ended_at IS NULL)
  OR (autonomous_support_id IS NOT NULL AND support_origin IS NOT NULL AND support_state IS NOT NULL
   AND support_recorded_at IS NOT NULL
   AND ((support_origin='legacy' AND proposed_by IS NULL) OR (support_origin='explicit' AND proposed_by IS NOT NULL))
   AND ((support_state='active' AND support_ended_at IS NULL)
        OR (support_state IN ('withdrawn','consumed') AND support_ended_at IS NOT NULL AND support_ended_at>=support_recorded_at)))
 ),
 CHECK ((suppressed_cycle IS NULL AND suppression_reason IS NULL AND suppressed_at IS NULL)
     OR (suppressed_cycle IS NOT NULL AND suppression_reason IS NOT NULL AND suppressed_at IS NOT NULL))
);
CREATE INDEX group_movie_states_movie_idx ON public.group_movie_states(movie_id);

ALTER TABLE public.movie_nights
 ADD COLUMN group_id uuid REFERENCES public.groups(id) ON DELETE RESTRICT,
 ADD COLUMN domain_revision bigint NOT NULL DEFAULT 0 CHECK (domain_revision >= 0),
 ADD COLUMN created_by_caller_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 ADD COLUMN creation_request_id uuid,
 ADD COLUMN selected_support_id uuid,
 ADD COLUMN selected_convergence_cycle jsonb CHECK (public.foundation_valid_cycle(selected_convergence_cycle)),
 ADD CONSTRAINT movie_nights_creation_identity CHECK ((created_by_caller_id IS NULL)=(creation_request_id IS NULL)),
 ADD CONSTRAINT movie_nights_selection_scope CHECK ((selected_support_id IS NULL AND selected_convergence_cycle IS NULL) OR group_id IS NOT NULL),
 ADD CONSTRAINT movie_nights_creation_request_unique UNIQUE(created_by_caller_id,creation_request_id),
 ADD CONSTRAINT movie_nights_id_movie_unique UNIQUE(id,movie_id);
-- selected_support_id is an immutable captured token, NOT a FK to a mutable head.
-- A later support replacement must not rewrite or prevent retention of that token.
CREATE INDEX movie_nights_group_status_idx ON public.movie_nights(group_id,status,movie_id);

CREATE TABLE public.movie_night_participants (
 night_id uuid NOT NULL REFERENCES public.movie_nights(id) ON DELETE RESTRICT,
 person_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 PRIMARY KEY (night_id,person_id)
);
CREATE INDEX movie_night_participants_person_idx ON public.movie_night_participants(person_id,night_id);

CREATE TABLE public.movie_night_intentions (
 night_id uuid NOT NULL,
 person_id uuid NOT NULL,
 movie_id uuid NOT NULL,
 generation bigint NOT NULL CHECK (generation>0),
 captured_at timestamptz NOT NULL DEFAULT now(),
 invalidated_at timestamptz CHECK (invalidated_at>=captured_at),
 PRIMARY KEY (night_id,person_id),
 FOREIGN KEY (night_id,movie_id) REFERENCES public.movie_nights(id,movie_id) ON DELETE RESTRICT,
 FOREIGN KEY (person_id,movie_id) REFERENCES public.personal_list_entries(person_id,movie_id) ON DELETE RESTRICT
);
-- The FK protects the permanent head, not its changing generation. Completion
-- must compare the captured value; A must survive a head advancing to B.
CREATE INDEX movie_night_intentions_head_idx ON public.movie_night_intentions(person_id,movie_id);

CREATE TABLE public.domain_versions (
 scope_kind text NOT NULL CHECK (scope_kind IN ('content','person_film','group_film','night')),
 scope_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 version bigint NOT NULL DEFAULT 0 CHECK (version>=0),
 tombstone boolean NOT NULL DEFAULT false,
 PRIMARY KEY (scope_kind,scope_id,entity_id),
 CHECK (scope_kind<>'content' OR scope_id=entity_id)
);
-- Deliberately no entity FK: versions/tombstones must survive entity removal.
-- Future authorized commands validate scope ownership; no client access in Phase 1.
CREATE TABLE public.app_protocol_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 current_group_id uuid REFERENCES public.groups(id) ON DELETE RESTRICT,
 minimum_client_protocol integer NOT NULL DEFAULT 0 CHECK (minimum_client_protocol>=0),
 mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy','read_only','target'))
);
COMMENT ON TABLE public.app_protocol_state IS
 'Compatibility configuration only. Empty until operator setup; never a write mutex or commit counter.';

-- Structural lifecycle guards only: no command implementation, server time claims,
-- convergence calculation, satisfaction side effects or in_shared_list projection.
CREATE FUNCTION public.guard_personal_list_foundation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'INTENTION_HEAD_RETENTION_REQUIRED'; END IF;
 IF TG_OP='INSERT' THEN
   IF NOT ((NEW.generation=0 AND NEW.revision=0 AND NOT NEW.active)
       OR (NEW.generation=1 AND NEW.revision=1 AND NEW.active)) THEN
     RAISE EXCEPTION 'INTENTION_INITIAL_STATE'; END IF;
   RETURN NEW;
 END IF;
 IF ROW(NEW.person_id,NEW.movie_id) IS DISTINCT FROM ROW(OLD.person_id,OLD.movie_id) THEN
   RAISE EXCEPTION 'INTENTION_IDENTITY_IMMUTABLE'; END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'INTENTION_REVISION_REQUIRED'; END IF;
 IF NOT OLD.active AND NEW.active THEN
   IF NEW.generation<>OLD.generation+1 OR (OLD.activated_at IS NOT NULL AND NEW.activated_at<OLD.ended_at) THEN
     RAISE EXCEPTION 'INTENTION_NEW_GENERATION_REQUIRED'; END IF;
 ELSIF OLD.active AND NOT NEW.active THEN
   IF NEW.generation<>OLD.generation OR NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
     RAISE EXCEPTION 'INTENTION_GENERATION_IMMUTABLE'; END IF;
 ELSE
   RAISE EXCEPTION 'INTENTION_TRANSITION_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_list_foundation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.personal_list_entries
 FOR EACH ROW EXECUTE FUNCTION public.guard_personal_list_foundation();

CREATE FUNCTION public.guard_group_movie_foundation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GROUP_MOVIE_HEAD_RETENTION_REQUIRED'; END IF;
 IF ROW(NEW.group_id,NEW.movie_id) IS DISTINCT FROM ROW(OLD.group_id,OLD.movie_id) THEN
   RAISE EXCEPTION 'GROUP_MOVIE_IDENTITY_IMMUTABLE'; END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'GROUP_MOVIE_REVISION_REQUIRED'; END IF;
 IF OLD.autonomous_support_id IS NOT NULL AND NEW.autonomous_support_id IS NOT DISTINCT FROM OLD.autonomous_support_id THEN
   IF ROW(NEW.support_origin,NEW.proposed_by,NEW.support_recorded_at) IS DISTINCT FROM ROW(OLD.support_origin,OLD.proposed_by,OLD.support_recorded_at)
     OR (OLD.support_state<>'active' AND ROW(NEW.support_state,NEW.support_ended_at) IS DISTINCT FROM ROW(OLD.support_state,OLD.support_ended_at)) THEN
     RAISE EXCEPTION 'SUPPORT_IDENTITY_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER group_movie_foundation_guard BEFORE UPDATE OR DELETE ON public.group_movie_states
 FOR EACH ROW EXECUTE FUNCTION public.guard_group_movie_foundation();

CREATE FUNCTION public.guard_night_intention_foundation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CAPTURED_INTENTION_RETENTION_REQUIRED'; END IF;
 IF ROW(NEW.night_id,NEW.person_id,NEW.movie_id,NEW.generation,NEW.captured_at)
    IS DISTINCT FROM ROW(OLD.night_id,OLD.person_id,OLD.movie_id,OLD.generation,OLD.captured_at)
    OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at) THEN
   RAISE EXCEPTION 'CAPTURED_INTENTION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER night_intention_foundation_guard BEFORE UPDATE OR DELETE ON public.movie_night_intentions
 FOR EACH ROW EXECUTE FUNCTION public.guard_night_intention_foundation();

-- Completed command receipts are immutable replay evidence, not a mutable log.
CREATE FUNCTION public.guard_command_receipt_foundation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'COMMAND_RECEIPT_APPEND_ONLY';
END $$;
CREATE TRIGGER command_receipt_foundation_guard BEFORE UPDATE OR DELETE ON public.domain_command_receipts
 FOR EACH ROW EXECUTE FUNCTION public.guard_command_receipt_foundation();

CREATE FUNCTION public.guard_domain_version_foundation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DOMAIN_VERSION_RETENTION_REQUIRED'; END IF;
 IF ROW(NEW.scope_kind,NEW.scope_id,NEW.entity_id) IS DISTINCT FROM ROW(OLD.scope_kind,OLD.scope_id,OLD.entity_id) THEN
   RAISE EXCEPTION 'DOMAIN_VERSION_IDENTITY_IMMUTABLE'; END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'DOMAIN_VERSION_INCREMENT_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER domain_version_foundation_guard BEFORE UPDATE OR DELETE ON public.domain_versions
 FOR EACH ROW EXECUTE FUNCTION public.guard_domain_version_foundation();

DO $security$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['groups','group_memberships','domain_command_receipts','personal_list_entries',
   'group_movie_states','movie_night_participants','movie_night_intentions','domain_versions','app_protocol_state'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',name);
 END LOOP;
END $security$;
REVOKE ALL ON FUNCTION public.foundation_valid_cycle(jsonb),public.guard_personal_list_foundation(),
 public.guard_group_movie_foundation(),public.guard_night_intention_foundation(),public.guard_domain_version_foundation(),
 public.guard_command_receipt_foundation()
 FROM PUBLIC, anon, authenticated;
-- No modification of old grants, triggers, RPCs or Realtime publication.
COMMIT;
