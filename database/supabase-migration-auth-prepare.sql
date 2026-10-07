-- PREPARAZIONE SOLO: non chiude ancora l'accesso pubblico esistente.
-- Eseguire in Dashboard solo dopo backup/inventario; nessun account inventato.
BEGIN;
CREATE TABLE IF NOT EXISTS public.app_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  person text NOT NULL UNIQUE CHECK (person IN ('N', 'V'))
);
ALTER TABLE public.app_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_members TO authenticated;
DROP POLICY IF EXISTS app_members_self ON public.app_members;
CREATE POLICY app_members_self ON public.app_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
-- SECURITY INVOKER: segue la RLS self del mapping, senza bypass o ricorsione.
CREATE OR REPLACE FUNCTION public.app_person() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT person FROM public.app_members WHERE user_id = (SELECT auth.uid())
$$;
REVOKE ALL ON FUNCTION public.app_person() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_person() TO authenticated;
COMMIT;
-- Dopo questo file, creare gli account Auth e inserire le due associazioni
-- con gli UUID REALI tramite Dashboard. Nessun INSERT di esempio è eseguibile.
