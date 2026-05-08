/**
 * コミュニティ投稿テンプレート管理
 *
 * 他人のXポストを「構成（骨組み・修辞技法）」だけ抽出して保存し、
 * 自分の投稿生成時にランダム or 適合度ベースでpickして「この構成で書いて」と
 * Geminiに指示する。元投稿の内容そのものはコピーしない。
 */

import fs from 'fs';
import path from 'path';
import { generateWithGemini, isGeminiConfigured } from './gemini';

const STORE_PATH = path.join(process.cwd(), 'data', 'community-templates.json');

export interface CommunityTemplate {
  id: string;
  createdAt: string;
  /** 元投稿（参考保持。生成時のプロンプトには含めない） */
  sourceTweet: string;
  sourceAuthor?: string;
  /** AI抽出: 短いラベル */
  name: string;
  /** AI抽出: この構成を真似て書く時の指示書（事実・固有名詞は含まない） */
  structurePrompt: string;
  /** AI抽出: タグ（matching用） */
  tags: string[];
  /** AI抽出: トーン */
  tone: 'casual' | 'serious' | 'data-heavy' | 'emotional' | 'mixed';
  /** AI抽出: 長さ */
  length: 'short' | 'medium' | 'long';
  /** AI抽出: 構成の特徴メモ（人間用、ピック時には使わない） */
  structureNotes?: string;
  /** 使用回数 */
  useCount: number;
  /** お気に入り（ピック時の重み3倍） */
  favorited: boolean;
}

interface Store {
  templates: CommunityTemplate[];
}

function loadStore(): Store {
  if (!fs.existsSync(STORE_PATH)) return { templates: [] };
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as Store;
  } catch {
    return { templates: [] };
  }
}

function saveStore(store: Store) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export function listTemplates(): CommunityTemplate[] {
  return loadStore().templates;
}

export function deleteTemplate(id: string): boolean {
  const store = loadStore();
  const before = store.templates.length;
  store.templates = store.templates.filter(t => t.id !== id);
  if (store.templates.length === before) return false;
  saveStore(store);
  return true;
}

export function setFavorited(id: string, favorited: boolean): boolean {
  const store = loadStore();
  const t = store.templates.find(t => t.id === id);
  if (!t) return false;
  t.favorited = favorited;
  saveStore(store);
  return true;
}

export function incrementUseCount(id: string) {
  const store = loadStore();
  const t = store.templates.find(t => t.id === id);
  if (t) {
    t.useCount += 1;
    saveStore(store);
  }
}

/**
 * Gemini で投稿の構成を抽出してテンプレ化。固有名詞・事実は捨てる。
 */
const ANALYZE_SYSTEM = `あなたはX(Twitter)投稿のコピーライティング講師です。
他人の投稿を見て、その「構成・骨組み・修辞技法」だけを取り出します。
固有名詞、事実、テーマ、登場人物名などは取り出しません（剽窃にならないため）。

抽出する観点:
- 書き出しの仕掛け（疑問形、体言止め、独白、シーン描写など）
- 段落構成と各段落の役割（フック→展開→対比→締めなど）
- 改行・空行のリズム
- 文末表現（「〜だ」「〜と思う」「？」など）
- 修辞技法（比喩・対比・反復・省略法・体言止めなど）
- 絵文字・ハッシュタグの使い方（位置・密度）
- 全体のトーン（カジュアル/真面目/データ重視/感情的）

出力するstructurePromptは「この骨組みを真似て、別テーマで新しい投稿を書く時の指示書」として機能する形に。
内容を真似させてはいけません、構成を真似させます。`;

interface AnalyzeResult {
  ok: boolean;
  template?: Omit<CommunityTemplate, 'id' | 'createdAt' | 'useCount' | 'favorited' | 'sourceTweet' | 'sourceAuthor'>;
  error?: string;
}

