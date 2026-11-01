begin;
create table public.professional_documents (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('AIPR','CACES / R486','Habilitation électrique','Permis de conduire','Visite médicale','Autre')),
 name text not null check(char_length(trim(name)) between 1 and 120),
 obtained_on date, expires_on date,
 notes text not null default '' check(char_length(notes)<=2000),
 reminders_enabled boolean not null default true,
 reminder_days integer not null default 30 check(reminder_days between 0 and 365),
 file_path text check(file_path is null or (split_part(file_path,'/',1)=user_id::text and char_length(file_path)<200)),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(expires_on is null or obtained_on is null or expires_on>=obtained_on)
);
alter table public.professional_documents enable row level security;
create policy documents_select_own on public.professional_documents for select to authenticated using(user_id=(select auth.uid()));
create policy documents_insert_own on public.professional_documents for insert to authenticated with check(user_id=(select auth.uid()));
create policy documents_update_own on public.professional_documents for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy documents_delete_own on public.professional_documents for delete to authenticated using(user_id=(select auth.uid()));
revoke all on public.professional_documents from anon;
grant select,insert,update,delete on public.professional_documents to authenticated;
create index documents_user_expiration_idx on public.professional_documents(user_id,expires_on);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('professional-documents','professional-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy documents_files_select on storage.objects for select to authenticated using(bucket_id='professional-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy documents_files_insert on storage.objects for insert to authenticated with check(bucket_id='professional-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy documents_files_delete on storage.objects for delete to authenticated using(bucket_id='professional-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
