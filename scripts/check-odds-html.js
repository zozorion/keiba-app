const https = require('https');
const cheerio = require('cheerio');

const raceId = '202605020510'; // 青竜S（API middleだったレース）

function fetchOddsForm(raceId) {
  return new Promise((resolve) => {
    const url = `https://race.netkeiba.com/odds/odds_get_form.html?race_id=${raceId}&type=b1&jession=`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://race.netkeiba.com/odds/index.html?race_id=${raceId}&type=b1`,
        'X-Requested-With': 'XMLHttpRequest',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', () => resolve(''));
  });
}

async function main() {
  const html = await fetchOddsForm(raceId);
  console.log('HTML length:', html.length);
  
  const ch = cheerio.load(html);
  
  // Look for odds table rows
  const rows = ch('tr');
  console.log('TR rows:', rows.length);
  
  // Find all elements with odds-like numbers
  ch('td').each((i, td) => {
    const cls = ch(td).attr('class') || '';
    const txt = ch(td).text().trim();
    if (/\d+\.\d/.test(txt) || /Odds/.test(cls) || /Ninki/.test(cls)) {
      console.log(`  td class="${cls}" text="${txt.substring(0,50)}"`);
    }
  });
  
  // Also check for specific patterns
  console.log('\n--- Searching for Odds patterns ---');
  ch('[class*="Odds"], [class*="Tan"]').each((i, el) => {
    if (i > 20) return;
    const tag = ch(el).prop('tagName');
    const cls = ch(el).attr('class') || '';
    const txt = ch(el).text().trim().substring(0, 60);
    console.log(`  ${tag} class="${cls}" text="${txt}"`);
  });
}

main();
