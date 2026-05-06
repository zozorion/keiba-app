/**
 * 週次学習エンジン
 * 
 * 毎週の結果データを分析し、競馬場ごとのスコアリング重みを自動調整する。
 * 原則: 回収率（ROI）最大化が唯一の目的。
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const TUNING_DIR = path.join(DATA_DIR, 'tuning');
const FEEDBACK_DIR = path.join(DATA_DIR, 'feedback');

// 競馬場英名→日本語マッピング
const VENUE_EN_TO_JA: Record<string, string> = {
  'sapporo': '札幌', 'hakodate': '函館', 'fukushima': '福島',
  'niigata': '新潟', 'tokyo': '東京', 'nakayama': '中山',
  'chukyo': '中京', 'kyoto': '京都', 'hanshin': '阪神', 'kokura': '小倉',
};
const VENUE_JA_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(VENUE_EN_TO_JA).map(([k, v]) => [v, k])
);

/** 競馬場別チューニングデータ */
export interface VenueTuning {
  venue: string;          // 競馬場英名
  venueJa: string;        // 日本語名
  version: number;
  lastLearnDate: string;
  weeksLearned: number;
  totalRaces: number;
  weights: {
    sireMaxPoints: number;
    sireReliabilityThresholds: number[];  // [minSample, tier1, tier2, tier3]
    jockeyMultiplier: number;
    trainerMultiplier: number;
    frameMaxPoints: number;
    widePartnerCount: number;
  };
  performance: {
    pivotTop3Rate: number;
    wideHitRate: number;
    wideROI: number;
    tanshoROI: number;
  };
}

/** 週次学習レコード */
export interface WeeklyLearnRecord {
  date: string;
  venue: string;
  venueJa: string;
  racesCount: number;
  pivotTop3: number;
  pivotTop3Rate: number;
  wideHits: number;
  wideROI: number;
  tanshoROI: number;
  factorAnalysis: {
    sire: FactorStat;
    frame: FactorStat;
    jockey: FactorStat;
    trainer: FactorStat;
    distance: FactorStat;
    course: FactorStat;
  };
  insights: string[];         // その週の学び
  adjustments: string[];      // 加えた調整
}

interface FactorStat {
  avgHitScore: number;    // 的中時の平均スコア
  avgMissScore: number;   // 不的中時の平均スコア
  hitContribution: number; // ROIへの寄与度 (0-1)
  sampleSize: number;
}

/** 学習履歴全体 */
export interface FeedbackHistory {
  weeks: WeeklyLearnRecord[];
  lastUpdated: string;
}

/**
 * 1週分の学習を実行
 */
