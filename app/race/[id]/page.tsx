"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

// デモ用のレース詳細データ
function getSampleRaceDetail(id: string) {
  return {
    raceId: id,
    raceName: "プリンシパルS",
    venue: "東京",
    raceNumber: 11,
    surface: "芝",
    distance: 2200,
    condition: "良",
    postTime: "15:25",
    grade: "リステッド",
    checkCard: {
      tips: [
        "枠: フラット（1枠がやや有利）",
        "脚質: 差しが最有利",
        "上がり最速馬の勝率: 40.9%",
        "種牡馬: ドゥラメンテ、キタサンブラック",
      ],
    },
    pivotHorse: {
      num: 7,
      name: "ジャスティンミラノ",
      score: 89,
      expectationScore: 82,
      sire: "ドゥラメンテ",
      jockey: "ルメール",
      trainer: "友道",
      reasons: [
        { label: "種牡馬◎ 父ドゥラメンテ", points: 25, dataSource: "WR15.3% (72走)", category: "sire" },
        { label: "騎手◎ ルメール", points: 14, dataSource: "リーディング上位", category: "jockey" },
        { label: "厩舎◎ 友道", points: 10, dataSource: "重賞実績上位", category: "trainer" },
        { label: "距離実績◎", points: 8, dataSource: "同距離 2勝/3走 WR66.7%", category: "distance" },
        { label: "1枠◎", points: 8, dataSource: "枠WR10.3%", category: "frame" },
      ],
    },
    allHorses: Array.from({ length: 15 }, (_, i) => ({
      num: i + 1,
      frame: Math.ceil((i + 1) / 2),
      name: [
        "レッドジェネシス", "コスモキュランダ", "エアスピネル", "サリエラ",
        "タスティエーラ", "ソールオリエンス", "ジャスティンミラノ", "レガレイラ",
        "ダノンベルーガ", "プラダリア", "ディープボンド", "シルヴァーソニック",
        "アーバンシック", "サヴォーナ", "テーオーロイヤル"
      ][i],
      sex: i % 3 === 0 ? "牝4" : "牡4",
      jockey: ["田辺", "横山武", "坂井", "川田", "松山", "横山和", "ルメール", "戸崎", "レーン", "池添", "武豊", "M.デムーロ", "菅原明", "三浦", "団野"][i],
      trainer: ["国枝", "矢作", "堀", "友道", "手塚", "池江", "友道", "木村", "中内田", "友道", "須貝", "池江", "堀", "武井", "清水久"][i],
      sire: ["ディープインパクト", "キタサンブラック", "キングカメハメハ", "ディープインパクト", "サトノクラウン", "キタサンブラック", "ドゥラメンテ", "レイデオロ", "ハーツクライ", "ディープインパクト", "キズナ", "ハービンジャー", "スワーヴリチャード", "ドゥラメンテ", "リオンディーズ"][i],
      score: 89 - i * 4 + Math.floor(Math.random() * 8 - 4),
      expectationScore: Math.max(30, 82 - i * 4 + Math.floor(Math.random() * 8 - 4)),
      odds: (1.5 + i * 1.2 + Math.random() * 3).toFixed(1),
      popularity: i + 1,
      reasons: [
        { label: i === 6 ? "種牡馬◎" : i < 3 ? "種牡馬○" : "—", points: i === 6 ? 25 : i < 3 ? 18 : 0, dataSource: "" },
      ],
      distanceRecord: i < 5 ? { runs: 3 + i, wins: 1, top3: 2, winRate: 20, top3Rate: 40 } : undefined,
      courseRecord: i < 4 ? { runs: 2, wins: 1, top3: 1, winRate: 50, top3Rate: 50 } : undefined,
      recentHistory: [
        { date: 20260419, course: "中山", surface: "芝", distance: 2000, finish: i < 3 ? 1 : i + 1, last3f: 33.5 + Math.random(), condition: "良" },
        { date: 20260322, course: "阪神", surface: "芝", distance: 2200, finish: Math.ceil(Math.random() * 5), last3f: 34.0 + Math.random(), condition: "稍重" },
      ],
    })),
    recommendations: [
      { type: "wide", label: "ワイド", combination: [7, 4], reason: "スコア上位2頭" },
      { type: "umaren", label: "馬連", combination: [7, 4], reason: "スコア上位2頭の組み合わせ" },
      { type: "sanrenpuku", label: "三連複BOX", combination: [7, 4, 5], reason: "スコア上位3頭のBOX" },
      { type: "tansho", label: "単勝", combination: [7], reason: "スコア最上位" },
    ],
    expectationLevel: 82,
    isGraded: true,
    isHighConfidence: true,
  };
}

function getScoreClass(score: number): string {
  if (score >= 80) return "score-fire";
  if (score >= 65) return "score-high";
  if (score >= 50) return "score-mid";
  return "score-low";
}

