"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface RaceResultData {
  raceId: string;
  raceName: string;
  venue: string;
  raceNumber: number;
  surface: string;
  distance: number;
  grade?: string;
  shouldBet: boolean;
  skipReasons: string[];
  pivot: { num: number; name: string; score: number; finish: number; inTop3: boolean; odds: number; popularity: number };
  winner: { num: number; name: string; odds: number };
  top3: number[];
  bets: {
    wide: { hit: boolean; return: number };
    umaren: { hit: boolean; return: number };
    sanrenpuku: { hit: boolean; return: number };
    tansho: { hit: boolean; return: number };
  };
}

interface VenueStats {
  venue: string;
  total: number;
  pivotRate: number;
  wideRate: number;
  wideROI: number;
  umarenROI: number;
  sanrenpukuROI: number;
  tanshoROI: number;
}

interface TotalStats {
  total: number;
  pivotHits: number;
  pivotRate: number;
  wideHits: number;
  wideRate: number;
  wideROI: number;
  umarenHits: number;
  umarenROI: number;
  sanrenpukuHits: number;
  sanrenpukuROI: number;
  tanshoHits: number;
  tanshoROI: number;
}

interface FilteredStats {
  total: number;
  skipped: number;
  wideROI: number;
  tanshoROI: number;
  wideHits: number;
  tanshoHits: number;
}

interface ResultsResponse {
  date: string;
  totalStats: TotalStats;
  filteredStats: FilteredStats;
  venueStats: VenueStats[];
  raceResults: RaceResultData[];
}

function roiColor(roi: number): string {
  if (roi >= 100) return "var(--green)";
  if (roi >= 70) return "var(--gold)";
  return "var(--fire)";
}

function roiBg(roi: number): string {
  if (roi >= 100) return "var(--green-dim)";
  if (roi >= 70) return "var(--gold-dim)";
  return "var(--fire-dim)";
}

