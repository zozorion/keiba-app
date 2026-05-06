/**
 * 競馬場プロファイルシステム
 * 
 * 10日336Rの深層分析から導出された、各競馬場固有のスコアリング調整。
 * 全競馬場で同じロジックを使うのではなく、データが示す特徴に基づいて
 * 要素の重み・軸選定ルール・フィルター閾値を個別に最適化する。
 */

export interface VenueProfile {
  name: string;

  // === 要素重み調整（基本の乗数。1.0=デフォルト） ===
  sireMultiplier: number;         // 種牡馬スコアの倍率
  jockeyMultiplier: number;       // 騎手スコアの倍率
  trainerMultiplier: number;      // 厩舎スコアの倍率
  frameMultiplier: number;        // 枠順スコアの倍率
  distanceMultiplier: number;     // 距離実績の倍率
  courseMultiplier: number;       // コース実績の倍率

  // === 芝/ダート別調整 ===
  turfAdjust: number;             // 芝レースでのスコア加減（全体）
  dirtAdjust: number;             // ダートレースでのスコア加減

  // === 頭数別ワイド相手数 ===
  widePartnersSmall: number;      // ≤10頭
  widePartnersMedium: number;     // 11-14頭
  widePartnersLarge: number;      // 15頭+

  // === 軸選定ルール ===
  pivotStrategy: 'score_top' | 'value_top' | 'hybrid';
  // score_top: スコア最上位を軸（デフォルト）
  // value_top: スコア/人気の乖離が大きい馬を軸（穴狙い型）
  // hybrid: スコアtop3の中でオッズ妙味が最も高い馬を軸

  // === longshot制限 ===
  maxPivotOdds: number;           // 軸馬のオッズ上限。超えたら2位を軸に

  // === 距離帯別信頼度（スコアに乗算） ===
  distanceTrust: {
    sprint: number;   // ≤1200m
    mile: number;     // 1201-1600m
    middle: number;   // 1601-2000m
    long: number;     // 2001m+
  };

  // === フィルター調整 ===
  skipSmallField: boolean;        // 少頭数をスキップするか
}

/**
 * 競馬場別プロファイル定義
 * データ根拠: 2026年4/4〜5/3の10開催336Rの実績分析
 */
