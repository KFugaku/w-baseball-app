-- Issue #23: 所有ルームへ試合を安全に作成する。
-- 試合は、画面で開いている所有ルームにだけ追加できる。

-- このファイルの旧版（ルーム切替機能を含む）を実行済みでも、安全に置き換える。
drop function if exists public.preview_room_number();
drop function if exists public.create_owned_game(uuid, text, text, text, text, text, text, text, text);

create or replace function public.create_owned_game(
  target_room_id uuid,
  target_title text,
  target_away_name text,
  target_away_color text,
  target_home_name text,
  target_home_color text
)
returns table (
  room_id uuid,
  room_name text,
  room_number text,
  game_id uuid,
  game_title text,
  away_team_name text,
  away_team_color text,
  home_team_name text,
  home_team_color text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_room public.rooms%rowtype;
  new_game public.games%rowtype;
  away_team_id uuid;
  home_team_id uuid;
  normalized_away_name text := trim(coalesce(target_away_name, ''));
  normalized_home_name text := trim(coalesce(target_home_name, ''));
  normalized_away_color text := coalesce(nullif(trim(target_away_color), ''), '#f7d6d0');
  normalized_home_color text := coalesce(nullif(trim(target_home_color), ''), '#d9eafa');
  normalized_title text;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  if target_room_id is null then
    raise exception '試合を追加するルームを選択してください。';
  end if;

  select * into active_room
  from public.rooms
  where id = target_room_id and owner_id = auth.uid();

  if not found then
    raise exception '選択したルームを利用する権限がありません。';
  end if;

  if char_length(normalized_away_name) not between 1 and 80
    or char_length(normalized_home_name) not between 1 and 80 then
    raise exception '先攻・後攻のチーム名を1〜80文字で入力してください。';
  end if;

  if normalized_away_name = normalized_home_name then
    raise exception '先攻と後攻には異なるチーム名を入力してください。';
  end if;

  if normalized_away_color !~ '^#[0-9A-Fa-f]{6}$'
    or normalized_home_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'チームカラーの形式が正しくありません。';
  end if;

  normalized_title := nullif(trim(target_title), '');
  if normalized_title is null then
    normalized_title := format(
      '第%s試合',
      (select count(*) + 1 from public.games where room_id = active_room.id)
    );
  end if;

  if char_length(normalized_title) not between 1 and 120 then
    raise exception '試合名は1〜120文字で入力してください。';
  end if;

  select id into away_team_id
  from public.teams
  where room_id = active_room.id and name = normalized_away_name;

  if away_team_id is null then
    insert into public.teams (room_id, name, color)
    values (active_room.id, normalized_away_name, normalized_away_color)
    returning id into away_team_id;
  end if;

  select id into home_team_id
  from public.teams
  where room_id = active_room.id and name = normalized_home_name;

  if home_team_id is null then
    insert into public.teams (room_id, name, color)
    values (active_room.id, normalized_home_name, normalized_home_color)
    returning id into home_team_id;
  end if;

  insert into public.games (room_id, title, status)
  values (active_room.id, normalized_title, 'before')
  returning * into new_game;

  insert into public.game_teams (game_id, team_id, side, score)
  values
    (new_game.id, away_team_id, 'away', 0),
    (new_game.id, home_team_id, 'home', 0);

  insert into public.game_states (game_id)
  values (new_game.id);

  update public.profiles
  set last_room_id = active_room.id
  where id = auth.uid();

  return query
  select
    active_room.id,
    active_room.name,
    active_room.room_number,
    new_game.id,
    new_game.title,
    normalized_away_name,
    normalized_away_color,
    normalized_home_name,
    normalized_home_color;
end;
$$;

revoke all on function public.create_owned_game(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.create_owned_game(uuid, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
