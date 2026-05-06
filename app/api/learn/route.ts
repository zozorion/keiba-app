/**
 * 学習API Route
 * POST /api/learn?date=2026-05-02  → 特定日の学習を実行
 * GET  /api/learn                  → 学習履歴・チューニング情報を取得
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  learnFromWeek, saveFeedback, updateVenueTuning,
  loadFeedbackHistory, loadAllTunings
} from '../../../engine/learner';
import { VENUE_PROFILES } from '../../../engine/venue-profiles';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  
  if (!date) {
    return NextResponse.json({ error: 'date required' }, { status: 400 });
  }

  try {
    // 1. 週次データから学習
    const records = learnFromWeek(date);

    // 2. 蓄積データに追記
    saveFeedback(records);

    // 3. 競馬場別チューニングを再計算
    const tunings = updateVenueTuning();

    return NextResponse.json({
      success: true,
      date,
      venueResults: records.map(r => ({
        venue: r.venueJa,
        racesCount: r.racesCount,
        pivotTop3Rate: r.pivotTop3Rate,
        wideROI: r.wideROI,
        insights: r.insights,
        adjustments: r.adjustments,
      })),
      tunings: tunings.map(t => ({
        venue: t.venueJa,
        weeksLearned: t.weeksLearned,
        totalRaces: t.totalRaces,
        weights: t.weights,
        performance: t.performance,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const history = loadFeedbackHistory();
    const tunings = loadAllTunings();

    // 週ごとにグループ化
    const weekGroups: Record<string, any[]> = {};
    if (history) {
      for (const w of history.weeks) {
        if (!weekGroups[w.date]) weekGroups[w.date] = [];
        weekGroups[w.date].push(w);
      }
    }

    return NextResponse.json({
      history: Object.entries(weekGroups).map(([date, venues]) => ({
        date,
        venues: venues.map(v => ({
          venue: v.venueJa,
          racesCount: v.racesCount,
          pivotTop3Rate: v.pivotTop3Rate,
          wideHits: v.wideHits,
          wideROI: v.wideROI,
          tanshoROI: v.tanshoROI,
          factorAnalysis: v.factorAnalysis,
          insights: v.insights,
          adjustments: v.adjustments,
        })),
      })).sort((a, b) => b.date.localeCompare(a.date)),
      tunings: tunings.map(t => ({
        venue: t.venueJa,
        venueEn: t.venue,
        weeksLearned: t.weeksLearned,
        totalRaces: t.totalRaces,
        lastLearnDate: t.lastLearnDate,
        weights: t.weights,
        performance: t.performance,
      })),
      // v5: 競馬場プロファイル情報を追加
      profiles: Object.entries(VENUE_PROFILES).map(([name, p]) => ({
        name,
        sireMultiplier: p.sireMultiplier,
        jockeyMultiplier: p.jockeyMultiplier,
        trainerMultiplier: p.trainerMultiplier,
        frameMultiplier: p.frameMultiplier,
        distanceMultiplier: p.distanceMultiplier,
        courseMultiplier: p.courseMultiplier,
        turfAdjust: p.turfAdjust,
        dirtAdjust: p.dirtAdjust,
        pivotStrategy: p.pivotStrategy,
        distanceTrust: p.distanceTrust,
        widePartnersSmall: p.widePartnersSmall,
        widePartnersMedium: p.widePartnersMedium,
        widePartnersLarge: p.widePartnersLarge,
      })),
      lastUpdated: history?.lastUpdated || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
