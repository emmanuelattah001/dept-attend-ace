CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Helpful index for cleanup + sync scanning
CREATE INDEX IF NOT EXISTS attendance_synced_created_idx
  ON public.attendance (synced_to_sheets, created_at);