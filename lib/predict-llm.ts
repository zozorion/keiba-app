/**
 * LLM予測強化モジュール
 *
 * ヒューリスティックscoring（過去データ事実ベース）の上に、Gemini Proによる
 * 総合分析レイヤーを重ねる。Geminiは下記をベースに判断：
 * - 騎手のリーディング順位・コース得意不得意（モデル知識）
 * - 種牡馬の距離適性・芝ダ適性（モデル知識）
 * - 各競馬場のトラックバイアス・脚質傾向（モデル知識）
 * - レース条件（距離・馬場・グレード・頭数）
 *
 * 過去データファイル(data/raw/) が無い環境でも動作する。
 * Geminiが失敗した場合はヒューリスティック結果をそのまま返すため安全。
 */

import { generateWithGemini, isGeminiConfigured } from './gemini';
import type { PredictionResult, ScoredHorse, BetRecommendation, ScoreReason } from '../engine/types';

const SYSTEM_INSTRUCTION = `あなたはJRA中央競馬の専門家アナリストです。
- 直近の騎手リーディング順位・短期成績・コース得意不得意を把握している
- 主要種牡馬の距離適性・芝ダ適性・馬場適性を把握している
- 各競馬場のトラックバイアス・脚質傾向（東京=差し有利, 中山=先行有利 等）を把握している
- 配当（ROI）最大化を最優先とし、人気馬の信頼度を盲信しない
- データ事実に基づき、推測は最小限にとどめる

回答は必ず指定されたJSONのみで、前後に説明文を一切含めない。`;

interface LLMHorseEval {
  num: number;
  score: number;       // 0-100 信頼度
  note: string;        // 短評
}

interface LLMRaceAnalysis {
  pivot_num: number;
  confidence: number;
  key_reasons: string[];
  horse_evaluations: LLMHorseEval[];   // 全頭評価
  rivals: number[];
  danger_horses: number[];
  betting_advice: string;
}

function buildPrompt(prediction: PredictionResult): string {
  const r = prediction.race;
  const heur = prediction.scoredHorses;

  const entriesText = heur
    .sort((a, b) => a.num - b.num)
    .map(h => {
      const oddsStr = h.odds ? `${h.odds}倍` : '-';
      const popStr = h.popularity ? `${h.popularity}人気` : '-';
      const sireStr = h.sire || '-';
      return `${h.frame}-${h.num} ${h.name} ${h.sex} 斤${h.weightCarry}kg | 騎:${h.jockey} 厩:${h.trainer} 父:${sireStr} | ${oddsStr} ${popStr}`;
    }).join('\n');

  // ヒューリスティック上位3頭をヒントとして提示（過信させないようコンテキスト扱い）
  const heurTop3 = [...heur].sort((a, b) => b.score - a.score).slice(0, 3)
    .map(h => `${h.num}番${h.name}(参考スコア${h.score})`).join(', ');

  return `【レース】
${r.courseName}競馬場 ${r.raceNumber}R ${r.raceName}
${r.surface}${r.distance}m / 馬場:${r.condition} / 天候:${r.weather} / 発走:${r.postTime}
${r.grade ? `グレード: ${r.grade}` : 'クラス: 平場'}
出走頭数: ${r.entries.length}頭

【出走表】
${entriesText}

【参考: 単純スコア上位】
${heurTop3}
（注: 上記スコアは騎手程度しか見ていない簡易計算。最終判断は総合分析で）

【指示】
このレースを総合分析し、軸馬の選定 + 出走全頭への信頼度評価をしてください。

■ 軸馬: 最も「3着以内に来やすい」1頭。信頼度0-100。理由は短い箇条書き2〜4個（騎手×厩舎相性、血統と距離・芝ダの適性、コース形態と脚質の合致、枠順バイアス、近走内容など具体的に）。

■ 全頭評価: 出走全${r.entries.length}頭それぞれに 0-100 の信頼度を独立に振る（合計値ではない）。目安：
  - 80-95 = ◎軸候補級
  - 65-79 = ○対抗・上位
  - 50-64 = △押さえ・中位
  - 35-49 = ▲軽視
  - 0-34  = ×消し
各馬に20〜40字の短評（注目点 or 不安点）。

■ 対抗馬: 軸とのワイドが本線になる2〜3頭の馬番
■ 危険馬: 人気だが消し候補（信頼できない馬）最大2頭の馬番
■ 買い目アドバイス: 軸+相手の点数・推奨券種を1文で

JSONのみで返答（前後に説明文やコードブロック禁止）:
{
  "pivot_num": <軸馬番>,
  "confidence": <0-100>,
  "key_reasons": ["軸選定の根拠1", "..."],
  "horse_evaluations": [
    { "num": <馬番>, "score": <0-100>, "note": "<20〜40字の短評>" },
    ... 全頭分（出走頭数と同じ件数を返す）
  ],
  "rivals": [<対抗馬番>, ...],
  "danger_horses": [<危険馬番>, ...],
  "betting_advice": "<短評>"
}`;
}

