-- CUTOVER: rende incompatibili i vecchi client senza Auth. Applicare SOLO
-- nella finestra concordata, dopo account/mapping/test e frontend pronto.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.app_members) <> 2
     OR EXISTS (SELECT 1 FROM public.app_members m JOIN auth.users u ON u.id = m.user_id
                WHERE u.email_confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'Servono due account reali confermati, associati a N e V';
  END IF;
END $$;
-- La publication deve consentire la rimozione della sola tabella legacy.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables) THEN
    RAISE EXCEPTION 'supabase_realtime assente o FOR ALL TABLES: verificare la publication prima del cutover';
  END IF;
END $$;
-- Snapshot effettivo di policy e grants per rollback, fuori dagli schemi API.
CREATE SCHEMA IF NOT EXISTS app_security_backup;
REVOKE ALL ON SCHEMA app_security_backup FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS app_security_backup.auth_ddl (
  kind text NOT NULL, ddl text NOT NULL
);
REVOKE ALL ON app_security_backup.auth_ddl FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS app_security_backup.auth_publication (
  publication_name text PRIMARY KEY, votes_was_published boolean NOT NULL
);
REVOKE ALL ON app_security_backup.auth_publication FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app_security_backup.auth_ddl)
     OR EXISTS (SELECT 1 FROM app_security_backup.auth_publication) THEN
    RAISE EXCEPTION 'Backup cutover già presente: non sovrascriverlo o rieseguire il cutover';
  END IF;
END $$;
INSERT INTO app_security_backup.auth_publication(publication_name, votes_was_published)
SELECT 'supabase_realtime', EXISTS (
  SELECT 1 FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'votes'
);
DO $$ BEGIN
  IF (SELECT votes_was_published FROM app_security_backup.auth_publication
      WHERE publication_name = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.votes;
  END IF;
END $$;
INSERT INTO app_security_backup.auth_ddl(kind, ddl)
SELECT 'policy', format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
  policyname, schemaname, tablename, permissive, cmd,
  (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ',') FROM unnest(roles) r),
  CASE WHEN qual IS NULL THEN '' ELSE ' USING (' || qual || ')' END,
  CASE WHEN with_check IS NULL THEN '' ELSE ' WITH CHECK (' || with_check || ')' END)
FROM pg_policies WHERE (schemaname = 'public' AND tablename IN
  ('movies','movie_nights','vetoes','swipe_sessions','swipes','votes'))
  OR (schemaname = 'realtime' AND tablename = 'messages');
INSERT INTO app_security_backup.auth_ddl(kind, ddl)
SELECT DISTINCT 'grant', format('GRANT %s ON TABLE %I.%I TO %s%s;',
  privilege_type, table_schema, table_name,
  CASE WHEN grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(grantee) END,
  CASE WHEN is_grantable = 'YES' THEN ' WITH GRANT OPTION' ELSE '' END)
FROM information_schema.table_privileges
WHERE grantee IN ('PUBLIC','anon','authenticated') AND
  ((table_schema = 'public' AND table_name IN ('movies','movie_nights','vetoes','swipe_sessions','swipes','votes'))
    OR (table_schema = 'realtime' AND table_name = 'messages'));
INSERT INTO app_security_backup.auth_ddl(kind, ddl)
SELECT DISTINCT 'grant', format('GRANT %s (%I) ON TABLE %I.%I TO %s%s;',
  privilege_type, column_name, table_schema, table_name,
  CASE WHEN grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(grantee) END,
  CASE WHEN is_grantable = 'YES' THEN ' WITH GRANT OPTION' ELSE '' END)
FROM information_schema.column_privileges
WHERE grantee IN ('PUBLIC','anon','authenticated') AND
  ((table_schema = 'public' AND table_name IN ('movies','movie_nights','vetoes','swipe_sessions','swipes','votes'))
    OR (table_schema = 'realtime' AND table_name = 'messages'));
-- Rimuovere TUTTE le policy precedenti: policy permissive si combinano con OR.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE
    (schemaname = 'public' AND tablename IN ('movies','movie_nights','vetoes','swipe_sessions','swipes','votes'))
    OR (schemaname = 'realtime' AND tablename = 'messages') LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
ALTER TABLE public.movies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movie_nights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vetoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipe_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.movies, public.movie_nights, public.vetoes,
  public.swipe_sessions, public.swipes, public.votes FROM PUBLIC, anon, authenticated;
-- Revoca anche grants a livello colonna, indipendenti dai grants di tabella.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT DISTINCT table_schema, table_name, column_name FROM information_schema.column_privileges
    WHERE grantee IN ('PUBLIC','anon','authenticated') AND table_schema = 'public'
      AND table_name IN ('movies','movie_nights','vetoes','swipe_sessions','swipes','votes') LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE %I.%I FROM PUBLIC, anon, authenticated', c.column_name, c.table_schema, c.table_name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.movies, public.movie_nights TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.vetoes TO authenticated;
GRANT SELECT, INSERT ON public.swipe_sessions, public.swipes TO authenticated;
GRANT UPDATE (status, matched_movie_id, matched_at) ON public.swipe_sessions TO authenticated;
CREATE POLICY members_read ON public.movies FOR SELECT TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_insert ON public.movies FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_update ON public.movies FOR UPDATE TO authenticated USING ((SELECT public.app_person()) IS NOT NULL) WITH CHECK ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_delete ON public.movies FOR DELETE TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_read ON public.movie_nights FOR SELECT TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_insert ON public.movie_nights FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_update ON public.movie_nights FOR UPDATE TO authenticated USING ((SELECT public.app_person()) IS NOT NULL) WITH CHECK ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_delete ON public.movie_nights FOR DELETE TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_read ON public.vetoes FOR SELECT TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY personal_insert ON public.vetoes FOR INSERT TO authenticated WITH CHECK (person = (SELECT public.app_person()));
CREATE POLICY personal_delete ON public.vetoes FOR DELETE TO authenticated USING (person = (SELECT public.app_person()));
CREATE POLICY members_read ON public.swipe_sessions FOR SELECT TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY personal_insert ON public.swipe_sessions FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT public.app_person()));
CREATE POLICY members_update ON public.swipe_sessions FOR UPDATE TO authenticated USING ((SELECT public.app_person()) IS NOT NULL) WITH CHECK ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY members_read ON public.swipes FOR SELECT TO authenticated USING ((SELECT public.app_person()) IS NOT NULL);
CREATE POLICY personal_insert ON public.swipes FOR INSERT TO authenticated WITH CHECK (person = (SELECT public.app_person()));
-- votes fisicamente conservato, senza grants/policy applicativi.
-- realtime.messages ha già RLS in Supabase: NON eseguire ALTER TABLE su questa tabella di sistema.
REVOKE ALL ON realtime.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON realtime.messages TO authenticated;
CREATE POLICY members_receive ON realtime.messages FOR SELECT TO authenticated USING (
  (SELECT public.app_person()) IS NOT NULL AND (SELECT realtime.topic()) IN ('scorochiatu-db-changes','scorochiatu-match')
);
CREATE POLICY members_presence ON realtime.messages FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.app_person()) IS NOT NULL AND (SELECT realtime.topic()) = 'scorochiatu-match' AND extension = 'presence'
);
COMMIT;
-- In Dashboard Realtime: disabilitare Allow public access al cutover.
-- Conservare la pubblicazione delle cinque tabelle attive; nessun DROP dati.
