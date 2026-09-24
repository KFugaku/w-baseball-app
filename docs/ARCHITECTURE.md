# アーキテクチャ

## ディレクトリの責務

| ディレクトリ | 責務 |
| --- | --- |
| `frontend/` | React、TypeScript、Viteで実装するWebクライアント。画面、UI状態、Supabaseクライアントを置く。 |
| `backend/` | API、サーバー側のユースケース、認証・認可の補助ロジックを置く。Supabase Edge Functionsを使う場合もここを入口にする。 |
| `packages/shared/` | フロントエンドとバックエンドで共有する型、ドメイン定義、バリデーションを置く。 |
| `infra/` | Supabaseの設定、DBマイグレーション、シードデータなど、環境を再現するための資材を置く。 |
| `docs/` | プロダクト仕様、設計判断、運用手順を置く。 |

## 開発コマンド

リポジトリのルートで次を実行する。

```bash
npm ci
npm run dev
npm run lint
npm run build
```

ルートの各コマンドは、npm workspacesを通じて `frontend/` のスクリプトを実行する。バックエンドと共有パッケージを実装した時点で、同様にワークスペースへ追加する。

## 今回作成する空の配置先

`backend/`、`packages/shared/`、`infra/supabase/` は、後続のIssueで実装を追加するために先に作成する。今は実行可能なバックエンドやSupabase設定を含めない。
