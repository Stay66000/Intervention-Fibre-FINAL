// STAGED ONLY: never deploy this as an active cron before explicit approval.
// All writes/deletes are gated by separate explicit environment flags.
const PREFIXES=['photos/','test-photos/']; // Existing primary objects remain accessible.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function expiresAt(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw Error('Invalid photo timestamp');
  const year=date.getUTCFullYear(),month=date.getUTCMonth()+6,day=date.getUTCDate();
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return Date.UTC(year,month,Math.min(day,last),date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds());
}
async function listAll(bucket,prefix){
  const out=[];let cursor;
  do {
    const page=await bucket.list({prefix,cursor,include:['customMetadata','httpMetadata'],limit:1000});
    out.push(...page.objects);
    cursor=page.truncated?page.cursor:undefined;
  } while(cursor);
  return out;
}
async function deleteKeys(bucket,keys){
  for(let index=0;index<keys.length;index+=200)await bucket.delete(keys.slice(index,index+200));
}
async function performJob(env,job){
  if(!UUID.test(job.intervention_id||'')||(job.photo_id&&!UUID.test(job.photo_id)))throw Error('Malformed cleanup job');
  const buckets=[env.FIBRE_PHOTOS,env.FIBRE_PHOTOS_BACKUP];
  for(const bucket of buckets){
    for(const prefix of PREFIXES){
      const folder=prefix+job.intervention_id+'/';
      if(job.photo_id)await bucket.delete(folder+job.photo_id);
      else await deleteKeys(bucket,(await listAll(bucket,folder)).map(x=>x.key));
    }
  }
}
async function callJobs(env,done){
  const url=env.SUPABASE_URL,token=env.SUPABASE_PUBLISHABLE_KEY;
  const secret=env.PHOTO_PRODUCTION_WORKER_SECRET;
  if(!url||!token||!secret)throw Error('Maintenance credentials not configured');
  const response=await fetch(url+'/rest/v1/rpc/photo_production_cleanup_jobs',{
    method:'POST',headers:{apikey:token,'content-type':'application/json'},
    body:JSON.stringify({p_secret:secret,p_done:done||null})
  });
  if(!response.ok)throw Error('Maintenance queue unavailable: '+response.status);
  return response.json();
}
async function retentionSweep(env,now){
  let removed=0;
  for(const bucket of [env.FIBRE_PHOTOS,env.FIBRE_PHOTOS_BACKUP]){
    for(const prefix of PREFIXES){
      const objects=await listAll(bucket,prefix);
      const expired=objects.filter(o=>{
        const original=o.customMetadata?.sourceUploadedAt||o.uploaded;
        return expiresAt(original)<=now;
      }).map(o=>o.key);
      await deleteKeys(bucket,expired);removed+=expired.length;
    }
  }
  return removed;
}
export async function clean(env,now=Date.now()){
  if(env.PHOTO_PRODUCTION_CLEANUP_ENABLED!=='true')return {skipped:true};
  if(!env.FIBRE_PHOTOS||!env.FIBRE_PHOTOS_BACKUP)throw Error('Both R2 bindings are required');
  const jobs=await callJobs(env);
  let completed=0;
  // Max ten jobs per invocation, leaving room for subrequests.
  for(const job of jobs.slice(0,10)){
    if(!UUID.test(job.job_id||''))throw Error('Invalid job identifier');
    await performJob(env,job);
    await callJobs(env,job.job_id);completed++;
  }
  const retentionAllowed=env.PHOTO_PRODUCTION_BACKFILL_COMPLETE==='true' &&
    env.PHOTO_PRODUCTION_RETENTION_ENABLED==='true';
  const expired=retentionAllowed?await retentionSweep(env,now):0;
  return {completed,expired,retentionAllowed};
}
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function sha(bytes){return hex(await crypto.subtle.digest('SHA-256',bytes));}
export async function inventoryAndBackfill(env,{copy=false,maxObjects=30}={}){
  // Not called by scheduled(); explicit manual operation only.
  // A missing flag always turns a requested copy into an error, never an implicit write.
  if(copy&&env.PHOTO_PRODUCTION_BACKFILL_ENABLED!=='true')throw Error('Backfill not authorized');
  if(!env.FIBRE_PHOTOS||!env.FIBRE_PHOTOS_BACKUP)throw Error('Both R2 bindings are required');
  const summary={scanned:0,missing:0,verified:0,mismatch:0,copied:0,remaining:false};
  for(const prefix of PREFIXES){
    for(const info of await listAll(env.FIBRE_PHOTOS,prefix)){
      if(summary.scanned>=maxObjects){summary.remaining=true;return summary;}
      summary.scanned++;
      const existing=await env.FIBRE_PHOTOS_BACKUP.get(info.key);
      const source=await env.FIBRE_PHOTOS.get(info.key);
      if(!source)continue; // Concurrent deletion: never resurrect the photo.
      const bytes=await source.arrayBuffer();
      const sourceDigest=await sha(bytes);
      if(existing){
        const targetDigest=await sha(await existing.arrayBuffer());
        if(sourceDigest===targetDigest){summary.verified++;continue;}
        summary.mismatch++; // Never overwrite a conflicting backup silently.
        continue;
      }
      summary.missing++;
      if(!copy)continue;
      const originalTime=source.customMetadata?.sourceUploadedAt||source.uploaded?.toISOString?.()||info.uploaded?.toISOString?.();
      await env.FIBRE_PHOTOS_BACKUP.put(info.key,bytes,{
        httpMetadata:source.httpMetadata,
        customMetadata:{...source.customMetadata,sourceUploadedAt:String(originalTime||new Date().toISOString())}
      });
      const confirmation=await env.FIBRE_PHOTOS_BACKUP.get(info.key);
      if(!confirmation||await sha(await confirmation.arrayBuffer())!==sourceDigest)
        throw Error('Backup verification failed: abort this batch');
      summary.copied++;summary.verified++;
    }
  }
  return summary;
}
export default {async scheduled(_event,env,context){context.waitUntil(clean(env))}};
