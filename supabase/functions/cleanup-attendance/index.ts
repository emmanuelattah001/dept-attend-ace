// Deletes attendance rows that are already synced to Google Sheets and older than RETENTION_HOURS
// (default 24). Google Sheets is untouched.
//
// SECURITY: only callable with the service-role key or the CRON_SECRET header. See docs/DEPLOYMENT.md
// for the pg_cron snippet that schedules it.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getCaller, makeAdminClient } from '../_shared/auth.ts';
import { departmentsEligibleForCleanup } from '../_shared/cleanup-eligibility.ts';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = makeAdminClient();

    const cronSecret = Deno.env.get('CRON_SECRET');
    const provided = req.headers.get('x-cron-secret') ?? '';
    const secretOk = !!cronSecret && provided.length === cronSecret.length && provided === cronSecret;
    const caller = await getCaller(req, admin);
    if (!secretOk && !caller.isService) return json({ ok: false, error: 'Forbidden' }, 403);

    const hours = Math.max(1, Number(Deno.env.get('RETENTION_HOURS') ?? 24) || 24);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Sync each configured tenant before pruning records that have reached its archive.
    const [{ data: activeInstitutions, error: institutionError }, { data: integrations, error: integrationError }] = await Promise.all([
      admin.from('institutions').select('id').eq('status', 'active'),
      admin.from('institution_integrations').select('institution_id'),
    ]);
    if (institutionError) throw institutionError;
    if (integrationError) throw integrationError;
    const configuredInstitutions = new Set((integrations ?? []).map((integration) => integration.institution_id));
    const activeConfiguredInstitutionIds = (activeInstitutions ?? [])
      .map((institution) => institution.id)
      .filter((institutionId) => configuredInstitutions.has(institutionId));
    const syncUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sheets-sync`;
    const successfulSyncInstitutionIds = new Set<string>();
    for (const institutionId of activeConfiguredInstitutionIds) {
      const syncResp = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'sync_unsynced', institution_id: institutionId }),
      }).catch((e) => {
        console.log('pre-cleanup institution sync failed; retaining rows:', String(e));
        return null;
      });
      if (syncResp?.ok) successfulSyncInstitutionIds.add(institutionId);
      else console.log('pre-cleanup institution sync failed; retaining rows:', syncResp?.status ?? 'network error');
    }

    const syncedInstitutionIds = activeConfiguredInstitutionIds
      .filter((institutionId) => successfulSyncInstitutionIds.has(institutionId));
    const { data: faculties, error: facultyError } = syncedInstitutionIds.length
      ? await admin.from('faculties').select('id, institution_id').in('institution_id', syncedInstitutionIds)
      : { data: [], error: null };
    if (facultyError) throw facultyError;
    const facultyIds = (faculties ?? []).map((faculty) => faculty.id);
    const { data: departments, error: departmentError } = facultyIds.length
      ? await admin.from('departments').select('id, faculty_id').in('faculty_id', facultyIds)
      : { data: [], error: null };
    if (departmentError) throw departmentError;
    const institutionByFaculty = new Map((faculties ?? []).map((faculty) => [faculty.id, faculty.institution_id]));
    const eligibleDepartmentIds = departmentsEligibleForCleanup(
      activeConfiguredInstitutionIds,
      successfulSyncInstitutionIds,
      (departments ?? []).flatMap((department) => {
        const institutionId = institutionByFaculty.get(department.faculty_id);
        return institutionId ? [{ institutionId, departmentId: department.id }] : [];
      }),
    );
    if (!eligibleDepartmentIds.length) return json({ ok: true, deleted: 0, cutoff, message: 'No institution archive completed a successful sync; attendance was retained.' });

    const { data, error } = await admin
      .from('attendance')
      .delete()
      .in('department_id', eligibleDepartmentIds)
      .lt('created_at', cutoff)
      .eq('synced_to_sheets', true)
      .select('id');
    if (error) throw error;

    console.log(`cleanup-attendance: deleted ${data?.length ?? 0} rows older than ${cutoff}`);
    return json({ ok: true, deleted: data?.length ?? 0, cutoff });
  } catch (e: any) {
    console.error('cleanup-attendance error:', e);
    return json({ ok: false, error: 'Cleanup failed' }, 500);
  }
});
