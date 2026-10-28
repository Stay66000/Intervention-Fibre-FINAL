-- FIBRE OPS — Roadmap V2 additive schema
-- Reproductibilité des ajouts déjà appliqués sur le projet Supabase partagé.
-- Aucun DROP de données, aucune modification des anciennes RLS métier.

begin;

create table if not exists public.finance_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  urssaf_rate numeric not null default 0 check (urssaf_rate >= 0 and urssaf_rate <= 100),
  income_tax_rate numeric not null default 0 check (income_tax_rate >= 0 and income_tax_rate <= 100),
  safety_buffer_rate numeric not null default 0 check (safety_buffer_rate >= 0 and safety_buffer_rate <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.finance_settings enable row level security;
drop policy if exists finance_settings_select_own on public.finance_settings;
create policy finance_settings_select_own on public.finance_settings for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists finance_settings_insert_own on public.finance_settings;
create policy finance_settings_insert_own on public.finance_settings for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists finance_settings_update_own on public.finance_settings;
create policy finance_settings_update_own on public.finance_settings for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
revoke all on table public.finance_settings from anon;
grant select,insert,update on table public.finance_settings to authenticated;

create table if not exists public.finance_cash_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_date date not null default current_date,
  entry_type text not null check (entry_type in ('income','expense')),
  category text not null default 'Autre' check (char_length(trim(category)) between 1 and 80),
  label text not null check (char_length(trim(label)) between 1 and 180),
  amount numeric not null check (amount > 0 and amount <= 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.finance_cash_entries enable row level security;
drop policy if exists finance_cash_entries_select_own on public.finance_cash_entries;
create policy finance_cash_entries_select_own on public.finance_cash_entries for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists finance_cash_entries_insert_own on public.finance_cash_entries;
create policy finance_cash_entries_insert_own on public.finance_cash_entries for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists finance_cash_entries_update_own on public.finance_cash_entries;
create policy finance_cash_entries_update_own on public.finance_cash_entries for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists finance_cash_entries_delete_own on public.finance_cash_entries;
create policy finance_cash_entries_delete_own on public.finance_cash_entries for delete to authenticated using (user_id=(select auth.uid()));
create index if not exists finance_cash_entries_user_date_idx on public.finance_cash_entries(user_id,entry_date desc);
revoke all on table public.finance_cash_entries from anon;
grant select,insert,update,delete on table public.finance_cash_entries to authenticated;

alter table public.interventions add column if not exists client_event_id uuid;
create unique index if not exists interventions_client_event_id_unique on public.interventions(client_event_id) where client_event_id is not null;

commit;
