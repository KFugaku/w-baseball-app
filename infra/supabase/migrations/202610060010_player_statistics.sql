-- Issues #14 / #39: 選手ごとの打撃・投球成績と試合別打席結果
--
-- 画面内で使う player key をルーム内の players へ対応付け、完了した打席だけを
-- game_events に正規化して保存する。成績はイベントから集計するため、表示用の率を
-- 別テーブルへ重複保存しない。

alter table public.games
  add column if not exists scheduled_innings smallint not null default 9
  check (scheduled_innings between 1 and 20);

alter table public.players
  add column if not exists client_key text;

create unique index if not exists players_team_client_key_idx
  on public.players (team_id, client_key)
  where client_key is not null;

alter table public.game_events
  add column if not exists pitcher_id uuid references public.players(id) on delete set null,
  add column if not exists batting_side public.team_side,
  add column if not exists plate_result text,
  add column if not exists runs_batted_in smallint not null default 0 check (runs_batted_in >= 0),
  add column if not exists outs_recorded smallint not null default 0 check (outs_recorded between 0 and 3),
  add column if not exists base_runners_before smallint not null default 0 check (base_runners_before between 0 and 3),
  add column if not exists away_score_before integer check (away_score_before is null or away_score_before >= 0),
  add column if not exists home_score_before integer check (home_score_before is null or home_score_before >= 0),
  add column if not exists reverted_at timestamptz;

alter table public.game_events drop constraint if exists game_events_plate_result_check;
alter table public.game_events add constraint game_events_plate_result_check check (
  plate_result is null or plate_result in (
    'single', 'double', 'triple', 'home_run', 'walk', 'hit_by_pitch',
    'strikeout', 'groundout', 'flyout', 'lineout', 'sacrifice_fly', 'sacrifice_bunt'
  )
);

create index if not exists game_events_batter_stats_idx
  on public.game_events (batter_id, occurred_at desc)
  where plate_result is not null;
create index if not exists game_events_pitcher_stats_idx
  on public.game_events (pitcher_id, occurred_at desc)
  where plate_result is not null;

create table if not exists public.game_event_runs (
  event_id uuid not null references public.game_events(id) on delete cascade,
  run_number smallint not null check (run_number >= 1),
  scoring_side public.team_side not null,
  responsible_pitcher_id uuid references public.players(id) on delete set null,
  is_earned boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (event_id, run_number)
);

create index if not exists game_event_runs_pitcher_idx
  on public.game_event_runs (responsible_pitcher_id);

create table if not exists public.player_game_pitching_decisions (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  decision text not null check (decision in ('win', 'loss', 'save', 'hold')),
  created_at timestamptz not null default now(),
  primary key (game_id, player_id, decision)
);

alter table public.game_event_runs enable row level security;
alter table public.player_game_pitching_decisions enable row level security;
revoke all on table public.game_event_runs, public.player_game_pitching_decisions from anon, authenticated;
grant select on table public.game_event_runs, public.player_game_pitching_decisions to authenticated;

drop policy if exists "所有試合の得点責任だけを参照できる" on public.game_event_runs;
create policy "所有試合の得点責任だけを参照できる"
  on public.game_event_runs for select to authenticated
  using (exists (
    select 1 from public.game_events
    where game_events.id = game_event_runs.event_id
      and public.is_owned_game(game_events.game_id)
  ));

drop policy if exists "閲覧セッションの得点責任だけを参照できる" on public.game_event_runs;
create policy "閲覧セッションの得点責任だけを参照できる"
  on public.game_event_runs for select to authenticated
  using (exists (
    select 1 from public.game_events
    where game_events.id = game_event_runs.event_id
      and public.has_active_room_view_session_for_game(game_events.game_id)
  ));

drop policy if exists "所有試合の投手記録だけを参照できる" on public.player_game_pitching_decisions;
create policy "所有試合の投手記録だけを参照できる"
  on public.player_game_pitching_decisions for select to authenticated
  using (public.is_owned_game(game_id));

