-- Phase 3A LOCAL ONLY. Two read-only objects; no runtime grants or activation.
-- One SQL statement and STABLE callees inherit the invoking statement snapshot.
-- No locks, mutation, version initialization, receipt writes or legacy repair.
BEGIN;

CREATE FUNCTION public.snapshot_v1_night_instant(p_date date, p_time text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_date IS NULL OR NOT isfinite(p_date) OR p_time IS NULL
   OR p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN RETURN NULL; END IF;
 RETURN public.domain_unique_rome_instant(p_date+p_time::time);
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $$;

CREATE FUNCTION public.get_person_group_snapshot(p_group_id uuid, p_contract_version integer DEFAULT 1) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET DateStyle='ISO, YMD' AS $$
WITH
ctx AS MATERIALIZED (
 SELECT auth.uid() caller, statement_timestamp() as_of, p_group_id gid, p_contract_version cv
),
cfg AS MATERIALIZED (SELECT current_group_id FROM public.app_protocol_state),
gate AS MATERIALIZED (
 SELECT c.*, CASE
  WHEN caller IS NULL THEN 'UNAUTHENTICATED'
  WHEN NOT EXISTS(SELECT FROM public.app_members a WHERE a.user_id=c.caller) THEN 'FORBIDDEN'
  WHEN cv IS DISTINCT FROM 1 THEN 'UNSUPPORTED_CONTRACT'
  WHEN gid IS NULL THEN 'INVALID_GROUP'
  WHEN NOT EXISTS(SELECT FROM cfg WHERE current_group_id IS NOT NULL) THEN 'FOUNDATION_NOT_READY'
  WHEN NOT EXISTS(SELECT FROM public.groups g JOIN public.group_memberships gm ON gm.group_id=g.id
    WHERE g.id=c.gid AND g.status='active' AND gm.person_id=c.caller AND gm.active) THEN 'FORBIDDEN'
  WHEN gid IS DISTINCT FROM (SELECT current_group_id FROM cfg) THEN 'UNSUPPORTED_GROUP'
  WHEN EXISTS(SELECT FROM public.movie_nights WHERE group_id IS NULL) THEN 'FOUNDATION_NOT_READY'
 END error FROM ctx c
),
members AS MATERIALIZED (
 SELECT gm.person_id,a.person legacy_person FROM public.group_memberships gm
 CROSS JOIN gate c LEFT JOIN public.app_members a ON a.user_id=gm.person_id
 WHERE c.error IS NULL AND gm.group_id=c.gid AND gm.active
),
catalog_src AS MATERIALIZED (SELECT m.* FROM public.movies m CROSS JOIN gate c WHERE c.error IS NULL),
nights_src AS MATERIALIZED (
 SELECT n.id,n.movie_id,n.group_id,n.status,n.date,n.time,n.snack,n.location,n.proposed_by,
 n.created_by_caller_id,n.created_at,n.confirmed_at,n.cancelled_at,n.completed_at
 FROM public.movie_nights n CROSS JOIN gate c WHERE c.error IS NULL AND n.group_id=c.gid
),
participants_src AS MATERIALIZED (
 SELECT p.night_id,p.person_id FROM public.movie_night_participants p JOIN nights_src n ON n.id=p.night_id
),
temporal AS MATERIALIZED (
 SELECT c.as_of,(c.as_of AT TIME ZONE 'Europe/Rome')::date local_date,
 to_char(c.as_of AT TIME ZONE 'Europe/Rome','IYYY-"W"IW') week_key,
 least(((c.as_of AT TIME ZONE 'Europe/Rome')::date+1)::timestamp AT TIME ZONE 'Europe/Rome',
   (SELECT min(t.instant) FROM nights_src n CROSS JOIN LATERAL
     (SELECT public.snapshot_v1_night_instant(n.date,n.time) instant) t
     WHERE n.status IN ('proposed','confirmed') AND t.instant>c.as_of)) next_at
 FROM ctx c
),
veto_src AS MATERIALIZED (
 SELECT v.id,v.movie_id,v.person,v.week_key,a.user_id person_id
 FROM public.vetoes v CROSS JOIN temporal t CROSS JOIN gate c
 LEFT JOIN public.app_members a ON a.person=v.person
 WHERE c.error IS NULL AND v.week_key=t.week_key
),
people_ids AS MATERIALIZED (
 SELECT person_id FROM members UNION SELECT person_id FROM participants_src
 UNION SELECT n.created_by_caller_id FROM nights_src n WHERE n.created_by_caller_id IS NOT NULL
 UNION SELECT a.user_id FROM public.app_members a WHERE a.person IN (
   SELECT added_by FROM catalog_src UNION SELECT surprise_by FROM catalog_src UNION SELECT proposed_by FROM nights_src)
 UNION SELECT person_id FROM veto_src WHERE person_id IS NOT NULL
),
people_rows AS MATERIALIZED (
 SELECT p.person_id,jsonb_build_object('person_id',p.person_id,'legacy_person',a.person,
 'personal_readable',EXISTS(SELECT FROM members m WHERE m.person_id=p.person_id)) doc
 FROM people_ids p LEFT JOIN public.app_members a ON a.user_id=p.person_id
),
catalog_rows AS MATERIALIZED (
 SELECT m.id,jsonb_build_object('movie_id',m.id,'title',m.title,'added_by_person_id',a.user_id,
 'created_at',CASE WHEN m.created_at IS NOT NULL THEN to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'duration',m.duration,'platform',m.platform,'poster',m.poster,'trailer_url',m.trailer_url,
 'metadata_matched',m.matched,'imdb_rating',m.imdb_rating,'rt_rating',m.rt_rating,'metacritic_rating',m.metacritic_rating,
 'tmdb_id',m.tmdb_id::text,'collection_id',m.collection_id::text,'collection_name',m.collection_name,
 'director',m.director,'overview',m.overview,'release_year',m.release_year,'genres',m.genres,'cast_names',m.cast_names,
 'cinema_watchlist',m.cinema_watchlist,'surprise_by_person_id',s.user_id) doc
 FROM catalog_src m LEFT JOIN public.app_members a ON a.person=m.added_by
 LEFT JOIN public.app_members s ON s.person=m.surprise_by
),
personal_grid AS MATERIALIZED (
 SELECT p.person_id,m.id movie_id,
 CASE p.legacy_person WHEN 'N' THEN m.seen_n WHEN 'V' THEN m.seen_v END seen,
 coalesce(l.active,false) list_active,CASE WHEN p.person_id=c.caller THEN l.generation::text END generation,
 CASE p.legacy_person
  WHEN 'N' THEN jsonb_build_object('rating',m.seen_rating_n,'preference',m.personal_liked_n,'review',m.review_text_n)
  WHEN 'V' THEN jsonb_build_object('rating',m.seen_rating_v,'preference',m.personal_liked_v,'review',m.review_text_v) END judgment
 FROM members p CROSS JOIN catalog_src m CROSS JOIN ctx c
 LEFT JOIN public.personal_list_entries l ON l.person_id=p.person_id AND l.movie_id=m.id
),
personal_rows AS MATERIALIZED (
 SELECT p.person_id,jsonb_build_object('person_id',p.person_id,
 'states',coalesce((SELECT jsonb_agg(jsonb_build_object('movie_id',x.movie_id,'seen',x.seen,
   'list',jsonb_build_object('active',x.list_active,'generation',x.generation),'judgment',x.judgment) ORDER BY x.movie_id)
   FROM personal_grid x WHERE x.person_id=p.person_id),'[]'::jsonb),
 'collections',jsonb_build_object('list_movie_ids',coalesce((SELECT jsonb_agg(x.movie_id ORDER BY x.movie_id) FROM personal_grid x
   WHERE x.person_id=p.person_id AND x.list_active),'[]'::jsonb),
 'seen_movie_ids',coalesce((SELECT jsonb_agg(x.movie_id ORDER BY x.movie_id) FROM personal_grid x
   WHERE x.person_id=p.person_id AND x.seen),'[]'::jsonb))) doc FROM members p
),
night_sets AS MATERIALIZED (
 SELECT movie_id,
 coalesce(jsonb_agg(id ORDER BY id) FILTER(WHERE status IN ('proposed','confirmed')),'[]'::jsonb) active_ids,
 coalesce(jsonb_agg(id ORDER BY id) FILTER(WHERE status='completed'),'[]'::jsonb) completed_ids
 FROM nights_src GROUP BY movie_id
),
candidate AS MATERIALIZED (
 SELECT m.id,public.domain_candidate(c.gid,m.id) effective FROM catalog_src m CROSS JOIN ctx c
),
group_values AS MATERIALIZED (
 SELECT m.id,ca.effective,coalesce(n.active_ids,'[]'::jsonb) active_ids,coalesce(n.completed_ids,'[]'::jsonb) completed_ids,
 CASE WHEN (SELECT count(*) FROM members)=2 AND (SELECT count(legacy_person) FROM members)=2 THEN
   m.seen_n AND m.seen_v AND jsonb_array_length(coalesce(n.completed_ids,'[]'::jsonb))=0 END rewatch,
 ca.effective AND jsonb_array_length(coalesce(n.active_ids,'[]'::jsonb))=0
 AND jsonb_array_length(coalesce(n.completed_ids,'[]'::jsonb))=0 AND NOT m.cinema_watchlist
 AND (m.status IS NULL OR m.status IN ('watchlist','tonight','watched'))
 AND NOT EXISTS(SELECT FROM veto_src v WHERE v.movie_id=m.id) eligible
 FROM catalog_src m JOIN candidate ca ON ca.id=m.id LEFT JOIN night_sets n ON n.movie_id=m.id
),
group_rows AS MATERIALIZED (
 SELECT id,jsonb_build_object('movie_id',id,'effective_candidacy',effective,
 'list_visible',effective AND jsonb_array_length(active_ids)=0,'active_night_ids',active_ids,'completed_night_ids',completed_ids,
 'rewatch_semantic',rewatch,'rewatch_visible',coalesce(rewatch,false) AND jsonb_array_length(active_ids)=0,
 'eligibility',jsonb_build_object('match_base',eligible,'ruota_base',eligible)) doc FROM group_values
),
judgment_rows AS MATERIALIZED (
 SELECT id,jsonb_build_object('movie_id',id,'rating',seen_rating_together,'review',review_text_together) doc FROM catalog_src
 WHERE seen_rating_together IS NOT NULL OR review_text_together IS NOT NULL
),
night_rows AS MATERIALIZED (
 SELECT n.id,jsonb_build_object('night_id',n.id,'movie_id',n.movie_id,'status',n.status,'date',n.date,'time',n.time,
 'snack',n.snack,'location',n.location,'proposed_by_person_id',coalesce(n.created_by_caller_id,a.user_id),
 'created_at',CASE WHEN n.created_at IS NOT NULL THEN to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'confirmed_at',CASE WHEN n.confirmed_at IS NOT NULL THEN to_char(n.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'cancelled_at',CASE WHEN n.cancelled_at IS NOT NULL THEN to_char(n.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'completed_at',CASE WHEN n.completed_at IS NOT NULL THEN to_char(n.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) doc
 FROM nights_src n LEFT JOIN public.app_members a ON a.person=n.proposed_by
),
exposure_values AS MATERIALIZED (
 SELECT person_id,movie_id,bool_or(personal_seen) personal_seen,bool_or(together) together FROM (
  SELECT person_id,movie_id,true personal_seen,false together FROM personal_grid WHERE seen
  UNION ALL SELECT p.person_id,n.movie_id,false,true FROM participants_src p JOIN nights_src n ON n.id=p.night_id WHERE n.status='completed'
 ) e GROUP BY person_id,movie_id
),
exposure_rows AS MATERIALIZED (
 SELECT person_id,movie_id,jsonb_build_object('person_id',person_id,'movie_id',movie_id,'sources',
 to_jsonb(array_remove(ARRAY[CASE WHEN personal_seen THEN 'PERSONAL_SEEN' END,
 CASE WHEN together THEN 'SELECTED_GROUP_TOGETHER' END],NULL))) doc FROM exposure_values
),
version_src AS MATERIALIZED (
 SELECT v.* FROM public.domain_versions v CROSS JOIN gate c WHERE c.error IS NULL AND (
  (v.scope_kind='person_film' AND v.scope_id IN (SELECT person_id FROM members)
   AND (v.entity_id IN (SELECT id FROM catalog_src) OR v.tombstone)) OR
  (v.scope_kind='group_film' AND v.scope_id=c.gid AND (v.entity_id IN (SELECT id FROM catalog_src) OR v.tombstone)) OR
  (v.scope_kind='content' AND v.scope_id=v.entity_id AND (v.entity_id IN (SELECT id FROM catalog_src) OR v.tombstone)) OR
  (v.scope_kind='night' AND v.scope_id=c.gid AND (v.entity_id IN (SELECT id FROM nights_src) OR v.tombstone)))
),
version_rows AS MATERIALIZED (
 SELECT scope_kind,scope_id,entity_id,jsonb_build_object('scope_kind',scope_kind,'scope_id',scope_id,
 'entity_id',entity_id,'version',version::text,'tombstone',tombstone) doc FROM version_src
),
unavailable AS MATERIALIZED (
 SELECT n.id FROM nights_src n CROSS JOIN ctx c WHERE NOT EXISTS(SELECT FROM version_src v
 WHERE v.scope_kind='night' AND v.scope_id=c.gid AND v.entity_id=n.id)
),
validation AS MATERIALIZED (
 SELECT
 NOT EXISTS(SELECT FROM veto_src v WHERE v.movie_id IS NULL OR v.person_id IS NULL
   OR NOT EXISTS(SELECT FROM catalog_src m WHERE m.id=v.movie_id)
   OR NOT EXISTS(SELECT FROM members p WHERE p.person_id=v.person_id))
 AND NOT EXISTS(SELECT FROM catalog_src m WHERE m.surprise_by IS NOT NULL AND NOT EXISTS(
   SELECT FROM public.app_members a WHERE a.person=m.surprise_by))
 AND NOT EXISTS(SELECT FROM nights_src n WHERE NOT EXISTS(SELECT FROM catalog_src m WHERE m.id=n.movie_id)
   OR (n.status='completed' AND NOT EXISTS(SELECT FROM participants_src p WHERE p.night_id=n.id)))
 AND NOT EXISTS(SELECT FROM participants_src p JOIN nights_src n ON n.id=p.night_id WHERE n.status<>'completed')
 AND NOT EXISTS(SELECT FROM version_src v WHERE v.tombstone AND (
   (v.scope_kind='night' AND EXISTS(SELECT FROM nights_src n WHERE n.id=v.entity_id)) OR
   (v.scope_kind IN ('content','group_film','person_film') AND EXISTS(SELECT FROM catalog_src m WHERE m.id=v.entity_id))))
 AND NOT EXISTS(SELECT FROM version_src v WHERE v.scope_kind='night' AND v.version<1)
 AND (SELECT count(*) FROM personal_grid)=(SELECT count(*) FROM members)*(SELECT count(*) FROM catalog_src)
 AND (SELECT count(*) FROM group_rows)=(SELECT count(*) FROM catalog_src)
 AND (SELECT count(*) FROM catalog_rows)=(SELECT count(*) FROM catalog_src)
 AND (SELECT count(*) FROM night_rows)=(SELECT count(*) FROM nights_src)
 AND (SELECT count(*) FROM personal_rows)=(SELECT count(*) FROM members)
 AND (SELECT count(*) FROM people_rows)=(SELECT count(*) FROM people_ids)
 -- PKs/FKs on the source tables establish these identities; verify projected
 -- cardinality as well so a later join cannot silently multiply/drop entities.
 AND (SELECT count(*)=count(DISTINCT id) FROM catalog_rows)
 AND (SELECT count(*)=count(DISTINCT person_id) FROM people_rows)
 AND (SELECT count(*)=count(DISTINCT (person_id,movie_id)) FROM personal_grid)
 AND (SELECT count(*)=count(DISTINCT id) FROM group_rows)
 AND (SELECT count(*)=count(DISTINCT (scope_kind,scope_id,entity_id)) FROM version_src)
 AND NOT EXISTS(SELECT FROM participants_src p WHERE NOT EXISTS(SELECT FROM people_ids x WHERE x.person_id=p.person_id))
 AS valid
),
arrays AS MATERIALIZED (
 SELECT
 coalesce((SELECT jsonb_agg(doc ORDER BY id) FROM catalog_rows),'[]'::jsonb) catalog,
 coalesce((SELECT jsonb_agg(doc ORDER BY person_id) FROM people_rows),'[]'::jsonb) people,
 coalesce((SELECT jsonb_agg(doc ORDER BY person_id) FROM personal_rows),'[]'::jsonb) personal,
 coalesce((SELECT jsonb_agg(doc ORDER BY id) FROM group_rows),'[]'::jsonb) states,
 coalesce((SELECT jsonb_agg(doc ORDER BY id) FROM judgment_rows),'[]'::jsonb) judgments,
 coalesce((SELECT jsonb_agg(doc ORDER BY id) FROM night_rows),'[]'::jsonb) nights,
 coalesce((SELECT jsonb_agg(jsonb_build_object('night_id',night_id,'person_id',person_id) ORDER BY night_id,person_id) FROM participants_src),'[]'::jsonb) participants,
 coalesce((SELECT jsonb_agg(doc ORDER BY person_id,movie_id) FROM exposure_rows),'[]'::jsonb) exposure,
 coalesce((SELECT jsonb_agg(jsonb_build_object('veto_id',id,'person_id',person_id,'movie_id',movie_id,'week_key',week_key) ORDER BY id) FROM veto_src),'[]'::jsonb) vetoes,
 coalesce((SELECT jsonb_agg(doc ORDER BY scope_kind COLLATE "C",scope_id,entity_id) FROM version_rows),'[]'::jsonb) entries,
 coalesce((SELECT jsonb_agg(id ORDER BY id) FROM unavailable),'[]'::jsonb) unavailable_ids
),
document AS MATERIALIZED (
 SELECT jsonb_build_object('contract_version',1,'outcome','OK','caller',jsonb_build_object('person_id',c.caller),
 'selected_group',jsonb_build_object('group_id',c.gid,'member_person_ids',coalesce((SELECT jsonb_agg(person_id ORDER BY person_id) FROM members),'[]'::jsonb)),
 'temporal',jsonb_build_object('as_of',to_char(t.as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'timezone','Europe/Rome','local_date',t.local_date,'week_key',t.week_key,
 'next_temporal_invalidation_at',to_char(t.next_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
 'coverage',jsonb_build_object('complete',true,'catalog','FULL_APP_CATALOG',
 'personal_person_ids',coalesce((SELECT jsonb_agg(person_id ORDER BY person_id) FROM members),'[]'::jsonb),'group_id',c.gid,
 'nights','ALL_SELECTED_GROUP','participants','ALL_RETURNED_NIGHTS','veto_week_key',t.week_key,
 'versions','COVERED_SCOPES_AND_RETAINED_MARKERS','counts',jsonb_build_object(
 'catalog',(SELECT count(*) FROM catalog_src),'people',(SELECT count(*) FROM people_ids),
 'personal_views',(SELECT count(*) FROM members),'personal_states',(SELECT count(*) FROM personal_grid),
 'group_states',(SELECT count(*) FROM group_rows),'group_judgments',(SELECT count(*) FROM judgment_rows),
 'nights',(SELECT count(*) FROM nights_src),'participants',(SELECT count(*) FROM participants_src),
 'exposure',(SELECT count(*) FROM exposure_rows),'vetoes',(SELECT count(*) FROM veto_src),
 'version_entries',(SELECT count(*) FROM version_src),'night_tokens_unavailable',(SELECT count(*) FROM unavailable))),
 'catalog',a.catalog,'people',a.people,'personal',a.personal,
 'group',jsonb_build_object('states',a.states,'judgments',a.judgments,'collections',jsonb_build_object(
 'list_movie_ids',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM group_rows WHERE (doc->>'list_visible')::boolean),'[]'::jsonb),
 'scheduled_night_ids',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM nights_src WHERE status IN ('proposed','confirmed')),'[]'::jsonb),
 'together_movie_ids',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM group_values WHERE jsonb_array_length(completed_ids)>0),'[]'::jsonb),
 'rewatch_movie_ids',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM group_rows WHERE (doc->>'rewatch_visible')::boolean),'[]'::jsonb))),
 'nights',a.nights,'participants',a.participants,'exposure',a.exposure,'vetoes',a.vetoes,
 'versions',jsonb_build_object('defaults',jsonb_build_object('person_film','0','group_film','0','content','0','night',NULL),
 'entries',a.entries,'unavailable_night_ids',a.unavailable_ids)) doc
 FROM gate c CROSS JOIN temporal t CROSS JOIN arrays a CROSS JOIN validation v WHERE c.error IS NULL AND v.valid
),
signed AS MATERIALIZED (
 SELECT doc||jsonb_build_object('payload_signature',jsonb_build_object('algorithm','sha256-pg-jsonb-text-v1',
 'value',encode(sha256(convert_to((doc #- '{temporal,as_of}' #- '{temporal,next_temporal_invalidation_at}')::text,'UTF8')),'hex'))) doc FROM document
),
checked AS MATERIALIZED (
 SELECT s.doc,octet_length(convert_to(s.doc::text,'UTF8')) bytes,
 jsonb_array_length(s.doc->'catalog')=(SELECT count(*) FROM catalog_src)
 AND jsonb_array_length(s.doc->'people')=(SELECT count(*) FROM people_ids)
 AND jsonb_array_length(s.doc->'personal')=(SELECT count(*) FROM members)
 AND jsonb_array_length(s.doc->'group'->'states')=(SELECT count(*) FROM catalog_src)
 AND jsonb_array_length(s.doc->'group'->'judgments')=(SELECT count(*) FROM judgment_rows)
 AND jsonb_array_length(s.doc->'nights')=(SELECT count(*) FROM nights_src)
 AND jsonb_array_length(s.doc->'participants')=(SELECT count(*) FROM participants_src)
 AND jsonb_array_length(s.doc->'exposure')=(SELECT count(*) FROM exposure_values)
 AND jsonb_array_length(s.doc->'vetoes')=(SELECT count(*) FROM veto_src)
 AND jsonb_array_length(s.doc->'versions'->'entries')=(SELECT count(*) FROM version_src)
 AND jsonb_array_length(s.doc->'versions'->'unavailable_night_ids')=(SELECT count(*) FROM unavailable)
 AND (SELECT coalesce(sum(jsonb_array_length(p->'states')),0) FROM jsonb_array_elements(s.doc->'personal') p)=(SELECT count(*) FROM personal_grid)
 AS serialized_complete FROM signed s
)
SELECT CASE WHEN g.error IS NOT NULL THEN jsonb_build_object('contract_version',1,'outcome','ERROR','error',jsonb_build_object('code',g.error))
 WHEN NOT v.valid OR NOT coalesce(c.serialized_complete,false) THEN jsonb_build_object('contract_version',1,'outcome','ERROR','error',jsonb_build_object('code','SNAPSHOT_DATA_INVALID'))
 WHEN c.bytes>16777216 THEN jsonb_build_object('contract_version',1,'outcome','ERROR','error',jsonb_build_object('code','SNAPSHOT_TOO_LARGE'))
 ELSE c.doc END
FROM gate g CROSS JOIN validation v LEFT JOIN checked c ON true
$$;

REVOKE ALL ON FUNCTION public.snapshot_v1_night_instant(date,text),
 public.get_person_group_snapshot(uuid,integer) FROM PUBLIC,anon,authenticated;
COMMIT;
