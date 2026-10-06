-- Issue #10: 試合イベント・現在状態・一覧スコアを1回のRPCで更新する。
-- クライアントから各テーブルを個別に更新させず、競合検出と時系列イベントをDB側で保証する。

alter table public.game_states
  add column if not exists revision bigint not null default 0 check (revision >= 0);

alter table public.game_events
  add column if not exists client_event_id uuid;

create unique index if not exists game_events_game_client_event_idx
  on public.game_events (game_id, client_event_id)
  where client_event_id is not null;

create or replace function public.apply_game_event(
  target_game_id uuid,
  expected_revision bigint,
  target_client_event_id uuid,
  target_event_type text,
  target_description text,
  target_inning smallint,
  target_half public.inning_half,
  target_balls smallint,
  target_strikes smallint,
  target_outs smallint,
  target_batter_order smallint,
  target_away_score integer,
  target_home_score integer,
  target_snapshot jsonb,
  target_status public.game_status default 'live'
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_state public.game_states%rowtype;
  current_game public.games%rowtype;
  next_sequence integer;
begin
  if auth.uid() is null or not public.is_owned_game(target_game_id) then
    raise exception using errcode = '42501', message = 'この試合を更新する権限がありません。';
  end if;

  if target_client_event_id is null then
    raise exception using errcode = '22023', message = 'イベント識別子が必要です。';
  end if;
  if coalesce(target_event_type, '') !~ '^[a-z][a-z0-9_]{0,49}$' then
    raise exception using errcode = '22023', message = 'イベント種別が正しくありません。';
  end if;
  if char_length(coalesce(target_description, '')) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'イベント内容は1〜500文字で指定してください。';
  end if;
  if target_inning is null or target_inning < 1
    or target_balls is null or target_balls not between 0 and 3
    or target_strikes is null or target_strikes not between 0 and 2
    or target_outs is null or target_outs not between 0 and 2
    or target_batter_order is null or target_batter_order < 0
    or target_away_score is null or target_away_score < 0
    or target_home_score is null or target_home_score < 0
    or target_snapshot is null or jsonb_typeof(target_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = '試合状況の値が正しくありません。';
  end if;

  select * into current_game from public.games where id = target_game_id;
  if not found then
    raise exception using errcode = 'P0002', message = '試合が見つかりません。';
  end if;
  if current_game.status = 'finished' then
    raise exception using errcode = '22023', message = '終了した試合は更新できません。';
  end if;
  if target_status not in ('live', 'finished') then
    raise exception using errcode = '22023', message = 'この操作では試合を開始または終了する必要があります。';
  end if;

  select * into current_state
  from public.game_states
  where game_id = target_game_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '試合状況が見つかりません。';
  end if;

  -- 同じ端末が通信を再送しても、イベントを二重に記録しない。
  if exists (
    select 1 from public.game_events
    where game_id = target_game_id and client_event_id = target_client_event_id
  ) then
    return query select current_state.revision, current_state.updated_at;
    return;
  end if;

  if expected_revision is null or current_state.revision <> expected_revision then
    raise exception using errcode = '40001', message = '別の画面で試合が更新されています。画面を再読み込みしてください。';
  end if;

  update public.game_states
  set inning = target_inning,
      half = target_half,
      balls = target_balls,
      strikes = target_strikes,
      outs = target_outs,
      batter_order = target_batter_order,
      away_score = target_away_score,
      home_score = target_home_score,
      snapshot = target_snapshot,
      revision = current_state.revision + 1
  where game_id = target_game_id
  returning * into current_state;

  update public.game_teams
  set score = case side
    when 'away' then target_away_score
    when 'home' then target_home_score
  end
  where game_id = target_game_id;

  update public.games
  set status = target_status
  where id = target_game_id;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.game_events
  where game_id = target_game_id;

  insert into public.game_events (
    game_id, sequence, inning, half, event_type, description, client_event_id, payload
  ) values (
    target_game_id, next_sequence, target_inning, target_half, target_event_type,
    target_description, target_client_event_id,
    jsonb_build_object('revision', current_state.revision, 'away_score', target_away_score, 'home_score', target_home_score)
  );

  return query select current_state.revision, current_state.updated_at;
end;
$$;

revoke all on function public.apply_game_event(
  uuid, bigint, uuid, text, text, smallint, public.inning_half, smallint, smallint,
  smallint, smallint, integer, integer, jsonb, public.game_status
) from public, anon;
grant execute on function public.apply_game_event(
  uuid, bigint, uuid, text, text, smallint, public.inning_half, smallint, smallint,
  smallint, smallint, integer, integer, jsonb, public.game_status
) to authenticated;

-- 試合進行は必ず上のRPCを通す。閲覧に必要な select 権限は維持する。
revoke insert, update, delete on table public.games, public.game_teams,
  public.game_states, public.game_events from authenticated;

-- Realtime用のpublicationへ未登録のテーブルだけを追加する。
do $$
declare
  table_name text;
begin
  foreach table_name in array array['games', 'game_teams', 'game_states', 'game_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
