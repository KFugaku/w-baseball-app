-- Issue #9: Supabase Auth と、管理者が自分のルームだけを操作できる RLS
--
-- 実行順: 202609300001_initial_schema.sql → 202610050001_room_data_model.sql → このSQL
-- 匿名閲覧のルーム照合・閲覧ポリシーは Issue #20 で追加する。

-- teams はルームに属する。これにより、選手を含むチーム情報にも所有者単位の認可をかけられる。
alter table public.teams
  add column room_id uuid references public.rooms(id) on delete restrict;

update public.teams
set room_id = '30000000-0000-0000-0000-000000000001'
where room_id is null;

alter table public.teams
  alter column room_id set not null;

alter table public.teams
  add constraint teams_room_id_name_key unique (room_id, name);

create index teams_room_id_idx on public.teams(room_id);

-- Auth にメールアドレスで登録された利用者へプロフィールを自動作成する。
-- SECURITY DEFINER により、利用者が profiles への任意insert権限を得ることはない。
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- このマイグレーション以前に作られた Auth 利用者も安全に補完する。
insert into public.profiles (id, display_name)
select id, nullif(raw_user_meta_data ->> 'display_name', '')
from auth.users
on conflict (id) do nothing;

-- policy式の重複と、RLSポリシー同士の循環参照を避けるための所有者判定。
-- すべて SECURITY DEFINER + 固定 search_path とし、アプリから任意SQLを実行できないようにする。
create function public.is_owned_room(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rooms
    where id = target_room_id and owner_id = (select auth.uid())
  );
$$;

create function public.is_owned_game(target_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.games
    join public.rooms on rooms.id = games.room_id
    where games.id = target_game_id and rooms.owner_id = (select auth.uid())
  );
$$;

create function public.is_owned_game_team(target_game_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.game_teams
    join public.games on games.id = game_teams.game_id
    join public.rooms on rooms.id = games.room_id
    where game_teams.id = target_game_team_id and rooms.owner_id = (select auth.uid())
  );
$$;

create function public.is_owned_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.teams
    join public.rooms on rooms.id = teams.room_id
    where teams.id = target_team_id and rooms.owner_id = (select auth.uid())
  );
$$;

-- Data APIの権限は明示的に最小化する。RLSポリシーだけでなく grants も必要。
revoke all on table public.profiles, public.rooms, public.room_credentials,
  public.teams, public.players, public.games, public.game_teams, public.lineups,
  public.game_states, public.game_runners, public.game_events, public.app_snapshots
  from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on table public.rooms, public.teams, public.players,
  public.games, public.game_teams, public.lineups, public.game_states, public.game_runners,
  public.game_events, public.app_snapshots to authenticated;

revoke all on function public.handle_new_user(), public.is_owned_room(uuid),
  public.is_owned_game(uuid), public.is_owned_game_team(uuid), public.is_owned_team(uuid)
  from public, anon, authenticated;
grant execute on function public.is_owned_room(uuid), public.is_owned_game(uuid),
  public.is_owned_game_team(uuid), public.is_owned_team(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_credentials enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.game_teams enable row level security;
alter table public.lineups enable row level security;
alter table public.game_states enable row level security;
alter table public.game_runners enable row level security;
alter table public.game_events enable row level security;
alter table public.app_snapshots enable row level security;

create policy "プロフィールは本人だけが参照できる"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "プロフィールは本人だけが更新できる"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "所有ルームだけを参照できる"
  on public.rooms for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "本人名義のルームだけを作成できる"
  on public.rooms for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "所有ルームだけを更新できる"
  on public.rooms for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "所有ルームだけを削除できる"
  on public.rooms for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "所有チームだけを操作できる"
  on public.teams for all to authenticated
  using (public.is_owned_room(room_id))
  with check (public.is_owned_room(room_id));
create policy "所有チームの選手だけを操作できる"
  on public.players for all to authenticated
  using (public.is_owned_team(team_id))
  with check (public.is_owned_team(team_id));
create policy "所有ルームの試合だけを操作できる"
  on public.games for all to authenticated
  using (public.is_owned_room(room_id))
  with check (public.is_owned_room(room_id));
create policy "所有試合の対戦チームだけを操作できる"
  on public.game_teams for all to authenticated
  using (public.is_owned_game(game_id))
  with check (public.is_owned_game(game_id));
create policy "所有試合の打順だけを操作できる"
  on public.lineups for all to authenticated
  using (public.is_owned_game_team(game_team_id))
  with check (public.is_owned_game_team(game_team_id));
create policy "所有試合の状況だけを操作できる"
  on public.game_states for all to authenticated
  using (public.is_owned_game(game_id))
  with check (public.is_owned_game(game_id));
create policy "所有試合の走者だけを操作できる"
  on public.game_runners for all to authenticated
  using (public.is_owned_game(game_id))
  with check (public.is_owned_game(game_id));
create policy "所有試合のイベントだけを操作できる"
  on public.game_events for all to authenticated
  using (public.is_owned_game(game_id))
  with check (public.is_owned_game(game_id));

-- 旧来のグローバルscopeを廃止し、ログイン利用者自身のスナップショットだけを許可する。
create policy "本人の画面状態だけを操作できる"
  on public.app_snapshots for all to authenticated
  using (scope = ('user:' || (select auth.uid())::text))
  with check (scope = ('user:' || (select auth.uid())::text));

-- room_credentials には policy を一切作らない。匿名・認証済みを問わずData APIでは読書き不可。
-- ルームパスワード照合と匿名閲覧の一時権限は Issue #20 の限定RPCで実装する。
