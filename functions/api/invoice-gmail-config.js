// OAuth client IDs are public identifiers. Never expose a client secret here.
export async function onRequestGet({env}){
  const id=String(env.GMAIL_OAUTH_CLIENT_ID||'').trim();
  return new Response(JSON.stringify({client_id:/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(id)?id:null}),{
    headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
  });
}
