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