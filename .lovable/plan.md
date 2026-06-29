## Goal

1. Students log in with **matric number + password** (default password = their matric number, can change later).
2. Dept admin can **show a QR** for a class session; students **scan it from their phone** to mark themselves present.

---

## Part 1 — Student login by matric number

Supabase Auth requires an email, so we map each matric to a synthetic email behind the scenes:

```
<matric_lower>@students.attendtrack.local
```

The user only ever sees/types their matric number.

### Database
- Add `auth_user_id uuid` (nullable, unique) to `students` linking to `auth.users`.
- Backfill nothing — accounts are provisioned on demand.

### Edge function `provision-student-auth` (dept_admin only)
- Input: `student_id` (or "all in my department").
- Uses service-role key to call `auth.admin.createUser({ email: synthetic, password: matric_no, email_confirm: true })`.
- Stores returned user id in `students.auth_user_id`.
- Also inserts a `user_roles` row with role `student` and a `profiles` row with `department_id` set.
- Idempotent: if `auth_user_id` already exists, skip.

### UI
- **AuthPage**: add a tab toggle "Admin / Student". Student tab takes `matricNo` + `password`, transforms matric → synthetic email, then calls `signInWithPassword`.
- **DeptAdminDashboard → Students tab**: "Create login accounts" button that calls the edge function for all students missing `auth_user_id`. Toast shows how many were provisioned. Per-row "Reset password to matric" action.

---

## Part 2 — QR scan-to-mark attendance

### Database — new table `attendance_sessions`
- `id`, `course_id`, `department_id`, `date`, `token` (random 24-char), `expires_at`, `created_by`, `created_at`.
- Unique index on `token`.
- RLS: dept admins manage their own dept's sessions; **authenticated students can `SELECT` a session by token** (needed for client validation) but only its non-sensitive fields via a security-definer RPC `validate_session_token(token)` returning `{ ok, course_name, expires_at }`.

### Edge function `mark-via-qr`
- Requires authenticated student JWT.
- Input: `token`.
- Looks up session → verifies not expired → finds `students` row by `auth_user_id` → upserts an `attendance` row `(student_ref, course_id, date) → status='present', marked_by=auth.uid()`.
- Returns success + course/date for the student's confirmation screen.

### Admin UI — DeptAdminDashboard
- New "Live Session" button beside Mark / History tabs.
- Opens dialog: pick course + date (defaults to today) + duration (5/15/30/60 min) → calls insert into `attendance_sessions` → renders QR (using `qrcode.react`) encoding URL: `https://<app>/scan?token=XYZ`.
- Big countdown timer + "Regenerate" + "End now" controls.

### Student UI — new page `/scan`
- If not signed in: redirect to `/login?next=/scan`.
- Reads `token` from query string.
- Calls `mark-via-qr` → shows green check + course name + date, or red error (expired / wrong dept / already marked).
- Manual fallback: paste a 6-digit short code (last 6 chars of token) for when camera isn't used.

### Student dashboard
- Add prominent "Scan QR to mark attendance" button → opens `/scan` with the device camera (using `html5-qrcode`).

---

## Technical section

- **Packages**: `qrcode.react` (admin) and `html5-qrcode` (student camera).
- **Routes**: add `/scan` to `App.tsx`.
- **Synthetic email domain**: `students.attendtrack.local` — never sent to real SMTP because `email_confirm: true` is set at provisioning time.
- **Security**:
  - `provision-student-auth` checks caller has `dept_admin` role and only provisions students in their own department.
  - `mark-via-qr` validates the session belongs to the same department as the student.
  - QR tokens are single-purpose, time-bound; reusable within their window so latecomers can still scan.
- **Migrations**: add `students.auth_user_id`, create `attendance_sessions` with GRANTs + RLS, add `validate_session_token` RPC.

---

## Out of scope (ask if needed)
- Geofencing / IP restriction on scan.
- One-time-use tokens per student.
- Bulk CSV import of pre-set student passwords.

Approve and I'll build it end-to-end.