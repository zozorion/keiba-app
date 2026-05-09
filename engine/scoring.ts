/**
 * 競馬予想エンジン — スコアリングロジック v5
 * 
 * 原則:
 * 1. 全てのスコアリングはデータ事実に基づく。推定・推測は一切行わない。
 * 2. 回収率（ROI）最大化が最優先。的中率ではない。
 * 3. 人気薄でもスコアが高ければ積極的に軸にする（期待値の源泉）。
 * 4. 競馬場ごとのチューニングを自動適用（学習パイプライン）。
 * 
 * v5 改善点（10日336R深層分析に基づく大改修）:
 * - 競馬場プロファイルシステム導入（venue-profiles.ts）
 * - 全スコアリング要素に競馬場固有の倍率を適用
 * - 芝/ダート適性調整（福島芝-5pt、阪神芝+3ptなど）
 * - 距離帯別信頼度（京都中距離0.7倍、東京長距離0.7倍など）
 * - 軸選定戦略の競馬場別切替（score_top/value_top/hybrid）
 * - 軸馬オッズ上限の競馬場別設定
 * - 頭数別ワイド相手数の動的調整
 */

import type {
  EntryHorse, ScoredHorse, ScoreReason, PastRecord,
  AnalyzedData, ConditionData, SireRankingEntry,
  DistanceRecord, CourseRecord, SurfaceRecord,
  BetRecommendation, CheckCard
} from './types';
import fs from 'fs';
import path from 'path';
import { getVenueProfile, getDistanceKey, getWidePartnerCount, type VenueProfile } from './venue-profiles';

/** 競馬場別チューニング読み込み（キャッシュ付き） */
const tuningCache = new Map<string, any>();
function loadTuning(venueEn: string): any | null {
  if (tuningCache.has(venueEn)) return tuningCache.get(venueEn);
  const tuningPath = path.join(process.cwd(), 'data', 'tuning', `${venueEn}.json`);
  try {
    if (fs.existsSync(tuningPath)) {
      const data = JSON.parse(fs.readFileSync(tuningPath, 'utf-8'));
      tuningCache.set(venueEn, data);
      return data;
    }
  } catch {}
  tuningCache.set(venueEn, null);
  return null;
}

// ============================================================
// 騎手スコア（v3: 0-3の極小レンジ — ROI寄与が低いため）
// ============================================================
const JOCKEY_SCORES: Record<string, number> = {
  '川田': 3, 'レーン': 3, 'ルメール': 3, '武豊': 2, 'モレイラ': 3,
  '松山': 2, '戸崎圭': 2, '戸崎': 2, '坂井': 2, '池添': 1, '横山武': 1,
  '横山典': 1, '岩田望': 1, '田辺': 1, '三浦': 1, '津村': 1, '北村友': 1,
  '岩田康': 1, '吉田豊': 0, '佐々木': 0, '団野': 1, '西村淳': 0,
  '幸': 1, '鮫島': 1, '菅原明': 1, 'M.デムーロ': 2, 'ディー': 1,
  '大野': 0, '浜中': 1, '藤岡佑': 1, '和田竜': 1, '吉田隼': 1,
  '松若': 0, '横山和': 1, '菅原辰': 0, '木幡巧': 0, '角田大': 1,
  '角田和': 1, '永野': 0, '荻野極': 0,
};

// ============================================================
// 厩舎スコア（v3: 0-3の極小レンジ — ROI寄与が低いため）
// ============================================================
const TRAINER_SCORES: Record<string, number> = {
  '堀': 3, '友道': 3, '矢作': 2, '国枝': 2, '中内田': 2,
  '木村': 2, '福永': 2, '池江': 2, '須貝': 1, '手塚': 1,
  '田村': 1, '武井': 1, '中川': 1, '藤原英': 2, '西村真': 1,
  '音無': 1, '杉山佳': 1, '笹田': 1, '橋田': 1, '松永幹': 0,
  '高柳大': 0, '奥村武': 0, '尾関': 1, '安田隆': 1,
  '藤岡健': 1, '中竹': 0, '清水久': 0, '松下': 0,
};

/**
 * 種牡馬スコアリング v2
 * 改善: サンプル数による信頼度割引を導入
 * - 30走以上: 100%信頼
 * - 20-29走: 80%信頼
 * - 10-19走: 60%信頼
 * - 5-9走: 40%信頼（過信防止）
 * - 5走未満: スコアなし
 */
