// Rotating QR code derivation shared by the session-token issuer and the scanner.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export function windowIndex(rotateSeconds: number, at: number = Date.now()): number {
  return Math.floor(at / 1000 / Math.max(5, rotateSeconds));
}

export async function rotatingCode(secret: string, rotateSeconds: number, at: number = Date.now()): Promise<string> {
  const sig = await hmac(secret, String(windowIndex(rotateSeconds, at)));
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[sig[i] % ALPHABET.length];
  return out;
}

/** Accepts the current window plus the previous one (clock skew / slow scans). */
export async function isValidCode(secret: string, rotateSeconds: number, code: string): Promise<boolean> {
  const given = String(code ?? '').trim().toUpperCase();
  if (!given) return false;
  const now = Date.now();
  const candidates = await Promise.all([
    rotatingCode(secret, rotateSeconds, now),
    rotatingCode(secret, rotateSeconds, now - rotateSeconds * 1000),
  ]);
  return candidates.includes(given);
}

export function secondsLeftInWindow(rotateSeconds: number, at: number = Date.now()): number {
  const step = Math.max(5, rotateSeconds) * 1000;
  return Math.ceil((step - (at % step)) / 1000);
}
