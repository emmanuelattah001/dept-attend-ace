// Google Sheets sync: two tabs
//   Attendance      — append-only log of every attendance row (dedup by attendance_id)
//   Student Progress — one row per (matric_no, course_code); percentage precomputed here
//
// Public action: lookup_by_matric  (reads Attendance tab)
// Auth actions : append | sync_unsynced | export_all
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const ATTENDANCE_TAB = 'Attendance';
const PROGRESS_TAB = 'Student Progress';

const ATTENDANCE_HEADER = [
  'attendance_id', 'student_name', 'matric_no', 'gender', 'department',
  'course_code', 'course_name', 'attendance_date', 'status', 'synced_at',
];
const PROGRESS_HEADER = [
  'Student Name', 'Matric No', 'Department', 'Course',
  'Total Present', 'Total Absent', 'Total Classes',
  'Attendance Percentage', 'Last Attendance Date', 'Last Status',
];

// ---------- helpers ----------
const q = (t: string) => `'${t.replace(/'/g, "''")}'`;
const range = (t: string, r: string) => `${q(t)}!${r}`;

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
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
  };
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

async function api(token: string, path: string, init: RequestInit = {}) {
  const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Sheets ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function ensureTabs(token: string, sid: string) {
  const meta = await api(token, `${sid}?fields=sheets.properties(title)`);
  const titles: string[] = (meta.sheets ?? []).map((s: any) => s.properties?.title).filter(Boolean);
  const requests: any[] = [];
  if (!titles.includes(ATTENDANCE_TAB)) requests.push({ addSheet: { properties: { title: ATTENDANCE_TAB } } });
  if (!titles.includes(PROGRESS_TAB)) requests.push({ addSheet: { properties: { title: PROGRESS_TAB } } });
  if (requests.length) await api(token, `${sid}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });

  // headers
  await api(token, `${sid}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: range(ATTENDANCE_TAB, `A1:${String.fromCharCode(64 + ATTENDANCE_HEADER.length)}1`), values: [ATTENDANCE_HEADER] },
        { range: range(PROGRESS_TAB, `A1:${String.fromCharCode(64 + PROGRESS_HEADER.length)}1`), values: [PROGRESS_HEADER] },
      ],
    }),
  });
}

async function readAttendanceIds(token: string, sid: string): Promise<Set<string>> {
  const data = await api(token, `${sid}/values/${range(ATTENDANCE_TAB, 'A2:A')}`);
  const ids = new Set<string>();
  for (const row of (data.values ?? []) as string[][]) if (row[0]) ids.add(row[0]);
  return ids;
}

async function readAttendanceRows(token: string, sid: string): Promise<string[][]> {
  const data = await api(token, `${sid}/values/${range(ATTENDANCE_TAB, `A2:${String.fromCharCode(64 + ATTENDANCE_HEADER.length)}`)}`);
  return (data.values ?? []) as string[][];
}

async function appendRows(token: string, sid: string, tab: string, rows: any[][]) {
  if (!rows.length) return;
  const width = String.fromCharCode(64 + rows[0].length);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await api(token, `${sid}/values/${range(tab, `A:${width}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values: slice }),
    });
  }
}

async function overwriteTab(token: string, sid: string, tab: string, header: string[], rows: any[][]) {
  const width = String.fromCharCode(64 + header.length);
  await api(token, `${sid}/values/${range(tab, `A:${width}`)}:clear`, { method: 'POST', body: '{}' });
  const values = [header, ...rows];
  await api(token, `${sid}/values/${range(tab, `A1:${width}${values.length}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values }),
  });
}

// ---------- attendance fetch ----------
async function fetchAttendance(admin: any, action: string, ids?: string[]) {
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];
  while (true) {
    let query = admin.from('attendance')
      .select('id, date, status, created_at, marked_by, synced_to_sheets, student_ref, department_id, course_id, students:student_ref(name, matric_no, gender), departments:department_id(name), courses:course_id(name, code)')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (action === 'append' && Array.isArray(ids) && ids.length) query = query.in('id', ids);
    else if (action === 'sync_unsynced') query = query.eq('synced_to_sheets', false);
    const { data, error } = await query;
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// ---------- progress rebuild ----------
function buildProgress(rows: string[][]) {
  // rows: attendance_id, student_name, matric_no, gender, department, course_code, course_name, date, status, synced_at
  const map = new Map<string, {
    name: string; matric: string; dept: string; course: string;
    present: number; absent: number; total: number;
    lastDate: string; lastStatus: string;
  }>();
  for (const r of rows) {
    const [, name, matric, , dept, courseCode, courseName, date, status] = r;
    const courseLabel = courseCode ? (courseName ? `${courseCode} - ${courseName}` : courseCode) : (courseName ?? '');
    const key = `${(matric || '').toLowerCase()}|${(courseCode || courseName || '').toLowerCase()}`;
    const rec = map.get(key) ?? {
      name: name ?? '', matric: matric ?? '', dept: dept ?? '', course: courseLabel,
      present: 0, absent: 0, total: 0, lastDate: '', lastStatus: '',
    };
    const s = (status || '').toLowerCase();
    if (s === 'present') rec.present++;
    else if (s === 'absent') rec.absent++;
    rec.total = rec.present + rec.absent;
    if (!rec.lastDate || (date && date > rec.lastDate)) { rec.lastDate = date ?? ''; rec.lastStatus = status ?? ''; }
    // keep freshest identity fields
    if (name) rec.name = name;
    if (dept) rec.dept = dept;
    if (courseLabel) rec.course = courseLabel;
    map.set(key, rec);
  }
  const out: any[][] = [];
  for (const r of map.values()) {
    const pct = r.total ? Math.round((r.present / r.total) * 1000) / 10 : 0;
    out.push([r.name, r.matric, r.dept, r.course, r.present, r.absent, r.total, pct, r.lastDate, r.lastStatus]);
  }
  out.sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[3]).localeCompare(String(b[3])));
  return out;
}

