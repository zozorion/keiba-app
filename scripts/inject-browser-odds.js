// 京都のオッズを注入
const fs = require('fs');
const path = require('path');

const date = '2026-05-09';
const entriesPath = path.join(__dirname, '..', 'data', 'weekly', date, 'entries.json');

const browserOdds = {
  '202608030501': {1:223.7,2:81.1,3:13.9,4:8.9,5:4.8,6:191.1,7:6.3,8:95.3,10:4.5,11:186.0,12:325.1,13:48.4,14:7.3,15:3.5,16:257.9},
  '202608030502': {1:17.0,2:5.0,3:328.4,4:4.0,5:5.7,6:10.8,7:26.6,8:174.6,9:4.7,10:57.0,11:10.7,12:51.3,13:16.1,14:45.3,15:256.7},
  '202608030503': {1:87.4,2:138.0,3:2.3,4:240.1,5:166.4,6:3.0,7:233.1,8:39.4,9:426.0,10:7.9,11:19.9,12:9.9,13:567.6,14:13.9,15:15.8,16:64.5,17:250.6},
  '202608030504': {1:46.1,2:8.4,3:138.5,4:47.7,5:167.1,6:5.8,7:24.7,8:6.8,9:3.2,10:6.3,11:92.2,12:91.5,13:6.5,14:13.0,15:154.0},
  '202608030505': {1:17.6,2:6.1,3:3.2,4:8.8,5:11.2,6:8.1,7:3.2,8:11.5},
  '202608030506': {1:13.1,2:72.3,3:9.2,4:11.8,5:8.0,6:15.3,7:5.6,8:97.3,9:16.8,10:22.4,11:39.5,12:25.2,13:9.3,14:9.8,15:5.4,16:33.6},
  '202608030507': {1:18.4,2:58.7,3:6.1,4:27.7,5:3.3,6:19.3,7:64.0,8:7.0,9:33.1,10:27.5,11:2.4},
  '202608030508': {1:4.9,2:37.2,3:24.0,4:4.1,5:32.6,6:10.8,7:79.1,8:15.5,9:54.0,10:9.6,11:25.7,12:18.8,13:6.0,14:41.0,15:10.1,16:30.7},
  '202608030509': {1:12.7,2:25.4,3:13.4,4:43.9,5:18.9,6:3.5,7:3.9,8:3.4,9:44.7,10:18.2,11:12.6},
  '202608030510': {1:4.3,2:5.0,3:5.9,4:34.3,5:2.2,6:8.5,7:19.1,8:52.8},
  '202608030511': {1:11.9,2:4.5,3:97.3,4:103.5,5:15.0,6:42.7,7:66.3,8:15.0,9:30.7,10:18.3,11:147.7,12:25.0,13:97.0,14:137.6,15:1.8,16:15.1},
  '202608030512': {1:33.2,2:25.9,3:9.0,4:11.7,5:31.0,6:28.6,7:2.7,8:5.8,9:10.4,10:28.8,11:10.1,12:29.8,13:8.3},
};

function calcPopularity(oddsObj) {
  const sorted = Object.entries(oddsObj)
    .map(([num, odds]) => ({num: parseInt(num), odds}))
    .filter(x => x.odds > 0)
    .sort((a, b) => a.odds - b.odds);
  const result = {};
  sorted.forEach((item, idx) => {
    result[item.num] = {odds: item.odds, popularity: idx + 1};
  });
  return result;
}

const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
let updated = 0;
let horsesUpdated = 0;

for (const race of entriesData.races) {
  const raceOdds = browserOdds[race.raceId];
  if (!raceOdds) continue;
  
  const withPop = calcPopularity(raceOdds);
  for (const entry of race.entries) {
    const data = withPop[entry.num];
    if (data) {
      entry.odds = data.odds;
      entry.popularity = data.popularity;
      horsesUpdated++;
    }
  }
  updated++;
}

fs.writeFileSync(entriesPath, JSON.stringify(entriesData, null, 2), 'utf-8');

const predictionsPath = path.join(__dirname, '..', 'data', 'weekly', date, 'predictions.json');
if (fs.existsSync(predictionsPath)) fs.unlinkSync(predictionsPath);

console.log(`✅ 京都: ${updated}レース、${horsesUpdated}頭にオッズを注入`);

// 確認: 全レースのオッズ状況
const reloaded = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
let withOdds = 0, withoutOdds = 0;
for (const race of reloaded.races) {
  const hasOdds = race.entries.some(e => e.odds && e.odds > 0);
  if (hasOdds) withOdds++;
  else withoutOdds++;
}
console.log(`\n📊 全体: ${withOdds}/${reloaded.races.length}レースにオッズあり`);
