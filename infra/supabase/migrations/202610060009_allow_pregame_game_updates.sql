-- Issue #12: 試合開始前の打順・守備編集を保存しつつ、開始前から速報中への遷移を保証する。

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
  if target_status is null then
    raise exception using errcode = '22023', message = '試合ステータスが正しくありません。';
  end if;
  if current_game.status = 'before' and target_status not in ('before', 'live') then
    raise exception using errcode = '22023', message = '試合開始前は開始前の編集または試合開始のみ行えます。';
  end if;
  if current_game.status = 'live' and target_status not in ('live', 'finished') then
    raise exception using errcode = '22023', message = '試合中は試合中の更新または試合終了のみ行えます。';
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

notify pgrst, 'reload schema';
