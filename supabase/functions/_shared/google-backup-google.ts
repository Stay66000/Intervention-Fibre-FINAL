export const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets';
export const q=(title:string)=>`'${title.replace(/'/g,"''")}'`;
export function secretKey(){
  const modern=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(modern){try{const parsed=JSON.parse(modern);if(parsed?.default)return parsed.default as string}catch{}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
export async function googleJson(url:string,token:string,init:RequestInit={}){
  const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${token}`);
  headers.set('Content-Type','application/json');
  const res=await fetch(url,{...init,headers,signal:AbortSignal.timeout(10000)});
  const body=await res.json().catch(()=>({}));
  if(!res.ok){const error=new Error(`GOOGLE_${res.status}:${String(body?.error?.message||'request_failed').slice(0,180)}`) as any;error.status=res.status;error.authFailure=res.status===401;throw error}
  return body;
}
export async function refreshAccessToken(refreshToken:string){
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:Deno.env.get('GOOGLE_DRIVE_CLIENT_ID')||'',client_secret:Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET')||'',refresh_token:refreshToken,grant_type:'refresh_token'})});
  const body=await res.json().catch(()=>({}));
  if(!res.ok||!body.access_token){const error=new Error(`TOKEN_REFRESH_${res.status}`) as any;error.authFailure=res.status===401||(res.status===400&&body.error==='invalid_grant');throw error}
  return String(body.access_token);
}
export const batchUpdateValues=(id:string,token:string,data:any[],valueInputOption='USER_ENTERED')=>googleJson(`${SHEETS_BASE}/${id}/values:batchUpdate`,token,{method:'POST',body:JSON.stringify({valueInputOption,data})});
