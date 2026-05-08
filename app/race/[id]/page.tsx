"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";

interface ScoreReason {
  category?: string;
  label: string;
  points: number;
  dataSource: string;
}

interface PivotHorse {
  num: number;
  name: string;
  score: number;
  expectationScore: number;
  sire?: string;
  jockey?: string;
  trainer?: string;
  reasons: ScoreReason[];
}

interface AllHorse {
  num: number;
  frame: number;
  name: string;
  sex: string;
  jockey: string;
  trainer: string;
  sire?: string;
  score: number;
  expectationScore: number;
  reasons: ScoreReason[];
  odds?: number;
  popularity?: number;
  distanceRecord?: { runs: number; wins: number; top3: number; winRate: number; top3Rate: number };
  courseRecord?: { runs: number; wins: number; top3: number; winRate: number; top3Rate: number };
  recentHistory?: { date: number; course: string; surface: string; distance: number; finish: number; last3f: number; condition: string }[];
}

interface Recommendation {
  type: string;
  label: string;
  combination: number[];
  reason: string;
}

interface CheckCard {
  condition?: string;
  tips: string[];
  frameSummary?: string;
  styleSummary?: string;
  sireSummary?: string;
}

interface RaceDetailData {
  raceId: string;
  raceName: string;
  venue: string;
  raceNumber: number;
  surface: string;
  distance: number;
  condition: string;
  postTime: string;
  grade?: string;
  checkCard: CheckCard;
  pivotHorse: PivotHorse;
  allHorses: AllHorse[];
  recommendations: Recommendation[];
  expectationLevel: number;
  isGraded: boolean;
  isHighConfidence: boolean;
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
  const [race, setRace] = useState<RaceDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!raceId) return;
    setLoading(true);
    fetch(`/api/race/${raceId}`)
      .then(async res => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        return json;
      })
      .then(json => {
        setRace(json.prediction as RaceDetailData);
        setError("");
      })
      .catch(e => {
        setError(e.message || "読み込みエラー");
        setRace(null);
      })
      .finally(() => setLoading(false));
  }, [raceId]);

  if (loading) {
    return (
      <main>
        <Link href="/" className="btn btn-ghost" style={{ marginBottom: 16 }}>
          ← ダッシュボードに戻る
        </Link>
        <div className="loading-container">
          <div className="loading-spinner" />
          <p style={{ color: "var(--text-muted)" }}>レース情報を読み込み中...</p>
        </div>
      </main>
    );
  }

  if (error || !race) {
    return (
      <main>
        <Link href="/" className="btn btn-ghost" style={{ marginBottom: 16 }}>
          ← ダッシュボードに戻る
        </Link>
        <div className="empty-state">
          <h3>📋 {error || "レースデータが見つかりません"}</h3>
          <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
            該当の出走表データが取得できていない可能性があります。
            <Link href="/settings" style={{ color: 'var(--primary)' }}>⚙️ 設定</Link>からデータ取得・予想生成を実行してください。
          </p>
        </div>
      </main>
    );
  }

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
            {race.postTime && <span className="meta-badge">発走 {race.postTime}</span>}
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
      {race.checkCard?.tips && race.checkCard.tips.length > 0 && (
        <div className="check-card">
          <h3>📊 コースデータチェックカード（過去10年）</h3>
          <ul>
            {race.checkCard.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Pivot Horse Card */}
      <div className="pivot-card">
        <div className="label">🎯 軸馬</div>
        <div className="horse-name">
          {race.pivotHorse.num}番 {race.pivotHorse.name}
        </div>
        <div className="horse-details">
          {race.pivotHorse.sire && `父${race.pivotHorse.sire} / `}
          {race.pivotHorse.jockey}
          {race.pivotHorse.trainer && ` / ${race.pivotHorse.trainer}厩舎`}
        </div>
        <div className="score-display">
          <span className="score-number">{race.pivotHorse.expectationScore}</span>
          <span className="score-label">/ 100 期待値スコア</span>
        </div>
        {race.pivotHorse.reasons && race.pivotHorse.reasons.length > 0 && (
          <div className="pivot-reasons">
            {race.pivotHorse.reasons.map((r, i) => (
              <span key={i} className={`reason-tag ${r.points > 0 ? "positive" : r.points < 0 ? "negative" : ""}`}>
                {r.label} ({r.points >= 0 ? '+' : ''}{r.points}pt) {r.dataSource}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Bet Recommendations */}
      {race.recommendations && race.recommendations.length > 0 && (
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
      )}

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
          {race.allHorses.map((horse) => (
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
              <td style={{ color: "var(--text-secondary)" }}>{horse.sire || '—'}</td>
              <td style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                {horse.odds ? horse.odds.toFixed(1) : '—'}
              </td>
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
{`【${race.venue} ${race.raceNumber}R ${race.raceName}】${race.isGraded ? '🏆' : ''}
${race.surface}${race.distance}m ${race.condition}${race.postTime ? ` | 発走 ${race.postTime}` : ''}

自信度: ${'★'.repeat(Math.min(5, Math.max(1, Math.floor(race.expectationLevel / 20))))}

◎ ${race.pivotHorse.num} ${race.pivotHorse.name}
${race.pivotHorse.sire ? `父${race.pivotHorse.sire}` : ''}${race.pivotHorse.jockey ? ` / ${race.pivotHorse.jockey}` : ''}
${(race.pivotHorse.reasons || []).map(r => `・${r.label} ${r.dataSource}`).join('\n')}

${race.recommendations[0] ? `💡 推奨買い目\nワイド ${race.recommendations[0].combination.join('-')}` : ''}
${race.recommendations[1] ? `馬連 ${race.recommendations[1].combination.join('-')}` : ''}

#競馬予想 #${race.raceName} #データ分析`}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setShowPostPreview(false)}>閉じる</button>
          </div>
        </div>
      )}
    </main>
  );
}
