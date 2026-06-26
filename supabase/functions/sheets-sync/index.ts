// Google Sheets sync edge function
// Actions: append (records[]), sync_unsynced, export_all
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SHEET_TAB = 'Attendance';
const HEADER_ROW = ['student_id', 'student_name', 'date', 'status', 'marked_by'];
const SHEET_RANGE = `${SHEET_TAB}!A:E`;
const HEADER_RANGE = `${SHEET_TAB}!A1:E1`;

// ---------- Google auth (service account JWT -> access token) ----------
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(serviceAccount: any): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)));
  const jwt = `${signingInput}.${base64UrlEncode(sig)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Google token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ---------- Sheets helpers ----------
async function createSpreadsheet(token: string, title: string): Promise<string> {
  const resp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: SHEET_TAB } }],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheets create failed: ${JSON.stringify(data)}`);
  const id = data.spreadsheetId as string;

  // Write header row
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${SHEET_TAB}!A1:I1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADER_ROW] }),
  });
  return id;
}

async function appendRows(token: string, spreadsheetId: string, rows: any[][]) {
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_RANGE}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    },
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheets append failed: ${JSON.stringify(data)}`);
  return data;
}

async function ensureHeader(token: string, spreadsheetId: string) {
  // Read row 1
  const getResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${HEADER_RANGE}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const getData = await getResp.json();
  if (!getResp.ok) throw new Error(`Sheets header read failed: ${JSON.stringify(getData)}`);
  const current: string[] = getData.values?.[0] ?? [];
  const matches = HEADER_ROW.every((h, i) => current[i] === h);
  if (matches) return;
  const putResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${HEADER_RANGE}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [HEADER_ROW] }),
    },
  );
  const putData = await putResp.json();
  if (!putResp.ok) throw new Error(`Sheets header write failed: ${JSON.stringify(putData)}`);
}

// ---------- Main ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
    const serviceAccount = JSON.parse(saJson);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));
    const action: 'append' | 'sync_unsynced' | 'export_all' = body.action || 'sync_unsynced';

    // Pick records
    let query = admin
      .from('attendance')
      .select('id, date, status, created_at, synced_to_sheets, students:student_ref(name, matric_no), courses:course_id(name, code), departments:department_id(name)')
      .order('date', { ascending: true });

    if (action === 'append' && Array.isArray(body.ids) && body.ids.length) {
      query = query.in('id', body.ids);
    } else if (action === 'sync_unsynced') {
      query = query.eq('synced_to_sheets', false);
    }
    // export_all -> no filter

    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0, message: 'No records to sync' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve spreadsheet ID
    const accessToken = await getAccessToken(serviceAccount);
    const { data: settingRow } = await admin.from('app_settings').select('value').eq('key', 'google_sheet_id').maybeSingle();
    let spreadsheetId: string | undefined = settingRow?.value?.id ?? Deno.env.get('GOOGLE_SHEET_ID') ?? undefined;

    if (!spreadsheetId) {
      try {
        spreadsheetId = await createSpreadsheet(accessToken, `Attendance Archive — ${new Date().toISOString().slice(0, 10)}`);
        await admin.from('app_settings').upsert({ key: 'google_sheet_id', value: { id: spreadsheetId, created_at: new Date().toISOString() } });
      } catch (e) {
        const sa = serviceAccount.client_email ?? 'your service account';
        throw new Error(
          `Could not auto-create a spreadsheet (service accounts have no Drive quota). ` +
          `Create a Google Sheet in your own Drive, share it with ${sa} as Editor, ` +
          `then either set the GOOGLE_SHEET_ID secret to its ID or insert it into app_settings ` +
          `(key='google_sheet_id', value={"id":"<SHEET_ID>"}). Original error: ${(e as Error).message}`
        );
      }
    }

    const values = rows.map((r: any) => [
      r.id,
      r.date,
      r.students?.name ?? '',
      r.students?.matric_no ?? '',
      r.courses?.code ?? '',
      r.courses?.name ?? '',
      r.departments?.name ?? '',
      r.status,
      r.created_at ?? '',
    ]);

    await appendRows(accessToken, spreadsheetId, values);

    // Mark synced
    const ids = rows.map((r: any) => r.id);
    await admin
      .from('attendance')
      .update({ synced_to_sheets: true, synced_at: new Date().toISOString() })
      .in('id', ids);

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    return new Response(JSON.stringify({ ok: true, synced: ids.length, spreadsheetId, spreadsheetUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('sheets-sync error:', e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
