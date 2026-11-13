import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getCaller, makeAdminClient } from '../_shared/auth.ts';
import { mayInviteHierarchyAdmin } from '../_shared/hierarchy-authorization.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = makeAdminClient();
    const caller = await getCaller(req, admin);
    if (!caller.userId || caller.isService) return json({ error: 'Sign in with an administrator account first.' }, 401);

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const institutionId = typeof body?.institution_id === 'string' ? body.institution_id.trim() : '';
    const role = typeof body?.role === 'string' ? body.role : '';
    const facultyId = typeof body?.faculty_id === 'string' ? body.faculty_id.trim() : null;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Enter a valid email address.' }, 400);
    }
    if (!UUID_PATTERN.test(institutionId) || !['institution_admin', 'faculty_admin'].includes(role)) {
      return json({ error: 'Choose a valid institution and administrator role.' }, 400);
    }
    if ((role === 'faculty_admin' && (!facultyId || !UUID_PATTERN.test(facultyId))) ||
        (role === 'institution_admin' && facultyId)) {
      return json({ error: 'Choose the correct faculty scope for this administrator role.' }, 400);
    }

    const isPlatformAdmin = caller.roles.includes('super_admin');
    const canInvite = mayInviteHierarchyAdmin(caller, { role, institutionId });
    if (!canInvite) return json({ error: 'You do not have permission to invite this administrator role or scope.' }, 403);

    const [{ data: institution, error: institutionError }, { data: faculty, error: facultyError }] = await Promise.all([
      admin.from('institutions').select('id').eq('id', institutionId).eq('status', 'active').maybeSingle(),
      role === 'faculty_admin'
        ? admin.from('faculties').select('id').eq('id', facultyId).eq('institution_id', institutionId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (institutionError) throw institutionError;
    if (facultyError) throw facultyError;
    if (!institution) return json({ error: 'That institution is not active.' }, 404);
    if (role === 'faculty_admin' && !faculty) return json({ error: 'That faculty does not belong to the selected institution.' }, 400);

    const { data: callerMembership, error: callerMembershipError } = await admin
      .from('hierarchy_memberships')
      .select('role, institution_id')
      .eq('user_id', caller.userId)
      .maybeSingle();
    if (callerMembershipError) throw callerMembershipError;
    if (!isPlatformAdmin && (
      callerMembership?.role !== 'institution_admin' ||
      callerMembership.institution_id !== institutionId ||
      role !== 'faculty_admin'
    )) {
      return json({ error: 'Institution administrators may invite faculty administrators only within their institution.' }, 403);
    }

    for (let page = 1; page <= 50; page++) {
      const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (usersError) throw usersError;
      const existing = users.users.find((user) => user.email?.trim().toLowerCase() === email);
      if (existing) return json({ error: 'An account already uses this email. Ask a platform administrator to assign its access.' }, 409);
      if (users.users.length < 1000) break;
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteError) throw inviteError;
    const invitedUserId = invited.user?.id;
    if (!invitedUserId) throw new Error('The invitation service did not return the invited account.');

    const { error: assignmentError } = await admin.rpc('complete_hierarchy_invitation', {
      _user_id: invitedUserId,
      _institution_id: institutionId,
      _role: role,
      _faculty_id: facultyId,
    });
    if (assignmentError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(invitedUserId);
      if (cleanupError) console.error('Invite cleanup failed after assignment rejection:', cleanupError.message);
      throw new Error('The invitation could not be safely assigned. No access was granted; please try again or contact the platform administrator.');
    }

    return json({ ok: true, email, role, institution_id: institutionId, faculty_id: facultyId });
  } catch (error) {
    console.error('invite-hierarchy-admin error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unable to send administrator invitation.' }, 500);
  }
});