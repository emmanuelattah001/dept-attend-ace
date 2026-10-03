// Student scans QR -> multi-factor verification (rotating QR + GPS + face + device) -> attendance.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { isValidCode } from '../_shared/rotating.ts';
import { compareFaces, fetchEnrolledFace } from '../_shared/face.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Weighted confidence model (total 100)
const W = { qr: 30, face: 30, location: 25, device: 15 };
const PASS_THRESHOLD = 60;

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

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);

  // Collected as we go so failures are auditable too.
  const proofs: Record<string, any> = {};
  let score = 0;
  let sessionId: string | null = null;
  let studentId: string | null = null;
  let departmentId: string | null = null;
  let courseId: string | null = null;

  const fail = async (reason: string, message: string, status: number, extra: Record<string, unknown> = {}) => {
    try {
      await admin.from('verification_events').insert({
        session_id: sessionId, student_id: studentId, department_id: departmentId, course_id: courseId,
        outcome: 'failed', reason, confidence_score: score, proofs,
      });
    } catch (e) { console.error('verification_events insert failed', e); }
    return json({ error: message, reason, confidence_score: score, proofs, ...extra }, status);
  };

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not authenticated' }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Auth invalid' }, 401);

    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? '').trim();
    const code = String(body?.code ?? '').trim();
    const lat = typeof body?.lat === 'number' ? body.lat : null;
    const lng = typeof body?.lng === 'number' ? body.lng : null;
    const accuracy = typeof body?.accuracy === 'number' ? body.accuracy : null;
    const selfie = typeof body?.selfie === 'string' ? body.selfie : '';
    const deviceId = String(body?.device_id ?? '').trim();
    if (!token) return json({ error: 'Missing token' }, 400);

    const { data: session } = await admin
      .from('attendance_sessions')
      .select('id, course_id, department_id, date, expires_at, created_by, latitude, longitude, radius_m, secret, rotating, rotate_seconds')
      .eq('token', token)
      .maybeSingle();
    if (!session) return json({ error: 'Invalid QR code' }, 404);
    sessionId = session.id; departmentId = session.department_id; courseId = session.course_id;
    if (new Date(session.expires_at) < new Date()) return json({ error: 'This session has ended' }, 410);

    const { data: student } = await admin
      .from('students')
      .select('id, name, department_id, matric_no, face_url, device_fingerprint')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!student) return json({ error: 'No student profile linked to this account' }, 403);
    studentId = student.id;
    if (student.department_id !== session.department_id) return await fail('wrong_department', 'This session is for a different department', 403);

    // ---- Proof 1: QR (rotating code when enabled) ----
    if (session.rotating) {
      if (!code) return await fail('missing_code', 'This QR refreshes every few seconds — rescan the screen.', 400);
      const valid = await isValidCode(session.secret, session.rotate_seconds || 30, code);
      proofs.qr = { rotating: true, valid };
      if (!valid) return await fail('stale_code', 'That QR code has expired. Rescan the live screen.', 403);
    } else {
      proofs.qr = { rotating: false, valid: true };
    }
    score += W.qr;

    // ---- Proof 2: Location ----
    if (session.latitude != null && session.longitude != null && session.radius_m != null) {
      if (lat == null || lng == null) {
        proofs.location = { required: true, provided: false };
        return await fail('no_location', 'Location required. Enable location access and try again.', 400);
      }
      const dist = haversineMeters(lat, lng, session.latitude, session.longitude);
      const tolerance = Math.min(accuracy ?? 0, 50);
      const inside = dist - tolerance <= session.radius_m;
      proofs.location = { required: true, distance_m: Math.round(dist), radius_m: session.radius_m, accuracy_m: accuracy, inside };
      if (!inside) {
        return await fail('out_of_range', `You are too far from the class location (~${Math.round(dist)}m away, allowed ${session.radius_m}m).`, 403, { distance_m: Math.round(dist) });
      }
      score += W.location;
    } else {
      proofs.location = { required: false };
      score += W.location; // no geofence configured -> not penalised
    }

    // ---- Proof 3: Face ----
    if (student.face_url) {
      if (!selfie) {
        proofs.face = { required: true, provided: false };
        return await fail('no_selfie', 'Face check required. Allow camera access and capture your selfie.', 400);
      }
      const enrolled = await fetchEnrolledFace(admin, student.face_url);
      if (!enrolled) {
        proofs.face = { required: true, error: 'enrolled_unreadable' };
        return await fail('face_unreadable', 'Your enrolled photo could not be read. Re-enroll your face.', 500);
      }
      const match = await compareFaces(enrolled, selfie);
      proofs.face = { required: true, ...match };
      if (!match.ok) return await fail('face_error', match.error ?? 'Face check failed', match.status ?? 500);
      if (!match.same_person) return await fail('face_mismatch', 'Face did not match your enrolled photo.', 403);
      score += Math.round((W.face * Math.min(100, match.confidence)) / 100);
    } else {
      proofs.face = { required: true, enrolled: false };
      return await fail('face_not_enrolled', 'You must enroll your face on your dashboard before you can scan for attendance.', 403);
    }

    // ---- Proof 4: Device ----
    if (deviceId) {
      const known = student.device_fingerprint;
      const matchDevice = !known || known === deviceId;
      proofs.device = { provided: true, known: Boolean(known), match: matchDevice };
      if (!known) await admin.from('students').update({ device_fingerprint: deviceId }).eq('id', student.id);
      if (matchDevice) score += W.device;
      else {
        return await fail('device_mismatch', 'This account is bound to a different device. Ask your admin to reset your device.', 403);
      }
    } else {
      proofs.device = { provided: false };
    }

    score = Math.max(0, Math.min(100, score));
    if (score < PASS_THRESHOLD) {
      return await fail('low_confidence', `Verification confidence too low (${score}%). Try again in better conditions.`, 403);
    }

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
        confidence_score: score,
        proofs,
        verified_via: 'qr_multifactor',
      }, { onConflict: 'student_ref,course_id,date' });
    if (upErr) throw upErr;

    await admin.from('verification_events').insert({
      session_id: session.id, student_id: student.id, department_id: session.department_id,
      course_id: session.course_id, outcome: 'passed', confidence_score: score, proofs,
    });

    const { data: course } = await admin.from('courses').select('name, code').eq('id', session.course_id).maybeSingle();

    return json({
      ok: true,
      course,
      date: session.date,
      confidence_score: score,
      proofs,
      student: { name: student.name, matric_no: student.matric_no },
    });
  } catch (e) {
    console.error('mark-via-qr error', e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
