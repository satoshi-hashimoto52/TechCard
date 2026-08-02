# APIリファレンス

BackendのRouter定義から確認できるAPIです。ベースURLはデフォルトで`http://localhost:8000`です。詳細な全フィールドは各Routerと`backend/app/schemas.py`を参照してください。

## ルート・連絡先・会社

|Method|Endpoint|Request|Response|
|---|---|---|---|
|GET|`/`|なし|`message`を含むJSON|
|POST|`/contacts/`|`ContactCreate`|`ContactRead`|
|POST|`/contacts/register`|`ContactRegisterRequest`|`ContactRead`|
|GET|`/contacts/`|`skip`、`limit`等|`ContactRead`配列|
|GET|`/contacts/{contact_id}`|パスID|`ContactRead`|
|PUT|`/contacts/{contact_id}`|`ContactCreate`相当|`ContactRead`|
|PUT|`/contacts/{contact_id}/register`|登録データ|`ContactRead`|
|PUT|`/contacts/{contact_id}/self`|`ContactSelfRequest`|`ContactRead`|
|DELETE|`/contacts/{contact_id}`|パスID|ステータスJSON|
|POST|`/companies/`|`CompanyCreate`|`CompanyRead`|
|GET|`/companies/`|クエリ|`CompanyRead`配列|
|GET|`/companies/{company_id}`|パスID|`CompanyRead`|
|GET|`/companies/{company_id}/detail`|パスID|`CompanyDetail`|
|PUT|`/companies/{company_id}`|`CompanyCreate`相当|`CompanyRead`|
|PUT|`/companies/{company_id}/group`|`CompanyGroupUpdate`|`CompanyRead`|
|DELETE|`/companies/{company_id}`|パスID|ステータスJSON|
|GET|`/companies/resolve`|クエリ|`CompanyTagResolveResponse`|
|GET/PUT|`/companies/{company_id}/tags`|タグ結合データ|`TagRead`配列|

## タグ・イベント・会議・グループ

|Method|Endpoint|Request|Response|
|---|---|---|---|
|POST/GET|`/tags/`|`TagCreate` / クエリ|タグJSON / `TagRead`配列|
|GET/PUT/DELETE|`/tags/{tag_id}`|パスID、`TagCreate`|`TagRead` / ステータスJSON|
|POST|`/tags/extract`|`TechExtractRequest`|`TechExtractResponse`|
|GET|`/events/`|なし|`EventRead`配列|
|GET|`/events/{event_id}`|パスID|`EventDetail`|
|POST|`/events/`|`EventCreate`|`EventRead`|
|POST|`/events/{event_id}/participants`|参加者ID|登録結果|
|DELETE|`/events/{event_id}/participants/{contact_id}`|パスID|削除結果|
|POST/GET|`/meetings/`|`MeetingCreate` / クエリ|`MeetingRead` / 配列|
|GET/PUT/DELETE|`/meetings/{meeting_id}`|パスID、`MeetingBase`|`MeetingRead` / ステータスJSON|
|GET/PUT|`/company-groups/{group_id}/tags`|タグ結合データ|`TagRead`配列|
|GET/POST|`/company-groups/`|`CompanyGroupCreate`|グループ配列 / `CompanyGroupRead`|
|PUT|`/company-groups/{group_id}`|グループデータ|`CompanyGroupRead`|
|POST|`/company-groups/{group_id}/aliases`|aliasデータ|`CompanyGroupRead`|
|GET|`/company-groups/suggest`|クエリ|JSON|

## 名刺・モバイルアップロード

|Method|Endpoint|Request|Response|
|---|---|---|---|
|POST|`/cards/upload`|UploadFile|ジョブIDと状態|
|GET|`/cards/upload/status/{job_id}`|ジョブID|OCRジョブ状態|
|POST|`/cards/ocr-region`|画像・ROIデータ|OCR結果|
|POST/GET|`/cards/`|`BusinessCardCreate`|カードJSON / 配列|
|GET/PUT/DELETE|`/cards/{business_card_id}`|パスID、カードデータ|カードJSON / ステータスJSON|
|POST|`/card/crop`|`CropRequest`|クロップ結果|
|POST|`/card/detect`|`DetectRequest`|検出結果|
|POST|`/api/mobile-upload/sessions`|セッションデータ|セッションJSON|
|GET|`/api/mobile-upload/latest`|なし|最新アップロード情報|
|GET|`/api/mobile-upload/files/{filename}`|ファイル名|画像レスポンス|
|GET|`/mobile-upload/{session_id}`|セッションID|HTML|
|GET|`/api/mobile-upload/{session_id}/status`|セッションID|状態JSON|
|POST|`/api/mobile-upload/{session_id}/image`|UploadFile|アップロード結果|
|GET|`/api/mobile-upload/{session_id}/image`|セッションID|画像レスポンス|
|GET|`/api/mobile-upload/{session_id}/qr`|セッションID|QRレスポンス|

## 統計・グラフ・管理

|Method|Endpoint|Request|Response|
|---|---|---|---|
|GET|`/stats/summary`|なし|統計JSON|
|GET|`/stats/company-map`|`refresh`クエリ|会社地点配列|
|GET|`/stats/company-map/diagnostics`|なし|診断JSON|
|GET|`/stats/company-route`|会社ID・座標等|ルートJSON|
|GET|`/stats/network`|`technology`、`company`、`person`等|ノード・エッジJSON|
|GET|`/graph/network`|`technology`、`company`、`person`等|ノード・エッジJSON|
|POST|`/admin/shutdown`|なし|停止受付結果|

認証・認可のAPIは確認できません。
