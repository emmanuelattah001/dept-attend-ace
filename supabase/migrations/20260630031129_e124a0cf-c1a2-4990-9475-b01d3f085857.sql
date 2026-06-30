
-- 1) profiles_email_exposure
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Dept admins can view dept profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Dept admins can view dept profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'dept_admin')
    AND department_id IS NOT NULL
    AND department_id = public.get_user_department(auth.uid())
  );

-- 2) students_no_self_read_policy
DROP POLICY IF EXISTS "Students can view own student row" ON public.students;
CREATE POLICY "Students can view own student row"
  ON public.students FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- 3) attendance_no_student_read_policy
DROP POLICY IF EXISTS "Students can view own attendance" ON public.attendance;
CREATE POLICY "Students can view own attendance"
  ON public.attendance FOR SELECT TO authenticated
  USING (
    student_ref IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
  );

-- 4) attendance_sessions_token_exposure: remove student-readable policy; tokens only used by edge function (service role bypasses RLS)
DROP POLICY IF EXISTS "student_read_own_dept_sessions" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Students can read own dept sessions" ON public.attendance_sessions;

-- 5) definer_fn_probing + SUPA function executable: revoke broad EXECUTE; keep authenticated for RLS usage (functions already guard cross-user probing internally)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_department(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_attendance_by_matric(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_department(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_attendance_by_matric(text) TO authenticated, service_role;
