# ドキュメント生成レポート

## 作成ファイル

- `docs/00_PROJECT_OVERVIEW.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DIRECTORY_STRUCTURE.md`
- `docs/03_TECH_STACK.md`
- `docs/04_BUILD_AND_RUN.md`
- `docs/05_CODING_RULES.md`
- `docs/06_API_REFERENCE.md`
- `docs/07_DATABASE.md`
- `docs/08_CONFIGURATION.md`
- `docs/09_TESTING.md`
- `docs/10_LIMITATIONS.md`
- `docs/DOCUMENTATION_REPORT.md`
- `AGENTS.md`

## 根拠としたファイル

- `README.md`
- `frontend/README.md`
- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/playwright.config.ts`
- `frontend/src/App.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/services/`
- `frontend/e2e/`
- `backend/requirements.txt`
- `backend/app/main.py`
- `backend/app/database.py`
- `backend/app/models.py`
- `backend/app/schemas.py`
- `backend/app/routers/`
- `backend/scripts/`
- `dev_start.sh`
- `.gitignore`

## 確認できなかった事項

- Backendの依存関係の固定バージョン
- CI/CD、デプロイ、本番構成
- Backendのテスト・カバレッジ設定
- 外部サービスの認証情報、料金、制限
- 実ブラウザ、実機、外部APIを使った動作確認の全結果

## 推測を避けた項目

- `docs/project_spec.md`にのみ記載され、現行コードで確認できない構成は断定していません。
- バージョン指定のないBackend依存関係に番号を補っていません。
- 専用scriptのないテスト・lint・format・package手順を、存在するコマンドとして記載していません。
- 本番運用、性能、可用性、セキュリティ対策を推測していません。

## 今後追加すると良い資料

次の資料はリポジトリ内で確認できないため、必要になった時点で実環境の事実をもとに追加してください。

- Backend APIのOpenAPI出力または実リクエスト例
- テスト実行結果とカバレッジ結果
- 本番デプロイ・バックアップ・復旧手順
- 外部地図・ジオコーディング・経路サービスの契約と設定手順
