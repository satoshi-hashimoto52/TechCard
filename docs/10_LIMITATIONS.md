# 制限事項・未実装

以下はREADME、`docs/project_spec.md`、現行コードに明記または確認できる事項です。

## READMEに記載されたTODO

- 単体・統合テスト基盤
- 認証基盤
- OCRジョブの永続化
- CORS本番運用の最適化
- UIアクセシビリティ改善
- Backendジョブ監視の監視系導線

## project_spec.mdに記載されたTODO

- 認証・認可（JWT/OAuth）
- Backend APIのバリデーション・エラーメッセージ統一
- GraphQLまたはOpenAPI自動生成の厳密化
- OCRジョブのRedisまたはDB queueによる永続化
- ファイル保存のローテーション・サイズ制限・削除ポリシー
- TypeScriptの`any`排除
- APIとE2Eの統合テスト
- CORSの環境別許可

## 現在の実装から確認できる制約

- `backend/app/main.py`でCORSの全Origin・全Method・全Headerを許可しています。
- Backendの認証・認可機構は確認できません。
- OCRジョブは`OCR_JOBS`というプロセス内辞書を使用しています。
- 地図・経路・ジオコーディングは外部サービスURLを使用します。外部サービスの可用性、料金、利用制限はこのリポジトリから確認できません。
- `MapView.tsx`には「未使用」と表示する画面があります。Frontendの`App.tsx`ではルート登録されていません。

## 確認できない事項

- 本番環境の構成、デプロイ方法、CI/CD
- 外部APIの認証情報・利用契約・上限
- 実データを使ったOCR精度
- 実ブラウザでの全画面表示、外部地図表示、実機カメラ動作
- Backendの性能上限、バックアップ、復旧手順
