
-- ============ STUDENTS ============
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.students;
DROP POLICY IF EXISTS "Allow public read students" ON public.students;
-- keep: "Dept admins can manage students in their dept" (ALL)
-- keep: "Super admins can view all students" (SELECT)

-- ============ ATTENDANCE ============
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.attendance;

CREATE POLICY "Dept admins manage attendance in their dept"
ON public.attendance
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'dept_admin'::public.app_role)
  AND department_id = public.get_user_department(auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'dept_admin'::public.app_role)
  AND department_id = public.get_user_department(auth.uid())
  AND marked_by = auth.uid()
);

CREATE POLICY "Super admins view all attendance"
ON public.attendance
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- ============ COURSES ============
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.courses;
-- keep existing UPDATE/DELETE policies for dept_admin/super_admin

CREATE POLICY "Authenticated can view courses"
ON public.courses
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Dept admins create courses in their dept"
ON public.courses
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'dept_admin'::public.app_role)
    AND (department_id IS NULL OR department_id = public.get_user_department(auth.uid()))
  )
);

-- ============ PROFILES ============
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Dept admins view profiles in their dept"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'dept_admin'::public.app_role)
  AND department_id = public.get_user_department(auth.uid())
);

CREATE POLICY "Super admins view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));
