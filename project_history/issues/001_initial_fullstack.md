# [振り返り] TechCard初期フルスタック基盤を構築

## 概要

名刺を起点に連絡先、会社、タグ、会議、技術情報を管理するTechCardの初期フルスタック基盤を構築した。

## 背景・目的

初回コミットでアプリケーション全体が追加されている。既存システムからの移行理由や詳細な作業指示は履歴から確認できない。

## 実施内容

- FastAPI、SQLAlchemy、SQLiteによるデータ/API基盤を追加。
- 名刺画像のOCR処理、技術タグ抽出、連絡先・会社・タグ・会議・統計・グラフAPIを追加。
- React/TypeScript、TailwindCSSによるダッシュボード、連絡先、登録、名刺アップロード、技術検索、ネットワーク画面を追加。
- 開発用依存関係、起動設定、READMEを追加。

## 主な変更ファイル

- `backend/app/main.py`
- `backend/app/models.py`
- `backend/app/ocr.py`
- `backend/app/routers/contacts.py`
- `backend/app/routers/cards.py`
- `backend/app/routers/graph.py`
- `frontend/src/App.tsx`
- `frontend/src/pages/ContactRegister.tsx`
- `frontend/src/pages/NetworkGraph.tsx`

## 関連コミット

- `380fd7dd7ab65a15b0e9e3b23129b0ebd84bff77` 初期版一式を追加

## 実作業期間

2026-03-07

## 確認内容

初期ファイルと設定がコミットされたことは確認できる。テスト実行、ビルド成功、手動確認の記録は履歴から確認できない。

## 現在の状態

初期構成は後続変更で大きく拡張されているが、FastAPI + React + SQLiteを中心とする構成は現在も使用されている。

## 備考

このIssueは過去に完了した開発内容を記録するための振り返りIssueである。

## GitHub Issue

- Issue番号: #1
- URL: https://github.com/satoshi-hashimoto52/TechCard/issues/1
- 状態: CLOSED
- ラベル: `retrospective`
