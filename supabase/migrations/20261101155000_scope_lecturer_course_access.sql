CREATE OR REPLACE FUNCTION public.has_course_staff_assignment(
  _user_id uuid,
  _course_id uuid,
  _staff_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.course_staff cs
    JOIN public.courses c ON c.id = cs.course_id
    WHERE cs.user_id = _user_id
      AND cs.course_id = _course_id
      AND cs.staff_role = _staff_role
      AND cs.department_id = public.get_user_department(_user_id)
      AND c.department_id = cs.department_id
  );
$$;
REVOKE ALL ON FUNCTION public.has_course_staff_assignment(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_course_staff_assignment(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_course_student_attendance(
  _user_id uuid,
  _student_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.attendance a
    WHERE a.student_ref = _student_id
      AND a.department_id = public.get_user_department(_user_id)
      AND (
        (
          public.has_role(_user_id, 'lecturer')
          AND public.has_course_staff_assignment(_user_id, a.course_id, 'lecturer')
        )
        OR (
          public.has_role(_user_id, 'course_rep')
          AND public.has_course_staff_assignment(_user_id, a.course_id, 'course_rep')
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.has_course_student_attendance(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_course_student_attendance(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Authenticated can view course staff" ON public.course_staff;
CREATE POLICY "Users view own course staff assignments"
  ON public.course_staff FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
    )
  );

DROP POLICY IF EXISTS "staff_manage_sessions" ON public.attendance_sessions;
CREATE POLICY "staff_manage_sessions" ON public.attendance_sessions
  FOR ALL TO authenticated
  USING (
    department_id = public.get_user_department(auth.uid())
    AND (
      public.has_role(auth.uid(), 'hod')
      OR (
        public.has_role(auth.uid(), 'lecturer')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
      )
      OR (
        public.has_role(auth.uid(), 'course_rep')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
      )
    )
  )
  WITH CHECK (
    department_id = public.get_user_department(auth.uid())
    AND (
      public.has_role(auth.uid(), 'hod')
      OR (
        public.has_role(auth.uid(), 'lecturer')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
      )
      OR (
        public.has_role(auth.uid(), 'course_rep')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
      )
    )
  );

DROP POLICY IF EXISTS "staff_view_dept_attendance" ON public.attendance;
CREATE POLICY "staff_view_dept_attendance" ON public.attendance
  FOR SELECT TO authenticated
  USING (
    department_id = public.get_user_department(auth.uid())
    AND (
      public.has_role(auth.uid(), 'hod')
      OR (
        public.has_role(auth.uid(), 'lecturer')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
      )
      OR (
        public.has_role(auth.uid(), 'course_rep')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
      )
    )
  );

DROP POLICY IF EXISTS "staff_view_dept_students" ON public.students;
CREATE POLICY "staff_view_dept_students" ON public.students
  FOR SELECT TO authenticated
  USING (
    department_id = public.get_user_department(auth.uid())
    AND (
      public.has_role(auth.uid(), 'hod')
      OR public.has_course_student_attendance(auth.uid(), students.id)
    )
  );

DROP POLICY IF EXISTS "staff_insert_dept_attendance" ON public.attendance;
CREATE POLICY "staff_insert_dept_attendance" ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    marked_by = auth.uid()
    AND department_id = public.get_user_department(auth.uid())
    AND (
      public.has_role(auth.uid(), 'hod')
      OR (
        public.has_role(auth.uid(), 'lecturer')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
      )
      OR (
        public.has_role(auth.uid(), 'course_rep')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
      )
    )
  );

DROP POLICY IF EXISTS "staff_update_dept_attendance" ON public.attendance;
CREATE POLICY "staff_update_dept_attendance" ON public.attendance
  FOR UPDATE TO authenticated
  USING (
    department_id = public.get_user_department(auth.uid())
    AND (
      public.has_role(auth.uid(), 'hod')
      OR (
        public.has_role(auth.uid(), 'lecturer')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
      )
      OR (
        public.has_role(auth.uid(), 'course_rep')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
      )
    )
  )
  WITH CHECK (
    marked_by = auth.uid()
    AND department_id = public.get_user_department(auth.uid())
    AND (
      public.has_role(auth.uid(), 'hod')
      OR (
        public.has_role(auth.uid(), 'lecturer')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
      )
      OR (
        public.has_role(auth.uid(), 'course_rep')
        AND public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
      )
    )
  );
