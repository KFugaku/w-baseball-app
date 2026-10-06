-- Issue #20: ルーム番号とパスワードによる、期限付き閲覧セッション
--
-- 前提: 202610050001_room_data_model.sql, 202610050002_auth_and_rls.sql
-- 匿名AuthのJWTを使って閲覧者を識別する。ルームパスワード自体は、このRPC呼び出し
-- の引数として一度だけ受け取り、保存・返却・ログ出力しない。

create table public.room_viewer_sessions (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (viewer_id, room_id),
  check (expires_at > created_at)
);

create table public.room_view_attempts (
  viewer_id uuid primary key references auth.users(id) on delete cascade,
  failed_count smallint not null default 0 check (failed_count between 0 and 5),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index room_viewer_sessions_room_expires_idx
  on public.room_viewer_sessions (room_id, expires_at);

create trigger room_viewer_sessions_set_updated_at before update on public.room_viewer_sessions
for each row execute function public.set_updated_at();
create trigger room_view_attempts_set_updated_at before update on public.room_view_attempts
for each row execute function public.set_updated_at();

alter table public.room_viewer_sessions enable row level security;
alter table public.room_view_attempts enable row level security;

-- テーブルをData APIから直接操作させず、下記の限定関数だけを入口にする。
revoke all on table public.room_viewer_sessions, public.room_view_attempts from anon, authenticated;

create function public.record_room_view_failure(target_viewer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.room_view_attempts as attempts
    (viewer_id, failed_count, window_started_at, locked_until)
  values (target_viewer_id, 1, now(), null)
  on conflict (viewer_id) do update
  set
    failed_count = case
      when attempts.window_started_at < now() - interval '10 minutes' then 1
      else least(attempts.failed_count + 1, 5)
    end,
    window_started_at = case
      when attempts.window_started_at < now() - interval '10 minutes' then now()
      else attempts.window_started_at
    end,
    locked_until = case
      when (case
        when attempts.window_started_at < now() - interval '10 minutes' then 1
        else least(attempts.failed_count + 1, 5)
      end) >= 5 then now() + interval '15 minutes'
      else null
    end;
end;
$$;

create function public.start_room_view_session(
  requested_room_number text,
  requested_password text
)
returns table (room_id uuid, room_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_viewer_id uuid := auth.uid();
  target_room_id uuid;
  target_room_name text;
  target_password_hash text;
  current_lock timestamptz;
  session_expiry timestamptz := now() + interval '1 hour';
begin
  -- Authなしでこの関数を呼べない。フロントエンドは匿名Authを開始してから呼び出す。
  if current_viewer_id is null then
    raise exception using errcode = '28000', message = '閲覧認証に失敗しました。';
  end if;

  select locked_until into current_lock
  from public.room_view_attempts
  where viewer_id = current_viewer_id;

  if current_lock is not null and current_lock > now() then
    raise exception using errcode = '28000', message = '閲覧認証に失敗しました。';
  end if;

  -- 形式不正も、存在しないルームも、パスワード不一致も同じ失敗として扱う。
  if requested_room_number !~ '^[0-9]{8}$'
    or requested_password is null
    or char_length(requested_password) not between 1 and 200 then
    perform public.record_room_view_failure(current_viewer_id);
    raise exception using errcode = '28000', message = '閲覧認証に失敗しました。';
  end if;

  select rooms.id, rooms.name, credentials.password_hash
    into target_room_id, target_room_name, target_password_hash
  from public.rooms as rooms
  join public.room_credentials as credentials on credentials.room_id = rooms.id
  where rooms.room_number = requested_room_number;

  if target_room_id is null
    or extensions.crypt(requested_password, target_password_hash) <> target_password_hash then
    perform public.record_room_view_failure(current_viewer_id);
    raise exception using errcode = '28000', message = '閲覧認証に失敗しました。';
  end if;

  insert into public.room_viewer_sessions as sessions
    (viewer_id, room_id, expires_at)
  values (current_viewer_id, target_room_id, session_expiry)
  on conflict (viewer_id, room_id) do update
  set expires_at = excluded.expires_at;

  delete from public.room_view_attempts where viewer_id = current_viewer_id;

  return query select target_room_id, target_room_name, session_expiry;
end;
$$;

create function public.end_room_view_session(target_room_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.room_viewer_sessions
  where viewer_id = (select auth.uid())
    and room_id = target_room_id;
$$;

-- RLS式から利用する。期限切れた行は常に閲覧権限を与えない。
create function public.has_active_room_view_session(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.room_viewer_sessions
      where viewer_id = (select auth.uid())
        and room_id = target_room_id
        and expires_at > now()
    );
$$;

create function public.has_active_room_view_session_for_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_active_room_view_session(teams.room_id)
  from public.teams
  where teams.id = target_team_id;
$$;

create function public.has_active_room_view_session_for_game(target_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_active_room_view_session(games.room_id)
  from public.games
  where games.id = target_game_id;
$$;

create function public.has_active_room_view_session_for_game_team(target_game_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_active_room_view_session_for_game(game_teams.game_id)
  from public.game_teams
  where game_teams.id = target_game_team_id;
$$;

create function public.has_active_room_view_session_for_player(target_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_active_room_view_session_for_team(players.team_id)
  from public.players
  where players.id = target_player_id;
$$;

create function public.has_active_room_view_session_for_lineup(target_lineup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_active_room_view_session_for_game_team(lineups.game_team_id)
  from public.lineups
  where lineups.id = target_lineup_id;
$$;

revoke all on function public.record_room_view_failure(uuid),
  public.start_room_view_session(text, text), public.end_room_view_session(uuid),
  public.has_active_room_view_session(uuid), public.has_active_room_view_session_for_team(uuid),
  public.has_active_room_view_session_for_game(uuid), public.has_active_room_view_session_for_game_team(uuid),
  public.has_active_room_view_session_for_player(uuid), public.has_active_room_view_session_for_lineup(uuid)
  from public, anon, authenticated;

grant execute on function public.start_room_view_session(text, text), public.end_room_view_session(uuid),
  public.has_active_room_view_session(uuid), public.has_active_room_view_session_for_team(uuid),
  public.has_active_room_view_session_for_game(uuid), public.has_active_room_view_session_for_game_team(uuid),
  public.has_active_room_view_session_for_player(uuid), public.has_active_room_view_session_for_lineup(uuid)
  to authenticated;

-- 既存の所有者用ポリシーに加えて、期限内の閲覧セッションには SELECT だけを許可する。
create policy "閲覧セッションのルームだけを参照できる"
  on public.rooms for select to authenticated
  using (public.has_active_room_view_session(id));
create policy "閲覧セッションのチームだけを参照できる"
  on public.teams for select to authenticated
  using (public.has_active_room_view_session(room_id));
create policy "閲覧セッションの選手だけを参照できる"
  on public.players for select to authenticated
  using (public.has_active_room_view_session_for_team(team_id));
create policy "閲覧セッションの試合だけを参照できる"
  on public.games for select to authenticated
  using (public.has_active_room_view_session(room_id));
create policy "閲覧セッションの対戦チームだけを参照できる"
  on public.game_teams for select to authenticated
  using (public.has_active_room_view_session_for_game(game_id));
create policy "閲覧セッションの打順だけを参照できる"
  on public.lineups for select to authenticated
  using (public.has_active_room_view_session_for_game_team(game_team_id));
create policy "閲覧セッションの試合状況だけを参照できる"
  on public.game_states for select to authenticated
  using (public.has_active_room_view_session_for_game(game_id));
create policy "閲覧セッションの走者だけを参照できる"
  on public.game_runners for select to authenticated
  using (public.has_active_room_view_session_for_game(game_id));
create policy "閲覧セッションのイベントだけを参照できる"
  on public.game_events for select to authenticated
  using (public.has_active_room_view_session_for_game(game_id));

comment on function public.start_room_view_session(text, text) is
  'ルーム番号と平文パスワードをサーバー内で照合し、1時間だけ有効な閲覧権限を発行する。';