export function learnFromWeek(date: string): WeeklyLearnRecord[] {
  const weeklyDir = path.join(DATA_DIR, 'weekly', date);
  const predictionsPath = path.join(weeklyDir, 'predictions.json');
  const resultsPath = path.join(weeklyDir, 'results.json');

  if (!fs.existsSync(predictionsPath) || !fs.existsSync(resultsPath)) {
    throw new Error(`${date}のデータが見つかりません`);
  }

  const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf-8'));
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

  const resultMap = new Map<string, any>();
  for (const r of results.results) {
    resultMap.set(r.raceId, r);
  }

  // 競馬場ごとにグループ化
  const venueGroups = new Map<string, any[]>();
  for (const pred of predictions.predictions) {
    const venue = pred.venue;
    if (!venueGroups.has(venue)) venueGroups.set(venue, []);
    venueGroups.get(venue)!.push(pred);
  }

  const records: WeeklyLearnRecord[] = [];

  for (const [venueJa, preds] of venueGroups) {
    const venueEn = VENUE_JA_TO_EN[venueJa] || venueJa.toLowerCase();
    
    // 各要素の的中/不的中スコアを集計
    const factorHits: Record<string, number[]> = { sire: [], frame: [], jockey: [], trainer: [], distance: [], course: [] };
    const factorMisses: Record<string, number[]> = { sire: [], frame: [], jockey: [], trainer: [], distance: [], course: [] };
    
    let pivotTop3 = 0;
    let wideHits = 0;
    let wideBet = 0;
    let wideReturn = 0;
    let tanshoBet = 0;
    let tanshoReturn = 0;

    for (const pred of preds) {
      const result = resultMap.get(pred.raceId);
      if (!result || result.results.length === 0) continue;

      const pivotNum = pred.pivotHorse.num;
      const pivotRes = result.results.find((r: any) => r.num === pivotNum);
      if (!pivotRes) continue;

      const pivotFinish = pivotRes.finish;
      const isHit = pivotFinish >= 1 && pivotFinish <= 3;

      if (isHit) pivotTop3++;

      // 各要素のスコアを分類
      const reasons = pred.pivotHorse.reasons || [];
      for (const reason of reasons) {
        const cat = reason.category;
        if (factorHits[cat] !== undefined) {
          if (isHit) {
            factorHits[cat].push(reason.points);
          } else {
            factorMisses[cat].push(reason.points);
          }
        }
      }

      // ワイド流しROI計算
      const sorted = (pred.allHorses || []).sort((a: any, b: any) => b.score - a.score);
      const partners = sorted.slice(1, 6).map((h: any) => h.num);
      const wideCost = partners.length * 100;
      wideBet += wideCost;
      tanshoBet += 100;

      if (isHit) {
        for (const pn of partners) {
          const pnRes = result.results.find((r: any) => r.num === pn);
          if (pnRes && pnRes.finish >= 1 && pnRes.finish <= 3) {
            wideHits++;
            const est = Math.round((pivotRes.odds + pnRes.odds) * 50);
            wideReturn += est < 150 ? 200 : est;
          }
        }
      }

      if (pivotFinish === 1) {
        tanshoReturn += Math.round(pivotRes.odds * 100);
      }
    }

    // 要素別統計を算出
    const buildFactorStat = (cat: string): FactorStat => {
      const hits = factorHits[cat] || [];
      const misses = factorMisses[cat] || [];
      const avgHit = hits.length > 0 ? hits.reduce((a, b) => a + b, 0) / hits.length : 0;
      const avgMiss = misses.length > 0 ? misses.reduce((a, b) => a + b, 0) / misses.length : 0;
      const total = hits.length + misses.length;
      return {
        avgHitScore: Math.round(avgHit * 10) / 10,
        avgMissScore: Math.round(avgMiss * 10) / 10,
        hitContribution: total > 0 ? Math.round((hits.length / total) * 100) / 100 : 0,
        sampleSize: total,
      };
    };

    // インサイトと調整を自動生成
    const insights: string[] = [];
    const adjustments: string[] = [];
    const wideROI = wideBet > 0 ? Math.round((wideReturn / wideBet) * 100) : 0;
    const tanshoROI = tanshoBet > 0 ? Math.round((tanshoReturn / tanshoBet) * 100) : 0;
    const pivotRate = preds.length > 0 ? Math.round((pivotTop3 / preds.length) * 100) : 0;

    if (wideROI >= 100) insights.push(`ワイドROI ${wideROI}% — 好成績🔥`);
    else if (wideROI >= 70) insights.push(`ワイドROI ${wideROI}% — まずまず`);
    else if (wideROI < 50) insights.push(`ワイドROI ${wideROI}% — 要改善`);

    const sireStat = buildFactorStat('sire');
    if (sireStat.avgHitScore > sireStat.avgMissScore * 1.3) {
      insights.push(`種牡馬スコアが的中に強く寄与（的中平均${sireStat.avgHitScore}pt vs 不的中${sireStat.avgMissScore}pt）`);
    } else if (sireStat.avgHitScore < sireStat.avgMissScore) {
      insights.push(`種牡馬スコアが高いほど外れやすい傾向 — 過信の可能性`);
      adjustments.push(`種牡馬スコア上限を引き下げ → 次週から適用`);
    }

    const jockeyStat = buildFactorStat('jockey');
    if (jockeyStat.hitContribution < 0.3 && jockeyStat.sampleSize >= 5) {
      insights.push(`騎手スコアのROI寄与が低い（${Math.round(jockeyStat.hitContribution * 100)}%）`);
    }

    records.push({
      date,
      venue: venueEn,
      venueJa,
      racesCount: preds.length,
      pivotTop3,
      pivotTop3Rate: pivotRate,
      wideHits,
      wideROI,
      tanshoROI,
      factorAnalysis: {
        sire: sireStat,
        frame: buildFactorStat('frame'),
        jockey: jockeyStat,
        trainer: buildFactorStat('trainer'),
        distance: buildFactorStat('distance'),
        course: buildFactorStat('course'),
      },
      insights,
      adjustments,
    });
  }

  return records;
}

/**
 * 学習結果を蓄積データに追記
 */
export function saveFeedback(records: WeeklyLearnRecord[]): void {
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  const historyPath = path.join(FEEDBACK_DIR, 'history.json');

  let history: FeedbackHistory;
  if (fs.existsSync(historyPath)) {
    history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
  } else {
    history = { weeks: [], lastUpdated: '' };
  }

  // 同じ日付のデータがあれば置き換え
  const existingDates = new Set(records.map(r => `${r.date}_${r.venue}`));
  history.weeks = history.weeks.filter(w => !existingDates.has(`${w.date}_${w.venue}`));
  history.weeks.push(...records);
  history.weeks.sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue));
  history.lastUpdated = new Date().toISOString();

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * 蓄積データから競馬場別チューニングを計算・保存
 */
