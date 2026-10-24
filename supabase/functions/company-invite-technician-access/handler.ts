const PROD_ORIGIN = 'https://intervention-fibre-final.pages.dev';
export function allowedOrigin(origin: string) {
  try {
    const u = new URL(origin);
    return origin === PROD_ORIGIN || (u.protocol === 'https:' && !u.port && u.hostname.endsWith('.intervention-fibre-final.pages.dev'));
  } catch { return false; }
}

export function createInviteHandler(createClient: any, env: (name: string) => string | undefined) {
  return async (req: Request) => {
    const origin = req.headers.get('Origin') || '';
    const headers = {
      'Access-Control-Allow-Origin': allowedOrigin(origin) ? origin : PROD_ORIGIN,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!allowedOrigin(origin)) return json({ error: 'Origine non autorisée' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') || '')?.[1];
    if (!token) return json({ error: 'Non authentifié' }, 401);
    if (!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Contenu JSON requis' }, 415);
    let attemptId: string | null = null, newId: string | null = null, admin: any;
    try {
      const reader = req.body?.getReader();
      if (!reader) return json({ error: 'Corps requis' }, 400);
      const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) { await reader.cancel(); return json({ error: 'Requête trop volumineuse' }, 413); }
        chunks.push(value);
      }
      const buffer = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      let body: any;
      try { body = JSON.parse(new TextDecoder().decode(buffer)); } catch { return json({ error: 'JSON invalide' }, 400); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return json({ error: 'Objet JSON requis' }, 400);
      if (typeof body.email !== 'string' || typeof body.first_name !== 'string' ||
          (body.last_name != null && typeof body.last_name !== 'string') ||
          (body.hide_prices != null && typeof body.hide_prices !== 'boolean')) return json({ error: 'Paramètres invalides' }, 400);
      const email = body.email.trim().toLowerCase(), first = body.first_name.trim(), last = (body.last_name || '').trim();
      const employmentType = body.employment_type ?? 'auto';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !first || first.length > 80 || last.length > 80 || !['auto', 'salaried'].includes(employmentType)) return json({ error: 'Paramètres invalides' }, 400);
      const url = env('SUPABASE_URL'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY'), publicKey = env('SUPABASE_ANON_KEY');
      if (!url || !serviceKey || !publicKey) throw new Error('Configuration manquante');
      const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
      admin = createClient(url, serviceKey, options);
      const { data: identity, error: authError } = await admin.auth.getUser(token);
      if (authError || !identity?.user) return json({ error: 'Session invalide' }, 401);
      // SQL derives the actor and company from the caller JWT.
      const caller = createClient(url, publicKey, { ...options, global: { headers: { Authorization: 'Bearer ' + token } } });
      const { data: reservation, error: reserveError } = await caller.rpc('reserve_company_technician_invitation', { p_email: email });
      if (reserveError) {
        const status = reserveError.code === '42501' ? 403 : reserveError.code === '23505' ? 409 : reserveError.code === 'P0001' ? 429 : 400;
        return json({ error: status === 429 ? 'Limite d’invitations atteinte. Réessaie plus tard.' : status === 403 ? 'Accès société refusé' : 'Invitation impossible pour cette adresse.' }, status);
      }
      if (!reservation?.attempt_id) throw new Error('Réservation invalide');
      attemptId = reservation.attempt_id;
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { first_name: first, last_name: last, invited_by_company: true, fibre_invitation_id: attemptId },
        redirectTo: PROD_ORIGIN + '/?invite=1',
      });
      if (inviteError || !invited?.user) throw new Error('Envoi invitation impossible');
      newId = invited.user.id;
      const hidePrices = employmentType === 'salaried' && body.hide_prices === true;
      const { error: finalizeError } = await admin.rpc('finalize_company_technician_invitation', {
        p_attempt_id: attemptId, p_user_id: newId, p_first_name: first, p_last_name: last,
        p_employment_type: employmentType, p_hide_prices: hidePrices,
      });
      if (finalizeError) throw new Error('Finalisation impossible');
      return json({ ok: true, email, invitation_sent: true, company_name: reservation.company_name, employment_type: employmentType, hide_prices: hidePrices });
    } catch {
      if (attemptId && admin) {
        try {
          const { data: ownedUser, error: abortError } = await admin.rpc('abort_company_technician_invitation', { p_attempt_id: attemptId, p_user_id: newId });
          if (abortError) console.error('INVITATION_ABORT_FAILED', attemptId);
          else if (ownedUser) {
            const { error: deleteError } = await admin.auth.admin.deleteUser(ownedUser);
            if (deleteError) console.error('INVITATION_AUTH_CLEANUP_FAILED', attemptId);
          }
        } catch { console.error('INVITATION_CLEANUP_FAILED', attemptId); }
      }
      return json({ error: 'Invitation non finalisée. Réessaie plus tard.', request_id: attemptId }, 500);
    }
  };
}
