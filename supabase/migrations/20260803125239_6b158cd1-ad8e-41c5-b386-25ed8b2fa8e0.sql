-- 1. New roles
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lecturer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'course_rep';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hod';

-- 2. Course staff assignments
CREATE TABLE IF NOT EXISTS public.course_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  staff_role text NOT NULL CHECK (staff_role IN ('lecturer','course_rep')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id, staff_role)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_staff TO authenticated;
GRANT ALL ON public.course_staff TO service_role;

ALTER TABLE public.course_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view course staff"
  ON public.course_staff FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage course staff"
  ON public.course_staff FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (public.has_role(auth.uid(), 'dept_admin') AND department_id = public.get_user_department(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR (public.has_role(auth.uid(), 'dept_admin') AND department_id = public.get_user_department(auth.uid()))
  );

CREATE TRIGGER update_course_staff_updated_at
  BEFORE UPDATE ON public.course_staff
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Student verification identity
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS face_url text,
  ADD COLUMN IF NOT EXISTS face_enrolled_at timestamptz,
  ADD COLUMN IF NOT EXISTS device_fingerprint text;

-- 4. Attendance proof data
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS confidence_score integer,
  ADD COLUMN IF NOT EXISTS proofs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_via text NOT NULL DEFAULT 'manual';

-- 5. Session timing / rotating QR
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotating boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rotate_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS secret text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');

-- 6. Verification events
CREATE TABLE IF NOT EXISTS public.verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  outcome text NOT NULL,
  reason text,
  confidence_score integer,
  proofs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.verification_events TO authenticated;
GRANT ALL ON public.verification_events TO service_role;

ALTER TABLE public.verification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students view own verification events"
  ON public.verification_events FOR SELECT TO authenticated
  USING (student_id IN (SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid()));

CREATE POLICY "Admins view verification events in scope"
  ON public.verification_events FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (public.has_role(auth.uid(), 'dept_admin') AND department_id = public.get_user_department(auth.uid()))
  );

CREATE INDEX IF NOT EXISTS verification_events_dept_created_idx
  ON public.verification_events (department_id, created_at DESC);