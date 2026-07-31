# [振り返り] 現行アーキテクチャと運用仕様を文書化

## 概要

アプリケーションの構成、画面、API、保存方式、地図・グラフ・名刺OCRの仕様をREADMEとプロジェクト仕様書へ整理した。

## 目的

後続開発を継続できるよう、実装済みの構成と重要な挙動を文書化した。文書化のきっかけや利用者は履歴から確認できない。

## 実施内容

- READMEへ起動方法、スマートフォン撮影、OCR、ROI、グラフ、API概要を追記。
- `docs/project_spec.md` を追加し、技術スタック、構造、画面仕様、API、保存キー、運用上の注意点を記載。
- 固定ノード、localStorageキー、モバイルアップロードなど、後続修正で重要になった仕様を明文化。

## 主な変更ファイル

- `README.md`
- `docs/project_spec.md`

## 関連コミット

- `bad3c60cd6d4d2647d75225bcfdfc2e99f1465c6` README拡張とプロジェクト仕様書を追加

## 実作業期間

2026-03-16

## 確認内容

現在のコードと仕様書に記載された主要ルート・保存キーの対応を確認した。仕様書の完全性や記載内容の自動検証記録はない。

## 現在の状態

READMEと `docs/project_spec.md` は現在もリポジトリに存在する。ただし、文書と現行コードの差異がないことまでは保証できない。

## 備考

このIssueは振り返りIssueである。

## GitHub Issue

- Issue番号: #8
- URL: https://github.com/satoshi-hashimoto52/TechCard/issues/8
- 状態: CLOSED
- ラベル: `retrospective`
