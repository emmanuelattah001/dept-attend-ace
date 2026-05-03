
-- Remove redundant constraints that conflict with the upsert onConflict target
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS unique_student_date;
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS unique_attendance_record;
-- Keep unique_student_course_date as the canonical one
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_student_id_date_key;

-- Dedupe duplicate GEN001 courses per department: keep the oldest, repoint attendance to it, delete the rest
WITH ranked AS (
  SELECT id, department_id,
         ROW_NUMBER() OVER (PARTITION BY department_id, code ORDER BY created_at NULLS LAST, id) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY department_id, code ORDER BY created_at NULLS LAST, id) AS keeper_id
  FROM public.courses
  WHERE code = 'GEN001'
),
to_delete AS (
  SELECT id, keeper_id FROM ranked WHERE rn > 1
)
UPDATE public.attendance a
SET course_id = td.keeper_id
FROM to_delete td
WHERE a.course_id = td.id;

DELETE FROM public.courses c
USING (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY department_id, code ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.courses WHERE code = 'GEN001'
  ) s WHERE rn > 1
) dup
WHERE c.id = dup.id;
