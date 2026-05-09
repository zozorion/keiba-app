/**
 * オッズ再取得 API
 * POST /api/refresh-odds?date=2026-05-09
 * 
 * レース当日朝に呼ぶことで、entries.json にオッズと人気を注入し、
 * predictions.json を再生成する。
 * 
 * netkeibaの単勝オッズAPIは投票受付開始後（通常前日夕方〜当日朝）に
 * 実データが返るため、金曜夜のスクレイプ時には取得できない。
 * そのため、当日朝にこのAPIを呼んでオッズを補完する。
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import https from 'https';

export const maxDuration = 120;

function fetchOddsApi(raceId: string): Promise<any> {
  const url = `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=1`;
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`,
        'Accept': 'application/json,text/javascript,*/*;q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(text));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (!date) {
    return NextResponse.json({ error: 'date required' }, { status: 400 });
  }

  const weeklyDir = path.join(process.cwd(), 'data', 'weekly', date);
  const entriesPath = path.join(weeklyDir, 'entries.json');

  if (!fs.existsSync(entriesPath)) {
    return NextResponse.json({ error: `${date}のデータが見つかりません` }, { status: 404 });
  }

  try {
    const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
    const races = entriesData.races || [];
    let updatedCount = 0;
    let oddsCount = 0;

    for (const race of races) {
      const raceId = race.raceId;
      if (!raceId) continue;

      const json = await fetchOddsApi(raceId);
      if (!json || json.status !== 'result' || !json.data?.odds?.['1']) {
        await sleep(300);
        continue;
      }

      const oddsData = json.data.odds['1'];
      let raceOddsCount = 0;
      for (const entry of race.entries) {
        const key = String(entry.num).padStart(2, '0');
        const tuple = oddsData[key];
        if (Array.isArray(tuple) && tuple.length >= 3) {
          const odds = parseFloat(tuple[0]);
          const pop = parseInt(tuple[2]);
          if (Number.isFinite(odds) && odds > 0) {
            entry.odds = odds;
            raceOddsCount++;
          }
          if (Number.isFinite(pop) && pop > 0) {
            entry.popularity = pop;
          }
        }
      }

      if (raceOddsCount > 0) {
        updatedCount++;
        oddsCount += raceOddsCount;
      }

      await sleep(500); // netkeiba API レート制限対策
    }

    // entries.jsonを上書き保存（オッズ付き）
    fs.writeFileSync(entriesPath, JSON.stringify(entriesData, null, 2), 'utf-8');

    // predictions.jsonを削除 → 次回のpredict呼び出しで再生成される
    const predictionsPath = path.join(weeklyDir, 'predictions.json');
    if (fs.existsSync(predictionsPath)) {
      fs.unlinkSync(predictionsPath);
    }

    return NextResponse.json({
      success: true,
      date,
      racesTotal: races.length,
      racesUpdated: updatedCount,
      oddsAttached: oddsCount,
      message: `${updatedCount}/${races.length}レースにオッズを注入しました（計${oddsCount}頭分）。予測は次回アクセス時に再生成されます。`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