function scoreSire(
  sireName: string,
  sireRanking: any[],
  maxPoints: number = 20
): { points: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  let points = 0;

  const sireMap = Object.fromEntries(sireRanking.map((s: any) => [s.sire, s]));
  const sireData = sireMap[sireName];

  if (!sireData) {
    return { points: 0, reasons: [] };
  }

  const winRate = sireData.win_rate ?? sireData.winRate ?? 0;
  const top3Rate = sireData.top3_rate ?? sireData.top3Rate ?? 0;
  const total = sireData.total ?? 0;
  const winRoi = sireData.win_roi ?? sireData.winRoi ?? 0;

  // サンプル数5走未満は信頼性不足 → スキップ
  if (total < 5) {
    return { points: 0, reasons: [] };
  }

  // 信頼度割引率
  let reliability = 1.0;
  if (total < 10) reliability = 0.4;
  else if (total < 20) reliability = 0.6;
  else if (total < 30) reliability = 0.8;

  // 勝率ベーススコア（v3: maxPointsはチューニングから注入）
  let rawSirePoints = 0;
  let label = '';
  if (winRate >= 15) {
    rawSirePoints = maxPoints;
    label = `種牡馬◎ 父${sireName}`;
  } else if (winRate >= 12) {
    rawSirePoints = Math.round(maxPoints * 0.7);
    label = `種牡馬○ 父${sireName}`;
  } else if (winRate >= 10) {
    rawSirePoints = Math.round(maxPoints * 0.45);
    label = `種牡馬△ 父${sireName}`;
  }

  if (rawSirePoints > 0) {
    const adjusted = Math.round(rawSirePoints * reliability);
    points += adjusted;
    reasons.push({
      category: 'sire', label,
      points: adjusted,
      dataSource: `WR${winRate}% (${total}走) 信頼度${Math.round(reliability * 100)}%`
    });
  }

  // 回収値ボーナス（v2: ROI重視なのでROIボーナスは維持）
  if (winRoi >= 100 && total >= 10) {
    const roiBonus = Math.min(8, Math.round((winRoi - 80) / 20) * 2);
    points += roiBonus;
    reasons.push({
      category: 'sire', label: `回収値高`,
      points: roiBonus, dataSource: `ROI${winRoi}% (${total}走)`
    });
  }

  // 複勝率ボーナス（v2: 3着内率はワイド流しに直結するので維持）
  if (top3Rate >= 40 && total >= 10) {
    points += 4;
    reasons.push({
      category: 'sire', label: `複勝率高`,
      points: 4, dataSource: `T3R${top3Rate}% (${total}走)`
    });
  }

  return { points, reasons };
}

/**
 * 枠順スコアリング（v3: maxPointsをチューニングから受け取る）
 */
function scoreFrame(
  frame: number,
  frameBias: Record<string, any>,
  maxPoints: number = 8
): { points: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  let points = 0;
  const fData = frameBias?.[String(frame)];

  if (!fData) return { points: 0, reasons: [] };

  const fwr = fData.win_rate ?? fData.winRate ?? 8.0;

  if (fwr >= 10) {
    points += maxPoints;
    reasons.push({
      category: 'frame', label: `${frame}枠◎`,
      points: maxPoints, dataSource: `枠WR${fwr}%`
    });
  } else if (fwr >= 8) {
    points += 3;
  } else {
    points -= 3;
    reasons.push({
      category: 'frame', label: `${frame}枠△`,
      points: -3, dataSource: `枠WR${fwr}%`
    });
  }

  return { points, reasons };
}

/**
 * 名前正規化: 接頭マーク除去 + 全角英数字記号→半角 + 空白除去
 * netkeiba出走表は "戸崎 圭太" / "Ｃ．ルメール" / "▲佐藤 翔馬" など
 * のフォーマットで提供されるため、マップキー（苗字のみ）と照合する前に正規化する。
 */
function normalizeName(name: string): string {
  let n = name.replace(/[△▲☆◇★]/g, '');
  n = n.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  n = n.replace(/．/g, '.');
  n = n.replace(/[\s　]/g, '');
  return n;
}

/**
 * スコアマップ参照: 正規化名に対し最長一致するキーのスコアを返す。
 * 部分一致のため "戸崎 圭太" → "戸崎圭" / "Ｃ．ルメール" → "ルメール" が拾える。
 */
function lookupNameScore(name: string, scoreMap: Record<string, number>): number {
  const normalized = normalizeName(name);
  if (normalized in scoreMap) return scoreMap[normalized];
  let bestKey = '';
  for (const key of Object.keys(scoreMap)) {
    if (normalized.includes(key) && key.length > bestKey.length) bestKey = key;
  }
  return bestKey ? scoreMap[bestKey] : 0;
}

/**
 * 騎手スコアリング（v3: 最大3pt）
 */
