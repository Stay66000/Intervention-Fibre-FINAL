-- Rollback ciblé du nouveau backup Google. Le classeur créé dans le Drive du
-- technicien n'est jamais supprimé par ce rollback.
do $$
declare v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname='fibre_ops_google_backup_worker'
  loop perform cron.unschedule(v_job); end loop;
end $$;

drop trigger if exists fibre_ops_google_backup_intervention on public.interventions;
drop function if exists private.invoke_google_backup_worker();
drop function if exists public.claim_google_backup_jobs(integer);
drop function if exists private.enqueue_google_backup_intervention();

drop table if exists public.google_backup_jobs;
drop table if exists public.google_backup_oauth_states;
drop table if exists public.google_backup_tokens;
drop table if exists public.google_backup_connections;
drop table if exists public.google_backup_worker_config;

-- pg_cron et pg_net sont volontairement conservées : d'autres modules peuvent
-- les utiliser après l'installation.