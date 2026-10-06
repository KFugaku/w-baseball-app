# Supabase セットアップ（Issue #8 / #19 / #9 / #20 / #23 / #39）

このディレクトリには、試合・チーム・選手・打順・走者・試合状況・イベントに加え、アカウント・ルーム・試合の所属関係、メール認証用の RLS、ルームパスワードによる期限付き閲覧権限を保存する SQL を置いています。

## 初回セットアップ

1. [Supabase Dashboard](https://supabase.com/dashboard) で組織を選び、**New project** を選択します。
2. プロジェクト名を入力し、DB パスワードを設定します。パスワードはパスワードマネージャーに保管し、リポジトリや `.env.local` には書きません。リージョンは利用者に近いものを選びます。
3. プロジェクトの準備完了後、左メニューの **SQL Editor** を開きます。
4. [初期マイグレーション](migrations/202609300001_initial_schema.sql) の内容を貼り付けて **Run** します。
5. 続けて [ルーム用マイグレーション](migrations/202610050001_room_data_model.sql) の内容を貼り付けて **Run** します。
6. 続けて [認証・RLSマイグレーション](migrations/202610050002_auth_and_rls.sql) の内容を貼り付けて **Run** します。
7. 続けて [閲覧セッション用マイグレーション](migrations/202610050003_room_view_sessions.sql) の内容を貼り付けて **Run** します。
8. 続けて `migrations` 内の `202610060001`〜`202610060010` を番号順に貼り付けて、それぞれ **Run** します。`202610060010_player_statistics.sql` は選手成績の記録・集計と、試合の予定回数を追加します。旧版の `202610060010` を実行済みの場合だけ、続けて `202610070001_fix_create_owned_game_ambiguity.sql` を実行します。最後に、複数回の操作取消を使うため [202610070002_revert_game_event.sql](migrations/202610070002_revert_game_event.sql) を実行します。
9. 続けて [開発用シード](seed.sql) の内容を貼り付けて **Run** します。
10. Dashboard の **Authentication > Providers > Email** で Email を有効にし、実運用では **Confirm email** を有効にします。閲覧専用ユーザー向けに、同じ画面の **Anonymous Sign-Ins** も有効にします。次に **Authentication > URL Configuration** で Site URL を `http://localhost:5173`、Redirect URLs に `http://localhost:5173/**` を登録します。公開後は本番URLも同様に追加します。
11. 匿名Authの悪用対策として、Dashboard の **Authentication > Rate Limits** でIP単位のAnonymous sign-in制限を有効にします。DB側でも、同じ匿名閲覧者から5回連続で失敗した場合は15分間ロックします。
12. Dashboard の **Connect** パネル（表示がない場合は Project Settings > API）から、Project URL と **Publishable key** を取得します。
13. `frontend/.env.example` をコピーして `frontend/.env.local` を作り、次の二つを設定します。

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

   `service_role` キー、DB パスワード、アクセストークンはブラウザで実行される Vite 環境変数に書いてはいけません。
14. 開発サーバーを再起動して `npm run dev` を実行します。ログインしている場合だけ、画面状態は本人用の `app_snapshots` にも保存・復元されます。未ログイン・未設定・通信失敗時は、ブラウザの localStorage にだけ保存されます。

すでに実行済みのマイグレーションは再実行しません。既存プロジェクトへIssue #39を追加する場合は、それ以前のマイグレーションが実行済みであることを確認し、`202610060010_player_statistics.sql` だけをSQL Editorに貼り付けて実行します。2026年10月7日より前の同ファイルを実行済みの場合は、さらに `202610070001_fix_create_owned_game_ambiguity.sql` を実行します。Issue #42を追加する場合は、続けて `202610070002_revert_game_event.sql` を実行します。シードは既存データを更新しないため、必要な場合だけ実行します。

## 確認SQL

```sql
select title, status from public.games order by created_at;
select room_number, name from public.rooms order by created_at;
select room_id, count(*) as game_count from public.games group by room_id;
select room_id, expires_at from public.room_viewer_sessions order by expires_at desc;
select name from public.teams order by name;
select count(*) as event_count from public.game_events;
select count(*) as recorded_plate_appearances from public.game_events where plate_result is not null and reverted_at is null;
select game_id, player_id, decision from public.player_game_pitching_decisions order by created_at desc;
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
```

RLSにより、公開キーだけの未ログイン状態では、`public` スキーマの試合・チーム・画面状態を読書きできません。メールログイン後も、自分が owner のルームに属するデータだけを操作できます。匿名Authでルーム番号とパスワードを照合した閲覧者は、1時間だけ対象ルームを**読む**ことだけができます。`room_credentials`、閲覧セッション、失敗回数は認証済み利用者にもData APIから公開されず、平文パスワードも保存しません。

ブラウザの `VITE_` 環境変数へは Publishable key だけを設定します。`service_role` キー、DBパスワード、アクセストークンは絶対に書かないでください。ルームパスワードはハッシュだけを保存し、既存ルームのパスワードを再表示することはできません。閲覧時に入力するルームパスワードは限定RPCへ一度だけ送られ、URL・sessionStorage・localStorage・APIレスポンスには保存されません。
