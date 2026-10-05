-- 開発用データ。既存の試合一覧と試合詳細を再現できる最小セット。

-- パスワードは実行時にランダム値からハッシュ化する。平文の開発用パスワードは置かない。
insert into public.rooms (id, name, room_number) values
  (
    '30000000-0000-0000-0000-000000000001',
    '開発用ルーム',
    '00000000'
  )
on conflict (id) do update set
  name = excluded.name,
  room_number = excluded.room_number;

insert into public.room_credentials (room_id, password_hash) values
  (
    '30000000-0000-0000-0000-000000000001',
    crypt(gen_random_uuid()::text, gen_salt('bf', 12))
  )
on conflict (room_id) do nothing;

insert into public.teams (id, room_id, name, color) values
  ('00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '多摩リバース', '#2563eb'),
  ('00000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '府中フェニックス', '#dc2626'),
  ('00000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'チームA', '#475569'),
  ('00000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', 'チームB', '#64748b')
on conflict (id) do update set room_id = excluded.room_id, name = excluded.name, color = excluded.color;

insert into public.players (id, team_id, last_name, first_name, batting_average) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '田中', '太郎', .250),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '佐藤', '健', .255),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '鈴木', '蓮', .260),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '高橋', '陸', .265),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '伊藤', '翔', .270),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '山本', '悠', .275),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '木村', '陽', .280),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', '吉田', '大輝', .285),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', '清水', '亮', .290),
  ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '渡辺', '優', .250),
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', '小林', '海斗', .250),
  ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000002', '加藤', '航', .255),
  ('10000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000002', '中村', '龍', .260),
  ('10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000002', '森', '拓也', .265),
  ('10000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000002', '石井', '駿', .270),
  ('10000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000002', '井上', '直人', .275),
  ('10000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000002', '山田', '誠', .280),
  ('10000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-000000000002', '岡田', '蒼', .285),
  ('10000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-000000000002', '斎藤', '颯', .290),
  ('10000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000002', '松本', '晴', .250)
on conflict (id) do update set
  team_id = excluded.team_id, last_name = excluded.last_name, first_name = excluded.first_name,
  batting_average = excluded.batting_average;

insert into public.games (id, room_id, title, status) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '第一試合', 'finished'),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '第二試合', 'live'),
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '第三試合', 'before')
on conflict (id) do update set
  room_id = excluded.room_id,
  title = excluded.title,
  status = excluded.status;

insert into public.game_teams (game_id, team_id, side, score) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'away', 1),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'home', 2),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'away', 1),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'home', 3),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'away', 0),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'home', 0)
on conflict (game_id, side) do update set team_id = excluded.team_id, score = excluded.score;

insert into public.game_states (game_id, inning, half, balls, strikes, outs, batter_order, away_score, home_score) values
  ('20000000-0000-0000-0000-000000000001', 7, 'bottom', 0, 0, 2, 0, 1, 2),
  ('20000000-0000-0000-0000-000000000002', 3, 'top', 2, 1, 1, 0, 1, 3),
  ('20000000-0000-0000-0000-000000000003', 1, 'top', 0, 0, 0, 0, 0, 0)
on conflict (game_id) do update set
  inning = excluded.inning, half = excluded.half, balls = excluded.balls, strikes = excluded.strikes,
  outs = excluded.outs, batter_order = excluded.batter_order, away_score = excluded.away_score,
  home_score = excluded.home_score;

with lineup_seed (game_id, side, player_id, batting_order, field_position, role) as (
  values
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000001'::uuid, 1, '投', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000002'::uuid, 2, '捕', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000003'::uuid, 3, '一', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000004'::uuid, 4, '二', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000005'::uuid, 5, '三', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000006'::uuid, 6, '遊', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000007'::uuid, 7, '左', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000008'::uuid, 8, '中', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000009'::uuid, 9, '右', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'away'::public.team_side, '10000000-0000-0000-0000-000000000010'::uuid, null, '打', 'bench'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000011'::uuid, 1, '投', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000012'::uuid, 2, '捕', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000013'::uuid, 3, '一', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000014'::uuid, 4, '二', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000015'::uuid, 5, '三', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000016'::uuid, 6, '遊', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000017'::uuid, 7, '左', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000018'::uuid, 8, '中', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000019'::uuid, 9, '右', 'starter'::public.lineup_role),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'home'::public.team_side, '10000000-0000-0000-0000-000000000020'::uuid, null, '打', 'bench'::public.lineup_role)
)
insert into public.lineups (game_team_id, player_id, batting_order, field_position, role)
select game_teams.id, lineup_seed.player_id, lineup_seed.batting_order, lineup_seed.field_position, lineup_seed.role
from lineup_seed
join public.game_teams on game_teams.game_id = lineup_seed.game_id and game_teams.side = lineup_seed.side
on conflict (game_team_id, player_id) do update set
  batting_order = excluded.batting_order, field_position = excluded.field_position, role = excluded.role;

insert into public.game_runners (game_id, base, player_id) values
  ('20000000-0000-0000-0000-000000000002', 1, '10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002', 2, '10000000-0000-0000-0000-000000000003')
on conflict (game_id, base) do update set player_id = excluded.player_id;

insert into public.game_events (game_id, sequence, inning, half, event_type, description, batter_id) values
  ('20000000-0000-0000-0000-000000000002', 1, 2, 'bottom', 'strikeout', '2回裏 山田 三振', '10000000-0000-0000-0000-000000000017'),
  ('20000000-0000-0000-0000-000000000002', 2, 3, 'top', 'inning_start', '3回表', null),
  ('20000000-0000-0000-0000-000000000002', 3, 3, 'top', 'walk', '3回表 佐藤 四球', '10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002', 4, 3, 'top', 'single', '3回表 田中 中安打', '10000000-0000-0000-0000-000000000001')
on conflict (game_id, sequence) do update set description = excluded.description, event_type = excluded.event_type;
