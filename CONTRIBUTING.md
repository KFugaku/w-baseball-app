# 開発・Git運用ルール

このプロジェクトは個人開発でも、Issue・短命ブランチ・Pull Requestを使って進めます。第三者が「なぜ変更したか」「どこまで確認したか」を追える状態を目標にします。

## 基本フロー

```text
Issue作成 → 要件・完了条件を確認 → ブランチ作成 → 実装
         → lint/build・動作確認 → Pull Request → Squash merge → ブランチ削除
```

`main`から直接実装せず、1つのIssueにつき1つの作業ブランチを作ります。小規模なため`develop`ブランチは設けません。

## Issueのルール

実装前に、機能追加または不具合のIssueを作成します。最低限、次を明記してください。

- 背景・目的
- やること／やらないこと
- 完了条件（チェックリスト）
- 必要に応じて画面案、再現手順、関連資料

実装中に範囲が広がった場合はIssueへ追記するか、別Issueへ分割します。

## ブランチ命名規則

形式は `<type>/<issue番号>-<short-description>` です。説明部分は英小文字のkebab-caseにします。

| type | 用途 | 例 |
| --- | --- | --- |
| `feature` | 新機能・利用者向け改善 | `feature/12-team-color-setting` |
| `fix` | 不具合修正 | `fix/18-score-reset` |
| `refactor` | 振る舞いを変えない整理 | `refactor/21-split-scoreboard` |
| `docs` | ドキュメントのみ | `docs/24-update-game-rules` |
| `test` | テストのみ | `test/27-add-score-tests` |
| `chore` | 設定・依存関係・雑務 | `chore/30-update-vite` |
| `hotfix` | 公開中の重大障害への緊急修正 | `hotfix/31-admin-login` |

ルール:

- `main`から作る: `git switch main` → `git pull --ff-only` → `git switch -c feature/12-team-color-setting`
- 1ブランチに複数の目的を混ぜない
- 日本語、空白、個人名、`work`や`test2`のように目的が分からない名前は使わない
- Issueがない作業は原則として先にIssueを作る
- マージ後はローカル・リモートの作業ブランチを削除する

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/ja/) に近い形式を使います。

```text
<type>: <変更内容を日本語で簡潔に>
```

例:

```text
feat: チームカラー選択を追加
fix: リセット後に走者が残る問題を修正
docs: 開発フローを追記
```

`feat`、`fix`、`refactor`、`docs`、`test`、`chore`を主に使用します。コミットは、あとから単独で意味を理解できる大きさにします。

## Pull Requestのルール

- タイトルは `feat: チームカラー選択を追加` の形式にする
- 本文で `Closes #12` とIssueを紐付ける
- 変更内容、確認方法、影響範囲を記載する
- UI変更はスクリーンショットを添付する
- `npm run lint` と `npm run build` が成功してからマージする
- 下書き中はDraft PRを使い、完了条件を満たしたらReadyにする
- 原則Squash mergeを使い、マージ後はブランチを削除する

個人開発時もPRの差分を一度自分で読み直します。共同開発時は、原則として1人以上の承認を得てください。

## Definition of Ready（着手できる条件）

- 目的と利用者が説明できる
- やること／やらないことが分かれている
- 完了条件がチェック可能な文章になっている
- 依存するIssueや未決事項が整理されている

## Definition of Done（完了条件）

- Issueの完了条件をすべて満たしている
- lintとbuildが成功している
- 主要な操作をブラウザで確認している
- 仕様変更がドキュメントへ反映されている
- PRに確認内容と必要なスクリーンショットがある
- `main`へマージされ、作業ブランチが削除されている

## GitHubリポジトリ推奨設定

`main`のBranch protection rulesetで、次を有効にします。

- Pull Request経由の変更を必須にする
- `quality`ステータスチェックを必須にする
- マージ前に会話の解決を必須にする
- Force pushとブランチ削除を禁止する
- 共同開発を始めたら1件以上のレビュー承認を必須にする

個人開発中は承認必須を外しても構いませんが、PRとCIは省略しません。
