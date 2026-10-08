-- Issue #52: 試合画面用に、複数選手の個人成績を一括取得する。
-- player_key は画面に表示する氏名ではなく、打順・イベントに保存する client_key を使う。
-- そのため同姓同名や別チームの別選手を氏名だけで混同しない。

create or replace function public.get_room_player_stat_summaries(
  target_room_id uuid,
  target_player_keys text[]
)
returns table (
  player_key text,
  batting jsonb,
  pitching jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not (
    public.is_owned_room(target_room_id)
    or public.has_active_room_view_session(target_room_id)
  ) then
    raise exception using errcode = '42501', message = 'この選手の成績を表示する権限がありません。';
  end if;

  return query
  with requested_keys as (
    select distinct nullif(btrim(requested_key), '') as player_key
    from unnest(coalesce(target_player_keys, '{}'::text[])) as requested_key
    where nullif(btrim(requested_key), '') is not null
  ), target_players as (
    select players.id, players.client_key
    from public.players
    join public.teams on teams.id = players.team_id
    join requested_keys on requested_keys.player_key = players.client_key
    where teams.room_id = target_room_id
  ), batting_totals as (
    select
      requested_keys.player_key,
      count(distinct events.game_id) filter (where events.plate_result is not null)::integer as games,
      count(*) filter (
        where events.plate_result not in ('walk', 'hit_by_pitch', 'sacrifice_fly', 'sacrifice_bunt')
      )::integer as at_bats,
      count(*) filter (where events.plate_result in ('single', 'double', 'triple', 'home_run'))::integer as hits,
      count(*) filter (where events.plate_result = 'home_run')::integer as home_runs,
      coalesce(sum(events.runs_batted_in), 0)::integer as runs_batted_in
    from requested_keys
    left join target_players on target_players.client_key = requested_keys.player_key
    left join public.game_events as events
      on events.batter_id = target_players.id
      and events.plate_result is not null
      and events.reverted_at is null
    left join public.games on games.id = events.game_id and games.room_id = target_room_id
    where events.game_id is null or games.id is not null
    group by requested_keys.player_key
  ), pitching_events as (
    select
      requested_keys.player_key,
      count(distinct events.game_id) filter (where events.plate_result is not null)::integer as appearances,
      coalesce(sum(events.outs_recorded), 0)::integer as outs_recorded
    from requested_keys
    left join target_players on target_players.client_key = requested_keys.player_key
    left join public.game_events as events
      on events.pitcher_id = target_players.id
      and events.plate_result is not null
      and events.reverted_at is null
    left join public.games on games.id = events.game_id and games.room_id = target_room_id
    where events.game_id is null or games.id is not null
    group by requested_keys.player_key
  ), pitching_runs as (
    select
      requested_keys.player_key,
      count(*) filter (where runs.is_earned)::integer as earned_runs
    from requested_keys
    left join target_players on target_players.client_key = requested_keys.player_key
    left join public.game_event_runs as runs on runs.responsible_pitcher_id = target_players.id
    left join public.game_events as events on events.id = runs.event_id and events.reverted_at is null
    left join public.games on games.id = events.game_id and games.room_id = target_room_id
    where runs.id is null or games.id is not null
    group by requested_keys.player_key
  )
  select
    requested_keys.player_key,
    jsonb_build_object(
      'games', coalesce(batting_totals.games, 0),
      'at_bats', coalesce(batting_totals.at_bats, 0),
      'hits', coalesce(batting_totals.hits, 0),
      'home_runs', coalesce(batting_totals.home_runs, 0),
      'runs_batted_in', coalesce(batting_totals.runs_batted_in, 0),
      'batting_average', case
        when coalesce(batting_totals.at_bats, 0) = 0 then null
        else batting_totals.hits::numeric / batting_totals.at_bats
      end
    ),
    jsonb_build_object(
      'appearances', coalesce(pitching_events.appearances, 0),
      'outs_recorded', coalesce(pitching_events.outs_recorded, 0),
      'earned_runs', coalesce(pitching_runs.earned_runs, 0),
      'earned_run_average', case
        when coalesce(pitching_events.outs_recorded, 0) = 0 then null
        else coalesce(pitching_runs.earned_runs, 0)::numeric * 27 / pitching_events.outs_recorded
      end
    )
  from requested_keys
  left join batting_totals on batting_totals.player_key = requested_keys.player_key
  left join pitching_events on pitching_events.player_key = requested_keys.player_key
  left join pitching_runs on pitching_runs.player_key = requested_keys.player_key;
end;
$$;

revoke all on function public.get_room_player_stat_summaries(uuid, text[]) from public, anon;
grant execute on function public.get_room_player_stat_summaries(uuid, text[]) to authenticated;
