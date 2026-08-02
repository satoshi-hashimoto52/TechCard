# ビルドと実行

## Backendインストール

READMEに記載されたコマンドです。

```bash
cd techcard/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Frontendインストール

```bash
cd techcard/frontend
npm install
```

## 開発起動

推奨コマンドは次のとおりです。

```bash
./dev_start.sh
```

このスクリプトは、Backend HTTP（8000）、証明書がある場合のHTTPS（8443）、Frontend（3000）を起動し、PIDを`logs/pids.txt`へ記録します。

## 手動起動

```bash
cd backend
source .venv/bin/activate
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

別のターミナルでFrontendを起動します。

```bash
cd frontend
npm start
```

## Frontendビルド

```bash
cd frontend
npm run build
```

## テスト

```bash
cd frontend
npm test
```

Playwright設定は存在しますが、`package.json`に専用scriptはありません。実際の依存関係・ブラウザの導入状況は環境ごとに確認が必要です。

## Lint・Format・Package

`package.json`、README、設定ファイルから、専用のlint、format、packageコマンドは確認できません。
