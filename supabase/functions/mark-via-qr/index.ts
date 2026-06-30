// Student scans QR → this function marks them present for the session's course/date.
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

    // Load session
    const { data: session, error: sErr } = await admin
      .from('attendance_sessions')
      .select('id, course_id, department_id, date, expires_at, created_by')
      .eq('token', token)
      .maybeSingle();

    if (sErr) console.error('session lookup error', sErr);
    if (sErr || !session) return new Response(JSON.stringify({ error: 'Invalid QR code' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: course } = await admin
      .from('courses')
      .select('name, code')
      .eq('id', session.course_id)
      .maybeSingle();
    if (new Date(session.expires_at) < new Date()) return new Response(JSON.stringify({ error: 'QR code has expired' }), { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Find student by auth_user_id
    const { data: student } = await admin
      .from('students')
      .select('id, name, department_id, matric_no')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!student) return new Response(JSON.stringify({ error: 'No student profile linked to this account' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (student.department_id !== session.department_id) return new Response(JSON.stringify({ error: 'This session is for a different department' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Upsert attendance row
    const { error: upErr } = await admin
      .from('attendance')
      .upsert({
        student_id: user.id,
        student_ref: student.id,
        course_id: session.course_id,
        department_id: session.department_id,
        date: session.date,
        status: 'present',
        marked_by: session.created_by,
        synced_to_sheets: false,
      }, { onConflict: 'student_ref,course_id,date' });

    if (upErr) throw upErr;

    return new Response(JSON.stringify({
      ok: true,
      course,
      date: session.date,
      student: { name: student.name, matric_no: student.matric_no },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('mark-via-qr error', e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
