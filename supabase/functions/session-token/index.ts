// Issues the current rotating code for a live QR session (admins/lecturers only).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { rotatingCode, secondsLeftInWindow } from '../_shared/rotating.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not authenticated' }, 401);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, service);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Auth invalid' }, 401);

    const { token } = await req.json().catch(() => ({}));
    if (!token) return json({ error: 'Missing token' }, 400);

    const { data: session } = await admin
      .from('attendance_sessions')
      .select('id, secret, rotate_seconds, rotating, expires_at, created_by, department_id, course_id, date')
      .eq('token', String(token))
      .maybeSingle();
    if (!session) return json({ error: 'Session not found' }, 404);

    // Only authorized department staff may read the code, even when they created it.
    const { data: roles, error: roleError } = await admin.from('user_roles').select('role').eq('user_id', user.id);
    if (roleError) throw roleError;
    const roleSet = new Set((roles ?? []).map((row: any) => row.role));
    let allowed = roleSet.has('super_admin');
    if (!allowed && (roleSet.has('dept_admin') || roleSet.has('hod'))) {
      const { data: prof, error: profileError } = await admin
        .from('profiles')
        .select('department_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      allowed = prof?.department_id === session.department_id;
    }
    if (!allowed && (roleSet.has('lecturer') || roleSet.has('course_rep'))) {
      const staffRoles = ['lecturer', 'course_rep'].filter((role) => roleSet.has(role));
      const { data: assignment, error: assignmentError } = await admin
        .from('course_staff')
        .select('staff_role')
        .eq('user_id', user.id)
        .eq('course_id', session.course_id)
        .eq('department_id', session.department_id)
        .in('staff_role', staffRoles)
        .limit(1)
        .maybeSingle();
      if (assignmentError) throw assignmentError;
      allowed = Boolean(assignment);
    }
    if (!allowed) return json({ error: 'Not allowed' }, 403);

    const rotate = session.rotating ? (session.rotate_seconds || 30) : 0;
    const code = rotate ? await rotatingCode(session.secret, rotate) : null;

    return json({
      ok: true,
      code,
      rotating: Boolean(session.rotating),
      rotate_seconds: rotate,
      seconds_left: rotate ? secondsLeftInWindow(rotate) : null,
      expires_at: session.expires_at,
    });
  } catch (e) {
    console.error('session-token error', e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
