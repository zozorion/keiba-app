/**
 * netkeiba スクレイパー
 * 出走表と結果を一括取得して weekly/ に保存
 * 
 * Usage: node --experimental-modules scripts/scrape-weekend.mjs 2026-05-02 2026-05-03
 */

import https from 'https';
import http from 'http';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// 会場設定
const WEEKEND_CONFIG = {
  '2026-04-25': {
    venues: [
      { name: '東京', code: '05', kai: '02', nichi: '01' },
      { name: '京都', code: '08', kai: '03', nichi: '01' },
      { name: '福島', code: '03', kai: '01', nichi: '05' },
    ]
  },
  '2026-04-26': {
    venues: [
      { name: '東京', code: '05', kai: '02', nichi: '02' },
      { name: '京都', code: '08', kai: '03', nichi: '02' },
      { name: '福島', code: '03', kai: '01', nichi: '06' },
    ]
  },
  '2026-05-02': {
    venues: [
      { name: '東京', code: '05', kai: '02', nichi: '03' },
      { name: '京都', code: '08', kai: '03', nichi: '03' },
      { name: '新潟', code: '04', kai: '01', nichi: '01' },
    ]
  },
  '2026-05-03': {
    venues: [
      { name: '東京', code: '05', kai: '02', nichi: '04' },
      { name: '京都', code: '08', kai: '03', nichi: '04' },
      { name: '新潟', code: '04', kai: '01', nichi: '02' },
    ]
  }
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cookie jar for netkeiba login session
let sessionCookies = '';

/**
 * dotenvから環境変数を読み込む（.env.local対応）
 */
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[2]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

/**
 * netkeibaにログイン（プレミアム会員）
 */
async function loginNetkeiba() {
  const loginId = process.env.NETKEIBA_LOGIN_ID;
  const password = process.env.NETKEIBA_PASSWORD;
  if (!loginId || !password) {
    console.error('  ❌ netkeibaログイン情報が未設定です。');
    console.error('     .env.local に NETKEIBA_LOGIN_ID と NETKEIBA_PASSWORD を設定してください。');
    process.exit(1);
  }

  console.log('  🔑 netkeibaにログイン中...');
  const postData = `login_id=${encodeURIComponent(loginId)}&pswd=${encodeURIComponent(password)}`;

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'regist.netkeiba.com',
      path: '/account/?pid=login&action=auth',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://regist.netkeiba.com/account/?pid=login',
      }
    }, (res) => {
      // Set-Cookieからセッションcookieを取得
      const cookies = res.headers['set-cookie'] || [];
      sessionCookies = cookies.map(c => c.split(';')[0]).join('; ');

      // リダイレクト先は関係なく、cookieが取れれば成功
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (sessionCookies && sessionCookies.includes('nkauth')) {
          console.log('  ✅ ログイン成功');
          resolve(true);
        } else {
          console.log('  ⚠️ ログイン不確定（cookie取得不完全）→ 非ログインモードで続行');
          resolve(false);
        }
      });
    });
    req.on('error', (e) => {
      console.log(`  ❌ ログインエラー: ${e.message} → 非ログインモードで続行`);
      resolve(false);
    });
    req.write(postData);
    req.end();
  });
}

