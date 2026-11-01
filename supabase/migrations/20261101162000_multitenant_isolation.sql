DO $$
DECLARE
  legacy_institution_id uuid;
  legacy_faculty_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.departments WHERE faculty_id IS NULL) THEN
    SELECT id INTO legacy_institution_id
    FROM public.institutions
    WHERE lower(trim(name)) = lower('Legacy Institution')
    LIMIT 1;

    IF legacy_institution_id IS NULL THEN
      INSERT INTO public.institutions (name)
      VALUES ('Legacy Institution')
      RETURNING id INTO legacy_institution_id;
    END IF;

    SELECT id INTO legacy_faculty_id
    FROM public.faculties
    WHERE institution_id = legacy_institution_id
      AND lower(trim(name)) = lower('Legacy Faculty')
    LIMIT 1;

    IF legacy_faculty_id IS NULL THEN
      INSERT INTO public.faculties (institution_id, name)
      VALUES (legacy_institution_id, 'Legacy Faculty')
      RETURNING id INTO legacy_faculty_id;
    END IF;

    UPDATE public.departments
    SET faculty_id = legacy_faculty_id
    WHERE faculty_id IS NULL;
  END IF;
END;
$$;

WITH course_departments AS (
  SELECT course_id, min(department_id::text)::uuid AS department_id
  FROM (
    SELECT course_id, department_id
    FROM public.attendance
    WHERE department_id IS NOT NULL
    UNION
    SELECT course_id, department_id
    FROM public.course_staff
    WHERE department_id IS NOT NULL
  ) used_departments
  GROUP BY course_id
  HAVING count(DISTINCT department_id) = 1
)
UPDATE public.courses c
SET department_id = cd.department_id
FROM course_departments cd
WHERE c.id = cd.course_id
  AND c.department_id IS NULL;

CREATE SCHEMA IF NOT EXISTS tenant_private;
REVOKE ALL ON SCHEMA tenant_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA tenant_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION tenant_private.department_in_user_tenant(
  _user_id uuid,
  _department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, tenant_private
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.departments d ON d.id = p.department_id
      JOIN public.faculties f ON f.id = d.faculty_id
      JOIN public.institutions i ON i.id = f.institution_id
      WHERE p.user_id = _user_id
        AND p.department_id = _department_id
        AND i.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.departments d
      JOIN public.faculties f ON f.id = d.faculty_id
      JOIN public.hierarchy_memberships m ON m.institution_id = f.institution_id
      JOIN public.institutions i ON i.id = f.institution_id
      WHERE d.id = _department_id
        AND m.user_id = _user_id
        AND m.role = 'institution_admin'
        AND i.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.departments d
      JOIN public.faculties f ON f.id = d.faculty_id
      JOIN public.hierarchy_memberships m ON m.institution_id = f.institution_id
      JOIN public.institutions i ON i.id = f.institution_id
      WHERE d.id = _department_id
        AND m.user_id = _user_id
        AND m.role = 'faculty_admin'
        AND m.faculty_id = f.id
        AND i.status = 'active'
    );
$$;
REVOKE ALL ON FUNCTION tenant_private.department_in_user_tenant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tenant_private.department_in_user_tenant(uuid, uuid) TO authenticated, service_role;

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
  SELECT _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.course_staff cs
      JOIN public.courses c ON c.id = cs.course_id
      WHERE cs.user_id = _user_id
        AND cs.course_id = _course_id
        AND cs.staff_role = _staff_role
        AND public.has_role(_user_id, _staff_role::public.app_role)
        AND cs.department_id = public.get_user_department(_user_id)
        AND c.department_id = cs.department_id
    );