export function updateVenueTuning(): VenueTuning[] {
  const historyPath = path.join(FEEDBACK_DIR, 'history.json');
  if (!fs.existsSync(historyPath)) return [];

  const history: FeedbackHistory = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
  fs.mkdirSync(TUNING_DIR, { recursive: true });

  // 競馬場ごとにグループ化
  const venueMap = new Map<string, WeeklyLearnRecord[]>();
  for (const w of history.weeks) {
    const key = w.venue;
    if (!venueMap.has(key)) venueMap.set(key, []);
    venueMap.get(key)!.push(w);
  }

  const tunings: VenueTuning[] = [];

  for (const [venueEn, weeks] of venueMap) {
    const venueJa = VENUE_EN_TO_JA[venueEn] || venueEn;
    const totalRaces = weeks.reduce((s, w) => s + w.racesCount, 0);
    const weeksCount = weeks.length;

    // デフォルト重み
    const weights = {
      sireMaxPoints: 20,
      sireReliabilityThresholds: [5, 10, 20, 30],
      jockeyMultiplier: 1.0,
      trainerMultiplier: 1.0,
      frameMaxPoints: 8,
      widePartnerCount: 5,
    };

    // 十分なデータがあれば調整
    if (totalRaces >= 12) {
      // 種牡馬: 的中時と不的中時のスコア差が小さい場合は上限を下げる
      const sireAvgHit = avg(weeks.map(w => w.factorAnalysis.sire.avgHitScore));
      const sireAvgMiss = avg(weeks.map(w => w.factorAnalysis.sire.avgMissScore));
      if (sireAvgHit < sireAvgMiss * 1.1) {
        weights.sireMaxPoints = Math.max(12, weights.sireMaxPoints - 4);
      } else if (sireAvgHit > sireAvgMiss * 1.5) {
        weights.sireMaxPoints = Math.min(25, weights.sireMaxPoints + 2);
      }

      // 騎手: ROI寄与が低ければ倍率を下げる
      const jockeyContrib = avg(weeks.map(w => w.factorAnalysis.jockey.hitContribution));
      if (jockeyContrib < 0.25) {
        weights.jockeyMultiplier = 0.5;
      } else if (jockeyContrib > 0.5) {
        weights.jockeyMultiplier = 1.5;
      }

      // 厩舎: 同上
      const trainerContrib = avg(weeks.map(w => w.factorAnalysis.trainer.hitContribution));
      if (trainerContrib < 0.25) {
        weights.trainerMultiplier = 0.5;
      } else if (trainerContrib > 0.5) {
        weights.trainerMultiplier = 1.5;
      }

      // 枠順: 的中寄与が高ければ重みを上げる
      const frameContrib = avg(weeks.map(w => w.factorAnalysis.frame.hitContribution));
      if (frameContrib > 0.5) {
        weights.frameMaxPoints = 10;
      } else if (frameContrib < 0.2) {
        weights.frameMaxPoints = 5;
      }

      // ワイド相手頭数: ROIが低ければ相手を増やす
      const avgWideROI = avg(weeks.map(w => w.wideROI));
      if (avgWideROI < 60) {
        weights.widePartnerCount = Math.min(7, weights.widePartnerCount + 1);
      } else if (avgWideROI > 120) {
        weights.widePartnerCount = Math.max(4, weights.widePartnerCount - 1);
      }
    }

    // パフォーマンス集計
    const performance = {
      pivotTop3Rate: Math.round(avg(weeks.map(w => w.pivotTop3Rate))),
      wideHitRate: Math.round(avg(weeks.map(w => w.racesCount > 0 ? (w.wideHits / w.racesCount) * 100 : 0))),
      wideROI: Math.round(avg(weeks.map(w => w.wideROI))),
      tanshoROI: Math.round(avg(weeks.map(w => w.tanshoROI))),
    };

    const tuning: VenueTuning = {
      venue: venueEn,
      venueJa,
      version: 3,
      lastLearnDate: weeks[weeks.length - 1].date,
      weeksLearned: weeksCount,
      totalRaces,
      weights,
      performance,
    };

    // 保存
    const tuningPath = path.join(TUNING_DIR, `${venueEn}.json`);
    fs.writeFileSync(tuningPath, JSON.stringify(tuning, null, 2), 'utf-8');
    tunings.push(tuning);
  }

  return tunings;
}

/**
 * 競馬場別チューニングを読み込み
 */
export function loadVenueTuning(venueEn: string): VenueTuning | null {
  const tuningPath = path.join(TUNING_DIR, `${venueEn}.json`);
  if (!fs.existsSync(tuningPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(tuningPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 全競馬場のチューニングを読み込み
 */
export function loadAllTunings(): VenueTuning[] {
  if (!fs.existsSync(TUNING_DIR)) return [];
  
  const files = fs.readdirSync(TUNING_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(TUNING_DIR, f), 'utf-8'));
    } catch {
      return null;
    }
  }).filter(Boolean) as VenueTuning[];
}

/**
 * 学習履歴を取得
 */
export function loadFeedbackHistory(): FeedbackHistory | null {
  const historyPath = path.join(FEEDBACK_DIR, 'history.json');
  if (!fs.existsSync(historyPath)) return null;
  return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
