// Shared face-comparison helper backed by Lovable AI (vision model).
// Returns a 0-100 similarity confidence and a boolean verdict.

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3.6-flash';

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
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) return { ok: false, same_person: false, confidence: 0, error: 'LOVABLE_API_KEY not configured' };

  const prompt =
    'You are a face verification system. Image 1 is the enrolled reference photo of a student. ' +
    'Image 2 is a live selfie taken just now. Decide whether they show the SAME person. ' +
    'Also judge liveness: if image 2 looks like a photo of a screen, a printed photo, or has no visible human face, treat it as not verified. ' +
    'Reply ONLY with compact JSON: {"same_person": true|false, "confidence": 0-100, "reason": "short"}.';

  const resp = await fetch(GATEWAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'Lovable-API-Key': key,
    },
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
    const text = await resp.text().catch(() => '');
    if (resp.status === 429) return { ok: false, same_person: false, confidence: 0, status: 429, error: 'Face check rate limited. Try again shortly.' };
    if (resp.status === 402) return { ok: false, same_person: false, confidence: 0, status: 402, error: 'AI credits exhausted. Ask an admin to top up.' };
    return { ok: false, same_person: false, confidence: 0, status: resp.status, error: `Face check failed: ${text.slice(0, 200)}` };
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

export async function fetchEnrolledFace(admin: any, faceUrl: string): Promise<string | null> {
  // faceUrl is a storage path inside the private `faces` bucket.
  const { data, error } = await admin.storage.from('faces').download(faceUrl);
  if (error || !data) return null;
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return `data:${data.type || 'image/jpeg'};base64,${btoa(bin)}`;
}
