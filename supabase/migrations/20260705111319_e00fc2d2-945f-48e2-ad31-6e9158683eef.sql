
CREATE TABLE IF NOT EXISTS public.student_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  matric_no text,
  event text NOT NULL CHECK (event IN ('success','blocked_already_used','reset')),
  actor_user_id uuid,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.student_login_events TO authenticated;
GRANT ALL ON public.student_login_events TO service_role;

ALTER TABLE public.student_login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dept admins view own dept login events"
  ON public.student_login_events FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      public.has_role(auth.uid(), 'dept_admin')
      AND department_id = public.get_user_department(auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_login_events_dept_created
  ON public.student_login_events (department_id, created_at DESC);

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

  IF first_at IS NOT NULL THEN
    INSERT INTO public.student_login_events (student_id, department_id, matric_no, event, actor_user_id, detail)
    VALUES (s_id, s_dept, s_matric, 'blocked_already_used', auth.uid(),
            jsonb_build_object('first_login_at', first_at));
    RETURN jsonb_build_object('ok', false, 'reason', 'already_used', 'first_login_at', first_at);
  END IF;

  UPDATE public.students SET first_login_at = now() WHERE id = s_id;

  INSERT INTO public.student_login_events (student_id, department_id, matric_no, event, actor_user_id)
  VALUES (s_id, s_dept, s_matric, 'success', auth.uid());

  RETURN jsonb_build_object('ok', true, 'first_login_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_student_login() TO authenticated;
