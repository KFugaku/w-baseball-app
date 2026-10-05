# Supabase セットアップ（Issue #8 / #19 / #9）

このディレクトリには、試合・チーム・選手・打順・走者・試合状況・イベントに加え、アカウント・ルーム・試合の所属関係、メール認証用の RLS を保存する SQL を置いています。ルームパスワードでの閲覧権限は Issue #20 で追加します。

## 初回セットアップ

1. [Supabase Dashboard](https://supabase.com/dashboard) で組織を選び、**New project** を選択します。
2. プロジェクト名を入力し、DB パスワードを設定します。パスワードはパスワードマネージャーに保管し、リポジトリや `.env.local` には書きません。リージョンは利用者に近いものを選びます。
3. プロジェクトの準備完了後、左メニューの **SQL Editor** を開きます。
4. [初期マイグレーション](migrations/202609300001_initial_schema.sql) の内容を貼り付けて **Run** します。
5. 続けて [ルーム用マイグレーション](migrations/202610050001_room_data_model.sql) の内容を貼り付けて **Run** します。
6. 続けて [認証・RLSマイグレーション](migrations/202610050002_auth_and_rls.sql) の内容を貼り付けて **Run** します。
7. 続けて [開発用シード](seed.sql) の内容を貼り付けて **Run** します。
8. Dashboard の **Authentication > Providers > Email** で Email を有効にし、実運用では **Confirm email** を有効にします。次に **Authentication > URL Configuration** で Site URL を `http://localhost:5173`、Redirect URLs に `http://localhost:5173/**` を登録します。公開後は本番URLも同様に追加します。
9. Dashboard の **Connect** パネル（表示がない場合は Project Settings > API）から、Project URL と **Publishable key** を取得します。
10. `frontend/.env.example` をコピーして `frontend/.env.local` を作り、次の二つを設定します。

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

   `service_role` キー、DB パスワード、アクセストークンはブラウザで実行される Vite 環境変数に書いてはいけません。
11. 開発サーバーを再起動して `npm run dev` を実行します。ログインしている場合だけ、画面状態は本人用の `app_snapshots` にも保存されます。未ログイン・未設定・通信失敗時は、ブラウザの localStorage にだけ保存されます。

すでに Issue #8 の初期マイグレーションを実行済みの場合は、初期マイグレーションを再実行しません。Issue #19 を実行済みなら手順6だけを、Issue #19 が未実行なら手順5・6を、この順番で各1回実行してください。シードは既存データを更新しないため、必要な場合だけ実行します。

## 確認SQL

```sql
select title, status from public.games order by created_at;
select room_number, name from public.rooms order by created_at;
select room_id, count(*) as game_count from public.games group by room_id;
select name from public.teams order by name;
select count(*) as event_count from public.game_events;
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
```

RLSにより、公開キーだけの未ログイン状態では、`public` スキーマの試合・チーム・画面状態を読書きできません。メールログイン後も、自分が owner のルームに属するデータだけを操作できます。`room_credentials` は認証済み利用者にも公開されず、平文パスワードも保存しません。

ブラウザの `VITE_` 環境変数へは Publishable key だけを設定します。`service_role` キー、DBパスワード、アクセストークンは絶対に書かないでください。ルームパスワードはハッシュだけを保存し、既存ルームのパスワードを再表示することはできません。
