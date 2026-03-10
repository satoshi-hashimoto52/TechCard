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

1. **バックエンドを起動（HTTP: 8000）**:
   ```bash
   cd techcard/backend
   source .venv/bin/activate  # 仮想環境をアクティブ化
   python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
   API が `http://localhost:8000` で利用可能になります。

2. **フロントエンドを起動**:
   ```bash
   cd techcard/frontend
   npm start
   ```
   ブラウザで `http://localhost:3000` にアクセス。

バックエンドの仮想環境が既にセットアップされていることを前提としています。初回は各ディレクトリで `npm install` または `pip install -r requirements.txt` を実行してください。

## スマホ撮影（QR）機能の有効化

iPhoneのブラウザで**撮影時に枠を表示**するため、HTTPSでの起動が必要です。

1. **証明書作成（mkcert）**
   ```bash
   brew install mkcert
   mkcert -install
   ```

2. **ローカルIPの確認**
   ```bash
   ipconfig getifaddr en0
   ```

3. **証明書作成**
   ```bash
   cd techcard/backend
   mkdir -p certs
   mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem \
     localhost 127.0.0.1 <YOUR_LOCAL_IP>
   ```

4. **HTTPSでバックエンドを起動（8443）**
   ```bash
   cd techcard/backend
   source .venv/bin/activate
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8443 \
     --ssl-certfile certs/localhost.pem --ssl-keyfile certs/localhost-key.pem
   ```

5. **iPhoneで証明書を信頼**
   - `mkcert -CAROOT` で表示されるフォルダ内の `rootCA.pem` をiPhoneへ送信
   - 設定 → 一般 → 情報 → 証明書信頼設定 で信頼をON

QRからアクセスするURLはHTTPS（`https://<PCのIP>:8443`）になります。
PCとiPhoneは**同一Wi-Fi**が必要です。

## 画像仕様

- OCRに使用する画像は **1200 × 700 px** に正規化されます。
- 読み込み画像／PCカメラ撮影／スマホ撮影のすべてが同一サイズに統一されます。

## 連絡先の重複チェック

- 重複判定は **氏名 + 会社名** の組み合わせのみです。
- 重複がある場合、UIで**上書きするか確認**が出ます。

## タグ

- 既存タグの**選択リスト**から追加可能です。
- 手入力で新規タグも追加できます。

## 機能一覧

- 連絡先の CRUD
- 名刺の OCR
- ROIエディタ
- スマホ撮影（QR経由アップロード）
- タグ付け、ミーティング、会社モデル

プロジェクト構成は現状の実装に合わせています。