drop policy if exists "閲覧セッションの投手記録だけを参照できる" on public.player_game_pitching_decisions;
create policy "閲覧セッションの投手記録だけを参照できる"
  on public.player_game_pitching_decisions for select to authenticated
  using (public.has_active_room_view_session_for_game(game_id));

create or replace function public.ensure_game_player(
  target_game_id uuid,
  target_side public.team_side,
  target_client_key text,
  target_last_name text,
  target_first_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_team_id uuid;
  saved_player_id uuid;
  normalized_key text := nullif(trim(target_client_key), '');
  normalized_last_name text := nullif(trim(target_last_name), '');
  normalized_first_name text := trim(coalesce(target_first_name, ''));
begin
  if normalized_key is null or normalized_last_name is null
    or char_length(normalized_key) > 120
    or char_length(normalized_last_name) > 80
    or char_length(normalized_first_name) > 80 then
    return null;
  end if;

  select team_id into target_team_id
  from public.game_teams
  where game_id = target_game_id and side = target_side;

  if target_team_id is null then
    return null;
  end if;

  insert into public.players (team_id, client_key, last_name, first_name)
  values (target_team_id, normalized_key, normalized_last_name, normalized_first_name)
  on conflict (team_id, client_key) where client_key is not null do update
  set last_name = excluded.last_name,
      first_name = excluded.first_name
  returning id into saved_player_id;

  return saved_player_id;
end;
$$;

revoke all on function public.ensure_game_player(uuid, public.team_side, text, text, text)
  from public, anon, authenticated;

-- 試合終了時に投手の勝敗・セーブ・ホールドを確定する。
-- 勝利投手の先発要件は利用者仕様に合わせ、予定回数の半分を切り上げた回数とする。
create or replace function public.finalize_game_pitching_decisions(target_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_game public.games%rowtype;
  final_away integer;
  final_home integer;
  winner public.team_side;
  loser public.team_side;
  winning_pitcher uuid;
  losing_pitcher uuid;
  saving_pitcher uuid;
  starter_pitcher uuid;
  starter_outs integer;
  starter_last_sequence integer;
  required_starter_outs integer;
  permanent_lead_sequence integer;
  decisive_run_number integer;
  appearance record;
begin
  if not public.is_owned_game(target_game_id) then
    raise exception using errcode = '42501', message = 'この試合を確定する権限がありません。';
  end if;

  select * into target_game from public.games where id = target_game_id;
  select away_score, home_score into final_away, final_home
  from public.game_states where game_id = target_game_id;

  delete from public.player_game_pitching_decisions where game_id = target_game_id;
  if final_away = final_home then return; end if;

  winner := case when final_away > final_home then 'away'::public.team_side else 'home'::public.team_side end;
  loser := case when winner = 'away' then 'home'::public.team_side else 'away'::public.team_side end;
  required_starter_outs := ceil(target_game.scheduled_innings / 2.0)::integer * 3;

  select pitcher_id, sum(outs_recorded)::integer, max(sequence)
    into starter_pitcher, starter_outs, starter_last_sequence
  from public.game_events
  where game_id = target_game_id
    and plate_result is not null
    and reverted_at is null
    and pitcher_id is not null
    and batting_side = loser
    and pitcher_id = (
      select pitcher_id from public.game_events
      where game_id = target_game_id and plate_result is not null
        and reverted_at is null
        and pitcher_id is not null and batting_side = loser
      order by sequence limit 1
    )
  group by pitcher_id;

  if starter_pitcher is not null
    and starter_outs >= required_starter_outs
    and exists (
      select 1 from public.game_events
      where game_id = target_game_id and sequence = starter_last_sequence
        and case when winner = 'away'
          then (payload ->> 'away_score')::integer > (payload ->> 'home_score')::integer
          else (payload ->> 'home_score')::integer > (payload ->> 'away_score')::integer
        end
    )
    and not exists (
      select 1 from public.game_events
      where game_id = target_game_id and sequence > starter_last_sequence
        and case when winner = 'away'
          then (payload ->> 'away_score')::integer <= (payload ->> 'home_score')::integer
          else (payload ->> 'home_score')::integer <= (payload ->> 'away_score')::integer
        end
    ) then
    winning_pitcher := starter_pitcher;
  end if;

  -- 最後に勝ち越して以降、一度も同点または逆転されていない最初のイベント。
  select lead_event.sequence into permanent_lead_sequence
  from public.game_events as lead_event
  where lead_event.game_id = target_game_id
    and lead_event.plate_result is not null
    and lead_event.reverted_at is null
    and case when winner = 'away'
      then (lead_event.payload ->> 'away_score')::integer > (lead_event.payload ->> 'home_score')::integer
      else (lead_event.payload ->> 'home_score')::integer > (lead_event.payload ->> 'away_score')::integer
    end
    and not exists (
      select 1 from public.game_events as later_event
      where later_event.game_id = target_game_id
        and later_event.sequence > lead_event.sequence
        and later_event.plate_result is not null
        and later_event.reverted_at is null
        and case when winner = 'away'
          then (later_event.payload ->> 'away_score')::integer <= (later_event.payload ->> 'home_score')::integer
          else (later_event.payload ->> 'home_score')::integer <= (later_event.payload ->> 'away_score')::integer
        end
    )
  order by lead_event.sequence
  limit 1;

  if winning_pitcher is null then
    select pitcher_id into winning_pitcher
    from public.game_events
    where game_id = target_game_id
      and plate_result is not null
      and reverted_at is null
      and pitcher_id is not null
      and batting_side = loser
      and sequence < coalesce(permanent_lead_sequence, 2147483647)
    order by sequence desc limit 1;
    winning_pitcher := coalesce(winning_pitcher, starter_pitcher);
  end if;

  if permanent_lead_sequence is not null then
    select case when winner = 'away'
             then home_score_before - away_score_before + 1
             else away_score_before - home_score_before + 1
           end
      into decisive_run_number
    from public.game_events
    where game_id = target_game_id and sequence = permanent_lead_sequence;

    select runs.responsible_pitcher_id into losing_pitcher
    from public.game_events as events
    join public.game_event_runs as runs on runs.event_id = events.id
    where events.game_id = target_game_id
      and events.sequence = permanent_lead_sequence
      and runs.run_number = greatest(decisive_run_number, 1)
    limit 1;
  end if;

  if winning_pitcher is not null then
    insert into public.player_game_pitching_decisions (game_id, player_id, decision)
    values (target_game_id, winning_pitcher, 'win') on conflict do nothing;
  end if;
  if losing_pitcher is not null then
    insert into public.player_game_pitching_decisions (game_id, player_id, decision)
    values (target_game_id, losing_pitcher, 'loss') on conflict do nothing;
  end if;

  for appearance in
    with pitcher_events as (
      select
        pitcher_id,
        min(sequence) as first_sequence,
        max(sequence) as last_sequence,
        sum(outs_recorded)::integer as recorded_outs,
        (array_agg(away_score_before order by sequence))[1] as entry_away,
        (array_agg(home_score_before order by sequence))[1] as entry_home,
        (array_agg(base_runners_before order by sequence))[1] as entry_runners
      from public.game_events
      where game_id = target_game_id and plate_result is not null
        and reverted_at is null
        and pitcher_id is not null and batting_side = loser
      group by pitcher_id
    ), ordered as (
      select *,
        first_sequence = min(first_sequence) over () as is_starter,
        last_sequence = max(last_sequence) over () as is_finisher
      from pitcher_events
    )
    select * from ordered order by first_sequence
  loop
    if appearance.is_finisher
      and appearance.pitcher_id is distinct from winning_pitcher
      and appearance.recorded_outs >= 1
      and (case when winner = 'away' then appearance.entry_away > appearance.entry_home
                else appearance.entry_home > appearance.entry_away end)
      and (
        (abs(appearance.entry_away - appearance.entry_home) <= 3 and appearance.recorded_outs >= 3)
        or abs(appearance.entry_away - appearance.entry_home) <= appearance.entry_runners + 2
        or appearance.recorded_outs >= 9
      ) then
      saving_pitcher := appearance.pitcher_id;
      insert into public.player_game_pitching_decisions (game_id, player_id, decision)
      values (target_game_id, appearance.pitcher_id, 'save') on conflict do nothing;
    end if;
  end loop;

  for appearance in
    with pitcher_events as (
      select
        pitcher_id,
        min(sequence) as first_sequence,
        max(sequence) as last_sequence,
        sum(outs_recorded)::integer as recorded_outs,
        (array_agg(away_score_before order by sequence))[1] as entry_away,
        (array_agg(home_score_before order by sequence))[1] as entry_home,
        (array_agg(base_runners_before order by sequence))[1] as entry_runners
      from public.game_events
      where game_id = target_game_id and plate_result is not null
        and reverted_at is null
        and pitcher_id is not null and batting_side = loser
      group by pitcher_id
    ), ordered as (
      select *,
        first_sequence = min(first_sequence) over () as is_starter,
        last_sequence = max(last_sequence) over () as is_finisher
      from pitcher_events
    )
    select * from ordered order by first_sequence
  loop
    if not appearance.is_starter
      and not appearance.is_finisher
      and appearance.pitcher_id is distinct from winning_pitcher
      and appearance.pitcher_id is distinct from saving_pitcher
      and appearance.recorded_outs >= 1
      and (case when winner = 'away' then appearance.entry_away > appearance.entry_home
                else appearance.entry_home > appearance.entry_away end)
      and not exists (
        select 1 from public.game_events
        where game_id = target_game_id
          and sequence between appearance.first_sequence and appearance.last_sequence
          and case when winner = 'away'
            then (payload ->> 'away_score')::integer <= (payload ->> 'home_score')::integer
            else (payload ->> 'home_score')::integer <= (payload ->> 'away_score')::integer
          end
      )
      and (
        (abs(appearance.entry_away - appearance.entry_home) <= 3 and appearance.recorded_outs >= 3)
        or abs(appearance.entry_away - appearance.entry_home) <= appearance.entry_runners + 2
        or appearance.recorded_outs >= 9
      ) then
      insert into public.player_game_pitching_decisions (game_id, player_id, decision)
      values (target_game_id, appearance.pitcher_id, 'hold') on conflict do nothing;
    end if;
  end loop;
end;
$$;

revoke all on function public.finalize_game_pitching_decisions(uuid)
  from public, anon, authenticated;

drop function if exists public.apply_game_event(
  uuid, bigint, uuid, text, text, smallint, public.inning_half, smallint, smallint,
  smallint, smallint, integer, integer, jsonb, public.game_status
);

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
  target_status public.game_status default 'live',
  target_batter jsonb default null,
  target_pitcher jsonb default null,
  target_plate_result text default null,
  target_runs_batted_in smallint default 0,
  target_outs_recorded smallint default 0,
  target_run_responsible_pitcher_keys text[] default '{}'::text[],
  target_base_runners_before smallint default 0,
  target_revert_last_plate_appearance boolean default false,
  target_plate_inning smallint default null,
  target_plate_half public.inning_half default null
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
  inserted_event_id uuid;
  event_inning smallint := coalesce(target_plate_inning, target_inning);
  event_half public.inning_half := coalesce(target_plate_half, target_half);
  batting_team_side public.team_side := case when event_half = 'top' then 'away' else 'home' end;
  fielding_team_side public.team_side := case when event_half = 'top' then 'home' else 'away' end;
  saved_batter_id uuid;
  saved_pitcher_id uuid;
  responsible_key text;
  responsible_pitcher_id uuid;
  run_index smallint := 0;
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
    or target_snapshot is null or jsonb_typeof(target_snapshot) <> 'object'
    or (target_plate_inning is not null and target_plate_inning < 1)
    or target_runs_batted_in < 0
    or target_outs_recorded not between 0 and 3
    or target_base_runners_before not between 0 and 3 then
    raise exception using errcode = '22023', message = '試合状況の値が正しくありません。';
  end if;
  if target_plate_result is not null and target_plate_result not in (
    'single', 'double', 'triple', 'home_run', 'walk', 'hit_by_pitch',
    'strikeout', 'groundout', 'flyout', 'lineout', 'sacrifice_fly', 'sacrifice_bunt'
  ) then
    raise exception using errcode = '22023', message = '打席結果が正しくありません。';
  end if;

  select * into current_game from public.games where id = target_game_id;
  if not found then
    raise exception using errcode = 'P0002', message = '試合が見つかりません。';
  end if;
  if current_game.status = 'finished' then
    raise exception using errcode = '22023', message = '終了した試合は更新できません。';
  end if;
  if target_status is null
    or (current_game.status = 'before' and target_status not in ('before', 'live'))
    or (current_game.status = 'live' and target_status not in ('live', 'finished')) then
    raise exception using errcode = '22023', message = '試合ステータスが正しくありません。';
  end if;

  select * into current_state from public.game_states
  where game_id = target_game_id for update;
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

  if target_plate_result is not null then
    saved_batter_id := public.ensure_game_player(
      target_game_id, batting_team_side, target_batter ->> 'key',
      target_batter ->> 'last_name', target_batter ->> 'first_name'
    );
    saved_pitcher_id := public.ensure_game_player(
      target_game_id, fielding_team_side, target_pitcher ->> 'key',
      target_pitcher ->> 'last_name', target_pitcher ->> 'first_name'
    );
    if saved_batter_id is null or saved_pitcher_id is null then
      raise exception using errcode = '22023', message = '打者または投手を確認できません。';
    end if;
  end if;

  update public.game_states
  set inning = target_inning, half = target_half, balls = target_balls,
      strikes = target_strikes, outs = target_outs, batter_order = target_batter_order,
      away_score = target_away_score, home_score = target_home_score,
      snapshot = target_snapshot, revision = current_state.revision + 1
  where game_id = target_game_id
  returning * into current_state;

  update public.game_teams
  set score = case side when 'away' then target_away_score when 'home' then target_home_score end
  where game_id = target_game_id;
  update public.games set status = target_status where id = target_game_id;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.game_events where game_id = target_game_id;

  insert into public.game_events (
    game_id, sequence, inning, half, event_type, description, client_event_id, payload,
    batter_id, pitcher_id, batting_side, plate_result, runs_batted_in, outs_recorded,
    base_runners_before, away_score_before, home_score_before
  ) values (
    target_game_id, next_sequence, event_inning, event_half, target_event_type,
    target_description, target_client_event_id,
    jsonb_build_object(
      'revision', current_state.revision,
      'away_score', target_away_score,
      'home_score', target_home_score
    ),
    saved_batter_id, saved_pitcher_id,
    case when target_plate_result is null then null else batting_team_side end,
    target_plate_result, target_runs_batted_in, target_outs_recorded,
    target_base_runners_before, null, null
  ) returning id into inserted_event_id;

  if target_revert_last_plate_appearance then
    update public.game_events as reverted
    set reverted_at = now()
    where reverted.id = (
      select previous.id
      from public.game_events as previous
      where previous.game_id = target_game_id
        and previous.sequence < next_sequence
        and previous.plate_result is not null
        and previous.reverted_at is null
      order by previous.sequence desc
      limit 1
    );
  end if;

  -- update後のcurrent_stateでは更新前得点を失うため、イベントのbefore列を差分ではなく
  -- 直前イベントのafter（初回は0）から確定する。
  if target_plate_result is not null then
    update public.game_events as saved
    set away_score_before = coalesce((
          select (previous.payload ->> 'away_score')::integer
          from public.game_events as previous
          where previous.game_id = target_game_id and previous.sequence < next_sequence
          order by previous.sequence desc limit 1
        ), 0),
        home_score_before = coalesce((
          select (previous.payload ->> 'home_score')::integer
          from public.game_events as previous
          where previous.game_id = target_game_id and previous.sequence < next_sequence
          order by previous.sequence desc limit 1
        ), 0)
    where saved.id = inserted_event_id;

    foreach responsible_key in array coalesce(target_run_responsible_pitcher_keys, '{}'::text[]) loop
      run_index := run_index + 1;
      -- 走者を出した時点の投手をclient keyから引く。現在の投手と異なる場合に
      -- 現在投手の氏名で上書きしないよう、ここでは新規作成しない。
      select players.id into responsible_pitcher_id
      from public.players
      join public.game_teams on game_teams.team_id = players.team_id
      where game_teams.game_id = target_game_id
        and game_teams.side = fielding_team_side
        and players.client_key = responsible_key
      limit 1;

      if responsible_key = target_pitcher ->> 'key' then
        responsible_pitcher_id := coalesce(responsible_pitcher_id, saved_pitcher_id);
      end if;

      insert into public.game_event_runs (
        event_id, run_number, scoring_side, responsible_pitcher_id, is_earned
      ) values (
        inserted_event_id, run_index, batting_team_side,
        coalesce(responsible_pitcher_id, saved_pitcher_id), true
      );
    end loop;
  end if;

  if target_status = 'finished' then
    perform public.finalize_game_pitching_decisions(target_game_id);
  end if;

  return query select current_state.revision, current_state.updated_at;
end;
$$;

revoke all on function public.apply_game_event(
  uuid, bigint, uuid, text, text, smallint, public.inning_half, smallint, smallint,
  smallint, smallint, integer, integer, jsonb, public.game_status, jsonb, jsonb,
  text, smallint, smallint, text[], smallint, boolean, smallint, public.inning_half
) from public, anon;
grant execute on function public.apply_game_event(
  uuid, bigint, uuid, text, text, smallint, public.inning_half, smallint, smallint,
  smallint, smallint, integer, integer, jsonb, public.game_status, jsonb, jsonb,
  text, smallint, smallint, text[], smallint, boolean, smallint, public.inning_half
) to authenticated;

create or replace function public.get_player_statistics(
  target_room_id uuid,
  target_player_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  player_ids uuid[];
  batting jsonb;
  pitching jsonb;
  appearances jsonb;
begin
  if auth.uid() is null or not (
    public.is_owned_room(target_room_id)
    or public.has_active_room_view_session(target_room_id)
  ) then
    raise exception using errcode = '42501', message = 'この選手の成績を表示する権限がありません。';
  end if;

  select coalesce(array_agg(players.id), '{}'::uuid[]) into player_ids
  from public.players
  join public.teams on teams.id = players.team_id
  where teams.room_id = target_room_id and players.client_key = target_player_key;

  with totals as (
    select
      count(distinct events.game_id)::integer as games,
      count(*) filter (where events.plate_result not in ('walk', 'hit_by_pitch', 'sacrifice_fly', 'sacrifice_bunt'))::integer as at_bats,
      count(*) filter (where events.plate_result in ('single', 'double', 'triple', 'home_run'))::integer as hits,
      count(*) filter (where events.plate_result = 'double')::integer as doubles,
      count(*) filter (where events.plate_result = 'triple')::integer as triples,
      count(*) filter (where events.plate_result = 'home_run')::integer as home_runs,
      count(*) filter (where events.plate_result = 'walk')::integer as walks,
      count(*) filter (where events.plate_result = 'hit_by_pitch')::integer as hit_by_pitch,
      count(*) filter (where events.plate_result = 'strikeout')::integer as strikeouts,
      count(*) filter (where events.plate_result = 'sacrifice_fly')::integer as sacrifice_flies,
      coalesce(sum(events.runs_batted_in), 0)::integer as runs_batted_in,
      coalesce(sum(case events.plate_result
        when 'single' then 1 when 'double' then 2 when 'triple' then 3 when 'home_run' then 4 else 0 end), 0)::integer as total_bases
    from public.game_events as events
    join public.games on games.id = events.game_id
    where games.room_id = target_room_id
      and events.batter_id = any(player_ids)
      and events.plate_result is not null
      and events.reverted_at is null
  )
  select jsonb_build_object(
    'games', games, 'at_bats', at_bats, 'hits', hits,
    'home_runs', home_runs, 'walks', walks, 'hit_by_pitch', hit_by_pitch,
    'strikeouts', strikeouts, 'runs_batted_in', runs_batted_in,
    'batting_average', case when at_bats = 0 then null else hits::numeric / at_bats end,
    'on_base_percentage', case when at_bats + walks + hit_by_pitch + sacrifice_flies = 0 then null
      else (hits + walks + hit_by_pitch)::numeric / (at_bats + walks + hit_by_pitch + sacrifice_flies) end,
    'slugging_percentage', case when at_bats = 0 then null else total_bases::numeric / at_bats end,
    'ops', case when at_bats = 0 or at_bats + walks + hit_by_pitch + sacrifice_flies = 0 then null
      else total_bases::numeric / at_bats
        + (hits + walks + hit_by_pitch)::numeric / (at_bats + walks + hit_by_pitch + sacrifice_flies) end
  ) into batting from totals;

  with event_totals as (
    select
      count(distinct events.game_id)::integer as appearances,
      coalesce(sum(events.outs_recorded), 0)::integer as outs_recorded,
      count(*) filter (where events.plate_result = 'walk')::integer as walks,
      count(*) filter (where events.plate_result = 'strikeout')::integer as strikeouts,
      count(*) filter (where events.plate_result in ('single', 'double', 'triple', 'home_run'))::integer as hits_allowed
    from public.game_events as events
    join public.games on games.id = events.game_id
    where games.room_id = target_room_id
      and events.pitcher_id = any(player_ids)
      and events.plate_result is not null
      and events.reverted_at is null
  ), run_totals as (
    select count(*) filter (where runs.is_earned)::integer as earned_runs
    from public.game_event_runs as runs
    join public.game_events as events on events.id = runs.event_id
    join public.games on games.id = events.game_id
    where games.room_id = target_room_id
      and runs.responsible_pitcher_id = any(player_ids)
      and events.reverted_at is null
  ), decision_totals as (
    select
      count(*) filter (where decisions.decision = 'win')::integer as wins,
      count(*) filter (where decisions.decision = 'loss')::integer as losses,
      count(*) filter (where decisions.decision = 'save')::integer as saves,
      count(*) filter (where decisions.decision = 'hold')::integer as holds
    from public.player_game_pitching_decisions as decisions
    join public.games on games.id = decisions.game_id
    where games.room_id = target_room_id and decisions.player_id = any(player_ids)
  )
  select jsonb_build_object(
    'appearances', events.appearances,
    'outs_recorded', events.outs_recorded,
    'wins', decisions.wins, 'losses', decisions.losses,
    'saves', decisions.saves, 'holds', decisions.holds,
    'walks', events.walks, 'strikeouts', events.strikeouts,
    'hits_allowed', events.hits_allowed, 'earned_runs', runs.earned_runs,
    'earned_run_average', case when events.outs_recorded = 0 then null
      else runs.earned_runs::numeric * 27 / events.outs_recorded end
  ) into pitching
  from event_totals as events cross join run_totals as runs cross join decision_totals as decisions;

  select coalesce(jsonb_agg(game_result order by latest_at desc), '[]'::jsonb)
    into appearances
  from (
    select
      max(events.occurred_at) as latest_at,
      jsonb_build_object(
        'game_id', games.id,
        'game_title', games.title,
        'played_at', coalesce(games.scheduled_at, games.created_at),
        'results', jsonb_agg(jsonb_build_object(
          'inning', events.inning,
          'half', events.half,
          'result', events.plate_result,
          'description', events.description,
          'occurred_at', events.occurred_at
        ) order by events.sequence)
      ) as game_result
    from public.game_events as events
    join public.games on games.id = events.game_id
    where games.room_id = target_room_id
      and events.batter_id = any(player_ids)
      and events.plate_result is not null
      and events.reverted_at is null
    group by games.id, games.title, games.scheduled_at, games.created_at
  ) as per_game;

  return jsonb_build_object(
    'batting', coalesce(batting, '{}'::jsonb),
    'pitching', coalesce(pitching, '{}'::jsonb),
    'plate_appearances', appearances
  );
end;
$$;

revoke all on function public.get_player_statistics(uuid, text) from public, anon;
grant execute on function public.get_player_statistics(uuid, text) to authenticated;

-- 予定回数を試合作成時に保存し、先発勝利投手の必要投球回を判定できるようにする。
drop function if exists public.create_owned_game(uuid, text, text, text, text, text);
drop function if exists public.create_owned_game(uuid, text, text, text, text, text, smallint);

create function public.create_owned_game(
  target_room_id uuid,
  target_title text,
  target_away_name text,
  target_away_color text,
  target_home_name text,
  target_home_color text,
  target_scheduled_innings smallint
)
returns table (
  room_id uuid, room_name text, room_number text, game_id uuid, game_title text,
  scheduled_innings smallint,
  away_team_name text, away_team_color text, home_team_name text, home_team_color text
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
  if auth.uid() is null then raise exception 'ログインが必要です。'; end if;
  select * into active_room from public.rooms
  where id = target_room_id and owner_id = auth.uid();
  if not found then raise exception '選択したルームを利用する権限がありません。'; end if;
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
  if target_scheduled_innings is null or target_scheduled_innings not between 1 and 20 then
    raise exception '予定回数を1〜20回で入力してください。';
  end if;

  normalized_title := nullif(trim(target_title), '');
  if normalized_title is null then
    normalized_title := format('第%s試合', (
      select count(*) + 1 from public.games where room_id = active_room.id
    ));
  end if;
  if char_length(normalized_title) not between 1 and 120 then
    raise exception '試合名は1〜120文字で入力してください。';
  end if;

  select id into away_team_id from public.teams
  where room_id = active_room.id and name = normalized_away_name;
  if away_team_id is null then
    insert into public.teams (room_id, name, color)
    values (active_room.id, normalized_away_name, normalized_away_color)
    returning id into away_team_id;
  end if;
  select id into home_team_id from public.teams
  where room_id = active_room.id and name = normalized_home_name;
  if home_team_id is null then
    insert into public.teams (room_id, name, color)
    values (active_room.id, normalized_home_name, normalized_home_color)
    returning id into home_team_id;
  end if;

  insert into public.games (room_id, title, status, scheduled_innings)
  values (active_room.id, normalized_title, 'before', target_scheduled_innings)
  returning * into new_game;
  insert into public.game_teams (game_id, team_id, side, score)
  values (new_game.id, away_team_id, 'away', 0), (new_game.id, home_team_id, 'home', 0);
  insert into public.game_states (game_id) values (new_game.id);
  update public.profiles set last_room_id = active_room.id where id = auth.uid();

  return query select active_room.id, active_room.name, active_room.room_number,
    new_game.id, new_game.title, new_game.scheduled_innings,
    normalized_away_name, normalized_away_color, normalized_home_name, normalized_home_color;
end;
$$;

revoke all on function public.create_owned_game(uuid, text, text, text, text, text, smallint)
  from public, anon;
grant execute on function public.create_owned_game(uuid, text, text, text, text, text, smallint)
  to authenticated;

notify pgrst, 'reload schema';
