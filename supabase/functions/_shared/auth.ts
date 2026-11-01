// Shared caller-identification helper for edge functions.
// Never trusts the client: the bearer token is validated server-side.
import { createClient } from 'npm:@supabase/supabase-js@2';

export type Caller = {
  /** true when the bearer token is the project's service-role key (cron / function-to-function) */
  isService: boolean;
  /** true when there is no valid signed-in user (e.g. only the public anon key was sent) */
  anonymous: boolean;
  userId: string | null;
  roles: string[];
  departmentId: string | null;
};

export const STAFF_ROLES = ['dept_admin', 'super_admin', 'hod', 'lecturer', 'course_rep'];
export const ADMIN_ROLES = ['dept_admin', 'super_admin'];

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function makeAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

export async function getCaller(req: Request, admin: ReturnType<typeof makeAdminClient>): Promise<Caller> {
  const anonymous: Caller = { isService: false, anonymous: true, userId: null, roles: [], departmentId: null };
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return anonymous;
  const jwt = header.slice(7).trim();
  if (!jwt) return anonymous;

  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (service && safeEqual(jwt, service)) {
    return { isService: true, anonymous: false, userId: null, roles: ['service_role'], departmentId: null };
  }

  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return anonymous; // e.g. the public anon key
  const userId = data.user.id;

  const [{ data: roleRows }, { data: prof }] = await Promise.all([
    admin.from('user_roles').select('role').eq('user_id', userId),
    admin.from('profiles').select('department_id').eq('user_id', userId).maybeSingle(),
  ]);
  return {
    isService: false,
    anonymous: false,
    userId,
    roles: (roleRows ?? []).map((r: any) => r.role as string),
    departmentId: (prof?.department_id as string | null) ?? null,
  };
}

export const hasAnyRole = (c: Caller, roles: string[]) => c.isService || c.roles.some((r) => roles.includes(r));

/** Very small per-isolate rate limiter (best effort; real protection should also be set at the platform level). */
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimited(key: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now > cur.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return false;
  }
  cur.n++;
  return cur.n > max;
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown').split(',')[0].trim();
}