function scoreJockey(jockeyName: string, multiplier: number = 1.0): { points: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  const raw = lookupNameScore(jockeyName, JOCKEY_SCORES);
  const js = Math.round(raw * multiplier);

  if (js >= 2) {
    reasons.push({
      category: 'jockey', label: `騎手◎ ${jockeyName}`,
      points: js, dataSource: `リーディング上位`
    });
  } else if (js >= 1) {
    reasons.push({
      category: 'jockey', label: `騎手○ ${jockeyName}`,
      points: js, dataSource: `実績あり`
    });
  }

  return { points: js, reasons };
}

/**
 * 厩舎スコアリング（v3: 最大3pt）
 */
function scoreTrainer(trainerName: string, multiplier: number = 1.0): { points: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  const raw = lookupNameScore(trainerName, TRAINER_SCORES);
  const ts = Math.round(raw * multiplier);

  if (ts >= 2) {
    reasons.push({
      category: 'trainer', label: `厩舎◎ ${trainerName}`,
      points: ts, dataSource: `重賞実績上位`
    });
  }

  return { points: ts, reasons };
}

/**
 * 距離実績スコアリング（v2: 変更なし — データ事実ベースで有効）
 */
function scoreDistanceRecord(record: DistanceRecord | undefined): { points: number; reasons: ScoreReason[] } {
  if (!record || record.runs < 2) return { points: 0, reasons: [] };

  const reasons: ScoreReason[] = [];
  let points = 0;

  if (record.winRate >= 30 && record.runs >= 3) {
    points += 8;
    reasons.push({
      category: 'distance', label: `距離実績◎`,
      points: 8, dataSource: `同距離 ${record.wins}勝/${record.runs}走 WR${record.winRate.toFixed(1)}%`
    });
  } else if (record.top3Rate >= 50 && record.runs >= 3) {
    points += 5;
    reasons.push({
      category: 'distance', label: `距離実績○`,
      points: 5, dataSource: `同距離 複勝率${record.top3Rate.toFixed(1)}% (${record.runs}走)`
    });
  }

  return { points, reasons };
}

/**
 * コース実績スコアリング（v2: 変更なし）
 */
function scoreCourseRecord(record: CourseRecord | undefined): { points: number; reasons: ScoreReason[] } {
  if (!record || record.runs < 2) return { points: 0, reasons: [] };

  const reasons: ScoreReason[] = [];
  let points = 0;

  if (record.winRate >= 25 && record.runs >= 3) {
    points += 5;
    reasons.push({
      category: 'course', label: `コース実績◎`,
      points: 5, dataSource: `同コース ${record.wins}勝/${record.runs}走 WR${record.winRate.toFixed(1)}%`
    });
  } else if (record.top3Rate >= 40 && record.runs >= 3) {
    points += 3;
    reasons.push({
      category: 'course', label: `コース実績○`,
      points: 3, dataSource: `同コース 複勝率${record.top3Rate.toFixed(1)}% (${record.runs}走)`
    });
  }

  return { points, reasons };
}

/**
 * 馬場適性スコアリング（v2: 変更なし）
 */
function scoreSurfaceCondition(
  record: SurfaceRecord | undefined,
  currentCondition: string
): { points: number; reasons: ScoreReason[] } {
  if (!record) return { points: 0, reasons: [] };

  const reasons: ScoreReason[] = [];
  let points = 0;
  const isWet = ['稍重', '重', '不良'].includes(currentCondition);

  if (isWet && record.wetRuns >= 3) {
    if (record.wetWinRate >= 20) {
      points += 5;
      reasons.push({
        category: 'surface', label: `道悪◎`,
        points: 5, dataSource: `道悪 WR${record.wetWinRate.toFixed(1)}% (${record.wetRuns}走)`
      });
    } else if (record.wetWinRate === 0 && record.wetRuns >= 3) {
      points -= 5;
      reasons.push({
        category: 'surface', label: `道悪△`,
        points: -5, dataSource: `道悪 0勝/${record.wetRuns}走`
      });
    }
  }

  return { points, reasons };
}

/**
 * 休み明け/連戦スコアリング（v2: 変更なし）
 */
function scoreInterval(intervalDays: number | undefined): { points: number; reasons: ScoreReason[] } {
  if (intervalDays === undefined) return { points: 0, reasons: [] };

  const reasons: ScoreReason[] = [];
  let points = 0;

  if (intervalDays <= 14) {
    points -= 3;
    reasons.push({
      category: 'interval', label: `中${Math.floor(intervalDays / 7)}週`,
      points: -3, dataSource: `前走から${intervalDays}日`
    });
  } else if (intervalDays >= 180) {
    points -= 5;
    reasons.push({
      category: 'interval', label: `半年以上休み明け`,
      points: -5, dataSource: `前走から${intervalDays}日`
    });
  }

  return { points, reasons };
}

