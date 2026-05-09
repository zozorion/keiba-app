// Puppeteerでnetkeibaオッズ取得をデバッグ
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

async function main() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,  // falseにすると可視化できる
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

  const raceId = '202605020510'; // 青竜S
  const url = `https://race.netkeiba.com/odds/index.html?race_id=${raceId}&type=b1`;
  
  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  
  console.log('Page title:', await page.title());
  
  // ページのHTMLの一部をチェック
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('\nBody text (first 500):', bodyText);
  
  // Oddsクラスの要素を探す
  const oddsElements = await page.evaluate(() => {
    const els = document.querySelectorAll('.Odds');
    return Array.from(els).slice(0, 10).map(el => ({
      tag: el.tagName,
      class: el.className,
      text: el.textContent?.trim(),
    }));
  });
  console.log('\n.Odds elements:', JSON.stringify(oddsElements, null, 2));
  
  // テーブル行を探す
  const rows = await page.evaluate(() => {
    const trs = document.querySelectorAll('tr');
    return Array.from(trs).slice(0, 5).map(tr => ({
      class: tr.className,
      text: tr.textContent?.trim().substring(0, 100),
    }));
  });
  console.log('\nTable rows:', JSON.stringify(rows, null, 2));
  
  // スクリーンショット
  const ssPath = path.join(__dirname, 'debug-odds-screenshot.png');
  await page.screenshot({ path: ssPath, fullPage: false });
  console.log('\nScreenshot saved to:', ssPath);
  
  await browser.close();
}

main().catch(console.error);
