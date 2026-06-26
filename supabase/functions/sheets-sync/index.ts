// Google Sheets sync edge function
// Actions: append (records[]), sync_unsynced, export_all
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SHEET_TAB = 'Attendance';
const HEADER_ROW = ['student_id', 'student_name', 'date', 'status', 'marked_by'];

function quoteSheetName(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function sheetRange(title: string, range: string): string {
  return `${quoteSheetName(title)}!${range}`;
}

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
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${sheetRange(SHEET_TAB, 'A1:E1')}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [HEADER_ROW] }),
  });
  return id;
}

async function appendRows(token: string, spreadsheetId: string, tabTitle: string, rows: any[][]) {
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetRange(tabTitle, 'A:E')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
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

async function clearSheetRows(token: string, spreadsheetId: string, tabTitle: string) {
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetRange(tabTitle, 'A:E')}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheets clear failed: ${JSON.stringify(data)}`);
}

async function writeRows(token: string, spreadsheetId: string, tabTitle: string, rows: any[][]) {
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetRange(tabTitle, 'A1:E' + rows.length)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    },
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Sheets write failed: ${JSON.stringify(data)}`);
}

async function getTargetSheetTitle(token: string, spreadsheetId: string): Promise<string> {
  const metaResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const meta = await metaResp.json();
  if (!metaResp.ok) throw new Error(`Sheets metadata read failed: ${JSON.stringify(meta)}`);
  const titles: string[] = (meta.sheets ?? []).map((s: any) => s.properties?.title).filter(Boolean);

  // Use the first visible tab in the user's spreadsheet, so the sheet they opened
  // (usually gid=0) is populated instead of silently writing to a new tab.
  if (titles.length) return titles[0];

  const addResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] }),
    },
  );
  const addData = await addResp.json();
  if (!addResp.ok) throw new Error(`Sheets tab create failed: ${JSON.stringify(addData)}`);
  return SHEET_TAB;
}

async function ensureHeader(token: string, spreadsheetId: string, tabTitle: string) {
  // Read row 1
  const getResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetRange(tabTitle, 'A1:E1')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const getData = await getResp.json();
  if (!getResp.ok) throw new Error(`Sheets header read failed: ${JSON.stringify(getData)}`);
  const current: string[] = getData.values?.[0] ?? [];
  const matches = HEADER_ROW.every((h, i) => current[i] === h);
  if (matches) return;
  const putResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetRange(tabTitle, 'A1:E1')}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [HEADER_ROW] }),
    },
  );
  const putData = await putResp.json();
  if (!putResp.ok) throw new Error(`Sheets header write failed: ${JSON.stringify(putData)}`);
}

async function fetchAttendanceRows(admin: any, action: string, ids?: string[]) {
  const pageSize = 1000;
  let from = 0;
  const allRows: any[] = [];

  while (true) {
    let query = admin
      .from('attendance')
      .select('id, date, status, created_at, marked_by, synced_to_sheets, student_ref, students:student_ref(name, matric_no)')
      .order('date', { ascending: true })
      .range(from, from + pageSize - 1);

    if (action === 'append' && Array.isArray(ids) && ids.length) {
      query = query.in('id', ids);
    } else if (action === 'sync_unsynced') {
      query = query.eq('synced_to_sheets', false);
    }

    const { data, error } = await query;
    if (error) throw error;

    allRows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return allRows.sort((a, b) => {
    const byDate = String(a.date ?? '').localeCompare(String(b.date ?? ''));
    if (byDate !== 0) return byDate;
    const byName = String(a.students?.name ?? '').localeCompare(String(b.students?.name ?? ''));
    if (byName !== 0) return byName;
    return String(a.status ?? '').localeCompare(String(b.status ?? ''));
  });
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

    const rows = await fetchAttendanceRows(admin, action, body.ids);

    // Resolve marked_by -> profile name
    const markerIds = Array.from(new Set(rows.map((r: any) => r.marked_by).filter(Boolean)));
    const markerMap = new Map<string, string>();
    if (markerIds.length) {
      const { data: markers } = await admin.from('profiles').select('user_id, name, email').in('user_id', markerIds);
      for (const m of markers ?? []) markerMap.set(m.user_id, m.name || m.email || m.user_id);
    }

    // Resolve spreadsheet ID
    const accessToken = await getAccessToken(serviceAccount);
    const { data: settingRow } = await admin.from('app_settings').select('value').eq('key', 'google_sheet_id').maybeSingle();
    let spreadsheetId: string | undefined = (settingRow?.value as any)?.id ?? Deno.env.get('GOOGLE_SHEET_ID') ?? undefined;

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

    const targetSheetTitle = await getTargetSheetTitle(accessToken, spreadsheetId);

    // Make sure the header row matches the expected columns on the visible sheet tab.
    await ensureHeader(accessToken, spreadsheetId, targetSheetTitle);

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0, spreadsheetId, sheet: targetSheetTitle, message: 'No records to sync' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const values = rows.map((r: any) => [
      r.students?.matric_no ?? r.student_ref ?? '',
      r.students?.name ?? '',
      r.date,
      r.status,
      markerMap.get(r.marked_by) ?? r.marked_by ?? '',
    ]);

    if (action === 'export_all') {
      await clearSheetRows(accessToken, spreadsheetId, targetSheetTitle);
      await writeRows(accessToken, spreadsheetId, targetSheetTitle, [HEADER_ROW, ...values]);
    } else {
      await appendRows(accessToken, spreadsheetId, targetSheetTitle, values);
    }

    // Mark synced
    const ids = rows.map((r: any) => r.id);
    await admin
      .from('attendance')
      .update({ synced_to_sheets: true, synced_at: new Date().toISOString() })
      .in('id', ids);

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    return new Response(JSON.stringify({ ok: true, synced: ids.length, spreadsheetId, spreadsheetUrl, sheet: targetSheetTitle }), {
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
