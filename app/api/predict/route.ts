/**
 * 予想API Route
 * GET /api/predict?date=2026-05-09           → キャッシュがあれば返す、無ければ生成
 * GET /api/predict?date=2026-05-09&force=1   → 強制再生成（LLM再分析）
 *
 * 流れ:
 *  1. data/weekly/<date>/entries.json を読む
 *  2. ヒューリスティックscoringで全馬の基礎スコアを即座に算出 → レスポンス返却
 *  3. Gemini Pro で各レースを総合分析（バックグラウンドで非同期実行）
 *  4. predictions.json にキャッシュ保存
 *
 * Railway対応:
 * - ヒューリスティック結果を即座に返すことで、リクエストタイムアウトを回避
 * - LLM強化はバックグラウンドで実行し、次回リクエスト時にキャッシュから返す
 * - CSVデータは instrumentation.ts でサーバー起動時にプリロード済み
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { predictAllRaces, dateToInt } from '../../../engine/predictor';
import { enhancePredictionsParallel } from '../../../lib/predict-llm';
import { isGeminiConfigured } from '../../../lib/gemini';
import type { RaceInfo, PredictionResult } from '../../../engine/types';

// LLM強化結果のキャッシュ有効期間（24時間）
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// バックグラウンドLLM強化の進行状況
const llmJobs = new Map<string, { status: 'running' | 'done' | 'error'; startedAt: number }>();

export const maxDuration = 300; // Vercel/Railway のサーバーレス上限を300秒に拡張

/**
 * 予測結果をキャッシュJSONに保存する共通関数
 */
function savePredictionsCache(
  cachePath: string,
  date: string,
  predictions: PredictionResult[],
  llmEnhanced: boolean,
  llmStats: { attempted: number; succeeded: number; durationMs: number }
) {
  fs.writeFileSync(cachePath, JSON.stringify({
    date,
    generatedAt: new Date().toISOString(),
    llmEnhanced,
    llmStats,
    predictions: predictions.map(p => ({
      raceId: p.race.raceId,
      raceName: p.race.raceName,
      venue: p.race.courseName,
      raceNumber: p.race.raceNumber,
      surface: p.race.surface,
      distance: p.race.distance,
      condition: p.race.condition,
      postTime: p.race.postTime,
      grade: p.race.grade,
      pivotHorse: {
        num: p.pivotHorse.num,
        name: p.pivotHorse.name,
        score: p.pivotHorse.score,
        expectationScore: p.pivotHorse.expectationScore,
        sire: p.pivotHorse.sire,
        jockey: p.pivotHorse.jockey,
        trainer: p.pivotHorse.trainer,
        reasons: p.pivotHorse.reasons,
      },
      expectationLevel: p.expectationLevel,
      isGraded: p.isGraded,
      isHighConfidence: p.isHighConfidence,
      shouldBet: (p as any).shouldBet ?? true,
      skipReasons: (p as any).skipReasons || [],
      llmEnhanced: !!(p as any).llmEnhanced,
      llmAdvice: (p as any).llmAdvice,
      llmMode: (p as any).llmMode,
      recommendations: p.recommendations,
      checkCard: p.checkCard,
      allHorses: p.scoredHorses.map(h => ({
        num: h.num, frame: h.frame, name: h.name, sex: h.sex,
        jockey: h.jockey, trainer: h.trainer, sire: h.sire,
        score: h.score, expectationScore: h.expectationScore,
        reasons: h.reasons,
        odds: (h as any).odds, popularity: (h as any).popularity,
        distanceRecord: h.distanceRecord, courseRecord: h.courseRecord,
        surfaceRecord: h.surfaceRecord, intervalDays: h.intervalDays,
        recentHistory: h.history?.slice(0, 3).map(hr => ({
          date: hr.date, course: hr.courseName, surface: hr.surface,
          distance: hr.distance, finish: hr.finish, last3f: hr.last3f,
          condition: hr.condition,
        })),
      })),
    })),
  }, null, 2), 'utf-8');
}

/**
 * predictions を会場別グルーピングに変換
 */
