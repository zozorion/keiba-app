/**
 * 競馬予想エンジン — 型定義
 */

/** 出走馬の基本情報 */
export interface EntryHorse {
  frame: number;         // 枠番
  num: number;           // 馬番
  name: string;          // 馬名
  sex: string;           // 性齢（例: "牡3"）
  weightCarry: number;   // 斤量
  jockey: string;        // 騎手名
  trainer: string;       // 調教師名
  sire?: string;         // 種牡馬名
  damSire?: string;      // 母父名
  horseWeight?: number;  // 馬体重
  weightDiff?: number;   // 馬体重増減
  odds?: number;         // 単勝オッズ
  popularity?: number;   // 人気順
}

/** 過去成績レコード */
export interface PastRecord {
  raceId: string;
  date: number;            // YYYYMMDD
  finish: number;          // 着順
  last3f: number | null;   // 上がり3F
  passingOrder: string;    // 通過順
  odds: number | null;
  popularity: number | null;
  surface: string;         // 芝/ダート
  distance: number;        // 距離
  courseName: string;      // 競馬場名
  condition: string;       // 馬場状態
  timeSeconds: number | null;
  numRunners: number;
  weightCarry: number;
}

/** スコアリング結果 */
export interface ScoredHorse extends EntryHorse {
  score: number;
  expectationScore: number;  // 100点満点の期待値スコア
  reasons: ScoreReason[];
  history: PastRecord[];
  distanceRecord?: DistanceRecord;   // 同距離実績
  courseRecord?: CourseRecord;        // 同コース実績
  surfaceRecord?: SurfaceRecord;     // 馬場適性
  intervalDays?: number;             // 前走からの間隔（日数）
}

/** スコアの根拠 */
export interface ScoreReason {
  category: 'sire' | 'frame' | 'jockey' | 'trainer' | 'distance' | 'course' | 'surface' | 'interval' | 'weight' | 'class' | 'pace';
  label: string;           // 表示ラベル
  points: number;          // 加減点
  dataSource: string;      // データ根拠（例: "東京芝2400m WR15.3%"）
}

/** 同距離実績 */
export interface DistanceRecord {
  runs: number;
  wins: number;
  top3: number;
  winRate: number;
  top3Rate: number;
}

/** 同コース実績 */
export interface CourseRecord {
  runs: number;
  wins: number;
  top3: number;
  winRate: number;
  top3Rate: number;
}

/** 馬場適性（良馬場 vs 道悪） */
export interface SurfaceRecord {
  goodRuns: number;
  goodWinRate: number;
  wetRuns: number;
  wetWinRate: number;
}

/** レース情報 */
export interface RaceInfo {
  raceId: string;
  raceName: string;
  raceData: string;        // 詳細テキスト
  surface: string;         // 芝/ダート
  distance: number;
  condition: string;       // 馬場状態
  weather: string;
  courseName: string;      // 競馬場名
  courseCode: string;       // 競馬場コード
  raceNumber: number;
  postTime: string;        // 発走時刻
  grade?: string;          // G1/G2/G3/OP/リステッド etc.
  entries: EntryHorse[];
}

/** 予想結果 */
export interface PredictionResult {
  race: RaceInfo;
  scoredHorses: ScoredHorse[];
  pivotHorse: ScoredHorse;         // 軸馬
  expectationLevel: number;         // 0-100 の自信度
  isGraded: boolean;               // 重賞かどうか
  isHighConfidence: boolean;       // X投稿対象かどうか
  recommendations: BetRecommendation[];
  checkCard: CheckCard;
  shouldBet?: boolean;             // 期待値ベースの投資推奨
  skipReasons?: string[];          // スキップ理由
}

/** 買い目推奨 */
export interface BetRecommendation {
  type: 'sanrenpuku' | 'umaren' | 'wide' | 'tansho';
  label: string;              // 表示名
  combination: number[];      // 馬番の組み合わせ
  reason: string;
}

/** チェックカード（コースデータ） */
export interface CheckCard {
  condition: string;
  tips: string[];
  frameSummary: string;
  styleSummary: string;
  sireSummary: string;
}

/** 分析データJSON構造 */
export interface AnalyzedData {
  course: string;
  courseCode: number;
  surface: string;
  distance: number;
  totalRaces: number;
  totalRunners: number;
  period: string;
  conditions: {
    good?: ConditionData;
    wet?: ConditionData;
  };
}

export interface ConditionData {
  totalRunners: number;
  totalRaces: number;
  frameBias: Record<string, FrameBiasData>;
  runningStyle: Record<string, RunningStyleData>;
  pace: PaceData;
  sireRanking: SireRankingEntry[];
  checkCard: CheckCard;
}

export interface FrameBiasData {
  total: number;
  wins: number;
  winRate: number;
  top2Rate: number;
  top3Rate: number;
  winRoi: number;
}

export interface RunningStyleData {
  total: number;
  wins: number;
  winRate: number;
  top3Rate: number;
  winRoi: number;
}

export interface PaceData {
  fastestLast3f: { total: number; winRate: number; top3Rate: number };
  top3Last3f: { total: number; winRate: number; top3Rate: number };
  avgLast3f: number;
}

export interface SireRankingEntry {
  sire: string;
  total: number;
  horses: number;
  wins: number;
  top3: number;
  winRate: number;
  top3Rate: number;
  winRoi: number;
}

/** 投稿用データ */
export interface PostData {
  raceId: string;
  platform: 'x' | 'note';
  text: string;
  thumbnailPath?: string;
  scheduledTime: Date;
  posted: boolean;
  postId?: string;
}

/** 会場コード → 英名マッピング */
export const VENUE_MAP: Record<string, string> = {
  '01': 'sapporo',
  '02': 'hakodate',
  '03': 'fukushima',
  '04': 'niigata',
  '05': 'tokyo',
  '06': 'nakayama',
  '07': 'chukyo',
  '08': 'kyoto',
  '09': 'hanshin',
  '10': 'kokura',
};

export const VENUE_NAME_MAP: Record<string, string> = {
  'sapporo': '札幌',
  'hakodate': '函館',
  'fukushima': '福島',
  'niigata': '新潟',
  'tokyo': '東京',
  'nakayama': '中山',
  'chukyo': '中京',
  'kyoto': '京都',
  'hanshin': '阪神',
  'kokura': '小倉',
};
