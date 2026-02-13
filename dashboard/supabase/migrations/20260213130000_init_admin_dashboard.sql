create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{"company": "", "name": "", "description": ""}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_prompts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  meeting_type_id uuid not null references public.meeting_types(id) on delete cascade,
  prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, meeting_type_id)
);

create index if not exists idx_clients_username on public.clients(username);
create index if not exists idx_client_prompts_client_id on public.client_prompts(client_id);
create index if not exists idx_client_prompts_meeting_type_id on public.client_prompts(meeting_type_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists trg_meeting_types_updated_at on public.meeting_types;
create trigger trg_meeting_types_updated_at
before update on public.meeting_types
for each row execute function public.set_updated_at();

drop trigger if exists trg_client_prompts_updated_at on public.client_prompts;
create trigger trg_client_prompts_updated_at
before update on public.client_prompts
for each row execute function public.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.clients enable row level security;
alter table public.meeting_types enable row level security;
alter table public.client_prompts enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin_user() from public;
grant execute on function public.is_admin_user() to authenticated;

drop policy if exists admin_users_select_policy on public.admin_users;
create policy admin_users_select_policy
on public.admin_users
for select
to authenticated
using (public.is_admin_user());

drop policy if exists clients_admin_policy on public.clients;
create policy clients_admin_policy
on public.clients
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists meeting_types_admin_policy on public.meeting_types;
create policy meeting_types_admin_policy
on public.meeting_types
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists client_prompts_admin_policy on public.client_prompts;
create policy client_prompts_admin_policy
on public.client_prompts
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());
