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

### dev_start.sh（推奨）

フロントエンド・バックエンド（HTTP/HTTPS）をまとめて起動します。起動後にブラウザを開きます。

```bash
cd techcard
./dev_start.sh
```

起動ポート:
- フロントエンド: `http://localhost:3000`
- バックエンド（HTTP）: `http://localhost:8000`
- バックエンド（HTTPS）: `https://localhost:8443`

### 手動起動

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

iPhone/Androidのブラウザで**撮影時に枠を表示**するため、HTTPSでの起動が必要です。

1. **証明書作成（mkcert）**
   ```bash
   brew install mkcert
   mkcert -install
   ```

2. **ローカルIPの確認**
   ```bash
   ifconfig | grep -E "inet " | head -n 5
   ```
   `192.168.x.x` のLAN IPを使用します。

3. **証明書作成**
   ```bash
   cd techcard/backend
   mkdir -p certs
   mkcert -cert-file certs/lan.pem -key-file certs/lan-key.pem \
     <YOUR_LOCAL_IP> localhost 127.0.0.1
   ```

4. **HTTPSでバックエンドを起動（8443）**
   ```bash
   cd techcard/backend
   source .venv/bin/activate
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8443 \
     --ssl-certfile certs/lan.pem --ssl-keyfile certs/lan-key.pem
   ```

5. **iPhoneで証明書を信頼**
   - `mkcert -CAROOT` で表示されるフォルダ内の `rootCA.pem` をiPhoneへ送信
   - 設定 → 一般 → 情報 → 証明書信頼設定 で信頼をON

### IPが変わった場合（重要）
- **LAN IPが変わったら証明書は再生成が必要**です。
- 手順:
  1. `ifconfig | grep -E "inet " | head -n 5` で新しいIPを確認
  2. `mkcert -cert-file certs/lan.pem -key-file certs/lan-key.pem <NEW_IP> localhost 127.0.0.1` を再実行
  3. バックエンド/フロントエンドを再起動
  4. 「スマホで撮影（QR表示）」からQRを再生成

### カメラ起動までの流れ（重要）
1. 上記の証明書手順を完了（Mac + iPhoneで信頼）
2. `./dev_start.sh` で起動
3. ブラウザで `http://localhost:3000` を開く
4. 連絡先登録 → 「スマホで撮影（QR表示）」を押す
5. QRをiPhoneで開く  
   **HTTPS（`https://<PCのIP>:8443`）で開かれていることを確認**
6. 「カメラ起動」→ 撮影してアップロード  

QRからアクセスするURLはHTTPS（`https://<PCのIP>:8443`）になります。  
PCとスマホは**同一Wi-Fi**が必要です。

### 連続登録モード
- PC側で「連続登録モード」をONにすると、同一QRで連続アップロードできます。
- 登録成功時は**バナー表示のみ**（自動で消えます）。
- 連続登録時は **会社名/電話番号/郵便番号/住所** を保持します。
- OCRは**空欄のみ**埋めます（既に値がある項目は上書きしません）。

## 画像仕様

- OCRに使用する画像は **1200 × 700 px** に正規化されます。
- 読み込み画像／PCカメラ撮影／スマホ撮影のすべてが同一サイズに統一されます。

## 名刺アップロード/クロップ/OCRフロー

1. 名刺画像をアップロード/撮影
2. **名刺枠を自動検出**（4点が初期表示）
3. 手動で4点をドラッグ調整
4. 「クロップ実行」
5. **元画像/クロップ後**を選択して確定
6. ROIを調整
7. 「OCR実行」でOCRを実行  
   **自動OCRは行いません**

## 連絡先の重複チェック

- 重複判定は **氏名 + 会社名** の組み合わせのみです。
- 重複がある場合、UIで**上書きするか確認**が出ます。

## タグ

- 既存タグの**選択リスト**から追加可能です。
- 手入力で新規タグも追加できます。
- 既存タグの削除が可能です（選択して削除）。
- 選択肢は昇順表示です。

## 連絡先一覧/詳細

- 会社ごとにカード表示（デフォルトで折りたたみ）
- 氏名下に役職・部署を表示
- 初回に会った日を編集可能（新規登録は当日）
- メモを表示

## OCRの整形

- 会社名の前株/後株のスペースを除去
- 氏名は「名字 名」で半角スペース1つに統一
- 役職・部署の連続スペースを半角1つに統一
- メール末尾のドット欠落を補正

## ROIエディタ

- ラベル文字サイズ16（赤字）
- 枠線は赤の実線（透過）
- アスペクト比を固定せず自由にリサイズ可能
- 余白ドラッグで**ROI全体を一括移動**
- ROI位置は **localStorage（`techcard_roi_template`）に保存**  
  「ROIリセット」でデフォルトに戻します

## ネットワークグラフ

- 会社ノードも接続（company_uses）
- タイプのON/OFF + ハイライト
- 縮尺に応じたラベル表示

## 機能一覧

- 連絡先の CRUD
- 名刺の OCR
- ROIエディタ
- スマホ撮影（QR経由アップロード）
- タグ付け、ミーティング、会社モデル

プロジェクト構成は現状の実装に合わせています。
