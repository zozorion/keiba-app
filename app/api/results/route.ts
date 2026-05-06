/**
 * 結果検証API Route
 * GET /api/results?date=2026-05-02
 * 予想結果と実際のレース結果を照合して的中率・回収率を返す
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface ResultHorse {
  finish: number;
  num: number;
  name: string;
  odds: number;
  popularity: number;
}

interface RaceResult {
  raceId: string;
  results: ResultHorse[];
  payouts: Record<string, string>;
}

interface PredictionData {
  raceId: string;
  raceName: string;
  venue: string;
  raceNumber: number;
  surface: string;
  distance: number;
  grade?: string;
  pivotHorse: {
    num: number;
    name: string;
    score: number;
    expectationScore: number;
  };
  expectationLevel: number;
  recommendations: {
    type: string;
    label: string;
    combination: number[];
  }[];
  allHorses: {
    num: number;
    name: string;
    score: number;
  }[];
}

/**
 * 払い戻しデータから2頭の組合せ配当を検索
 * payouts構造: { "ワイド": [{ combination: "3 - 13", amount: 400 }, ...] }
 */
function findPayout(payouts: any, betType: string, num1: number, num2: number): number {
  const entries = payouts?.[betType];
  if (!Array.isArray(entries)) return 0;

  const sorted = [num1, num2].sort((a, b) => a - b);
  for (const entry of entries) {
    if (!entry.combination || !entry.amount) continue;
    // "3 - 13" → [3, 13]
    const nums = entry.combination.replace(/→/g, '-').split(/\s*-\s*/).map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n)).sort((a: number, b: number) => a - b);
    if (nums.length >= 2 && nums[0] === sorted[0] && nums[1] === sorted[1]) {
      return entry.amount;
    }
  }
  return 0;
}

/**
 * 三連複の配当を検索
 */
function findPayoutSanren(payouts: any, betType: string, top3: number[]): number {
  const entries = payouts?.[betType];
  if (!Array.isArray(entries)) return 0;

  const sorted = [...top3].sort((a, b) => a - b);
  for (const entry of entries) {
    if (!entry.combination || !entry.amount) continue;
    const nums = entry.combination.replace(/→/g, '-').split(/\s*-\s*/).map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n)).sort((a: number, b: number) => a - b);
    if (nums.length >= 3 && nums[0] === sorted[0] && nums[1] === sorted[1] && nums[2] === sorted[2]) {
      return entry.amount;
    }
  }
  return 0;
}

/**
 * 単勝の配当を検索
 */
function findPayoutSingle(payouts: any, betType: string): number {
  const entries = payouts?.[betType];
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  return entries[0]?.amount || 0;
}

