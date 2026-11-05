const BASE='https://dvvoqfswlqdwvxamfsot.supabase.co';
const KEY='sb_publishable_DKIrFOlhgvc7LW43_qgLYA_cENm3M-P';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function onRequest(ctx){
  try {
    const {request,env}=ctx, url=new URL(request.url);
    if (!env.FIBRE_PHOTOS || !env.PHOTO_TEST_USERS) return response({error:'Fonction photo non configurée'},503);
    const auth=request.headers.get('authorization')||'';
    if(!/^Bearer [\w.-]+$/.test(auth))return response({error:'Connexion nécessaire'},401);
    const headers={apikey:KEY,authorization:auth};
    const authResponse=await fetch(BASE+'/auth/v1/user',{headers});
    if(!authResponse.ok)return response({error:'Session invalide'},401);
    const identity=await authResponse.json();
    if(!env.PHOTO_TEST_USERS.split(',').map(s=>s.trim()).includes(identity.id))return response({error:'Fonction indisponible'},403);
    if(url.searchParams.get('access')==='1')return response({enabled:true});
    const dossier=url.searchParams.get('intervention'),photo=url.searchParams.get('photo');
    if(!UUID.test(dossier||'')||(photo&&!UUID.test(photo)))return response({error:'Dossier invalide'},400);
    const rowsRes=await fetch(BASE+'/rest/v1/rpc/get_my_independent_interventions',{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}'});
    if(!rowsRes.ok)return response({error:'Vérification des droits impossible'},403);
    const row=(await rowsRes.json()).find(r=>r.id===dossier);
    if(!row)return response({error:'Dossier inaccessible'},403);
    const mode=(row.work_mode||'Personal').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const allowed=mode==='binome' ? !!row.team_id : (row.solo_user_id||row.user_id)===identity.id;
    if(!allowed)return response({error:'Dossier inaccessible'},403);
    const prefix=`test-photos/${dossier}/`, key=prefix+photo;
    if(request.method==='GET' && !photo){let cursor;const files=[];do {const page=await env.FIBRE_PHOTOS.list({prefix,cursor,include:['customMetadata','httpMetadata'],limit:1000});for(const obj of page.objects)files.push({id:obj.key.slice(prefix.length),name:obj.customMetadata?.name||'Photo',size:obj.size,uploaded:obj.uploaded});cursor=page.truncated?page.cursor:undefined;}while(cursor);return response({files});}
    if(request.method==='GET' && photo){const object=await env.FIBRE_PHOTOS.get(key);if(!object)return response({error:'Photo introuvable'},404);const h=new Headers({'cache-control':'private, no-store','x-content-type-options':'nosniff','content-type':object.httpMetadata?.contentType||'application/octet-stream','content-disposition':'attachment'});return new Response(object.body,{headers:h});}
    if(request.method==='PUT' && photo){const type=(request.headers.get('content-type')||'').toLowerCase();if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(type))return response({error:'Format non pris en charge'},415);const length=Number(request.headers.get('content-length'));if(length>25*1024*1024)return response({error:'Photo supérieure à 25 Mo'},413);const bytes=await request.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>25*1024*1024)return response({error:'Photo vide ou supérieure à 25 Mo'},413);const name=(url.searchParams.get('name')||'Photo').slice(0,120).replace(/[^a-zA-Z0-9._ -]/g,'_');await env.FIBRE_PHOTOS.put(key,bytes,{httpMetadata:{contentType:type},customMetadata:{name}});return response({saved:true});}
    if(request.method==='DELETE' && photo){await env.FIBRE_PHOTOS.delete(key);return response({deleted:true});}
    return response({error:'Méthode invalide'},405);
  }catch(error){return response({error:'Opération impossible, réessaie.'},500)}
}
