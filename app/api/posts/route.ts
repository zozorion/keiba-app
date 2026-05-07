/**
 * 投稿生成・管理API
 * GET  /api/posts              — 投稿種別一覧 + データ状況
 * POST /api/posts              — 投稿文を生成（X系はGemini動的生成、note系は既存テンプレ）
 * PUT  /api/posts              — 投稿種別の prompt/requiredFacts または noteテンプレを保存
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { postTweet, isTwitterConfigured } from '../../../lib/twitter';
import { loadPostConfig, applyRules } from '../post-config/route';
import { POST_TYPES, PostType } from '../../../lib/post-types';
import { generatePost } from '../../../lib/post-generator';
import { isGeminiConfigured } from '../../../lib/gemini';

const TEMPLATES_DIR = path.join(process.cwd(), 'data', 'templates');
const POSTS_LOG = path.join(process.cwd(), 'data', 'posts-log.json');

if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

/* -------------------------------------------------------------------------- */
/*                  note系（長文・構造的）は引き続きテンプレ運用              */
/* -------------------------------------------------------------------------- */
const NOTE_TEMPLATES: Record<string, { id: string; label: string; category: 'note'; template: string }> = {
  'note-analysis': {
    id: 'note-analysis', label: '📝 全頭診断', category: 'note',
    template: `# 🏇 {raceName}（{grade}）全頭診断 & 買うべき馬ランキング

> **{venue} {surface}{distance}m（{condition}）**
> データ: 過去実績を独自分析
> 📺 バカウマちゃんねる

## チェックカード
{check_card}

## 🏆 買うべき馬ランキング TOP5
{top5_detail}

## 全頭短評
{all_horses_table}

## 🎯 馬券作戦
{recommendations}`,
  },
  'note-weekly': {
    id: 'note-weekly', label: '📝 週間レポート', category: 'note',
    template: `# 📊 週間レポート {date_range}

## 成績サマリー
- 分析レース数: {total_races}R
- 軸馬3着内率: {pivot_rate}%
- ワイドROI: {wide_roi}%

## 競馬場別成績
{venue_table}

## 今週の学習成果
{learning_insights}`,
  },
  'note-course': {
    id: 'note-course', label: '📝 コース攻略ガイド', category: 'note',
    template: `# 📚 {venue}{surface}{distance}m 完全攻略ガイド

## コース概要
{course_overview}

## チェックカード
{check_card}

## 有力種牡馬ランキング
{sire_ranking}

## 枠順データ
{frame_data}

## 脚質傾向
{style_data}

---
📺 バカウマちゃんねる`,
  },
};

/* -------------------------------------------------------------------------- */
/*                            投稿種別の取得（カスタム優先）                  */
/* -------------------------------------------------------------------------- */
function getXPostType(id: string): PostType | null {
  // カスタム保存があればそれを使う
  const customPath = path.join(TEMPLATES_DIR, `${id}.json`);
  if (fs.existsSync(customPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(customPath, 'utf-8'));
      // 旧形式（template フィールドあり）の場合も最低限読み出せるように
      const base = POST_TYPES[id];
      if (!base) return null;
      return {
        ...base,
        prompt: c.prompt || base.prompt,
        requiredFacts: c.requiredFacts || base.requiredFacts,
        lengthHint: c.lengthHint || base.lengthHint,
        hashtagHint: c.hashtagHint || base.hashtagHint,
      };
    } catch {
      /* 破損していたら無視してデフォルト */
    }
  }
  return POST_TYPES[id] || null;
}

function getNoteTemplate(id: string): { id: string; label: string; category: 'note'; template: string } | null {
  const customPath = path.join(TEMPLATES_DIR, `${id}.json`);
  if (fs.existsSync(customPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(customPath, 'utf-8'));
      const base = NOTE_TEMPLATES[id];
      if (!base) return null;
      return { ...base, template: c.template || base.template };
    } catch {
      /* */
    }
  }
  return NOTE_TEMPLATES[id] || null;
}