function checkHit(
  prediction: PredictionData,
  result: RaceResult
): {
  pivotFinish: number;
  pivotInTop3: boolean;
  pivotOdds: number;
  pivotPopularity: number;
  wideHit: boolean;
  wideReturn: number;
  umarenHit: boolean;
  umarenReturn: number;
  sanrenpukuHit: boolean;
  sanrenpukuReturn: number;
  tanshoHit: boolean;
  tanshoReturn: number;
  top3Nums: number[];
  winnerNum: number;
  winnerName: string;
  winnerOdds: number;
} {
  const resultMap = new Map<number, ResultHorse>();
  for (const r of result.results) {
    resultMap.set(r.num, r);
  }

  const top3Nums = result.results
    .filter(r => r.finish >= 1 && r.finish <= 3)
    .sort((a, b) => a.finish - b.finish)
    .map(r => r.num);

  const winner = result.results.find(r => r.finish === 1);
  const pivotResult = resultMap.get(prediction.pivotHorse.num);
  const pivotFinish = pivotResult?.finish || 99;
  const pivotOdds = pivotResult?.odds || 0;

  // 人気順を算出（オッズ昇順で何番目か）
  const sortedByOdds = [...result.results].filter(r => r.odds > 0).sort((a, b) => a.odds - b.odds);
  const pivotPopularity = pivotResult?.popularity || (sortedByOdds.findIndex(r => r.num === prediction.pivotHorse.num) + 1) || 0;

  // 軸馬が3着以内か
  const pivotInTop3 = pivotFinish >= 1 && pivotFinish <= 3;

  // 各買い目の判定
  const wideRec = prediction.recommendations.find(r => r.type === 'wide');
  const umarenRec = prediction.recommendations.find(r => r.type === 'umaren');
  const sanrenpukuRec = prediction.recommendations.find(r => r.type === 'sanrenpuku');
  const tanshoRec = prediction.recommendations.find(r => r.type === 'tansho');

  // ワイド流し的中判定（実配当ベース）
  let wideHit = false;
  let wideReturn = 0;
  let wideHitCount = 0;
  if (wideRec && wideRec.combination.length >= 2) {
    const pivotNum = wideRec.combination[0];
    const partners = wideRec.combination.slice(1);
    const pivotInTop3Check = top3Nums.includes(pivotNum);
    if (pivotInTop3Check) {
      for (const partnerNum of partners) {
        if (top3Nums.includes(partnerNum)) {
          wideHitCount++;
          wideHit = true;
          // 実配当を取得
          const widePayout = findPayout(result.payouts, 'ワイド', pivotNum, partnerNum);
          if (widePayout > 0) {
            wideReturn += widePayout;
          } else {
            // フォールバック: 概算
            const pivotH = resultMap.get(pivotNum);
            const partnerH = resultMap.get(partnerNum);
            if (pivotH && partnerH) {
              const est = Math.round((pivotH.odds + partnerH.odds) * 50);
              wideReturn += est < 150 ? 200 : est;
            }
          }
        }
      }
    }
  }

  // 馬連流し的中判定（実配当ベース）
  let umarenHit = false;
  let umarenReturn = 0;
  if (umarenRec && umarenRec.combination.length >= 2 && top3Nums.length >= 2) {
    const top2 = [top3Nums[0], top3Nums[1]];
    const pivotNum = umarenRec.combination[0];
    const partners = umarenRec.combination.slice(1);
    if (top2.includes(pivotNum)) {
      for (const partnerNum of partners) {
        if (top2.includes(partnerNum)) {
          umarenHit = true;
          const umarenPayout = findPayout(result.payouts, '馬連', pivotNum, partnerNum);
          if (umarenPayout > 0) {
            umarenReturn = umarenPayout;
          } else {
            const pivotH = resultMap.get(pivotNum);
            const partnerH = resultMap.get(partnerNum);
            if (pivotH && partnerH) {
              umarenReturn = Math.round((pivotH.odds + partnerH.odds) * 100);
              if (umarenReturn < 200) umarenReturn = 300;
            }
          }
          break;
        }
      }
    }
  }

  // 三連複的中判定（実配当ベース）
  let sanrenpukuHit = false;
  let sanrenpukuReturn = 0;
  if (sanrenpukuRec) {
    sanrenpukuHit = sanrenpukuRec.combination.every(n => top3Nums.includes(n));
    if (sanrenpukuHit) {
      const sanrenPayout = findPayoutSanren(result.payouts, '三連複', top3Nums);
      if (sanrenPayout > 0) {
        sanrenpukuReturn = sanrenPayout;
      } else {
        const horses = sanrenpukuRec.combination.map(n => resultMap.get(n)).filter(Boolean);
        const totalOdds = horses.reduce((sum, h) => sum + (h?.odds || 0), 0);
        sanrenpukuReturn = Math.round(totalOdds * 200);
        if (sanrenpukuReturn < 300) sanrenpukuReturn = 500;
      }
    }
  }

  // 単勝的中判定（実配当ベース）
  let tanshoHit = false;
  let tanshoReturn = 0;
  if (tanshoRec && winner) {
    tanshoHit = tanshoRec.combination[0] === winner.num;
    if (tanshoHit) {
      const tanshoPayout = findPayoutSingle(result.payouts, '単勝');
      tanshoReturn = tanshoPayout > 0 ? tanshoPayout : Math.round(winner.odds * 100);
    }
  }

  return {
    pivotFinish,
    pivotInTop3,
    pivotOdds,
    pivotPopularity,
    wideHit,
    wideReturn,
    umarenHit,
    umarenReturn,
    sanrenpukuHit,
    sanrenpukuReturn,
    tanshoHit,
    tanshoReturn,
    top3Nums,
    winnerNum: winner?.num || 0,
    winnerName: winner?.name || '',
    winnerOdds: winner?.odds || 0,
  };
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (!date) {
    return NextResponse.json({ error: 'date required' }, { status: 400 });
  }

  const weeklyDir = path.join(process.cwd(), 'data', 'weekly', date);
  const predictionsPath = path.join(weeklyDir, 'predictions.json');
  const resultsPath = path.join(weeklyDir, 'results.json');

  if (!fs.existsSync(predictionsPath)) {
    return NextResponse.json({ error: '予想データが見つかりません。先に予想を生成してください。' }, { status: 404 });
  }
  if (!fs.existsSync(resultsPath)) {
    return NextResponse.json({ error: '結果データが見つかりません。' }, { status: 404 });
  }

  const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf-8'));
  const resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

  const resultMap = new Map<string, RaceResult>();
  for (const r of resultsData.results) {
    resultMap.set(r.raceId, r);
  }

  // 各レースの的中判定
  const raceResults: any[] = [];
  const venueStats: Record<string, {
    total: number;
    pivotHits: number;
    wideHits: number;
    umarenHits: number;
    sanrenpukuHits: number;
    tanshoHits: number;
    wideBet: number;
    wideReturn: number;
    umarenBet: number;
    umarenReturn: number;
    sanrenpukuBet: number;
    sanrenpukuReturn: number;
    tanshoBet: number;
    tanshoReturn: number;
  }> = {};

  for (const pred of predictions.predictions) {
    const result = resultMap.get(pred.raceId);
    if (!result || result.results.length === 0) continue;

    const hit = checkHit(pred, result);

    const venue = pred.venue;
    if (!venueStats[venue]) {
      venueStats[venue] = {
        total: 0, pivotHits: 0, wideHits: 0, umarenHits: 0,
        sanrenpukuHits: 0, tanshoHits: 0,
        wideBet: 0, wideReturn: 0, umarenBet: 0, umarenReturn: 0,
        sanrenpukuBet: 0, sanrenpukuReturn: 0, tanshoBet: 0, tanshoReturn: 0,
      };
    }

    const vs = venueStats[venue];
    vs.total++;
    if (hit.pivotInTop3) vs.pivotHits++;
    if (hit.wideHit) { vs.wideHits++; vs.wideReturn += hit.wideReturn; }
    // ワイド流し: 相手N頭=N点買い
    const predWideRec = pred.recommendations?.find((r: any) => r.type === 'wide');
    const widePoints = predWideRec ? Math.max(predWideRec.combination.length - 1, 1) : 1;
    vs.wideBet += widePoints * 100;
    if (hit.umarenHit) { vs.umarenHits++; vs.umarenReturn += hit.umarenReturn; }
    // 馬連流し: 相手N頭=N点買い
    const predUmarenRec = pred.recommendations?.find((r: any) => r.type === 'umaren');
    const umarenPoints = predUmarenRec ? Math.max(predUmarenRec.combination.length - 1, 1) : 1;
    vs.umarenBet += umarenPoints * 100;
    if (hit.sanrenpukuHit) { vs.sanrenpukuHits++; vs.sanrenpukuReturn += hit.sanrenpukuReturn; }
    vs.sanrenpukuBet += 100;
    if (hit.tanshoHit) { vs.tanshoHits++; vs.tanshoReturn += hit.tanshoReturn; }
    vs.tanshoBet += 100;

    raceResults.push({
      raceId: pred.raceId,
      raceName: pred.raceName,
      venue: pred.venue,
      raceNumber: pred.raceNumber,
      surface: pred.surface,
      distance: pred.distance,
      grade: pred.grade,
      shouldBet: pred.shouldBet !== false, // デフォルトtrue
      skipReasons: pred.skipReasons || [],
      pivot: {
        num: pred.pivotHorse.num,
        name: pred.pivotHorse.name,
        score: pred.pivotHorse.expectationScore,
        finish: hit.pivotFinish,
        inTop3: hit.pivotInTop3,
        odds: hit.pivotOdds,
        popularity: hit.pivotPopularity,
      },
      winner: { num: hit.winnerNum, name: hit.winnerName, odds: hit.winnerOdds },
      top3: hit.top3Nums,
      bets: {
        wide: { hit: hit.wideHit, return: hit.wideReturn },
        umaren: { hit: hit.umarenHit, return: hit.umarenReturn },
        sanrenpuku: { hit: hit.sanrenpukuHit, return: hit.sanrenpukuReturn },
        tansho: { hit: hit.tanshoHit, return: hit.tanshoReturn },
      },
    });
  }

  // 全体集計
  const totalStats = {
    total: 0,
    pivotHits: 0,
    wideHits: 0, wideBet: 0, wideReturn: 0,
    umarenHits: 0, umarenBet: 0, umarenReturn: 0,
    sanrenpukuHits: 0, sanrenpukuBet: 0, sanrenpukuReturn: 0,
    tanshoHits: 0, tanshoBet: 0, tanshoReturn: 0,
  };

  for (const vs of Object.values(venueStats)) {
    totalStats.total += vs.total;
    totalStats.pivotHits += vs.pivotHits;
    totalStats.wideHits += vs.wideHits;
    totalStats.wideBet += vs.wideBet;
    totalStats.wideReturn += vs.wideReturn;
    totalStats.umarenHits += vs.umarenHits;
    totalStats.umarenBet += vs.umarenBet;
    totalStats.umarenReturn += vs.umarenReturn;
    totalStats.sanrenpukuHits += vs.sanrenpukuHits;
    totalStats.sanrenpukuBet += vs.sanrenpukuBet;
    totalStats.sanrenpukuReturn += vs.sanrenpukuReturn;
    totalStats.tanshoHits += vs.tanshoHits;
    totalStats.tanshoBet += vs.tanshoBet;
    totalStats.tanshoReturn += vs.tanshoReturn;
  }

  // 推奨レースのみのROI（フィルター済み）
  const filteredRaces = raceResults.filter((r: any) => r.shouldBet);
  const filteredStats = {
    total: filteredRaces.length,
    skipped: raceResults.length - filteredRaces.length,
    wideBet: 0, wideReturn: 0, wideHits: 0,
    tanshoBet: 0, tanshoReturn: 0, tanshoHits: 0,
  };
  for (const r of filteredRaces) {
    const rr = r as any;
    const wPts = 5; // TODO: ideally from prediction
    filteredStats.wideBet += wPts * 100;
    if (rr.bets.wide.hit) { filteredStats.wideReturn += rr.bets.wide.return; filteredStats.wideHits++; }
    filteredStats.tanshoBet += 100;
    if (rr.bets.tansho.hit) { filteredStats.tanshoReturn += rr.bets.tansho.return; filteredStats.tanshoHits++; }
  }

  return NextResponse.json({
    date,
    totalStats: {
      ...totalStats,
      pivotRate: totalStats.total ? Math.round((totalStats.pivotHits / totalStats.total) * 100) : 0,
      wideRate: totalStats.total ? Math.round((totalStats.wideHits / totalStats.total) * 100) : 0,
      wideROI: totalStats.wideBet ? Math.round((totalStats.wideReturn / totalStats.wideBet) * 100) : 0,
      umarenROI: totalStats.umarenBet ? Math.round((totalStats.umarenReturn / totalStats.umarenBet) * 100) : 0,
      sanrenpukuROI: totalStats.sanrenpukuBet ? Math.round((totalStats.sanrenpukuReturn / totalStats.sanrenpukuBet) * 100) : 0,
      tanshoROI: totalStats.tanshoBet ? Math.round((totalStats.tanshoReturn / totalStats.tanshoBet) * 100) : 0,
    },
    filteredStats: {
      total: filteredStats.total,
      skipped: filteredStats.skipped,
      wideROI: filteredStats.wideBet ? Math.round((filteredStats.wideReturn / filteredStats.wideBet) * 100) : 0,
      tanshoROI: filteredStats.tanshoBet ? Math.round((filteredStats.tanshoReturn / filteredStats.tanshoBet) * 100) : 0,
      wideHits: filteredStats.wideHits,
      tanshoHits: filteredStats.tanshoHits,
    },
    venueStats: Object.entries(venueStats).map(([venue, vs]) => ({
      venue,
      total: vs.total,
      pivotRate: vs.total ? Math.round((vs.pivotHits / vs.total) * 100) : 0,
      wideRate: vs.total ? Math.round((vs.wideHits / vs.total) * 100) : 0,
      wideROI: vs.wideBet ? Math.round((vs.wideReturn / vs.wideBet) * 100) : 0,
      umarenROI: vs.umarenBet ? Math.round((vs.umarenReturn / vs.umarenBet) * 100) : 0,
      sanrenpukuROI: vs.sanrenpukuBet ? Math.round((vs.sanrenpukuReturn / vs.sanrenpukuBet) * 100) : 0,
      tanshoROI: vs.tanshoBet ? Math.round((vs.tanshoReturn / vs.tanshoBet) * 100) : 0,
    })),
    raceResults,
  });
}