$$;
REVOKE ALL ON FUNCTION public.has_course_staff_assignment(uuid, uuid, text) FROM PUBLIC, anon;
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
  SELECT _user_id = auth.uid()
    AND EXISTS (
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
REVOKE ALL ON FUNCTION public.has_course_student_attendance(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_course_student_attendance(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION tenant_private.user_in_institution(
  _user_id uuid,
  _institution_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, tenant_private
AS $$
  SELECT public.has_role(_user_id, 'super_admin')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.departments d ON d.id = p.department_id
      JOIN public.faculties f ON f.id = d.faculty_id
      JOIN public.institutions i ON i.id = f.institution_id
      WHERE p.user_id = _user_id
        AND f.institution_id = _institution_id
        AND i.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.hierarchy_memberships m
      JOIN public.institutions i ON i.id = m.institution_id
      WHERE m.user_id = _user_id
        AND m.institution_id = _institution_id
        AND i.status = 'active'
    );
$$;
REVOKE ALL ON FUNCTION tenant_private.user_in_institution(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tenant_private.user_in_institution(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION tenant_private.enforce_single_institution_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, tenant_private
AS $$
DECLARE
  profile_institution uuid;
BEGIN
  SELECT f.institution_id INTO profile_institution
  FROM public.profiles p
  JOIN public.departments d ON d.id = p.department_id
  JOIN public.faculties f ON f.id = d.faculty_id
  WHERE p.user_id = NEW.user_id;

  IF profile_institution IS NOT NULL AND profile_institution <> NEW.institution_id THEN
    RAISE EXCEPTION 'An account can only belong to one institution';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tenant_private.enforce_single_institution_membership() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_single_institution_membership
  BEFORE INSERT OR UPDATE OF user_id, institution_id ON public.hierarchy_memberships
  FOR EACH ROW EXECUTE FUNCTION tenant_private.enforce_single_institution_membership();

CREATE OR REPLACE FUNCTION tenant_private.prevent_profile_institution_mismatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, tenant_private
AS $$
DECLARE
  membership_institution uuid;
  profile_institution uuid;
BEGIN
  SELECT institution_id INTO membership_institution
  FROM public.hierarchy_memberships
  WHERE user_id = NEW.user_id;
  IF membership_institution IS NULL OR NEW.department_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT f.institution_id INTO profile_institution
  FROM public.departments d
  JOIN public.faculties f ON f.id = d.faculty_id
  WHERE d.id = NEW.department_id;
  IF profile_institution IS NOT NULL AND profile_institution <> membership_institution THEN
    RAISE EXCEPTION 'Profile department must belong to the account institution';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tenant_private.prevent_profile_institution_mismatch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER prevent_profile_institution_mismatch
  BEFORE INSERT OR UPDATE OF user_id, department_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION tenant_private.prevent_profile_institution_mismatch();

CREATE OR REPLACE FUNCTION tenant_private.prevent_department_institution_mismatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, tenant_private
AS $$
DECLARE
  target_institution uuid;
BEGIN
  IF NEW.faculty_id IS NULL THEN
    RAISE EXCEPTION 'Departments must remain linked to an institution faculty';
  END IF;

  SELECT institution_id INTO target_institution
  FROM public.faculties
  WHERE id = NEW.faculty_id;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.hierarchy_memberships m ON m.user_id = p.user_id
    WHERE p.department_id = NEW.id
      AND m.institution_id <> target_institution
  ) THEN
    RAISE EXCEPTION 'Moving this department would place an administrator account in multiple institutions';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tenant_private.prevent_department_institution_mismatch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER prevent_department_institution_mismatch
  BEFORE UPDATE OF faculty_id ON public.departments
  FOR EACH ROW WHEN (OLD.faculty_id IS DISTINCT FROM NEW.faculty_id)
  EXECUTE FUNCTION tenant_private.prevent_department_institution_mismatch();

CREATE OR REPLACE FUNCTION public.current_user_institution()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, tenant_private
AS $$
  SELECT f.institution_id
  FROM public.profiles p
  JOIN public.departments d ON d.id = p.department_id
  JOIN public.faculties f ON f.id = d.faculty_id
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_user_institution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_institution() TO authenticated;

CREATE TABLE public.institution_integrations (
  institution_id uuid PRIMARY KEY REFERENCES public.institutions(id) ON DELETE CASCADE,
  google_sheet_id text NOT NULL,
  configured_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_integrations_sheet_id_valid
    CHECK (google_sheet_id ~ '^[A-Za-z0-9_-]{20,}$')
);
ALTER TABLE public.institution_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_integrations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institution_integrations TO authenticated;
GRANT ALL ON public.institution_integrations TO service_role;
CREATE POLICY institution_integrations_scope
  ON public.institution_integrations FOR SELECT TO authenticated
  USING (tenant_private.user_in_institution(auth.uid(), institution_id));
CREATE POLICY institution_integrations_manage
  ON public.institution_integrations FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1
      FROM public.hierarchy_memberships m
      JOIN public.institutions i ON i.id = m.institution_id
      WHERE m.user_id = auth.uid()
        AND m.institution_id = institution_integrations.institution_id
        AND m.role = 'institution_admin'
        AND i.status = 'active'
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1
      FROM public.hierarchy_memberships m
      JOIN public.institutions i ON i.id = m.institution_id
      WHERE m.user_id = auth.uid()
        AND m.institution_id = institution_integrations.institution_id
        AND m.role = 'institution_admin'
        AND i.status = 'active'
    )
  );
CREATE TRIGGER institution_integrations_updated
  BEFORE UPDATE ON public.institution_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.list_attendance_institutions()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.name
  FROM public.institutions i
  WHERE i.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.departments d
      JOIN public.faculties f ON f.id = d.faculty_id
      WHERE f.institution_id = i.id
    )
  ORDER BY i.name;
$$;
REVOKE ALL ON FUNCTION public.list_attendance_institutions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_attendance_institutions() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_attendance_by_matric_institution(
  _matric_no text,
  _institution_id uuid
)
RETURNS TABLE (attendance_date date, status public.attendance_status, department_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.date, a.status, d.name
  FROM public.students s
  JOIN public.attendance a ON a.student_ref = s.id
  JOIN public.departments d ON d.id = a.department_id
  JOIN public.faculties f ON f.id = d.faculty_id
  JOIN public.institutions i ON i.id = f.institution_id
  WHERE lower(s.matric_no) = lower(trim(_matric_no))
    AND f.institution_id = _institution_id
    AND i.status = 'active'
  ORDER BY a.date DESC;
$$;
REVOKE ALL ON FUNCTION public.get_attendance_by_matric_institution(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_by_matric_institution(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_course_staff_assignment(
  _user_id uuid,
  _course_id uuid,
  _staff_role text,
  _assigned boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, tenant_private
AS $$
DECLARE
  caller_department uuid;
  target_department uuid;
  course_department uuid;
  staff_app_role public.app_role;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'dept_admin') THEN
    RAISE EXCEPTION 'Only department administrators can assign course staff';
  END IF;
  IF _staff_role NOT IN ('lecturer', 'course_rep') THEN
    RAISE EXCEPTION 'Unsupported course staff role';
  END IF;

  caller_department := public.get_user_department(auth.uid());
  SELECT department_id INTO target_department
  FROM public.profiles WHERE user_id = _user_id;
  SELECT department_id INTO course_department
  FROM public.courses WHERE id = _course_id;

  IF caller_department IS NULL
     OR target_department IS DISTINCT FROM caller_department
     OR course_department IS DISTINCT FROM caller_department THEN
    RAISE EXCEPTION 'User and course must belong to your department';
  END IF;

  staff_app_role := _staff_role::public.app_role;
  IF _assigned THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, staff_app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.course_staff (course_id, user_id, department_id, staff_role)
    VALUES (_course_id, _user_id, caller_department, _staff_role)
    ON CONFLICT (course_id, user_id, staff_role) DO NOTHING;
  ELSE
    DELETE FROM public.course_staff
    WHERE course_id = _course_id
      AND user_id = _user_id
      AND staff_role = _staff_role
      AND department_id = caller_department;

    IF NOT EXISTS (
      SELECT 1 FROM public.course_staff
      WHERE user_id = _user_id AND staff_role = _staff_role
    ) THEN
      DELETE FROM public.user_roles
      WHERE user_id = _user_id AND role = staff_app_role;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_course_staff_assignment(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_course_staff_assignment(uuid, uuid, text, boolean) TO authenticated;

CREATE POLICY departments_tenant_boundary
  ON public.departments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    faculty_id IS NOT NULL
    AND tenant_private.department_in_user_tenant(auth.uid(), id)
  );

CREATE POLICY profiles_tenant_boundary
  ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
      AND (
        public.has_role(auth.uid(), 'dept_admin')
        OR public.has_role(auth.uid(), 'hod')
        OR public.has_role(auth.uid(), 'lecturer')
        OR public.has_role(auth.uid(), 'course_rep')
      )
    )
  );

CREATE POLICY profiles_insert_tenant_boundary
  ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (user_id = auth.uid() AND department_id IS NULL)
  );

CREATE POLICY profiles_update_tenant_boundary
  ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      user_id = auth.uid()
      AND department_id IS NOT DISTINCT FROM public.get_user_department(auth.uid())
    )
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      user_id = auth.uid()
      AND department_id IS NOT DISTINCT FROM public.get_user_department(auth.uid())
    )
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  );

