CREATE OR REPLACE FUNCTION public.complete_hierarchy_invitation(
  _user_id uuid,
  _institution_id uuid,
  _role text,
  _faculty_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the trusted invitation service can complete administrator invitations'
      USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL OR _institution_id IS NULL
     OR _role NOT IN ('institution_admin', 'faculty_admin') THEN
    RAISE EXCEPTION 'Invalid administrator invitation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.institutions i
    WHERE i.id = _institution_id AND i.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Institution is not active';
  END IF;
  IF (_role = 'institution_admin' AND _faculty_id IS NOT NULL)
     OR (_role = 'faculty_admin' AND _faculty_id IS NULL) THEN
    RAISE EXCEPTION 'Administrator role and scope do not match';
  END IF;
  IF _faculty_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.faculties f
    WHERE f.id = _faculty_id AND f.institution_id = _institution_id
  ) THEN
    RAISE EXCEPTION 'Faculty does not belong to the selected institution';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id) THEN
    RAISE EXCEPTION 'Invited account was not created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hierarchy_memberships m WHERE m.user_id = _user_id) THEN
    RAISE EXCEPTION 'This account already has a hierarchy assignment';
  END IF;
  INSERT INTO public.hierarchy_memberships (user_id, role, institution_id, faculty_id)
  VALUES (_user_id, _role, _institution_id, _faculty_id);
  DELETE FROM public.user_roles
  WHERE user_id = _user_id AND role = 'student'::public.app_role;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_hierarchy_invitation(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_hierarchy_invitation(uuid, uuid, text, uuid) TO service_role;
