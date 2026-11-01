// Reads the "Student Progress" and "Attendance" tabs and returns rows + a dashboard summary.
// Access rules:
//   - anonymous / student callers MUST supply an exact matric_no and only ever receive that student's rows
//   - staff callers are forced to their own department
//   - public/super-admin lookups must name an institution with its own configured archive
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getCaller, makeAdminClient, hasAnyRole, STAFF_ROLES, rateLimited, clientIp } from '../_shared/auth.ts';

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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

// Cache is keyed by institution so one tenant's sheet is never reused for another.
const CACHE_TTL = 60_000;
const cache = new Map<string, { at: number; progress: string[][]; attendance: string[][] }>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const matric = String(body.matric_no ?? url.searchParams.get('matric_no') ?? '').trim().toLowerCase();
    const courseCode = String(body.course_code ?? url.searchParams.get('course_code') ?? '').trim().toLowerCase();
    let department = String(body.department ?? url.searchParams.get('department') ?? '').trim().toLowerCase();

    const adminDb = makeAdminClient();
    const caller = await getCaller(req, adminDb);
    const isStaff = hasAnyRole(caller, STAFF_ROLES);
    const isSuper = caller.isService || caller.roles.includes('super_admin');
    let verifiedStudentInstitutionId: string | null = null;
    let allowedCourseCodes: string[] | null = null;

    if (!isStaff) {
      if (!caller.userId) return jsonRes({ ok: false, error: 'Sign in with your student account to view attendance.' }, 401);
      if (rateLimited(`prog:${clientIp(req)}`, 30)) return jsonRes({ ok: false, error: 'Too many requests' }, 429);
      if (!matric || matric.length < 4) return jsonRes({ ok: false, error: 'matric_no required' }, 400);
      const { data: student, error: studentError } = await adminDb
        .from('students')
        .select('matric_no, department_id')
        .eq('auth_user_id', caller.userId)
        .maybeSingle();
      if (studentError) throw studentError;
      if (!student || String(student.matric_no ?? '').trim().toLowerCase() !== matric) {
        return jsonRes({ ok: false, error: 'You can only view attendance linked to your student account.' }, 403);
      }
      const { data: studentDepartment, error: studentDepartmentError } = await adminDb
        .from('departments')
        .select('faculty_id')
        .eq('id', student.department_id)
        .maybeSingle();
      if (studentDepartmentError) throw studentDepartmentError;
      const { data: studentFaculty, error: studentFacultyError } = studentDepartment?.faculty_id
        ? await adminDb.from('faculties').select('institution_id').eq('id', studentDepartment.faculty_id).maybeSingle()
        : { data: null, error: null };
      if (studentFacultyError) throw studentFacultyError;
      verifiedStudentInstitutionId = studentFaculty?.institution_id ?? null;
      if (!verifiedStudentInstitutionId) return jsonRes({ ok: false, error: 'Your student account is not linked to an institution.' }, 403);
      department = '';
    } else if (!isSuper) {
      // staff are locked to their own department
      if (!caller.departmentId) return jsonRes({ ok: false, error: 'No department assigned' }, 403);
      const { data: d, error: departmentError } = await adminDb.from('departments').select('name').eq('id', caller.departmentId).maybeSingle();
      if (departmentError) throw departmentError;
      if (!d?.name) return jsonRes({ ok: false, error: 'Department not found' }, 403);
      department = String(d.name).trim().toLowerCase();

      if (!caller.roles.includes('dept_admin') && !caller.roles.includes('hod')) {
        if (!courseCode) return jsonRes({ ok: false, error: 'Assigned staff must select an assigned course.' }, 403);
        const staffRoles = caller.roles.filter((role) => role === 'lecturer' || role === 'course_rep');
        const { data: assignments, error: assignmentError } = await adminDb
          .from('course_staff')
          .select('course_id')
          .eq('user_id', caller.userId)
          .eq('department_id', caller.departmentId)
          .in('staff_role', staffRoles);
        if (assignmentError) throw assignmentError;
        const courseIds = (assignments ?? []).map((assignment) => assignment.course_id);
        if (!courseIds.length) return jsonRes({ ok: false, error: 'No course assignments found.' }, 403);
        const { data: assignedCourses, error: courseError } = await adminDb
          .from('courses')
          .select('code')
          .in('id', courseIds)
          .eq('department_id', caller.departmentId);
        if (courseError) throw courseError;
        allowedCourseCodes = (assignedCourses ?? []).map((course) => String(course.code ?? '').trim().toLowerCase()).filter(Boolean);
        if (!allowedCourseCodes.includes(courseCode)) {
          return jsonRes({ ok: false, error: 'You are not assigned to this course.' }, 403);
        }
      }
    }

    let institutionId = caller.institutionId;
    if (!isStaff && verifiedStudentInstitutionId) {
      institutionId = verifiedStudentInstitutionId;
      if (body.institution_id && body.institution_id !== institutionId) {
        return jsonRes({ ok: false, error: 'You can only access your own institution’s archive' }, 403);
      }
    } else if (caller.anonymous || isSuper) {
      institutionId = String(body.institution_id ?? url.searchParams.get('institution_id') ?? '').trim() || null;
    } else if (body.institution_id && body.institution_id !== institutionId) {
      return jsonRes({ ok: false, error: 'You cannot access another institution’s archive' }, 403);
    }
    if (!institutionId) return jsonRes({ ok: false, error: 'Select an institution for attendance lookup' }, 400);

    const { data: institution, error: institutionError } = await adminDb
      .from('institutions')
      .select('id')
      .eq('id', institutionId)
      .eq('status', 'active')
      .maybeSingle();
    if (institutionError) throw institutionError;
    if (!institution) return jsonRes({ ok: false, error: 'Institution is not active or does not exist' }, 404);

    const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
    const sa = JSON.parse(saJson);
    const admin = adminDb;
    const { data: integration, error: integrationError } = await admin
      .from('institution_integrations')
      .select('google_sheet_id')
      .eq('institution_id', institutionId)
      .maybeSingle();
    if (integrationError) throw integrationError;
    const sid: string | undefined = integration?.google_sheet_id;
    if (!sid) return jsonRes({ ok: false, error: 'This institution’s separate attendance archive has not been configured' }, 409);

    let progress: string[][], attendance: string[][];
    const cached = cache.get(institutionId);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      progress = cached.progress; attendance = cached.attendance;
    } else {
      const token = await getAccessToken(sa);
      [progress, attendance] = await Promise.all([
        readRange(token, sid, `${q(PROGRESS_TAB)}!A2:J`),
        readRange(token, sid, `${q(ATTENDANCE_TAB)}!A2:J`),
      ]);
      cache.set(institutionId, { at: Date.now(), progress, attendance });
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
    if (courseCode) rows = rows.filter(r => {
      const archivedCourse = r.course.toLowerCase();
      return archivedCourse === courseCode || archivedCourse.startsWith(`${courseCode} -`);
    });
    if (allowedCourseCodes) rows = rows.filter(r => allowedCourseCodes!.some(code => {
      const archivedCourse = r.course.toLowerCase();
      return archivedCourse === code || archivedCourse.startsWith(`${code} -`);
    }));
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
    const attendanceScoped = matric ? attendance.filter(a => (a[2] ?? '').toLowerCase() === matric) : attendance;
    for (const a of attendanceScoped) {
      if (!a[7]) continue;
      if (department && (a[4] ?? '').toLowerCase() !== department) continue;
      if (courseCode && (a[5] ?? '').toLowerCase() !== courseCode) continue;
      classes.add(`${a[7]}|${a[5] ?? a[6] ?? ''}`);
    }

    // consecutive absences per (matric, course) — >= 3
    const seq = new Map<string, { last: string; absents: number; max: number; date: string }>();
    const sorted = [...attendanceScoped]
      .filter(a => !department || (a[4] ?? '').toLowerCase() === department)
      .filter(a => !courseCode || (a[5] ?? '').toLowerCase() === courseCode)
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

    return jsonRes({ ok: true, rows, summary });
  } catch (e: any) {
    console.error('get-student-progress error:', e);
    return jsonRes({ ok: false, error: 'Failed to load progress' }, 500);
  }
});