/* -------------------------------------------------------------------------- */
/*       予測データから事実データ（facts）を抽出（旧 buildVariables 相当）    */
/* -------------------------------------------------------------------------- */
function buildFacts(date: string, predictions: any[], results: any[] | null, raceIndex?: number): Record<string, string> {
  const vars: Record<string, string> = {};
  const d = new Date(date + 'T00:00:00');
  const weekday = ['日','月','火','水','木','金','土'][d.getDay()];
  vars.date = date;
  vars.date_label = `${d.getMonth()+1}/${d.getDate()}(${weekday})`;

  // 会場
  const venueSet = new Set(predictions.map((p: any) => p.venue));
  vars.venues = [...venueSet].join('・');
  vars.venue_count = String(venueSet.size);

  // 注目レース TOP3
  const sorted = [...predictions].sort((a: any, b: any) => (b.pivotHorse?.score || 0) - (a.pivotHorse?.score || 0));
  vars.top3_races = sorted.slice(0, 3).map((p: any) =>
    `${p.venue}${p.raceNumber}R ${p.raceName} ◎${p.pivotHorse?.name}`
  ).join('\n');

  // BEST BET
  const best = sorted[0];
  if (best) {
    vars.best_race = String(best.raceNumber);
    vars.best_raceName = best.raceName;
    vars.best_num = String(best.pivotHorse?.num);
    vars.best_name = best.pivotHorse?.name || '';
    vars.best_score = String(best.pivotHorse?.score);
  }

  // 高信頼レース数
  vars.high_conf_count = String(predictions.filter((p: any) => p.shouldBet !== false).length);

  // 個別レース用（raceIndex未指定ならBEST BETを自動選択）
  const effectiveIndex = raceIndex ?? (sorted.length > 0 ? predictions.indexOf(sorted[0]) : undefined);
  if (effectiveIndex !== undefined && effectiveIndex >= 0 && predictions[effectiveIndex]) {
    const race = predictions[effectiveIndex];
    vars.venue = race.venue;
    vars.raceNumber = String(race.raceNumber);
    vars.raceName = race.raceName;
    vars.surface = race.surface;
    vars.distance = String(race.distance);
    vars.condition = race.condition || '良';
    vars.grade = race.grade || '';
    vars.pivot_num = String(race.pivotHorse?.num);
    vars.pivot_name = race.pivotHorse?.name || '';
    vars.pivot_score = String(race.pivotHorse?.score);
    vars.pivot_sire = race.pivotHorse?.sire || '不明';
    vars.pivot_reasons = (race.pivotHorse?.reasons || [])
      .filter((r: any) => r.points > 0).slice(0, 3)
      .map((r: any) => r.label).join(' / ');

    // ワイド
    const wideRec = race.recommendations?.find((r: any) => r.type === 'wide');
    if (wideRec) {
      const targets = wideRec.combination.filter((n: number) => n !== race.pivotHorse?.num);
      vars.wide_targets = targets.join(',');
      vars.wide_count = String(targets.length);
    }

    // 2-3位
    const allSorted = [...(race.allHorses || [])].sort((a: any, b: any) => b.score - a.score);
    if (allSorted[1]) { vars.second_num = String(allSorted[1].num); vars.second_name = allSorted[1].name; vars.second_score = String(allSorted[1].score); }
    if (allSorted[2]) { vars.third_num = String(allSorted[2].num); vars.third_name = allSorted[2].name; vars.third_score = String(allSorted[2].score); }

    // 穴馬
    const valueHorse = allSorted.find((h: any) => h.odds >= 10 && h.score >= 55);
    if (valueHorse) {
      vars.horse_num = String(valueHorse.num);
      vars.horse_name = valueHorse.name;
      vars.horse_score = String(valueHorse.score);
      vars.horse_odds = String(valueHorse.odds);
      vars.horse_sire = valueHorse.sire || '不明';
      vars.horse_reason = (valueHorse.reasons || []).filter((r: any) => r.points > 0).slice(0, 1).map((r: any) => r.label).join('');
    }

    // コース情報（チェックカード）
    if (race.checkCard) {
      vars.course_tips = race.checkCard.tips?.join(' / ') || '';
      vars.frame_summary = race.checkCard.frameSummary || '';
      vars.style_summary = race.checkCard.styleSummary || '';
      vars.top_sires = race.checkCard.sireSummary || '';
    }

    // 全頭テーブル（note用）
    vars.all_horses_table = allSorted.map((h: any) =>
      `| ${h.num} | ${h.name} | ${h.sire || '?'} | ${h.score}pt | ${h.jockey} |`
    ).join('\n');
    vars.top5_detail = allSorted.slice(0, 5).map((h: any, i: number) => {
      const medal = ['🥇','🥈','🥉','4️⃣','5️⃣'][i];
      const reasons = (h.reasons || []).filter((r: any) => r.points > 0).map((r: any) => `- ${r.label} (+${r.points}pt)`).join('\n');
      return `### ${medal} ${h.num}番 ${h.name}（${h.score}pt）\n${reasons}`;
    }).join('\n\n');
    vars.check_card = race.checkCard ? JSON.stringify(race.checkCard, null, 2) : '';
    vars.recommendations = (race.recommendations || []).map((r: any) => `- **${r.label}**: ${r.reason}`).join('\n');
  }

  // 結果用
  if (results && results.length > 0) {
    const totalR = results.length;
    const pivotHits = results.filter((r: any) => r.pivot?.inTop3).length;
    vars.total = String(totalR);
    vars.pivot_hits = String(pivotHits);
    vars.pivot_rate = String(Math.round(pivotHits / totalR * 100));

    const wideReturn = results.reduce((s: number, r: any) => s + (r.bets?.wide?.return || 0), 0);
    const wideCost = totalR * 500;
    vars.wide_roi = String(Math.round(wideReturn / wideCost * 100));

    const venueMap = new Map<string, { hits: number; total: number }>();
    results.forEach((r: any) => {
      if (!venueMap.has(r.venue)) venueMap.set(r.venue, { hits: 0, total: 0 });
      const v = venueMap.get(r.venue)!;
      v.total++;
      if (r.pivot?.inTop3) v.hits++;
    });
    vars.venue_breakdown = [...venueMap.entries()].map(([v, s]) =>
      `${v}: ${s.hits}/${s.total}的中`
    ).join(' / ');

    if (effectiveIndex !== undefined && results[effectiveIndex]) {
      const rr = results[effectiveIndex];
      vars.finish = String(rr.pivot?.finish || '?');
      vars.hit_emoji = rr.pivot?.inTop3 ? '🎯' : '😢';
      const wideHit = rr.bets?.wide?.hit;
      vars.hit_detail = wideHit ? `ワイド的中、${rr.bets.wide.return}円回収` : 'ワイド不的中';
    }

    // 馬場傾向
    const innerWins = results.filter((r: any) => r.pivot?.finish <= 3 && r.pivot?.num <= 6).length;
    const outerWins = results.filter((r: any) => r.pivot?.finish <= 3 && r.pivot?.num > 6).length;
    vars.bias_summary = `内枠好走 ${innerWins}回 / 外枠好走 ${outerWins}回。` +
      (innerWins > outerWins ? '内枠やや有利の傾向。' : innerWins < outerWins ? '外枠でも勝負できる馬場。' : '内外フラット。');

    // 週間レポート用（同名キーが個別レース系と被らないよう、無いときだけ）
    if (!vars.total_races) vars.total_races = String(totalR);
  }

  return vars;
}

