/**
 * 投稿生成・管理API
 * GET  /api/posts              — テンプレート一覧 + データ状況
 * POST /api/posts              — 投稿文を生成（+ X投稿オプション）
 * PUT  /api/posts              — テンプレート保存
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { postTweet, postThread, isTwitterConfigured } from '../../../lib/twitter';
import { loadPostConfig, applyRules } from '../post-config/route';

const TEMPLATES_DIR = path.join(process.cwd(), 'data', 'templates');
const POSTS_LOG = path.join(process.cwd(), 'data', 'posts-log.json');

// テンプレートディレクトリ作成
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

/** デフォルトテンプレート定義 */
const DEFAULT_TEMPLATES: Record<string, { label: string; category: string; template: string }> = {
  'x-preview': {
    label: '🐦① 前日予告', category: 'x',
    template: `仕事終わり。缶チューハイ片手にAI回してる🍺

明日{venues}。{venue_count}場あるけど全部スキャン済み。

🔥 期待値高いやつ
{top3_races}

平日はゴリゴリコード書いて、週末は自分で作ったAIで馬券買う生活、なかなか悪くない。

結局酒とギャンブルに消えてくんだけど。

#競馬予想 #JRA #データ競馬`,
  },
  'x-morning': {
    label: '🐦② 朝イチ注目', category: 'x',
    template: `おはよ。昨日飲みすぎたけど馬券の時間だけは起きれる🍻

{date_label} {venues}

今日のAIイチ推し👇

⭐ BEST BET
{best_race}R {best_raceName}
◎ {best_num}番 {best_name}

種牡馬、枠、騎手、全部噛み合ってる。こういうレースだけ狙う。

他にも{high_conf_count}レースで期待値出てる。今日は忙しい。

#今日の競馬 #競馬予想`,
  },
  'x-race': {
    label: '🐦③ 個別レース予想', category: 'x',
    template: `{venue}{raceNumber}R {raceName}
{surface}{distance}m

データ掘ったら面白いの出てきた。

◎ {pivot_num}番 {pivot_name}
{pivot_reasons}

数字は嘘つかない。

🎯 ワイド流し
{pivot_num}→{wide_targets}（{wide_count}点）

期待値プラスの時だけ勝負する。これだけ守ればトータルで勝てる。

#競馬予想 #{venue}競馬`,
  },
  'x-graded': {
    label: '🐦④ 重賞予想', category: 'x',
    template: `🏆 {raceName}（{grade}）

昨日の夜からずっとデータ回してた。3時間くらい。
酒飲みながらだけど。

{venue} {surface}{distance}m

◎ {pivot_num}番 {pivot_name}
└ {pivot_sire}産駒
{pivot_reasons}

○ {second_num}番 {second_name}
▲ {third_num}番 {third_name}

🎯 ワイド: {pivot_num}→{wide_targets}

人気と実力のズレ、見つけた時が一番アガる。

#競馬予想 #{raceName}`,
  },
  'x-result': {
    label: '🐦⑤ 的中速報', category: 'x',
    template: `{hit_emoji} {venue}{raceNumber}R {raceName}

◎ {pivot_name} → {finish}着
{hit_detail}

今夜はいい酒飲める🍺

会社の飲み会より、一人で競馬当てた後のハイボールの方が100倍うまい。

#競馬予想 #的中`,
  },
  'x-daily': {
    label: '🐦⑥ 日次まとめ', category: 'x',
    template: `今日の結果、全部出す。盛らない。

{date_label} {venues}

🎯 軸馬3着内: {pivot_hits}/{total}（{pivot_rate}%）
💰 ワイドROI: {wide_roi}%
{venue_breakdown}

良い日も悪い日も晒す。
勝った時だけ報告するアカウントとか信用できないでしょ。

今日のデータも全部AIにフィードバックした。来週また進化する。

風呂入ってビール飲んで寝る。おつかれ。

#競馬予想 #回収率`,
  },
  'x-weekly': {
    label: '🐦⑦ 週間レポート', category: 'x',
    template: `今週の成績。

🏇 {total_races}R分析
🎯 軸馬3着内率: {pivot_rate}%
💰 ワイドROI: {wide_roi}%

毎週AIに学習させてて、実際ちょっとずつ精度上がってきてる。
最初は完全に趣味で始めたけど、ここまで来ると意地でも回収率プラスにしたい。

月〜金はIT企業でコード書いて、
金曜の夜にAI回して、
土日は馬券。
月曜の朝、学習データ投入。

この生活ループ、たぶん一生続く。

#競馬予想 #AI予想`,
  },
  'x-value': {
    label: '🐦⑧ 穴馬ピック', category: 'x',
    template: `{venue}{raceNumber}R {raceName}

これ多分みんなスルーしてるけど。

{horse_num}番 {horse_name}
└ {horse_odds}倍
└ {horse_sire}産駒
└ {horse_reason}

{horse_odds}倍ってことは市場が「来ない」って判断してる。
でもAIは「走る」って言ってる。

この乖離が期待値。こういうのをコツコツ拾っていく。

#穴馬 #競馬予想`,
  },
  'x-course': {
    label: '🐦⑨ コース徹底解説', category: 'x',
    template: `{venue}{surface}{distance}m、データまとめたから置いとく。

{course_tips}

有力種牡馬: {top_sires}
枠順: {frame_summary}
脚質: {style_summary}

「なんとなく内枠有利っぽい」とか言ってる人、ちゃんとデータ見た方がいい。
感覚と実際の数字、結構ズレてるから。

使えそうなら使って。

#競馬データ #{venue}競馬`,
  },
  'x-bias': {
    label: '🐦⑩ 馬場傾向速報', category: 'x',
    template: `{date_label} {venue}の馬場、まとめとく。

{bias_summary}

前日の馬場データ、意外とみんな見てない。
でもこれ見るか見ないかで馬券の精度マジで変わる。

明日の{venue}、この傾向頭に入れといて損はない。

#馬場傾向 #{venue}競馬`,
  },
  'x-lifestyle-1': {
    label: '🐦⑪ 日常（仕事帰り）', category: 'x',
    template: `残業終わり。22時。

帰りにストロング買って、電車でAIの学習データ眺めてる。
周りはスマホでSNS見てるけど、私は種牡馬の成績データ見てる。

なにやってんだろって思うけど、
先週これで3万浮いてるからやめられない。

結局ただの酒飲みギャンブル好きが、たまたまコード書けたってだけ。

#日常 #競馬好きと繋がりたい`,
  },
  'x-lifestyle-2': {
    label: '🐦⑫ 日常（週末の朝）', category: 'x',
    template: `土曜の朝。

平日は7時に起きるの無理なのに、
競馬の日だけ6時半に目が覚める。不思議。

コーヒー淹れて、AIの出力チェックして、
気になるレースにマーカー引いて。

この時間が一番好きかもしれない。
誰にも邪魔されない、データと向き合う時間。

今日も期待値で殴る。

#競馬のある生活`,
  },
  'x-lifestyle-3': {
    label: '🐦⑬ 日常（飲み）', category: 'x',
    template: `金曜の夜。

会社の飲み会断って一人で赤提灯に来てる。
ホッピーとモツ煮で、明日の出走表とにらめっこ。

同期は合コン行ってるらしい。
私はAIに教師データ食わせてる。

どっちが将来的にリターン高いかって話よ。

明日の{venues}、なかなかいいの見つけた。
詳しくは明日の朝。

#金曜の夜 #競馬予想`,
  },
  'note-analysis': {
    label: '📝 全頭診断', category: 'note',
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
    label: '📝 週間レポート', category: 'note',
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
    label: '📝 コース攻略ガイド', category: 'note',
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

/** テンプレート取得（カスタム優先） */
function getTemplate(id: string): { label: string; category: string; template: string } | null {
  const customPath = path.join(TEMPLATES_DIR, `${id}.json`);
  if (fs.existsSync(customPath)) {
    return JSON.parse(fs.readFileSync(customPath, 'utf-8'));
  }
  return DEFAULT_TEMPLATES[id] || null;
}

/** 予測データから変数を生成 */
function buildVariables(date: string, predictions: any[], results: any[] | null, raceIndex?: number): Record<string, string> {
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
      .map((r: any) => `└ ${r.label} (+${r.points}pt)`).join('\n');

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

    // 穴馬（オッズ10倍以上でスコア高い馬）
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
      vars.course_tips = race.checkCard.tips?.join('\n') || '';
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

  // 結果用変数
  if (results && results.length > 0) {
    const totalR = results.length;
    const pivotHits = results.filter((r: any) => r.pivot?.inTop3).length;
    vars.total = String(totalR);
    vars.pivot_hits = String(pivotHits);
    vars.pivot_rate = String(Math.round(pivotHits / totalR * 100));

    // ワイドROI計算
    const wideReturn = results.reduce((s: number, r: any) => s + (r.bets?.wide?.return || 0), 0);
    const wideCost = totalR * 500;
    vars.wide_roi = String(Math.round(wideReturn / wideCost * 100));

    // 会場別
    const venueMap = new Map<string, { hits: number; total: number }>();
    results.forEach((r: any) => {
      if (!venueMap.has(r.venue)) venueMap.set(r.venue, { hits: 0, total: 0 });
      const v = venueMap.get(r.venue)!;
      v.total++;
      if (r.pivot?.inTop3) v.hits++;
    });
    vars.venue_breakdown = [...venueMap.entries()].map(([v, s]) =>
      `${v}: ${s.hits}/${s.total}的中`
    ).join('\n');

    // 個別結果
    if (effectiveIndex !== undefined && results[effectiveIndex]) {
      const rr = results[effectiveIndex];
      vars.finish = String(rr.pivot?.finish || '?');
      vars.hit_emoji = rr.pivot?.inTop3 ? '🎯' : '😢';
      const wideHit = rr.bets?.wide?.hit;
      vars.hit_detail = wideHit ? `💰 ワイド的中！ ${rr.bets.wide.return}円回収` : 'ワイド不的中';
    }
  }

  // 馬場傾向（土曜→日曜用）
  if (results && results.length > 0) {
    const innerWins = results.filter((r: any) => r.pivot?.finish <= 3 && r.pivot?.num <= 6).length;
    const outerWins = results.filter((r: any) => r.pivot?.finish <= 3 && r.pivot?.num > 6).length;
    vars.bias_summary = `内枠好走: ${innerWins}回 / 外枠好走: ${outerWins}回\n` +
      (innerWins > outerWins ? '→ 内枠有利の傾向あり🔥' : '→ 外枠でも十分勝負できる展開');
  }

  return vars;
}

/** テンプレートに変数を注入 */
function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  // 未置換の変数をクリーンアップ
  result = result.replace(/\{[a-z_]+\}/g, '');
  return result.trim();
}

/** 投稿テキストを生成（外部から呼べるexport版） */
export function generatePostText(templateId: string, date: string, raceIndex?: number): string {
  const tmpl = getTemplate(templateId);
  if (!tmpl) return '';

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

  const postConfig = loadPostConfig();
  const vars = buildVariables(date, predictions, results, raceIndex);
  vars.persona_name = postConfig.persona.name || '';
  vars.persona_signoff = postConfig.persona.signoff || '';
  vars.persona_fav = postConfig.persona.favHorse || '';
  const rawText = renderTemplate(tmpl.template, vars);
  return applyRules(rawText, postConfig);
}


export async function GET() {
  // テンプレート一覧
  const templates = Object.entries(DEFAULT_TEMPLATES).map(([id, t]) => {
    const custom = getTemplate(id);
    return { id, ...t, template: custom?.template || t.template, isCustom: custom !== null && custom !== DEFAULT_TEMPLATES[id] };
  });

  return NextResponse.json({
    templates,
    twitterConfigured: isTwitterConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { templateId, date, raceIndex, autoPost } = body;

  if (!templateId || !date) {
    return NextResponse.json({ error: 'templateId と date が必要です' }, { status: 400 });
  }

  const tmpl = getTemplate(templateId);
  if (!tmpl) return NextResponse.json({ error: 'テンプレートが見つかりません' }, { status: 404 });

  // 予測データ読み込み
  const predPath = path.join(process.cwd(), 'data', 'weekly', date, 'predictions.json');
  let predictions: any[] = [];
  if (fs.existsSync(predPath)) {
    predictions = JSON.parse(fs.readFileSync(predPath, 'utf-8')).predictions || [];
  }

  // 結果データ
  const resPath = path.join(process.cwd(), 'data', 'weekly', date, 'results.json');
  let results: any[] | null = null;
  if (fs.existsSync(resPath)) {
    const resData = JSON.parse(fs.readFileSync(resPath, 'utf-8'));
    // 結果とpredictionsをマッチング
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

  const postConfig = loadPostConfig();
  // ペルソナ変数を追加
  const vars = buildVariables(date, predictions, results, raceIndex);
  vars.persona_name = postConfig.persona.name || '';
  vars.persona_signoff = postConfig.persona.signoff || '';
  vars.persona_fav = postConfig.persona.favHorse || '';
  const rawText = renderTemplate(tmpl.template, vars);
  const text = applyRules(rawText, postConfig);

  let postResult = null;
  if (autoPost && isTwitterConfigured()) {
    postResult = await postTweet(text);
    // ログ保存
    const log = fs.existsSync(POSTS_LOG) ? JSON.parse(fs.readFileSync(POSTS_LOG, 'utf-8')) : [];
    log.push({ date, templateId, text: text.substring(0, 100), postedAt: new Date().toISOString(), ...postResult });
    fs.writeFileSync(POSTS_LOG, JSON.stringify(log.slice(-100), null, 2));
  }

  return NextResponse.json({ text, charCount: text.length, postResult, vars });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { templateId, template } = body;

  if (!templateId || !template) {
    return NextResponse.json({ error: 'templateId と template が必要です' }, { status: 400 });
  }

  const def = DEFAULT_TEMPLATES[templateId];
  if (!def) return NextResponse.json({ error: '不明なテンプレートID' }, { status: 404 });

  const savePath = path.join(TEMPLATES_DIR, `${templateId}.json`);
  fs.writeFileSync(savePath, JSON.stringify({ ...def, template }, null, 2));

  return NextResponse.json({ success: true });
}
