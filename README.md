# 草野球速報（w-baseball）

草野球の試合状況を、観戦者と運営者の双方に分かりやすく伝えるためのWebアプリです。試合一覧、スコア、打席結果、守備位置、打順などを一つの画面で確認・更新できます。

## 主な機能

- 当日の試合一覧と試合ステータスの表示
- イニング、スコア、ボール・ストライク・アウトの管理
- 打席結果と試合経過の記録
- 出場選手、打順、ベンチ、守備位置の管理
- 閲覧モードと管理者モードの切り替え

詳しい仕様は [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) を参照してください。

## 技術スタック

- React 19
- TypeScript
- Vite
- ESLint
- npm workspaces
- Supabase（PostgreSQL。接続設定後に有効）

## セットアップ

Node.js 24系を推奨します。

```bash
npm ci
npm run dev
```

ローカルで表示されたURLをブラウザで開きます。

## 品質チェック

```bash
npm run lint
npm run build
```

## Supabase（任意の初期設定）

データベース接続の初回設定は [infra/supabase/README.md](infra/supabase/README.md) を参照してください。設定前でも、開発中の画面状態はブラウザのlocalStorageへ保存されます。

プルリクエストでは同じチェックがGitHub Actionsで実行されます。

## プロジェクト構成

```text
frontend/              React / TypeScript / Vite のWebクライアント
backend/               API・サーバー側の実装
packages/shared/       フロントエンドとバックエンドで共有する型・ドメイン定義
infra/                 Supabase設定、DBマイグレーション、シードデータ
docs/                  仕様・設計資料
```

ルートの `npm run dev`、`npm run lint`、`npm run build` は `frontend/` の同名スクリプトを実行します。詳しい責務は [アーキテクチャ](docs/ARCHITECTURE.md) を参照してください。

## 開発への参加

このリポジトリでは、個人開発でもチーム開発と同じ流れを採用します。

1. 課題（Issue）で目的と完了条件を決める
2. `feature/12-short-description` のような作業ブランチを作る
3. 小さな単位でコミットする
4. プルリクエストを作成して、仕様・画面・テスト結果を確認する
5. 変更を1コミットにまとめてマージし、作業ブランチを削除する

ブランチ名、コミット、課題、プルリクエストの詳しいルールは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ドキュメント

- [プロダクト仕様](docs/PRODUCT_SPEC.md)
- [アーキテクチャ](docs/ARCHITECTURE.md)
- [開発・Git運用ルール](CONTRIBUTING.md)

## 現在の位置づけ

現在はフロントエンド上で動作を検証するプロトタイプです。データはブラウザを再読み込みすると初期状態に戻り、管理者認証もデモ用です。本番運用に向けた要件は仕様書の「今後の検討事項」に整理しています。
