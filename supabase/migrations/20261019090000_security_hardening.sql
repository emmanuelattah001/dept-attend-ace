-- =====================================================================
-- Security hardening before production deployment
-- =====================================================================

-- 1) Allow the new 'device_reset' login event ------------------------------------------------
ALTER TABLE public.student_login_events DROP CONSTRAINT IF EXISTS student_login_events_event_check;
ALTER TABLE public.student_login_events
  ADD CONSTRAINT student_login_events_event_check
  CHECK (event IN ('success', 'blocked_already_used', 'reset', 'device_reset'));

-- 2) One-time-login lock is no longer enforced --------------------------------------------------
-- Students had to be reset by an admin after clearing browser data / changing phones. Account
-- sharing is now handled by random passwords + forced password change + face + device binding.
-- The function is kept (the app still calls it) and still records the first successful login.
CREATE OR REPLACE FUNCTION public.claim_student_login()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s_id uuid;
  s_dept uuid;
  s_matric text;
  first_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT id, department_id, matric_no, first_login_at
    INTO s_id, s_dept, s_matric, first_at
  FROM public.students
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF s_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'not_student', true);
  END IF;

  IF first_at IS NULL THEN
    UPDATE public.students SET first_login_at = now() WHERE id = s_id;
    INSERT INTO public.student_login_events (student_id, department_id, matric_no, event, actor_user_id)
    VALUES (s_id, s_dept, s_matric, 'success', auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', true, 'first_login_at', COALESCE(first_at, now()));
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_student_login() TO authenticated;

-- 3) profiles: users must not be able to move themselves to another department -------------------
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service role / SQL editor / auth triggers have no auth.uid()
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'super_admin') THEN RETURN NEW; END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id cannot be changed';
  END IF;
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    RAISE EXCEPTION 'department can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- 4) Face photos: private bucket, no direct student writes, department-scoped admin reads --------
INSERT INTO storage.buckets (id, name, public)
VALUES ('faces', 'faces', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Users manage own face folder" ON storage.objects;
DROP POLICY IF EXISTS "Admins read face photos" ON storage.objects;
DROP POLICY IF EXISTS "Students read own face" ON storage.objects;
DROP POLICY IF EXISTS "Admins read own department face photos" ON storage.objects;

-- Uploads happen ONLY through the verify-face edge function (service role) so the quality check can't be skipped.
CREATE POLICY "Students read own face"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'faces' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Admins read own department face photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'faces'
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (
        public.has_role(auth.uid(), 'dept_admin')
        AND EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.auth_user_id::text = (storage.foldername(name))[1]
            AND s.department_id = public.get_user_department(auth.uid())
        )
      )
    )
  );

-- 5) lecturer / course_rep / hod can actually do their job (department scoped) --------------------
CREATE OR REPLACE FUNCTION public.is_dept_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text IN ('lecturer', 'course_rep', 'hod')
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_dept_staff(uuid) TO authenticated;

DROP POLICY IF EXISTS "staff_manage_sessions" ON public.attendance_sessions;
CREATE POLICY "staff_manage_sessions" ON public.attendance_sessions
  FOR ALL TO authenticated
  USING (public.is_dept_staff(auth.uid()) AND department_id = public.get_user_department(auth.uid()))
  WITH CHECK (public.is_dept_staff(auth.uid()) AND department_id = public.get_user_department(auth.uid()));

DROP POLICY IF EXISTS "staff_view_dept_students" ON public.students;
CREATE POLICY "staff_view_dept_students" ON public.students
  FOR SELECT TO authenticated
  USING (public.is_dept_staff(auth.uid()) AND department_id = public.get_user_department(auth.uid()));

DROP POLICY IF EXISTS "staff_view_dept_attendance" ON public.attendance;
CREATE POLICY "staff_view_dept_attendance" ON public.attendance
  FOR SELECT TO authenticated
  USING (public.is_dept_staff(auth.uid()) AND department_id = public.get_user_department(auth.uid()));

DROP POLICY IF EXISTS "staff_insert_dept_attendance" ON public.attendance;
CREATE POLICY "staff_insert_dept_attendance" ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_dept_staff(auth.uid())
    AND department_id = public.get_user_department(auth.uid())
    AND marked_by = auth.uid()
  );

DROP POLICY IF EXISTS "staff_update_dept_attendance" ON public.attendance;
CREATE POLICY "staff_update_dept_attendance" ON public.attendance
  FOR UPDATE TO authenticated
  USING (public.is_dept_staff(auth.uid()) AND department_id = public.get_user_department(auth.uid()));