CREATE POLICY user_roles_tenant_boundary
  ON public.user_roles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY courses_tenant_boundary
  ON public.courses AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
      AND (
        public.has_role(auth.uid(), 'dept_admin')
        OR public.has_role(auth.uid(), 'hod')
        OR (
          public.has_role(auth.uid(), 'lecturer')
          AND public.has_course_staff_assignment(auth.uid(), id, 'lecturer')
        )
        OR (
          public.has_role(auth.uid(), 'course_rep')
          AND public.has_course_staff_assignment(auth.uid(), id, 'course_rep')
        )
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.auth_user_id = auth.uid()
            AND s.department_id = courses.department_id
        )
      )
    )
  );

CREATE POLICY courses_write_tenant_boundary
  ON public.courses AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  );
CREATE POLICY courses_update_tenant_boundary
  ON public.courses AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  );
CREATE POLICY courses_delete_tenant_boundary
  ON public.courses AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  );

CREATE POLICY students_tenant_boundary
  ON public.students AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
      AND (
        auth_user_id = auth.uid()
        OR public.has_role(auth.uid(), 'dept_admin')
        OR public.has_role(auth.uid(), 'hod')
        OR public.has_course_student_attendance(auth.uid(), id)
      )
    )
  );

CREATE POLICY students_insert_tenant_boundary
  ON public.students AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  );

