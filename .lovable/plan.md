

## Plan: Add Student Details & Simplify Attendance

### What changes

1. **Database migration** -- Add `gender` and `matric_no` columns to the `profiles` table. Also add an RLS policy allowing dept_admin to update profiles in their department.

2. **Update DeptAdminDashboard** -- Add a third tab "Students" where dept admins can view/edit each student's name, gender, and matric number. Simplify attendance status to only "present" or "absent" (remove "late").

3. **Update StudentDashboard** -- Remove "late" status references, show only present/absent stats.

4. **Update attendance enum** -- Keep the DB enum as-is (to avoid complex migration), but only use "present" and "absent" in the UI.

### Technical details

**Migration SQL:**
```sql
ALTER TABLE public.profiles ADD COLUMN gender text;
ALTER TABLE public.profiles ADD COLUMN matric_no text;

CREATE POLICY "Dept admins can update profiles in their department"
ON public.profiles FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'dept_admin'::app_role) 
  AND department_id = get_user_department(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'dept_admin'::app_role) 
  AND department_id = get_user_department(auth.uid())
);
```

**DeptAdminDashboard changes:**
- Add "Students" tab with editable fields: name, gender (select: Male/Female), matric_no (text input)
- Save button per student or bulk save
- Attendance tab: toggle between Present/Absent only (remove Late)

**StudentDashboard changes:**
- Remove late count/icon, show only present and absent stats

### Files modified
- New migration SQL file
- `src/pages/DeptAdminDashboard.tsx` -- major rewrite
- `src/pages/StudentDashboard.tsx` -- minor cleanup
- `src/integrations/supabase/types.ts` -- auto-updated after migration

