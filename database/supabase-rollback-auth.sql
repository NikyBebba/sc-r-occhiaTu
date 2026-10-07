-- EMERGENZA: ripristina policy/grants e membership votes salvati al cutover.
-- Può RIAPRIRE il DB pubblico. Richiede consenso esplicito dell'operatore:
-- SET scorochiatu.allow_public_rollback = 'yes'; prima di eseguire questo file.
BEGIN;
DO $$ BEGIN
  IF current_setting('scorochiatu.allow_public_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Rollback pubblico non autorizzato';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_security_backup.auth_ddl) THEN
    RAISE EXCEPTION 'Backup del cutover assente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_security_backup.auth_publication WHERE publication_name = 'supabase_realtime') THEN
    RAISE EXCEPTION 'Backup della publication assente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables) THEN
    RAISE EXCEPTION 'supabase_realtime assente o FOR ALL TABLES: verificare prima del rollback';
  END IF;
END $$;
DO $$ DECLARE was_published boolean; is_published boolean; BEGIN
  SELECT votes_was_published INTO was_published FROM app_security_backup.auth_publication
    WHERE publication_name = 'supabase_realtime';
  SELECT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public' AND tablename = 'votes') INTO is_published;
  IF was_published AND NOT is_published THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.votes;
  ELSIF NOT was_published AND is_published THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.votes;
  END IF;
END $$;
DO $$ DECLARE p record; c record; BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE
    (schemaname = 'public' AND tablename IN ('movies','movie_nights','vetoes','swipe_sessions','swipes','votes'))
    OR (schemaname = 'realtime' AND tablename = 'messages') LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
  FOR c IN SELECT DISTINCT table_schema, table_name, column_name FROM information_schema.column_privileges
    WHERE grantee IN ('PUBLIC','anon','authenticated') AND
      ((table_schema = 'public' AND table_name IN ('movies','movie_nights','vetoes','swipe_sessions','swipes','votes')) OR
       (table_schema = 'realtime' AND table_name = 'messages')) LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE %I.%I FROM PUBLIC, anon, authenticated', c.column_name, c.table_schema, c.table_name);
  END LOOP;
END $$;
REVOKE ALL ON public.movies, public.movie_nights, public.vetoes,
  public.swipe_sessions, public.swipes, public.votes, realtime.messages FROM PUBLIC, anon, authenticated;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT ddl FROM app_security_backup.auth_ddl ORDER BY kind, ddl LOOP
    EXECUTE item.ddl;
  END LOOP;
END $$;
COMMIT;
-- Nessuna tabella/colonna/account rimossa. Il backup resta per audit.
-- Ripristinare separatamente l'impostazione Realtime Dashboard solo se necessario.
-- Preferire rollback a frontend Auth compatibile mantenendo RLS, invece di questo file.
