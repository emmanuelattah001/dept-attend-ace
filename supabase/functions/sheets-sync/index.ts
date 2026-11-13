// Google Sheets sync: two tabs
//   Attendance      — append-only log of every attendance row (dedup by attendance_id)
//   Student Progress — one row per (matric_no, course_code); percentage precomputed here
//
// Public action: lookup_by_matric  (read-only, exact matric, rate limited)
// Staff actions: append | sync_unsynced | export_all (dept_admin / super_admin / service role)
//                read_all (staff, scoped to own department unless super_admin)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getCaller, hasAnyRole, ADMIN_ROLES, STAFF_ROLES, rateLimited, clientIp } from '../_shared/auth.ts';

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
async function fetchAttendance(admin: any, action: string, departmentIds: string[], ids?: string[]) {
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
    query = query.in('department_id', departmentIds);
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
    const action: 'append' | 'sync_unsynced' | 'export_all' | 'lookup_by_matric' | 'read_all' = body.action || 'sync_unsynced';

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const caller = await getCaller(req, admin);
    const isLookup = action === 'lookup_by_matric';
    const isSuper = caller.isService || caller.roles.includes('super_admin');
    const isInstitutionAdmin = !isSuper && caller.hierarchyRole === 'institution_admin';
    let verifiedStudent: { matric_no: string | null; department_id: string } | null = null;
    if (isLookup) {
      if (!caller.userId) return new Response(JSON.stringify({ ok: false, error: 'Sign in with your student account to view attendance.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { data: student, error: studentError } = await admin
        .from('students')
        .select('matric_no, department_id')
        .eq('auth_user_id', caller.userId)
        .maybeSingle();
      if (studentError) throw studentError;
      if (!student || String(student.matric_no ?? '').trim().toLowerCase() !== String(body.matric_no ?? '').trim().toLowerCase()) {
        return new Response(JSON.stringify({ ok: false, error: 'You can only view attendance linked to your student account.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      verifiedStudent = student;
    }
    if (!isLookup) {
      if (caller.anonymous) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const isHierarchyArchiveAction = ['read_all', 'append', 'sync_unsynced', 'export_all'].includes(action);
      const canAccessHierarchyArchive = isHierarchyArchiveAction && isInstitutionAdmin;
      const needed = action === 'read_all' ? STAFF_ROLES : ADMIN_ROLES;
      if (!hasAnyRole(caller, needed) && !canAccessHierarchyArchive) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let institutionId = caller.institutionId;
    if (isLookup && verifiedStudent) {
      const { data: department, error: departmentError } = await admin
        .from('departments')
        .select('faculty_id')
        .eq('id', verifiedStudent.department_id)
        .maybeSingle();
      if (departmentError) throw departmentError;
      const { data: faculty, error: facultyError } = department?.faculty_id
        ? await admin.from('faculties').select('institution_id').eq('id', department.faculty_id).maybeSingle()
        : { data: null, error: null };
      if (facultyError) throw facultyError;
      institutionId = faculty?.institution_id ?? null;
      if (body.institution_id && body.institution_id !== institutionId) {
        return new Response(JSON.stringify({ error: 'You can only access your own institution’s archive.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else if (caller.anonymous || isSuper) {
      institutionId = String(body.institution_id ?? '').trim() || null;
    } else if (body.institution_id && body.institution_id !== institutionId) {
      return new Response(JSON.stringify({ error: 'You cannot access another institution’s archive.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!institutionId) {
      return new Response(JSON.stringify({ error: 'An institution must be selected for archive access.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: institution, error: institutionError } = await admin
      .from('institutions')
      .select('id')
      .eq('id', institutionId)
      .eq('status', 'active')
      .maybeSingle();
    if (institutionError) throw institutionError;
    if (!institution) return new Response(JSON.stringify({ error: 'Institution is not active or does not exist.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: integration, error: integrationError } = await admin
      .from('institution_integrations')
      .select('google_sheet_id')
      .eq('institution_id', institutionId)
      .maybeSingle();
    if (integrationError) throw integrationError;
    const sid: string | undefined = integration?.google_sheet_id;
    if (!sid) return new Response(JSON.stringify({ ok: false, error: 'This institution’s separate attendance archive has not been configured.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: faculties, error: facultyError } = await admin
      .from('faculties')
      .select('id')
      .eq('institution_id', institutionId);
    if (facultyError) throw facultyError;
    const facultyIds = (faculties ?? []).map((faculty: any) => faculty.id);
    const { data: departments, error: departmentError } = facultyIds.length
      ? await admin.from('departments').select('id').in('faculty_id', facultyIds)
      : { data: [], error: null };
    if (departmentError) throw departmentError;
    const departmentIds = (departments ?? []).map((department: any) => department.id);
    if (!isSuper && !isInstitutionAdmin && caller.roles.includes('dept_admin')) {
      if (!caller.departmentId || !departmentIds.includes(caller.departmentId)) {
        return new Response(JSON.stringify({ error: 'Your department is not linked to this institution archive.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      departmentIds.splice(0, departmentIds.length, caller.departmentId);
    }

    if (isLookup) {
      if (rateLimited(`lookup:${clientIp(req)}`, 30)) return new Response(JSON.stringify({ ok: false, error: 'Too many requests' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const matric = String(body.matric_no ?? '').trim().toLowerCase();
      if (!matric || matric.length < 4) return new Response(JSON.stringify({ ok: false, error: 'matric_no required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
    const sa = JSON.parse(saJson);
    const token = await getAccessToken(sa);

    // public lookup: read-only, exact matric, no writes to Google, rate limited
    if (action === 'lookup_by_matric') {
      const matric = String(body.matric_no ?? '').trim().toLowerCase();
      const all = await readAttendanceRows(token, sid);
      const rows = all.filter(r => (r[2] ?? '').toLowerCase() === matric).map(r => ({
        attendance_id: r[0], student_name: r[1], matric_no: r[2], gender: r[3], department: r[4],
        course_code: r[5], course_name: r[6], date: r[7], status: r[8], synced_at: r[9],
      }));
      return new Response(JSON.stringify({ ok: true, rows }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await ensureTabs(token, sid);

    if (action === 'read_all') {
      let deptName: string | null = null;
      let allowedDepartmentNames: Set<string> | null = null;
      if (isInstitutionAdmin) {
        if (!caller.institutionId) return new Response(JSON.stringify({ error: 'No institution assigned.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const { data: scopedFaculties, error: scopedFacultyError } = await admin.from('faculties').select('id').eq('institution_id', caller.institutionId);
        if (scopedFacultyError) throw scopedFacultyError;
        const facultyIds = (scopedFaculties ?? []).map((faculty: any) => faculty.id);
        const { data: scopedDepartments, error: scopedDepartmentError } = facultyIds.length
          ? await admin.from('departments').select('name').in('faculty_id', facultyIds)
          : { data: [], error: null };
        if (scopedDepartmentError) throw scopedDepartmentError;
        allowedDepartmentNames = new Set((scopedDepartments ?? []).map((department: any) => department.name));
      } else if (!isSuper && caller.departmentId) {
        const { data: dept } = await admin.from('departments').select('name').eq('id', caller.departmentId).maybeSingle();
        deptName = dept?.name ?? null;
      }
      const all = await readAttendanceRows(token, sid);
      const rows = all
        .filter(r => isSuper || (deptName && (r[4] ?? '') === deptName) || (allowedDepartmentNames?.has(r[4] ?? '') ?? false))
        .map(r => ({
          attendance_id: r[0], student_name: r[1], matric_no: r[2], gender: r[3], department: r[4],
          course_code: r[5], course_name: r[6], date: r[7], status: r[8], synced_at: r[9],
        }));
      return new Response(JSON.stringify({ ok: true, rows, spreadsheetId: sid, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${sid}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // `append` may only touch ids the caller is allowed to see (non-super admins: own department)
    if (action === 'append' && !(caller.isService || caller.roles.includes('super_admin'))) {
      if (!Array.isArray(body.ids) || !body.ids.length) return new Response(JSON.stringify({ error: 'ids required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const dbRows = departmentIds.length
      ? await fetchAttendance(admin, action, departmentIds, body.ids)
      : [];
    console.log(`sheets-sync[${action}]: fetched ${dbRows.length} rows`);

    // marker names
    const markerIds = Array.from(new Set(dbRows.map((r: any) => r.marked_by).filter(Boolean)));
    const markerMap = new Map<string, string>();
    if (markerIds.length) {
      const { data: markers } = await admin.from('profiles').select('user_id, name, email').in('user_id', markerIds);
      for (const m of markers ?? []) markerMap.set(m.user_id, m.name || m.email || m.user_id);
    }

    if (action === 'export_all') {
      // Merge (never blindly overwrite): the database only keeps recent rows after cleanup,
      // so Sheets history must be preserved. DB rows win for the same attendance id.
      const existing = await readAttendanceRows(token, sid);
      const merged = new Map<string, any[]>();
      for (const row of existing) if (row[0]) merged.set(String(row[0]), row);
      const syncedAt = new Date().toISOString();
      for (const r of dbRows as any[]) {
        merged.set(String(r.id), [
          r.id, r.students?.name ?? '', r.students?.matric_no ?? '', r.students?.gender ?? '',
          r.departments?.name ?? '', r.courses?.code ?? '', r.courses?.name ?? '',
          r.date, r.status, syncedAt,
        ]);
      }
      const values = Array.from(merged.values());
      await overwriteTab(token, sid, ATTENDANCE_TAB, ATTENDANCE_HEADER, values);
      const progress = buildProgress(values as any);
      await overwriteTab(token, sid, PROGRESS_TAB, PROGRESS_HEADER, progress);
      const ids = dbRows.map((r: any) => r.id);
      for (let i = 0; i < ids.length; i += 200) {
        await admin.from('attendance').update({ synced_to_sheets: true, synced_at: syncedAt }).in('id', ids.slice(i, i + 200));
      }
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
