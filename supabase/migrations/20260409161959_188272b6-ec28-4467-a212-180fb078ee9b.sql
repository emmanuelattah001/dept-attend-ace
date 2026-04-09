
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gender text,
  matric_no text,
  department_id uuid NOT NULL REFERENCES public.departments(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dept admins can manage students in their dept"
ON public.students FOR ALL TO authenticated
USING (has_role(auth.uid(), 'dept_admin'::app_role) AND department_id = get_user_department(auth.uid()))
WITH CHECK (has_role(auth.uid(), 'dept_admin'::app_role) AND department_id = get_user_department(auth.uid()));

CREATE POLICY "Super admins can view all students"
ON public.students FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role));

ALTER TABLE public.attendance 
  ADD COLUMN IF NOT EXISTS student_ref uuid REFERENCES public.students(id);
