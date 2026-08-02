# テスト

## Frontend unit/integration test

`frontend/package.json`には次のscriptがあります。

```bash
cd frontend
npm test
```

テストファイルは`src`配下には確認できません。実行時に対象テストが見つかるかは環境依存です。

## Playwright E2E

設定: `frontend/playwright.config.ts`

- testDir: `./e2e`
- browser: Chromium
- default base URL: `http://127.0.0.1:3000`
- Frontend dev serverを自動起動する設定があります

存在するテスト:

|ファイル|確認対象|
|---|---|
|`frontend/e2e/contacts.spec.ts`|会社タグ編集|
|`frontend/e2e/map.spec.ts`|会社クリック、ルート表示、距離、経路ステップ|
|`frontend/e2e/network.spec.ts`|ノード選択、Context表示、ドラッグ、レイアウト保存|
|`frontend/e2e/network.regression.spec.ts`|ドラッグ中hover、連続クリック、API遅延、Abort|

専用のnpm scriptはありません。実行コマンドは設定と依存関係の状態を確認してから選択してください。

## Backend

Backendのテストファイル、pytest設定、カバレッジ設定は確認できません。

## カバレッジ

カバレッジ取得用のコマンドや設定は確認できません。
