/**
 * オッズ再取得 API（v4: Puppeteer ブラウザ方式）
 * POST /api/refresh-odds?date=2026-05-09
 * 
 * ローカルPCのChromeをヘッドレスで起動し、netkeibaのオッズページを
 * 巡回してJSレンダリング後のオッズを確実に取得する。
 * 
 * ■ なぜPuppeteerが必要か:
 *   netkeibaのオッズはJavaScriptで動的にレンダリングされるため、
 *   サーバーサイドHTTPリクエスト（JSON API含む）では全レース取得が不可能。
 *   ブラウザでJSを実行し、DOMからオッズを読み取る必要がある。
 * 
 * ■ puppeteer-core を使用:
 *   ユーザーPCの既存Chrome/Edgeを利用するため、Chromium DLが不要（軽量）。
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const maxDuration = 300;

// Chrome/Edge の実行ファイルパスを検出
function findChromePath(): string | null {
  const candidates = [
    // Chrome
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    // Edge
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
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

  // Chrome パス検出
  const chromePath = findChromePath();
  if (!chromePath) {
    return NextResponse.json({
      error: 'Chrome/Edgeが見つかりません。CHROME_PATH環境変数を設定してください。',
    }, { status: 500 });
  }

  let browser: any = null;
  try {
    // puppeteer-core を動的インポート
    const puppeteer = await import('puppeteer-core');

    const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
    const races = entriesData.races || [];
    if (races.length === 0) {
      return NextResponse.json({ error: 'レースデータが空です' }, { status: 404 });
    }

    // ヘッドレスChrome起動（1つのブラウザで全レースを巡回）
    browser = await puppeteer.default.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,720',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    let updatedCount = 0;
    let oddsCount = 0;
    const failedRaces: string[] = [];

    for (const race of races) {
      const raceId = race.raceId;
      if (!raceId) continue;

      try {
        const url = `https://race.netkeiba.com/odds/index.html?race_id=${raceId}&type=b1`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // JSレンダリング完了を待つ（オッズが数値に変わるまで）
        try {
          await page.waitForFunction(
            () => {
              const spans = document.querySelectorAll('.Odds');
              if (spans.length === 0) return false;
              // 少なくとも1つのオッズが "---.-" 以外になるまで待つ
              return Array.from(spans).some(s => {
                const text = s.textContent?.trim() || '';
                return /^\d+\.\d+$/.test(text);
              });
            },
            { timeout: 8000 }
          );
        } catch {
          // タイムアウトしても続行（一部オッズが表示されていない場合）
        }

        // DOMからオッズを抽出
        const oddsData = await page.evaluate(() => {
          const result: Record<number, { odds: number; popularity: number }> = {};
          
          // オッズページの構造: table.RaceOdds_HorseList_Table 内の tr
          // 各 tr: td[1]=枠, td[2]=馬番, ... td[最後付近]=オッズ
          // オッズは td.Odds > span.Odds に表示される
          const table = document.querySelector('.RaceOdds_HorseList_Table, table');
          if (!table) return result;
          
          const rows = table.querySelectorAll('tr');
          rows.forEach(row => {
            const tds = row.querySelectorAll('td');
            if (tds.length < 3) return; // ヘッダー行スキップ
            
            // 馬番: 2番目のtd（1番目は枠番）
            const numText = tds[1]?.textContent?.trim() || '';
            const num = parseInt(numText);
            if (!num || num <= 0 || num > 18) return;
            
            // オッズ: td.Odds > span.Odds（最後のtdの近く）
            const oddsEl = row.querySelector('td.Odds span.Odds, td.Odds, .Odds');
            if (!oddsEl) return;
            const oddsText = oddsEl.textContent?.trim() || '';
            const odds = parseFloat(oddsText);
            if (!isFinite(odds) || odds <= 0) return;

            result[num] = { odds, popularity: 0 };
          });

          return result;
        });

        // entries に注入
        let raceOddsCount = 0;
        const oddsEntries = Object.entries(oddsData);

        // 人気が取れていない場合、オッズ順で計算
        if (oddsEntries.length > 0) {
          const sorted = oddsEntries
            .map(([num, d]) => ({ num: parseInt(num), ...d }))
            .sort((a, b) => a.odds - b.odds);

          for (const entry of race.entries) {
            const idx = sorted.findIndex(s => s.num === entry.num);
            if (idx >= 0) {
              entry.odds = sorted[idx].odds;
              entry.popularity = sorted[idx].popularity > 0 ? sorted[idx].popularity : idx + 1;
              raceOddsCount++;
            }
          }
        }

        if (raceOddsCount > 0) {
          updatedCount++;
          oddsCount += raceOddsCount;
        } else {
          failedRaces.push(`${race.raceNumber || '?'}R ${race.raceName || raceId}`);
        }
      } catch (e: any) {
        failedRaces.push(`${race.raceNumber || '?'}R ${race.raceName || raceId}: ${e.message?.substring(0, 50)}`);
      }

      // レース間隔（レート制限対策）
      await sleep(500);
    }

    // entries.jsonを上書き保存
    fs.writeFileSync(entriesPath, JSON.stringify(entriesData, null, 2), 'utf-8');

    // predictions.jsonを削除 → 次回のpredict呼び出しで再生成される
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
      failedRaces: failedRaces.length > 0 ? failedRaces : undefined,
      message: status === 'complete'
        ? `✅ 全${races.length}レースのオッズを取得しました（計${oddsCount}頭分）`
        : status === 'partial'
          ? `⚠️ ${updatedCount}/${races.length}レースのオッズを取得（計${oddsCount}頭分）`
          : `❌ オッズを取得できませんでした`,
    });
  } catch (error: any) {
    console.error('Refresh odds error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    // ブラウザを確実に閉じる
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
