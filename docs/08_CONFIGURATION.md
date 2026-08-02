# 設定

## Frontend環境変数

`frontend/src/lib/api.ts`で次の環境変数を参照します。

|変数|用途|デフォルト|
|---|---|---|
|`REACT_APP_API_BASE_URL`|Backend APIのベースURL|`http://localhost:8000`|
|`REACT_APP_API_TIMEOUT_MS`|Axiosのタイムアウト（ミリ秒）|`15000`|

値の型や本番用設定はこのリポジトリからは確認できません。

## Backend設定

- SQLite接続URLは`backend/app/database.py`に固定されています。
- CORSは`backend/app/main.py`で全Origin、全Method、全Headerを許可しています。
- 外部ルートサービスURLやジオコーディングサービスURLは`backend/app/routers/stats.py`に定義されています。
- Backendの認証設定は確認できません。

## ポート

|用途|ポート|根拠|
|---|---:|---|
|Frontend|3000|README、`frontend/playwright.config.ts`|
|Backend HTTP|8000|README、`dev_start.sh`|
|Backend HTTPS|8443|README、`dev_start.sh`|

## 証明書・生成データ

`dev_start.sh`はBackendの次の証明書候補を参照します。

- `backend/certs/lan.pem` / `lan-key.pem`
- `backend/certs/localhost.pem` / `localhost-key.pem`

証明書の発行方法や秘密鍵の内容はこの資料には記載しません。DB、ログ、アップロードデータは`.gitignore`で除外対象です。
