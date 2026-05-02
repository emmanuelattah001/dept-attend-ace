
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email
  );
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_attendance_by_matric(_matric_no text)
RETURNS TABLE(attendance_date date, status text, department_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select
    a.date as attendance_date,
    a.status::text,
    d.name as department_name
  from public.attendance a
  join public.students s on s.id = a.student_ref
  join public.departments d on d.id = a.department_id
  where lower(trim(s.matric_no)) = lower(trim(_matric_no))
  order by a.date desc;
$function$;
