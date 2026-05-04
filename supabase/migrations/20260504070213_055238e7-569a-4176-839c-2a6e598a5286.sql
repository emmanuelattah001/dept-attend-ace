-- Remove existing duplicates first to allow unique index
DELETE FROM public.attendance a USING public.attendance b
WHERE a.ctid < b.ctid
  AND a.student_ref IS NOT DISTINCT FROM b.student_ref
  AND a.course_id = b.course_id
  AND a.date = b.date;

-- Enforce uniqueness: one record per (student, course, date)
CREATE UNIQUE INDEX IF NOT EXISTS attendance_student_course_date_uidx
ON public.attendance (student_ref, course_id, date)
WHERE student_ref IS NOT NULL;