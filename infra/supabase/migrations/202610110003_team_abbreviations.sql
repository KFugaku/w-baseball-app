-- スコアボード用のチーム略称と、所有者によるチーム設定編集
--
-- teams はルーム内で共有され、同じチームを使うすべての試合の表示元となる。
-- 略称もチーム本体に持たせることで、名称・カラー・略称の変更を一斉に反映する。

alter table public.teams
  add column if not exists abbreviation text;

update public.teams
set abbreviation = left(name, 4)
where abbreviation is null or btrim(abbreviation) = '';

alter table public.teams
  alter column abbreviation set default '',
  alter column abbreviation set not null;

alter table public.teams
  drop constraint if exists teams_abbreviation_length;

alter table public.teams
  add constraint teams_abbreviation_length
  check (char_length(abbreviation) between 0 and 8);
