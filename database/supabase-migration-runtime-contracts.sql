-- Phase 4A2 LOCAL/DORMANT candidate only. Requires the committed foundation.
-- Bootstrap and writer candidates: no seeds, fence, protocol activation or runtime grants.
BEGIN;
DO $prerequisites$
BEGIN
 IF pg_catalog.to_regclass('public.app_protocol_state') IS NULL
    OR pg_catalog.to_regclass('public.groups') IS NULL
    OR pg_catalog.to_regclass('public.group_memberships') IS NULL
    OR pg_catalog.to_regclass('public.app_members') IS NULL
    OR pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
   RAISE EXCEPTION 'RUNTIME_CONTRACT_PREREQUISITE: foundation and Auth required';
 END IF;
END $prerequisites$;

CREATE FUNCTION public.get_app_runtime_context(p_client_protocol integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $bootstrap$
WITH
ctx AS MATERIALIZED (SELECT auth.uid() caller_id, p_client_protocol client_protocol),
cfg AS MATERIALIZED (
 SELECT singleton,current_group_id,minimum_client_protocol,mode FROM public.app_protocol_state
),
member AS MATERIALIZED (
 SELECT a.person FROM public.app_members a CROSS JOIN ctx c
 WHERE a.user_id=c.caller_id AND a.person IN ('N','V')
),
gate AS MATERIALIZED (
 SELECT c.*,CASE
  WHEN c.caller_id IS NULL THEN 'UNAUTHENTICATED'
  WHEN NOT EXISTS(SELECT FROM member) THEN 'MEMBERSHIP_REQUIRED'
  WHEN (SELECT pg_catalog.count(*) FROM cfg)<>1
    OR EXISTS(SELECT FROM cfg WHERE singleton IS DISTINCT FROM true
      OR minimum_client_protocol IS NULL OR minimum_client_protocol<0
      OR mode IS NULL OR mode NOT IN ('legacy','read_only','target')) THEN 'FOUNDATION_NOT_READY'
  WHEN NOT EXISTS(SELECT FROM cfg JOIN public.groups g ON g.id=cfg.current_group_id WHERE g.status='active') THEN 'NO_ACTIVE_GROUP'
  WHEN NOT EXISTS(SELECT FROM cfg JOIN public.group_memberships gm ON gm.group_id=cfg.current_group_id
    WHERE gm.person_id=c.caller_id AND gm.active) THEN 'NO_ACTIVE_GROUP'
  WHEN c.client_protocol IS DISTINCT FROM 1
    OR EXISTS(SELECT FROM cfg WHERE minimum_client_protocol>c.client_protocol) THEN 'PROTOCOL_UNSUPPORTED'
  WHEN EXISTS(SELECT FROM cfg WHERE mode='read_only') THEN 'MAINTENANCE'
 END error FROM ctx c
)
SELECT CASE WHEN g.error IS NOT NULL THEN
 pg_catalog.jsonb_build_object('bootstrap_contract_version',1,'outcome','ERROR',
   'error',pg_catalog.jsonb_build_object('code',g.error))
ELSE pg_catalog.jsonb_build_object(
 'bootstrap_contract_version',1,'outcome','OK',
 'caller',pg_catalog.jsonb_build_object('person_id',g.caller_id,'legacy_person',(SELECT person FROM member)),
 'selected_group',pg_catalog.jsonb_build_object('group_id',(SELECT current_group_id FROM cfg)),
 'protocol',pg_catalog.jsonb_build_object('client_protocol',g.client_protocol,'supported_protocol',1,
   'minimum_client_protocol',(SELECT minimum_client_protocol FROM cfg),'snapshot_contract_version',1),
 'runtime',pg_catalog.jsonb_build_object('mode',(SELECT mode FROM cfg),
   'activation_allowed',(SELECT mode='target' FROM cfg))) END
FROM gate g;
$bootstrap$;

REVOKE ALL ON FUNCTION public.get_app_runtime_context(integer) FROM PUBLIC,anon,authenticated;

-- Phase 4A3: dormant writer boundaries; no fence, grants or activation.

CREATE FUNCTION public.app_scope(k text,s uuid,e uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('scope_kind',k,'scope_id',s,'entity_id',e)
$$;
CREATE FUNCTION public.app_uuid(v jsonb) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 RETURN (v#>>'{}')::uuid;
END $$;
CREATE FUNCTION public.app_decimal(v jsonb, signed_value boolean DEFAULT false) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE n bigint;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR
  (v#>>'{}') !~ (CASE WHEN signed_value THEN '^(0|[1-9][0-9]*|-[1-9][0-9]*)$' ELSE '^(0|[1-9][0-9]*)$' END) THEN
   RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 n:=(v#>>'{}')::bigint;RETURN n;
END $$;
CREATE FUNCTION public.app_shape(v jsonb,required text[],optional text[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT v ?& required OR
   EXISTS(SELECT FROM jsonb_object_keys(v) k WHERE NOT k=ANY(required||optional)) THEN
   RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION public.app_versions_wire(a jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('scope_kind',x->>'scope_kind','scope_id',x->>'scope_id',
   'entity_id',x->>'entity_id','version',(x->>'version')::bigint::text)
   ORDER BY x->>'scope_kind' COLLATE "C",x->>'scope_id',x->>'entity_id'),'[]'::jsonb)
 FROM jsonb_array_elements(a) x
$$;
CREATE FUNCTION public.app_wire(r jsonb,rid uuid,m uuid) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF r->>'outcome' IN ('SUCCESS','ALREADY_IN_TARGET_STATE') THEN
  RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome',r->>'outcome','replayed',coalesce((r->>'replayed')::boolean,false),
   'result',jsonb_build_object('movie_id',m,'night_id',r->'night_id'),'affected_versions',public.app_versions_wire(r->'affected_versions'));
 ELSIF r->>'outcome'='REQUEST_ID_REUSE' THEN RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','REQUEST_ID_REUSE');
 END IF;
 RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','ERROR','error',jsonb_build_object('code',r->>'outcome'));
END $$;

-- Effect implementation is mechanically extracted from the installed approved
-- Phase 2 source. No caller-controlled SQL/identifiers. Abort on source drift.
-- Raw domain_command and historical receipts are deliberately not replaced.
DO $extract$
DECLARE src text; a integer; b integer;
BEGIN
 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.domain_command(uuid,text,uuid,uuid,bigint,jsonb)'::regprocedure;
 IF src IS NULL OR encode(sha256(convert_to(src,'UTF8')),'hex')<>'6af9a598330123d36cd413186c7cb102ae64d586885829fdf6119bee9172d92f' OR position('fingerprint:=encode' IN src)=0 OR
    position(' INSERT INTO public.domain_command_receipts(' IN src)=0 OR
    position('PERFORM public.domain_lock_movie(movie_id);' IN src)=0 THEN RAISE EXCEPTION 'PHASE2_SOURCE_DRIFT'; END IF;
 a:=position(' fingerprint:=encode' IN src); b:=position(' PERFORM public.domain_lock_movie(movie_id);' IN src);
 src:=substr(src,1,a-1)||substr(src,b+length(' PERFORM public.domain_lock_movie(movie_id);'));
 a:=position(' INSERT INTO public.domain_command_receipts(' IN src); b:=position(' RETURN result;' IN src);
 src:=substr(src,1,a-1)||substr(src,b);
 src:=replace(src,'public.domain_bump(','public.app_scope(');
 src:=replace(src,'domain_command.','app_phase2_effects.');
 IF position('pg_advisory_xact_lock' IN src)>0 OR position('INSERT INTO public.domain_command_receipts' IN src)>0
   OR position('public.domain_bump(' IN src)>0 THEN RAISE EXCEPTION 'PHASE2_EXTRACTION_DRIFT'; END IF;
 EXECUTE format('CREATE FUNCTION public.app_phase2_effects(request_id uuid,kind text,movie_id uuid,group_id uuid,expected_revision bigint,parameters jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='''' AS %L',src);
END $extract$;

CREATE FUNCTION public.app_lock_relations(m uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM person_id FROM public.personal_list_entries WHERE movie_id=m ORDER BY person_id FOR UPDATE;
 PERFORM group_id FROM public.group_movie_states WHERE movie_id=m ORDER BY group_id FOR UPDATE;
 PERFORM id FROM public.movie_nights WHERE movie_id=m ORDER BY id FOR UPDATE;
 PERFORM i.night_id FROM public.movie_night_intentions i JOIN public.movie_nights n ON n.id=i.night_id
  WHERE n.movie_id=m ORDER BY i.night_id,i.person_id FOR UPDATE OF i;
 PERFORM p.night_id FROM public.movie_night_participants p JOIN public.movie_nights n ON n.id=p.night_id
  WHERE n.movie_id=m ORDER BY p.night_id,p.person_id FOR UPDATE OF p;
 PERFORM v.entity_id FROM public.domain_versions v WHERE
  (v.entity_id=m AND v.scope_kind IN ('content','person_film','group_film')) OR
  (v.scope_kind='night' AND v.entity_id IN(SELECT id FROM public.movie_nights WHERE movie_id=m))
  ORDER BY v.scope_kind,v.scope_id,v.entity_id FOR UPDATE;
END $$;
CREATE FUNCTION public.app_cas(a jsonb,k text,s uuid,e uuid,required boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE supplied jsonb; actual bigint; dead boolean;
BEGIN
 SELECT x INTO supplied FROM jsonb_array_elements(a) x WHERE x->>'scope_kind'=k AND x->>'scope_id'=s::text AND x->>'entity_id'=e::text;
 IF supplied IS NULL THEN
   IF required THEN RAISE EXCEPTION 'MISSING_EXPECTED_VERSION' USING ERRCODE='22023'; END IF;RETURN NULL;
 END IF;
 SELECT version,tombstone INTO actual,dead FROM public.domain_versions WHERE scope_kind=k AND scope_id=s AND entity_id=e;
 IF actual IS NULL AND k='night' THEN RAISE EXCEPTION 'NIGHT_VERSION_MISSING' USING ERRCODE='22023'; END IF;
 IF dead THEN RAISE EXCEPTION 'TOMBSTONED' USING ERRCODE='22023'; END IF;
 actual:=coalesce(actual,0);
 RETURN CASE WHEN actual<>public.app_decimal(supplied->'version') THEN public.app_scope(k,s,e)||jsonb_build_object('version',actual::text) END;
END $$;
CREATE FUNCTION public.app_evaluation(m uuid,legacy text,p jsonb,together boolean,seen boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old public.movies; val public.movies; columns text[]; column_name text; value jsonb; has_rating boolean;
BEGIN
 PERFORM public.app_shape(p,'{}',CASE WHEN together THEN ARRAY['rating','review'] ELSE ARRAY['rating','preference','review'] END);
 IF p ? 'rating' AND p ? 'preference' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.movies WHERE id=m;val:=old;
 FOR column_name,value IN SELECT * FROM jsonb_each(p) LOOP
  IF column_name='rating' AND value<>'null'::jsonb AND (jsonb_typeof(value)<>'number' OR
    (value#>>'{}')::numeric NOT BETWEEN 0 AND 10 OR trunc((value#>>'{}')::numeric*10)<>(value#>>'{}')::numeric*10) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
  IF column_name='preference' AND value<>'null'::jsonb AND jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
  IF column_name='review' AND value<>'null'::jsonb AND jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF together THEN
  IF p ? 'rating' THEN val.seen_rating_together:=(p->>'rating')::numeric;END IF;
  IF p ? 'review' THEN val.review_text_together:=p->>'review';END IF;
  IF ROW(val.seen_rating_together,val.review_text_together) IS NOT DISTINCT FROM ROW(old.seen_rating_together,old.review_text_together) THEN RETURN false;END IF;
  UPDATE public.movies SET seen_rating_together=val.seen_rating_together,review_text_together=val.review_text_together WHERE id=m;
 ELSE
  -- Every identifier below is selected solely from verified N/V and fixed keys.
  IF legacy NOT IN ('N','V') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='22023';END IF;
  FOR column_name,value IN SELECT * FROM jsonb_each(p) LOOP
   column_name:=CASE column_name WHEN 'rating' THEN 'seen_rating_' WHEN 'preference' THEN 'personal_liked_' ELSE 'review_text_' END||lower(legacy);
   val:=jsonb_populate_record(val,jsonb_build_object(column_name,value));
  END LOOP;
  IF seen THEN val:=jsonb_populate_record(val,jsonb_build_object('seen_'||lower(legacy),true)); END IF;
  IF p ? 'rating' THEN val:=jsonb_populate_record(val,jsonb_build_object('personal_liked_'||lower(legacy),NULL));END IF;
  IF legacy='N' THEN
   IF ROW(val.seen_n,val.seen_rating_n,val.personal_liked_n,val.review_text_n) IS NOT DISTINCT FROM ROW(old.seen_n,old.seen_rating_n,old.personal_liked_n,old.review_text_n) THEN RETURN false;END IF;
   IF p ? 'rating' THEN
    UPDATE public.movies SET seen_n=val.seen_n,seen_rating_n=val.seen_rating_n,personal_liked_n=val.personal_liked_n,review_text_n=val.review_text_n WHERE id=m;
   ELSE UPDATE public.movies SET seen_n=val.seen_n,personal_liked_n=val.personal_liked_n,review_text_n=val.review_text_n WHERE id=m;END IF;
  ELSE
   IF ROW(val.seen_v,val.seen_rating_v,val.personal_liked_v,val.review_text_v) IS NOT DISTINCT FROM ROW(old.seen_v,old.seen_rating_v,old.personal_liked_v,old.review_text_v) THEN RETURN false;END IF;
   IF p ? 'rating' THEN
    UPDATE public.movies SET seen_v=val.seen_v,seen_rating_v=val.seen_rating_v,personal_liked_v=val.personal_liked_v,review_text_v=val.review_text_v WHERE id=m;
   ELSE UPDATE public.movies SET seen_v=val.seen_v,personal_liked_v=val.personal_liked_v,review_text_v=val.review_text_v WHERE id=m;END IF;
  END IF;
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.app_content_write(m uuid,p jsonb,creating boolean,legacy text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET scorochiatu.content_write='on' AS $$
DECLARE r public.movies;
BEGIN
 -- Fixed content columns only. All relation/workflow keys are rejected upstream.
 SELECT * INTO r FROM public.movies WHERE id=m;
 r:=jsonb_populate_record(r,p);
 IF creating THEN
  INSERT INTO public.movies(id,title,added_by,duration,platform,poster,trailer_url,matched,imdb_rating,rt_rating,metacritic_rating,
    genre,tmdb_id,collection_id,collection_name,genres,release_year,director,overview,cast_names,cinema_watchlist)
   VALUES(m,r.title,legacy,r.duration,r.platform,r.poster,r.trailer_url,coalesce(r.matched,true),r.imdb_rating,r.rt_rating,r.metacritic_rating,
    r.genre,r.tmdb_id,r.collection_id,r.collection_name,r.genres,r.release_year,r.director,r.overview,r.cast_names,coalesce(r.cinema_watchlist,false));
 ELSE
  UPDATE public.movies SET title=r.title,duration=r.duration,platform=r.platform,poster=r.poster,trailer_url=r.trailer_url,matched=r.matched,
   imdb_rating=r.imdb_rating,rt_rating=r.rt_rating,metacritic_rating=r.metacritic_rating,genre=r.genre,tmdb_id=r.tmdb_id,
   collection_id=r.collection_id,collection_name=r.collection_name,genres=r.genres,release_year=r.release_year,director=r.director,
   overview=r.overview,cast_names=r.cast_names,cinema_watchlist=r.cinema_watchlist,surprise_by=r.surprise_by WHERE id=m;
 END IF;
 RETURN m;
END $$;

-- Preserve the legacy guard's ownership/validation behavior. Content-only writes
-- retain OLD.status rather than maintaining a deprecated operational projection.
-- The function-local flag restores automatically; it never grants authorization.
DO $content_guard$
DECLARE src text; a integer; b integer; fragment text;
BEGIN
 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.guard_movie_watch()'::regprocedure;
 a:=position(' NEW.status := CASE' IN src); b:=position(' entering_list :=' IN src);
 IF a=0 OR b<a THEN RAISE EXCEPTION 'LEGACY_GUARD_SOURCE_DRIFT'; END IF;
 fragment:=substr(src,a,b-a);
 src:=substr(src,1,a-1)||E' IF NOT (TG_OP=''UPDATE'' AND coalesce(current_setting(''scorochiatu.content_write'',true),''off'')=''on''\n'
  ||E'   AND current_user=pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=''public.app_content_write(uuid,jsonb,boolean,text)''::regprocedure))) THEN\n'
  ||fragment||E' END IF;\n'||substr(src,b);
 EXECUTE format('CREATE OR REPLACE FUNCTION public.guard_movie_watch() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='''' AS %L',src);
END $content_guard$;

CREATE FUNCTION public.app_content_parameters(p jsonb,creating boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE key text; value jsonb; q jsonb:=p;
BEGIN
 PERFORM public.app_shape(p,CASE WHEN creating THEN ARRAY['title'] ELSE ARRAY[]::text[] END,
  ARRAY['title','duration','platform','poster','trailer_url','matched','imdb_rating','rt_rating','metacritic_rating','genre','tmdb_id',
    'collection_id','collection_name','genres','release_year','director','overview','cast_names']||CASE WHEN creating THEN ARRAY['cinema_watchlist'] ELSE ARRAY[]::text[] END);
 FOR key,value IN SELECT * FROM jsonb_each(p) LOOP
  IF key IN ('tmdb_id','collection_id') AND value<>'null'::jsonb THEN
   q:=jsonb_set(q,ARRAY[key],to_jsonb(public.app_decimal(value,true)));
  ELSIF key IN ('matched','cinema_watchlist') AND value<>'null'::jsonb AND jsonb_typeof(value)<>'boolean' THEN
   RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';
  ELSIF key='release_year' AND value<>'null'::jsonb AND (jsonb_typeof(value)<>'number' OR (value#>>'{}') !~ '^-?[0-9]+$') THEN
   RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';
  ELSIF key IN ('genres','cast_names') AND value<>'null'::jsonb THEN
   IF jsonb_typeof(value)<>'array' OR EXISTS(SELECT FROM jsonb_array_elements(value) x WHERE jsonb_typeof(x) NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
  ELSIF key NOT IN ('tmdb_id','collection_id','matched','cinema_watchlist','release_year','genres','cast_names') AND value<>'null'::jsonb AND jsonb_typeof(value)<>'string' THEN
   RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF (creating OR p ? 'title') AND (jsonb_typeof(p->'title') IS DISTINCT FROM 'string' OR length(btrim(p->>'title'))=0) THEN
  RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023'; END IF;
 RETURN q;
END $$;
CREATE FUNCTION public.app_delete_protected(m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.movies WHERE id=m AND
  (seen_n OR seen_v OR seen_rating_n IS NOT NULL OR seen_rating_v IS NOT NULL OR seen_rating_together IS NOT NULL OR
   personal_liked_n IS NOT NULL OR personal_liked_v IS NOT NULL OR personal_liked_updated_at_n IS NOT NULL OR personal_liked_updated_at_v IS NOT NULL OR
   coalesce(review_text_n,'')<>'' OR coalesce(review_text_v,'')<>'' OR coalesce(review_text_together,'')<>'' OR in_shared_list OR
   watched_by IS NOT NULL OR review_by IS NOT NULL OR review_text IS NOT NULL OR coalesce(rating,0)<>0))
 OR EXISTS(SELECT FROM public.personal_list_entries WHERE movie_id=m)
 OR EXISTS(SELECT FROM public.group_movie_states WHERE movie_id=m)
 OR EXISTS(SELECT FROM public.movie_nights WHERE movie_id=m)
 OR EXISTS(SELECT FROM public.movie_night_intentions WHERE movie_id=m)
 OR EXISTS(SELECT FROM public.domain_command_receipts WHERE movie_id=m)
 OR EXISTS(SELECT FROM public.vetoes WHERE movie_id=m)
 OR EXISTS(SELECT FROM public.votes WHERE movie_id=m)
 OR EXISTS(SELECT FROM public.swipes WHERE movie_id=m)
 OR EXISTS(SELECT FROM public.swipe_sessions WHERE matched_movie_id=m OR m=ANY(deck))
$$;

CREATE FUNCTION public.app_current_week() RETURNS text
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_char(clock_timestamp() AT TIME ZONE 'Europe/Rome','IYYY-"W"IW')
$$;

CREATE FUNCTION public.execute_app_command(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE
 caller uuid:=auth.uid(); legacy text; cfg jsonb; rid uuid; kind text; m uuid; g uuid; nid uuid; p jsonb; internal_p jsonb;
 versions jsonb; item jsonb; stale jsonb; expected bigint; k text; s uuid; e uuid; key text; required_scopes jsonb:='[]';
 old_kind boolean; night_kind boolean; create_night boolean; personal boolean; content boolean; changed boolean:=false;
 fingerprint text; prior public.domain_command_receipts; r jsonb; scopes jsonb:='[]'; affected jsonb:='[]';
 row_movie public.movies; night_row public.movie_nights; veto_row public.vetoes; week text; other_id uuid; id_value bigint; old_id bigint; lock_key integer;
 evaluation jsonb; eval_changed boolean:=false; params_snapshot jsonb; target jsonb; mode_error text; base_kind text;
BEGIN
 -- Invalid envelopes never become an unrestricted mutation language.
 PERFORM public.app_shape(p_request,ARRAY['protocol_version','request_id','intent','target','expected_versions','parameters']);
 rid:=public.app_uuid(p_request->'request_id');
 IF p_request->'protocol_version'<>'1'::jsonb THEN RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED' USING ERRCODE='22023';END IF;
 cfg:=public.get_app_runtime_context(1);
 IF cfg->>'outcome'<>'OK' THEN RETURN public.app_wire(jsonb_build_object('outcome',cfg#>>'{error,code}'),rid,NULL);END IF;
 IF NOT (cfg#>>'{runtime,activation_allowed}')::boolean THEN RETURN public.app_wire(jsonb_build_object('outcome','MAINTENANCE'),rid,NULL);END IF;
 legacy:=cfg#>>'{caller,legacy_person}';kind:=p_request->>'intent';target:=p_request->'target';p:=p_request->'parameters';versions:=p_request->'expected_versions';
 PERFORM public.app_shape(target,ARRAY['movie_id','group_id','night_id']);
 IF target->'movie_id'<>'null'::jsonb THEN m:=public.app_uuid(target->'movie_id');END IF;
 IF target->'group_id'<>'null'::jsonb THEN g:=public.app_uuid(target->'group_id');END IF;
 IF target->'night_id'<>'null'::jsonb THEN nid:=public.app_uuid(target->'night_id');END IF;
 IF g IS NOT NULL AND g::text<>cfg#>>'{selected_group,group_id}' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p)<>'object' OR jsonb_typeof(versions)<>'array' OR jsonb_typeof(p_request->'intent')<>'string' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 old_kind:=kind IN ('ADD_PERSONAL_LIST','REMOVE_PERSONAL_LIST','RETROSPECTIVE_SEEN','REMOVE_PERSONAL_SEEN','NEW_PERSONAL_VIEWING',
  'PERSONAL_PREFERENCE','PERSONAL_RATING','PERSONAL_REVIEW','PROPOSE_TO_GROUP','WITHDRAW_GROUP_CANDIDACY','TOGETHER_RATING','TOGETHER_REVIEW',
  'SCHEDULE_NIGHT','QUICK_NIGHT','CONFIRM_NIGHT','CANCEL_NIGHT','EDIT_NIGHT','COMPLETE_NIGHT','COMPLETE_NOW');
 IF NOT old_kind AND kind NOT IN ('SET_PERSONAL_EVALUATION','RECORD_PERSONAL_SEEN_WITH_EVALUATION','SET_TOGETHER_EVALUATION',
  'COMPLETE_NIGHT_WITH_CONTEXT','COMPLETE_NOW_WITH_CONTEXT','VETO_ADD','VETO_REMOVE','CONTENT_CREATE','CONTENT_UPDATE_METADATA',
  'CONTENT_SET_SURPRISE','CONTENT_SET_CINEMA','CONTENT_DELETE') THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 content:=kind LIKE 'CONTENT_%';
 personal:=kind IN ('ADD_PERSONAL_LIST','REMOVE_PERSONAL_LIST','RETROSPECTIVE_SEEN','REMOVE_PERSONAL_SEEN','NEW_PERSONAL_VIEWING',
  'PERSONAL_PREFERENCE','PERSONAL_RATING','PERSONAL_REVIEW','SET_PERSONAL_EVALUATION','RECORD_PERSONAL_SEEN_WITH_EVALUATION');
 IF (personal OR content) AND g IS NOT NULL OR (NOT personal AND NOT content AND g IS NULL) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 night_kind:=kind IN ('CONFIRM_NIGHT','CANCEL_NIGHT','EDIT_NIGHT','COMPLETE_NIGHT','COMPLETE_NIGHT_WITH_CONTEXT');
 create_night:=kind IN ('SCHEDULE_NIGHT','QUICK_NIGHT','COMPLETE_NOW','COMPLETE_NOW_WITH_CONTEXT');
 IF (kind='CONTENT_CREATE')<>(m IS NULL) OR night_kind<>(nid IS NOT NULL) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(versions) LOOP
  PERFORM public.app_shape(item,ARRAY['scope_kind','scope_id','entity_id','version']);
  k:=item->>'scope_kind';s:=public.app_uuid(item->'scope_id');e:=public.app_uuid(item->'entity_id');PERFORM public.app_decimal(item->'version');
  IF k IS NULL OR k NOT IN ('person_film','group_film','night','content') OR
   (k='person_film' AND (NOT personal OR m IS NULL OR s<>caller OR e<>m)) OR
   (k='group_film' AND (g IS NULL OR m IS NULL OR s<>g OR e<>m OR NOT (kind IN ('PROPOSE_TO_GROUP','WITHDRAW_GROUP_CANDIDACY','TOGETHER_RATING','TOGETHER_REVIEW','SET_TOGETHER_EVALUATION','VETO_ADD','VETO_REMOVE','COMPLETE_NIGHT_WITH_CONTEXT','COMPLETE_NOW_WITH_CONTEXT') OR create_night))) OR
   (k='night' AND (NOT night_kind OR g IS NULL OR nid IS NULL OR s<>g OR e<>nid)) OR (k='content' AND (NOT content OR m IS NULL OR s<>m OR e<>m)) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(versions))<>(SELECT count(DISTINCT(x->>'scope_kind',x->>'scope_id',x->>'entity_id')) FROM jsonb_array_elements(versions) x) THEN
  RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'scope_kind' COLLATE "C",x->>'scope_id',x->>'entity_id'),'[]') INTO versions FROM jsonb_array_elements(versions) x;
 internal_p:=p;
 FOR key IN SELECT unnest(ARRAY['generation','expected_candidate_revision']) LOOP
  IF p ? key THEN internal_p:=jsonb_set(internal_p,ARRAY[key],to_jsonb(public.app_decimal(p->key)));END IF;
 END LOOP;
 IF p ? 'participants' THEN
  IF jsonb_typeof(p->'participants')<>'array' OR jsonb_array_length(p->'participants')=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  SELECT jsonb_agg(to_jsonb(public.app_uuid(x)) ORDER BY public.app_uuid(x)) INTO item FROM jsonb_array_elements(p->'participants') x;
  IF jsonb_array_length(item)<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(item) x) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  p:=jsonb_set(p,'{participants}',item);internal_p:=jsonb_set(internal_p,'{participants}',item);
 END IF;
 IF night_kind THEN
  k:='night';s:=g;e:=nid;
  IF old_kind AND (NOT p ? 'night_id' OR public.app_uuid(p->'night_id')<>nid) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
 ELSIF NOT create_night AND kind<>'CONTENT_CREATE' THEN k:=CASE WHEN content THEN 'content' WHEN personal THEN 'person_film' ELSE 'group_film' END;s:=coalesce(g,caller);IF content THEN s:=m;END IF;e:=m;
 ELSE k:=NULL;END IF;
 IF k IS NOT NULL THEN
  SELECT public.app_decimal(x->'version') INTO expected FROM jsonb_array_elements(versions) x WHERE x->>'scope_kind'=k AND x->>'scope_id'=s::text AND x->>'entity_id'=e::text;
  IF expected IS NULL THEN RAISE EXCEPTION 'MISSING_EXPECTED_VERSION' USING ERRCODE='22023';END IF;
  required_scopes:=required_scopes||jsonb_build_array(public.app_scope(k,s,e));
 END IF;
 IF coalesce((p->>'select_candidate')::boolean,false) THEN
  IF NOT create_night OR NOT p ? 'expected_candidate_revision' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(versions) x WHERE x->>'scope_kind'='group_film' AND x->>'scope_id'=g::text AND x->>'entity_id'=m::text AND x->>'version'=p->>'expected_candidate_revision') THEN
   RAISE EXCEPTION 'MISSING_EXPECTED_VERSION' USING ERRCODE='22023';END IF;
 END IF;
 IF old_kind THEN
  -- Byte-compatible historical Phase 2 canonical fingerprint, including its
  -- participant sort and numeric internal candidate/generation representation.
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('kind',kind,'movie',m,'group',g,'expected',expected,'parameters',internal_p)::text,'UTF8')),'hex');
 ELSE
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('kind',kind,'target',target,'expected_versions',versions,'parameters',p)::text,'UTF8')),'hex');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(caller::text||':'||rid::text,0));
 cfg:=public.get_app_runtime_context(1);
 IF cfg->>'outcome'<>'OK' OR NOT coalesce((cfg#>>'{runtime,activation_allowed}')::boolean,false) THEN RAISE EXCEPTION 'MAINTENANCE' USING ERRCODE='22023';END IF;
 SELECT * INTO prior FROM public.domain_command_receipts WHERE caller_id=caller AND request_id=rid;
 IF FOUND THEN
  IF prior.command_kind<>kind OR prior.payload_fingerprint<>fingerprint THEN RETURN public.app_wire(jsonb_build_object('outcome','REQUEST_ID_REUSE'),rid,m);END IF;
  IF prior.result ? 'protocol_version' THEN RETURN prior.result||jsonb_build_object('replayed',true);END IF;
  RETURN public.app_wire(prior.result||jsonb_build_object('replayed',true),rid,m);
 END IF;
 IF old_kind THEN
  -- Admission is already held. Validate the full public vector under the same
  -- movie/relation hierarchy before the unchanged engine checks its primary CAS.
  -- Its admission/movie locks are reentrant; receipts/fingerprints stay Phase 2.
  PERFORM public.domain_lock_movie(m);
  FOR item IN SELECT * FROM jsonb_array_elements(versions) LOOP
   stale:=public.app_cas(versions,item->>'scope_kind',(item->>'scope_id')::uuid,(item->>'entity_id')::uuid);
   IF stale IS NOT NULL THEN RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','STALE','current_versions',jsonb_build_array(stale));END IF;
  END LOOP;
  r:=public.domain_command(rid,kind,m,g,expected,internal_p);
  cfg:=public.get_app_runtime_context(1);
  IF cfg->>'outcome'<>'OK' OR NOT coalesce((cfg#>>'{runtime,activation_allowed}')::boolean,false) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='22023';END IF;
  IF r->>'outcome'='STALE' THEN
   SELECT coalesce(jsonb_agg(public.app_scope(x->>'scope_kind',(x->>'scope_id')::uuid,(x->>'entity_id')::uuid)||
    jsonb_build_object('version',coalesce(v.version,0)::text)),'[]') INTO stale FROM jsonb_array_elements(versions) x
    LEFT JOIN public.domain_versions v ON v.scope_kind=x->>'scope_kind' AND v.scope_id=(x->>'scope_id')::uuid AND v.entity_id=(x->>'entity_id')::uuid;
   RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','STALE','current_versions',stale);
  END IF;
  RETURN public.app_wire(r,rid,m);
 END IF;
 -- Stable external identity admissions precede content roots on every path
 -- that can change a TMDb ID. No root holder subsequently acquires these locks.
 IF kind IN ('CONTENT_CREATE','CONTENT_UPDATE_METADATA') THEN
  params_snapshot:=public.app_content_parameters(p,kind='CONTENT_CREATE');
  id_value:=(params_snapshot->>'tmdb_id')::bigint;
  IF kind='CONTENT_UPDATE_METADATA' THEN SELECT tmdb_id INTO old_id FROM public.movies WHERE id=m;END IF;
  FOR lock_key IN SELECT DISTINCT hashtext(x::text) FROM unnest(ARRAY[id_value,old_id]) x WHERE x IS NOT NULL ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(473103,lock_key);
  END LOOP;
  IF kind='CONTENT_CREATE' THEN
   IF id_value IS NOT NULL THEN SELECT id INTO other_id FROM public.movies WHERE tmdb_id=id_value;END IF;
   m:=coalesce(other_id,gen_random_uuid());
  END IF;
 END IF;
 IF kind<>'CONTENT_CREATE' OR other_id IS NOT NULL THEN
  SELECT * INTO row_movie FROM public.movies WHERE id=m FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='22023';END IF;
 END IF;
 IF kind='CONTENT_UPDATE_METADATA' AND row_movie.tmdb_id IS DISTINCT FROM old_id THEN
  RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','STALE','current_versions',jsonb_build_array(public.app_scope('content',m,m)||
   jsonb_build_object('version',coalesce((SELECT version FROM public.domain_versions WHERE scope_kind='content' AND scope_id=m AND entity_id=m),0)::text)));
 END IF;
 IF kind LIKE 'VETO_%' THEN
  PERFORM public.app_shape(p,ARRAY['expected_week_key']||CASE WHEN kind='VETO_REMOVE' THEN ARRAY['veto_id'] ELSE ARRAY[]::text[] END);
  week:=public.app_current_week();
  IF jsonb_typeof(p->'expected_week_key')<>'string' OR p->>'expected_week_key'<>week THEN
   RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','STALE','current_versions','[]'::jsonb);
  END IF;
  PERFORM pg_advisory_xact_lock(473104,hashtext(caller::text||':'||week));
  IF week<>public.app_current_week() THEN RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','STALE','current_versions','[]'::jsonb);END IF;
 END IF;
 IF kind<>'CONTENT_CREATE' OR other_id IS NOT NULL THEN PERFORM public.app_lock_relations(m);END IF;
 cfg:=public.get_app_runtime_context(1);
 IF cfg->>'outcome'<>'OK' OR NOT coalesce((cfg#>>'{runtime,activation_allowed}')::boolean,false) OR (g IS NOT NULL AND g::text<>cfg#>>'{selected_group,group_id}') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='22023';END IF;
 -- Every supplied CAS is checked under domain locks, before any effect.
 FOR item IN SELECT * FROM jsonb_array_elements(versions) LOOP
  stale:=public.app_cas(versions,item->>'scope_kind',(item->>'scope_id')::uuid,(item->>'entity_id')::uuid);
  IF stale IS NOT NULL THEN RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','STALE','current_versions',jsonb_build_array(stale));END IF;
 END LOOP;
 IF kind IN ('SET_PERSONAL_EVALUATION','RECORD_PERSONAL_SEEN_WITH_EVALUATION') THEN
  changed:=public.app_evaluation(m,legacy,p,false,kind='RECORD_PERSONAL_SEEN_WITH_EVALUATION');
  IF changed THEN scopes:=scopes||jsonb_build_array(public.app_scope('person_film',caller,m));END IF;
 ELSIF kind='SET_TOGETHER_EVALUATION' THEN
  changed:=public.app_evaluation(m,legacy,p,true);
  IF changed THEN scopes:=scopes||jsonb_build_array(public.app_scope('group_film',g,m));END IF;
 ELSIF kind IN ('COMPLETE_NIGHT_WITH_CONTEXT','COMPLETE_NOW_WITH_CONTEXT') THEN
  PERFORM public.app_shape(p,ARRAY['participants'],ARRAY['snack','location','evaluation','select_candidate','expected_candidate_revision']);
  evaluation:=coalesce(p->'evaluation','{}'::jsonb);
  PERFORM public.app_shape(evaluation,'{}',ARRAY['rating','review']);
  SELECT * INTO row_movie FROM public.movies WHERE id=m;
  eval_changed:=(evaluation ? 'rating' AND to_jsonb(row_movie.seen_rating_together) IS DISTINCT FROM nullif(evaluation->'rating','null'::jsonb)) OR
    (evaluation ? 'review' AND to_jsonb(row_movie.review_text_together) IS DISTINCT FROM nullif(evaluation->'review','null'::jsonb));
  stale:=public.app_cas(versions,'group_film',g,m,eval_changed);
  IF stale IS NOT NULL THEN RETURN jsonb_build_object('protocol_version',1,'request_id',rid,'outcome','STALE','current_versions',jsonb_build_array(stale));END IF;
  IF kind='COMPLETE_NIGHT_WITH_CONTEXT' THEN
   SELECT * INTO night_row FROM public.movie_nights WHERE id=nid AND movie_id=m AND group_id=g;
   IF NOT FOUND THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
   IF night_row.status='completed' AND (eval_changed OR (p ? 'snack' AND night_row.snack IS DISTINCT FROM p->>'snack') OR
      (p ? 'location' AND night_row.location IS DISTINCT FROM p->>'location')) THEN RAISE EXCEPTION 'IMMUTABLE_COMPLETION' USING ERRCODE='22023';END IF;
   internal_p:=jsonb_build_object('night_id',nid,'participants',p->'participants');base_kind:='COMPLETE_NIGHT';
  ELSE internal_p:=internal_p-'evaluation';base_kind:='COMPLETE_NOW';END IF;
  r:=public.app_phase2_effects(rid,base_kind,m,g,expected,internal_p);
  IF r->>'outcome' NOT IN ('SUCCESS','ALREADY_IN_TARGET_STATE') THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  scopes:=r->'affected_versions';nid:=(r->>'night_id')::uuid;
  IF kind='COMPLETE_NIGHT_WITH_CONTEXT' AND (p ? 'snack' OR p ? 'location') THEN
   IF length(coalesce(p->>'snack',''))>80 OR length(coalesce(p->>'location',''))>120 OR
     (p ? 'snack' AND jsonb_typeof(p->'snack') NOT IN ('string','null')) OR (p ? 'location' AND jsonb_typeof(p->'location') NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
   UPDATE public.movie_nights SET snack=CASE WHEN p ? 'snack' THEN p->>'snack' ELSE snack END,
     location=CASE WHEN p ? 'location' THEN p->>'location' ELSE location END WHERE id=nid;
  END IF;
  IF public.app_evaluation(m,legacy,evaluation,true) THEN scopes:=scopes||jsonb_build_array(public.app_scope('group_film',g,m));END IF;
 ELSIF kind='VETO_ADD' THEN
  SELECT * INTO veto_row FROM public.vetoes WHERE person=legacy AND week_key=week;
  IF FOUND AND veto_row.movie_id<>m THEN RAISE EXCEPTION 'VETO_ALREADY_USED' USING ERRCODE='22023';END IF;
  IF NOT FOUND THEN INSERT INTO public.vetoes(person,movie_id,week_key) VALUES(legacy,m,week);changed:=true;END IF;
  IF changed THEN scopes:=jsonb_build_array(public.app_scope('group_film',g,m));END IF;
 ELSIF kind='VETO_REMOVE' THEN
  DELETE FROM public.vetoes WHERE id=public.app_uuid(p->'veto_id') AND person=legacy AND movie_id=m AND week_key=week;
  IF FOUND THEN scopes:=jsonb_build_array(public.app_scope('group_film',g,m));END IF;
 ELSIF kind='CONTENT_CREATE' THEN
  IF other_id IS NULL THEN PERFORM public.app_content_write(m,params_snapshot,true,legacy);scopes:=jsonb_build_array(public.app_scope('content',m,m));END IF;
 ELSIF kind='CONTENT_UPDATE_METADATA' THEN
  IF jsonb_populate_record(row_movie,params_snapshot) IS DISTINCT FROM row_movie THEN
   PERFORM public.app_content_write(m,params_snapshot,false,legacy);scopes:=jsonb_build_array(public.app_scope('content',m,m));END IF;
 ELSIF kind='CONTENT_SET_SURPRISE' THEN
  PERFORM public.app_shape(p,ARRAY['enabled']);
  IF jsonb_typeof(p->'enabled')<>'boolean' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  IF (p->>'enabled')::boolean AND row_movie.surprise_by IS NOT NULL AND row_movie.surprise_by<>legacy THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='22023';END IF;
  IF row_movie.surprise_by IS DISTINCT FROM (CASE WHEN (p->>'enabled')::boolean THEN legacy END) THEN
   PERFORM public.app_content_write(m,jsonb_build_object('surprise_by',CASE WHEN (p->>'enabled')::boolean THEN legacy END),false,legacy);scopes:=jsonb_build_array(public.app_scope('content',m,m));END IF;
 ELSIF kind='CONTENT_SET_CINEMA' THEN
  PERFORM public.app_shape(p,ARRAY['value']);IF jsonb_typeof(p->'value')<>'boolean' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  IF row_movie.cinema_watchlist IS DISTINCT FROM (p->>'value')::boolean THEN PERFORM public.app_content_write(m,jsonb_build_object('cinema_watchlist',(p->>'value')::boolean),false,legacy);scopes:=jsonb_build_array(public.app_scope('content',m,m));END IF;
 ELSIF kind='CONTENT_DELETE' THEN
  PERFORM public.app_shape(p,'{}');IF public.app_delete_protected(m) THEN RAISE EXCEPTION 'CONTENT_PROTECTED' USING ERRCODE='22023';END IF;
  DELETE FROM public.movies WHERE id=m;scopes:=jsonb_build_array(public.app_scope('content',m,m));
 END IF;
 -- Deduplicate affected tuples before the ONLY bump pass for new commands.
 FOR item IN SELECT DISTINCT x FROM jsonb_array_elements(scopes) x ORDER BY x LOOP
  IF kind='CONTENT_DELETE' THEN
   INSERT INTO public.domain_versions AS v(scope_kind,scope_id,entity_id,version,tombstone) VALUES('content',m,m,1,true)
    ON CONFLICT(scope_kind,scope_id,entity_id) DO UPDATE SET version=v.version+1,tombstone=true
    RETURNING public.app_scope(scope_kind,scope_id,entity_id)||jsonb_build_object('version',version) INTO r;
  ELSE r:=public.domain_bump(item->>'scope_kind',(item->>'scope_id')::uuid,(item->>'entity_id')::uuid);END IF;
  affected:=affected||jsonb_build_array(r);
 END LOOP;
 r:=jsonb_build_object('protocol_version',1,'request_id',rid,'outcome',CASE WHEN jsonb_array_length(affected)>0 THEN 'SUCCESS' ELSE 'ALREADY_IN_TARGET_STATE' END,
  'replayed',false,'result',jsonb_build_object('movie_id',m,'night_id',nid),'affected_versions',public.app_versions_wire(affected));
 INSERT INTO public.domain_command_receipts(caller_id,request_id,command_kind,payload_fingerprint,result_status,result,affected_versions,movie_id,group_id,night_id)
  VALUES(caller,rid,kind,fingerprint,lower(r->>'outcome'),r,r->'affected_versions',CASE WHEN content OR kind LIKE 'VETO_%' THEN NULL ELSE m END,g,nid);
 RETURN r;
EXCEPTION
 WHEN SQLSTATE '22023' THEN RETURN public.app_wire(jsonb_build_object('outcome',CASE WHEN SQLERRM=ANY(ARRAY['VALIDATION_ERROR','PROTOCOL_UNSUPPORTED','FORBIDDEN','MAINTENANCE','MISSING_EXPECTED_VERSION','NIGHT_VERSION_MISSING','TOMBSTONED','CONTENT_NOT_FOUND','VETO_ALREADY_USED','IMMUTABLE_COMPLETION','CONTENT_PROTECTED']) THEN SQLERRM ELSE 'VALIDATION_ERROR' END),rid,m);
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN
  RETURN public.app_wire(jsonb_build_object('outcome','VALIDATION_ERROR'),rid,m);
 WHEN unique_violation THEN RETURN public.app_wire(jsonb_build_object('outcome','CONFLICT'),rid,m);
 WHEN foreign_key_violation THEN RETURN public.app_wire(jsonb_build_object('outcome','CONTENT_PROTECTED'),rid,m);
 WHEN insufficient_privilege THEN RETURN public.app_wire(jsonb_build_object('outcome','FORBIDDEN'),rid,m);
 WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN RETURN public.app_wire(jsonb_build_object('outcome','TRANSIENT_FAILURE'),rid,m);
END $$;

-- Match remains its own protocol. These helpers READ core eligibility only;
-- Match writes never bump domain_versions or write domain command receipts.
CREATE FUNCTION public.app_match_eligible(m uuid,g uuid,w text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((SELECT NOT cinema_watchlist AND public.domain_candidate(g,m) FROM public.movies WHERE id=m),false)
  AND NOT EXISTS(SELECT FROM public.movie_nights WHERE movie_id=m AND group_id=g AND status IN ('proposed','confirmed','completed'))
  AND NOT EXISTS(SELECT FROM public.vetoes WHERE movie_id=m AND week_key=w)
$$;
CREATE FUNCTION public.app_match_progress(s uuid,g uuid,w text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH session AS (SELECT * FROM public.swipe_sessions WHERE id=s), cards AS (
  SELECT d.id,d.n,public.app_match_eligible(d.id,g,w) eligible,
   (SELECT count(DISTINCT person)=2 FROM public.swipes WHERE session_id=s AND movie_id=d.id AND person IN ('N','V')) resolved,
   (SELECT count(DISTINCT person)=2 FROM public.swipes WHERE session_id=s AND movie_id=d.id AND person IN ('N','V') AND liked) matched
  FROM session CROSS JOIN LATERAL unnest(session.deck) WITH ORDINALITY d(id,n)
 ), last_match AS (SELECT id FROM cards WHERE eligible AND matched ORDER BY n DESC LIMIT 1)
 SELECT jsonb_build_object('pending_movie_id',CASE WHEN (SELECT id FROM last_match) IS DISTINCT FROM session.matched_movie_id THEN (SELECT id FROM last_match) END,
  'done',NOT EXISTS(SELECT FROM cards WHERE eligible AND NOT resolved)) FROM session
$$;
CREATE FUNCTION public.execute_match_action(p_protocol integer,p_action text,p_parameters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jsonb; legacy text; g uuid; sid uuid; m uuid; deck_ids uuid[]; original_deck uuid[]; seed_value integer;
 event public.swipe_sessions; old_event public.swipe_sessions; progress jsonb; w text; pending uuid; effective boolean:=false; rowcount integer;
BEGIN
 cfg:=public.get_app_runtime_context(p_protocol);
 IF cfg->>'outcome'<>'OK' THEN RETURN jsonb_build_object('outcome','ERROR','error',jsonb_build_object('code',cfg#>>'{error,code}'));END IF;
 IF NOT (cfg#>>'{runtime,activation_allowed}')::boolean THEN RETURN jsonb_build_object('outcome','ERROR','error',jsonb_build_object('code','MAINTENANCE'));END IF;
 g:=(cfg#>>'{selected_group,group_id}')::uuid;legacy:=cfg#>>'{caller,legacy_person}';w:=public.app_current_week();
 IF p_action='start' THEN
  PERFORM public.app_shape(p_parameters,ARRAY['seed','deck']);
  IF jsonb_typeof(p_parameters->'seed')<>'number' OR (p_parameters->>'seed') !~ '^[0-9]+$' OR
    (p_parameters->>'seed')::numeric>2147483647 OR jsonb_typeof(p_parameters->'deck')<>'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  seed_value:=(p_parameters->>'seed')::integer;
  SELECT coalesce(array_agg(public.app_uuid(x) ORDER BY n),'{}'::uuid[]) INTO deck_ids FROM jsonb_array_elements(p_parameters->'deck') WITH ORDINALITY d(x,n);
  IF cardinality(deck_ids)<>(SELECT count(DISTINCT x) FROM unnest(deck_ids) x) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  -- Only session creation uses this protocol-local active-session admission.
  PERFORM pg_advisory_xact_lock(473105,hashtext(g::text));
  PERFORM id FROM public.movies WHERE id=ANY(deck_ids) ORDER BY id FOR KEY SHARE;
  IF EXISTS(SELECT FROM unnest(deck_ids) x WHERE NOT public.app_match_eligible(x,g,w)) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  SELECT * INTO event FROM public.swipe_sessions WHERE status IN ('open','matched') FOR UPDATE;
  cfg:=public.get_app_runtime_context(p_protocol);
  IF cfg->>'outcome'<>'OK' THEN RETURN jsonb_build_object('outcome','ERROR','error',cfg->'error');END IF;
  IF NOT (cfg#>>'{runtime,activation_allowed}')::boolean OR g::text<>cfg#>>'{selected_group,group_id}' OR legacy IS DISTINCT FROM cfg#>>'{caller,legacy_person}' THEN
   RETURN jsonb_build_object('outcome','ERROR','error',jsonb_build_object('code','MAINTENANCE'));END IF;
  IF event.id IS NULL THEN
   INSERT INTO public.swipe_sessions(created_by,seed,deck,status) VALUES(legacy,seed_value,deck_ids,'open') RETURNING * INTO event;
   effective:=true;
  END IF;
 ELSE
  IF p_action='swipe' THEN
   PERFORM public.app_shape(p_parameters,ARRAY['session_id','movie_id','liked']);m:=public.app_uuid(p_parameters->'movie_id');
   IF jsonb_typeof(p_parameters->'liked')<>'boolean' THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
   PERFORM id FROM public.movies WHERE id=m FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  ELSIF p_action='acknowledge-match' THEN
   PERFORM public.app_shape(p_parameters,ARRAY['session_id','matched_movie_id']);
   m:=public.app_uuid(p_parameters->'matched_movie_id');
  ELSIF p_action IN ('close','reconcile-done') THEN
   PERFORM public.app_shape(p_parameters,ARRAY['session_id']);
  ELSE RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
  sid:=public.app_uuid(p_parameters->'session_id');
  IF p_action='acknowledge-match' THEN
   SELECT deck INTO original_deck FROM public.swipe_sessions WHERE id=sid;
   PERFORM id FROM public.movies WHERE id=ANY(original_deck) ORDER BY id FOR KEY SHARE;
  END IF;
  SELECT * INTO event FROM public.swipe_sessions WHERE id=sid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','STALE','session',NULL);END IF;
  cfg:=public.get_app_runtime_context(p_protocol);
  IF cfg->>'outcome'<>'OK' THEN RETURN jsonb_build_object('outcome','ERROR','error',cfg->'error');END IF;
  IF NOT (cfg#>>'{runtime,activation_allowed}')::boolean OR g::text<>cfg#>>'{selected_group,group_id}' OR legacy IS DISTINCT FROM cfg#>>'{caller,legacy_person}' THEN
   RETURN jsonb_build_object('outcome','ERROR','error',jsonb_build_object('code','MAINTENANCE'));END IF;
  old_event:=event;
  IF p_action='swipe' THEN
   IF NOT m=ANY(event.deck) THEN RAISE EXCEPTION 'VALIDATION_ERROR' USING ERRCODE='22023';END IF;
   -- Preserve ignoreDuplicates semantics, including late historical swipes.
   INSERT INTO public.swipes(session_id,movie_id,person,liked) VALUES(sid,m,legacy,(p_parameters->>'liked')::boolean)
    ON CONFLICT(session_id,movie_id,person) DO NOTHING;
   GET DIAGNOSTICS rowcount=ROW_COUNT;effective:=rowcount=1;
  ELSIF p_action='close' THEN
   IF event.status NOT IN ('open','matched') THEN RETURN jsonb_build_object('outcome','STALE','session',to_jsonb(event));END IF;
   UPDATE public.swipe_sessions SET status='closed' WHERE id=sid RETURNING * INTO event;effective:=true;
  ELSE
   IF p_action='acknowledge-match' AND event.deck IS DISTINCT FROM original_deck THEN RETURN jsonb_build_object('outcome','STALE','session',NULL);END IF;
   IF p_action='acknowledge-match' THEN
    -- The caller names the observed match, never "whatever is pending now".
    IF NOT m=ANY(event.deck) OR (SELECT count(DISTINCT person) FROM public.swipes
      WHERE session_id=sid AND movie_id=m AND person IN ('N','V') AND liked)<>2 THEN
     RETURN jsonb_build_object('outcome','STALE','session',to_jsonb(event));END IF;
    -- A retry cannot acknowledge a successor or change status/timestamps, even
    -- after this session becomes terminal. Authorization was rechecked above.
    IF event.matched_movie_id=m THEN
     RETURN jsonb_build_object('outcome','ALREADY_IN_TARGET_STATE','session',to_jsonb(event),
      'swipes',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY movie_id,person) FROM public.swipes s WHERE session_id=event.id),'[]'::jsonb));
    END IF;
    -- An older observed match cannot roll recognition back if later content
    -- becomes ineligible and the current pending predicate exposes it again.
    IF array_position(event.deck,event.matched_movie_id)>array_position(event.deck,m) THEN
     RETURN jsonb_build_object('outcome','STALE','session',to_jsonb(event));END IF;
   END IF;
   progress:=public.app_match_progress(sid,g,w);pending:=(progress->>'pending_movie_id')::uuid;
   IF p_action='reconcile-done' THEN
    IF event.status='open' AND (progress->>'done')::boolean AND pending IS NULL THEN
     UPDATE public.swipe_sessions SET status='done' WHERE id=sid RETURNING * INTO event;effective:=true;
    END IF;
   ELSIF event.status IN ('open','matched') THEN
    IF pending IS DISTINCT FROM m THEN RETURN jsonb_build_object('outcome','STALE','session',to_jsonb(event));END IF;
    UPDATE public.swipe_sessions SET status=CASE WHEN (progress->>'done')::boolean THEN 'done' ELSE 'open' END,
     matched_movie_id=m,matched_at=clock_timestamp()
     WHERE id=sid RETURNING * INTO event;
    effective:=event IS DISTINCT FROM old_event;
   ELSE RETURN jsonb_build_object('outcome','STALE','session',to_jsonb(event));END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('outcome',CASE WHEN effective THEN 'SUCCESS' ELSE 'ALREADY_IN_TARGET_STATE' END,'session',to_jsonb(event),
  'swipes',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY movie_id,person) FROM public.swipes s WHERE session_id=event.id),'[]'::jsonb));
EXCEPTION
 WHEN SQLSTATE '22023' OR invalid_text_representation OR numeric_value_out_of_range OR check_violation OR foreign_key_violation OR not_null_violation THEN
  RETURN jsonb_build_object('outcome','ERROR','error',jsonb_build_object('code','VALIDATION_ERROR'));
 WHEN insufficient_privilege THEN RETURN jsonb_build_object('outcome','ERROR','error',jsonb_build_object('code','FORBIDDEN'));
 WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN RETURN jsonb_build_object('outcome','ERROR','error',jsonb_build_object('code','TRANSIENT_FAILURE'));
END $$;

DO $dormant$
DECLARE p regprocedure;
BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[
  'app_scope','app_uuid','app_decimal','app_shape','app_versions_wire','app_wire','app_phase2_effects','app_lock_relations','app_cas',
  'app_evaluation','app_content_write','app_content_parameters','app_delete_protected','app_current_week','app_match_eligible','app_match_progress',
  'execute_app_command','execute_match_action','get_app_runtime_context']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p);
 END LOOP;
END $dormant$;
COMMIT;
