-- 一部のSupabase環境では gen_random_bytes が提供されないため、
-- ルーム番号（秘密情報ではない公開識別子）の生成を標準の random() に置き換える。
-- 閲覧権限は別途保存するルームパスワードで保護する。

create or replace function public.generate_room_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate text;
  attempts smallint := 0;
begin
  loop
    candidate := lpad(floor(random() * 100000000)::bigint::text, 8, '0');

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

revoke all on function public.generate_room_number() from public;
