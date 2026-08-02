# AGENTS.md

## Project Overview

TechCardは、名刺画像を起点に連絡先、会社、タグ、イベント、技術情報を管理するReact/TypeScript + FastAPI/SQLiteアプリケーションです。実装の詳細は`docs/00_PROJECT_OVERVIEW.md`を参照してください。

## Directory Guide

- `backend/app/`: FastAPIアプリケーション、Router、モデル、スキーマ、CRUD
- `backend/scripts/`: SQLite移行スクリプト
- `frontend/src/`: React画面、コンポーネント、APIサービス
- `frontend/e2e/`: Playwright E2Eテスト
- `frontend/public/`: 静的ファイルとGeoJSON
- `docs/`: プロジェクトドキュメント
- `project_history/`: 開発履歴資料

## Development Rules

現行コードから確認できる範囲では、BackendはRouter・schema・model・CRUDを分離し、Frontendはpages・components・servicesを分離しています。既存のAPI契約、localStorageキー、SQLAlchemyモデルを変更する場合は関連箇所を同時に確認してください。

## Build Commands

```bash
cd frontend
npm install
npm run build
```

開発起動:

```bash
./dev_start.sh
```

## Test Commands

```bash
cd frontend
npm test
```

Playwright設定は`frontend/playwright.config.ts`にありますが、専用npm scriptはありません。実行前に依存関係とブラウザの導入状況を確認してください。

## Formatting

リポジトリ内に、専用のFormatterまたはLint scriptは確認できません。`frontend/tsconfig.json`のTypeScript strict設定と既存コードの書式を維持してください。

## Architecture Notes

- `backend/app/main.py`がFastAPIを生成し、Routerを登録します。
- DB接続はSQLiteとSQLAlchemyです。
- Frontend APIのデフォルトURLは`http://localhost:8000`です。
- FrontendはReact Routerを使います。
- APIエラーは`frontend/src/lib/api.ts`で共通変換されます。
- OCRジョブ状態はBackendのプロセス内辞書で管理されます。

## Safe Editing Areas

このファイルから、常に安全に変更できるディレクトリは確認できません。変更依頼の対象範囲を確認し、既存設計に影響する場合は関連するRouter、schema、model、Frontend service、画面を調査してください。

## Sensitive Files

不用意に内容を公開・変更しない対象として、実在する次のファイル・ディレクトリがあります。

- `backend/certs/`、`certs/`: 証明書・秘密鍵ファイル
- `techcard.db`: SQLiteデータベース
- `logs/`: 実行ログとPID情報
- `frontend/package-lock.json`: 依存関係ロックファイル
- `backend/scripts/`: 既存データを変更する移行スクリプト

## Development Workflow

実在するコマンドに限定した基本順序:

1. 変更対象と関連API・型・モデルを確認
2. 実装
3. `cd frontend && npm test`
4. `cd frontend && npm run build`
5. `git diff --check` と `git status --short`で確認
6. 依頼された場合のみcommit

専用のLint・Formatコマンドは確認できません。

## Coding Style

- Pythonはsnake_caseのモジュール・関数名を使用します。
- ReactコンポーネントはPascalCaseの`.tsx`です。
- TypeScriptは`strict: true`です。
- API型はFrontend serviceとBackend schemaに定義されています。
- 非同期APIにはPromiseとAbortControllerが使われています。
- Axiosエラーは`ApiError`へ変換されます。
- BackendのHTTPエラーは`HTTPException`を使います。

## AI Instructions

- 実在するコード・設定・文書を根拠にし、確認できない内容を推測しない。
- 既存設計とAPI契約を優先する。
- 不要なリファクタリングや依存関係追加をしない。
- 未使用ライブラリを追加しない。
- 既存命名規則とディレクトリ構成を維持する。
- TODO・FIXME・既知の制約を無断で削除しない。
- DB、証明書、アップロードデータ、ロックファイルを変更する場合は影響範囲を確認する。
