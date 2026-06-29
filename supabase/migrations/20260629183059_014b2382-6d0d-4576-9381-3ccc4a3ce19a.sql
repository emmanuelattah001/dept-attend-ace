-- Part 1: link students to auth users
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_auth_user ON public.students(auth_user_id);

-- Part 2: attendance sessions table for QR
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_sessions TO authenticated;
GRANT ALL ON public.attendance_sessions TO service_role;

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

-- Dept admins manage their own dept sessions
CREATE POLICY "dept_admin_manage_sessions" ON public.attendance_sessions
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (public.has_role(auth.uid(), 'dept_admin') AND department_id = public.get_user_department(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (public.has_role(auth.uid(), 'dept_admin') AND department_id = public.get_user_department(auth.uid()))
  );

-- Students can read sessions in their dept (so client can show course name etc.)
CREATE POLICY "student_read_own_dept_sessions" ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (department_id = public.get_user_department(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_token ON public.attendance_sessions(token);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_dept_date ON public.attendance_sessions(department_id, date);