function groupByVenue(predictions: PredictionResult[]): Record<string, any[]> {
  const byVenue: Record<string, any[]> = {};
  for (const pred of predictions) {
    const venue = pred.race.courseName;
    if (!byVenue[venue]) byVenue[venue] = [];
    byVenue[venue].push(pred);
  }
  return byVenue;
}

/**
 * キャッシュの predictions を会場別グルーピング形式に変換
 */
function groupCachedByVenue(predictions: any[]): Record<string, any[]> {
  const byVenue: Record<string, any[]> = {};
  for (const p of predictions) {
    const v = p.venue || p.race?.courseName || '不明';
    if (!byVenue[v]) byVenue[v] = [];
    byVenue[v].push({
      race: {
        raceId: p.raceId,
        raceName: p.raceName,
        courseName: p.venue,
        raceNumber: p.raceNumber,
        surface: p.surface,
        distance: p.distance,
        condition: p.condition,
        postTime: p.postTime,
        grade: p.grade,
      },
      pivotHorse: p.pivotHorse,
      expectationLevel: p.expectationLevel,
      isGraded: p.isGraded,
      isHighConfidence: p.isHighConfidence,
      shouldBet: p.shouldBet,
      llmEnhanced: p.llmEnhanced,
    });
  }
  return byVenue;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const date = searchParams.get('date');
  const force = searchParams.get('force') === '1';

  if (!date) {
    return NextResponse.json({ error: 'date parameter required (YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    const weeklyDir = path.join(process.cwd(), 'data', 'weekly', date);
    const entriesPath = path.join(weeklyDir, 'entries.json');
    const cachePath = path.join(weeklyDir, 'predictions.json');

    if (!fs.existsSync(entriesPath)) {
      return NextResponse.json({
        error: `${date}のレースデータが見つかりません。先にデータを取得してください。`,
        needsScrape: true,
      }, { status: 404 });
    }

    // === キャッシュ判定 ===
    if (!force && fs.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const generatedAt = cached.generatedAt ? new Date(cached.generatedAt).getTime() : 0;
        const age = Date.now() - generatedAt;
        if (cached.predictions && age < CACHE_TTL_MS) {
          const byVenue = groupCachedByVenue(cached.predictions);

          // キャッシュがヒューリスティックのみで LLM未実行 → バックグラウンドでLLM強化を開始
          if (!cached.llmEnhanced && isGeminiConfigured() && !llmJobs.has(date)) {
            startBackgroundLLMEnhancement(date, weeklyDir, entriesPath, cachePath);
          }

          return NextResponse.json({
            date,
            generatedAt: cached.generatedAt,
            venueCount: Object.keys(byVenue).length,
            raceCount: cached.predictions.length,
            venues: byVenue,
            cached: true,
            llmEnhanced: cached.llmEnhanced,
            llmStatus: llmJobs.get(date)?.status || (cached.llmEnhanced ? 'done' : 'pending'),
          });
        }
      } catch { /* キャッシュ破損 → 再生成 */ }
    }

    // === 新規生成（ヒューリスティックのみ → 即返し） ===
    const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
    const races: RaceInfo[] = entriesData.races || [];
    if (races.length === 0) {
      return NextResponse.json({ error: 'レースデータが空です' }, { status: 404 });
    }

    // results.jsonからオッズを注入
    const resultsPath = path.join(weeklyDir, 'results.json');
    if (fs.existsSync(resultsPath)) {
      try {
        const resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
        const oddsMap = new Map<string, { odds: number; popularity: number }>();
        for (const r of (resultsData.results || [])) {
          for (const h of (r.results || [])) {
            if (h.num && h.odds) {
              oddsMap.set(`${r.raceId}_${h.num}`, { odds: h.odds, popularity: h.popularity || 0 });
            }
          }
        }
        for (const race of races) {
          for (const entry of race.entries) {
            if (!entry.odds) {
              const key = `${race.raceId}_${entry.num}`;
              const od = oddsMap.get(key);
              if (od) {
                (entry as any).odds = od.odds;
                (entry as any).popularity = od.popularity;
              }
            }
          }
        }
      } catch {}
    }

    const raceDate = dateToInt(date);
    const heuristicPreds = predictAllRaces(races, raceDate);

    // ヒューリスティック結果を即座にキャッシュ保存
    savePredictionsCache(cachePath, date, heuristicPreds, false, {
      attempted: 0, succeeded: 0, durationMs: 0,
    });

    // 会場別グルーピング
    const byVenue = groupByVenue(heuristicPreds);

    // バックグラウンドでLLM強化を開始（レスポンスは待たない）
    if (isGeminiConfigured() && !llmJobs.has(date)) {
      startBackgroundLLMEnhancement(date, weeklyDir, entriesPath, cachePath);
    }

    return NextResponse.json({
      date,
      generatedAt: new Date().toISOString(),
      venueCount: Object.keys(byVenue).length,
      raceCount: heuristicPreds.length,
      venues: byVenue,
      llmEnhanced: false,
      llmStatus: llmJobs.has(date) ? 'running' : 'pending',
    });
  } catch (error: any) {
    console.error('Prediction error:', error);
    return NextResponse.json({
      error: `予想生成エラー: ${error.message}`,
    }, { status: 500 });
  }
}

/**
 * バックグラウンドでLLM強化を実行し、結果をキャッシュに上書きする。
 * レスポンスをブロックせず、次回リクエスト時にキャッシュから返す。
 */
function startBackgroundLLMEnhancement(
  date: string,
  weeklyDir: string,
  entriesPath: string,
  cachePath: string,
) {
  llmJobs.set(date, { status: 'running', startedAt: Date.now() });
  console.log(`[LLM-BG] ${date} バックグラウンドLLM強化を開始`);

  // 非同期で実行（awaitしない = レスポンスをブロックしない）
  (async () => {
    try {
      const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
      const races: RaceInfo[] = entriesData.races || [];
      if (races.length === 0) {
        llmJobs.set(date, { status: 'error', startedAt: Date.now() });
        return;
      }

      // オッズ注入
      const resultsPath = path.join(weeklyDir, 'results.json');
      if (fs.existsSync(resultsPath)) {
        try {
          const resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
          const oddsMap = new Map<string, { odds: number; popularity: number }>();
          for (const r of (resultsData.results || [])) {
            for (const h of (r.results || [])) {
              if (h.num && h.odds) {
                oddsMap.set(`${r.raceId}_${h.num}`, { odds: h.odds, popularity: h.popularity || 0 });
              }
            }
          }
          for (const race of races) {
            for (const entry of race.entries) {
              if (!entry.odds) {
                const key = `${race.raceId}_${entry.num}`;
                const od = oddsMap.get(key);
                if (od) {
                  (entry as any).odds = od.odds;
                  (entry as any).popularity = od.popularity;
                }
              }
            }
          }
        } catch {}
      }

      const raceDate = dateToInt(date);
      const heuristicPreds = predictAllRaces(races, raceDate);

      // LLM強化（並列4本）
      const startedAt = Date.now();
      const enhanced = await enhancePredictionsParallel(heuristicPreds, 4);
      const durationMs = Date.now() - startedAt;
      const successCount = enhanced.filter(p => (p as any).llmEnhanced).length;

      // キャッシュを上書き保存
      savePredictionsCache(cachePath, date, enhanced, successCount > 0, {
        attempted: enhanced.length,
        succeeded: successCount,
        durationMs,
      });

      llmJobs.set(date, { status: 'done', startedAt: Date.now() });
      console.log(`[LLM-BG] ${date} 完了: ${successCount}/${enhanced.length}レース強化 (${(durationMs / 1000).toFixed(1)}s)`);

      // 30分後にジョブ情報をクリア
      setTimeout(() => llmJobs.delete(date), 30 * 60 * 1000);
    } catch (e: any) {
      console.error(`[LLM-BG] ${date} エラー: ${e.message}`);
      llmJobs.set(date, { status: 'error', startedAt: Date.now() });
      setTimeout(() => llmJobs.delete(date), 5 * 60 * 1000);
    }
  })();
}
