# Continue the institution hierarchy rollout

## What will be completed
- Add institution-scoped academic year/term setup, with access for platform administrators and institution administrators, and safe read-only visibility for faculty administrators.
- Add email invitations for institution and faculty administrators. Validate inviter authority and target scope before assigning access; never trust a role or institution supplied by the browser alone.
- Audit the existing institution-specific archive and attendance flows. Close any cross-institution access paths found without changing legacy department IDs or attendance records.
- Update the roadmap to reflect completed work and any remaining item blocked by external email configuration.

## Technical approach
- Inspect the live schema and policies for the affected tables and functions before changing them.
- Use an additive migration for academic periods and their grants/RLS; preserve existing records and avoid changing legacy attendance relationships.
- Use a server-validated invitation flow with Supabase Auth, scoped membership assignment, and clear failure handling if email delivery is unavailable.
- Add focused permission tests, run relevant existing tests, and verify the preview diagnostics after changes.
