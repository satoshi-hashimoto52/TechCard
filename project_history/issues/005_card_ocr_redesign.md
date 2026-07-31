# [振り返り] 名刺クロップ・ROI OCR取込を再設計

## 概要

名刺画像の4点検出、透視変換クロップ、ROI編集、領域単位OCRを分離し、登録画面の画像取込フローを再設計した。

## 背景・目的

旧ROIルーターを削除し、カードクロップルーターと専用UIコンポーネントへ移行する大きな差分がある。旧実装で生じた具体的な問題や再設計理由は、コミット差分だけでは断定できない。

## 実施内容

- 自動検出した4点を手動補正し、クロップ結果を確認するUIを追加。
- ROIを自由に移動・リサイズし、テンプレートをブラウザ保存・リセットできるようにした。
- `/card/crop` と `/cards/ocr-region` を用いた領域単位OCRを登録フローへ統合。
- 画像サイズ、OCR整形、スマートフォン画像の受け渡しを段階的に調整。

## 主な変更ファイル

- `backend/app/routers/card_crop.py`
- `backend/app/ocr.py`
- `frontend/src/components/CardCropper.tsx`
- `frontend/src/components/RoiEditor.tsx`
- `frontend/src/pages/ContactRegister.tsx`
- `backend/app/routers/roi.py`（後続で削除）

## 関連コミット

- `b8b7cc3d8ee9e14783d758d91b99c1d777d34518` クロップ・ROI実装を再構成
- `c9fe80f64ec5e8fd28148f42729a409db710685e` ROI編集を調整
- `c689d8da93c2ab4a46ef505ffa8c15298bc42aaf` クロップと登録フローを調整
- `21a4d585de83d4ff87faad6a0dcce502dec856e3` 登録画面を調整
- `d73830c7b563af67db1385e4ff28d53bd3203995` 画像取込仕様をREADMEへ反映
- `f1900ff0fe70ee1c18f1db76c18cda5111d88cdd` スマートフォン画像取込とOCR連携を調整
- `fb6798f377d5fd49d0cc65fe755f1cf0181ac878` クロップ処理を調整
- `c946f16d419bdb1289b3b00033cee99f085cf687` ROIと登録処理を調整
- `aa5e675f6cc48fdb828abe6058d0dd8ef702089d` クロップ処理を安定化

## 実作業期間

2026-03-11 ～ 2026-03-14

## 確認内容

コンポーネント分割とAPI差分は確認できる。OCR精度、実画像でのクロップ成功、実機確認、テスト成功の記録は履歴から確認できない。

## 現在の状態

現在は `card_crop.py`、`CardCropper.tsx`、`RoiEditor.tsx`、登録画面の領域OCR処理が使用されている。旧 `roi.py` は現行ツリーに存在しない。

## 備考

履歴に含まれる画像バイナリの内容は記載していない。このIssueは振り返りIssueである。

## GitHub Issue

- Issue番号: #5
- URL: https://github.com/satoshi-hashimoto52/TechCard/issues/5
- 状態: CLOSED
- ラベル: `retrospective`
