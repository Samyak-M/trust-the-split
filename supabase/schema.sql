-- Run this in the Supabase SQL editor (once per project).
-- Then enable Realtime for public.projects (Database → Replication).

create table if not exists public.projects (
  id text primary key,
  name text not null,
  description text default '',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id text not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor',
  primary key (project_id, user_id)
);

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (project_id, email)
);

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invites enable row level security;

create or replace function public.is_project_member(pid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = pid and m.user_id = auth.uid()
  );
$$;

create or replace function public.claim_project_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
begin
  em := lower(coalesce(auth.jwt() ->> 'email', ''));
  if em = '' then return; end if;
  insert into public.project_members (project_id, user_id, role)
  select i.project_id, auth.uid(), 'editor'
  from public.project_invites i
  where lower(i.email) = em
  on conflict do nothing;
end;
$$;

create or replace function public.add_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, auth.uid(), 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_owner on public.projects;
create trigger projects_owner
after insert on public.projects
for each row execute procedure public.add_creator_as_owner();

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
for select to authenticated
using (public.is_project_member(id) or created_by = auth.uid());

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
for insert to authenticated
with check (created_by is null or created_by = auth.uid());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
for update to authenticated
using (public.is_project_member(id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
for delete to authenticated
using (public.is_project_member(id));

drop policy if exists members_select on public.project_members;
create policy members_select on public.project_members
for select to authenticated
using (user_id = auth.uid() or public.is_project_member(project_id));

drop policy if exists members_insert on public.project_members;
create policy members_insert on public.project_members
for insert to authenticated
with check (user_id = auth.uid() or public.is_project_member(project_id));

drop policy if exists invites_select on public.project_invites;
create policy invites_select on public.project_invites
for select to authenticated
using (public.is_project_member(project_id));

drop policy if exists invites_insert on public.project_invites;
create policy invites_insert on public.project_invites
for insert to authenticated
with check (public.is_project_member(project_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, delete on public.project_invites to authenticated;
grant execute on function public.claim_project_invites() to authenticated;
