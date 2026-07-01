// Reads the "Student Progress" and "Attendance" tabs and returns rows + a dashboard summary.
// Public function: no auth required (matches lookup_by_matric pattern).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const ATTENDANCE_TAB = 'Attendance';
const PROGRESS_TAB = 'Student Progress';

const q = (t: string) => `'${t.replace(/'/g, "''")}'`;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function getAccessToken(sa: any): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 };
  const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)));
  const jwt = `${signingInput}.${b64url(sig)}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Google token error: ${JSON.stringify(data)}`);
  return data.access_token;
}
async function readRange(token: string, sid: string, r: string): Promise<string[][]> {
  const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${r}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheets read ${r}: ${JSON.stringify(data)}`);
  return (data.values ?? []) as string[][];
}

// tiny in-memory cache per isolate
const CACHE_TTL = 60_000;
let cache: { at: number; progress: string[][]; attendance: string[][] } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const matric = String(body.matric_no ?? url.searchParams.get('matric_no') ?? '').trim().toLowerCase();
    const courseCode = String(body.course_code ?? url.searchParams.get('course_code') ?? '').trim().toLowerCase();
    const department = String(body.department ?? url.searchParams.get('department') ?? '').trim().toLowerCase();

    const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
    const sa = JSON.parse(saJson);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: settingRow } = await admin.from('app_settings').select('value').eq('key', 'google_sheet_id').maybeSingle();
    const sid: string | undefined = (settingRow?.value as any)?.id ?? Deno.env.get('GOOGLE_SHEET_ID') ?? undefined;
    if (!sid) throw new Error('GOOGLE_SHEET_ID not configured');

    let progress: string[][], attendance: string[][];
    if (cache && Date.now() - cache.at < CACHE_TTL) {
      progress = cache.progress; attendance = cache.attendance;
    } else {
      const token = await getAccessToken(sa);
      [progress, attendance] = await Promise.all([
        readRange(token, sid, `${q(PROGRESS_TAB)}!A2:J`),
        readRange(token, sid, `${q(ATTENDANCE_TAB)}!A2:J`),
      ]);
      cache = { at: Date.now(), progress, attendance };
    }

    // progress rows: [name, matric, dept, course, present, absent, total, pct, lastDate, lastStatus]
    let rows = progress.map(r => ({
      student_name: r[0] ?? '',
      matric_no: r[1] ?? '',
      department: r[2] ?? '',
      course: r[3] ?? '',
      total_present: Number(r[4] ?? 0),
      total_absent: Number(r[5] ?? 0),
      total_classes: Number(r[6] ?? 0),
      attendance_percentage: Number(r[7] ?? 0),
      last_date: r[8] ?? '',
      last_status: r[9] ?? '',
    }));
    if (matric) rows = rows.filter(r => r.matric_no.toLowerCase() === matric);
    if (courseCode) rows = rows.filter(r => r.course.toLowerCase().includes(courseCode));
    if (department) rows = rows.filter(r => r.department.toLowerCase() === department);

    // summary
    const students = new Set<string>();
    const classes = new Set<string>(); // (date|course)
    let totalRecords = 0, totalPresent = 0, totalCount = 0;
    let above75 = 0, below75 = 0;
    for (const r of rows) {
      students.add(r.matric_no.toLowerCase());
      totalRecords += r.total_classes;
      totalPresent += r.total_present;
      totalCount += r.total_classes;
      if (r.total_classes > 0) {
        if (r.attendance_percentage >= 75) above75++; else below75++;
      }
    }
    for (const a of attendance) {
      if (!a[7]) continue;
      if (department && (a[4] ?? '').toLowerCase() !== department) continue;
      if (courseCode && !(a[5] ?? '').toLowerCase().includes(courseCode)) continue;
      classes.add(`${a[7]}|${a[5] ?? a[6] ?? ''}`);
    }

    // consecutive absences per (matric, course) — >= 3
    const seq = new Map<string, { last: string; absents: number; max: number; date: string }>();
    const sorted = [...attendance]
      .filter(a => !department || (a[4] ?? '').toLowerCase() === department)
      .filter(a => !courseCode || (a[5] ?? '').toLowerCase().includes(courseCode))
      .sort((x, y) => String(x[7] ?? '').localeCompare(String(y[7] ?? '')));
    for (const a of sorted) {
      const key = `${(a[2] ?? '').toLowerCase()}|${(a[5] ?? a[6] ?? '').toLowerCase()}`;
      const s = (a[8] ?? '').toLowerCase();
      const cur = seq.get(key) ?? { last: '', absents: 0, max: 0, date: '' };
      if (s === 'absent') { cur.absents++; cur.date = a[7] ?? cur.date; }
      else cur.absents = 0;
      cur.max = Math.max(cur.max, cur.absents);
      seq.set(key, cur);
    }
    const consecutiveAbsences = Array.from(seq.entries())
      .filter(([, v]) => v.max >= 3)
      .map(([k, v]) => ({ key: k, streak: v.max, last_date: v.date }));

    const summary = {
      totalStudents: students.size,
      totalClasses: classes.size,
      totalRecords,
      deptPercentage: totalCount ? Math.round((totalPresent / totalCount) * 1000) / 10 : 0,
      above75, below75,
      consecutiveAbsences: consecutiveAbsences.length,
      consecutiveAbsencesDetail: consecutiveAbsences.slice(0, 50),
    };

    return new Response(JSON.stringify({ ok: true, rows, summary }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('get-student-progress error:', e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
