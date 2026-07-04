
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS first_login_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_student_login()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s_id uuid;
  first_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT id, first_login_at INTO s_id, first_at
  FROM public.students
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF s_id IS NULL THEN
    -- Not a student account (e.g. admin) — allow.
    RETURN jsonb_build_object('ok', true, 'not_student', true);
  END IF;

  IF first_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_used', 'first_login_at', first_at);
  END IF;

  UPDATE public.students SET first_login_at = now() WHERE id = s_id;
  RETURN jsonb_build_object('ok', true, 'first_login_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_student_login() TO authenticated;