export async function analyzeTweetStructure(sourceTweet: string): Promise<AnalyzeResult> {
  if (!isGeminiConfigured()) {
    return { ok: false, error: 'GEMINI_API_KEY が未設定です' };
  }

  const userPrompt = `【元投稿】
${sourceTweet}

【出力】JSONのみ。前後に説明文や\`\`\`は付けない:
{
  "name": "<15字以内の短いラベル。例: '体言止めフック→対比→問いかけ'>",
  "structurePrompt": "<この構成で別テーマの投稿を書く時の指示書(200-400字)。事実や固有名詞は含めない。「〜から書き始める」「〜段落構成にする」「文末は〜にする」のような骨組み指示>",
  "tags": ["<3-6個のタグ。例: 'morning','data-driven','casual','race-day','recap'>"],
  "tone": "<casual|serious|data-heavy|emotional|mixed のいずれか>",
  "length": "<short(180字未満)|medium(180-240字)|long(240字超) のいずれか>",
  "structureNotes": "<人間が読んで納得できる構成の特徴メモ(100字以内)>"
}`;

  const result = await generateWithGemini({
    systemInstruction: ANALYZE_SYSTEM,
    userPrompt,
    temperature: 0.5,
    maxOutputTokens: 2048,
  });

  if (!result.ok) return { ok: false, error: result.error };

  let s = result.text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return { ok: false, error: 'JSON形式で返ってきませんでした' };

  try {
    const parsed = JSON.parse(s.substring(start, end + 1));
    if (!parsed.name || !parsed.structurePrompt) {
      return { ok: false, error: '必須フィールド (name, structurePrompt) が欠落しています' };
    }
    const validTones = ['casual', 'serious', 'data-heavy', 'emotional', 'mixed'];
    const validLengths = ['short', 'medium', 'long'];
    return {
      ok: true,
      template: {
        name: String(parsed.name).slice(0, 30),
        structurePrompt: String(parsed.structurePrompt).slice(0, 800),
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : [],
        tone: validTones.includes(parsed.tone) ? parsed.tone : 'mixed',
        length: validLengths.includes(parsed.length) ? parsed.length : 'medium',
        structureNotes: typeof parsed.structureNotes === 'string' ? parsed.structureNotes.slice(0, 200) : '',
      },
    };
  } catch (e: any) {
    return { ok: false, error: `JSONパース失敗: ${e.message}` };
  }
}

/**
 * 投稿テキストを保存（AI分析→ストア追加）
 */
export async function addTemplateFromTweet(
  sourceTweet: string,
  sourceAuthor?: string
): Promise<{ ok: boolean; template?: CommunityTemplate; error?: string }> {
  const trimmed = sourceTweet.trim();
  if (!trimmed) return { ok: false, error: '投稿テキストが空です' };
  if (trimmed.length > 2000) return { ok: false, error: '投稿テキストが長すぎます (2000字超)' };

  const r = await analyzeTweetStructure(trimmed);
  if (!r.ok || !r.template) return { ok: false, error: r.error || '分析失敗' };

  const store = loadStore();
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newTemplate: CommunityTemplate = {
    id,
    createdAt: new Date().toISOString(),
    sourceTweet: trimmed,
    sourceAuthor: sourceAuthor?.trim() || undefined,
    ...r.template,
    useCount: 0,
    favorited: false,
  };
  store.templates.unshift(newTemplate);
  saveStore(store);
  return { ok: true, template: newTemplate };
}

/**
 * 投稿生成時に呼ぶ：適合するテンプレを1個ピックする。
 *
 * 戦略:
 * - postTypeId からデフォルトのタグを推測（x-morning→["morning"]、x-recap→["recap","result"]）
 * - 該当タグを含むテンプレを優先
 * - その中から重み付きランダム（favorited=3倍、useCountが少ない方が優先=新鮮度）
 * - 全くマッチしなければ全テンプレからランダム
 *
 * 確率パラメータ:
 * - useRate: このコミュニティテンプレ機能を発動する確率（0-1.0）。デフォ0.4
 * - 0なら一切ピックしない（=毎回オリジナル指示）
 */
export interface PickOptions {
  postTypeId: string;
  /** ピックの発動確率(0.0-1.0)。デフォルト0.4 */
  useRate?: number;
  /** 強制でピックする(useRate無視) */
  force?: boolean;
}

const POST_TYPE_TAG_HINTS: Record<string, string[]> = {
  'x-preview': ['preview', 'forecast', 'hype', 'weekend'],
  'x-morning': ['morning', 'casual', 'race-day'],
  'x-race': ['race-day', 'pivot', 'data-driven', 'analysis'],
  'x-result': ['result', 'recap', 'reflection'],
  'x-graded': ['graded', 'big-race', 'hype', 'g1', 'celebration'],
  'x-bias': ['data-driven', 'analysis', 'track-bias'],
  'x-course': ['data-driven', 'course', 'analysis'],
  'x-daily': ['casual', 'daily', 'reflection'],
  'x-weekly': ['recap', 'summary', 'week-end'],
  'x-value': ['data-driven', 'value', 'underdog'],
};

export function pickCommunityTemplate(opts: PickOptions): CommunityTemplate | null {
  const templates = listTemplates();
  if (templates.length === 0) return null;

  const useRate = opts.useRate ?? 0.4;
  if (!opts.force && Math.random() > useRate) return null;

  const hints = POST_TYPE_TAG_HINTS[opts.postTypeId] || [];

  // 重み計算
  function weightOf(t: CommunityTemplate): number {
    let w = 1;
    // タグ一致でブースト
    const matches = t.tags.filter(tag => hints.includes(tag)).length;
    w += matches * 2;
    // お気に入りブースト
    if (t.favorited) w *= 3;
    // 使用回数が多いほど減衰（新鮮度）
    w *= 1 / (1 + Math.log1p(t.useCount));
    return w;
  }

  const weights = templates.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return templates[Math.floor(Math.random() * templates.length)];

  let r = Math.random() * total;
  for (let i = 0; i < templates.length; i++) {
    r -= weights[i];
    if (r <= 0) return templates[i];
  }
  return templates[templates.length - 1];
}
