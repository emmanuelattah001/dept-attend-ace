// Get/set the institution-specific archive and expose its required schema.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SCHEMA = {
  tabs: [
    {
      name: 'Attendance',
      description: 'Append-only log — one row per attendance record.',
      columns: [
        'attendance_id', 'student_name', 'matric_no', 'gender', 'department',
        'course_code', 'course_name', 'attendance_date', 'status', 'synced_at',
      ],
    },
    {
      name: 'Student Progress',
      description: 'One row per (student, course) — recomputed on every sync.',
      columns: [
        'Student Name', 'Matric No', 'Department', 'Course',
        'Total Present', 'Total Absent', 'Total Classes',
        'Attendance Percentage', 'Last Attendance Date', 'Last Status',
      ],
    },
  ],
};

// Extract the spreadsheet ID from either a raw ID or a full Google Sheets URL.
function extractSheetId(input: string): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: uerr } = await sb.auth.getUser();
    if (uerr || !userData?.user) return json({ error: 'Unauthorized' }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action: 'get' | 'set' = body.action || 'get';
    const [{ data: roles }, { data: membership }] = await Promise.all([
      admin.from('user_roles').select('role').eq('user_id', uid),
      admin.from('hierarchy_memberships').select('institution_id, role').eq('user_id', uid).maybeSingle(),
    ]);
    const isSuperAdmin = (roles ?? []).some((row: any) => row.role === 'super_admin');
    const requestedInstitution = String(body.institutionId ?? '').trim();
    const institutionId = isSuperAdmin
      ? requestedInstitution
      : membership?.role === 'institution_admin'
        ? membership.institution_id
        : '';
    if (!institutionId) {
      return json({ error: 'Only a super administrator or this institution’s administrator can configure its archive.' }, 403);
    }
    if (requestedInstitution && requestedInstitution !== institutionId) {
      return json({ error: 'You cannot configure another institution’s archive.' }, 403);
    }

    const { data: institution, error: institutionError } = await admin
      .from('institutions')
      .select('id, name, status')
      .eq('id', institutionId)
      .maybeSingle();
    if (institutionError) throw institutionError;
    if (!institution || institution.status !== 'active') {
      return json({ error: 'Institution is not active.' }, 404);
    }

    if (action === 'get') {
      const { data, error } = await admin
        .from('institution_integrations')
        .select('google_sheet_id')
        .eq('institution_id', institutionId)
        .maybeSingle();
      if (error) throw error;
      const sheetId = data?.google_sheet_id ?? null;
      return json({
        ok: true,
        institutionId,
        institutionName: institution.name,
        sheetId,
        sheetUrl: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}` : null,
        schema: SCHEMA,
        serviceAccountConfigured: !!Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON'),
        canManage: isSuperAdmin || membership?.role === 'institution_admin',
      });
    }

    if (action === 'set') {
      const id = extractSheetId(String(body.sheetId ?? ''));
      if (!id) return json({ ok: false, error: 'Invalid spreadsheet ID or URL' }, 400);
      const { error } = await admin.from('institution_integrations')
        .upsert({
          institution_id: institutionId,
          google_sheet_id: id,
          configured_by: uid,
        }, { onConflict: 'institution_id' });
      if (error) throw error;
      return json({ ok: true, institutionId, sheetId: id, sheetUrl: `https://docs.google.com/spreadsheets/d/${id}` });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e: any) {
    console.error('sheets-settings error:', e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
