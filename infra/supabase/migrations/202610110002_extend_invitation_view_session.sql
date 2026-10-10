-- Issue #56 follow-up: 試合運用中に招待リンクの閲覧を継続できるよう、
-- 招待リンク経由だけは7時間の閲覧セッションを発行する。
-- ルーム番号・パスワードで開始する既存の閲覧セッションは1時間のままとする。

create or replace function public.start_room_view_session_from_invitation(invitation_token text)
returns table (room_id uuid, room_name text, expires_at timestamptz, handoff_token text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_viewer_id uuid := auth.uid();
  target_room_id uuid;
  target_room_name text;
  session_expiry timestamptz := now() + interval '7 hours';
  generated_handoff_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if current_viewer_id is null then
    raise exception using errcode = '28000', message = '招待リンクを確認できませんでした。';
  end if;

  if invitation_token is null or invitation_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '28000', message = '招待リンクを確認できませんでした。';
  end if;

  select links.room_id, rooms.name
    into target_room_id, target_room_name
  from public.room_invitation_links as links
  join public.rooms on rooms.id = links.room_id
  where extensions.crypt(invitation_token, links.token_hash) = links.token_hash
  limit 1;

  if target_room_id is null then
    raise exception using errcode = '28000', message = '招待リンクを確認できませんでした。';
  end if;

  insert into public.room_viewer_sessions as sessions
    (viewer_id, room_id, expires_at, handoff_token_hash)
  values (
    current_viewer_id,
    target_room_id,
    session_expiry,
    extensions.crypt(generated_handoff_token, extensions.gen_salt('bf'))
  )
  on conflict on constraint room_viewer_sessions_pkey do update
  set expires_at = excluded.expires_at,
      handoff_token_hash = excluded.handoff_token_hash;

  return query
  select target_room_id, target_room_name, session_expiry, generated_handoff_token;
end;
$$;

comment on function public.start_room_view_session_from_invitation(text) is
  '招待トークンを照合し、閲覧専用の7時間セッションを開始する。';

notify pgrst, 'reload schema';
