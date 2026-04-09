import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is a dept_admin
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check caller is dept_admin
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "dept_admin")
      .single();
    if (!roleData) throw new Error("Only department admins can add students");

    // Get caller's department
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("department_id")
      .eq("user_id", caller.id)
      .single();
    if (!callerProfile?.department_id) throw new Error("You have no department assigned");

    const { students } = await req.json() as {
      students: Array<{ name: string; email: string; gender?: string; matric_no?: string }>;
    };

    if (!students || !Array.isArray(students) || students.length === 0) {
      throw new Error("No students provided");
    }

    if (students.length > 100) {
      throw new Error("Maximum 100 students per batch");
    }

    const results: Array<{ email: string; success: boolean; error?: string }> = [];

    for (const student of students) {
      if (!student.email || !student.name) {
        results.push({ email: student.email || "unknown", success: false, error: "Name and email are required" });
        continue;
      }

      try {
        // Create auth user with a random password
        const tempPassword = crypto.randomUUID();
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
          email: student.email,
          password: tempPassword,
          email_confirm: true,
        });

        if (authError) {
          // If user already exists, try to assign them to department
          if (authError.message?.includes("already been registered")) {
            // Get existing user
            const { data: existingUsers } = await adminClient.auth.admin.listUsers();
            const existingUser = existingUsers?.users?.find(u => u.email === student.email);
            if (existingUser) {
              await adminClient
                .from("profiles")
                .update({
                  department_id: callerProfile.department_id,
                  name: student.name,
                  gender: student.gender || null,
                  matric_no: student.matric_no || null,
                })
                .eq("user_id", existingUser.id);
              results.push({ email: student.email, success: true, error: "Existing user assigned to department" });
            } else {
              results.push({ email: student.email, success: false, error: authError.message });
            }
            continue;
          }
          results.push({ email: student.email, success: false, error: authError.message });
          continue;
        }

        const userId = authData.user.id;

        // Update profile with department, gender, matric_no
        await adminClient
          .from("profiles")
          .update({
            department_id: callerProfile.department_id,
            name: student.name,
            gender: student.gender || null,
            matric_no: student.matric_no || null,
          })
          .eq("user_id", userId);

        results.push({ email: student.email, success: true });
      } catch (e) {
        results.push({ email: student.email, success: false, error: e.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return new Response(
      JSON.stringify({ success: true, created: successCount, total: students.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
