-- ログイン利用者が、自分のルームと閲覧用パスワードを一度に安全に作成する。
-- room_credentials はData APIからアクセスできないため、パスワードのハッシュ化はここでだけ行う。

create function public.create_owned_room(target_name text, target_password text)
returns table (id uuid, name text, room_number text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_room public.rooms%rowtype;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  if char_length(trim(target_name)) not between 1 and 80 then
    raise exception 'ルーム名は1〜80文字で入力してください。';
  end if;

  if char_length(target_password) < 8 then
    raise exception 'ルームパスワードは8文字以上で入力してください。';
  end if;

  insert into public.rooms (owner_id, name, room_number)
  values (auth.uid(), trim(target_name), public.generate_room_number())
  returning * into new_room;

  insert into public.room_credentials (room_id, password_hash)
  values (new_room.id, crypt(target_password, gen_salt('bf', 12)));

  update public.profiles
  set last_room_id = new_room.id
  where profiles.id = auth.uid();

  return query select new_room.id, new_room.name, new_room.room_number;
end;
$$;

revoke all on function public.create_owned_room(text, text) from public, anon;
grant execute on function public.create_owned_room(text, text) to authenticated;
