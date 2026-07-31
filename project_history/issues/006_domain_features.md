# [振り返り] 会社・イベント・タグを含む連絡先管理を拡張

## 概要

連絡先を会社、会社グループ、イベント、タグ、会議履歴と結び付け、一覧・詳細・登録・検索画面を拡張した。

## 背景・目的

3月12日以降、会社グループ、イベント、タグ分類、会社詳細、タイムライン、Insightsなどの機能がまとまって追加されている。個別機能の要求順序や背景は履歴から確認できない。

## 実施内容

- イベントと参加者、会社グループとエイリアスのデータモデル/API/UIを追加。
- 連絡先一覧を会社・グループ単位で表示し、タグ編集や展開状態保存を追加。
- 会社詳細、イベント詳細、タイムライン、Insights、地図画面を追加。
- ネットワーク統計へ会社・技術・イベントの関係を反映。

## 主な変更ファイル

- `backend/app/models.py`
- `backend/app/routers/events.py`
- `backend/app/routers/company_groups.py`
- `backend/app/routers/companies.py`
- `backend/app/routers/contacts.py`
- `backend/app/routers/tags.py`
- `frontend/src/pages/CompanyGroups.tsx`
- `frontend/src/pages/EventRegister.tsx`
- `frontend/src/pages/Contacts.tsx`
- `frontend/src/pages/Insights.tsx`

## 関連コミット

- `45bafa0ded3385221b7d42a5ca9492bc61e19808` イベント・ネットワークタグ基盤を追加
- `182d962fa960ca5116301ed5be07fe80f2368396` 会社グループ・イベント画面を追加
- `c61bd62610bfd87a9059ebf575901a0c99153ad8` 連絡先一覧、Insights、タイムライン、地図を拡張
- `3367b423319ec207e799465698d097cadaebd0e0` 会社・グループ・連絡先表示を調整
- `a6ed4fe712b11ae626812273dca4132fc3c31094` 会社・連絡先・タグ連携を調整

## 実作業期間

2026-03-12 ～ 2026-03-17

## 確認内容

データモデル、API、画面、移行スクリプトの追加は確認できる。DB移行の実行成功や画面の手動確認結果は履歴から確認できない。

## 現在の状態

会社、会社グループ、イベント、タグ、連絡先の各画面・APIは現在のツリーに残っている。後続のネットワーク表示変更により関係の見せ方は更新されている。

## 備考

このIssueは振り返りIssueである。

## GitHub Issue

- Issue番号: #6
- URL: https://github.com/satoshi-hashimoto52/TechCard/issues/6
- 状態: CLOSED
- ラベル: `retrospective`
