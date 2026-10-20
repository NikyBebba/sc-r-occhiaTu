-- Phase 4A4 LOCAL CANDIDATE; defining the function initializes nothing.
BEGIN;
CREATE FUNCTION public.runtime_4a4_target_used() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'OPERATOR_READ_COMMITTED_REQUIRED';END IF;
 RETURN EXISTS(SELECT FROM public.app_protocol_state WHERE mode='target' OR minimum_client_protocol<>0)
 OR EXISTS(SELECT FROM public.domain_command_receipts)
 OR EXISTS(SELECT FROM public.domain_versions WHERE scope_kind<>'night' OR version<>1 OR tombstone)
 OR EXISTS(SELECT FROM public.personal_list_entries WHERE generation<>0 OR revision<>0 OR active)
 OR EXISTS(SELECT FROM public.group_movie_states WHERE support_origin IS DISTINCT FROM 'legacy' OR support_state IS DISTINCT FROM 'active'
   OR suppressed_cycle IS NOT NULL OR support_ended_at IS NOT NULL OR revision<>1)
 OR pg_catalog.has_function_privilege('authenticated','public.execute_app_command(jsonb)','EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated','public.execute_match_action(integer,text,jsonb)','EXECUTE');
END $$;
CREATE FUNCTION public.runtime_4a4_initialize_nights(checkpoint jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE cfg public.app_protocol_state; inserted bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'OPERATOR_READ_COMMITTED_REQUIRED';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(473106,1);
 PERFORM public.runtime_4a4_verify_drain(checkpoint);
 SELECT * INTO cfg FROM public.app_protocol_state FOR UPDATE;
 IF cfg.mode IS DISTINCT FROM 'read_only' OR cfg.minimum_client_protocol<>0 OR cfg.current_group_id IS NULL THEN RAISE EXCEPTION 'INITIALIZER_CONFIGURATION_INVALID';END IF;
 IF NOT EXISTS(SELECT FROM public.groups WHERE id=cfg.current_group_id AND status='active' AND convergence_version=1)
 OR (SELECT count(*) FROM public.group_memberships gm JOIN public.app_members a ON a.user_id=gm.person_id
   WHERE gm.group_id=cfg.current_group_id AND gm.active AND a.person IN ('N','V'))<>2 THEN RAISE EXCEPTION 'INITIALIZER_FOUNDATION_INVALID';END IF;
 -- Maintenance-only barrier. Movie first preserves the runtime lock hierarchy;
 -- these locks are not installed on domain writer paths or held across calls.
 LOCK TABLE public.movies,public.movie_nights,public.domain_versions,public.domain_command_receipts IN ACCESS EXCLUSIVE MODE;
 IF public.runtime_4a4_target_used() THEN RAISE EXCEPTION 'INITIALIZER_TARGET_USE_OR_AMBIGUITY';END IF;
 IF EXISTS(SELECT FROM public.movie_nights WHERE group_id IS DISTINCT FROM cfg.current_group_id OR status NOT IN ('proposed','confirmed','completed','cancelled','skipped')) THEN RAISE EXCEPTION 'INITIALIZER_NIGHT_SCOPE_INVALID';END IF;
 IF EXISTS(SELECT FROM public.domain_versions v LEFT JOIN public.movie_nights n ON n.id=v.entity_id WHERE v.scope_kind='night'
   AND (n.id IS NULL OR v.scope_id IS DISTINCT FROM n.group_id OR v.version<>1 OR v.tombstone)) THEN RAISE EXCEPTION 'INITIALIZER_VERSION_INVALID';END IF;
 INSERT INTO public.domain_versions(scope_kind,scope_id,entity_id,version,tombstone)
  SELECT 'night',n.group_id,n.id,1,false FROM public.movie_nights n WHERE n.group_id=cfg.current_group_id
  ON CONFLICT(scope_kind,scope_id,entity_id) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 RETURN jsonb_build_object('inserted',inserted,'covered',(SELECT count(*) FROM public.movie_nights WHERE group_id=cfg.current_group_id),'baseline_version','1');
END $$;
REVOKE ALL ON FUNCTION public.runtime_4a4_target_used(),public.runtime_4a4_initialize_nights(jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