/**
 * 脚質スコアリング（v4: NEW）
 * 
 * コースごとの有利な脚質パターン:
 * - 小回り・内回り（福島/小倉/函館/札幌/中山/京都内回り）: 逃げ・先行有利
 * - 大箱・外回り（東京/阪神/新潟外回り）: 差し・追込有利
 * - 短距離（1200m以下）: 逃げ・先行有利
 * - 長距離（2400m以上）: 差し有利
 */

// コースごとの脚質バイアス（正=先行有利, 負=差し有利）
const COURSE_PACE_BIAS: Record<string, number> = {
  '東京': -1,    // 広い直線 → 差し有利
  '中山': 1,     // 小回り → 先行有利
  '京都': 0,     // コースによる
  '阪神': -1,    // 外回り → 差し有利
  '福島': 2,     // 小回り → 逃げ先行有利
  '新潟': -1,    // 長い直線 → 差し有利
  '中京': 0,     // 中庸
  '小倉': 2,     // 小回り → 逃げ先行有利
  '札幌': 1,     // 洋芝・小回り → 先行有利
  '函館': 1,     // 洋芝・小回り → 先行有利
};

function scoreRunningStyle(
  entry: any,
  courseName: string,
  distance: number
): { points: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  let points = 0;

  // 脚質の判定: runningStyle直接指定 or 過去の通過順から推定
  let style = entry.runningStyle || '';
  const pastRaces = entry.pastRaces || [];
  const history: PastRecord[] = entry.history || [];

  // 通過順から脚質を推定（runningStyleが未設定の場合）
  if (!style && history.length > 0) {
    const recentPassing = history.slice(0, 3)
      .map(h => {
        if (!h.passingOrder) return -1;
        const first = parseInt(h.passingOrder.split('-')[0]);
        return isNaN(first) ? -1 : first;
      })
      .filter(p => p > 0);

    if (recentPassing.length > 0) {
      const avgPos = recentPassing.reduce((a, b) => a + b, 0) / recentPassing.length;
      // 平均通過順位で判定
      if (avgPos <= 2) style = '逃げ';
      else if (avgPos <= 5) style = '先行';
      else if (avgPos <= 10) style = '差し';
      else style = '追込';
    }
  }

  if (!style && pastRaces.length === 0) return { points: 0, reasons: [] };

  // コースバイアス（正=先行有利, 負=差し有利）
  let bias = COURSE_PACE_BIAS[courseName] ?? 0;

  // 距離による補正
  if (distance <= 1200) bias += 1;  // 短距離 → 先行有利
  if (distance >= 2400) bias -= 1;  // 長距離 → 差し有利

  // 脚質マッチング
  if (style) {
    const isFrontRunner = style === '逃げ' || style === '先行';
    const isCloser = style === '差し' || style === '追込';

    if (isFrontRunner && bias > 0) {
      const bonus = Math.min(6, bias * 3);
      points += bonus;
      reasons.push({
        category: 'pace', label: `脚質◎ ${style}（${courseName}先行有利）`,
        points: bonus, dataSource: `バイアス+${bias}`
      });
    } else if (isCloser && bias < 0) {
      const bonus = Math.min(6, Math.abs(bias) * 3);
      points += bonus;
      reasons.push({
        category: 'pace', label: `脚質◎ ${style}（${courseName}差し有利）`,
        points: bonus, dataSource: `バイアス${bias}`
      });
    } else if (isFrontRunner && bias < 0) {
      points -= 2;
      reasons.push({
        category: 'pace', label: `脚質△ ${style}（${courseName}差し有利コース）`,
        points: -2, dataSource: `脚質不利`
      });
    } else if (isCloser && bias > 0) {
      points -= 2;
      reasons.push({
        category: 'pace', label: `脚質△ ${style}（${courseName}先行有利コース）`,
        points: -2, dataSource: `脚質不利`
      });
    }
  }

  // 上り3Fボーナス: 差し有利コースの場合のみ加点
  // 理由: 上りが速い＝強い馬とは限らない。ズブくてエンジンがかからず
  // 毎回上りだけ速いが差し切れない馬に無駄な加点をしないため。
  // コースが差し有利なら、末脚が活きる → 加点の意味がある。
  if (pastRaces.length > 0 && bias < 0) {
    const recentLast3fs = pastRaces.filter((r: any) => r.last3f > 0).map((r: any) => r.last3f);
    if (recentLast3fs.length > 0) {
      const bestLast3f = Math.min(...recentLast3fs);

      if (bestLast3f <= 33.0) {
        points += 5;
        reasons.push({
          category: 'pace', label: `末脚◎ 上り3F ${bestLast3f}秒（差し有利コース）`,
          points: 5, dataSource: `直近${recentLast3fs.length}走最速`
        });
      } else if (bestLast3f <= 34.0) {
        points += 3;
        reasons.push({
          category: 'pace', label: `末脚○ 上り3F ${bestLast3f}秒（差し有利コース）`,
          points: 3, dataSource: `直近${recentLast3fs.length}走最速`
        });
      }
    }
  }

  return { points, reasons };
}