CREATE POLICY students_update_tenant_boundary
  ON public.students AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  );

CREATE POLICY students_delete_tenant_boundary
  ON public.students AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    )
  );

CREATE POLICY attendance_tenant_boundary
  ON public.attendance AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
      AND (
        public.has_role(auth.uid(), 'dept_admin')
        OR public.has_role(auth.uid(), 'hod')
        OR public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
        OR public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.id = attendance.student_ref
            AND s.auth_user_id = auth.uid()
            AND s.department_id = attendance.department_id
        )
        OR attendance.student_id = auth.uid()
      )
    )
  );

CREATE POLICY attendance_insert_tenant_boundary
  ON public.attendance AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    department_id IS NOT NULL
    AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (
        marked_by = auth.uid()
        AND (
          (
            public.has_role(auth.uid(), 'dept_admin')
            AND department_id = public.get_user_department(auth.uid())
          )
          OR (
            public.has_role(auth.uid(), 'hod')
            AND department_id = public.get_user_department(auth.uid())
          )
          OR public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
          OR public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
        )
      )
    )
  );

CREATE POLICY attendance_update_tenant_boundary
  ON public.attendance AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    department_id IS NOT NULL
    AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (
        department_id = public.get_user_department(auth.uid())
        AND (
          public.has_role(auth.uid(), 'dept_admin')
          OR public.has_role(auth.uid(), 'hod')
        )
      )
      OR public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
      OR public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
    )
  )
  WITH CHECK (
    department_id IS NOT NULL
    AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (
        marked_by = auth.uid()
        AND (
          (
            department_id = public.get_user_department(auth.uid())
            AND (
              public.has_role(auth.uid(), 'dept_admin')
              OR public.has_role(auth.uid(), 'hod')
            )
          )
          OR public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
          OR public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
        )
      )
    )
  );

CREATE POLICY attendance_sessions_tenant_boundary
  ON public.attendance_sessions AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
      AND (
        (
          department_id = public.get_user_department(auth.uid())
          AND (
            public.has_role(auth.uid(), 'dept_admin')
            OR public.has_role(auth.uid(), 'hod')
          )
        )
        OR (
          created_by = auth.uid()
          AND (
            public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
            OR public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
          )
        )
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
      AND (
        (
          department_id = public.get_user_department(auth.uid())
          AND (
            public.has_role(auth.uid(), 'dept_admin')
            OR public.has_role(auth.uid(), 'hod')
          )
        )
        OR (
          created_by = auth.uid()
          AND (
            public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
            OR public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
          )
        )
      )
    )
  );

CREATE POLICY course_staff_tenant_boundary
  ON public.course_staff AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND department_id = public.get_user_department(auth.uid())
      AND public.has_role(auth.uid(), 'dept_admin')
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.course_staff FROM authenticated;

CREATE POLICY verification_events_tenant_boundary
  ON public.verification_events AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND tenant_private.department_in_user_tenant(auth.uid(), department_id)
      AND (
        EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.id = verification_events.student_id
            AND s.auth_user_id = auth.uid()
            AND s.department_id = verification_events.department_id
        )
        OR public.has_role(auth.uid(), 'dept_admin')
        OR public.has_role(auth.uid(), 'hod')
        OR (
          course_id IS NOT NULL
          AND (
            public.has_course_staff_assignment(auth.uid(), course_id, 'lecturer')
            OR public.has_course_staff_assignment(auth.uid(), course_id, 'course_rep')
          )
        )
      )
    )
  );

CREATE POLICY student_password_controls_tenant_boundary
  ON public.student_password_controls AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND EXISTS (
        SELECT 1
        FROM public.students s
        WHERE s.auth_user_id = student_password_controls.user_id
          AND s.department_id = public.get_user_department(auth.uid())
      )
    )
  );

CREATE POLICY student_login_events_tenant_boundary
  ON public.student_login_events AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      department_id IS NOT NULL
      AND department_id = public.get_user_department(auth.uid())
      AND (
        public.has_role(auth.uid(), 'dept_admin')
        OR public.has_role(auth.uid(), 'hod')
      )
    )
  );

CREATE OR REPLACE FUNCTION tenant_private.remove_course_staff_on_role_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, tenant_private
AS $$
BEGIN
  IF OLD.role::text IN ('lecturer', 'course_rep') THEN
    DELETE FROM public.course_staff
    WHERE user_id = OLD.user_id
      AND staff_role = OLD.role::text;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION tenant_private.remove_course_staff_on_role_delete() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER remove_course_staff_after_role_delete
  AFTER DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION tenant_private.remove_course_staff_on_role_delete();

REVOKE EXECUTE ON FUNCTION public.get_attendance_by_matric(text) FROM PUBLIC, anon, authenticated;