function tryParseJSON(text: string): LLMRaceAnalysis | null {
  // 前後の説明やコードブロックを除去
  let s = text.trim();
  // ```json ... ``` 形式を剥がす
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  // 最初の { から最後の } までを抽出
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const jsonStr = s.substring(start, end + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed.pivot_num !== 'number' || typeof parsed.confidence !== 'number') return null;
    const evals: LLMHorseEval[] = Array.isArray(parsed.horse_evaluations)
      ? parsed.horse_evaluations
          .filter((e: any) => typeof e?.num === 'number' && typeof e?.score === 'number')
          .map((e: any) => ({
            num: e.num,
            score: Math.max(0, Math.min(100, Math.round(e.score))),
            note: typeof e.note === 'string' ? e.note.trim() : '',
          }))
      : [];
    return {
      pivot_num: parsed.pivot_num,
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence))),
      key_reasons: Array.isArray(parsed.key_reasons) ? parsed.key_reasons.map(String) : [],
      horse_evaluations: evals,
      rivals: Array.isArray(parsed.rivals) ? parsed.rivals.filter((n: any) => typeof n === 'number') : [],
      danger_horses: Array.isArray(parsed.danger_horses) ? parsed.danger_horses.filter((n: any) => typeof n === 'number') : [],
      betting_advice: typeof parsed.betting_advice === 'string' ? parsed.betting_advice : '',
    };
  } catch {
    return null;
  }
}

/**
 * 単一レースを Gemini で総合分析し、PredictionResult を上書きして返す。
 * 失敗時は元の prediction をそのまま返す（throwしない）。
 */
