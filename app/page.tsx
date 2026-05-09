"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface PivotHorse {
  num: number;
  name: string;
  score: number;
  expectationScore: number;
  sire?: string;
  jockey: string;
  reasons: { label: string; points: number; dataSource: string }[];
}

interface RacePrediction {
  raceId: string;
  raceName: string;
  venue: string;
  raceNumber: number;
  surface: string;
  distance: number;
  condition: string;
  postTime: string;
  grade?: string;
  pivotHorse: PivotHorse;
  expectationLevel: number;
  isGraded: boolean;
  isHighConfidence: boolean;
  shouldBet?: boolean;
}

function getScoreClass(score: number): string {
  if (score >= 80) return "score-fire";
  if (score >= 65) return "score-high";
  if (score >= 50) return "score-mid";
  return "score-low";
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${m}/${day}(${weekday})`;
}

export default function Dashboard() {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [data, setData] = useState<Record<string, RacePrediction[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // 利用可能な日付を取得
  useEffect(() => {
    fetch('/api/scrape')
      .then(res => res.json())
      .then(data => {
        const dates = Object.keys(data.available || {}).sort().reverse();
        setAvailableDates(dates);
        if (dates.length > 0 && !selectedDate) {
          setSelectedDate(dates[0]); // 最新の日付をデフォルト
        }
      })
      .catch(() => {});
  }, []);

  // 予想データの読み込み
  const loadPredictions = useCallback(async (date: string) => {
    if (!date) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/predict?date=${date}`);
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || `予測エラー (HTTP ${res.status})`);
        setData(null);
      } else if (!json.venues || typeof json.venues !== 'object') {
        setError('予測データの形式が不正です（venues が見つかりません）');
        setData(null);
      } else {
        const venues: Record<string, RacePrediction[]> = {};
        for (const [venueName, preds] of Object.entries(json.venues)) {
          venues[venueName] = (preds as any[]).map((p: any) => ({
            raceId: p.race.raceId,
            raceName: p.race.raceName,
            venue: p.race.courseName,
            raceNumber: p.race.raceNumber,
            surface: p.race.surface,
            distance: p.race.distance,
            condition: p.race.condition,
            postTime: p.race.postTime,
            grade: p.race.grade,
            pivotHorse: p.pivotHorse,
            expectationLevel: p.expectationLevel,
            isGraded: p.isGraded,
            isHighConfidence: p.isHighConfidence,
            shouldBet: (p as any).shouldBet,
          }));
        }
        setData(venues);
      }
    } catch (e: any) {
      setError(`読み込みエラー: ${e.message}`);
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedDate) loadPredictions(selectedDate);
  }, [selectedDate, loadPredictions]);

  return (
    <main>
      {/* Date Navigation */}
      <div className="date-nav" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
        {availableDates.map(date => (
          <button
            key={date}
            className={`date-btn ${selectedDate === date ? "active" : ""}`}
            onClick={() => setSelectedDate(date)}
          >
            {formatDateLabel(date)}
          </button>
        ))}
        {availableDates.length === 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            データがありません。<Link href="/settings" style={{ color: 'var(--primary)' }}>⚙️ 設定</Link>からデータを取得してください
          </span>
        )}
      </div>

      {generating && (
        <div style={{
          padding: 12, background: "var(--gold-dim)", color: "var(--gold)",
          borderRadius: "var(--radius-md)", marginBottom: 16, fontWeight: 600,
        }}>
          🧮 予想を生成中... しばらくお待ちください
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner" />
          <p style={{ color: "var(--text-muted)" }}>予想データを読み込み中...</p>
        </div>
      ) : error ? (
        <div className="empty-state">
          <h3>📋 {error}</h3>
          <p style={{ marginTop: 8 }}>
            <Link href="/settings" style={{ color: 'var(--primary)' }}>⚙️ 設定ページ</Link>からデータを取得してください。
          </p>
        </div>
      ) : data ? (
        <div className="venues-grid">
          {Object.entries(data).map(([venueName, races]) => (
            <div key={venueName} className="venue-card">
              <div className="venue-header">
                <span className="venue-name">{venueName}競馬場</span>
                <div className="venue-meta">
                  <span className="venue-condition condition-good">
                    {races[0]?.condition || "良"}
                  </span>
                </div>
              </div>
              <ul className="race-list">
                {races.sort((a, b) => a.raceNumber - b.raceNumber).map((race) => (
                  <li key={race.raceId}>
                    <Link
                      href={`/race/${race.raceId}`}
                      className="race-item"
                      style={{ 
                        textDecoration: "none", color: "inherit",
                        opacity: race.shouldBet === false ? 0.5 : 1,
                      }}
                    >
                      <span className="race-number">{race.raceNumber}R</span>
                      <div className="race-info">
                        <span className={`race-name ${race.isGraded ? "graded" : ""}`}>
                          {race.isGraded && "🏆 "}
                          {race.raceName}
                        </span>
                        <span className="race-condition">
                          {race.surface}{race.distance}m {race.condition}
                          {race.postTime && ` | ${race.postTime}`}
                        </span>
                      </div>
                      <div className="race-pivot">
                        <span className="pivot-horse">
                          {race.pivotHorse.num}番 {race.pivotHorse.name}
                        </span>
                        <div className="pivot-score-container">
                          <span className={`pivot-score ${getScoreClass(race.pivotHorse.expectationScore)}`}>
                            {race.pivotHorse.expectationScore}/100
                          </span>
                          {race.isHighConfidence && (
                            <span className="status-badge status-ready">注目</span>
                          )}
                          {race.shouldBet === false && (
                            <span className="status-badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>SKIP</span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
