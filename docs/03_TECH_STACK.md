# 技術スタック

## Frontend依存関係

バージョンは`frontend/package.json`に記載された指定値です。実際にインストールされた解決バージョンはこの資料からは確認できません。

|名称|用途|使用箇所|Version|
|---|---|---|---|
|React|UI|`frontend/src/`|`^18.0.0`|
|TypeScript|型付きFrontend|`frontend/src/`|`^4.9.5`|
|react-scripts|開発・ビルド|`frontend/package.json`|`5.0.1`|
|react-router-dom|画面ルーティング|`frontend/src/App.tsx`|`^6.0.0`|
|axios|API通信|`frontend/src/lib/api.ts`、`services/`|`^1.0.0`|
|tailwindcss|CSSユーティリティ|`frontend`|`^3.0.0`|
|react-force-graph-2d|ネットワーク描画|`NetworkGraph.tsx`|`^1.29.1`|
|react-map-gl|MapLibre用React地図|`TechCardMap.tsx`|`^8.1.0`|
|maplibre-gl|地図描画|`TechCardMap.tsx`|`^5.19.0`|
|react-konva / konva|Canvas UI|`CardCropper.tsx`、`RoiEditor.tsx`|`^18.2.10` / `^9.3.22`|
|d3|可視化補助|Frontend|`^7.9.0`|
|qrcode.react|QR表示|スマホアップロード関連UI|`^3.1.0`|

## Backend依存関係

`backend/requirements.txt`にはバージョン指定がありません。

|名称|用途|使用箇所|Version|
|---|---|---|---|
|FastAPI|HTTP API|`backend/app/main.py`、`routers/`|指定なし|
|Uvicorn|ASGIサーバー|`dev_start.sh`|`[standard]`、番号指定なし|
|SQLAlchemy|ORM|`database.py`、`models.py`、`routers/`|指定なし|
|Pydantic|APIスキーマ|`schemas.py`|指定なし|
|Pillow / pillow-heif|画像処理・HEIF|`main.py`、画像処理|指定なし|
|OpenCV|画像処理・OCR前処理|`cards.py`、`card_crop.py`|指定なし|
|EasyOCR|OCR|`ocr.py`|指定なし|
|NumPy|画像配列処理|画像処理Router|`<2`のみ指定|
|qrcode|QR生成|`mobile_upload.py`|指定なし|
