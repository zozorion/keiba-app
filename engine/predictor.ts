/**
 * 競馬予想エンジン — 統合予想（Predictor）
 * 
 * 出走表データ + 過去データ + 分析JSONを組み合わせて予想を生成する。
 * 全てのデータは事実に基づき、推定・推測は一切含まない。
 */

import {
  scoreHorse, selectPivotHorse, generateBetRecommendations, shouldPost
} from './scoring';
import {
  loadSireMap, loadAnalyzedData, getHorseHistory
} from './data-loader';
import type {
  RaceInfo, EntryHorse, ScoredHorse, PredictionResult,
  AnalyzedData, ConditionData, CheckCard, VENUE_MAP
} from './types';

const VENUE_MAP_LOCAL: Record<string, string> = {
  '札幌': 'sapporo', '函館': 'hakodate', '福島': 'fukushima',
  '新潟': 'niigata', '東京': 'tokyo', '中山': 'nakayama',
  '中京': 'chukyo', '京都': 'kyoto', '阪神': 'hanshin', '小倉': 'kokura',
};

/**
 * 単一レースの予想を生成
 */
export function predictRace(race: RaceInfo, raceDate: number): PredictionResult {
  const sireMap = loadSireMap();

  // 競馬場名からディレクトリ名を取得
  const courseNameEn = VENUE_MAP_LOCAL[race.courseName] || race.courseName.toLowerCase();
  const surfaceKey = race.surface === '芝' ? 'turf' : 'dirt';

  // 分析データ読み込み
  const analysisData = loadAnalyzedData(courseNameEn, surfaceKey, race.distance);

  // 馬場条件に応じた分析データを選択
  let conditionData: ConditionData | null = null;
  if (analysisData) {
    const isWet = ['稍重', '重', '不良'].includes(race.condition);
    conditionData = analysisData.conditions[isWet ? 'wet' : 'good'] 
                    ?? analysisData.conditions['good'] 
                    ?? null;
  }

  // チェックカード (snake_case: check_card)
  const rawCheckCard = (conditionData as any)?.check_card ?? (conditionData as any)?.checkCard;
  const checkCard: CheckCard = rawCheckCard ?? {
    condition: race.condition,
    tips: ['⚠️ この条件の分析データなし'],
    frameSummary: '不明',
    styleSummary: '不明',
    sireSummary: '不明',
  };

  // 各出走馬をスコアリング
  const scoredHorses: ScoredHorse[] = race.entries.map(entry => {
    // 種牡馬マッチング
    const sire = sireMap.get(entry.name) || entry.sire || undefined;
    const entryWithSire: EntryHorse = { ...entry, sire };

    // 過去成績取得
    const history = getHorseHistory(entry.name, raceDate);

    return scoreHorse(
      entryWithSire,
      history,
      conditionData,
      race.distance,
      race.courseName,
      surfaceKey,
      race.condition,
      raceDate,
      courseNameEn  // v3: 競馬場別チューニング用
    );
  });

  // スコア順にソート
  const sorted = [...scoredHorses].sort((a, b) => b.score - a.score);

  // 軸馬選定（v5: 競馬場プロファイルの戦略に基づく）
  const pivotHorse = selectPivotHorse(scoredHorses, race.courseName);

  // 買い目生成（v5: 競馬場プロファイルから頭数別ワイド相手数を取得）
  const recommendations = generateBetRecommendations(scoredHorses, 5, race.courseName);

  // 重賞判定
  const isGraded = !!(race.grade && ['G1', 'G2', 'G3', 'OP', 'リステッド'].includes(race.grade));

  // 期待値レベル算出
  // スコア上位と人気の乖離が大きいほど高い
  let expectationLevel = pivotHorse.expectationScore;
  if (pivotHorse.popularity && pivotHorse.popularity >= 5 && pivotHorse.score >= 75) {
    // 人気薄なのにスコアが高い → 期待値が高い
    expectationLevel = Math.min(100, expectationLevel + 10);
  }

  // v3: 期待値ベースのレース選別
  // 賭けるべきでないレースを識別（ROI最大化のため）
  const skipReasons: string[] = [];
  
  // 1. 軸馬スコアが低すぎる（信頼度不足）
  // v5: プロファイル調整でスコア分布が変化したため52ptに緩和
  if (pivotHorse.score < 52) {
    skipReasons.push(`軸馬スコア低(${pivotHorse.score}pt)`);
  }
  
  // 2. 出走頭数が少なすぎる（ただし競馬場プロファイルで少頭数除外を設定していない場合はスキップしない）
  // v5: 分析の結果、少頭数は全競馬場で好成績なのでスキップしない
  // （以前は7頭以下をスキップしていたが、中山63%/阪神71%/京都67%の好成績データから撤廃）
  if (race.entries.length <= 4) {
    skipReasons.push(`極少頭数(${race.entries.length}頭)`);
  }
  // 3. 軸馬が圧倒的1番人気（配当が低い＝ROI期待値低い）
  if (pivotHorse.popularity === 1 && pivotHorse.odds && pivotHorse.odds < 2.0) {
    skipReasons.push('低配当(1番人気/2倍未満)');
  }

  const shouldBet = skipReasons.length === 0;

  const postDecision = shouldPost({ grade: race.grade, expectationLevel });

  return {
    race,
    scoredHorses: sorted,
    pivotHorse,
    expectationLevel,
    isGraded,
    isHighConfidence: postDecision.postToX,
    recommendations,
    checkCard,
    shouldBet,
    skipReasons,
  };
}

/**
 * 複数レースの予想を一括生成
 */
export function predictAllRaces(
  races: RaceInfo[],
  raceDate: number
): PredictionResult[] {
  return races.map(race => predictRace(race, raceDate));
}

/**
 * 日付文字列 (YYYY-MM-DD) → YYYYMMDD数値変換
 */
export function dateToInt(dateStr: string): number {
  return parseInt(dateStr.replace(/-/g, ''), 10);
}
