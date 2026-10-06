-- Issue #24: 共通試合詳細画面のための閲覧権限引き継ぎと役割判定
--
-- 匿名閲覧中にメールログインすると auth.uid() が変わるため、同じブラウザタブだけが
-- 使える短命・高エントロピーの引継ぎトークンを発行する。パスワードは保存も返却もしない。

alter table public.room_viewer_sessions
  add column if not exists handoff_token_hash text;

create index if not exists room_viewer_sessions_handoff_idx
  on public.room_viewer_sessions (room_id)
  where handoff_token_hash is not null;

create or replace function public.start_room_view_session_with_handoff(
  requested_room_number text,
  requested_password text
)
returns table (room_id uuid, room_name text, expires_at timestamptz, handoff_token text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_viewer_id uuid := auth.uid();
  started_session record;
  generated_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into started_session
  from public.start_room_view_session(requested_room_number, requested_password);

  update public.room_viewer_sessions as sessions
  set handoff_token_hash = extensions.crypt(generated_token, extensions.gen_salt('bf'))
  where sessions.viewer_id = current_viewer_id
    and sessions.room_id = started_session.room_id;

  return query
  select started_session.room_id, started_session.room_name, started_session.expires_at, generated_token;
end;
$$;

-- ログイン後またはログアウト後に、同じ端末の閲覧権限を新しいAuth利用者へ引き継ぐ。
-- トークンはハッシュだけを保持するため、DBの値だけでは閲覧権限を再現できない。
create or replace function public.claim_room_view_session(
  target_room_id uuid,
  provided_handoff_token text
)
returns table (room_id uuid, room_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_viewer_id uuid := auth.uid();
  original_expiry timestamptz;
  target_room_name text;
begin
  if current_viewer_id is null then
    raise exception using errcode = '28000', message = '閲覧認証に失敗しました。';
  end if;

  if provided_handoff_token is null or provided_handoff_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '28000', message = '閲覧権限を引き継げませんでした。';
  end if;

  select sessions.expires_at, rooms.name
    into original_expiry, target_room_name
  from public.room_viewer_sessions as sessions
  join public.rooms on rooms.id = sessions.room_id
  where sessions.room_id = target_room_id
    and sessions.expires_at > now()
    and sessions.handoff_token_hash is not null
    and extensions.crypt(provided_handoff_token, sessions.handoff_token_hash) = sessions.handoff_token_hash
  limit 1;

  if original_expiry is null then
    raise exception using errcode = '28000', message = '閲覧権限を引き継げませんでした。';
  end if;

  insert into public.room_viewer_sessions as sessions (viewer_id, room_id, expires_at)
  values (current_viewer_id, target_room_id, original_expiry)
  on conflict on constraint room_viewer_sessions_pkey do update
  set expires_at = greatest(sessions.expires_at, excluded.expires_at);

  return query select target_room_id, target_room_name, original_expiry;
end;
$$;

-- 画面表示用の役割をサーバー側で判定する。クライアント側のフラグは編集権限に使わない。
create or replace function public.get_game_access(
  target_room_id uuid,
  target_game_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.games
    where id = target_game_id and room_id = target_room_id
  ) then
    return null;
  end if;

  if public.is_owned_room(target_room_id) then
    return 'owner';
  end if;

  if public.has_active_room_view_session(target_room_id) then
    return 'viewer';
  end if;

  return null;
end;
$$;

revoke all on function public.start_room_view_session_with_handoff(text, text),
  public.claim_room_view_session(uuid, text), public.get_game_access(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.start_room_view_session_with_handoff(text, text),
  public.claim_room_view_session(uuid, text), public.get_game_access(uuid, uuid)
  to authenticated;

comment on function public.start_room_view_session_with_handoff(text, text) is
  '閲覧認証を開始し、メールログイン後に同じタブでのみ使える引継ぎトークンを返す。';
comment on function public.claim_room_view_session(uuid, text) is
  '匿名閲覧の有効期限内の権限を、トークンを所持する同一端末の新しいAuth利用者へ引き継ぐ。';
comment on function public.get_game_access(uuid, uuid) is
  '試合詳細に対する現在の役割を owner / viewer / null で返す。';

notify pgrst, 'reload schema';
