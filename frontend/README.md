# TechCard フロントエンド

これは TechCard プロジェクトの React/TypeScript ベースのフロントエンドアプリケーションです。TailwindCSS を使用したモダンな UI を提供します。

## 技術スタック

- **React**: 18.0.0
- **TypeScript**: 5.0.0
- **TailwindCSS**: 3.0.0
- **React Router DOM**: 6.0.0 (ページ遷移)
- **Axios**: 1.0.0 (API 通信)

## 機能

- **Dashboard**: 連絡先、会社、タグ、ミーティングの統計を表示
- **Contacts**: 連絡先リストを表示（カードスタイル）
- **ContactDetail**: 個別の連絡先詳細（タグ、ミーティング、名刺情報）
- **TechnologySearch**: 技術タグによる連絡先検索
- **CardUpload**: 名刺画像のアップロードと OCR 結果表示

サイドバー navigation でページ間を移動できます。

## セットアップ

1. 依存関係をインストール:

   ```bash
   cd techcard/frontend
   npm install
   ```

2. 開発サーバーを起動:

   ```bash
   npm start
   ```

   ブラウザで `http://localhost:3000` にアクセス。

## 使用方法

- バックエンド API が `http://localhost:8000` で動作していることを確認してください。
- 各ページでデータを取得・表示します。
- CardUpload ページで画像をアップロードし、OCR 結果を確認できます。

## プロジェクト構造

```
src/
├── components/
│   └── Sidebar.tsx          # サイドバー navigation
├── pages/
│   ├── Dashboard.tsx        # ダッシュボードページ
│   ├── Contacts.tsx         # 連絡先リスト
│   ├── ContactDetail.tsx    # 連絡先詳細
│   ├── TechnologySearch.tsx # 技術検索
│   └── CardUpload.tsx       # 名刺アップロード
├── App.tsx                  # メインアプリ (Router 設定)
├── index.tsx                # エントリーポイント
└── index.css                # TailwindCSS インポート
```

TailwindCSS の設定は `tailwind.config.js` と `postcss.config.js` にあります。
