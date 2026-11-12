CREATE TABLE public.academic_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  parent_period_id uuid REFERENCES public.academic_periods(id) ON DELETE RESTRICT,
  period_type text NOT NULL,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_periods TO authenticated;
GRANT ALL ON public.academic_periods TO service_role;
ALTER TABLE public.academic_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY academic_periods_read_scoped ON public.academic_periods
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hierarchy_memberships m
      JOIN public.institutions i ON i.id = m.institution_id
      WHERE m.user_id = auth.uid()
        AND m.institution_id = academic_periods.institution_id
        AND m.role IN ('institution_admin', 'faculty_admin')
        AND i.status = 'active'
    )
  );
CREATE POLICY academic_periods_manage_scoped ON public.academic_periods
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hierarchy_memberships m
      JOIN public.institutions i ON i.id = m.institution_id
      WHERE m.user_id = auth.uid()
        AND m.institution_id = academic_periods.institution_id
        AND m.role = 'institution_admin'
        AND i.status = 'active'
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hierarchy_memberships m
      JOIN public.institutions i ON i.id = m.institution_id
      WHERE m.user_id = auth.uid()
        AND m.institution_id = academic_periods.institution_id
        AND m.role = 'institution_admin'
        AND i.status = 'active'
    )
  );
CREATE UNIQUE INDEX academic_periods_name_per_type_idx
  ON public.academic_periods (institution_id, period_type, lower(trim(name)));
CREATE INDEX academic_periods_parent_idx ON public.academic_periods (parent_period_id);
CREATE TRIGGER academic_periods_updated_at
  BEFORE UPDATE ON public.academic_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE FUNCTION public.validate_academic_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent public.academic_periods%ROWTYPE;
  institution_status text;
BEGIN
  IF length(trim(NEW.name)) = 0 OR length(NEW.name) > 120
     OR NEW.starts_on >= NEW.ends_on
     OR NEW.period_type NOT IN ('academic_year', 'semester', 'term')
     OR NEW.status NOT IN ('planned', 'active', 'completed') THEN
    RAISE EXCEPTION 'Enter a valid academic period, date range, and status';
  END IF;
  SELECT status INTO institution_status FROM public.institutions WHERE id = NEW.institution_id;
  IF institution_status IS NULL OR institution_status <> 'active' THEN
    RAISE EXCEPTION 'Academic periods can only be created for an active institution';
  END IF;
  IF NEW.period_type = 'academic_year' THEN
    IF NEW.parent_period_id IS NOT NULL THEN
      RAISE EXCEPTION 'An academic year cannot have a parent period';
    END IF;
  ELSE
    IF NEW.parent_period_id IS NULL THEN
      RAISE EXCEPTION 'A semester or term must belong to an academic year';
    END IF;
    SELECT * INTO parent FROM public.academic_periods WHERE id = NEW.parent_period_id;
    IF parent.id IS NULL OR parent.institution_id <> NEW.institution_id
       OR parent.period_type <> 'academic_year'
       OR NEW.starts_on < parent.starts_on OR NEW.ends_on > parent.ends_on THEN
      RAISE EXCEPTION 'A semester or term must fit within an academic year in the same institution';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_academic_period() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER academic_periods_validate
  BEFORE INSERT OR UPDATE ON public.academic_periods
  FOR EACH ROW EXECUTE FUNCTION public.validate_academic_period();
