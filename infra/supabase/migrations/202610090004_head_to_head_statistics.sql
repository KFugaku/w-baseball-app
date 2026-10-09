-- NOW BATTING の打者対投手成績（同一ルーム内の全試合通算）。
-- 打席イベントに保存済みの batter_id / pitcher_id を集計するため、追加テーブルは不要。

create index if not exists game_events_batter_pitcher_stats_idx
  on public.game_events (batter_id, pitcher_id, game_id, occurred_at desc)
  where plate_result is not null and reverted_at is null;

create or replace function public.get_player_matchup_statistics(
  target_room_id uuid,
  target_batter_key text,
  target_pitcher_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  batter_player_ids uuid[];
  pitcher_player_ids uuid[];
  matchup jsonb;
begin
  if auth.uid() is null or not (
    public.is_owned_room(target_room_id)
    or public.has_active_room_view_session(target_room_id)
  ) then
    raise exception using errcode = '42501', message = 'この対戦成績を表示する権限がありません。';
  end if;

  select coalesce(array_agg(players.id), '{}'::uuid[])
    into batter_player_ids
  from public.players
  join public.teams on teams.id = players.team_id
  where teams.room_id = target_room_id
    and players.client_key = target_batter_key;

  select coalesce(array_agg(players.id), '{}'::uuid[])
    into pitcher_player_ids
  from public.players
  join public.teams on teams.id = players.team_id
  where teams.room_id = target_room_id
    and players.client_key = target_pitcher_key;

  with totals as (
    select
      count(*) filter (
        where events.plate_result not in (
          'walk', 'hit_by_pitch', 'sacrifice_fly', 'sacrifice_bunt'
        )
      )::integer as at_bats,
      count(*) filter (
        where events.plate_result in ('single', 'double', 'triple', 'home_run')
      )::integer as hits
    from public.game_events as events
    join public.games on games.id = events.game_id
    where games.room_id = target_room_id
      and events.batter_id = any(batter_player_ids)
      and events.pitcher_id = any(pitcher_player_ids)
      and events.plate_result is not null
      and events.reverted_at is null
  )
  select jsonb_build_object(
    'at_bats', at_bats,
    'hits', hits,
    'batting_average', case when at_bats = 0 then null else hits::numeric / at_bats end
  ) into matchup
  from totals;

  return coalesce(matchup, jsonb_build_object(
    'at_bats', 0,
    'hits', 0,
    'batting_average', null
  ));
end;
$$;

revoke all on function public.get_player_matchup_statistics(uuid, text, text) from public, anon;
grant execute on function public.get_player_matchup_statistics(uuid, text, text) to authenticated;