function fetchUrl(url, encoding = 'euc-jp') {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      }
    };
    // ログイン済みならcookieを付与
    if (sessionCookies) {
      options.headers['Cookie'] = sessionCookies;
    }

    const req = client.get(options, (res) => {
      // リダイレクト対応
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${parsedUrl.hostname}${res.headers.location}`;
        return fetchUrl(redirectUrl, encoding).then(resolve).catch(reject);
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const html = encoding === 'utf-8'
          ? buffer.toString('utf-8')
          : iconv.decode(buffer, encoding);
        resolve(html);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * 出走表をスクレイピング
 */
async function scrapeShutuba(raceId) {
  const url = `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
  try {
    const html = await fetchUrl(url);
    const $ = cheerio.load(html);

    const raceName = $('.RaceName').text().trim() || '不明';
    const raceData1 = $('.RaceData01').text().trim() || '';
    const raceData2 = $('.RaceData02').text().trim() || '';

    // 芝/ダート判定
    let surface = '不明';
    if (raceData1.includes('芝')) surface = '芝';
    else if (raceData1.includes('ダ')) surface = 'ダート';
    else if (raceData1.includes('障')) surface = '障害';

    // 距離
    const distMatch = raceData1.match(/(\d{3,4})m/);
    const distance = distMatch ? parseInt(distMatch[1]) : 0;

    // 発走時刻
    const timeMatch = raceData1.match(/(\d{1,2}:\d{2})/);
    const postTime = timeMatch ? timeMatch[1] : '';

    // 馬場状態
    let condition = '良';
    if (raceData1.includes('稍')) condition = '稍重';
    else if (raceData1.includes('重') && !raceData1.includes('稍')) condition = '重';
    else if (raceData1.includes('不良')) condition = '不良';

    // 天候
    let weather = '晴';
    if (raceData1.includes('曇')) weather = '曇';
    else if (raceData1.includes('雨')) weather = '雨';
    else if (raceData1.includes('雪')) weather = '雪';

    // グレード判定
    let grade = undefined;
    if (raceData2.includes('G1') || raceData2.includes('GⅠ') || raceName.includes('G1')) grade = 'G1';
    else if (raceData2.includes('G2') || raceData2.includes('GⅡ')) grade = 'G2';
    else if (raceData2.includes('G3') || raceData2.includes('GⅢ')) grade = 'G3';
    else if (raceData2.includes('(L)') || raceData2.includes('リステッド')) grade = 'リステッド';
    else if (raceData2.includes('オープン') || raceData2.includes('OP')) grade = 'OP';

    // 出走馬
    const entries = [];
    $('tr.HorseList').each((_, row) => {
      const $row = $(row);
      const wakuTd = $row.find("td[class*='Waku'] span").first();
      const frame = wakuTd.length ? parseInt(wakuTd.text().trim()) || 0 : 0;

      const umabanTd = $row.find("td[class*='Umaban']").first();
      const num = umabanTd.length ? parseInt(umabanTd.text().trim()) || 0 : 0;

      const nameEl = $row.find('.HorseName a').first();
      const name = nameEl.length ? nameEl.text().trim() : '';

      const barei = $row.find('.Barei').first();
      const sex = barei.length ? barei.text().trim() : '';

      const jw = $row.find('.JockeyWeight').first();
      let weightCarry = 57.0;
      try { weightCarry = parseFloat(jw.text().trim()) || 57.0; } catch {}

      const jockeyEl = $row.find('.Jockey a').first();
      const jockey = jockeyEl.length ? jockeyEl.text().trim() : '';

      const trainerEl = $row.find('.Trainer a').first();
      const trainer = trainerEl.length ? trainerEl.text().trim() : '';

      // v5: オッズ取得（出走表ページに単勝オッズが表示されている場合）
      const oddsEl = $row.find('.Odds span, .Popular span, td.Odds, .Txt_C.Odds').first();
      let odds = 0;
      try { odds = parseFloat(oddsEl.text().trim()) || 0; } catch {}
      
      // 人気順位
      const popEl = $row.find('.Popular span:last-child, .PopularRank, td.Popular').first();
      let popularity = 0;
      try { popularity = parseInt(popEl.text().trim()) || 0; } catch {}

      // 父馬名（種牡馬分析用）
      const sireEl = $row.find('.B_Left .horse_info td:nth-child(1), .Sire, .HorseInfo td').first();
      const sire = sireEl.length ? sireEl.text().trim().replace(/父：|父:/, '') : '';

      if (num > 0 && name) {
        const entry = { frame, num, name, sex, weightCarry, jockey, trainer };
        if (odds > 0) entry.odds = odds;
        if (popularity > 0) entry.popularity = popularity;
        if (sire) entry.sire = sire;
        entries.push(entry);
      }
    });

    // 競馬場名を race_id から逆引き
    const venueCode = raceId.substring(4, 6);
    const venueNames = {
      '01': '札幌', '02': '函館', '03': '福島', '04': '新潟',
      '05': '東京', '06': '中山', '07': '中京', '08': '京都',
      '09': '阪神', '10': '小倉',
    };
    const courseName = venueNames[venueCode] || '不明';
    const raceNumber = parseInt(raceId.substring(10, 12)) || 0;

    return {
      raceId, raceName, raceData: raceData1, surface, distance, condition,
      weather, courseName, courseCode: venueCode, raceNumber, postTime,
      grade, entries,
    };
  } catch (e) {
    console.error(`  ERROR scraping ${raceId}:`, e.message);
    return null;
  }
}

/**
 * 馬柱ページから脚質・前走データを取得
 * race.netkeiba.com/race/shutuba_past.html (EUC-JP)
 */
async function scrapePastData(raceId) {
  const url = `https://race.netkeiba.com/race/shutuba_past.html?race_id=${raceId}`;
  try {
    const html = await fetchUrl(url); // EUC-JPデフォルト
    const $ = cheerio.load(html);

    const horsePastData = {};

    $('tr.HorseList').each((_, row) => {
      const $row = $(row);

      // 馬番取得
      const umabanTd = $row.find("td.Umaban, td[class*='Umaban']").first();
      const num = umabanTd.length ? parseInt(umabanTd.text().trim()) || 0 : 0;
      if (num === 0) return;

      // 脚質（逃・先・差・追）— HorseInfo セル内から取得
      const horseInfo = $row.find('td.HorseInfo, td[class*="HorseInfo"]').first();
      const infoText = horseInfo.length ? horseInfo.text() : $row.text();
      let runningStyle = '';
      // 脚質は「逃」「先」「差」「追」の1文字で表示される
      // ただし馬名等に含まれる場合があるので、HorseInfoセルに限定
      const styleMatch = infoText.match(/[（(]?(逃|先行|先|差し|差|追込|追)[）)]?/);
      if (styleMatch) {
        const s = styleMatch[1];
        if (s === '逃') runningStyle = '逃げ';
        else if (s === '先行' || s === '先') runningStyle = '先行';
        else if (s === '差し' || s === '差') runningStyle = '差し';
        else if (s === '追込' || s === '追') runningStyle = '追込';
      }

      // 前走データ — td.Past1 〜 td.Past5
      const pastRaces = [];
      for (let i = 1; i <= 5; i++) {
        const pastTd = $row.find(`td.Past${i}, td[class*="Past${i}"]`).first();
        if (!pastTd.length) continue;
        const pastText = pastTd.text();

        // 着順（数字＋着）
        const finishMatch = pastText.match(/(\d{1,2})着/);
        const finish = finishMatch ? parseInt(finishMatch[1]) : 0;

        // 通過順 "2-2" or "1-1-1-1" パターン
        const passMatch = pastText.match(/(\d{1,2}-\d{1,2}(?:-\d{1,2}){0,2})/);
        const passingOrder = passMatch ? passMatch[1] : '';

        // 上り3F "(33.5)" or "(38.4)" パターン
        const last3fMatch = pastText.match(/\((\d{2}\.\d)\)/);
        const last3f = last3fMatch ? parseFloat(last3fMatch[1]) : 0;

        if (finish > 0) {
          pastRaces.push({ finish, passingOrder, last3f });
        }
      }

      horsePastData[num] = {
        num,
        runningStyle,
        pastRaces,
      };
    });

    return horsePastData;
  } catch (e) {
    // 馬柱ページ取得失敗は致命的でない → 空で返す
    return {};
  }
}

/**
 * レース結果をスクレイピング（db.netkeiba.com 使用）
 */
async function scrapeResult(raceId) {
  const url = `https://db.netkeiba.com/race/${raceId}/`;
  try {
    const html = await fetchUrl(url);
    const $ = cheerio.load(html);

    const results = [];
    // db.netkeibaの結果テーブル
    $('table.race_table_01 tr').each((idx, row) => {
      if (idx === 0) return; // ヘッダースキップ
      const $row = $(row);
      const tds = $row.find('td');
      if (tds.length < 18) return;

      // db.netkeiba列構成:
      // 0:着順, 1:枠, 2:馬番, 3:馬名, 4:性齢, 5:斤量, 6:騎手
      // 7:タイム, 8:着差, ...14:通過順, 15:上り3F, 16:単勝オッズ, 17:人気
      const finish = parseInt($(tds[0]).text().trim()) || 0;
      const frame = parseInt($(tds[1]).text().trim()) || 0;
      const num = parseInt($(tds[2]).text().trim()) || 0;
      const name = $(tds[3]).find('a').text().trim() || $(tds[3]).text().trim();
      const jockey = $(tds[6]).find('a').text().trim() || $(tds[6]).text().trim();
      const time = $(tds[7]).text().trim();
      const passingOrder = $(tds[14]).text().trim(); // "1-1-1-1" 形式
      const last3f = parseFloat($(tds[15]).text().trim()) || 0;
      const odds = parseFloat($(tds[16]).text().trim()) || 0;
      const pop = parseInt($(tds[17]).text().trim()) || 0;

      if (finish > 0 && num > 0) {
        results.push({ finish, frame, num, name, jockey, time, passingOrder, last3f, odds, popularity: pop });
      }
    });

    // 払い戻しデータ（構造化）
    const payouts = {};
    $('table.pay_table_01 tr').each((_, row) => {
      const $row = $(row);
      const label = $row.find('th').first().text().trim();
      const tds = $row.find('td');
      if (!label || tds.length < 2) return;

      // 各tdの中身をbrで分割して配列化
      const combTexts = $(tds[0]).html()?.split(/<br\s*\/?>/i).map(s => cheerio.load(s).text().trim()).filter(Boolean) || [];
      const amountTexts = $(tds[1]).html()?.split(/<br\s*\/?>/i).map(s => cheerio.load(s).text().trim().replace(/,/g, '')).filter(Boolean) || [];
      const popTexts = tds.length >= 3 ? ($(tds[2]).html()?.split(/<br\s*\/?>/i).map(s => cheerio.load(s).text().trim()).filter(Boolean) || []) : [];

      const entries = [];
      for (let i = 0; i < combTexts.length; i++) {
        entries.push({
          combination: combTexts[i],
          amount: parseInt(amountTexts[i]) || 0,
          popularity: parseInt(popTexts[i]) || 0,
        });
      }

      payouts[label] = entries;
    });

    return { raceId, results, payouts };
  } catch (e) {
    console.error(`  ERROR scraping result ${raceId}:`, e.message);
    return null;
  }
}

/**
 * netkeibaのレース一覧から開催会場・レースIDを自動検出
 */
async function autoDetectVenues(date) {
  const url = `https://db.netkeiba.com/race/list/${date.replace(/-/g, '')}/`;
  console.log(`  🔍 開催情報を自動検出中: ${url}`);
  
  try {
    const html = await fetchUrl(url);
    const $ = cheerio.load(html);
    
    // レースIDのリンクを収集
    const raceIds = new Set();
    $('a[href*="/race/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/\/race\/(\d{12})\//);
      if (match) raceIds.add(match[1]);
    });
    
    if (raceIds.size === 0) {
      console.log('  ⚠️ レースが見つかりませんでした');
      return null;
    }
    
    // レースIDから会場を分類
    // レースID構造: YYYY[場コード2桁][回2桁][日2桁][Rnum2桁]
    const venueMap = new Map();
    const VENUE_NAMES = {
      '01': '札幌', '02': '函館', '03': '福島', '04': '新潟',
      '05': '東京', '06': '中山', '07': '中京', '08': '京都',
      '09': '阪神', '10': '小倉',
    };
    
    for (const raceId of raceIds) {
      const venueCode = raceId.substring(4, 6);
      // JRA10場のみ（01〜10）。地方競馬（30以上）は除外
      if (!VENUE_NAMES[venueCode]) continue;
      
      const kai = raceId.substring(6, 8);
      const nichi = raceId.substring(8, 10);
      const key = `${venueCode}_${kai}_${nichi}`;
      
      if (!venueMap.has(key)) {
        venueMap.set(key, {
          name: VENUE_NAMES[venueCode],
          code: venueCode,
          kai: kai,
          nichi: nichi,
          raceIds: [],
        });
      }
      venueMap.get(key).raceIds.push(raceId);
    }
    
    const venues = [...venueMap.values()].map(v => ({
      name: v.name,
      code: v.code,
      kai: v.kai,
      nichi: v.nichi,
    }));
    
    console.log(`  ✅ ${venues.length}会場検出: ${venues.map(v => v.name).join('、')}`);
    return { venues };
  } catch (e) {
    console.error(`  ❌ 自動検出失敗: ${e.message}`);
    return null;
  }
}

