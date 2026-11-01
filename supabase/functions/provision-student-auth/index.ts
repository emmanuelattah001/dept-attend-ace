
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYNTHETIC_DOMAIN = 'students.attendtrack.app';

function randomPassword(len = 10): string {
  // unambiguous alphabet (no 0/O/1/l/I)
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function findUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data?.users?.find((u: any) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (!data?.users || data.users.length < 200) return null;
  }
  return null;
}

function matricToEmail(matric: string) {
  const clean = matric.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${clean}@${SYNTHETIC_DOMAIN}`;
}

async function resetStudentPassword(
  admin: any,
  studentId: string,
  actorUserId: string,
  password: string,
) {
  const { error } = await admin.rpc('admin_reset_student_password', {
    _student_id: studentId,
    _actor_user_id: actorUserId,
    _password: password,
  });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, service);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return new Response(JSON.stringify({ error: 'Auth invalid' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Check caller role — staff hosting/managing a department may provision logins
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', user.id);
    const isAdmin = roles?.some((r: any) =>
      ['dept_admin', 'super_admin', 'lecturer', 'course_rep'].includes(r.role),
    );
    const canResetCredentials = roles?.some((r: any) =>
      ['dept_admin', 'super_admin'].includes(r.role),
    );
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: callerProfile } = await admin.from('profiles').select('department_id').eq('user_id', user.id).maybeSingle();
    const isSuper = roles?.some((r: any) => r.role === 'super_admin');
    const callerDept = callerProfile?.department_id;
    if (!isSuper && !callerDept) {
      return new Response(JSON.stringify({ error: 'Your account is not linked to a department. Ask an admin to set your department first.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const { student_id, action = 'provision' } = body as { student_id?: string; action?: string };
    if (
      ['reset_login', 'reset_password'].includes(action) &&
      !canResetCredentials
    ) {
      return new Response(JSON.stringify({ error: 'Only department administrators can reset student credentials' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build student query
    let query = admin.from('students').select('id, name, matric_no, department_id, auth_user_id');
    if (student_id) query = query.eq('id', student_id);
    else if (!isSuper) query = query.eq('department_id', callerDept);

    const { data: studentList, error: stuErr } = await query;
    if (stuErr) throw stuErr;

    const results: any[] = [];

    for (const s of studentList ?? []) {
      if (!s.matric_no) { results.push({ id: s.id, name: s.name, skipped: 'no matric_no' }); continue; }
      if (!isSuper && s.department_id !== callerDept) { results.push({ id: s.id, skipped: 'other dept' }); continue; }

      const email = matricToEmail(s.matric_no);
      const password = randomPassword();

      let authUserId = s.auth_user_id as string | null;

      if (action === 'reset_login' || action === 'reset_device') {
        // Clears the login lock, device binding and (for a full reset) the enrolled face.
        // A FULL reset (new password + face + device) only happens for a single named student.
        // The bulk variant (no student_id) only clears the login lock, so a whole class is never wiped by accident.
        const full = action === 'reset_login' && !!student_id;
        const patch: Record<string, unknown> = { first_login_at: null };
        if (action === 'reset_device' || full) patch.device_fingerprint = null;
        if (full) patch.face_url = null;
        const { error: patchError } = await admin.from('students').update(patch).eq('id', s.id);
        if (patchError) throw patchError;
        if (full && authUserId) {
          await resetStudentPassword(admin, s.id, user.id, password);
        }
        await admin.from('student_login_events').insert({
          student_id: s.id,
          department_id: s.department_id,
          matric_no: s.matric_no,
          event: action === 'reset_device' ? 'device_reset' : 'reset',
          actor_user_id: user.id,
        });
        results.push({
          id: s.id, name: s.name, matric_no: s.matric_no,
          status: action === 'reset_device' ? 'device_reset' : 'login_reset',
          ...(full && authUserId ? { temp_password: password } : {}),
        });
        continue;
      }

      if (action === 'reset_device') {
        await admin.from('students').update({ device_fingerprint: null }).eq('id', s.id);
        await admin.from('student_login_events').insert({
          student_id: s.id,
          department_id: s.department_id,
          matric_no: s.matric_no,
          event: 'device_reset',
          actor_user_id: user.id,
          detail: { reason: 'admin reset device binding' },
        });
        results.push({ id: s.id, name: s.name, matric_no: s.matric_no, status: 'device_reset' });
        continue;
      }

      if (action === 'reset_password' && authUserId) {
        await resetStudentPassword(admin, s.id, user.id, password);
        results.push({ id: s.id, name: s.name, matric_no: s.matric_no, email, status: 'password_reset', temp_password: password });
        continue;
      }

      if (authUserId) { results.push({ id: s.id, name: s.name, matric_no: s.matric_no, email, status: 'already_provisioned' }); continue; }

      // Try to create
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: s.name, matric_no: s.matric_no, is_student: true },
      });

      let existingAuthUser = false;
      if (createErr) {
        // If user exists, look it up by email (paginated)
        const found = await findUserByEmail(admin, email);
        if (found) {
          authUserId = found.id;
          existingAuthUser = true;
          const { error: metadataError } = await admin.auth.admin.updateUserById(found.id, {
            user_metadata: { name: s.name, matric_no: s.matric_no, is_student: true },
          });
          if (metadataError) throw metadataError;
        } else {
          results.push({ id: s.id, name: s.name, matric_no: s.matric_no, error: createErr.message });
          continue;
        }
      } else {
        authUserId = created.user!.id;
      }

      // Link in students + profiles + roles
      const { error: linkError } = await admin.from('students').update({ auth_user_id: authUserId }).eq('id', s.id);
      if (linkError) throw linkError;
      if (existingAuthUser) {
        await resetStudentPassword(admin, s.id, user.id, password);
      }
      const { error: controlError } = await admin.from('student_password_controls').upsert({
        user_id: authUserId!,
        must_change_password: true,
      }, { onConflict: 'user_id' });
      if (controlError) throw controlError;

      const { error: profileError } = await admin.from('profiles').upsert({
        user_id: authUserId,
        name: s.name,
        email,
        department_id: s.department_id,
      }, { onConflict: 'user_id' });
      if (profileError) throw profileError;
      const { error: roleError } = await admin.from('user_roles').upsert({ user_id: authUserId, role: 'student' }, { onConflict: 'user_id,role' });
      if (roleError) throw roleError;

      results.push({ id: s.id, name: s.name, matric_no: s.matric_no, email, status: 'created', temp_password: password });
    }

    return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('provision-student-auth error', e);
    return new Response(JSON.stringify({ error: 'Provisioning failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
