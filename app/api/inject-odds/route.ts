/**
 * ブラウザで取得したオッズデータを注入する API
 * POST /api/inject-odds
 * Body: { date: "2026-05-09", odds: { "202605020501": { "1": 5.4, "2": 3.2, ... }, ... } }
 * 
 * ブラウザのDevToolsコンソールから呼び出す用。
 * または設定画面の「ブラウザで取得」ボタンから呼び出す。
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, odds } = body;
    
    if (!date || !odds || typeof odds !== 'object') {
      return NextResponse.json({ 
        error: 'Required: { date: "YYYY-MM-DD", odds: { "raceId": { "馬番": odds, ... }, ... } }' 
      }, { status: 400 });
    }

    const weeklyDir = path.join(process.cwd(), 'data', 'weekly', date);
    const entriesPath = path.join(weeklyDir, 'entries.json');

    if (!fs.existsSync(entriesPath)) {
      return NextResponse.json({ error: `${date}のデータが見つかりません` }, { status: 404 });
    }

    const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
    const races = entriesData.races || [];
    let updatedRaces = 0;
    let updatedHorses = 0;

    for (const race of races) {
      const raceOdds = odds[race.raceId];
      if (!raceOdds || typeof raceOdds !== 'object') continue;

      let updated = false;
      for (const entry of race.entries) {
        const numStr = String(entry.num);
        if (raceOdds[numStr] !== undefined) {
          const oddsData = raceOdds[numStr];
          if (typeof oddsData === 'number') {
            entry.odds = oddsData;
          } else if (typeof oddsData === 'object') {
            if (oddsData.odds) entry.odds = oddsData.odds;
            if (oddsData.popularity) entry.popularity = oddsData.popularity;
          }
          updated = true;
          updatedHorses++;
        }
      }
      if (updated) updatedRaces++;
    }

    // 保存
    fs.writeFileSync(entriesPath, JSON.stringify(entriesData, null, 2), 'utf-8');

    // predictions.json 削除
    const predictionsPath = path.join(weeklyDir, 'predictions.json');
    if (fs.existsSync(predictionsPath)) fs.unlinkSync(predictionsPath);

    return NextResponse.json({
      success: true,
      updatedRaces,
      updatedHorses,
      message: `${updatedRaces}レース・${updatedHorses}頭にオッズを注入しました`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
