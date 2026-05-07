/**
 * 投稿生成のための「状況コンテキスト」を構築する。
 *
 * LLMに「いま何曜日の何時か」「今シーズン何が走ってるか」「直近の成績」「過去の自分の投稿」
 * を渡すことで、毎回違う切り口で書かせる材料にする。
 */

import fs from 'fs';
import path from 'path';

const POSTS_LOG = path.join(process.cwd(), 'data', 'posts-log.json');
const WEEKLY_DIR = path.join(process.cwd(), 'data', 'weekly');

export interface PostContext {
  /** "2026-05-02 21:30 (金)" のような可読文字列 */
  timeLabel: string;
  /** "金曜夜" など、曜日×時間帯のざっくりラベル */
  timeSlot: string;
  /** 季節感のキーワード（GW、梅雨、年末、春G1ウィークなど） */
  seasonNote: string;
  /** 直近2週間の自分の成績サマリー（無ければ空文字） */
  recentPerformance: string;
  /** 直近の自分の投稿 N件のテキスト（重複回避のため） */
  recentPosts: string[];
}

/**
 * 投稿予定時刻を基準にコンテキストを組み立てる。
 * scheduledAt が無ければ「今」を使う。
 */
export function buildPostContext(opts: {
  /** ISO datetime もしくは undefined（= 現在） */
  scheduledAt?: string;
  /** 重複回避に使う直近投稿の件数 */
  recentPostsLimit?: number;
}): PostContext {
  const now = opts.scheduledAt ? new Date(opts.scheduledAt) : new Date();
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  const hh = now.getHours();
  const mm = now.getMinutes();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const timeLabel = `${dateStr} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (${weekday})`;
  const timeSlot = describeTimeSlot(now.getDay(), hh);
  const seasonNote = describeSeason(now);

  const recentPerformance = collectRecentPerformance(now);
  const recentPosts = collectRecentPosts(opts.recentPostsLimit ?? 10);

  return { timeLabel, timeSlot, seasonNote, recentPerformance, recentPosts };
}

/** 曜日 × 時間帯から人間にとって自然なラベル（金曜夜、土曜の朝、日曜の昼、など） */
function describeTimeSlot(dayOfWeek: number, hour: number): string {
  const dayName = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'][dayOfWeek];
  let band: string;
  if (hour < 5) band = '深夜';
  else if (hour < 9) band = '朝';
  else if (hour < 12) band = '午前';
  else if (hour < 14) band = '昼';
  else if (hour < 18) band = '午後';
  else if (hour < 22) band = '夜';
  else band = '深夜';
  return `${dayName}の${band}`;
}

/** 月・日付からざっくりした季節感を返す */
function describeSeason(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const notes: string[] = [];

  // 月別の競馬シーズン感
  if (m === 1) notes.push('正月競馬・金杯シーズン');
  else if (m === 2) notes.push('東京/小倉/京都の冬開催、春のクラシックに向けた前哨戦');
  else if (m === 3) notes.push('中山記念・高松宮記念など春G1の幕開け');
  else if (m === 4) {
    notes.push('桜花賞・皐月賞・天皇賞春の春G1ど真ん中');
    if (day >= 28) notes.push('GW突入');
  } else if (m === 5) {
    if (day <= 6) notes.push('GW真っ只中');
    notes.push('NHKマイル・オークス・ダービーの春クラシック後半戦');
  } else if (m === 6) notes.push('安田記念・宝塚記念、春シーズンのクライマックス、梅雨入り');
  else if (m === 7) notes.push('夏競馬（福島・小倉・函館）の入り口');
  else if (m === 8) notes.push('真夏のローカル開催（札幌・新潟・小倉）、サマーシリーズ');
  else if (m === 9) notes.push('スプリンターズSなど秋への転換期、中山金杯予選');
  else if (m === 10) notes.push('秋華賞・菊花賞・天皇賞秋など秋G1の本格開幕');
  else if (m === 11) notes.push('エリザベス女王杯・マイルCS・ジャパンC、秋G1シーズン真っ只中');
  else if (m === 12) {
    notes.push('阪神JF・朝日杯・有馬記念、年末G1ラッシュ');
    if (day >= 24) notes.push('年末年始');
  }

  return notes.join(' / ');
}

/**
 * 直近の自分の投稿を取得（重複回避用）。
 * posts-log.json から status='posted' のものを優先、無ければ全部から最新N件。
 */
function collectRecentPosts(limit: number): string[] {
  if (!fs.existsSync(POSTS_LOG)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(POSTS_LOG, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    const posted = raw.filter((r: any) => r.status === 'posted' && r.text);
    const source = posted.length >= limit ? posted : raw.filter((r: any) => r.text);
    return source.slice(-limit).map((r: any) => String(r.text)).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 直近2週間の成績を集計（軸馬3着内率・ワイドROIを大ざっぱに）。
 * data/weekly/{YYYY-MM-DD}/results.json の有無をスキャンする。
 */
function collectRecentPerformance(now: Date): string {
  if (!fs.existsSync(WEEKLY_DIR)) return '';
  try {
    const dates = fs.readdirSync(WEEKLY_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - 14);
    const recent = dates.filter(d => new Date(d + 'T00:00:00') >= cutoff && new Date(d + 'T00:00:00') <= now).sort();
    if (recent.length === 0) return '';

    let totalRaces = 0;
    let pivotHits = 0;

    for (const d of recent) {
      const resPath = path.join(WEEKLY_DIR, d, 'results.json');
      const predPath = path.join(WEEKLY_DIR, d, 'predictions.json');
      if (!fs.existsSync(resPath) || !fs.existsSync(predPath)) continue;
      const resData = JSON.parse(fs.readFileSync(resPath, 'utf-8'));
      const predData = JSON.parse(fs.readFileSync(predPath, 'utf-8'));
      const preds = predData.predictions || [];
      const results = resData.results || [];

      for (const p of preds) {
        const rr = results.find((r: any) => r.raceId === p.raceId);
        if (!rr) continue;
        totalRaces++;
        const pivotResult = rr.results?.find((h: any) => h.num === p.pivotHorse?.num);
        if (pivotResult && pivotResult.finish <= 3) pivotHits++;
      }
    }

    if (totalRaces === 0) return '';
    const rate = Math.round((pivotHits / totalRaces) * 100);
    const summary = `直近2週間：${totalRaces}レース分析、軸馬3着内率 ${rate}%`;
    return summary + (rate >= 60 ? '（好調）' : rate <= 40 ? '（やや不調）' : '（平均的）');
  } catch {
    return '';
  }
}
