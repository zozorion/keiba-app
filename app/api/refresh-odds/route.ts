/**
 * ブラウザ経由オッズ取得 API
 * POST /api/refresh-odds?date=2026-05-09
 * 
 * 2段階方式:
 *  1. netkeiba JSON API (type=1) で取得を試みる（高速・確実性低）
 *  2. 失敗したレースは上位人気一覧ページ（yoso.netkeiba.com）から取得
 * 
 * 注: netkeibaのオッズはJSレンダリングが必須のため、
 *     サーバーサイドHTTPリクエストでは取得が難しいレースがある。
 *     このAPIは JSON API + HTML解析のハイブリッドで最大限取得を試みる。
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import https from 'https';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export const maxDuration = 300;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * netkeiba JSON API（type=1 単勝オッズ）
 */
function fetchOddsJsonApi(raceId: string): Promise<Map<number, { odds: number; popularity: number }> | null> {
  return new Promise((resolve) => {
    const url = `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${raceId}&type=1`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': `https://race.netkeiba.com/odds/index.html?race_id=${raceId}&type=b1`,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (!json || json.status !== 'result' || !json.data?.odds?.['1']) {
            resolve(null);
            return;
          }
          const oddsData = json.data.odds['1'];
          const result = new Map<number, { odds: number; popularity: number }>();
          for (const [key, tuple] of Object.entries(oddsData)) {
            if (!Array.isArray(tuple) || (tuple as any[]).length < 3) continue;
            const t = tuple as string[];
            const odds = parseFloat(t[0]);
            const pop = parseInt(t[2]);
            const num = parseInt(key);
            if (Number.isFinite(odds) && odds > 0 && Number.isFinite(num) && num > 0) {
              result.set(num, { odds, popularity: Number.isFinite(pop) && pop > 0 ? pop : 0 });
            }
          }
          resolve(result.size > 0 ? result : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

/**
 * 出走表ページ（shutuba_past.html）からオッズを取得
 * こちらのページは場合によってEUC-JPでオッズが埋め込まれている
 */
function fetchShutubaOdds(raceId: string): Promise<Map<number, { odds: number; popularity: number }> | null> {
  return new Promise((resolve) => {
    // result_pay_backページはレース確定後のみ。代わりにレース前オッズのある別URLを試行
    const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}&rf=race_submenu`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const html = iconv.decode(Buffer.concat(chunks), 'euc-jp');
        const $ = cheerio.load(html);
        const result = new Map<number, { odds: number; popularity: number }>();
        
        // 全HorseList行からオッズを探す（複数セレクタ対応）
        $('tr.HorseList').each((_, row) => {
          const $row = $(row);
          const umabanTd = $row.find("td[class*='Umaban']").first();
          const num = parseInt(umabanTd.text().trim()) || 0;
          if (num === 0) return;
          
          // 全tdを走査してオッズっぽい値を探す
          let odds = 0;
          let popularity = 0;
          $row.find('td').each((_, td) => {
            const cls = $(td).attr('class') || '';
            const txt = $(td).text().trim();
            // Oddsクラスかつ数値っぽい値
            if ((cls.includes('Odds') || cls.includes('Popular')) && /^\d+\.\d+$/.test(txt)) {
              odds = parseFloat(txt);
            }
            // 人気（数字のみ）
            if (cls.includes('Ninki') && /^\d+$/.test(txt)) {
              popularity = parseInt(txt);
            }
          });
          
          if (odds > 0) {
            result.set(num, { odds, popularity });
          }
        });
        
        resolve(result.size > 0 ? result : null);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

/**
 * netkeiba予想ページからオッズを取得（フォールバック）
 * yoso.netkeiba.com のページにオッズが表示されている場合がある
 */
function fetchYosoOdds(raceId: string): Promise<Map<number, { odds: number; popularity: number }> | null> {
  return new Promise((resolve) => {
    const url = `https://yoso.netkeiba.com/?pid=yoso_result_list&race_id=${raceId}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const html = iconv.decode(Buffer.concat(chunks), 'euc-jp');
          const $ = cheerio.load(html);
          const result = new Map<number, { odds: number; popularity: number }>();
          
          // テーブル行を解析
          $('table.YosoResultListTable tr, table tr').each((_, row) => {
            const $row = $(row);
            const tds = $row.find('td');
            if (tds.length < 3) return;
            
            // 馬番とオッズを探す
            tds.each((i, td) => {
              const txt = $(td).text().trim();
              // オッズパターン: "X.X倍" or 単純な小数
              const oddsMatch = txt.match(/(\d+\.\d+)\s*倍?/);
              if (oddsMatch) {
                // 前のtdから馬番を取得
                const numTd = tds.eq(Math.max(0, i - 2));
                const num = parseInt(numTd.text().trim()) || 0;
                if (num > 0 && num <= 18) {
                  result.set(num, { odds: parseFloat(oddsMatch[1]), popularity: 0 });
                }
              }
            });
          });
          
          resolve(result.size > 0 ? result : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
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
    let apiSuccess = 0;
    let htmlSuccess = 0;
    const failedRaces: string[] = [];

    for (const race of races) {
      const raceId = race.raceId;
      if (!raceId) continue;

      // 方式1: JSON API
      let oddsMap = await fetchOddsJsonApi(raceId);
      if (oddsMap) {
        apiSuccess++;
      } else {
        // 方式2: 出走表HTML
        await sleep(500);
        oddsMap = await fetchShutubaOdds(raceId);
        if (oddsMap) {
          htmlSuccess++;
        } else {
          // 方式3: 予想ページ
          await sleep(500);
          oddsMap = await fetchYosoOdds(raceId);
          if (oddsMap) htmlSuccess++;
        }
      }

      if (oddsMap && oddsMap.size > 0) {
        let raceOddsCount = 0;
        for (const entry of race.entries) {
          const data = oddsMap.get(entry.num);
          if (data) {
            entry.odds = data.odds;
            if (data.popularity > 0) entry.popularity = data.popularity;
            raceOddsCount++;
          }
        }
        if (raceOddsCount > 0) {
          updatedCount++;
          oddsCount += raceOddsCount;
        }
      } else {
        failedRaces.push(`${race.raceNumber || '?'}R ${race.raceName || raceId}`);
      }

      await sleep(600);
    }

    // entries.jsonを上書き保存
    fs.writeFileSync(entriesPath, JSON.stringify(entriesData, null, 2), 'utf-8');

    // predictions.jsonを削除
    const predictionsPath = path.join(weeklyDir, 'predictions.json');
    if (fs.existsSync(predictionsPath)) {
      fs.unlinkSync(predictionsPath);
    }

    const status = updatedCount === races.length ? 'complete' 
      : updatedCount > 0 ? 'partial' : 'failed';

    return NextResponse.json({
      success: updatedCount > 0,
      status,
      date,
      racesTotal: races.length,
      racesUpdated: updatedCount,
      oddsAttached: oddsCount,
      methods: { api: apiSuccess, html: htmlSuccess },
      failedRaces: failedRaces.length > 0 ? failedRaces : undefined,
      message: status === 'complete'
        ? `✅ 全${races.length}レースのオッズを取得しました（計${oddsCount}頭分）`
        : status === 'partial'
          ? `⚠️ ${updatedCount}/${races.length}レースのオッズを取得（API:${apiSuccess}, HTML:${htmlSuccess}）。残り${failedRaces.length}レースはブラウザ取得が必要です。`
          : `❌ サーバーサイドでオッズを取得できません。ブラウザ取得をお試しください。`,
      hint: status !== 'complete' 
        ? '設定画面の「ブラウザで取得」ボタンを使うと確実に全レース取得できます。'
        : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