/**
 * 斤量スコアリング（v2: 変更なし）
 */
function scoreWeight(weightCarry: number): { points: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  let points = 0;

  if (weightCarry > 0 && weightCarry < 55) {
    points += 3;
    reasons.push({
      category: 'weight', label: `軽斤量`,
      points: 3, dataSource: `${weightCarry}kg`
    });
  }

  return { points, reasons };
}

/**
 * メインスコアリング関数（v3: 競馬場別チューニング対応）
 */
export function scoreHorse(
  entry: EntryHorse,
  history: PastRecord[],
  analysisData: ConditionData | null,
  raceDistance: number,
  raceCourseName: string,
  raceSurface: string,
  raceCondition: string,
  raceDate: number,
  venueEn?: string
): ScoredHorse {
  // 競馬場別チューニングを読み込み（あれば適用）
  const tuning = venueEn ? loadTuning(venueEn) : null;
  const weights = tuning?.weights;

  // v5: 競馬場プロファイル取得
  const profile = getVenueProfile(raceCourseName);
  const distKey = getDistanceKey(raceDistance);
  const distTrust = profile.distanceTrust[distKey];

  let totalScore = 50; // ベーススコア
  const allReasons: ScoreReason[] = [];

  // === v5: 芝/ダート適性調整 ===
  const isTurf = raceSurface.includes('芝') || raceSurface === 'turf';
  const surfaceAdj = isTurf ? profile.turfAdjust : profile.dirtAdjust;
  if (surfaceAdj !== 0) {
    totalScore += surfaceAdj;
    allReasons.push({
      category: 'surface',
      label: surfaceAdj > 0 ? `${raceCourseName}${isTurf ? '芝' : 'ダート'}適性◎` : `${raceCourseName}${isTurf ? '芝' : 'ダート'}適性△`,
      points: surfaceAdj,
      dataSource: `プロファイル調整`
    });
  }

  // 1. 種牡馬 (v5: プロファイルのsireMultiplierで調整)
  if (analysisData && entry.sire) {
    const sireRanking = (analysisData as any).sire_ranking ?? (analysisData as any).sireRanking ?? [];
    const sireResult = scoreSire(entry.sire, sireRanking, weights?.sireMaxPoints);
    const adjustedSirePts = Math.round(sireResult.points * profile.sireMultiplier);
    totalScore += adjustedSirePts;
    // 倍率が1.0でなければ理由に反映
    for (const r of sireResult.reasons) {
      allReasons.push({ ...r, points: Math.round(r.points * profile.sireMultiplier) });
    }
  }

  // 2. 枠順 (v5: プロファイルのframeMultiplierで調整)
  if (analysisData) {
    const frameBias = (analysisData as any).frame_bias ?? (analysisData as any).frameBias ?? {};
    const frameResult = scoreFrame(entry.frame, frameBias, weights?.frameMaxPoints);
    const adjustedFramePts = Math.round(frameResult.points * profile.frameMultiplier);
    totalScore += adjustedFramePts;
    for (const r of frameResult.reasons) {
      allReasons.push({ ...r, points: Math.round(r.points * profile.frameMultiplier) });
    }
  }

  // 3. 騎手 (v5: プロファイルのjockeyMultiplierを優先)
  const jockeyMul = profile.jockeyMultiplier !== 1.0 ? profile.jockeyMultiplier : (weights?.jockeyMultiplier ?? 1.0);
  const jockeyResult = scoreJockey(entry.jockey, jockeyMul);
  totalScore += jockeyResult.points;
  allReasons.push(...jockeyResult.reasons);

  // 4. 厩舎 (v5: プロファイルのtrainerMultiplierを優先)
  const trainerMul = profile.trainerMultiplier !== 1.0 ? profile.trainerMultiplier : (weights?.trainerMultiplier ?? 1.0);
  const trainerResult = scoreTrainer(entry.trainer, trainerMul);
  totalScore += trainerResult.points;
  allReasons.push(...trainerResult.reasons);

  // 5. 距離実績 (v5: プロファイルのdistanceMultiplierで調整)
  const distanceRecord = calcDistanceRecord(history, raceDistance, raceSurface);
  const distResult = scoreDistanceRecord(distanceRecord);
  const adjustedDistPts = Math.round(distResult.points * profile.distanceMultiplier);
  totalScore += adjustedDistPts;
  for (const r of distResult.reasons) {
    allReasons.push({ ...r, points: Math.round(r.points * profile.distanceMultiplier) });
  }

  // 6. コース実績 (v5: プロファイルのcourseMultiplierで調整)
  const courseRecord = calcCourseRecord(history, raceCourseName);
  const courseResult = scoreCourseRecord(courseRecord);
  const adjustedCoursePts = Math.round(courseResult.points * profile.courseMultiplier);
  totalScore += adjustedCoursePts;
  for (const r of courseResult.reasons) {
    allReasons.push({ ...r, points: Math.round(r.points * profile.courseMultiplier) });
  }

  // 7. 馬場適性
  const surfaceRecord = calcSurfaceRecord(history);
  const surfaceResult = scoreSurfaceCondition(surfaceRecord, raceCondition);
  totalScore += surfaceResult.points;
  allReasons.push(...surfaceResult.reasons);

  // 8. 休み明け/連戦
  const intervalDays = calcIntervalDays(history, raceDate);
  const intervalResult = scoreInterval(intervalDays);
  totalScore += intervalResult.points;
  allReasons.push(...intervalResult.reasons);

  // 9. 斤量
  const weightResult = scoreWeight(entry.weightCarry);
  totalScore += weightResult.points;
  allReasons.push(...weightResult.reasons);

  // 10. 脚質・ペース分析（v4/v5）
  const paceResult = scoreRunningStyle(entry, raceCourseName, raceDistance);
  totalScore += paceResult.points;
  allReasons.push(...paceResult.reasons);

  // === v5: 距離帯信頼度による最終調整 ===
  // distTrustが1.0以外の場合、ベーススコアからの差分を信頼度で調整
  if (distTrust !== 1.0) {
    const diff = totalScore - 50;
    totalScore = 50 + Math.round(diff * distTrust);
  }

  // === 期待値スコア（v6: 回収率ベース） ===
  // 期待値 = 強さスコアとオッズの乖離を数値化
  // 強い馬でも低オッズなら期待値は低い。弱めでも高オッズなら期待値は高い。
  //
  // 計算ロジック:
  //   1. 強さスコア(totalScore)から「この馬の適正オッズ」を推定
  //      score 80 → 適正オッズ 2.5倍、score 60 → 適正オッズ 8.0倍 など
  //   2. 実オッズ / 適正オッズ = 乖離率（1.0超なら割安＝期待値あり）
  //   3. expectationScore = 強さスコア × 乖離倍率（上限100）
  //
  // オッズ未取得時はフォールバック: expectationScore ≒ totalScore
  let expectationScore: number;
  const odds = (entry as any).odds;
  if (odds && odds > 0) {
    // 強さスコアから適正オッズを推定（指数関数）
    // score=90 → 1.5倍、score=75 → 3.5倍、score=60 → 8.0倍、score=50 → 15倍、score=40 → 30倍
    const clampedScore = Math.max(30, Math.min(95, totalScore));
    const fairOdds = Math.exp((90 - clampedScore) * 0.065);  // ≈ e^((90-score)*0.065)
    
    // 乖離率: 実オッズ / 適正オッズ
    // > 1.0 なら割安（期待値あり） = オッズが実力より高い
    // < 1.0 なら割高（期待値なし） = オッズが実力より低い（過剰人気）
    const valueRatio = odds / fairOdds;
    
    // 期待値スコア = 強さベース × 乖離倍率（上限キャップ付き）
    // valueRatio 1.0 → そのまま、2.0 → 1.5倍ブースト、0.5 → 0.75倍ペナルティ
    const boostFactor = 1.0 + (valueRatio - 1.0) * 0.5; // 乖離の50%を反映（急激な変動を抑制）
    const clampedBoost = Math.max(0.5, Math.min(2.0, boostFactor));
    expectationScore = Math.min(100, Math.max(0, Math.round(totalScore * clampedBoost)));
    
    // 期待値理由を追加
    const valueLabel = valueRatio >= 1.5 ? '🔥割安(妙味大)' 
      : valueRatio >= 1.1 ? '💰割安(妙味あり)'
      : valueRatio >= 0.9 ? '→適正'
      : valueRatio >= 0.7 ? '⚠️やや割高'
      : '❌割高(過剰人気)';
    allReasons.push({
      category: 'class' as const,
      label: `${valueLabel} [実${odds}倍 vs 適正${fairOdds.toFixed(1)}倍]`,
      points: Math.round((valueRatio - 1.0) * 10),
      dataSource: `乖離率${(valueRatio * 100).toFixed(0)}%`,
    });
  } else {
    // オッズ未取得 → 強さスコアをそのまま使用（フォールバック）
    expectationScore = Math.min(100, Math.max(0, totalScore));
  }

  return {
    ...entry,
    score: totalScore,
    expectationScore,
    reasons: allReasons,
    history,
    distanceRecord,
    courseRecord,
    surfaceRecord,
    intervalDays,
  };
}

