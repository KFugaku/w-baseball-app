# Supabase セットアップ（Issue #8）

このディレクトリには、試合・チーム・選手・打順・走者・試合状況・イベントを保存する SQL を置いています。認証と Row Level Security（RLS）はまだ設定しません。#9 で追加します。

## 初回セットアップ

1. [Supabase Dashboard](https://supabase.com/dashboard) で組織を選び、**New project** を選択します。
2. プロジェクト名を入力し、DB パスワードを設定します。パスワードはパスワードマネージャーに保管し、リポジトリや `.env.local` には書きません。リージョンは利用者に近いものを選びます。
3. プロジェクトの準備完了後、左メニューの **SQL Editor** を開きます。
4. [初期マイグレーション](migrations/202609300001_initial_schema.sql) の内容を貼り付けて **Run** します。
5. 続けて [開発用シード](seed.sql) の内容を貼り付けて **Run** します。
6. Dashboard の **Connect** パネル（表示がない場合は Project Settings > API）から、Project URL と **Publishable key** を取得します。
7. `frontend/.env.example` をコピーして `frontend/.env.local` を作り、次の二つを設定します。

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

   `service_role` キー、DB パスワード、アクセストークンはブラウザで実行される Vite 環境変数に書いてはいけません。
8. 開発サーバーを再起動して `npm run dev` を実行します。設定済みの場合、画面状態は `app_snapshots` にも保存されます。未設定または通信失敗時は、ブラウザの localStorage にだけ保存されます。

## 確認SQL

```sql
select title, status from public.games order by created_at;
select name from public.teams order by name;
select count(*) as event_count from public.game_events;
```

公開キーを使うブラウザからの読書き権限は #9 の RLS 設計と同時に有効化します。それまでは、本番データを入れず、開発プロジェクトでのみ使用してください。
