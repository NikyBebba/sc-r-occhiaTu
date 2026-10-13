-- READ ONLY, single statement. Run separately PRE and POST, retain both exports
-- OUTSIDE Git. Compare fingerprints/counts/inventories; do not use whole-row
-- movies JSON across an additive schema migration. No SQL here applies a migration.
WITH historic_movies AS (
 SELECT m.id,
  m.title,
  m.added_by,
  m.status,
  m.cinema_watchlist,
  m.duration,
  m.platform,
  m.poster,
  m.trailer_url,
  m.matched,
  m.imdb_rating,
  m.rt_rating,
  m.metacritic_rating,
  m.rating,
  m.seen_rating_n,
  m.seen_rating_v,
  m.seen_rating_together,
  m.scheduled_date,
  m.scheduled_time,
  m.snack,
  m.review_text,
  m.review_text_n,
  m.review_text_v,
  m.review_text_together,
  m.review_by,
  m.watched_by,
  m.genre,
  m.proposed_by,
  m.night_confirmed,
  m.surprise_by,
  m.tmdb_id,
  m.collection_id,
  m.collection_name,
  m.created_at,
  m.genres,
  m.release_year,
  m.director,
  m.overview,
  m.cast_names,
  m.seen_n,
  m.seen_v,
  m.in_shared_list
 FROM public.movies m
), fingerprints AS (
 SELECT 'movies_historic_projection' AS dataset,count(*) AS rows,
 md5(coalesce(string_agg(to_jsonb(m)::text, '' ORDER BY id),'')) AS fingerprint FROM historic_movies m
 UNION ALL SELECT 'movie_nights',count(*),md5(coalesce(string_agg(to_jsonb(n)::text,'' ORDER BY id),'')) FROM public.movie_nights n
 UNION ALL SELECT 'completed',count(*),md5(coalesce(string_agg(to_jsonb(n)::text,'' ORDER BY id),'')) FROM public.movie_nights n WHERE status='completed'
 UNION ALL SELECT 'swipe_sessions',count(*),md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),'')) FROM public.swipe_sessions s
 UNION ALL SELECT 'swipes',count(*),md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),'')) FROM public.swipes s
 UNION ALL SELECT 'votes',count(*),md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),'')) FROM public.votes s
 UNION ALL SELECT 'vetoes',count(*),md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),'')) FROM public.vetoes s
), metrics AS (
 SELECT count(*) movies,count(*) FILTER(WHERE seen_n) seen_n,count(*) FILTER(WHERE seen_v) seen_v,
 count(*) FILTER(WHERE in_shared_list) shared_list,
 count(*) FILTER(WHERE seen_rating_n IS NOT NULL) rating_n,count(*) FILTER(WHERE seen_rating_v IS NOT NULL) rating_v,
 count(*) FILTER(WHERE seen_rating_together IS NOT NULL) rating_together,
 count(*) FILTER(WHERE nullif(review_text_n,'') IS NOT NULL) review_n,
 count(*) FILTER(WHERE nullif(review_text_v,'') IS NOT NULL) review_v,
 count(*) FILTER(WHERE nullif(review_text_together,'') IS NOT NULL) review_together,
 count(*) FILTER(WHERE (to_jsonb(m)->>'personal_liked_n') IS NOT NULL) preferences_n,
 count(*) FILTER(WHERE (to_jsonb(m)->>'personal_liked_v') IS NOT NULL) preferences_v
 FROM public.movies m
), columns_inventory AS (
 SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.movies'::regclass AND a.attnum>0 AND NOT a.attisdropped
), constraints_inventory AS (
 SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition
 FROM pg_constraint WHERE conrelid='public.movies'::regclass
), functions_inventory AS (
 SELECT p.proname,p.prosecdef,p.proconfig,p.proacl,md5(p.prosrc) AS body_md5,pg_get_functiondef(p.oid) AS definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('app_person','guard_movie_watch','clear_personal_preference_for_rating','manage_movie_night')
), triggers_inventory AS (
 SELECT c.relname,t.tgname,t.tgenabled,t.tgtype,t.tgattr::text AS update_columns,pg_get_triggerdef(t.oid) AS definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.movies'::regclass,'public.movie_nights'::regclass,'public.swipe_sessions'::regclass,'public.swipes'::regclass)
), policies_inventory AS (
 SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('movies','movie_nights','app_members','swipe_sessions','swipes','votes','vetoes')
), grants_inventory AS (
 SELECT grantee,table_name,privilege_type,is_grantable FROM information_schema.table_privileges
 WHERE table_schema='public' AND table_name IN ('movies','movie_nights','app_members','swipe_sessions','swipes','votes','vetoes')
), rls_inventory AS (
 SELECT relname,relrowsecurity,relforcerowsecurity,relacl FROM pg_class WHERE oid IN
 ('public.movies'::regclass,'public.movie_nights'::regclass,'public.app_members'::regclass,'public.swipe_sessions'::regclass,'public.swipes'::regclass,'public.votes'::regclass,'public.vetoes'::regclass)
), fk_inventory AS (
 SELECT conrelid::regclass::text AS source,confrelid::regclass::text AS target,conname,pg_get_constraintdef(oid) AS definition
 FROM pg_constraint WHERE contype='f' AND (conrelid IN ('public.movies'::regclass,'public.movie_nights'::regclass,'public.swipe_sessions'::regclass,'public.swipes'::regclass) OR confrelid IN ('public.movies'::regclass,'public.movie_nights'::regclass,'public.swipe_sessions'::regclass,'public.swipes'::regclass))
), orphan_checks AS (
 SELECT NOT EXISTS(SELECT FROM public.movie_nights n LEFT JOIN public.movies m ON m.id=n.movie_id WHERE m.id IS NULL)
 AND NOT EXISTS(SELECT FROM public.swipes s LEFT JOIN public.swipe_sessions ss ON ss.id=s.session_id LEFT JOIN public.movies m ON m.id=s.movie_id WHERE ss.id IS NULL OR m.id IS NULL)
 AND NOT EXISTS(SELECT FROM public.swipe_sessions s LEFT JOIN public.movies m ON m.id=s.matched_movie_id WHERE s.matched_movie_id IS NOT NULL AND m.id IS NULL) AS passed
), schema_checks AS (
 SELECT CASE WHEN (SELECT count(*) FROM columns_inventory WHERE name LIKE 'personal_liked%')=0 THEN 'PRE'
 WHEN (SELECT count(*) FROM columns_inventory WHERE name IN ('personal_liked_n','personal_liked_v','personal_liked_updated_at_n','personal_liked_updated_at_v'))=4 THEN 'POST' ELSE 'PARTIAL_OR_DRIFT' END AS phase,
 (SELECT body_md5='068c195f09f6d17143f8d1989f4931d4' FROM functions_inventory WHERE proname='guard_movie_watch') AS guard_pre_matches,
 (SELECT body_md5='eb020c52de06995b9c463615d17ea193' FROM functions_inventory WHERE proname='guard_movie_watch') AS guard_post_matches,
 (SELECT body_md5='7a2eedc8a2f032721d4a086ef72046fb' FROM functions_inventory WHERE proname='manage_movie_night') AS snack_rpc_matches,
 (SELECT count(*)=4 FROM constraints_inventory WHERE convalidated AND conname IN ('movies_personal_feedback_n_exclusive','movies_personal_feedback_v_exclusive','movies_personal_preference_n_timestamp','movies_personal_preference_v_timestamp')) AS preference_constraints_present,
 (SELECT count(*)=4 FROM columns_inventory WHERE NOT not_null AND default_expression IS NULL AND ((name IN ('personal_liked_n','personal_liked_v') AND type='boolean') OR (name IN ('personal_liked_updated_at_n','personal_liked_updated_at_v') AND type='timestamp with time zone'))) AS preference_column_types_match
)
SELECT jsonb_build_object(
 'audit_at',statement_timestamp(),'timezone',current_setting('TimeZone'),
 'schema_checks',(SELECT to_jsonb(s) FROM schema_checks s),
 'metrics',(SELECT to_jsonb(m) FROM metrics m),
 'membership',(SELECT jsonb_build_object('count',count(*),'persons',array_agg(person ORDER BY person)) FROM public.app_members),
 'fingerprints',(SELECT jsonb_agg(to_jsonb(f) ORDER BY dataset) FROM fingerprints f),
 'night_status',(SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*) n FROM movie_nights GROUP BY status) s),
 'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY name) FROM columns_inventory c),
 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY conname) FROM constraints_inventory c),
 'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY proname) FROM functions_inventory f),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relname,tgname) FROM triggers_inventory t),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM policies_inventory p),
 'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY table_name,grantee,privilege_type) FROM grants_inventory g),
 'rls',(SELECT jsonb_agg(to_jsonb(r) ORDER BY relname) FROM rls_inventory r),
 'foreign_keys',(SELECT jsonb_agg(to_jsonb(f) ORDER BY source,conname) FROM fk_inventory f),
 'orphans_pass',(SELECT passed FROM orphan_checks),
 'release_gate','Manual PRE/POST comparison required. Local PASS is not live authorization.'
) AS personal_preference_db_audit;
