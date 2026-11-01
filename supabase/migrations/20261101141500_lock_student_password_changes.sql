CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.student_password_controls (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  must_change_password boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.student_password_controls ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.student_password_controls TO authenticated;
GRANT ALL ON public.student_password_controls TO service_role;

CREATE POLICY student_password_controls_read_own
  ON public.student_password_controls
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

INSERT INTO public.student_password_controls (user_id, must_change_password)
SELECT
  s.auth_user_id,
  COALESCE(u.raw_user_meta_data->'must_change_password' = 'true'::jsonb, false)
FROM public.students AS s
JOIN auth.users AS u ON u.id = s.auth_user_id
WHERE s.auth_user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

UPDATE auth.users AS u
SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb) - 'must_change_password'
WHERE EXISTS (
  SELECT 1
  FROM public.students AS s
  WHERE s.auth_user_id = u.id
);

CREATE OR REPLACE FUNCTION public.is_student_auth_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students
    WHERE auth_user_id = _user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_student_auth_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.is_student_auth_user(uuid)
  TO supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.prevent_student_password_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
    AND current_user <> 'postgres'
    AND public.is_student_auth_user(OLD.id)
  THEN
    RAISE EXCEPTION 'Student passwords can only be changed during first-time setup or by an administrator'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_student_password_change()
  FROM PUBLIC, anon, authenticated, service_role;

-- GoTrue uses supabase_auth_admin; password updates from application RPCs run as postgres.
DROP TRIGGER IF EXISTS prevent_student_password_change ON auth.users;
CREATE TRIGGER prevent_student_password_change
  BEFORE UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_student_password_change();

CREATE OR REPLACE FUNCTION public.student_change_initial_password(_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $$
DECLARE
  _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;

  IF _password IS NULL OR char_length(_password) < 8 OR octet_length(_password) > 72 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters and no more than 72 bytes'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.student_password_controls
  WHERE user_id = _user_id
    AND must_change_password
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No initial password change is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_student_auth_user(_user_id) THEN
    RAISE EXCEPTION 'Student account not found' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf', 10)),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) - 'must_change_password',
      updated_at = now()
  WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authentication account not found';
  END IF;

  UPDATE public.student_password_controls
  SET must_change_password = false,
      updated_at = now()
  WHERE user_id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.student_change_initial_password(text)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.student_change_initial_password(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reset_student_password(
  _student_id uuid,
  _actor_user_id uuid,
  _password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $$
DECLARE
  _student_user_id uuid;
  _student_department_id uuid;
  _admin_department_id uuid;
BEGIN
  IF _password IS NULL OR char_length(_password) < 8 OR octet_length(_password) > 72 THEN
    RAISE EXCEPTION 'Invalid temporary password' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_role(_actor_user_id, 'dept_admin'::public.app_role)
    AND NOT public.has_role(_actor_user_id, 'super_admin'::public.app_role)
  THEN
    RAISE EXCEPTION 'Only department administrators can reset student passwords'
      USING ERRCODE = '42501';
  END IF;

  SELECT auth_user_id, department_id
  INTO _student_user_id, _student_department_id
  FROM public.students
  WHERE id = _student_id;
  IF _student_user_id IS NULL THEN
    RAISE EXCEPTION 'Student account is not linked to authentication';
  END IF;

  IF NOT public.has_role(_actor_user_id, 'super_admin'::public.app_role) THEN
    SELECT department_id
    INTO _admin_department_id
    FROM public.profiles
    WHERE user_id = _actor_user_id;

    IF _admin_department_id IS NULL
      OR _admin_department_id IS DISTINCT FROM _student_department_id
    THEN
      RAISE EXCEPTION 'Student is outside the administrator department'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf', 10)),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) - 'must_change_password',
      updated_at = now()
  WHERE id = _student_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authentication account not found';
  END IF;

  INSERT INTO public.student_password_controls (user_id, must_change_password)
  VALUES (_student_user_id, true)
  ON CONFLICT (user_id) DO UPDATE
  SET must_change_password = true,
      updated_at = now();
END;
$$;

ALTER FUNCTION public.student_change_initial_password(text) OWNER TO postgres;
ALTER FUNCTION public.admin_reset_student_password(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.is_student_auth_user(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_reset_student_password(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_reset_student_password(uuid, uuid, text)
  TO service_role;
