# コーディングルール

以下は現行コードから確認できる規則です。明示的なプロジェクト規約として記載されたものと、実装上の慣例を分けていません。

## 命名と配置

- Pythonモジュールは小文字のsnake_caseです。
- ReactコンポーネントはPascalCaseの`.tsx`ファイルです。
- APIサービスは`frontend/src/services/`に配置されています。
- API Routerは`backend/app/routers/`に配置されています。
- Frontendの状態はページ・コンポーネントのReact state、`useMemo`、`useCallback`、`useEffect`で管理されています。

## 型定義

- TypeScriptは`strict: true`です。
- APIレスポンス型はサービスファイルに定義されています。
- Backendの入出力はPydantic schemaで定義されています。
- 現行コードには`any`の使用箇所もあります。完全に排除されていることは確認できません。

## エラー処理

- Axiosエラーは`frontend/src/lib/api.ts`で`ApiError`へ変換されます。
- Abortされたリクエストは`isAbortError`で判定されます。
- Backend Routerは`HTTPException`を使用します。
- 画像処理・外部通信には例外処理とユーザー向けエラー表示があります。

## 非同期処理

- FrontendのAPI呼び出しはPromiseと`AbortController`を使用します。
- OCRはBackend内の進捗辞書`OCR_JOBS`を使う非同期処理です。
- ネットワークレイアウト保存はタイマーによる遅延保存です。

## コメント

コメントは必要な箇所にありますが、リポジトリ全体で統一されたコメント規則は確認できません。
