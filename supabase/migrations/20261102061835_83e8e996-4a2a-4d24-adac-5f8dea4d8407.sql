-- Backfill user_roles from existing course_staff assignments
-- (assignments saved without the matching lecturer/course_rep role are unusable:
--  routing, has_course_staff_assignment and the QR session service all require the role)

INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT cs.user_id, cs.staff_role::public.app_role
FROM public.course_staff cs
JOIN public.courses c ON c.id = cs.course_id
JOIN public.profiles p ON p.user_id = cs.user_id
WHERE cs.staff_role IN ('lecturer', 'course_rep')
  AND c.department_id IS NOT NULL
  AND p.department_id = c.department_id
ON CONFLICT (user_id, role) DO NOTHING;

-- Keep legacy assignments aligned when their department_id is unset:
-- stamp the course's department onto the assignment row.
UPDATE public.course_staff cs
SET department_id = c.department_id
FROM public.courses c
WHERE c.id = cs.course_id
  AND c.department_id IS NOT NULL
  AND cs.department_id IS NULL;
