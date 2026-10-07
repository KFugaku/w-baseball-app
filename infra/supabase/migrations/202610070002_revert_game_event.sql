-- Issue #42: 直近の試合操作を、状態と成績を矛盾させずに取り消す。
-- 打席結果の行は削除せず reverted_at を設定するため、成績集計・試合経過の双方から除外できる。

create or replace function public.revert_game_event(
  target_game_id uuid,
  expected_revision bigint,
  target_client_event_id uuid,
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
  reverted_event_id uuid;
  next_sequence integer;
begin
  if auth.uid() is null or not public.is_owned_game(target_game_id) then
    raise exception using errcode = '42501', message = 'この試合を更新する権限がありません。';
  end if;
  if target_client_event_id is null then
    raise exception using errcode = '22023', message = 'イベント識別子が必要です。';
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

  select * into current_game
  from public.games
  where id = target_game_id;
  if not found then
    raise exception using errcode = 'P0002', message = '試合が見つかりません。';
  end if;
  if current_game.status <> 'live' or target_status <> 'live' then
    raise exception using errcode = '22023', message = '試合中のみ操作を取り消せます。';
  end if;

  select * into current_state
  from public.game_states
  where game_id = target_game_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '試合状況が見つかりません。';
  end if;

  if exists (
    select 1 from public.game_events
    where game_id = target_game_id
      and client_event_id = target_client_event_id
  ) then
    return query select current_state.revision, current_state.updated_at;
    return;
  end if;
  if expected_revision is null or current_state.revision <> expected_revision then
    raise exception using errcode = '40001', message = '別の画面で試合が更新されています。画面を再読み込みしてください。';
  end if;

  select id into reverted_event_id
  from public.game_events
  where game_id = target_game_id
    and reverted_at is null
    and event_type <> 'state_reverted'
  order by sequence desc
  limit 1;
  if reverted_event_id is null then
    raise exception using errcode = '22023', message = '取り消せる操作がありません。';
  end if;

  update public.game_events
  set reverted_at = now()
  where id = reverted_event_id;

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

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.game_events
  where game_id = target_game_id;

  insert into public.game_events (
    game_id, sequence, inning, half, event_type, description, client_event_id, payload
  ) values (
    target_game_id, next_sequence, target_inning, target_half,
    'state_reverted', '一つ前の操作を取り消しました', target_client_event_id,
    jsonb_build_object(
      'revision', current_state.revision,
      'away_score', target_away_score,
      'home_score', target_home_score,
      'reverted_event_id', reverted_event_id
    )
  );

  return query select current_state.revision, current_state.updated_at;
end;
$$;

revoke all on function public.revert_game_event(
  uuid, bigint, uuid, smallint, public.inning_half, smallint, smallint,
  smallint, smallint, integer, integer, jsonb, public.game_status
) from public, anon;
grant execute on function public.revert_game_event(
  uuid, bigint, uuid, smallint, public.inning_half, smallint, smallint,
  smallint, smallint, integer, integer, jsonb, public.game_status
) to authenticated;

notify pgrst, 'reload schema';
