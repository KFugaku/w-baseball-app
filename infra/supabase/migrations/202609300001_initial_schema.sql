-- Issue #8: 草野球速報で扱う試合データの初期スキーマ
-- 認証と RLS ポリシーは Issue #9 で追加する。

create type public.game_status as enum ('before', 'live', 'finished');
create type public.team_side as enum ('away', 'home');
create type public.lineup_role as enum ('starter', 'bench');
create type public.inning_half as enum ('top', 'bottom');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  last_name text not null check (char_length(last_name) between 1 and 80),
  first_name text not null default '' check (char_length(first_name) <= 80),
  icon_url text,
  batting_average numeric(4, 3) check (batting_average is null or batting_average between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  status public.game_status not null default 'before',
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  side public.team_side not null,
  score integer not null default 0 check (score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, side)
);

create table public.lineups (
  id uuid primary key default gen_random_uuid(),
  game_team_id uuid not null references public.game_teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  batting_order smallint check (batting_order between 1 and 99),
  field_position text check (field_position is null or char_length(field_position) between 1 and 20),
  role public.lineup_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_team_id, player_id),
  check ((role = 'starter' and batting_order is not null) or (role = 'bench' and batting_order is null))
);

create table public.game_states (
  game_id uuid primary key references public.games(id) on delete cascade,
  inning smallint not null default 1 check (inning >= 1),
  half public.inning_half not null default 'top',
  balls smallint not null default 0 check (balls between 0 and 3),
  strikes smallint not null default 0 check (strikes between 0 and 2),
  outs smallint not null default 0 check (outs between 0 and 2),
  batter_order smallint not null default 0 check (batter_order >= 0),
  away_score integer not null default 0 check (away_score >= 0),
  home_score integer not null default 0 check (home_score >= 0),
  -- 既存UIの復元用。正規化済みの列とイベントは検索・集計に使用する。
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.game_runners (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  base smallint not null check (base between 1 and 3),
  player_id uuid not null references public.players(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, base)
);

create table public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  inning smallint not null check (inning >= 1),
  half public.inning_half not null,
  event_type text not null check (char_length(event_type) between 1 and 50),
  description text not null check (char_length(description) between 1 and 500),
  batter_id uuid references public.players(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (game_id, sequence)
);

-- プロトタイプの画面状態を丸ごと復元するための一時的な保存領域。
-- #10 で各操作を game_events / game_states へ個別保存するAPIに置き換える。
create table public.app_snapshots (
  scope text primary key check (char_length(scope) between 1 and 80),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index players_team_id_idx on public.players(team_id);
create index game_teams_game_id_idx on public.game_teams(game_id);
create index lineups_game_team_id_idx on public.lineups(game_team_id);
create index game_runners_game_id_idx on public.game_runners(game_id);
create index game_events_game_id_sequence_idx on public.game_events(game_id, sequence);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger teams_set_updated_at before update on public.teams
for each row execute function public.set_updated_at();
create trigger players_set_updated_at before update on public.players
for each row execute function public.set_updated_at();
create trigger games_set_updated_at before update on public.games
for each row execute function public.set_updated_at();
create trigger game_teams_set_updated_at before update on public.game_teams
for each row execute function public.set_updated_at();
create trigger lineups_set_updated_at before update on public.lineups
for each row execute function public.set_updated_at();
create trigger game_states_set_updated_at before update on public.game_states
for each row execute function public.set_updated_at();
create trigger game_runners_set_updated_at before update on public.game_runners
for each row execute function public.set_updated_at();
create trigger app_snapshots_set_updated_at before update on public.app_snapshots
for each row execute function public.set_updated_at();
