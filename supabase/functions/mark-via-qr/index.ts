// Student scans QR → this function marks them present for the session's course/date.
// Enforces geofence when the session has latitude/longitude/radius_m configured.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

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
    const lat = typeof body?.lat === 'number' ? body.lat : null;
    const lng = typeof body?.lng === 'number' ? body.lng : null;
    const accuracy = typeof body?.accuracy === 'number' ? body.accuracy : null;
    if (!token) return new Response(JSON.stringify({ error: 'Missing token' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: session, error: sErr } = await admin
      .from('attendance_sessions')
      .select('id, course_id, department_id, date, expires_at, created_by, latitude, longitude, radius_m')
      .eq('token', token)
      .maybeSingle();

    if (sErr || !session) return new Response(JSON.stringify({ error: 'Invalid QR code' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (new Date(session.expires_at) < new Date()) return new Response(JSON.stringify({ error: 'QR code has expired' }), { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Geofence check when configured
    if (session.latitude != null && session.longitude != null && session.radius_m != null) {
      if (lat == null || lng == null) {
        return new Response(JSON.stringify({ error: 'Location required. Please enable location access and try again.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const dist = haversineMeters(lat, lng, session.latitude, session.longitude);
      const tolerance = Math.min(accuracy ?? 0, 50); // forgive up to 50m of GPS error
      if (dist - tolerance > session.radius_m) {
        return new Response(JSON.stringify({
          error: `You are too far from the class location (~${Math.round(dist)}m away, allowed ${session.radius_m}m).`,
          distance_m: Math.round(dist),
        }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const { data: course } = await admin
      .from('courses')
      .select('name, code')
      .eq('id', session.course_id)
      .maybeSingle();

    const { data: student } = await admin
      .from('students')
      .select('id, name, department_id, matric_no')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!student) return new Response(JSON.stringify({ error: 'No student profile linked to this account' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (student.department_id !== session.department_id) return new Response(JSON.stringify({ error: 'This session is for a different department' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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
