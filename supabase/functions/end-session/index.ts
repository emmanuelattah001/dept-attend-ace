// End a live QR session and mark all department students who did not sign in as absent.
// Called by the department admin who owns the session.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, service);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return new Response(JSON.stringify({ error: 'Auth invalid' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? '').trim();
    if (!token) return new Response(JSON.stringify({ error: 'Missing token' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Confirm admin role
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', user.id);
    const isAdmin = (roles ?? []).some((r: any) => r.role === 'dept_admin' || r.role === 'super_admin');
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Load session
    const { data: session, error: sErr } = await admin
      .from('attendance_sessions')
      .select('id, course_id, department_id, date, created_by')
      .eq('token', token)
      .maybeSingle();
    if (sErr || !session) return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Only the owner or a super_admin
    const isSuper = (roles ?? []).some((r: any) => r.role === 'super_admin');
    if (!isSuper && session.created_by !== user.id) {
      return new Response(JSON.stringify({ error: 'Only the session owner can end it' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Expire the session now
    await admin.from('attendance_sessions').update({ expires_at: new Date().toISOString() }).eq('id', session.id);

    // Fetch students in the department
    const { data: students, error: stErr } = await admin
      .from('students')
      .select('id, auth_user_id')
      .eq('department_id', session.department_id);
    if (stErr) throw stErr;

    // Fetch existing attendance rows for this course+date
    const { data: existing } = await admin
      .from('attendance')
      .select('student_ref')
      .eq('course_id', session.course_id)
      .eq('date', session.date);
    const marked = new Set((existing ?? []).map((r: any) => r.student_ref));

    const absents = (students ?? [])
      .filter((s: any) => !marked.has(s.id))
      .map((s: any) => ({
        student_id: s.auth_user_id,
        student_ref: s.id,
        course_id: session.course_id,
        department_id: session.department_id,
        date: session.date,
        status: 'absent',
        marked_by: session.created_by,
        synced_to_sheets: false,
      }));

    let inserted = 0;
    if (absents.length) {
      // Chunked upsert
      for (let i = 0; i < absents.length; i += 500) {
        const chunk = absents.slice(i, i + 500);
        const { error: upErr, count } = await admin
          .from('attendance')
          .upsert(chunk, { onConflict: 'student_ref,course_id,date', ignoreDuplicates: true, count: 'exact' });
        if (upErr) throw upErr;
        inserted += count ?? chunk.length;
      }
    }

    return new Response(JSON.stringify({ ok: true, marked_absent: inserted, total_students: students?.length ?? 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('end-session error', e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
