# AIPS Upgrade — Multi-Factor Verification, Roles & Rebrand

Upgrade AttendTrack toward the AIPS blueprint in three tracks: multi-factor attendance verification (including a camera face check), an expanded role/module structure, and a rebrand to Achievers University AIPS.

## 1. Rebrand to AIPS

- App name becomes "AIPS — Achievers University Intelligent Attendance & Presence Verification System" (short name: AIPS).
- Update page title, meta description, Open Graph tags, landing page hero/copy, dashboard header, auth page and PDF export watermark.
- Keep the current visual style; only names and copy change.

## 2. Multi-factor verification

Each attendance mark collects up to five proofs and produces a **confidence score** (0-100), shown to the student and stored on the record.

| Proof | Weight | How it is captured |
| --- | --- | --- |
| Dynamic QR (session token) | 30 | Token rotates every 30 seconds; old tokens rejected |
| Face match | 30 | Selfie captured on the scan screen, compared to the student's enrolled photo |
| Location (GPS geofence) | 20 | Already implemented; kept as-is |
| Registered device | 10 | Device fingerprint bound to the student on first successful mark |
| Time window | 10 | Mark must fall inside the session's start/end window |

Rules:
- A mark is accepted when the score reaches a department-configurable threshold (default 70) and the QR + location proofs both pass.
- Failed or suspicious attempts are logged with the reason, so admins can see near-misses and repeated device mismatches.
- If a student has no enrolled face photo yet, the face proof is skipped and the threshold drops accordingly — enrolment is prompted on their dashboard.

### Face enrolment and check
- Students enrol one reference photo (camera capture) from their dashboard; admins can view, replace or clear it.
- At scan time the phone camera captures a selfie plus a simple liveness prompt (blink / turn head), then the backend compares the selfie against the enrolled photo and returns a match score.
- Photos are stored in a private storage bucket; only the student and their department admins can read them.

### Dynamic QR
- The admin QR dialog regenerates its token on a short interval with a visible countdown, so a screenshot of the code stops working almost immediately.
- Sessions gain explicit start/end times; ending a session still marks remaining students absent.

## 3. Roles & modules

- Add `lecturer`, `course_rep`, and `hod` to the existing role system (super_admin, dept_admin, student stay).
- Course assignment: each course can have a lecturer and one or more course reps.
- Access rules:
  - **Lecturer** — create/end sessions and mark attendance for their own assigned courses only; export their course reports.
  - **Course rep** — create a session and view attendance for their assigned course; cannot edit past records.
  - **HOD** — read-only view of every course, student and report in their department, plus department analytics.
  - **Dept admin / super admin** — unchanged, full scope as today.
- Dashboard routing sends each role to the right view; the dept admin dashboard gains a "Staff & Reps" section for assigning lecturers and reps to courses.

## Technical notes

- Migration: extend `app_role` enum; add `course_staff` table (course_id, user_id, role); add `face_url`, `device_fingerprint` to `students`; add `confidence_score`, `proofs` (jsonb), `verified_via` to `attendance`; add `starts_at`, `ends_at`, `rotating` to `attendance_sessions`; add `verification_events` table for failed/near-miss attempts; add `min_confidence` to `app_settings`. Every new public table gets explicit GRANTs plus RLS policies scoped by department and role.
- Private Supabase Storage bucket `faces` with RLS-backed access.
- New edge function `verify-face` (compares selfie to enrolled photo via the Lovable AI Gateway vision model) and `enroll-face`; `mark-via-qr` is extended to gather proofs, call the face check, compute the score and write the record.
- Frontend: `ScanPage` gains a selfie step and a proof/score summary; new `FaceEnrollment` component on the student dashboard; QR dialog in `DeptAdminDashboard` gains rotation and countdown; new lecturer/course-rep/HOD dashboard views reusing the existing mark and history components.
- Google Sheets sync gains `confidence_score` and `verified_via` columns on the Attendance tab.

## Out of scope for now

Wi-Fi/BLE beacon proofs, dedicated fingerprint hardware, door cameras, subscription plans and billing. The proof structure is built so these can be added later as additional weighted proofs.
