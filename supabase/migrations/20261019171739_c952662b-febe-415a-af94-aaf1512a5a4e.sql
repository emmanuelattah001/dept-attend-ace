CREATE SCHEMA IF NOT EXISTS hierarchy_private;
REVOKE ALL ON SCHEMA hierarchy_private FROM PUBLIC;
GRANT USAGE ON SCHEMA hierarchy_private TO anon,authenticated,service_role;
ALTER FUNCTION public.can_access_hierarchy(uuid,uuid,boolean) SET SCHEMA hierarchy_private;
ALTER FUNCTION public.can_access_department_hierarchy(uuid,boolean) SET SCHEMA hierarchy_private;
CREATE OR REPLACE FUNCTION hierarchy_private.can_access_department_hierarchy(_department uuid, _manage boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.departments d JOIN public.faculties f ON f.id=d.faculty_id WHERE d.id=_department AND hierarchy_private.can_access_hierarchy(f.institution_id,f.id,_manage)) $$;
GRANT EXECUTE ON FUNCTION hierarchy_private.can_access_hierarchy(uuid,uuid,boolean) TO anon;
DROP POLICY departments_institution_manage ON public.departments;
CREATE POLICY departments_institution_manage ON public.departments FOR ALL TO authenticated USING(hierarchy_private.can_access_department_hierarchy(id,true)) WITH CHECK(EXISTS(SELECT 1 FROM public.faculties f WHERE f.id=faculty_id AND hierarchy_private.can_access_hierarchy(f.institution_id,f.id,true)));