/** note 用：テンプレに変数を注入 */
function renderNoteTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  result = result.replace(/\{[a-z_]+\}/g, '');
  return result.trim();
}

/* -------------------------------------------------------------------------- */
/*                     公開関数：投稿テキストを生成（async）                  */
/* -------------------------------------------------------------------------- */
export async function generatePostText(
  templateId: string,
  date: string,
  raceIndex?: number,
  scheduledAt?: string,
): Promise<string> {
  const isXType = !!POST_TYPES[templateId];
  const isNoteType = !!NOTE_TEMPLATES[templateId];
  if (!isXType && !isNoteType) return '';

  const predPath = path.join(process.cwd(), 'data', 'weekly', date, 'predictions.json');
  let predictions: any[] = [];
  if (fs.existsSync(predPath)) {
    predictions = JSON.parse(fs.readFileSync(predPath, 'utf-8')).predictions || [];
  }

  const resPath = path.join(process.cwd(), 'data', 'weekly', date, 'results.json');
  let results: any[] | null = null;
  if (fs.existsSync(resPath)) {
    const resData = JSON.parse(fs.readFileSync(resPath, 'utf-8'));
    results = predictions.map((p: any) => {
      const rr = (resData.results || []).find((r: any) => r.raceId === p.raceId);
      if (!rr) return null;
      const pivotResult = rr.results?.find((h: any) => h.num === p.pivotHorse?.num);
      return {
        ...p,
        pivot: { ...p.pivotHorse, finish: pivotResult?.finish || 99, inTop3: pivotResult && pivotResult.finish <= 3 },
        winner: rr.results?.[0],
        bets: { wide: { hit: false, return: 0 } },
      };
    }).filter(Boolean);
  }

  const config = loadPostConfig();
  const facts = buildFacts(date, predictions, results, raceIndex);

  if (isXType) {
    const postType = getXPostType(templateId)!;
    const out = await generatePost({ postType, facts, config, scheduledAt });
    if (out.text) return applyRules(out.text, config);
    // Geminiが使えない/失敗時：エラーメッセージを返す（ユーザーが気づけるように）
    return out.error ? `[生成失敗] ${out.error}` : '';
  }

  // note 系：従来どおりテンプレ + 変数置換
  const tmpl = getNoteTemplate(templateId)!;
  facts.persona_name = config.persona.name || '';
  facts.persona_signoff = config.persona.signoff || '';
  facts.persona_fav = config.persona.favHorse || '';
  const raw = renderNoteTemplate(tmpl.template, facts);
  return applyRules(raw, config);
}

