# データベース

## 接続

- DB: SQLite
- 接続URL: `sqlite:///./techcard.db`
- ORM: SQLAlchemy
- Session: `SessionLocal`
- 定義: `backend/app/database.py`、`backend/app/models.py`

## エンティティ

|テーブル|モデル|主な項目・関係|
|---|---|---|
|`contacts`|`Contact`|氏名、メール、電話、会社、タグ、イベント、会議、名刺|
|`companies`|`Company`|会社名、グループ、住所、緯度経度、技術タグ|
|`tags`|`Tag`|名称、type、連絡先・会社・グループとの関連|
|`company_groups`|`CompanyGroup`|名称、説明、会社、alias、タグ|
|`company_group_alias`|`CompanyGroupAlias`|グループID、alias|
|`events`|`Event`|名称、期間、場所、年、参加者|
|`meetings`|`Meeting`|連絡先、日時、メモ|
|`business_cards`|`BusinessCard`|ファイル名、OCR本文、連絡先|
|`company_route_cache`|`CompanyRouteCache`|会社間ルート、距離、経路、provider、更新日時|

## 中間テーブル

- `contact_tags`
- `contact_tech_tags`
- `company_tech_tags`
- `company_group_tags`
- `event_contacts`

## Migration

専用のMigrationフレームワークは確認できません。`backend/app/main.py`起動時の`CREATE TABLE`と列追加・データ補正、および次のスクリプトが存在します。

- `backend/scripts/migrate_add_notes.py`
- `backend/scripts/migrate_network_tags.py`

既存DBへの変更を伴うため、これらのスクリプトの実行条件とバックアップ方針はこのリポジトリからは確認できません。
