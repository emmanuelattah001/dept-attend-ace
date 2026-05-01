// Temp helper: creates confirmed test users with given role, returns access tokens.
// Used only for end-to-end RLS testing. Safe to delete afterward.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { role = "student", department_id = null, cleanup_user_id = null } =
      await req.json().catch(() => ({}));

    if (cleanup_user_id) {
      await admin.auth.admin.deleteUser(cleanup_user_id);
      return new Response(JSON.stringify({ ok: true, deleted: cleanup_user_id }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const email = `rlstest_${role}_${Date.now()}@gmail.com`;
    const password = "TestPass123!Aa";
    const { data: created, error: cerr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name: `RLS ${role}` },
    });
    if (cerr) throw cerr;
    const uid = created.user!.id;

    // The handle_new_user trigger inserts a default 'student' role row.
    // Update role + optionally department_id.
    if (role !== "student") {
      await admin.from("user_roles").update({ role }).eq("user_id", uid);
    }
    if (department_id) {
      await admin.from("profiles").update({ department_id }).eq("user_id", uid);
    }

    // Sign in to get a real access token
    const anonClient = createClient(url, anon, { auth: { persistSession: false } });
    const { data: signin, error: serr } = await anonClient.auth.signInWithPassword({ email, password });
    if (serr) throw serr;

    return new Response(JSON.stringify({
      user_id: uid, email, access_token: signin.session?.access_token,
    }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
