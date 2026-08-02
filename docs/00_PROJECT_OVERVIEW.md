# プロジェクト概要

## 概要

TechCardは、名刺画像から連絡先情報を登録し、会社・タグ・イベント・技術情報と関係付けて管理するフルスタックアプリケーションです。

READMEと現行コードから確認できる主な課題は、手入力の負担、連絡先の重複登録、名刺情報のOCR入力です。

## 主な機能

- 連絡先・会社・タグ・イベント・会議の登録、編集、削除、検索
- 名刺画像のアップロード、名刺枠検出、クロップ、ROI編集、OCR
- 同一LAN上のスマートフォンからのHTTP画像アップロード
- 会社所在地の地図表示、ジオコーディング診断、会社間ルート表示
- 連絡先・会社・技術・イベントなどのネットワークグラフ表示
- localStorageを使ったROI、表示設定、レイアウトの保存

## 使用技術

- Backend: Python、FastAPI、SQLAlchemy、SQLite、Uvicorn
- Frontend: React、TypeScript、React Router、Axios、TailwindCSS
- 画像・OCR: OpenCV、EasyOCR、Pillow、pillow-heif
- 地図・グラフ: react-map-gl、maplibre-gl、react-force-graph-2d、D3

## 実行方法

READMEに記載された推奨起動方法は次のとおりです。

```bash
./dev_start.sh
```

手動起動では、Backendを8000番ポート、Frontendを3000番ポートで起動します。HTTPSは証明書が存在する場合に8443番ポートで起動します。

## ビルド方法

```bash
cd frontend
npm install
npm run build
```

## テスト方法

Frontendの`package.json`には`npm test`があります。Playwrightの設定とE2Eテストは`frontend/e2e/`および`frontend/playwright.config.ts`にありますが、専用のnpm scriptはありません。

Backendのテストファイルは確認できません。
