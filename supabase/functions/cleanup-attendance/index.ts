// Deletes synced attendance rows older than 24h. Google Sheets is untouched.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Best-effort: push anything unsynced first so we don't lose data
    try {
      await admin.functions.invoke('sheets-sync', { body: { action: 'sync_unsynced' } });
    } catch (e) {
      console.log('pre-cleanup sync failed (continuing):', (e as Error).message);
    }

    const { data, error } = await admin
      .from('attendance')
      .delete()
      .lt('created_at', cutoff)
      .eq('synced_to_sheets', true)
      .select('id');
    if (error) throw error;

    console.log(`cleanup-attendance: deleted ${data?.length ?? 0} rows older than ${cutoff}`);
    return new Response(JSON.stringify({ ok: true, deleted: data?.length ?? 0, cutoff }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('cleanup-attendance error:', e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
