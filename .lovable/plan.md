

## Plan: Dept Admin Adds Students Without Email + Super Admin Views Per-Department Attendance

### Problem
Currently, adding a student requires an email (to create a Supabase auth user). The user wants dept admins to simply fill in student details (name, gender, matric_no) without needing email/auth. Super admin also needs to see attendance grouped by department.

### Approach

**Core change**: Students are just rows in the `profiles` table -- no auth account needed. Dept admins directly insert student profiles into their department. Attendance is marked against these profile records using the profile `id` (not `user_id`).

### 1. Database Migration

- Create a new `students` table (simpler than repurposing profiles which is tied to auth):
  ```sql
  CREATE TABLE public.students (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    gender text,
    matric_no text,
    department_id uuid NOT NULL REFERENCES departments(id),
    created_by uuid NOT NULL,
    created_at timestamptz DEFAULT now()
  );
  ```
- Add RLS: dept_admin can INSERT/UPDATE/SELECT students in their department; super_admin can SELECT all.
- Modify `attendance` table: add `student_ref` (uuid references students.id) column, keep existing columns working.
  - Actually, cleaner to make attendance reference `students.id` directly. But existing data uses `student_id` referencing profiles `user_id`.

**Simpler alternative**: Keep using `profiles` table but allow dept_admins to INSERT profiles without a real `user_id`. This is problematic because `user_id` is NOT NULL and references auth.

**Best approach**: New `students` table for dept-admin-managed students. Update attendance to reference `students.id`.

### 2. New `students` Table + Updated `attendance`

**Migration SQL:**
```sql
CREATE TABLE public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gender text,
  matric_no text,
  department_id uuid NOT NULL,
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

-- Update attendance to use students table
ALTER TABLE public.attendance 
  ADD COLUMN student_ref uuid REFERENCES public.students(id);
```

### 3. Update DeptAdminDashboard

- **Students tab**: Remove email field. Add students directly to `students` table (simple INSERT, no edge function needed). Fields: name, gender, matric_no.
- **CSV import**: Only require name column; gender and matric_no optional. Insert directly into `students` table (no edge function).
- **Mark Attendance tab**: Load students from `students` table. Save attendance using `student_ref` column.
- **Remove** the `create-student` edge function dependency for adding students.

### 4. Update SuperAdminDashboard

- **Attendance tab**: Group/filter by department. Show department selector, then show attendance records for that department with student names.

### 5. Update StudentDashboard

- Since students no longer have auth accounts, the student dashboard becomes irrelevant for these students. Keep it for auth-based students if any exist.

### 6. Files Modified

- New migration SQL
- `src/pages/DeptAdminDashboard.tsx` -- major rewrite: use `students` table, remove email, remove edge function calls
- `src/pages/SuperAdminDashboard.tsx` -- add department filter to attendance tab
- `src/integrations/supabase/types.ts` -- auto-updated after migration

### Summary

Dept admins add students by filling in name/gender/matric_no (no email). Attendance is marked against these student records. Super admin can view attendance filtered by department.

