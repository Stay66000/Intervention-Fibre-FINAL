import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';

const PROD_ORIGIN = 'https://intervention-fibre-final.pages.dev';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const JOURNAL = '_JOURNAL_BACKUP';

function secretKey() {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try { const parsed = JSON.parse(modern); if (parsed?.default) return parsed.default as string; } catch {}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function monthTitle(value?: string | null) {
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const d = value && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value + 'T12:00:00Z') : new Date();
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function q(title: string) { return `'${title.replace(/'/g, "''")}'`; }
async function googleJson(url: string, accessToken: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`GOOGLE_${res.status}:${typeof body === 'string' ? body.slice(0,180) : body?.error?.message || 'request_failed'}`);
  return body;
}
async function writeHeaders(spreadsheetId: string, accessToken: string, month: string) {
  const monthly = [['Date','Référence','Adresse','Typologie','Résultat','Opérateur','Mode','Montant','Commentaire','Complément','Montant complément','Dernière synchro','État','ID FIBRE OPS']];
  const journal = [['Event ID','Action','Horodatage','Date','Référence','Adresse','Typologie','Résultat','Opérateur','Mode','Montant','Commentaire','Complément','Montant complément','État','ID FIBRE OPS']];
  await googleJson(`${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`, accessToken, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: [
      { range: `${q(month)}!A1:N1`, values: monthly },
      { range: `${q(JOURNAL)}!A1:P1`, values: journal },
    ]}),
  });
}
async function ensureCoreSheets(spreadsheetId: string, accessToken: string, currentMonth: string) {
  const meta = await googleJson(`${SHEETS_BASE}/${spreadsheetId}?fields=spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title,hidden)`, accessToken);
  const known: Record<string, number> = {};
  for (const s of meta.sheets || []) known[s.properties.title] = s.properties.sheetId;
  const requests: any[] = [];
  if (!(currentMonth in known)) requests.push({ addSheet: { properties: { title: currentMonth, gridProperties: { frozenRowCount: 1 } } } });
  if (!(JOURNAL in known)) requests.push({ addSheet: { properties: { title: JOURNAL, hidden: true, gridProperties: { frozenRowCount: 1 } } } });
  if (requests.length) {
    await googleJson(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, accessToken, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }),
    });
    const refreshed = await googleJson(`${SHEETS_BASE}/${spreadsheetId}?fields=spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title,hidden)`, accessToken);
    for (const s of refreshed.sheets || []) known[s.properties.title] = s.properties.sheetId;
    meta.spreadsheetUrl = refreshed.spreadsheetUrl;
  }
  await writeHeaders(spreadsheetId, accessToken, currentMonth);
  return { known, spreadsheetUrl: meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}
