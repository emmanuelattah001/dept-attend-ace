import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getCaller, makeAdminClient, rateLimited, clientIp } from '../_shared/auth.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  try {
    if (rateLimited(`attendance-lookup:${clientIp(req)}`, 30)) {
      return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const matric = String(body.matric_no ?? '').trim();
    const institutionId = String(body.institution_id ?? '').trim();
    if (!/^[A-Za-z0-9-]{4,30}$/.test(matric)) {
      return json({ ok: false, error: 'Enter a valid matric number.' }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institutionId)) {
      return json({ ok: false, error: 'Select a valid institution.' }, 400);
    }

    const admin = makeAdminClient();
    const caller = await getCaller(req, admin);
    if (!caller.userId) return json({ ok: false, error: 'Sign in with your student account to view attendance.' }, 401);

    const { data: student, error: studentError } = await admin
      .from('students')
      .select('id, matric_no, department_id')
      .eq('auth_user_id', caller.userId)
      .maybeSingle();
    if (studentError) throw studentError;
    if (!student || String(student.matric_no ?? '').trim().toLowerCase() !== matric.toLowerCase()) {
      return json({ ok: false, error: 'You can only view attendance linked to your student account.' }, 403);
    }

    const { data: studentDepartment, error: studentDepartmentError } = await admin
      .from('departments')
      .select('faculty_id')
      .eq('id', student.department_id)
      .maybeSingle();
    if (studentDepartmentError) throw studentDepartmentError;
    const { data: studentFaculty, error: studentFacultyError } = studentDepartment?.faculty_id
      ? await admin.from('faculties').select('institution_id').eq('id', studentDepartment.faculty_id).maybeSingle()
      : { data: null, error: null };
    if (studentFacultyError) throw studentFacultyError;
    if (studentFaculty?.institution_id !== institutionId) {
      return json({ ok: false, error: 'You can only view attendance from your institution.' }, 403);
    }

    const { data: institution, error: institutionError } = await admin
      .from('institutions')
      .select('id')
      .eq('id', institutionId)
      .eq('status', 'active')
      .maybeSingle();
    if (institutionError) throw institutionError;
    if (!institution) return json({ ok: false, error: 'Institution is not active or does not exist.' }, 404);

    const { data: faculties, error: facultyError } = await admin
      .from('faculties')
      .select('id')
      .eq('institution_id', institutionId);
    if (facultyError) throw facultyError;
    const facultyIds = (faculties ?? []).map((faculty) => faculty.id);
    if (!facultyIds.length) return json({ ok: true, rows: [] });

    const { data: departments, error: departmentError } = await admin
      .from('departments')
      .select('id')
      .in('faculty_id', facultyIds);
    if (departmentError) throw departmentError;
    const departmentIds = (departments ?? []).map((department) => department.id);
    if (!departmentIds.length) return json({ ok: true, rows: [] });

    const pageSize = 1000;
    const rows: { attendance_date: string; status: string; department_name: string }[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .from('attendance')
        .select('date, status, departments:department_id(name)')
        .eq('student_ref', student.id)
        .in('department_id', departmentIds)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...(data ?? []).map((record) => ({
        attendance_date: record.date,
        status: record.status,
        department_name: (record.departments as { name?: string } | null)?.name ?? '',
      })));
      if (!data || data.length < pageSize) break;
    }
    return json({ ok: true, rows });
  } catch (error) {
    console.error('attendance-lookup error:', error);
    return json({ ok: false, error: 'Unable to load attendance records.' }, 500);
  }
});