// ============================================================
// データ集計ヘルパー関数（変更なし）
// ============================================================

function calcDistanceRecord(history: PastRecord[], distance: number, surface: string): DistanceRecord | undefined {
  const surfaceJa = surface === 'turf' ? '芝' : surface === 'dirt' ? 'ダート' : surface;
  const matched = history.filter(h => h.distance === distance && h.surface === surfaceJa);
  if (matched.length === 0) return undefined;

  const wins = matched.filter(h => h.finish === 1).length;
  const top3 = matched.filter(h => h.finish >= 1 && h.finish <= 3).length;
  return {
    runs: matched.length,
    wins,
    top3,
    winRate: (wins / matched.length) * 100,
    top3Rate: (top3 / matched.length) * 100,
  };
}

function calcCourseRecord(history: PastRecord[], courseName: string): CourseRecord | undefined {
  const matched = history.filter(h => h.courseName && h.courseName.includes(courseName));
  if (matched.length === 0) return undefined;

  const wins = matched.filter(h => h.finish === 1).length;
  const top3 = matched.filter(h => h.finish >= 1 && h.finish <= 3).length;
  return {
    runs: matched.length,
    wins,
    top3,
    winRate: (wins / matched.length) * 100,
    top3Rate: (top3 / matched.length) * 100,
  };
}