export async function enhancePredictionWithLLM(
  prediction: PredictionResult
): Promise<PredictionResult & { llmEnhanced?: boolean; llmAdvice?: string }> {
  if (!isGeminiConfigured()) return prediction;

  const prompt = buildPrompt(prediction);
  const result = await generateWithGemini({
    systemInstruction: SYSTEM_INSTRUCTION,
    userPrompt: prompt,
    temperature: 0.4,        // 競馬予測は再現性重視で低め
    maxOutputTokens: 4096,   // 全頭評価を含むため拡大
  });

  if (!result.ok) {
    console.warn(`[LLM] race ${prediction.race.raceId} 失敗: ${result.error}`);
    return prediction;
  }

  const analysis = tryParseJSON(result.text);
  if (!analysis) {
    console.warn(`[LLM] race ${prediction.race.raceId} JSON解析失敗`);
    return prediction;
  }

  // pivot_num に該当する馬を探す
  const pivot = prediction.scoredHorses.find(h => h.num === analysis.pivot_num);
  if (!pivot) {
    console.warn(`[LLM] race ${prediction.race.raceId} 軸馬${analysis.pivot_num}番が出走表に存在しない`);
    return prediction;
  }

  // 全頭評価をマップ化
  const evalMap = new Map<number, LLMHorseEval>();
  for (const e of analysis.horse_evaluations) evalMap.set(e.num, e);

  // 軸馬の詳細理由（pivot_reasons）
  const pivotKeyReasons: ScoreReason[] = analysis.key_reasons.map(reason => ({
    category: 'class' as const,
    label: reason,
    // 軸馬の最終信頼度から50を引いた値を理由数で按分
    points: Math.max(1, Math.round((analysis.confidence - 50) / Math.max(1, analysis.key_reasons.length))),
    dataSource: '🤖 Gemini分析',
  }));

  // 各馬を更新（Geminiスコアでexpectationを上書き、短評をreasonとして追加）
  const updatedHorses: ScoredHorse[] = prediction.scoredHorses.map(h => {
    const ev = evalMap.get(h.num);
    if (!ev) return h; // Gemini評価が無い馬はヒューリスティックのまま

    const isPivot = h.num === pivot.num;
    const noteReason: ScoreReason = {
      category: 'class' as const,
      label: ev.note || `Gemini信頼度${ev.score}`,
      points: ev.score - 50,  // ベース50からの差分
      dataSource: '🤖 Gemini分析',
    };

    return {
      ...h,
      expectationScore: ev.score,
      reasons: isPivot
        ? [...pivotKeyReasons, noteReason, ...h.reasons]   // 軸: 詳細理由 + 短評 + ヒューリスティック
        : [noteReason, ...h.reasons],                       // 他: 短評 + ヒューリスティック
    };
  });

  const enhancedPivot = updatedHorses.find(h => h.num === pivot.num) || pivot;

  // 買い目を LLM の対抗馬・危険馬を反映して再生成
  const rivals = analysis.rivals
    .map(num => updatedHorses.find(h => h.num === num))
    .filter((h): h is ScoredHorse => !!h);
  const dangerSet = new Set(analysis.danger_horses);

  // 対抗馬が足りなければスコア順で補完
  const sortedNonPivot = [...updatedHorses]
    .filter(h => h.num !== pivot.num && !dangerSet.has(h.num))
    .sort((a, b) => b.score - a.score);
  const widePartners: ScoredHorse[] = [];
  for (const r of rivals) {
    if (!widePartners.some(w => w.num === r.num)) widePartners.push(r);
  }
  for (const h of sortedNonPivot) {
    if (widePartners.length >= 4) break;
    if (!widePartners.some(w => w.num === h.num)) widePartners.push(h);
  }

  const recommendations: BetRecommendation[] = [
    {
      type: 'wide',
      label: 'ワイド流し',
      combination: [pivot.num, ...widePartners.map(h => h.num)],
      reason: `軸${pivot.num}番→対抗${rivals.map(r => r.num).join(',') || '不在(スコア順補完)'} (${widePartners.length}点)`,
    },
    {
      type: 'tansho',
      label: '単勝',
      combination: [pivot.num],
      reason: `LLM自信度${analysis.confidence}/100`,
    },
  ];

  if (widePartners.length >= 2) {
    recommendations.push({
      type: 'umaren',
      label: '馬連流し',
      combination: [pivot.num, ...widePartners.slice(0, 3).map(h => h.num)],
      reason: `${pivot.num}番→${widePartners.slice(0, 3).map(h => h.num).join(',')}番`,
    });
  }
  if (widePartners.length >= 3) {
    recommendations.push({
      type: 'sanrenpuku',
      label: '三連複フォーメーション',
      combination: [pivot.num, ...widePartners.slice(0, 4).map(h => h.num)],
      reason: `${pivot.num}番×${widePartners.slice(0, 4).map(h => h.num).join(',')}番BOX`,
    });
  }

  // チェックカードの先頭にLLMアドバイスを追加
  const enhancedCheckCard = {
    ...prediction.checkCard,
    tips: [
      `🤖 ${analysis.betting_advice}`,
      ...(analysis.danger_horses.length > 0
        ? [`⚠️ 危険馬: ${analysis.danger_horses.map(n => `${n}番`).join(', ')}`]
        : []),
      ...(prediction.checkCard?.tips || []),
    ],
  };

  return {
    ...prediction,
    scoredHorses: updatedHorses,
    pivotHorse: enhancedPivot,
    expectationLevel: analysis.confidence,
    recommendations,
    checkCard: enhancedCheckCard,
    isHighConfidence: analysis.confidence >= 70,
    llmEnhanced: true,
    llmAdvice: analysis.betting_advice,
  };
}

/**
 * 複数レースを並列で LLM 強化する（同時実行数制限あり）
 */
export async function enhancePredictionsParallel(
  predictions: PredictionResult[],
  concurrency: number = 4
): Promise<PredictionResult[]> {
  if (!isGeminiConfigured()) {
    console.log('[LLM] GEMINI_API_KEY未設定 → ヒューリスティックのみ');
    return predictions;
  }

  const results: PredictionResult[] = new Array(predictions.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= predictions.length) break;
      try {
        results[i] = await enhancePredictionWithLLM(predictions[i]);
      } catch (e: any) {
        console.warn(`[LLM] worker error race ${predictions[i].race.raceId}: ${e.message}`);
        results[i] = predictions[i];
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, predictions.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
