import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const JOURNAL = '_JOURNAL_BACKUP';
const RETRY_SECONDS = [60, 300, 900, 3600];

function secretKey() {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try { const parsed = JSON.parse(modern); if (parsed?.default) return parsed.default as string; } catch {}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
function monthTitle(value?: string | null) {
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const d = value && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value + 'T12:00:00Z') : new Date();
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function q(title: string) { return `'${title.replace(/'/g, "''")}'`; }
function compactText(value: unknown, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function numberValue(value: unknown) {
  const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0;
}
function operatorLabel(value: unknown) {
  const key = String(value || '').toLowerCase();
  return ({ orange:'Orange', sfr:'SFR', bouygues:'Bouygues Telecom', free:'Free' } as Record<string,string>)[key] || compactText(value, 80);
}
function workMode(snapshot: any) {
  if (snapshot?.work_mode === 'Binôme') return 'Binôme';
  if (snapshot?.work_mode === 'Solo') return 'Solo';
  return 'Personnel';
}
function supplement(snapshot: any) {
  const data = snapshot?.operator_data && typeof snapshot.operator_data === 'object' ? snapshot.operator_data : {};
  const label = compactText(data.supplement_comment ?? data.supplement_label ?? data.supplement ?? '', 200);
  const amount = numberValue(data.supplement_amount ?? 0);
  return { label, amount };
}
function monthlyRow(snapshot: any, state: string) {
  const supp = supplement(snapshot);
  return [
    compactText(snapshot?.intervention_date, 20),
    compactText(snapshot?.reference, 120),
    compactText(snapshot?.address, 400),
    compactText(snapshot?.intervention_type_name, 160),
    compactText(snapshot?.result, 80),
    operatorLabel(snapshot?.operator),
    workMode(snapshot),
    numberValue(snapshot?.applied_amount),
    compactText(snapshot?.notes, 500),
    supp.label,
    supp.amount,
    new Date().toISOString(),
    state,
    compactText(snapshot?.id, 80),
  ];
}
function journalRow(job: any, state: string) {
  const row = monthlyRow(job.snapshot, state);
  return [job.id, job.action, new Date().toISOString(), ...row.slice(0, 11), state, row[13]];
}

async function googleJson(url: string, accessToken: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const message = typeof body === 'string' ? body.slice(0, 200) : body?.error?.message || 'request_failed';
    const err = new Error(`GOOGLE_${res.status}:${message}`) as Error & { status?: number };
    err.status = res.status; throw err;
  }
  return body;
}
async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get('GOOGLE_DRIVE_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret) throw new Error('GOOGLE_OAUTH_CONFIG_MISSING');
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.access_token) {
    const err = new Error(`TOKEN_REFRESH_${res.status}`) as Error & { authFailure?: boolean };
    err.authFailure = res.status === 400 || res.status === 401; throw err;
  }
  return String(body.access_token);
}
async function getValues(spreadsheetId: string, accessToken: string, range: string) {
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const data = await googleJson(url, accessToken);
  return Array.isArray(data?.values) ? data.values as any[][] : [];
}
async function appendValues(spreadsheetId: string, accessToken: string, range: string, values: any[][]) {
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return googleJson(url, accessToken, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({values}),
  });
}
async function updateValues(spreadsheetId: string, accessToken: string, range: string, values: any[][]) {
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  return googleJson(url, accessToken, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({values}),
  });
}
async function ensureSheet(admin: any, connection: any, accessToken: string, title: string, hidden = false) {
  const known = connection.known_sheets && typeof connection.known_sheets === 'object' ? { ...connection.known_sheets } : {};
  if (known[title] != null) return known;
  const result = await googleJson(`${SHEETS_BASE}/${connection.spreadsheet_id}:batchUpdate`, accessToken, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({requests:[{addSheet:{properties:{title,hidden,gridProperties:{frozenRowCount:1}}}}]}),
  });
  const props = result?.replies?.[0]?.addSheet?.properties;
  if (props?.sheetId != null) known[title] = props.sheetId;
  await admin.from('google_backup_connections').update({ known_sheets:known, updated_at:new Date().toISOString() }).eq('user_id', connection.user_id);
  connection.known_sheets = known;
  if (title === JOURNAL) {
    await updateValues(connection.spreadsheet_id, accessToken, `${q(JOURNAL)}!A1:P1`, [[
      'Event ID','Action','Horodatage','Date','Référence','Adresse','Typologie','Résultat','Opérateur','Mode','Montant','Commentaire','Complément','Montant complément','État','ID FIBRE OPS'
    ]]);
  } else {
    await updateValues(connection.spreadsheet_id, accessToken, `${q(title)}!A1:N1`, [[
      'Date','Référence','Adresse','Typologie','Résultat','Opérateur','Mode','Montant','Commentaire','Complément','Montant complément','Dernière synchro','État','ID FIBRE OPS'
    ]]);
  }
  return known;
}
async function journalContains(connection: any, accessToken: string, jobId: string) {
  const values = await getValues(connection.spreadsheet_id, accessToken, `${q(JOURNAL)}!A2:A`);
  return values.some(row => String(row?.[0] || '') === jobId);
}
async function findMonthlyRow(connection: any, accessToken: string, month: string, interventionId: string) {
  const values = await getValues(connection.spreadsheet_id, accessToken, `${q(month)}!N2:N`);
  const idx = values.findIndex(row => String(row?.[0] || '') === interventionId);
  return idx < 0 ? null : idx + 2;
}
async function markDone(admin: any, job: any) {
  const now = new Date().toISOString();
  await Promise.all([
    admin.from('google_backup_jobs').update({status:'done',locked_at:null,completed_at:now,last_error:null,updated_at:now}).eq('id',job.id),
    admin.from('google_backup_connections').update({status:'connected',last_success_at:now,last_error:null,last_error_at:null,updated_at:now}).eq('user_id',job.user_id),
  ]);
}
async function markFailed(admin: any, job: any, error: unknown, authFailure = false) {
  const now = new Date();
  const message = compactText(error instanceof Error ? error.message : error, 400) || 'Sauvegarde Google impossible';
  const attempts = Number(job.attempts || 1);
  const dead = authFailure || attempts >= 5;
  const delay = RETRY_SECONDS[Math.min(Math.max(attempts - 1, 0), RETRY_SECONDS.length - 1)] || 3600;
  await admin.from('google_backup_jobs').update({
    status: dead ? 'dead' : 'pending',
    locked_at: null,
    next_attempt_at: new Date(now.getTime() + delay * 1000).toISOString(),
    last_error: message,
    updated_at: now.toISOString(),
  }).eq('id',job.id);
  await admin.from('google_backup_connections').update({
    status: authFailure ? 'error' : 'connected',
    last_error: message,
    last_error_at: now.toISOString(),
    updated_at: now.toISOString(),
  }).eq('user_id',job.user_id);
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if (req.method !== 'POST') return json({error:'Méthode non autorisée'},405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const adminKey = secretKey();
  if (!supabaseUrl || !adminKey) return json({error:'Configuration serveur manquante'},500);
  const admin = createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});

  const {data:workerConfig,error:workerConfigError} = await admin.from('google_backup_worker_config').select('worker_secret').eq('singleton',true).maybeSingle();
  if (workerConfigError || !workerConfig?.worker_secret) return json({error:'Worker non configuré'},503);
  if ((req.headers.get('x-fibre-worker') || '') !== workerConfig.worker_secret) return json({error:'Accès refusé'},403);

  const {data:jobs,error:claimError} = await admin.rpc('claim_google_backup_jobs',{p_limit:12});
  if (claimError) return json({error:'File de sauvegarde indisponible'},500);
  if (!jobs?.length) return json({ok:true,processed:0});

  const tokenCache = new Map<string,string>();
  let success = 0, failed = 0;
  for (const job of jobs) {
    try {
      const [{data:connection},{data:token}] = await Promise.all([
        admin.from('google_backup_connections').select('user_id,spreadsheet_id,known_sheets,status').eq('user_id',job.user_id).maybeSingle(),
        admin.from('google_backup_tokens').select('refresh_token').eq('user_id',job.user_id).maybeSingle(),
      ]);
      if (!connection || connection.status !== 'connected' || !connection.spreadsheet_id || !token?.refresh_token) throw new Error('GOOGLE_CONNECTION_MISSING');

      let accessToken = tokenCache.get(job.user_id);
      if (!accessToken) {
        try { accessToken = await refreshAccessToken(token.refresh_token); }
        catch (error) { await markFailed(admin,job,error,true); failed++; continue; }
        tokenCache.set(job.user_id,accessToken);
      }

      const month = monthTitle(job.snapshot?.intervention_date);
      await ensureSheet(admin,connection,accessToken,JOURNAL,true);
      await ensureSheet(admin,connection,accessToken,month,false);

      if (!(await journalContains(connection,accessToken,String(job.id)))) {
        const state = job.action === 'delete' ? 'Supprimée dans FIBRE OPS' : 'Active';
        await appendValues(connection.spreadsheet_id,accessToken,`${q(JOURNAL)}!A:P`,[journalRow(job,state)]);
      }

      const interventionId = compactText(job.intervention_id || job.snapshot?.id,80);
      const rowNumber = await findMonthlyRow(connection,accessToken,month,interventionId);
      const state = job.action === 'delete' ? 'Supprimée dans FIBRE OPS' : 'Active';
      const row = monthlyRow(job.snapshot,state);
      if (rowNumber) await updateValues(connection.spreadsheet_id,accessToken,`${q(month)}!A${rowNumber}:N${rowNumber}`,[row]);
      else await appendValues(connection.spreadsheet_id,accessToken,`${q(month)}!A:N`,[row]);

      await markDone(admin,job); success++;
    } catch (error) {
      const status = (error as any)?.status;
      const authFailure = status === 401 || String((error as any)?.message || '').startsWith('TOKEN_REFRESH_');
      await markFailed(admin,job,error,authFailure); failed++;
    }
  }
  return json({ok:true,processed:jobs.length,success,failed});
});