export default function ResultsPage() {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 結果データがある日付を取得
  useEffect(() => {
    fetch('/api/scrape')
      .then(r => r.json())
      .then(d => {
        const dates = Object.entries(d.available || {})
          .filter(([, v]: [string, any]) => v.hasResults)
          .map(([k]) => k)
          .sort()
          .reverse();
        setAvailableDates(dates);
        if (dates.length > 0 && !date) setDate(dates[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setError("");
    fetch(`/api/results?date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); setData(null); }
        else { setData(d); }
        setLoading(false);
      })
      .catch(() => { setError("データの読み込みに失敗しました"); setLoading(false); });
  }, [date]);

  function formatDateLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return `${m}/${day}(${weekday})`;
  }

  return (
    <main>
      <Link href="/" className="btn btn-ghost" style={{ marginBottom: 16 }}>
        ← ダッシュボードに戻る
      </Link>

      <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 24 }}>
        📊 結果検証 {date && `— ${date}`}
      </h2>

      <div className="date-nav" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
        {availableDates.map(d => (
          <button
            key={d}
            className={`date-btn ${date === d ? "active" : ""}`}
            onClick={() => setDate(d)}
          >
            {formatDateLabel(d)}
          </button>
        ))}
        {availableDates.length === 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            結果データがありません。<Link href="/settings" style={{ color: 'var(--primary)' }}>⚙️ 設定</Link>からデータを取得してください
          </span>
        )}
      </div>

      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner" />
          <p style={{ color: "var(--text-muted)" }}>結果を読み込み中...</p>
        </div>
      ) : error ? (
        <div className="empty-state">
          <h3>{error}</h3>
          <p>先に予想を生成してから結果検証を行ってください。</p>
        </div>
      ) : data ? (
        <>
          {/* Overall Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
            <StatCard label="対象レース" value={`${data.totalStats.total}`} unit="レース" />
            <StatCard label="軸馬3着内率" value={`${data.totalStats.pivotRate}`} unit="%" color={data.totalStats.pivotRate >= 30 ? "var(--green)" : "var(--fire)"} />
            <StatCard label="ワイド的中率" value={`${data.totalStats.wideRate}`} unit="%" color={data.totalStats.wideRate >= 20 ? "var(--green)" : "var(--fire)"} />
            <StatCard label="ワイド回収率" value={`${data.totalStats.wideROI}`} unit="%" color={roiColor(data.totalStats.wideROI)} />
            <StatCard label="馬連回収率" value={`${data.totalStats.umarenROI}`} unit="%" color={roiColor(data.totalStats.umarenROI)} />
            <StatCard label="三連複回収率" value={`${data.totalStats.sanrenpukuROI}`} unit="%" color={roiColor(data.totalStats.sanrenpukuROI)} />
            <StatCard label="単勝回収率" value={`${data.totalStats.tanshoROI}`} unit="%" color={roiColor(data.totalStats.tanshoROI)} />
          </div>

          {/* Filtered Stats */}
          {data.filteredStats && data.filteredStats.skipped > 0 && (
            <div style={{
              background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: 12, padding: '16px 20px', marginBottom: 32,
              display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>🎯 推奨レースのみ</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f1f5f9', marginLeft: 8 }}>
                  {data.filteredStats.total}R
                </span>
                <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: 4 }}>
                  ({data.filteredStats.skipped}Rスキップ)
                </span>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>ワイドROI</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: roiColor(data.filteredStats.wideROI), marginLeft: 8 }}>
                  {data.filteredStats.wideROI}%
                </span>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>単勝ROI</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: roiColor(data.filteredStats.tanshoROI), marginLeft: 8 }}>
                  {data.filteredStats.tanshoROI}%
                </span>
              </div>
            </div>
          )}

          {/* Venue Stats */}
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>🏟️ 競馬場別成績</h3>
          <table className="horse-table" style={{ marginBottom: 32 }}>
            <thead>
              <tr>
                <th>競馬場</th>
                <th>レース数</th>
                <th>軸馬3着内</th>
                <th>ワイド的中</th>
                <th>ワイドROI</th>
                <th>馬連ROI</th>
                <th>三連複ROI</th>
                <th>単勝ROI</th>
              </tr>
            </thead>
            <tbody>
              {data.venueStats.map((vs) => (
                <tr key={vs.venue}>
                  <td style={{ fontWeight: 700 }}>{vs.venue}</td>
                  <td>{vs.total}</td>
                  <td>{vs.pivotRate}%</td>
                  <td>{vs.wideRate}%</td>
                  <td style={{ color: roiColor(vs.wideROI), fontWeight: 700 }}>{vs.wideROI}%</td>
                  <td style={{ color: roiColor(vs.umarenROI), fontWeight: 700 }}>{vs.umarenROI}%</td>
                  <td style={{ color: roiColor(vs.sanrenpukuROI), fontWeight: 700 }}>{vs.sanrenpukuROI}%</td>
                  <td style={{ color: roiColor(vs.tanshoROI), fontWeight: 700 }}>{vs.tanshoROI}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Per-Race Results */}
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>📋 レース別結果</h3>
          <table className="horse-table">
            <thead>
              <tr>
                <th>レース</th>
                <th>レース名</th>
                <th>条件</th>
                <th>軸馬</th>
                <th>着順</th>
                <th>勝ち馬</th>
                <th>ワイド</th>
                <th>馬連</th>
                <th>三連複</th>
                <th>単勝</th>
              </tr>
            </thead>
            <tbody>
              {data.raceResults.map((r) => (
                <tr key={r.raceId} style={{
                  background: !r.shouldBet ? 'rgba(100,116,139,0.08)' :
                              r.pivot.inTop3 ? 'rgba(34, 197, 94, 0.05)' : undefined,
                  opacity: !r.shouldBet ? 0.6 : 1,
                }}>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {r.venue}{r.raceNumber}R
                    {!r.shouldBet && (
                      <span style={{ fontSize: '0.6rem', color: '#ef4444', display: 'block' }}>
                        SKIP
                      </span>
                    )}
                  </td>
                  <td style={{ fontWeight: r.grade ? 700 : 500, color: r.grade ? "var(--gold)" : "inherit" }}>
                    {r.grade ? "🏆 " : ""}{r.raceName}
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                    {r.surface}{r.distance}m
                  </td>
                  <td>
                    {r.pivot.num}番 {r.pivot.name}
                    <br />
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      期待値{r.pivot.score}
                    </span>
                    {r.pivot.odds > 0 && (
                      <>
                        <br />
                        <span style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: r.pivot.popularity <= 3 ? "var(--gold)" :
                                 r.pivot.popularity <= 6 ? "var(--text-secondary)" : "var(--green)",
                        }}>
                          {r.pivot.popularity}番人気 / {r.pivot.odds}倍
                        </span>
                      </>
                    )}
                  </td>
                  <td style={{
                    fontWeight: 800,
                    color: r.pivot.finish === 1 ? "var(--gold)" :
                           r.pivot.finish <= 3 ? "var(--green)" :
                           r.pivot.finish <= 5 ? "var(--text-secondary)" : "var(--fire)",
                  }}>
                    {r.pivot.finish}着
                  </td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {r.winner.num}番 {r.winner.name}
                    <br />
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      {r.winner.odds}倍
                    </span>
                  </td>
                  <td>
                    <HitBadge hit={r.bets.wide.hit} amount={r.bets.wide.return} />
                  </td>
                  <td>
                    <HitBadge hit={r.bets.umaren.hit} amount={r.bets.umaren.return} />
                  </td>
                  <td>
                    <HitBadge hit={r.bets.sanrenpuku.hit} amount={r.bets.sanrenpuku.return} />
                  </td>
                  <td>
                    <HitBadge hit={r.bets.tansho.hit} amount={r.bets.tansho.return} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}

function StatCard({ label, value, unit, color }: {
  label: string; value: string; unit: string; color?: string;
}) {
  return (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-lg)",
      padding: "16px 20px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
        <span style={{ fontSize: "1.8rem", fontWeight: 900, color: color || "var(--text-primary)" }}>
          {value}
        </span>
        <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{unit}</span>
      </div>
    </div>
  );
}

function HitBadge({ hit, amount }: { hit: boolean; amount: number }) {
  if (hit) {
    return (
      <span style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "var(--radius-sm)",
        background: "var(--green-dim)",
        color: "var(--green)",
        fontWeight: 700,
        fontSize: "0.8rem",
      }}>
        ◎ {amount}円
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "var(--radius-sm)",
      background: "var(--bg-input)",
      color: "var(--text-muted)",
      fontSize: "0.75rem",
    }}>
      ✗
    </span>
  );
}