async function createSpreadsheet(accessToken: string, currentMonth: string) {
  const created = await googleJson(SHEETS_BASE, accessToken, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: 'FIBRE OPS — Sauvegarde interventions' },
      sheets: [
        { properties: { title: currentMonth, gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: JOURNAL, hidden: true, gridProperties: { frozenRowCount: 1 } } },
      ],
    }),
  });
  const known: Record<string, number> = {};
  for (const s of created.sheets || []) known[s.properties.title] = s.properties.sheetId;
  await writeHeaders(created.spreadsheetId, accessToken, currentMonth);
  return { spreadsheetId: created.spreadsheetId as string, spreadsheetUrl: created.spreadsheetUrl as string, known };
}
function redirect(status: 'connected'|'error', detail = '') {
  const url = new URL(PROD_ORIGIN + '/');
  url.searchParams.set('google_backup', status);
  if (detail) url.searchParams.set('google_backup_reason', detail.slice(0, 120));
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('Méthode non autorisée', { status: 405, headers: { 'Cache-Control':'no-store' } });
  const incoming = new URL(req.url);
  if (incoming.searchParams.get('error')) return redirect('error', incoming.searchParams.get('error') || 'authorization_denied');
  const code = incoming.searchParams.get('code') || '';
  const state = incoming.searchParams.get('state') || '';
  if (!code || !state) return redirect('error', 'missing_code_or_state');

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const adminKey = secretKey();
  const clientId = Deno.env.get('GOOGLE_DRIVE_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET') || '';
  const redirectUri = Deno.env.get('GOOGLE_DRIVE_REDIRECT_URI') || '';
  if (!supabaseUrl || !adminKey || !clientId || !clientSecret || !redirectUri) return redirect('error', 'server_config');

  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const stateHash = await sha256(state);
    const { data: savedState, error: stateError } = await admin.from('google_backup_oauth_states')
      .select('user_id,expires_at').eq('state_hash', stateHash).maybeSingle();
    if (stateError || !savedState || new Date(savedState.expires_at).getTime() < Date.now()) return redirect('error', 'state_expired');
    await admin.from('google_backup_oauth_states').delete().eq('state_hash', stateHash);

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, code,
        grant_type: 'authorization_code', redirect_uri: redirectUri,
      }),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.access_token) throw new Error('token_exchange_failed');

    const accessToken = String(tokenBody.access_token);
    const userInfo = await googleJson(USERINFO_URL, accessToken).catch(() => ({}));
    const { data: existingToken } = await admin.from('google_backup_tokens').select('refresh_token').eq('user_id', savedState.user_id).maybeSingle();
    const refreshToken = String(tokenBody.refresh_token || existingToken?.refresh_token || '');
    if (!refreshToken) throw new Error('refresh_token_missing');

    const currentMonth = monthTitle(new Date().toISOString().slice(0,10));
    const { data: existing } = await admin.from('google_backup_connections').select('spreadsheet_id').eq('user_id', savedState.user_id).maybeSingle();

    let spreadsheetId = existing?.spreadsheet_id || '';
    let spreadsheetUrl = '';
    let known: Record<string, number> = {};
    if (spreadsheetId) {
      try {
        const ensured = await ensureCoreSheets(spreadsheetId, accessToken, currentMonth);
        spreadsheetUrl = ensured.spreadsheetUrl; known = ensured.known;
      } catch {
        spreadsheetId = '';
      }
    }
    if (!spreadsheetId) {
      const created = await createSpreadsheet(accessToken, currentMonth);
      spreadsheetId = created.spreadsheetId; spreadsheetUrl = created.spreadsheetUrl; known = created.known;
    }

    const scopes = String(tokenBody.scope || 'openid email https://www.googleapis.com/auth/drive.file').split(/\s+/).filter(Boolean);
    const { error: tokenError } = await admin.from('google_backup_tokens').upsert({
      user_id: savedState.user_id, refresh_token: refreshToken, granted_scopes: scopes, updated_at: new Date().toISOString(),
    });
    if (tokenError) throw new Error('token_store_failed');

    const now = new Date().toISOString();
    const { error: connectionError } = await admin.from('google_backup_connections').upsert({
      user_id: savedState.user_id,
      google_email: userInfo?.email || null,
      spreadsheet_id: spreadsheetId,
      spreadsheet_url: spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      status: 'connected',
      known_sheets: known,
      connected_at: now,
      updated_at: now,
      last_error: null,
      last_error_at: null,
      disconnected_at: null,
    });
    if (connectionError) throw new Error('connection_store_failed');

    await admin.from('google_backup_jobs').update({
      status: 'pending', attempts: 0, next_attempt_at: now, locked_at: null, updated_at: now,
    }).eq('user_id', savedState.user_id).in('status', ['dead']);

    let from = 0;
    const pageSize = 500;
    while (true) {
      const { data: rows, error: rowsError } = await admin.from('interventions').select('*')
        .eq('user_id', savedState.user_id).order('created_at', { ascending: true }).range(from, from + pageSize - 1);
      if (rowsError) throw new Error('backfill_read_failed');
      if (!rows?.length) break;
      const jobs = rows.map((row: any) => ({ user_id: savedState.user_id, intervention_id: row.id, action: 'upsert', snapshot: row }));
      const { error: jobsError } = await admin.from('google_backup_jobs').insert(jobs);
      if (jobsError) throw new Error('backfill_queue_failed');
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return redirect('connected');
  } catch (error) {
    console.error('GOOGLE_BACKUP_CALLBACK', error);
    return redirect('error', error instanceof Error ? error.message : 'callback_failed');
  }
});