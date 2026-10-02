// Enrolls / verifies a student's face photo.
//   action: 'enroll'  -> stores the selfie in the private `faces` bucket, stamps students.face_enrolled_at
//   action: 'verify'  -> compares a live selfie against the enrolled photo (debug / self-test)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { compareFaces, fetchEnrolledFace, checkFaceQuality } from '../_shared/face.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function decodeDataUrl(image: string): { bytes: Uint8Array; contentType: string } {
  const m = image.match(/^data:(.+?);base64,(.*)$/);
  const contentType = m ? m[1] : 'image/jpeg';
  const b64 = m ? m[2] : image;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

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

    const body = await req.json().catch(() => ({}));
    const action: string = body?.action ?? 'enroll';
    const image: string = String(body?.image ?? '');
    if (!image) return json({ error: 'Missing image' }, 400);

    const { data: student } = await admin
      .from('students')
      .select('id, name, face_url')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!student) return json({ error: 'No student profile linked to this account' }, 403);

    if (action === 'enroll') {
      const { bytes, contentType } = decodeDataUrl(image);
      if (bytes.length > 4_000_000) return json({ error: 'Photo too large. Try again.' }, 413);
      const q = await checkFaceQuality(image);
      if (!q.ok) return json({ error: q.error }, q.status ?? 500);
      if (!q.acceptable) {
        const tips = q.issues.length ? q.issues.join(' ') : 'Make sure your face is clear, centered and well lit.';
        return json({ error: `Photo not clear enough: ${tips}`, issues: q.issues, quality_rejected: true }, 422);
      }
      const path = `${user.id}/face.jpg`;
      const { error: upErr } = await admin.storage.from('faces').upload(path, bytes, { contentType, upsert: true });
      if (upErr) throw upErr;
      const { error: dbErr } = await admin
        .from('students')
        .update({ face_url: path, face_enrolled_at: new Date().toISOString() })
        .eq('id', student.id);
      if (dbErr) throw dbErr;
      return json({ ok: true, enrolled_at: new Date().toISOString() });
    }

    if (action === 'verify') {
      if (!student.face_url) return json({ error: 'No enrolled face yet' }, 400);
      const enrolled = await fetchEnrolledFace(admin, student.face_url);
      if (!enrolled) return json({ error: 'Enrolled photo could not be read' }, 500);
      const result = await compareFaces(enrolled, image);
      if (!result.ok) return json({ error: result.error }, result.status ?? 500);
      return json({ ok: true, ...result });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('verify-face error', e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