// ---------- main ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action: 'append' | 'sync_unsynced' | 'export_all' | 'lookup_by_matric' = body.action || 'sync_unsynced';

    const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
    const sa = JSON.parse(saJson);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = await getAccessToken(sa);

    const { data: settingRow } = await admin.from('app_settings').select('value').eq('key', 'google_sheet_id').maybeSingle();
    const sid: string | undefined = (settingRow?.value as any)?.id ?? Deno.env.get('GOOGLE_SHEET_ID') ?? undefined;
    if (!sid) throw new Error('GOOGLE_SHEET_ID not configured. Set the secret or app_settings.google_sheet_id.');

    // public lookup
    if (action === 'lookup_by_matric') {
      const matric = String(body.matric_no ?? '').trim().toLowerCase();
      if (!matric) return new Response(JSON.stringify({ ok: false, error: 'matric_no required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      await ensureTabs(token, sid);
      const all = await readAttendanceRows(token, sid);
      const rows = all.filter(r => (r[2] ?? '').toLowerCase() === matric).map(r => ({
        attendance_id: r[0], student_name: r[1], matric_no: r[2], gender: r[3], department: r[4],
        course_code: r[5], course_name: r[6], date: r[7], status: r[8], synced_at: r[9],
      }));
      return new Response(JSON.stringify({ ok: true, rows }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // auth check for other actions
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: cerr } = await sb.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (cerr || !claims?.claims) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    await ensureTabs(token, sid);

    const dbRows = await fetchAttendance(admin, action, body.ids);
    console.log(`sheets-sync[${action}]: fetched ${dbRows.length} rows`);

    // marker names
    const markerIds = Array.from(new Set(dbRows.map((r: any) => r.marked_by).filter(Boolean)));
    const markerMap = new Map<string, string>();
    if (markerIds.length) {
      const { data: markers } = await admin.from('profiles').select('user_id, name, email').in('user_id', markerIds);
      for (const m of markers ?? []) markerMap.set(m.user_id, m.name || m.email || m.user_id);
    }

    if (action === 'export_all') {
      const values = dbRows.map((r: any) => [
        r.id, r.students?.name ?? '', r.students?.matric_no ?? '', r.students?.gender ?? '',
        r.departments?.name ?? '', r.courses?.code ?? '', r.courses?.name ?? '',
        r.date, r.status, new Date().toISOString(),
      ]);
      await overwriteTab(token, sid, ATTENDANCE_TAB, ATTENDANCE_HEADER, values);
      const progress = buildProgress(values as any);
      await overwriteTab(token, sid, PROGRESS_TAB, PROGRESS_HEADER, progress);
      const ids = dbRows.map((r: any) => r.id);
      if (ids.length) await admin.from('attendance').update({ synced_to_sheets: true, synced_at: new Date().toISOString() }).in('id', ids);
      return new Response(JSON.stringify({ ok: true, exported: values.length, spreadsheetId: sid }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!dbRows.length) {
      return new Response(JSON.stringify({ ok: true, synced: 0, message: 'nothing to sync' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // dedup against existing attendance_ids in the sheet
    const existing = await readAttendanceIds(token, sid);
    const fresh = dbRows.filter((r: any) => !existing.has(r.id));
    const now = new Date().toISOString();
    const rowsToAppend = fresh.map((r: any) => [
      r.id, r.students?.name ?? '', r.students?.matric_no ?? '', r.students?.gender ?? '',
      r.departments?.name ?? '', r.courses?.code ?? '', r.courses?.name ?? '',
      r.date, r.status, now,
    ]);
    if (rowsToAppend.length) {
      await appendRows(token, sid, ATTENDANCE_TAB, rowsToAppend);
      console.log(`sheets-sync: appended ${rowsToAppend.length} new rows`);
    }

    // rebuild progress from full attendance tab (source of truth)
    const allAttendance = await readAttendanceRows(token, sid);
    const progress = buildProgress(allAttendance);
    await overwriteTab(token, sid, PROGRESS_TAB, PROGRESS_HEADER, progress);

    // mark synced
    const ids = dbRows.map((r: any) => r.id);
    await admin.from('attendance').update({ synced_to_sheets: true, synced_at: now }).in('id', ids);

    return new Response(JSON.stringify({
      ok: true, synced: ids.length, appended: rowsToAppend.length, progressRows: progress.length,
      spreadsheetId: sid, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sid}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('sheets-sync error:', e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
