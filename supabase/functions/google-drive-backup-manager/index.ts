import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';

import {syncUser,check} from '../_shared/google-backup-sync.ts';

const PROD_ORIGIN = 'https://intervention-fibre-final.pages.dev';

function secretKey() {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try { const parsed = JSON.parse(modern); if (parsed?.default) return parsed.default as string; } catch {}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
function allowedOrigin(origin: string) {
  try {
    const u = new URL(origin);
    return origin === PROD_ORIGIN || (u.protocol === 'https:' && !u.port && u.hostname.endsWith('.intervention-fibre-final.pages.dev'));
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin(origin) ? origin : PROD_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!allowedOrigin(origin)) return json({ error: 'Origine non autorisée' }, 403);
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') || '')?.[1];
  if (!bearer) return json({ error: 'Non authentifié' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const adminKey = secretKey();
  if (!supabaseUrl || !adminKey) return json({ error: 'Configuration serveur manquante' }, 500);
  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await admin.auth.getUser(bearer);
  if (identityError || !identity?.user) return json({ error: 'Session invalide' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body?.action || 'status');
  const userId = identity.user.id;

  if (action === 'status') {
    const [{ data: connection }, pending, dead] = await Promise.all([
      admin.from('google_backup_connections')
        .select('google_email,spreadsheet_url,status,connected_at,last_success_at,last_error_at,last_error,disconnected_at,last_reconciled_at,last_reconcile_report,reconcile_requested')
        .eq('user_id', userId).maybeSingle(),
      admin.from('google_backup_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['pending','processing']),
      admin.from('google_backup_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'dead'),
    ]);
    return json({
      ok: true,
      connection: connection || null,
      pending: (pending.count || 0)+(connection?.reconcile_requested?1:0),
      failed: dead.count || 0,
    });
  }

  if (action === 'reconcile') {
    const {data:connection,error}=await admin.from('google_backup_connections').select('status').eq('user_id',userId).maybeSingle();
    if(error)return json({error:'État Google indisponible'},500);
    if(connection?.status!=='connected')return json({ok:true,disconnected:true});
    check(await admin.from('google_backup_connections').update({reconcile_requested:true,reconcile_attempts:0,reconcile_next_attempt_at:new Date().toISOString()}).eq('user_id',userId));
    const result=await syncUser(admin,userId,true);
    return json(result,result.ok?200:503);
  }

  if (action === 'retry') {
    const { data: connection } = await admin.from('google_backup_connections').select('status').eq('user_id', userId).maybeSingle();
    if (connection?.status !== 'connected') return json({ error: 'Reconnecte Google avant de relancer la sauvegarde.' }, 409);
    const now = new Date().toISOString();
    const { error } = await admin.from('google_backup_jobs').update({
      status: 'pending', attempts: 0, next_attempt_at: now, locked_at: null, last_error: null, updated_at: now,
    }).eq('user_id', userId).in('status', ['dead','pending']);
    if (error) return json({ error: 'Impossible de relancer les sauvegardes' }, 500);
    await admin.rpc('google_backup_wake');
    return json({ ok: true });
  }

  if (action === 'disconnect') {
    check(await admin.from('google_backup_connections').update({status:'disconnected',reconcile_requested:false}).eq('user_id',userId));
    const { data: token } = await admin.from('google_backup_tokens').select('refresh_token').eq('user_id', userId).maybeSingle();
    if (token?.refresh_token) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: token.refresh_token }),
        });
      } catch {}
    }
    const now = new Date().toISOString();
    await admin.from('google_backup_tokens').delete().eq('user_id', userId);
    await admin.from('google_backup_jobs').update({
      status: 'cancelled', locked_at: null, updated_at: now,
    }).eq('user_id', userId).in('status', ['pending','processing','dead']);
    await admin.from('google_backup_connections').update({
      status: 'disconnected', disconnected_at: now, updated_at: now, last_error: null, last_error_at: null,
    }).eq('user_id', userId);
    return json({ ok: true });
  }

  return json({ error: 'Action inconnue' }, 400);
});