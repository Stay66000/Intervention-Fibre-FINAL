// Production path, deliberately disabled until PHOTO_STORAGE_MODE=production is set
// on the production Pages environment. The existing preview path is unchanged.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXES=['photos/','test-photos/']; // Preserve existing primary-bucket uploads.
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
function keys(intervention,photo){return PREFIXES.map(prefix=>prefix+intervention+'/'+photo)}
async function rpc(name,body,base,headers){
  const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw Error('Autorisation ou file de nettoyage indisponible');
  return response.json();
}
async function removePhoto(primary,backup,intervention,photo){
  // R2 deletes are idempotent. Every known prefix is removed from both copies.
  await Promise.all([primary.delete(keys(intervention,photo)),backup.delete(keys(intervention,photo))]);
}
async function listPages(bucket,prefix){
  let cursor;const files=[];
  do {
    const page=await bucket.list({prefix,cursor,limit:1000,include:['customMetadata']});
    for(const object of page.objects)files.push(object);
    cursor=page.truncated?page.cursor:undefined;
  } while(cursor);
  return files;
}
export async function onProductionPhotoRequest(ctx,{base,key,validPhoto}){
  try {
    const {request,env}=ctx,url=new URL(request.url);
    if(!env.FIBRE_PHOTOS)return json({error:'Stockage principal non configuré'},503);
    const auth=request.headers.get('authorization')||'';
    if(!/^Bearer [\w.-]+$/.test(auth))return json({error:'Connexion nécessaire'},401);
    const headers={apikey:key,authorization:auth};
    const who=await fetch(base+'/auth/v1/user',{headers});
    if(!who.ok)return json({error:'Session invalide'},401);
    const identity=await who.json();
    if(!UUID.test(identity.id||''))return json({error:'Session invalide'},401);
    const enabled=await rpc('photo_my_access',{},base,headers);
    if(url.searchParams.get('access')==='1')return json({enabled:enabled===true,mode:'production'});
    if(enabled!==true)return json({error:'Option photos désactivée'},403);
    const dossier=url.searchParams.get('intervention'),photo=url.searchParams.get('photo');
    if(!UUID.test(dossier||'')||(photo&&!UUID.test(photo)))return json({error:'Dossier invalide'},400);
    if(await rpc('photo_can_access',{p_intervention_id:dossier},base,headers)!==true)return json({error:'Dossier inaccessible'},403);

    if(request.method==='GET'&&!photo){
      const selected=new Map();
      for(const prefix of PREFIXES){
        for(const item of await listPages(env.FIBRE_PHOTOS,prefix+dossier+'/')){
          const id=item.key.slice(prefix.length+dossier.length+1);
          if(UUID.test(id)&&!selected.has(id))selected.set(id,{id,name:item.customMetadata?.name||'Photo',size:item.size,uploaded:item.uploaded});
        }
      }
      return json({files:[...selected.values()]});
    }
    if(request.method==='GET'&&photo){
      let object=null;
      for(const path of keys(dossier,photo)){object=await env.FIBRE_PHOTOS.get(path);if(object)break;}
      if(!object)return json({error:'Photo introuvable'},404);
      const h=new Headers({'cache-control':'private, no-store','x-content-type-options':'nosniff','content-type':object.httpMetadata?.contentType||'application/octet-stream','content-disposition':'attachment'});
      return new Response(object.body,{headers:h});
    }
    if(request.method==='PUT'&&photo){
      if(!env.FIBRE_PHOTOS_BACKUP)return json({error:'Compartiment de secours non connecté'},503);
      const type=(request.headers.get('content-type')||'').toLowerCase();
      if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(type))return json({error:'Format refusé'},415);
      const size=Number(request.headers.get('content-length'));
      if(size>25*1024*1024)return json({error:'Photo supérieure à 25 Mo'},413);
      const bytes=await request.arrayBuffer();
      if(!bytes.byteLength||bytes.byteLength>25*1024*1024||!validPhoto(bytes,type))return json({error:'Photo vide ou invalide'},415);
      const name=(url.searchParams.get('name')||'Photo').slice(0,120).replace(/[^a-zA-Z0-9._ -]/g,'_');
      const meta={httpMetadata:{contentType:type},customMetadata:{name}};
      const path=keys(dossier,photo)[0];
      // Backup first. An ambiguous primary write is retried using the same UUID.
      // Never silently discard an already-written backup on a timeout.
      await env.FIBRE_PHOTOS_BACKUP.put(path,bytes,meta);
      await env.FIBRE_PHOTOS.put(path,bytes,meta);
      return json({saved:true});
    }
    if(request.method==='DELETE'&&photo){
      if(!env.FIBRE_PHOTOS_BACKUP)return json({error:'Compartiment de secours non connecté'},503);
      // A durable server-side job is created BEFORE attempting either deletion.
      // If one bucket fails, the worker will complete the deletion later.
      if(await rpc('photo_enqueue_delete',{p_intervention_id:dossier,p_photo_id:photo},base,headers)!==true)throw Error('Suppression non autorisée');
      try{await removePhoto(env.FIBRE_PHOTOS,env.FIBRE_PHOTOS_BACKUP,dossier,photo);return json({deleted:true})}
      catch{return json({deleted:false,queued:true},202)}
    }
    return json({error:'Méthode invalide'},405);
  } catch(_error){return json({error:'Opération impossible. Réessaie.'},503)}
}