/* -------------------------------------------------------------------------- */
/*                               HTTP ハンドラ                                */
/* -------------------------------------------------------------------------- */

export async function GET() {
  // X系（POST_TYPES）+ note系を返す
  const xTypes = Object.values(POST_TYPES).map(t => {
    const custom = getXPostType(t.id);
    return {
      id: t.id,
      label: t.label,
      category: t.category,
      prompt: custom?.prompt || t.prompt,
      requiredFacts: custom?.requiredFacts || t.requiredFacts,
      lengthHint: custom?.lengthHint || t.lengthHint,
      hashtagHint: custom?.hashtagHint || t.hashtagHint,
      isCustom: !!fs.existsSync(path.join(TEMPLATES_DIR, `${t.id}.json`)),
    };
  });
  const noteTypes = Object.values(NOTE_TEMPLATES).map(t => {
    const custom = getNoteTemplate(t.id);
    return {
      id: t.id,
      label: t.label,
      category: t.category,
      template: custom?.template || t.template,
      isCustom: !!fs.existsSync(path.join(TEMPLATES_DIR, `${t.id}.json`)),
    };
  });

  return NextResponse.json({
    postTypes: xTypes,
    noteTemplates: noteTypes,
    twitterConfigured: isTwitterConfigured(),
    geminiConfigured: isGeminiConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { templateId, date, raceIndex, autoPost, scheduledAt } = body;

  if (!templateId || !date) {
    return NextResponse.json({ error: 'templateId と date が必要です' }, { status: 400 });
  }

  const text = await generatePostText(templateId, date, raceIndex, scheduledAt);
  if (!text) return NextResponse.json({ error: '不明な templateId、または生成失敗' }, { status: 404 });

  let postResult = null;
  if (autoPost && isTwitterConfigured()) {
    postResult = await postTweet(text);
    const log = fs.existsSync(POSTS_LOG) ? JSON.parse(fs.readFileSync(POSTS_LOG, 'utf-8')) : [];
    log.push({
      date,
      templateId,
      text, // フル本文を保存（重複回避コンテキスト用）
      status: postResult.success ? 'posted' : 'failed',
      postedAt: new Date().toISOString(),
      ...postResult,
    });
    fs.writeFileSync(POSTS_LOG, JSON.stringify(log.slice(-200), null, 2));
  }

  return NextResponse.json({ text, charCount: text.length, postResult });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { templateId } = body;

  if (!templateId) return NextResponse.json({ error: 'templateId が必要です' }, { status: 400 });

  const isXType = !!POST_TYPES[templateId];
  const isNoteType = !!NOTE_TEMPLATES[templateId];
  if (!isXType && !isNoteType) return NextResponse.json({ error: '不明な templateId' }, { status: 404 });

  const savePath = path.join(TEMPLATES_DIR, `${templateId}.json`);

  if (isXType) {
    const { prompt, requiredFacts, lengthHint, hashtagHint } = body;
    const base = POST_TYPES[templateId];
    fs.writeFileSync(savePath, JSON.stringify({
      id: templateId,
      label: base.label,
      category: base.category,
      prompt: prompt ?? base.prompt,
      requiredFacts: requiredFacts ?? base.requiredFacts,
      lengthHint: lengthHint ?? base.lengthHint,
      hashtagHint: hashtagHint ?? base.hashtagHint,
    }, null, 2));
  } else {
    const { template } = body;
    if (!template) return NextResponse.json({ error: 'template が必要です' }, { status: 400 });
    const base = NOTE_TEMPLATES[templateId];
    fs.writeFileSync(savePath, JSON.stringify({ ...base, template }, null, 2));
  }

  return NextResponse.json({ success: true });
}
