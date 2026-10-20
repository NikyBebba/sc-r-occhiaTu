-- Phase 4A4 LOCAL CANDIDATE. Installation activates/grants nothing.
-- Initial activation ONLY. No automatic legacy rollback or grant restoration.
BEGIN;
CREATE FUNCTION public.runtime_4a4_activate_target(checkpoint jsonb) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE cfg public.app_protocol_state; f text; p record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'OPERATOR_READ_COMMITTED_REQUIRED';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(473106,1);
 SELECT * INTO cfg FROM public.app_protocol_state FOR UPDATE;
 IF cfg.mode IS DISTINCT FROM 'read_only' OR cfg.minimum_client_protocol<>0 THEN RAISE EXCEPTION 'ACTIVATION_PRE_TARGET_MODE_REQUIRED';END IF;
 PERFORM public.runtime_4a4_verify_drain(checkpoint);
 LOCK TABLE public.movies,public.movie_nights,public.domain_versions,public.domain_command_receipts IN ACCESS EXCLUSIVE MODE;
 IF public.runtime_4a4_target_used() THEN RAISE EXCEPTION 'ACTIVATION_TARGET_USE_OR_AMBIGUITY';END IF;
 IF NOT EXISTS(SELECT FROM public.groups WHERE id=cfg.current_group_id AND status='active' AND convergence_version=1)
  OR (SELECT count(*) FROM public.group_memberships WHERE group_id=cfg.current_group_id AND active)<>2
  OR (SELECT count(DISTINCT a.person) FROM public.group_memberships gm JOIN public.app_members a ON a.user_id=gm.person_id
      WHERE gm.group_id=cfg.current_group_id AND gm.active AND a.person IN ('N','V'))<>2 THEN RAISE EXCEPTION 'ACTIVATION_FOUNDATION_INVALID';END IF;
 IF EXISTS(SELECT FROM public.movie_nights n WHERE n.status='completed' AND NOT EXISTS(
    SELECT FROM public.movie_night_participants pp WHERE pp.night_id=n.id))
 OR EXISTS(SELECT FROM public.movie_night_participants pp JOIN public.movie_nights n ON n.id=pp.night_id WHERE n.status<>'completed') THEN
  RAISE EXCEPTION 'ACTIVATION_FOUNDATION_INVALID';END IF;
 FOREACH f IN ARRAY ARRAY['public.get_app_runtime_context(integer)','public.get_person_group_snapshot(uuid,integer)',
  'public.execute_app_command(jsonb)','public.execute_match_action(integer,text,jsonb)'] LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(f);
  IF NOT FOUND OR p.prokind<>'f' OR p.prorettype<>'jsonb'::regtype OR p.proretset OR NOT p.prosecdef
   OR (f IN ('public.get_app_runtime_context(integer)','public.get_person_group_snapshot(uuid,integer)') AND p.provolatile<>'s')
   OR NOT coalesce('search_path=""'=ANY(p.proconfig),false) OR p.proowner<>(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.app_protocol_state'::regclass) THEN
   RAISE EXCEPTION 'ACTIVATION_RUNTIME_CONTRACT_INVALID';END IF;
 END LOOP;
 IF EXISTS(SELECT FROM public.movie_nights n WHERE n.group_id IS DISTINCT FROM cfg.current_group_id OR NOT EXISTS(
   SELECT FROM public.domain_versions v WHERE v.scope_kind='night' AND v.scope_id=n.group_id AND v.entity_id=n.id AND v.version=1 AND NOT v.tombstone))
 OR EXISTS(SELECT FROM public.domain_versions v LEFT JOIN public.movie_nights n ON n.id=v.entity_id WHERE v.scope_kind='night' AND (n.id IS NULL OR n.group_id IS DISTINCT FROM v.scope_id)) THEN RAISE EXCEPTION 'ACTIVATION_NIGHT_TOKEN_INVALID';END IF;
 -- Grant + target mode are one atomic transaction, after the fence/drain proof.
 -- Raw helpers and legacy paths receive no grants. min protocol 1 is retained
 -- on return to maintenance: conservative evidence of possible target use.
 GRANT EXECUTE ON FUNCTION public.get_app_runtime_context(integer),public.get_person_group_snapshot(uuid,integer),
  public.execute_app_command(jsonb),public.execute_match_action(integer,text,jsonb) TO authenticated;
 UPDATE public.app_protocol_state SET mode='target',minimum_client_protocol=1;
 RETURN 'TARGET';
END $$;
CREATE FUNCTION public.runtime_4a4_enter_maintenance() RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'OPERATOR_READ_COMMITTED_REQUIRED';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(473106,1);
 PERFORM singleton FROM public.app_protocol_state FOR UPDATE;
 UPDATE public.app_protocol_state SET mode='read_only' WHERE mode IN ('legacy','target');
 -- Never reduce the protocol floor or restore grants. No legacy rollback API.
 RETURN 'READ_ONLY';
END $$;
REVOKE ALL ON FUNCTION public.runtime_4a4_activate_target(jsonb),public.runtime_4a4_enter_maintenance() FROM PUBLIC,anon,authenticated;
COMMIT;
