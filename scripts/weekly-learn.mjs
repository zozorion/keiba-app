/**
 * 週末自動学習バッチ
 * 
 * 毎週月曜（または手動）に実行。前週の結果を取得し、予測→学習→ログ記録の全フロー。
 * 
 * Usage:
 *   node scripts/weekly-learn.mjs               # 直近の土日を自動検出
 *   node scripts/weekly-learn.mjs 2026-05-03    # 特定日を指定
 * 
 * 前提:
 *   - Next.jsサーバーがlocalhost:3000で稼働中
 *   - NETKEIBA_LOGIN_ID / PASSWORD が .env.local に設定済み
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_DIR = path.join(DATA_DIR, 'learning-logs');

// ログディレクトリ作成
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** localhost:3000 へのHTTPリクエスト */
function apiCall(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: 3000, path, method,
      timeout: 120000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('タイムアウト')); });
    req.end();
  });
}

/** 直近の土日を算出 */
function getLastWeekendDates() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=日, 6=土
  const dates = [];
  
  // 直近の日曜日を求める
  const sunday = new Date(now);
  if (dayOfWeek === 0) {
    sunday.setDate(now.getDate() - 7); // 今日が日曜なら先週
  } else {
    sunday.setDate(now.getDate() - dayOfWeek);
  }
  
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() - 1);
  
  const fmt = d => d.toISOString().split('T')[0];
  return [fmt(saturday), fmt(sunday)];
}

async function main() {
  console.log('🧠 週末自動学習バッチ v1.0');
  console.log('─'.repeat(50));
  
  // 対象日の決定
  let targetDates = process.argv.slice(2);
  if (targetDates.length === 0) {
    targetDates = getLastWeekendDates();
    console.log(`📅 自動検出: ${targetDates.join(', ')}`);
  } else {
    console.log(`📅 指定日: ${targetDates.join(', ')}`);
  }

  const log = {
    runAt: new Date().toISOString(),
    dates: targetDates,
    steps: [],
    results: {},
    errors: [],
  };

  for (const date of targetDates) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  📅 ${date} を処理中...`);
    console.log(`${'='.repeat(50)}`);

    const dateLog = { date, predict: null, learn: null, roi: null };

    // Step 1: 予測生成
    try {
      console.log('  1️⃣  予測生成...');
      const pred = await apiCall(`/api/predict?date=${date}`);
      const predCount = pred?.predictions?.length || 0;
      dateLog.predict = { success: true, races: predCount };
      console.log(`     ✅ ${predCount}R の予測を生成`);
    } catch (e) {
      dateLog.predict = { success: false, error: e.message };
      console.log(`     ❌ 予測生成失敗: ${e.message}`);
      log.errors.push(`${date} 予測: ${e.message}`);
    }
    await sleep(1000);

    // Step 2: 学習実行
    try {
      console.log('  2️⃣  学習実行...');
      const learn = await apiCall(`/api/learn?date=${date}`, 'POST');
      if (learn.success) {
        const venues = learn.venueResults?.map(v => `${v.venue}(${v.racesCount}R)`) || [];
        dateLog.learn = { success: true, venues };
        console.log(`     ✅ 学習完了: ${venues.join(', ')}`);
      } else {
        dateLog.learn = { success: false, error: learn.error };
        console.log(`     ⚠️ 学習スキップ: ${learn.error}`);
      }
    } catch (e) {
      dateLog.learn = { success: false, error: e.message };
      console.log(`     ❌ 学習失敗: ${e.message}`);
      log.errors.push(`${date} 学習: ${e.message}`);
    }
    await sleep(1000);

    // Step 3: ROI検証
    try {
      console.log('  3️⃣  ROI検証...');
      const results = await apiCall(`/api/results?date=${date}`);
      if (results.totalStats) {
        dateLog.roi = {
          total: results.totalStats.total,
          wideROI: results.totalStats.wideROI,
          filteredTotal: results.filteredStats?.total,
          filteredWideROI: results.filteredStats?.wideROI,
        };
        console.log(`     ✅ 全${results.totalStats.total}R W-ROI=${results.totalStats.wideROI}%`);
        console.log(`        推奨${results.filteredStats?.total}R W-ROI=${results.filteredStats?.wideROI}%`);
      }
    } catch (e) {
      console.log(`     ⚠️ ROI取得失敗: ${e.message}`);
    }

    log.results[date] = dateLog;
  }

  // ログ保存
  const logFilename = `learn-${targetDates[0]}.json`;
  const logPath = path.join(LOG_DIR, logFilename);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ 学習バッチ完了！`);
  console.log(`📝 ログ: data/learning-logs/${logFilename}`);
  
  if (log.errors.length > 0) {
    console.log(`⚠️ エラー: ${log.errors.length}件`);
    log.errors.forEach(e => console.log(`   - ${e}`));
  }
}

main().catch(e => {
  console.error('❌ バッチ失敗:', e);
  process.exit(1);
});
