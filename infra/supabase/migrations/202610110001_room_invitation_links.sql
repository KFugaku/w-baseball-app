-- Issue #56: ルーム招待リンク
--
-- URL に含めるトークンは閲覧権限を開始できる bearer secret なので、DB には
-- bcrypt ハッシュだけを保持する。再発行時は同じ room_id の行を更新し、旧URLを失効させる。

create table public.room_invitation_links (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  token_hash text not null check (char_length(token_hash) >= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger room_invitation_links_set_updated_at before update on public.room_invitation_links
for each row execute function public.set_updated_at();

alter table public.room_invitation_links enable row level security;

-- 招待トークンのハッシュは、所有者も含めて Data API からは読書きさせない。
revoke all on table public.room_invitation_links from public, anon, authenticated;

create function public.create_room_invitation_link(target_room_id uuid)
returns table (invitation_token text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  owned_room_id uuid;
  generated_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if current_user_id is null then
    raise exception 'ログインが必要です。';
  end if;

  -- 所有者であることをロック付きで確認してから、トークンを再発行する。
  select rooms.id
    into owned_room_id
  from public.rooms
  where rooms.id = target_room_id
    and rooms.owner_id = current_user_id
  for update;

  if owned_room_id is null then
    raise exception 'このルームの招待リンクを発行する権限がありません。';
  end if;

  insert into public.room_invitation_links as links (room_id, token_hash)
  values (
    owned_room_id,
    extensions.crypt(generated_token, extensions.gen_salt('bf'))
  )
  on conflict (room_id) do update
  set token_hash = excluded.token_hash,
      updated_at = now();

  return query select generated_token;
end;
$$;

create function public.start_room_view_session_from_invitation(invitation_token text)
returns table (room_id uuid, room_name text, expires_at timestamptz, handoff_token text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_viewer_id uuid := auth.uid();
  target_room_id uuid;
  target_room_name text;
  session_expiry timestamptz := now() + interval '1 hour';
  generated_handoff_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if current_viewer_id is null then
    raise exception using errcode = '28000', message = '招待リンクを確認できませんでした。';
  end if;

  -- フォーマット不正・削除済み・再発行済みは、すべて同じ失敗として扱う。
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

revoke all on function public.create_room_invitation_link(uuid),
  public.start_room_view_session_from_invitation(text)
  from public, anon;

grant execute on function public.create_room_invitation_link(uuid) to authenticated;
grant execute on function public.start_room_view_session_from_invitation(text) to authenticated;

comment on function public.create_room_invitation_link(uuid) is
  '所有者だけが1ルーム1本の招待リンクを発行する。再発行で旧リンクを失効させる。';
comment on function public.start_room_view_session_from_invitation(text) is
  '招待トークンを照合し、閲覧専用の1時間セッションを開始する。';

notify pgrst, 'reload schema';
