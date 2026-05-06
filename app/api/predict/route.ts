/**
 * 予想API Route
 * GET /api/predict?date=2026-05-09
 * 指定日付の全レース予想を生成して返す
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { predictAllRaces, dateToInt } from '../../../engine/predictor';
import type { RaceInfo, PredictionResult } from '../../../engine/types';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const date = searchParams.get('date');

  if (!date) {
    return NextResponse.json({ error: 'date parameter required (YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    // 週間データがあるか確認
    const weeklyDir = path.join(process.cwd(), 'data', 'weekly', date);
    const entriesPath = path.join(weeklyDir, 'entries.json');

    if (!fs.existsSync(entriesPath)) {
      return NextResponse.json({
        error: `${date}のレースデータが見つかりません。先にデータを取得してください。`,
        needsScrape: true
      }, { status: 404 });
    }

    const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
    const races: RaceInfo[] = entriesData.races || [];

    if (races.length === 0) {
      return NextResponse.json({ error: 'レースデータが空です' }, { status: 404 });
    }

    // v5.4: results.jsonからオッズを注入（entries.jsonにオッズがない場合のフォールバック）
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
        // entries にオッズ注入
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
    const predictions = predictAllRaces(races, raceDate);

    // 会場別にグルーピング
    const byVenue: Record<string, PredictionResult[]> = {};
    for (const pred of predictions) {
      const venue = pred.race.courseName;
      if (!byVenue[venue]) byVenue[venue] = [];
      byVenue[venue].push(pred);
    }

    // 結果をキャッシュ保存
    const resultPath = path.join(weeklyDir, 'predictions.json');
    fs.writeFileSync(resultPath, JSON.stringify({
      date,
      generatedAt: new Date().toISOString(),
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
          reasons: p.pivotHorse.reasons,
        },
        expectationLevel: p.expectationLevel,
        isGraded: p.isGraded,
        isHighConfidence: p.isHighConfidence,
        shouldBet: (p as any).shouldBet ?? true,
        skipReasons: (p as any).skipReasons || [],
        recommendations: p.recommendations,
        checkCard: p.checkCard,
        allHorses: p.scoredHorses.map(h => ({
          num: h.num,
          frame: h.frame,
          name: h.name,
          sex: h.sex,
          jockey: h.jockey,
          trainer: h.trainer,
          sire: h.sire,
          score: h.score,
          expectationScore: h.expectationScore,
          reasons: h.reasons,
          odds: h.odds,
          popularity: h.popularity,
          distanceRecord: h.distanceRecord,
          courseRecord: h.courseRecord,
          surfaceRecord: h.surfaceRecord,
          intervalDays: h.intervalDays,
          recentHistory: h.history?.slice(0, 3).map(hr => ({
            date: hr.date,
            course: hr.courseName,
            surface: hr.surface,
            distance: hr.distance,
            finish: hr.finish,
            last3f: hr.last3f,
            condition: hr.condition,
          })),
        })),
      })),
    }, null, 2), 'utf-8');

    return NextResponse.json({
      date,
      generatedAt: new Date().toISOString(),
      venueCount: Object.keys(byVenue).length,
      raceCount: predictions.length,
      venues: byVenue,
    });
  } catch (error: any) {
    console.error('Prediction error:', error);
    return NextResponse.json({
      error: `予想生成エラー: ${error.message}`
    }, { status: 500 });
  }
}
