// FIBRE OPS — isolated preview retention only.
// This worker can NEVER list, copy or delete outside preview-photos/.
const PREFIX='preview-photos/';
const BASE='https://dvvoqfswlqdwvxamfsot.supabase.co';
const KEY='sb_publishable_DKIrFOlhgvc7LW43_qgLYA_cENm3M-P';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_JOBS=5, MAX_EXPIRED=60;
export function expiresAt(value){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))throw Error('Invalid upload timestamp');
  const year=d.getUTCFullYear(),month=d.getUTCMonth()+6,day=d.getUTCDate();
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return Date.UTC(year,month,Math.min(day,last),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds());
}
function validPreviewKey(key){
  const parts=String(key||'').split('/');
  return parts.length===3&&parts[0]==='preview-photos'&&UUID.test(parts[1])&&UUID.test(parts[2]);
}
function uploadedAt(object){
  // Retries/copies retain this first-upload timestamp; legacy objects use R2 creation time.
  return object?.customMetadata?.sourceUploadedAt||object?.uploaded;
}
async function listPreview(bucket,{limitPages=12}={}){
  const objects=[];let cursor,complete=true;
  for(let pageNumber=0;pageNumber<limitPages;pageNumber++){
    const page=await bucket.list({prefix:PREFIX,cursor,limit:1000,include:['customMetadata']});
    objects.push(...page.objects.filter(o=>validPreviewKey(o.key)));
    if(!page.truncated){cursor=undefined;break}
    cursor=page.cursor;
    if(!cursor){complete=false;break}
    if(pageNumber===limitPages-1)complete=false;
  }
  return {objects,complete};
}
async function removePrefix(bucket,prefix){
  if(!prefix.startsWith(PREFIX)||!UUID.test(prefix.slice(PREFIX.length,-1))||!prefix.endsWith('/'))throw Error('Unsafe deletion prefix');
  // Do not reuse a cursor after deletes: repeat the first page to avoid skipped keys.
  for(let batch=0;batch<20;batch++){
    const page=await bucket.list({prefix,limit:200});
    const keys=page.objects.map(o=>o.key).filter(validPreviewKey);
    if(!page.objects.length)return;
    if(keys.length!==page.objects.length)throw Error('Unexpected keys in cleanup folder');
    await bucket.delete(keys);
  }
  throw Error('Deletion exceeds safe per-job batch; leave job queued for retry');
}
async function rpc(secret,body){
  const r=await fetch(BASE+'/rest/v1/rpc/photo_test_cleanup_jobs',{method:'POST',headers:{'content-type':'application/json',apikey:KEY},body:JSON.stringify({p_secret:secret,...body})});
  if(!r.ok)throw Error('Cleanup queue unavailable: '+r.status);
  return r.json();
}
export async function retentionSweep(primary,backup,now=Date.now(),{dryRun=false}={}){
  const [a,b]=await Promise.all([listPreview(primary),listPreview(backup)]);
  // Never delete on a partial scan; one cron cycle will try again safely.
  if(!a.complete||!b.complete)throw Error('Preview photo inventory was truncated');
  const map=new Map();
  for(const [side,entries] of [['primary',a.objects],['backup',b.objects]]){
    for(const obj of entries){
      if(!map.has(obj.key))map.set(obj.key,{});
      map.get(obj.key)[side]=obj;
    }
  }
  const expired=[];
  for(const [key,pair] of map){
    const candidates=[pair.primary,pair.backup].filter(Boolean).map(uploadedAt);
    const dates=candidates.map(x=>new Date(x).getTime());
    if(!dates.length||!dates.every(Number.isFinite))continue; // fail closed on invalid dates
    if(expiresAt(Math.min(...dates))<=now)expired.push(key);
  }
  const selected=expired.slice(0,MAX_EXPIRED);
  if(!dryRun&&selected.length){
    // Each deletion is idempotent; if backup is temporarily unavailable the next cron retries.
    await primary.delete(selected);
    await backup.delete(selected);
  }
  return {expired:expired.length,removed:dryRun?0:selected.length,remaining:Math.max(0,expired.length-selected.length),dryRun};
}
export async function clean(env,now=Date.now(),{dryRun=false}={}){
  if(!env.FIBRE_PHOTOS||!env.FIBRE_PHOTOS_BACKUP||!env.PHOTO_TEST_CLEANUP_SECRET)throw Error('Missing cleanup configuration');
  // Cron's deletion scope is forcibly limited to preview-photos/, never production keys.
  const jobs=await rpc(env.PHOTO_TEST_CLEANUP_SECRET,{});
  let completed=0;
  if(!dryRun){
    for(const job of jobs.slice(0,MAX_JOBS)){
      if(!UUID.test(job.intervention_id||''))throw Error('Invalid queued identifier');
      const prefix=PREFIX+job.intervention_id+'/';
      await removePrefix(env.FIBRE_PHOTOS,prefix);
      await removePrefix(env.FIBRE_PHOTOS_BACKUP,prefix);
      await rpc(env.PHOTO_TEST_CLEANUP_SECRET,{p_done:job.intervention_id});
      completed++;
    }
  }
  const retention=await retentionSweep(env.FIBRE_PHOTOS,env.FIBRE_PHOTOS_BACKUP,now,{dryRun});
  return {completed,retention};
}
export default {async scheduled(_event,env,ctx){ctx.waitUntil(clean(env))}};
