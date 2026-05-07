<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 環境変数（.env.local）

このプロジェクトは `.env.local` から以下を読みます：

- `GEMINI_API_KEY` — X投稿の動的生成（Gemini Pro）に使用。**未設定だとX投稿生成が失敗します**
- `GEMINI_MODEL` — 任意。デフォルト `gemini-2.5-pro`
- `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` — X (Twitter) 投稿用

# X投稿の生成方式（重要）

X系13種（`x-preview`, `x-morning`, `x-race`, …）は**テンプレ文を使わず Gemini で動的生成**します。
- 種別ごとの「指示プロンプト + 必須事実 + 文字数目安」が `lib/post-types.ts` に定義
- ペルソナとルールは `data/post-config.json` から読み出し、システムプロンプトに毎回反映
- 状況コンテキスト（曜日・時刻・季節・直近成績・過去10投稿）は `lib/post-context.ts` が組み立て
- 必須事実が欠落していたら1回だけ自動リトライ（`lib/post-generator.ts`）

note系は引き続きテンプレ + 変数置換方式（`app/api/posts/route.ts` の `NOTE_TEMPLATES`）。