export const VENUE_PROFILES: Record<string, VenueProfile> = {
  '東京': {
    name: '東京',
    // 騎手の寄与差+0.7で全会場最高。ファボリット80%なので王道で勝てる
    sireMultiplier: 1.0,
    jockeyMultiplier: 1.5,     // 騎手重視（データ根拠: 的中差+0.7）
    trainerMultiplier: 1.0,
    frameMultiplier: 0.8,       // 広いコースなので枠の影響は少なめ
    distanceMultiplier: 1.0,
    courseMultiplier: 1.0,
    turfAdjust: 0,
    dirtAdjust: 0,
    widePartnersSmall: 4,
    widePartnersMedium: 5,
    widePartnersLarge: 5,
    pivotStrategy: 'score_top',  // 王道型（ファボリット軸80%）
    maxPivotOdds: 30,
    distanceTrust: {
      sprint: 1.0,
      mile: 1.0,
      middle: 1.1,              // 中距離50%的中で最強
      long: 0.85,               // 長距離14%と弱い → やや信頼度下げ
    },
    skipSmallField: false,
  },

  '中山': {
    name: '中山',
    // 全要素の寄与差がほぼゼロ → スコアリング自体が効いていない
    // 少頭数63%が唯一の強み。多頭数12%が致命的
    sireMultiplier: 0.9,        // 種牡馬の寄与がほぼ差なし → やや下げ
    jockeyMultiplier: 1.0,
    trainerMultiplier: 1.0,
    frameMultiplier: 1.2,       // 小回り → 内枠有利
    distanceMultiplier: 1.0,
    courseMultiplier: 1.3,       // コース経験が重要（小回り適性）
    turfAdjust: 0,
    dirtAdjust: 0,
    widePartnersSmall: 4,
    widePartnersMedium: 5,
    widePartnersLarge: 7,       // 多頭数でワイド相手を増やす（12%対策）
    pivotStrategy: 'score_top',
    maxPivotOdds: 20,           // longshot軸9%なので制限を厳しく
    distanceTrust: {
      sprint: 0.9,              // 19%
      mile: 1.2,                // 44%で最強
      middle: 1.0,              // 26%
      long: 0.85,               // 18%
    },
    skipSmallField: false,       // 少頭数63% → 絶対にスキップしない
  },

  '阪神': {
    name: '阪神',
    // 距離実績の寄与差+3.0で全会場最高。芝48%が強い
    sireMultiplier: 0.9,         // 種牡馬は的中時に逆にスコアが低い(-1.4)
    jockeyMultiplier: 1.0,
    trainerMultiplier: 1.0,
    frameMultiplier: 1.0,
    distanceMultiplier: 1.5,     // 距離実績が最も重要（寄与差+3.0）
    courseMultiplier: 1.2,
    turfAdjust: 2,               // 芝で+2pt（48% vs 29%のダート）
    dirtAdjust: -1,              // ダート29% → やや減点
    widePartnersSmall: 4,
    widePartnersMedium: 5,
    widePartnersLarge: 5,
    pivotStrategy: 'score_top',
    maxPivotOdds: 25,            // longshot軸4% → 厳しめに制限
    distanceTrust: {
      sprint: 1.1,               // 40%
      mile: 1.0,                 // 35%
      middle: 1.0,               // 34%
      long: 1.3,                 // 57%で最強
    },
    skipSmallField: false,
  },

  '京都': {
    name: '京都',
    // 穴馬軸40%が特徴。距離実績が重要。中距離が弱い
    sireMultiplier: 1.0,
    jockeyMultiplier: 1.0,
    trainerMultiplier: 1.0,
    frameMultiplier: 0.8,         // 枠の寄与差がマイナス（-0.9）
    distanceMultiplier: 1.5,      // 距離実績の寄与差+3.0
    courseMultiplier: 1.0,
    turfAdjust: 0,
    dirtAdjust: 0,
    widePartnersSmall: 4,
    widePartnersMedium: 5,
    widePartnersLarge: 5,
    pivotStrategy: 'hybrid',      // 穴馬軸40% → ハイブリッド型
    maxPivotOdds: 40,             // 穴馬も軸にできる
    distanceTrust: {
      sprint: 1.3,                // 57%で最強
      mile: 1.1,                  // 36%
      middle: 0.85,               // 15%で壊滅 → やや下げ
      long: 1.2,                  // 43%
    },
    skipSmallField: false,
  },

  '福島': {
    name: '福島',
    // 最悪の16.7%。芝がほぼ全滅(10%)。騎手もマイナス寄与
    sireMultiplier: 0.85,          // 種牡馬の寄与差がマイナス → 下げ
    jockeyMultiplier: 0.3,          // 騎手スコアは害（的中時0pt）→ 大幅下げ
    trainerMultiplier: 0.5,
    frameMultiplier: 1.5,         // 小回りで枠が重要
    distanceMultiplier: 1.0,
    courseMultiplier: 1.5,         // 福島コース経験が最重要
    turfAdjust: -3,               // 芝10% → マイナス
    dirtAdjust: 2,                // ダート27% → プラス
    widePartnersSmall: 4,
    widePartnersMedium: 6,
    widePartnersLarge: 7,         // 多頭数16%対策
    pivotStrategy: 'value_top',   // 穴馬軸26% → 期待値型に切替
    maxPivotOdds: 30,
    distanceTrust: {
      sprint: 0.8,                // 14%
      mile: 1.0,
      middle: 1.0,                // 21%で比較的まし
      long: 0.3,                  // 0% → ほぼ信頼しない
    },
    skipSmallField: false,
  },

  '新潟': {
    name: '新潟',
    // 枠順の寄与差+3.7で最大。低スコア馬42%で逆転現象。ダート18%
    sireMultiplier: 0.85,          // 種牡馬の寄与差-1.4 → 下げ
    jockeyMultiplier: 0.3,          // 騎手の寄与差-1.0 → 大幅下げ
    trainerMultiplier: 0.5,
    frameMultiplier: 2.0,         // 枠順が最も重要（寄与差+3.7）
    distanceMultiplier: 1.0,
    courseMultiplier: 1.0,
    turfAdjust: 2,                // 芝38%が得意
    dirtAdjust: -2,               // ダート18%で苦戦
    widePartnersSmall: 4,
    widePartnersMedium: 5,
    widePartnersLarge: 7,         // 多頭数15%対策
    pivotStrategy: 'value_top',   // 高スコア馬0%、低スコア馬42% → 期待値型
    maxPivotOdds: 35,
    distanceTrust: {
      sprint: 1.0,                // 33%
      mile: 1.0,                  // 33%
      middle: 0.8,                // 18%
      long: 1.3,                  // 50%
    },
    skipSmallField: false,
  },

  // === デフォルト（未知の競馬場） ===
  '札幌': {
    name: '札幌',
    sireMultiplier: 1.0, jockeyMultiplier: 1.0, trainerMultiplier: 1.0,
    frameMultiplier: 1.2, distanceMultiplier: 1.0, courseMultiplier: 1.0,
    turfAdjust: 0, dirtAdjust: 0,
    widePartnersSmall: 4, widePartnersMedium: 5, widePartnersLarge: 6,
    pivotStrategy: 'score_top', maxPivotOdds: 30,
    distanceTrust: { sprint: 1.0, mile: 1.0, middle: 1.0, long: 1.0 },
    skipSmallField: false,
  },
  '函館': {
    name: '函館',
    sireMultiplier: 1.0, jockeyMultiplier: 1.0, trainerMultiplier: 1.0,
    frameMultiplier: 1.2, distanceMultiplier: 1.0, courseMultiplier: 1.0,
    turfAdjust: 0, dirtAdjust: 0,
    widePartnersSmall: 4, widePartnersMedium: 5, widePartnersLarge: 6,
    pivotStrategy: 'score_top', maxPivotOdds: 30,
    distanceTrust: { sprint: 1.0, mile: 1.0, middle: 1.0, long: 1.0 },
    skipSmallField: false,
  },
  '中京': {
    name: '中京',
    sireMultiplier: 1.0, jockeyMultiplier: 1.0, trainerMultiplier: 1.0,
    frameMultiplier: 1.0, distanceMultiplier: 1.0, courseMultiplier: 1.0,
    turfAdjust: 0, dirtAdjust: 0,
    widePartnersSmall: 4, widePartnersMedium: 5, widePartnersLarge: 5,
    pivotStrategy: 'score_top', maxPivotOdds: 30,
    distanceTrust: { sprint: 1.0, mile: 1.0, middle: 1.0, long: 1.0 },
    skipSmallField: false,
  },
  '小倉': {
    name: '小倉',
    // 小回りコース → 福島に近い特性を想定
    sireMultiplier: 0.8, jockeyMultiplier: 0.5, trainerMultiplier: 0.5,
    frameMultiplier: 1.5, distanceMultiplier: 1.0, courseMultiplier: 1.3,
    turfAdjust: 0, dirtAdjust: 0,
    widePartnersSmall: 4, widePartnersMedium: 6, widePartnersLarge: 7,
    pivotStrategy: 'score_top', maxPivotOdds: 25,
    distanceTrust: { sprint: 1.1, mile: 1.0, middle: 1.0, long: 0.7 },
    skipSmallField: false,
  },
};

/** 競馬場名からプロファイルを取得 */
export function getVenueProfile(venueName: string): VenueProfile {
  return VENUE_PROFILES[venueName] || VENUE_PROFILES['中京']; // デフォルト
}

/** 距離帯キーを算出 */
export function getDistanceKey(distance: number): 'sprint' | 'mile' | 'middle' | 'long' {
  if (distance <= 1200) return 'sprint';
  if (distance <= 1600) return 'mile';
  if (distance <= 2000) return 'middle';
  return 'long';
}

/** 頭数帯からワイド相手数を取得 */
export function getWidePartnerCount(profile: VenueProfile, headcount: number): number {
  if (headcount <= 10) return profile.widePartnersSmall;
  if (headcount <= 14) return profile.widePartnersMedium;
  return profile.widePartnersLarge;
}
