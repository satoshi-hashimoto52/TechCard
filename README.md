# TechCard

このリポジトリには、エンジニアの名刺を管理するためのフルスタックアプリケーションが含まれています。

## バックエンド

バックエンドは `backend/app` にある FastAPI アプリケーションです。

### セットアップ

```bash
cd techcard/backend
python -m venv .venv  # Python 3.11.8 を使用
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

SQLite（`techcard.db`）をストレージとして使用し、ORMには SQLAlchemy を使います。

## フロントエンド

フロントエンドは `frontend` にある React アプリケーションで、TypeScript と TailwindCSS を使用しています。

### セットアップ

```bash
cd techcard/frontend
npm install
```

## クイックスタート

1. **バックエンドを起動**:
   ```bash
   cd techcard/backend
   source .venv/bin/activate  # 仮想環境をアクティブ化
   uvicorn app.main:app --reload
   ```
   API が `http://localhost:8000` で利用可能になります。

2. **フロントエンドを起動**:
   ```bash
   cd techcard/frontend
   npm start
   ```
   ブラウザで `http://localhost:3000` にアクセス。

バックエンドの仮想環境が既にセットアップされていることを前提としています。初回は各ディレクトリで `npm install` または `pip install -r requirements.txt` を実行してください。

## 機能一覧

- 連絡先の CRUD
- 名刺の OCR（スタブ）
- タグ付け、ミーティング、会社モデル

プロジェクト構成は初期仕様に従っています。
