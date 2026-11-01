// Shared face-comparison helper backed by any OpenAI-compatible vision model.
// Returns a 0-100 similarity confidence and a boolean verdict.
//
// Configure with Supabase secrets (works outside Lovable):
//   FACE_API_URL  - chat-completions endpoint   (default: Lovable AI gateway)
//   FACE_API_KEY  - API key                     (falls back to LOVABLE_API_KEY)
//   FACE_MODEL    - vision-capable model id     (default below; verify it exists on your provider)
// Example (OpenAI):  FACE_API_URL=https://api.openai.com/v1/chat/completions  FACE_MODEL=gpt-4o-mini

const GATEWAY = Deno.env.get('FACE_API_URL') || 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = Deno.env.get('FACE_MODEL') || 'google/gemini-3.6-flash';

function faceKey(): string | undefined {
  return Deno.env.get('FACE_API_KEY') || Deno.env.get('LOVABLE_API_KEY') || undefined;
}
function faceHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (GATEWAY.includes('lovable.dev')) h['Lovable-API-Key'] = key;
  return h;
}

export interface FaceMatchResult {
  ok: boolean;
  same_person: boolean;
  confidence: number; // 0-100
  reason?: string;
  error?: string;
  status?: number;
}

function asDataUrl(image: string): string {
  return image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`;
}

export async function compareFaces(enrolled: string, selfie: string): Promise<FaceMatchResult> {
  const key = faceKey();
  if (!key) return { ok: false, same_person: false, confidence: 0, error: 'Face verification is not configured (set FACE_API_KEY)' };

  const prompt =
    'You are a face verification system. Image 1 is the enrolled reference photo of a student. ' +
    'Image 2 is a live selfie taken just now. Decide whether they show the SAME person. ' +
    'Also judge liveness: if image 2 looks like a photo of a screen, a printed photo, or has no visible human face, treat it as not verified. ' +
    'Reply ONLY with compact JSON: {"same_person": true|false, "confidence": 0-100, "reason": "short"}.';

  const resp = await fetch(GATEWAY, {
    method: 'POST',
    headers: faceHeaders(key),
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: asDataUrl(enrolled) } },
            { type: 'image_url', image_url: { url: asDataUrl(selfie) } },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    await resp.text().catch(() => '');
    if (resp.status === 429) return { ok: false, same_person: false, confidence: 0, status: 429, error: 'Face check rate limited. Try again shortly.' };
    if (resp.status === 402) return { ok: false, same_person: false, confidence: 0, status: 402, error: 'AI credits exhausted. Ask an admin to top up.' };
    return { ok: false, same_person: false, confidence: 0, status: resp.status, error: 'Face check failed. Try again.' };
  }

  const data = await resp.json().catch(() => ({}));
  const raw: string = data?.choices?.[0]?.message?.content ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, same_person: false, confidence: 0, error: 'Face check returned no verdict' };
  try {
    const parsed = JSON.parse(match[0]);
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence ?? 0)));
    return { ok: true, same_person: Boolean(parsed.same_person) && confidence >= 60, confidence, reason: String(parsed.reason ?? '') };
  } catch {
    return { ok: false, same_person: false, confidence: 0, error: 'Face check verdict unreadable' };
  }
}

export interface FaceQualityResult { ok: boolean; acceptable: boolean; issues: string[]; error?: string; status?: number }

// Checks an enrollment photo: exactly one clear, well-lit, unobstructed, real face.
export async function checkFaceQuality(image: string): Promise<FaceQualityResult> {
  const key = faceKey();
  if (!key) return { ok: false, acceptable: false, issues: [], error: 'Face verification is not configured (set FACE_API_KEY)' };
  const prompt =
    'You check reference photos for a face-recognition attendance system. Judge this photo. It is acceptable ONLY if: ' +
    'exactly one human face is visible; the face is centered and fills a good part of the frame; lighting is good (not too dark, not washed out, no harsh shadow over the face); ' +
    'the photo is sharp (not blurry); both eyes are visible (no sunglasses, mask, hand or hair covering the face); the person faces the camera; ' +
    'and it is a live photo, not a picture of a screen or printed photo. ' +
    'Reply ONLY with compact JSON: {"acceptable": true|false, "issues": ["short plain-English tip for each problem"]}.';
  const resp = await fetch(GATEWAY, {
    method: 'POST',
    headers: faceHeaders(key),
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: asDataUrl(image) } },
      ] }],
    }),
  });
  if (!resp.ok) {
    if (resp.status === 429) return { ok: false, acceptable: false, issues: [], status: 429, error: 'Photo check busy. Try again shortly.' };
    if (resp.status === 402) return { ok: false, acceptable: false, issues: [], status: 402, error: 'AI credits exhausted. Ask an admin to top up.' };
    return { ok: false, acceptable: false, issues: [], status: 500, error: 'Photo check failed. Try again.' };
  }
  const data = await resp.json().catch(() => ({}));
  const raw: string = data?.choices?.[0]?.message?.content ?? '';
  const m = raw.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(m?.[0] ?? '');
    const issues = Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 4) : [];
    return { ok: true, acceptable: Boolean(parsed.acceptable), issues };
  } catch {
    return { ok: false, acceptable: false, issues: [], status: 500, error: 'Photo check unreadable. Try again.' };
  }
}

export async function fetchEnrolledFace(admin: any, faceUrl: string): Promise<string | null> {
  // faceUrl is a storage path inside the private `faces` bucket.
  const { data, error } = await admin.storage.from('faces').download(faceUrl);
  if (error || !data) return null;
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return `data:${data.type || 'image/jpeg'};base64,${btoa(bin)}`;
}
