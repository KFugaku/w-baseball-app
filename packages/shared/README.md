# Shared package

フロントエンドとバックエンドで共有する型、ドメイン定義、バリデーションを置きます。

`src/database.ts` は `infra/supabase/migrations/` の `public` スキーマに対応する型です。テーブルまたは列を変更するプルリクエストでは、同じ変更にこの型の更新を含めます。
