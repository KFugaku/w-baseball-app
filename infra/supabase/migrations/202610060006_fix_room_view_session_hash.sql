-- Issue #24 follow-up: pgcrypto は extensions スキーマにあるため、SECURITY DEFINER
-- 関数からはスキーマを明示して呼び出す。既に実行済みの関数を安全に置き換える。

create or replace function public.start_room_view_session(
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
  if current_viewer_id is null then
    raise exception using errcode = '28000', message = '閲覧認証に失敗しました。';
  end if;

  select locked_until into current_lock
  from public.room_view_attempts
  where viewer_id = current_viewer_id;

  if current_lock is not null and current_lock > now() then
    raise exception using errcode = '28000', message = '閲覧認証に失敗しました。';
  end if;

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
  on conflict on constraint room_viewer_sessions_pkey do update
  set expires_at = excluded.expires_at;

  delete from public.room_view_attempts where viewer_id = current_viewer_id;

  return query select target_room_id, target_room_name, session_expiry;
end;
$$;

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

notify pgrst, 'reload schema';
