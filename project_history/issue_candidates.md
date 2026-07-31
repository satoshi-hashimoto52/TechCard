# Issue候補一覧

すべて過去の開発内容を記録する振り返りIssue候補である。Issue #1との重複を確認し、#1は既存Issueへ反映、候補2〜10は新規登録した。

|No.|タイトル|期間|分類|関連コミット数|既存Issue|作成状態|クローズ状態|
|---:|---|---|---|---:|---|---|---|
|1|[振り返り] TechCard初期フルスタック基盤を構築|2026-03-07|maintenance/backend/frontend|1|[#1](https://github.com/satoshi-hashimoto52/TechCard/issues/1)|反映済み|CLOSED|
|2|[振り返り] スマートフォン名刺取込と連続登録を実装|2026-03-10|enhancement/backend/frontend|3|[#2](https://github.com/satoshi-hashimoto52/TechCard/issues/2)|登録済み|CLOSED|
|3|[振り返り] 連絡先ネットワークグラフの初期機能を実装|2026-03-10～2026-03-11|enhancement/frontend/backend|5|[#3](https://github.com/satoshi-hashimoto52/TechCard/issues/3)|登録済み|CLOSED|
|4|[振り返り] 会社地図とジオコーディング表示を実装|2026-03-11|enhancement/frontend/backend|8|[#4](https://github.com/satoshi-hashimoto52/TechCard/issues/4)|登録済み|CLOSED|
|5|[振り返り] 名刺クロップ・ROI OCR取込を再設計|2026-03-11～2026-03-14|enhancement/backend/frontend|9|[#5](https://github.com/satoshi-hashimoto52/TechCard/issues/5)|登録済み|CLOSED|
|6|[振り返り] 会社・イベント・タグを含む連絡先管理を拡張|2026-03-12～2026-03-17|enhancement/backend/frontend|5|[#6](https://github.com/satoshi-hashimoto52/TechCard/issues/6)|登録済み|CLOSED|
|7|[振り返り] ネットワークグラフの操作性とレイアウト保存を安定化|2026-03-10～2026-03-18|bug/frontend/backend|15|[#7](https://github.com/satoshi-hashimoto52/TechCard/issues/7)|登録済み|CLOSED|
|8|[振り返り] 現行アーキテクチャと運用仕様を文書化|2026-03-16|documentation|1|[#8](https://github.com/satoshi-hashimoto52/TechCard/issues/8)|登録済み|CLOSED|
|9|[振り返り] Playwright E2E回帰テストとAPIサービス分離を追加|2026-03-19|testing/frontend|1|[#9](https://github.com/satoshi-hashimoto52/TechCard/issues/9)|登録済み|CLOSED|
|10|[振り返り] 地図・ネットワーク表示を暫定版後に調整|2026-03-24|bug/frontend/backend|1|[#10](https://github.com/satoshi-hashimoto52/TechCard/issues/10)|登録済み|CLOSED|

## 作成判断

GitHub Apps経由の作成は行わない。指定されたローカル `gh` CLIで既存Issueと候補の重複を確認し、Issue #1を除く候補2〜10を登録して `retrospective` ラベルを付与した。実装済みと再調査できたIssue #1〜#10は確認結果をコメントしてクローズした。
