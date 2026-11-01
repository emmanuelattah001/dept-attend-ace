// Deletes attendance rows that are already synced to Google Sheets and older than RETENTION_HOURS
// (default 24). Google Sheets is untouched.
//
// SECURITY: only callable with the service-role key or the CRON_SECRET header. See docs/DEPLOYMENT.md
// for the pg_cron snippet that schedules it.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getCaller, makeAdminClient } from '../_shared/auth.ts';

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
    const syncUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sheets-sync`;
    for (const { id: institutionId } of (activeInstitutions ?? []).filter((institution) => configuredInstitutions.has(institution.id))) {
      const syncResp = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'sync_unsynced', institution_id: institutionId }),
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
      if (!syncResp.ok) console.log('pre-cleanup institution sync failed; retaining unsynced rows:', syncResp.status);
    }

    const { data, error } = await admin
      .from('attendance')
      .delete()
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
