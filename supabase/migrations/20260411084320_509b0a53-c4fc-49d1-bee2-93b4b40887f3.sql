
CREATE OR REPLACE FUNCTION public.get_attendance_by_matric(_matric_no text)
RETURNS TABLE (
  attendance_date date,
  status text,
  department_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.date, a.status::text, d.name
  FROM attendance a
  JOIN students s ON s.id = a.student_ref
  JOIN departments d ON d.id = a.department_id
  WHERE s.matric_no = _matric_no
  ORDER BY a.date DESC;
$$;
