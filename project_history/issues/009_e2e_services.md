# [振り返り] Playwright E2E回帰テストとAPIサービス分離を追加

## 概要

連絡先、地図、ネットワークの主要操作を対象とするPlaywright E2Eテストと、フロントエンドAPIサービス層を追加した。

## 目的

主要画面の操作を再現可能な形で確認し、APIアクセスを画面実装から分離する構成を整えた。導入理由の詳細は履歴から確認できない。

## 実施内容

- 連絡先タグ編集、会社地図、ネットワーク操作のE2Eテストを追加。
- ドラッグ中のhover、連続クリック、API遅延、Abort時の表示を回帰シナリオとして記録。
- contacts、companies、stats、tagsのAPI呼び出しをサービスファイルへ分離。
- Playwright設定とテスト用識別子を追加。

## 主な変更ファイル

- `frontend/e2e/contacts.spec.ts`
- `frontend/e2e/map.spec.ts`
- `frontend/e2e/network.spec.ts`
- `frontend/e2e/network.regression.spec.ts`
- `frontend/playwright.config.ts`
- `frontend/src/services/contactService.ts`
- `frontend/src/services/companyService.ts`
- `frontend/src/services/statsService.ts`
- `frontend/src/services/tagService.ts`

## 関連コミット

- `333e6bf1b98f86dcba02fabd5a2d2f1659f762e3` E2Eテストとサービス層を追加

## 実作業期間

2026-03-19

## 確認内容

テストコードと設定ファイルが追加されたことは確認できる。テスト実行成功、ブラウザ手動確認、CI実行の記録は履歴から確認できない。

## 現在の状態

E2Eテストとサービスファイルは現在のツリーに残っている。テストが現環境で成功するかは未確認である。

## 備考

このIssueは振り返りIssueである。

## GitHub Issue

- Issue番号: #9
- URL: https://github.com/satoshi-hashimoto52/TechCard/issues/9
- 状態: CLOSED
- ラベル: `retrospective`
