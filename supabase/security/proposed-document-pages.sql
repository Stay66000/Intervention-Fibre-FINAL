-- Reference copy of Supabase migration 20261102101448
-- professional_document_pages_private, applied to the production project.
-- This file is not a deployable migration and must not be run again.
begin;

create table public.professional_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.professional_documents(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  position integer not null check (position between 0 and 19),
  created_at timestamptz not null default now(),
  check (split_part(file_path,'/',1)=user_id::text and char_length(file_path)<200),
  unique (document_id, position)
);

alter table public.professional_document_pages enable row level security;
revoke all on public.professional_document_pages from public, anon, authenticated;
grant select, insert, delete on public.professional_document_pages to authenticated;

create policy document_pages_select_own on public.professional_document_pages
  for select to authenticated using (
    user_id=(select auth.uid()) and exists (
      select 1 from public.professional_documents d
      where d.id=document_id and d.user_id=(select auth.uid())
    )
  );
create policy document_pages_insert_own on public.professional_document_pages
  for insert to authenticated with check (
    user_id=(select auth.uid()) and exists (
      select 1 from public.professional_documents d
      where d.id=document_id and d.user_id=(select auth.uid())
    )
  );
create policy document_pages_delete_own on public.professional_document_pages
  for delete to authenticated using (
    user_id=(select auth.uid()) and exists (
      select 1 from public.professional_documents d
      where d.id=document_id and d.user_id=(select auth.uid())
    )
  );
create index document_pages_owner_document_idx
  on public.professional_document_pages (user_id,document_id,position);

commit;
