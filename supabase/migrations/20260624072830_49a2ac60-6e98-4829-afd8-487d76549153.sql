-- Track sync status on attendance
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS synced_to_sheets boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_attendance_synced ON public.attendance(synced_to_sheets);

-- App-wide settings (key/value) to persist the auto-created spreadsheet id
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'dept_admin')
  );
