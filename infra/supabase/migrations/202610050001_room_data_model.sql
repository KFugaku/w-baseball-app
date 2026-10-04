-- Issue #19: アカウント、ルーム、試合の所属関係
--
-- RLS ポリシーと auth.users 作成時のプロフィール同期は Issue #9 で追加する。
-- パスワードハッシュは room_credentials に分離し、Data API の通常レスポンスへ含めない。

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  -- 既存の開発用データを移行できるよう、認証を実装する #9 までは null を許容する。
  -- 新規ルームでは owner_id を必須にするRLS/RPCを #9 と #23 で追加する。
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  room_number text not null unique check (room_number ~ '^[0-9]{8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 読み取り対象の rooms から分けることで、RLS のSELECT許可だけではハッシュを取得できない。
-- #20 の安全なRPCまたはEdge Functionだけが、この値を照合する。
create table public.room_credentials (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null check (char_length(password_hash) >= 60),
  updated_at timestamptz not null default now()
);

revoke all on table public.room_credentials from anon, authenticated;

-- 8桁の数値ルーム番号をサーバー側で生成する。
-- 一意制約が最終的な衝突防止策であり、呼び出し側は unique_violation 時に再試行する。
create function public.generate_room_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  random_bytes bytea;
  random_value bigint;
  candidate text;
  attempts smallint := 0;
begin
  loop
    random_bytes := gen_random_bytes(4);
    random_value :=
      get_byte(random_bytes, 0)::bigint * 16777216 +
      get_byte(random_bytes, 1)::bigint * 65536 +
      get_byte(random_bytes, 2)::bigint * 256 +
      get_byte(random_bytes, 3)::bigint;
    candidate := lpad((random_value % 100000000)::text, 8, '0');

    if not exists (select 1 from public.rooms where room_number = candidate) then
      return candidate;
    end if;

    attempts := attempts + 1;
    if attempts >= 30 then
      raise exception 'ルーム番号を生成できませんでした。再試行してください。';
    end if;
  end loop;
end;
$$;

-- #9 で認可方針を決めてから、必要なロールまたは安全なRPCだけへ権限を付与する。
revoke all on function public.generate_room_number() from public;

-- 既存データと新規データの両方で「前回使ったルーム」を保存できるようにする。
alter table public.profiles
  add column last_room_id uuid references public.rooms(id) on delete set null;

-- #8 で作成済みの試合を、開発用の既定ルームへ移行する。
-- ハッシュは実行時にランダムな値から作るため、平文パスワードをSQLやDBへ残さない。
insert into public.rooms (id, name, room_number)
values (
  '30000000-0000-0000-0000-000000000001',
  '開発用ルーム',
  '00000000'
);

insert into public.room_credentials (room_id, password_hash)
values (
  '30000000-0000-0000-0000-000000000001',
  crypt(gen_random_uuid()::text, gen_salt('bf', 12))
);

alter table public.games
  add column room_id uuid references public.rooms(id) on delete restrict;

update public.games
set room_id = '30000000-0000-0000-0000-000000000001'
where room_id is null;

alter table public.games
  alter column room_id set not null;

create index games_room_id_idx on public.games(room_id);
create index rooms_owner_id_idx on public.rooms(owner_id);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger rooms_set_updated_at before update on public.rooms
for each row execute function public.set_updated_at();
create trigger room_credentials_set_updated_at before update on public.room_credentials
for each row execute function public.set_updated_at();