/**
 * メイン処理
 */
async function main() {
  const dates = process.argv.slice(2);
  if (dates.length === 0) {
    // 日付指定なし → 今日の日付
    const today = new Date().toISOString().slice(0, 10);
    console.log(`日付未指定 → 今日の日付 (${today}) を使用`);
    dates.push(today);
  }

  // netkeiba ログイン試行
  await loginNetkeiba();

  for (const date of dates) {
    // まず手動設定を確認、なければ自動検出
    let config = WEEKEND_CONFIG[date];
    if (!config) {
      console.log(`\n  📋 ${date} の手動設定なし → 自動検出を試行`);
      await sleep(500);
      config = await autoDetectVenues(date);
      if (!config) {
        console.log(`  ⏭️ ${date} をスキップ`);
        continue;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${date} データ取得`);
    console.log(`${'='.repeat(60)}`);

    const weeklyDir = path.join(DATA_DIR, 'weekly', date);
    fs.mkdirSync(weeklyDir, { recursive: true });

    const allRaces = [];
    const allResults = [];

    for (const venue of config.venues) {
      console.log(`\n  📍 ${venue.name}競馬場`);

      for (let rNum = 1; rNum <= 12; rNum++) {
        const raceId = `2026${venue.code}${venue.kai}${venue.nichi}${String(rNum).padStart(2, '0')}`;
        process.stdout.write(`    [${rNum}R] ${raceId} ... `);

        // 出走表
        const raceInfo = await scrapeShutuba(raceId);
        if (raceInfo && raceInfo.entries.length > 0) {
          console.log(`${raceInfo.raceName} ${raceInfo.surface}${raceInfo.distance}m (${raceInfo.entries.length}頭)`);
          allRaces.push(raceInfo);
        } else {
          console.log('SKIP');
        }

        await sleep(800);

        // 結果
        const result = await scrapeResult(raceId);
        if (result && result.results.length > 0) {
          allResults.push(result);
        }

        await sleep(500);
      }
    }

    // 保存
    const entriesPath = path.join(weeklyDir, 'entries.json');
    fs.writeFileSync(entriesPath, JSON.stringify({ date, races: allRaces }, null, 2), 'utf-8');
    console.log(`\n  ✅ 出走表保存: ${entriesPath} (${allRaces.length}レース)`);

    const resultsPath = path.join(weeklyDir, 'results.json');
    fs.writeFileSync(resultsPath, JSON.stringify({ date, results: allResults }, null, 2), 'utf-8');
    console.log(`  ✅ 結果保存: ${resultsPath} (${allResults.length}レース)`);
  }

  console.log('\n🏁 完了!');
}

main().catch(console.error);
