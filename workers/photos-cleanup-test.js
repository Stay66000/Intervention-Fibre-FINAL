// Isolated preview objects only. This worker must never operate on production prefixes.
const PREFIX='preview-photos/';
const BASE='https://dvvoqfswlqdwvxamfsot.supabase.co';
const KEY='sb_publishable_DKIrFOlhgvc7LW43_qgLYA_cENm3M-P';
export function expiresAt(date){
  const d=new Date(date), year=d.getUTCFullYear(), month=d.getUTCMonth()+6, day=d.getUTCDate();
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return Date.UTC(year,month,Math.min(day,last),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds());
}
async function removePrefix(bucket,prefix){
  let cursor;
  do {const page=await bucket.list({prefix,cursor,limit:1000});if(page.objects.length)await bucket.delete(page.objects.map(o=>o.key));cursor=page.truncated?page.cursor:undefined;} while(cursor);
}
async function expire(bucket,now){
  let cursor;
  do {const page=await bucket.list({prefix:PREFIX,cursor,limit:1000});const keys=page.objects.filter(o=>expiresAt(o.uploaded)<=now).map(o=>o.key);if(keys.length)await bucket.delete(keys);cursor=page.truncated?page.cursor:undefined;}while(cursor);
}
async function rpc(secret,body){
  const r=await fetch(BASE+'/rest/v1/rpc/photo_test_cleanup_jobs',{method:'POST',headers:{'content-type':'application/json',apikey:KEY},body:JSON.stringify({p_secret:secret,...body})});
  if(!r.ok)throw Error('Cleanup queue unavailable: '+r.status);
  return r.json();
}
export async function clean(env,now=Date.now()){
  if(!env.FIBRE_PHOTOS||!env.FIBRE_PHOTOS_BACKUP||!env.PHOTO_TEST_CLEANUP_SECRET)throw Error('Missing cleanup configuration');
  const jobs=await rpc(env.PHOTO_TEST_CLEANUP_SECRET,{});
  // Each completed job acknowledges through a separate external request.
  // Leave ample headroom under the Free plan's per-invocation subrequest limit.
  for(const job of jobs.slice(0,20)){
    if(!/^[0-9a-f-]{36}$/i.test(job.intervention_id))throw Error('Invalid queued identifier');
    const prefix=PREFIX+job.intervention_id+'/';
    await removePrefix(env.FIBRE_PHOTOS,prefix);
    await removePrefix(env.FIBRE_PHOTOS_BACKUP,prefix);
    await rpc(env.PHOTO_TEST_CLEANUP_SECRET,{p_done:job.intervention_id});
  }
  await expire(env.FIBRE_PHOTOS,now);
  await expire(env.FIBRE_PHOTOS_BACKUP,now);
}
export default {async scheduled(_event,env,ctx){ctx.waitUntil(clean(env));}};