export default function RaceDetail() {
  const params = useParams();
  const raceId = params.id as string;
  const [showPostPreview, setShowPostPreview] = useState(false);

  const race = getSampleRaceDetail(raceId);

  return (
    <main>
      <Link href="/" className="btn btn-ghost" style={{ marginBottom: 16 }}>
        ← ダッシュボードに戻る
      </Link>

      {/* Race Header */}
      <div className="race-detail-header">
        <div>
          <h2 className="race-detail-title">
            {race.isGraded && "🏆 "}
            {race.venue} {race.raceNumber}R {race.raceName}
          </h2>
          <div className="race-detail-meta">
            {race.grade && <span className="meta-badge grade">{race.grade}</span>}
            <span className="meta-badge">{race.surface}{race.distance}m</span>
            <span className="meta-badge">{race.condition}</span>
            <span className="meta-badge">発走 {race.postTime}</span>
            <span className="meta-badge">全{race.allHorses.length}頭</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {race.isHighConfidence && (
            <button className="btn btn-primary" onClick={() => setShowPostPreview(!showPostPreview)}>
              📤 投稿プレビュー
            </button>
          )}
        </div>
      </div>

      {/* Check Card */}
      <div className="check-card">
        <h3>📊 コースデータチェックカード（過去10年）</h3>
        <ul>
          {race.checkCard.tips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      </div>

      {/* Pivot Horse Card */}
      <div className="pivot-card">
        <div className="label">🎯 軸馬</div>
        <div className="horse-name">
          {race.pivotHorse.num}番 {race.pivotHorse.name}
        </div>
        <div className="horse-details">
          父{race.pivotHorse.sire} / {race.pivotHorse.jockey} / {race.pivotHorse.trainer}厩舎
        </div>
        <div className="score-display">
          <span className="score-number">{race.pivotHorse.expectationScore}</span>
          <span className="score-label">/ 100 期待値スコア</span>
        </div>
        <div className="pivot-reasons">
          {race.pivotHorse.reasons.map((r, i) => (
            <span key={i} className={`reason-tag ${r.points > 0 ? "positive" : r.points < 0 ? "negative" : ""}`}>
              {r.label} (+{r.points}pt) {r.dataSource}
            </span>
          ))}
        </div>
      </div>

      {/* Bet Recommendations */}
      <div className="bet-section">
        <h3>💡 おすすめ買い目</h3>
        {race.recommendations.map((bet, i) => (
          <div key={i} className="bet-item">
            <span className={`bet-type ${bet.type}`}>{bet.label}</span>
            <span className="bet-combo">{bet.combination.join(" - ")}</span>
            <span className="bet-reason">{bet.reason}</span>
          </div>
        ))}
      </div>

      {/* All Horses Table */}
      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>📋 全馬スコアリング</h3>
      <table className="horse-table">
        <thead>
          <tr>
            <th>枠</th>
            <th>馬番</th>
            <th>馬名</th>
            <th>性齢</th>
            <th>騎手</th>
            <th>調教師</th>
            <th>父</th>
            <th>オッズ</th>
            <th>スコア</th>
            <th>期待値</th>
          </tr>
        </thead>
        <tbody>
          {race.allHorses.map((horse: any) => (
            <tr key={horse.num} style={horse.num === race.pivotHorse.num ? { background: "rgba(251, 191, 36, 0.05)" } : {}}>
              <td><span className={`waku-badge waku-${horse.frame}`}>{horse.frame}</span></td>
              <td style={{ fontWeight: 700 }}>{horse.num}</td>
              <td style={{ fontWeight: horse.num === race.pivotHorse.num ? 800 : 500 }}>
                {horse.num === race.pivotHorse.num && "🎯 "}
                {horse.name}
              </td>
              <td style={{ color: "var(--text-muted)" }}>{horse.sex}</td>
              <td>{horse.jockey}</td>
              <td style={{ color: "var(--text-muted)" }}>{horse.trainer}</td>
              <td style={{ color: "var(--text-secondary)" }}>{horse.sire}</td>
              <td style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{horse.odds}</td>
              <td><strong>{horse.score}pt</strong></td>
              <td>
                <span className={`pivot-score ${getScoreClass(horse.expectationScore)}`}>
                  {horse.expectationScore}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Post Preview Modal */}
      {showPostPreview && (
        <div className="settings-section" style={{ borderColor: "var(--gold)", borderWidth: 2 }}>
          <h2>📤 X投稿プレビュー</h2>
          <div style={{
            background: "var(--bg-input)",
            padding: 16,
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.9rem",
            lineHeight: 1.8,
            whiteSpace: "pre-wrap",
            color: "var(--text-primary)",
          }}>
{`【${race.venue} ${race.raceNumber}R ${race.raceName}】🏆
${race.surface}${race.distance}m ${race.condition} | 発走 ${race.postTime}

自信度: ★★★★☆

◎ ${race.pivotHorse.num} ${race.pivotHorse.name}
父${race.pivotHorse.sire} / ${race.pivotHorse.jockey}
${race.pivotHorse.reasons.map(r => `・${r.label} ${r.dataSource}`).join('\n')}

💡 推奨馬券
ワイド ${race.recommendations[0]?.combination.join('-')}
馬連 ${race.recommendations[1]?.combination.join('-')}

この予想に乗る人は「いいね」で教えてください！

#競馬予想 #${race.raceName} #データ分析`}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary">🐦 Xに投稿</button>
            <button className="btn btn-secondary" onClick={() => setShowPostPreview(false)}>閉じる</button>
          </div>
        </div>
      )}
    </main>
  );
}
