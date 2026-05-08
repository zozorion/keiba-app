/**
 * 単一レース予想取得API
 * GET /api/race/{raceId}
 *
 * data/weekly/<date>/predictions.json を全日付横断で検索し、
 * 指定 raceId の予想結果を返す。
 * predictions.json が無ければ data/weekly/<date>/entries.json から逆算で
 * その日の予想を生成し（predictAllRaces）、当該レースを抽出して返す。
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { predictAllRaces, dateToInt } from '../../../../engine/predictor';
import type { RaceInfo } from '../../../../engine/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: raceId } = await params;
  if (!raceId || !/^\d{12}$/.test(raceId)) {
    return NextResponse.json({ error: 'race id (12桁) が必要です' }, { status: 400 });
  }

  const weeklyDir = path.join(process.cwd(), 'data', 'weekly');
  if (!fs.existsSync(weeklyDir)) {
    return NextResponse.json({ error: 'データがありません' }, { status: 404 });
  }

  const dates = fs.readdirSync(weeklyDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  // 1. 既存 predictions.json から検索
  for (const date of dates) {
    const predPath = path.join(weeklyDir, date, 'predictions.json');
    if (!fs.existsSync(predPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(predPath, 'utf-8'));
      const found = (data.predictions || []).find((p: any) => p.raceId === raceId);
      if (found) return NextResponse.json({ date, prediction: found });
    } catch { /* 次の日付へ */ }
  }

  // 2. predictions.json が無ければ entries.json から都度生成
  for (const date of dates) {
    const entriesPath = path.join(weeklyDir, date, 'entries.json');
    if (!fs.existsSync(entriesPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
      const races: RaceInfo[] = data.races || [];
      const target = races.find(r => r.raceId === raceId);
      if (!target) continue;

      const predictions = predictAllRaces([target], dateToInt(date));
      const p = predictions[0];
      if (!p) continue;

      const prediction = {
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
      };

      return NextResponse.json({ date, prediction });
    } catch { /* 次の日付へ */ }
  }

  return NextResponse.json({ error: `race ${raceId} は見つかりませんでした` }, { status: 404 });
}
