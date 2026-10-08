-- Issue #46: ルームに所属するメンバーを、試合の打順とは独立して保存する。
-- 閲覧者は認証済みルームの一覧を読むだけ、編集はルーム所有者だけに限定する。

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  first_name text not null default '' check (char_length(first_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, last_name, first_name)
);

create index if not exists room_members_room_id_created_at_idx
  on public.room_members (room_id, created_at);

-- すでに試合を作成済みのルームは、既存の選手名を初回メンバー一覧として引き継ぐ。
-- 新規ルームには players が存在しないため、空の状態で開始する。
insert into public.room_members (room_id, last_name, first_name)
select distinct teams.room_id, players.last_name, players.first_name
from public.teams
join public.players on players.team_id = teams.id
where teams.room_id is not null
on conflict (room_id, last_name, first_name) do nothing;

drop trigger if exists room_members_set_updated_at on public.room_members;
create trigger room_members_set_updated_at before update on public.room_members
for each row execute function public.set_updated_at();

revoke all on table public.room_members from anon, authenticated;
grant select, insert, update, delete on table public.room_members to authenticated;

alter table public.room_members enable row level security;

create policy "所有ルームのメンバーだけを操作できる"
  on public.room_members for all to authenticated
  using (public.is_owned_room(room_id))
  with check (public.is_owned_room(room_id));

create policy "閲覧セッションのルームメンバーだけを参照できる"
  on public.room_members for select to authenticated
  using (public.has_active_room_view_session(room_id));

