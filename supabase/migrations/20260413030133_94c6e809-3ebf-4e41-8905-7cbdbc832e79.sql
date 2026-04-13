-- Allow dept admins to delete attendance for their department
CREATE POLICY "Dept admins can delete attendance for their department"
ON public.attendance
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'dept_admin'::app_role) AND (department_id = get_user_department(auth.uid())));

-- Allow super admins to delete any attendance
CREATE POLICY "Super admins can delete all attendance"
ON public.attendance
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'super_admin'::app_role));