# AttendTrack → Google Sheets as Source of Truth

## 1. Google Sheets structure

The `sheets-sync` edge function will ensure two tabs exist in the configured spreadsheet (`GOOGLE_SHEET_ID`):

**Tab: `Attendance`** — append-only log. Columns:
`attendance_id, student_name, matric_no, gender, department, course_code, course_name, attendance_date, status, synced_at`

**Tab: `Student Progress`** — one row per `(matric_no, course_code)`. Columns:
`Student Name, Matric No, Department, Course, Total Present, Total Absent, Total Classes, Attendance Percentage, Last Attendance Date, Last Status`

Percentage = `(Total Present / Total Classes) * 100`, computed inside the sync function before writing (no formulas, no frontend math).

Deduplication: each new sync reads existing `attendance_id`s from the sheet and skips any already present, so an `attendance_id` never appears twice.

## 2. Sync flow

Rewrite `supabase/functions/sheets-sync/index.ts`:

- On every save (manual, QR, CSV import) the frontend fires `sheets-sync` in the background (already the pattern today).
- Function pulls unsynced rows in pages of 1000, joins `students`, `courses`, `departments`, `profiles`.
- Batch-appends to `Attendance` (chunks of 500 rows).
- Rebuilds affected `Student Progress` rows by aggregating over all sheet rows for the touched `(matric_no, course_code)` pairs and writing them back with `values.batchUpdate`.
- Marks rows `synced_to_sheets=true, synced_at=now()`. On failure it leaves the flag `false` so the next run retries. Logs counts and errors via `console.log`.

Actions supported: `append` (targeted ids), `sync_unsynced` (default, used by cron + background pushes), `export_all` (rebuild both tabs from scratch), `lookup_by_matric` (unchanged, public).

## 3. New edge function: `get-student-progress`

`supabase/functions/get-student-progress/index.ts`:

- Reads the `Student Progress` tab once, caches for 60s in memory.
- Query params: `matric_no?`, `course_code?`, `department?`.
- Returns `{ rows: [...], summary: { totalStudents, totalClasses, totalRecords, deptPercentage, above75, below75, consecutiveAbsences } }`.
- `consecutiveAbsences` is computed by re-reading the `Attendance` tab and detecting ≥3 consecutive `absent` rows per student per course.

## 4. Frontend changes

- `StudentDashboard.tsx`, `CheckAttendance.tsx`: stop computing `%` from merged DB rows. Call `get-student-progress` with the student's matric and display `Attendance Percentage`, `Total Present`, `Total Absent`, `Total Classes` directly.
- `DeptAdminDashboard.tsx` & `SuperAdminDashboard.tsx`: add a "Dashboard Summary" card block driven by `get-student-progress` summary (Total Students, Classes Held, Records, Dept %, >75%, <75%, Consecutive Absences).
- Keep QR, manual grid, CSV import, PDF export, Excel export, sheets sync buttons, student login, department & course filters intact.

## 5. Automatic 24h cleanup

Enable `pg_cron` + `pg_net`, then schedule a job (via `supabase--insert`, not migration, since it embeds the anon key) that every hour calls a new edge function `cleanup-attendance`:

- `cleanup-attendance` deletes `attendance` rows where `synced_to_sheets = true AND created_at < now() - interval '24 hours'`.
- Rows that never synced are kept so they aren't lost.
- Nothing in Google Sheets is touched.

Cron entry:
```sql
select cron.schedule('attendance-24h-cleanup','0 * * * *', $$
  select net.http_post(
    url:='https://wlevpfiijyweeshymyly.supabase.co/functions/v1/cleanup-attendance',
    headers:='{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb,
    body:='{}'::jsonb) as request_id;
$$);
```

## 6. Performance

- Paginated Supabase reads (1000/page).
- Sheets writes batched (500 rows/append, single `values.batchUpdate` for progress).
- Dedup via in-memory `Set` of existing `attendance_id`s per run.
- Background invocation from the UI so saves stay instant.
- Progress rows keyed by `matric_no|course_code` so 5k students × many courses stays linear.

## Technical notes

- New file: `supabase/functions/get-student-progress/index.ts`.
- New file: `supabase/functions/cleanup-attendance/index.ts`.
- Rewrite: `supabase/functions/sheets-sync/index.ts` (two-tab logic, new columns, dedup, progress recompute).
- Migration: enable `pg_cron`, `pg_net`; no schema changes to `attendance` (existing `synced_to_sheets`, `synced_at`, `created_at` are enough).
- `supabase--insert` call to register the cron job with the project's anon key.
- Frontend edits: `StudentDashboard.tsx`, `CheckAttendance.tsx`, `DeptAdminDashboard.tsx`, `SuperAdminDashboard.tsx`.

## Out of scope / confirm before I build

- I will keep `student_id` still resolvable in the sheet as `matric_no` (already the convention). Say the word if you want a separate numeric ID column.
- `gender` is not currently stored on `students`. I'll add a nullable `gender` column via migration so the sheet column can be populated; existing rows will show blank until you fill them in.