function calcSurfaceRecord(history: PastRecord[]): SurfaceRecord | undefined {
  const good = history.filter(h => h.condition === '良');
  const wet = history.filter(h => ['稍重', '重', '不良'].includes(h.condition));

  if (good.length === 0 && wet.length === 0) return undefined;

  return {
    goodRuns: good.length,
    goodWinRate: good.length > 0 ? (good.filter(h => h.finish === 1).length / good.length) * 100 : 0,
    wetRuns: wet.length,
    wetWinRate: wet.length > 0 ? (wet.filter(h => h.finish === 1).length / wet.length) * 100 : 0,
  };
}

function calcIntervalDays(history: PastRecord[], raceDate: number): number | undefined {
  if (history.length === 0) return undefined;

  const lastRace = history[0];
  if (!lastRace.date) return undefined;

  const lastDate = new Date(
    Math.floor(lastRace.date / 10000),
    Math.floor((lastRace.date % 10000) / 100) - 1,
    lastRace.date % 100
  );
  const currentDate = new Date(
    Math.floor(raceDate / 10000),
    Math.floor((raceDate % 10000) / 100) - 1,
    raceDate % 100
  );

  const diffMs = currentDate.getTime() - lastDate.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * 軸馬選定ロジック（v5.2: スコア構成の多様性に基づく選定）
 * 
 * 3つの戦略:
 * - score_top: スコア最上位を軸（東京・中山など王道型）
 * - value_top: 種牡馬偏重を避け、複数要素で安定した馬を軸（福島・新潟）
 * - hybrid: スコアtop3の中で最も多様な要素を持つ馬を軸（京都）
 */
export function selectPivotHorse(
  scoredHorses: ScoredHorse[],
  venueName?: string
): ScoredHorse {
  const profile = venueName ? getVenueProfile(venueName) : getVenueProfile('東京');
  const sorted = [...scoredHorses].sort((a, b) => b.score - a.score);

  if (sorted.length === 0) return sorted[0];

  /**
   * スコア多様性スコアを算出
   * 種牡馬スコアだけで高得点の馬より、枠・騎手・距離・コースなど
   * 複数のカテゴリで加点されている馬の方が信頼できる
   */
  function scoreDiversity(horse: ScoredHorse): number {
    if (!horse.reasons || horse.reasons.length === 0) return 0;
    const categories = new Set(horse.reasons.filter(r => r.points > 0).map(r => r.category));
    // 加点カテゴリ数 + 非種牡馬スコアの合計割合
    const nonSirePts = horse.reasons.filter(r => r.category !== 'sire' && r.points > 0).reduce((s, r) => s + r.points, 0);
    const totalPts = horse.reasons.filter(r => r.points > 0).reduce((s, r) => s + r.points, 0);
    const nonSireRatio = totalPts > 0 ? nonSirePts / totalPts : 0;
    return categories.size * 10 + nonSireRatio * 20;
  }

  if (profile.pivotStrategy === 'value_top') {
    // 期待値型: スコアが52以上で、多様性+オッズ期待値が高い馬を軸
    const candidates = sorted.filter(h => h.score >= 52);
    if (candidates.length > 0) {
      // オッズ情報がある場合は期待値スコア（多様性 × オッズ妙味）で選定
      candidates.sort((a, b) => {
        const divA = scoreDiversity(a);
        const divB = scoreDiversity(b);
        const oddsA = (a as any).odds || 0;
        const oddsB = (b as any).odds || 0;
        // オッズがある場合: 多様性 + 中穴ボーナス（5〜20倍に加点）
        const valueA = divA + (oddsA >= 5 && oddsA <= profile.maxPivotOdds ? 15 : 0);
        const valueB = divB + (oddsB >= 5 && oddsB <= profile.maxPivotOdds ? 15 : 0);
        return valueB - valueA;
      });
      // maxPivotOdds制限
      const pick = candidates.find(h => {
        const odds = (h as any).odds || 0;
        return odds === 0 || odds <= profile.maxPivotOdds;
      });
      return pick || candidates[0];
    }
  } else if (profile.pivotStrategy === 'hybrid') {
    // ハイブリッド型: スコアtop5の中で多様性+オッズ妙味が最も高い馬
    const top5 = sorted.slice(0, 5);
    top5.sort((a, b) => {
      const divA = scoreDiversity(a);
      const divB = scoreDiversity(b);
      const oddsA = (a as any).odds || 0;
      const oddsB = (b as any).odds || 0;
      const valueA = divA + (oddsA >= 3 && oddsA <= profile.maxPivotOdds ? 10 : 0);
      const valueB = divB + (oddsB >= 3 && oddsB <= profile.maxPivotOdds ? 10 : 0);
      return valueB - valueA;
    });
    // maxPivotOdds制限
    const pick = top5.find(h => {
      const odds = (h as any).odds || 0;
      return odds === 0 || odds <= profile.maxPivotOdds;
    });
    return pick || top5[0];
  }

  // score_top（デフォルト）— オッズ制限なし。スコアが最も信頼できる指標
  return sorted[0];
}

/**
 * 買い目生成（v3: 競馬場別ワイド相手頭数対応）
 * 
 * 回収率最大化の方針:
 * - ワイド流し: 軸1頭→相手N頭（Nは学習で最適化、デフォルト5）
 * - 単勝: 軸馬の単勝（1点=100円）
 * - 馬連流し: 軸→上位3頭
 * - 三連複フォーメーション: 一発狙い
 */
/**
 * 買い目生成（v5: 競馬場プロファイルから頭数別ワイド相手数を動的取得）
 */
export function generateBetRecommendations(
  scoredHorses: ScoredHorse[],
  widePartnerCount: number = 5,
  venueName?: string
): BetRecommendation[] {
  const sorted = [...scoredHorses].sort((a, b) => b.score - a.score);

  // v5: 競馬場プロファイルからワイド相手数を取得
  let actualWideCount = widePartnerCount;
  if (venueName) {
    const profile = getVenueProfile(venueName);
    actualWideCount = getWidePartnerCount(profile, scoredHorses.length);
  }

  if (sorted.length < actualWideCount + 1) return [];

  // v5: 軸馬はselectPivotHorseで選定済み前提。sorted[0]が軸
  const pivot = sorted[0];
  const widePartners = sorted.slice(1, 1 + actualWideCount);
  const recommendations: BetRecommendation[] = [];

  // ワイド流し（軸→上位N頭）
  recommendations.push({
    type: 'wide',
    label: 'ワイド流し',
    combination: [pivot.num, ...widePartners.map(h => h.num)],
    reason: `軸${pivot.num}番→${widePartners.map(h => h.num).join(',')}番 (${actualWideCount}点)`,
  });

  // 単勝
  recommendations.push({
    type: 'tansho',
    label: '単勝',
    combination: [pivot.num],
    reason: `スコア最上位`,
  });

  // 馬連流し（軸→上位3頭、3点買い）
  const umarenPartners = sorted.slice(1, 4);
  recommendations.push({
    type: 'umaren',
    label: '馬連流し',
    combination: [pivot.num, ...umarenPartners.map(h => h.num)],
    reason: `軸${pivot.num}番→${umarenPartners.map(h => h.num).join(',')}番 (3点)`,
  });

  // 三連複フォーメーション（1番手×2-3番手×上位6頭）
  const sanrenPartners = sorted.slice(1, 7);
  recommendations.push({
    type: 'sanrenpuku',
    label: '三連複フォーメーション',
    combination: [pivot.num, sorted[1].num, sorted[2].num, ...sanrenPartners.slice(2).map(h => h.num)],
    reason: `${pivot.num}番×${sorted[1].num},${sorted[2].num}番×上位6頭`,
  });

  return recommendations;
}

/**
 * 投稿対象かどうかを判定（v2: 変更なし）
 */
export function shouldPost(
  prediction: { grade?: string; expectationLevel: number }
): { postToX: boolean; postToNote: boolean } {
  const isGraded = prediction.grade && ['G1', 'G2', 'G3'].includes(prediction.grade);
  const isHighConf = prediction.expectationLevel >= 75;

  return {
    postToX: !!(isGraded || isHighConf),
    postToNote: !!(isGraded && prediction.grade === 'G1'),
  };
}
