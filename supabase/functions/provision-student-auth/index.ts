// Provision Supabase auth accounts for students of the caller's department.
// Email = synthetic <matric>@students.attendtrack.app, password = matric_no (lowercase).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYNTHETIC_DOMAIN = 'students.attendtrack.app';

function matricToEmail(matric: string) {
  const clean = matric.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${clean}@${SYNTHETIC_DOMAIN}`;
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

    // Check caller role
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', user.id);
    const isAdmin = roles?.some((r: any) => r.role === 'dept_admin' || r.role === 'super_admin');
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: callerProfile } = await admin.from('profiles').select('department_id').eq('user_id', user.id).maybeSingle();
    const isSuper = roles?.some((r: any) => r.role === 'super_admin');
    const callerDept = callerProfile?.department_id;

    const body = await req.json().catch(() => ({}));
    const { student_id, action = 'provision' } = body as { student_id?: string; action?: string };

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
      const password = s.matric_no.trim().toLowerCase();

      let authUserId = s.auth_user_id as string | null;

      if (action === 'reset_login') {
        await admin.from('students').update({ first_login_at: null }).eq('id', s.id);
        results.push({ id: s.id, name: s.name, matric_no: s.matric_no, status: 'login_reset' });
        continue;
      }

      if (action === 'reset_password' && authUserId) {
        await admin.auth.admin.updateUserById(authUserId, { password });
        results.push({ id: s.id, name: s.name, matric_no: s.matric_no, email, status: 'password_reset' });
        continue;
      }
        await admin.auth.admin.updateUserById(authUserId, { password });
        results.push({ id: s.id, name: s.name, matric_no: s.matric_no, email, status: 'password_reset' });
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

      if (createErr) {
        // If user exists, look it up by email via listing
        const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const found = existing?.users?.find((u: any) => u.email?.toLowerCase() === email);
        if (found) {
          authUserId = found.id;
          await admin.auth.admin.updateUserById(found.id, { password });
        } else {
          results.push({ id: s.id, name: s.name, matric_no: s.matric_no, error: createErr.message });
          continue;
        }
      } else {
        authUserId = created.user!.id;
      }

      // Link in students + profiles + roles
      await admin.from('students').update({ auth_user_id: authUserId }).eq('id', s.id);
      await admin.from('profiles').upsert({
        user_id: authUserId,
        name: s.name,
        email,
        department_id: s.department_id,
      }, { onConflict: 'user_id' });
      await admin.from('user_roles').upsert({ user_id: authUserId, role: 'student' }, { onConflict: 'user_id,role' });

      results.push({ id: s.id, name: s.name, matric_no: s.matric_no, email, status: 'created' });
    }

    return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('provision-student-auth error', e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
