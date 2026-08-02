# ディレクトリ構造

## ツリー

```text
.
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── crud.py
│   │   ├── ocr.py
│   │   ├── routers/
│   │   └── services/
│   ├── scripts/
│   ├── requirements.txt
│   └── certs/
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   ├── pages/
│   │   ├── services/
│   │   └── App.tsx
│   ├── e2e/
│   ├── package.json
│   ├── package-lock.json
│   └── playwright.config.ts
├── docs/
├── project_history/
├── dev_start.sh
└── README.md
```

## 主要ディレクトリと役割

|パス|役割|
|---|---|
|`backend/app/routers/`|FastAPIのAPI Router|
|`backend/app/services/`|技術抽出などのサービス処理|
|`backend/scripts/`|SQLiteデータ移行スクリプト|
|`frontend/src/pages/`|ルート画面|
|`frontend/src/components/`|再利用UIコンポーネント|
|`frontend/src/services/`|Backend APIサービス|
|`frontend/src/features/`|機能別状態管理|
|`frontend/e2e/`|Playwright E2Eテスト|
|`frontend/public/`|静的ファイルとGeoJSON|
|`docs/`|プロジェクト資料|
|`project_history/`|開発履歴と振り返りIssue資料|

## 主要ファイル

- `backend/app/main.py`: FastAPI、CORS、DB初期化、Router登録
- `backend/app/models.py`: DBモデル
- `backend/app/schemas.py`: APIスキーマ
- `frontend/src/App.tsx`: Frontendルート
- `frontend/src/pages/NetworkGraph.tsx`: ネットワークグラフ
- `frontend/src/components/TechCardMap.tsx`: 地図表示
- `frontend/src/lib/api.ts`: Axios設定とAPIエラー変換
- `dev_start.sh`: Backend、HTTPS、Frontendの起動
