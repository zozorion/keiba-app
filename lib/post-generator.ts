/**
 * 投稿テキストの動的生成本体。
 *
 * PostType（種別固有指示） + facts（事実データ） + persona（ペルソナ） + context（状況）
 * を組み合わせて Gemini に投げる。必須要素が欠けていれば1回だけリトライする。
 */

import { generateWithGemini, isGeminiConfigured } from './gemini';
import { buildPostContext, PostContext } from './post-context';
import { PostType } from './post-types';
import type { PostConfig } from '../app/api/post-config/route';

export interface GeneratePostInput {
  postType: PostType;
  facts: Record<string, string>;
  config: PostConfig;
  /** ISO datetime。投稿予定時刻（プレビュー時は現在で良い） */
  scheduledAt?: string;
}

export interface GeneratePostOutput {
  text: string;
  usedLLM: boolean;
  /** 検証で見つかった欠落キー（参考用） */
  missingFacts?: string[];
  error?: string;
}

/**
 * メイン関数。Gemini が使えれば動的生成、ダメなら空文字を返す。
 */
export async function generatePost(input: GeneratePostInput): Promise<GeneratePostOutput> {
  const { postType, facts, config, scheduledAt } = input;

  if (!isGeminiConfigured()) {
    return {
      text: '',
      usedLLM: false,
      error: 'GEMINI_API_KEY が未設定です。.env.local に GEMINI_API_KEY を追加してください。',
    };
  }

  const ctx = buildPostContext({ scheduledAt, recentPostsLimit: 10 });
  const systemInstruction = buildSystemInstruction(config);
  const userPrompt = buildUserPrompt(postType, facts, ctx);

  // 1回目
  let result = await generateWithGemini({
    systemInstruction,
    userPrompt,
    temperature: 0.95,
  });

  if (!result.ok) {
    return { text: '', usedLLM: false, error: result.error };
  }

  let text = sanitize(result.text);
  let missing = checkRequiredFacts(text, postType.requiredFacts, facts);

  // 必須要素が欠落していたら1回だけリトライ
  if (missing.length > 0) {
    const retryPrompt = userPrompt + `\n\n【重要】先ほど書いた文章には次の要素が欠けていました。今度は必ず自然な形で本文に含めてください：\n${missing.map(k => `- ${k}: ${facts[k]}`).join('\n')}`;
    const retry = await generateWithGemini({
      systemInstruction,
      userPrompt: retryPrompt,
      temperature: 0.85, // リトライ時は少し下げて指示遵守を優先
    });
    if (retry.ok) {
      text = sanitize(retry.text);
      missing = checkRequiredFacts(text, postType.requiredFacts, facts);
    }
  }

  return {
    text,
    usedLLM: true,
    missingFacts: missing.length > 0 ? missing : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/*                              プロンプト組み立て                            */
/* -------------------------------------------------------------------------- */

function buildSystemInstruction(config: PostConfig): string {
  const persona = config.persona;
  const rules = config.rules || [];

  const lines: string[] = [];
  lines.push(`あなたは「${persona.name || 'バカウマちゃんねる'}」というXアカウントの中の人です。投稿者本人になりきって、Xポストを1本書きます。`);
  lines.push('');
  lines.push('【あなたの人物像】');
  lines.push(persona.description || '');
  lines.push('');
  lines.push('【口調・トーン】');
  lines.push(persona.tone || '');
  if (persona.favHorse) {
    lines.push('');
    lines.push(`【推し馬】${persona.favHorse}`);
  }
  lines.push('');
  lines.push('【絶対に守るルール】');
  for (const r of rules) lines.push(`- ${r}`);
  lines.push('');
  lines.push('【書き方の原則】');
  lines.push('- Xポストとして自然な改行・絵文字使い。絵文字は使いすぎない（多くて2〜3個）。');
  lines.push('- AIが書いたっぽさを徹底的に排除する。「〜について」「以下の通り」みたいな説明調、箇条書きの羅列、過剰な装飾文字は使わない。');
  lines.push('- 「こんにちは」「お疲れ様です」みたいな挨拶から始めない。本人の生活の一コマを切り取るように書き出す。');
  lines.push('- 毎回違う切り口・違う書き出し・違う締め方で書く。同じ枕文を使い回さない。');
  lines.push('- ハッシュタグは本文の一番最後にまとめて、最大3個まで。');
  lines.push('- 出力は本文のみ。前置き（「以下が投稿文です：」など）や注釈・引用符は付けない。');
  lines.push('- Markdown記法（**太字**、##見出し）は絶対に使わない。');
  lines.push('- "pt"などのスコア数値は本文に書かない。');

  return lines.join('\n');
}

function buildUserPrompt(postType: PostType, facts: Record<string, string>, ctx: PostContext): string {
  const lines: string[] = [];

  lines.push(`【今回書く投稿の種類】${postType.label}`);
  lines.push('');
  lines.push(postType.prompt);
  lines.push('');

  // 必須事実
  if (postType.requiredFacts.length > 0) {
    lines.push('【本文に必ず自然な形で含める情報】');
    for (const key of postType.requiredFacts) {
      const v = facts[key];
      if (v) lines.push(`- ${key}: ${formatFactValue(v)}`);
    }
    lines.push('');
  }

  // 任意で参照できる追加情報
  const extraKeys = Object.keys(facts).filter(k => !postType.requiredFacts.includes(k) && facts[k]);
  if (extraKeys.length > 0) {
    lines.push('【参考情報（必要なら使ってOK、使わなくてもOK）】');
    for (const key of extraKeys.slice(0, 12)) {
      lines.push(`- ${key}: ${formatFactValue(facts[key])}`);
    }
    lines.push('');
  }

  // 状況コンテキスト
  lines.push('【今の状況】');
  lines.push(`- 投稿タイミング: ${ctx.timeLabel}（${ctx.timeSlot}）`);
  if (ctx.seasonNote) lines.push(`- 季節感: ${ctx.seasonNote}`);
  if (ctx.recentPerformance) lines.push(`- 最近の成績: ${ctx.recentPerformance}`);
  lines.push('');

  // 直近の自分の投稿（重複回避）
  if (ctx.recentPosts.length > 0) {
    lines.push('【直近のあなたの投稿（参考。これらと "似た書き出し・似た決まり文句・似たオチ" は絶対に使わないこと）】');
    ctx.recentPosts.slice(-10).forEach((p, i) => {
      lines.push(`${i + 1}. ${truncate(p, 200)}`);
    });
    lines.push('');
  }

  lines.push(`【文字数目安】${postType.lengthHint}（X の280字制限内）`);
  if (postType.hashtagHint) lines.push(`【ハッシュタグ】${postType.hashtagHint}`);
  lines.push('');
  lines.push('それでは、本文だけを出力してください。');

  return lines.join('\n');
}

function formatFactValue(v: string): string {
  // 改行を含む値は ; で繋ぐ（プロンプトの可読性のため）
  return v.replace(/\n+/g, ' / ').slice(0, 300);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

/* -------------------------------------------------------------------------- */
/*                               出力後処理・検証                              */
/* -------------------------------------------------------------------------- */

function sanitize(text: string): string {
  let t = text.trim();
  // よくある "余計な前置き" を除去
  t = t.replace(/^(以下が|以下の|本文[:：]|出力[:：]|投稿文[:：]|投稿内容[:：])[^\n]*\n+/, '');
  // 引用符で全体が囲まれている場合は外す
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('「') && t.endsWith('」'))) {
    t = t.slice(1, -1).trim();
  }
  // Markdown記法の除去（ペルソナルールでも禁止しているがフェイルセーフ）
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/^#{1,6}\s/gm, '');
  t = t.replace(/`(.+?)`/g, '$1');
  // 連続改行の整理
  t = t.replace(/\n{4,}/g, '\n\n\n');
  return t.trim();
}

/**
 * 必須要素が本文に含まれているかをゆるく検証。
 * - 値が複数行（top3_races のように "場+R+馬名" を3行）なら、半分以上の行の主要トークンが含まれていればOK
 * - 単一行の値なら、値そのものか主要トークンが含まれていればOK
 * - 値が空ならスキップ
 */
function checkRequiredFacts(text: string, requiredKeys: string[], facts: Record<string, string>): string[] {
  const missing: string[] = [];
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const haystack = norm(text);

  for (const key of requiredKeys) {
    const value = facts[key];
    if (!value) continue; // 値そのものが無ければチェック不能

    // 数値だけの値（venue_count="3" など）は緩めに：本文に同じ数字があればOK、なくてもwarningレベル
    if (/^\d+$/.test(value.trim())) {
      // 1桁の数字は本文に偶然含まれやすいので、欠落判定からは外す
      continue;
    }

    if (value.includes('\n')) {
      // 複数行 → 各行の主要部分を抽出
      const lines = value.split('\n').filter(l => l.trim());
      let hits = 0;
      for (const line of lines) {
        if (containsCore(haystack, line)) hits++;
      }
      // 半分以上の行が含まれていればOK
      if (hits < Math.ceil(lines.length / 2)) missing.push(key);
    } else {
      // 単一行 → "・" "/" 区切りなら要素のいずれか、それ以外は全体一致
      const parts = value.split(/[・,、\/]/).filter(p => p.trim());
      const ok = parts.some(p => containsCore(haystack, p));
      if (!ok) missing.push(key);
    }
  }
  return missing;
}

/**
 * value の主要トークン（馬名・場名など）が text に含まれているかゆるく判定。
 * 記号・空白を除いた前方一致と部分一致のハイブリッド。
 */
function containsCore(normalizedText: string, value: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const v = norm(value);
  if (!v) return true;
  // 全体が含まれていればOK
  if (normalizedText.includes(v)) return true;
  // 値からカタカナ4文字以上の連続（馬名候補）を抜き出して、いずれか含まれていればOK
  const katakanaTokens = value.match(/[ァ-ヴー]{3,}/g) || [];
  for (const t of katakanaTokens) {
    if (normalizedText.includes(norm(t))) return true;
  }
  // 漢字2文字以上の連続（場名候補）も同様
  const kanjiTokens = value.match(/[一-龥]{2,}/g) || [];
  for (const t of kanjiTokens) {
    if (normalizedText.includes(norm(t))) return true;
  }
  return false;
}
