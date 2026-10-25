import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';

const PROD_ORIGIN = 'https://intervention-fibre-final.pages.dev';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

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
function b64url(bytes: Uint8Array) {
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
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
  const clientId = Deno.env.get('GOOGLE_DRIVE_CLIENT_ID') || '';
  const redirectUri = Deno.env.get('GOOGLE_DRIVE_REDIRECT_URI') || '';
  if (!supabaseUrl || !adminKey || !clientId || !redirectUri) return json({ error: 'Configuration Google incomplète' }, 500);

  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await admin.auth.getUser(bearer);
  if (identityError || !identity?.user) return json({ error: 'Session invalide' }, 401);

  const { data: profile } = await admin.from('profiles').select('active').eq('id', identity.user.id).maybeSingle();
  if (!profile?.active) return json({ error: 'Compte inactif' }, 403);

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = b64url(bytes);
  const stateHash = await sha256(state);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await admin.from('google_backup_oauth_states').delete().eq('user_id', identity.user.id);
  const { error: insertError } = await admin.from('google_backup_oauth_states').insert({
    state_hash: stateHash,
    user_id: identity.user.id,
    expires_at: expiresAt,
  });
  if (insertError) return json({ error: 'Impossible de préparer la connexion Google' }, 500);

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email https://www.googleapis.com/auth/drive.file');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  if (identity.user.email) url.searchParams.set('login_hint', identity.user.email);

  return json({ ok: true, auth_url: url.toString(), expires_at: expiresAt });
});