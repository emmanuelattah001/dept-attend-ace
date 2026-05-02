
-- Fix courses policies: scope to authenticated, enforce dept scoping on update/delete, prevent NULL department insert by dept_admin

DROP POLICY IF EXISTS "Department admins can update courses" ON public.courses;
DROP POLICY IF EXISTS "Department admins can delete courses" ON public.courses;
DROP POLICY IF EXISTS "Dept admins create courses in their dept" ON public.courses;

CREATE POLICY "Admins can update courses in scope"
ON public.courses FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'dept_admin'::public.app_role)
    AND department_id IS NOT NULL
    AND department_id = public.get_user_department(auth.uid())
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'dept_admin'::public.app_role)
    AND department_id IS NOT NULL
    AND department_id = public.get_user_department(auth.uid())
  )
);

CREATE POLICY "Admins can delete courses in scope"
ON public.courses FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'dept_admin'::public.app_role)
    AND department_id IS NOT NULL
    AND department_id = public.get_user_department(auth.uid())
  )
);

CREATE POLICY "Admins create courses in scope"
ON public.courses FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'dept_admin'::public.app_role)
    AND department_id IS NOT NULL
    AND department_id = public.get_user_department(auth.uid())
  )
);

-- Fix mutable search_path on event-trigger function
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- Restrict SECURITY DEFINER probing functions: revoke broad EXECUTE; keep usable inside RLS via function owner
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_department(uuid) FROM PUBLIC, anon, authenticated;
