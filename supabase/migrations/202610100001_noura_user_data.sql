create table if not exists public.noura_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb,
  logs jsonb not null default '[]'::jsonb check (jsonb_typeof(logs) = 'array'),
  reminders jsonb not null default '[]'::jsonb check (jsonb_typeof(reminders) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.noura_user_data enable row level security;

revoke all on table public.noura_user_data from anon;
grant select, insert, update, delete on table public.noura_user_data to authenticated;

drop policy if exists "Users can read their own Noura data" on public.noura_user_data;
create policy "Users can read their own Noura data"
  on public.noura_user_data for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own Noura data" on public.noura_user_data;
create policy "Users can create their own Noura data"
  on public.noura_user_data for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Noura data" on public.noura_user_data;
create policy "Users can update their own Noura data"
  on public.noura_user_data for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own Noura data" on public.noura_user_data;
create policy "Users can delete their own Noura data"
  on public.noura_user_data for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_noura_user_data_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_noura_user_data_updated_at on public.noura_user_data;
create trigger set_noura_user_data_updated_at
before update on public.noura_user_data
for each row execute function public.set_noura_user_data_updated_at();
