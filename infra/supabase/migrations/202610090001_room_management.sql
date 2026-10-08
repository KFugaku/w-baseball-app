-- Issue #45: 所有者によるルーム名の変更と、関連データを含む安全な削除
--
-- rooms は games / teams から参照されるため、削除順をこの関数に閉じ込める。
-- SECURITY DEFINER でも所有者確認を必須にし、クライアントから任意のルームを
-- 更新・削除できないようにする。

create or replace function public.rename_owned_room(
  target_room_id uuid,
  target_name text
)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_name text := btrim(target_name);
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 1 and 80 then
    raise exception 'ルーム名は1〜80文字で入力してください。';
  end if;

  update public.rooms
  set name = normalized_name
  where rooms.id = target_room_id
    and rooms.owner_id = auth.uid();

  if not found then
    raise exception 'このルームを編集する権限がありません。';
  end if;

  return query
  select rooms.id, rooms.name
  from public.rooms
  where rooms.id = target_room_id;
end;
$$;

create or replace function public.delete_owned_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  -- 削除対象を先に固定して確認する。以降はこの関数の中でのみ関連行を削除する。
  perform 1
  from public.rooms
  where rooms.id = target_room_id
    and rooms.owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'このルームを削除する権限がありません。';
  end if;

  -- games の削除では game_states / game_runners / game_events / game_teams /
  -- lineups / 打席・投球記録が外部キーの CASCADE で一緒に削除される。
  delete from public.games where room_id = target_room_id;

  -- 同じルームにだけ属する選手・チームを削除する。
  delete from public.players
  where team_id in (
    select teams.id from public.teams as teams where teams.room_id = target_room_id
  );
  delete from public.teams where room_id = target_room_id;

  -- room_credentials と room_view_sessions は rooms の CASCADE により削除される。
  -- profiles.last_room_id も SET NULL になるため、削除済みルームを再利用できない。
  delete from public.rooms where id = target_room_id;
end;
$$;

revoke all on function public.rename_owned_room(uuid, text) from public, anon;
revoke all on function public.delete_owned_room(uuid) from public, anon;
grant execute on function public.rename_owned_room(uuid, text) to authenticated;
grant execute on function public.delete_owned_room(uuid) to authenticated;
