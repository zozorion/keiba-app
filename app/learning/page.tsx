'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface VenueWeek {
  venue: string;
  racesCount: number;
  pivotTop3Rate: number;
  wideHits: number;
  wideROI: number;
  tanshoROI: number;
  factorAnalysis: Record<string, { avgHitScore: number; avgMissScore: number; hitContribution: number; sampleSize: number }>;
  insights: string[];
  adjustments: string[];
}

interface WeekData { date: string; venues: VenueWeek[]; }

interface TuningData {
  venue: string; venueEn: string; weeksLearned: number; totalRaces: number;
  lastLearnDate: string;
  weights: { sireMaxPoints: number; jockeyMultiplier: number; trainerMultiplier: number; frameMaxPoints: number; widePartnerCount: number };
  performance: { pivotTop3Rate: number; wideHitRate: number; wideROI: number; tanshoROI: number };
}

interface ProfileData {
  name: string; sireMultiplier: number; jockeyMultiplier: number; trainerMultiplier: number;
  frameMultiplier: number; distanceMultiplier: number; courseMultiplier: number;
  turfAdjust: number; dirtAdjust: number; pivotStrategy: string;
  distanceTrust: { sprint: number; mile: number; middle: number; long: number };
  widePartnersSmall: number; widePartnersMedium: number; widePartnersLarge: number;
}

type Tab = 'profiles' | 'tuning' | 'history';

export default function LearningPage() {
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [tunings, setTunings] = useState<TuningData[]>([]);
  const [profiles, setProfiles] = useState<ProfileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [learning, setLearning] = useState(false);
  const [learnDate, setLearnDate] = useState('2026-05-03');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<Tab>('profiles');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/learn');
      const data = await res.json();
      setWeeks(data.history || []);
      setTunings(data.tunings || []);
      setProfiles(data.profiles || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runLearning = async () => {
    setLearning(true); setMessage('');
    try {
      const res = await fetch(`/api/learn?date=${learnDate}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMessage(`✅ ${learnDate}の学習完了！${data.venueResults.length}会場を分析`);
        fetchData();
      } else { setMessage(`❌ ${data.error}`); }
    } catch (e: any) { setMessage(`❌ ${e.message}`); }
    finally { setLearning(false); }
  };

  const roiColor = (roi: number) => roi >= 100 ? '#4ade80' : roi >= 70 ? '#facc15' : '#ef4444';
  const mulColor = (v: number) => v > 1.2 ? '#4ade80' : v < 0.5 ? '#ef4444' : v !== 1.0 ? '#facc15' : '#94a3b8';
  const strategyLabel: Record<string, string> = { score_top: '👑 王道型', value_top: '💎 期待値型', hybrid: '🔀 ハイブリッド' };
  const factorLabel: Record<string, string> = { sire: '種牡馬', frame: '枠順', jockey: '騎手', trainer: '厩舎', distance: '距離', course: 'コース' };

  const card = { background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(100,116,139,0.3)', borderRadius: '12px', padding: '1.2rem' };
  const tabBtn = (t: Tab) => ({
    background: tab === t ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' : 'rgba(30,41,59,0.6)',
    color: '#fff', border: tab === t ? 'none' : '1px solid rgba(100,116,139,0.3)',
    borderRadius: '8px', padding: '0.5rem 1.2rem', cursor: 'pointer' as const,
    fontSize: '0.9rem', fontWeight: 600,
  });

  if (loading) return <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}><p style={{ color: '#94a3b8' }}>読み込み中...</p></main>;

  // 主要6競馬場のみ表示
  const mainVenues = ['東京', '中山', '阪神', '京都', '福島', '新潟'];
  const mainProfiles = profiles.filter(p => mainVenues.includes(p.name));

  return (
    <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <Link href="/" style={{ color: '#60a5fa', fontSize: '0.9rem', textDecoration: 'none' }}>← ダッシュボードに戻る</Link>

      <h1 style={{ fontSize: '1.6rem', margin: '1rem 0', color: '#f1f5f9' }}>🧠 学習ログ & プロファイル</h1>
      <p style={{ color: '#94a3b8', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        v5.4エンジン — 10日336Rの深層分析から導出された競馬場別最適化ロジック
      </p>

      {/* 学習実行パネル */}
      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', color: '#f1f5f9', marginBottom: '1rem' }}>📊 学習を実行</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={learnDate} onChange={e => setLearnDate(e.target.value)}
            style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f1f5f9', padding: '0.5rem 1rem', fontSize: '1rem' }} />
          <button onClick={runLearning} disabled={learning} style={{
            background: learning ? '#475569' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            color: '#fff', border: 'none', borderRadius: '8px', padding: '0.5rem 1.5rem',
            cursor: learning ? 'not-allowed' : 'pointer', fontSize: '1rem', fontWeight: 600,
          }}>{learning ? '学習中...' : '🧠 学習実行'}</button>
          {message && <span style={{ color: message.startsWith('✅') ? '#4ade80' : '#ef4444', fontSize: '0.9rem' }}>{message}</span>}
        </div>
      </div>

      {/* タブ切替 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button style={tabBtn('profiles')} onClick={() => setTab('profiles')}>🏟️ 競馬場プロファイル</button>
        <button style={tabBtn('tuning')} onClick={() => setTab('tuning')}>⚙️ チューニング状況</button>
        <button style={tabBtn('history')} onClick={() => setTab('history')}>📅 週別ログ ({weeks.length}週)</button>
      </div>

      {/* === プロファイルタブ === */}
      {tab === 'profiles' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
            {mainProfiles.map(p => {
              const tuning = tunings.find(t => t.venue === p.name);
              return (
                <div key={p.name} style={{ ...card, position: 'relative' as const }}>
                  {/* ヘッダー */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ color: '#f1f5f9', fontSize: '1.2rem', margin: 0 }}>{p.name}</h3>
                    <span style={{
                      background: p.pivotStrategy === 'score_top' ? 'rgba(59,130,246,0.2)' : p.pivotStrategy === 'value_top' ? 'rgba(168,85,247,0.2)' : 'rgba(250,204,21,0.2)',
                      color: p.pivotStrategy === 'score_top' ? '#60a5fa' : p.pivotStrategy === 'value_top' ? '#a855f7' : '#facc15',
                      padding: '0.2rem 0.7rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600,
                    }}>{strategyLabel[p.pivotStrategy]}</span>
                  </div>

                  {/* ROI（チューニングがあれば表示） */}
                  {tuning && (
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                      <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
                        <div style={{ color: '#64748b', fontSize: '0.65rem' }}>W-ROI</div>
                        <div style={{ color: roiColor(tuning.performance.wideROI), fontSize: '1.3rem', fontWeight: 700 }}>{tuning.performance.wideROI}%</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
                        <div style={{ color: '#64748b', fontSize: '0.65rem' }}>学習データ</div>
                        <div style={{ color: '#f1f5f9', fontSize: '1.3rem', fontWeight: 700 }}>{tuning.totalRaces}R</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
                        <div style={{ color: '#64748b', fontSize: '0.65rem' }}>軸3着内</div>
                        <div style={{ color: tuning.performance.pivotTop3Rate >= 30 ? '#4ade80' : '#ef4444', fontSize: '1.3rem', fontWeight: 700 }}>{tuning.performance.pivotTop3Rate}%</div>
                      </div>
                    </div>
                  )}

                  {/* 要素重みバー */}
                  <div style={{ fontSize: '0.75rem', marginBottom: '0.8rem' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '0.4rem', fontWeight: 600 }}>要素重み調整</div>
                    {[
                      { label: '種牡馬', val: p.sireMultiplier },
                      { label: '騎手', val: p.jockeyMultiplier },
                      { label: '枠順', val: p.frameMultiplier },
                      { label: '距離実績', val: p.distanceMultiplier },
                      { label: 'コース', val: p.courseMultiplier },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{ width: '60px', color: '#94a3b8' }}>{item.label}</span>
                        <div style={{ flex: 1, height: '6px', background: 'rgba(0,0,0,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, item.val * 50)}%`, height: '100%', background: mulColor(item.val), borderRadius: '3px', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ color: mulColor(item.val), fontWeight: 600, width: '35px', textAlign: 'right' }}>×{item.val}</span>
                      </div>
                    ))}
                  </div>

                  {/* 芝/ダート・距離信頼度 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.7rem' }}>
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '6px', padding: '0.5rem' }}>
                      <div style={{ color: '#64748b', marginBottom: '0.3rem' }}>芝/ダート調整</div>
                      <div><span style={{ color: p.turfAdjust > 0 ? '#4ade80' : p.turfAdjust < 0 ? '#ef4444' : '#94a3b8' }}>芝 {p.turfAdjust > 0 ? '+' : ''}{p.turfAdjust}pt</span></div>
                      <div><span style={{ color: p.dirtAdjust > 0 ? '#4ade80' : p.dirtAdjust < 0 ? '#ef4444' : '#94a3b8' }}>ダ {p.dirtAdjust > 0 ? '+' : ''}{p.dirtAdjust}pt</span></div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '6px', padding: '0.5rem' }}>
                      <div style={{ color: '#64748b', marginBottom: '0.3rem' }}>距離帯信頼度</div>
                      {(['sprint', 'mile', 'middle', 'long'] as const).map(k => (
                        <div key={k}><span style={{ color: mulColor(p.distanceTrust[k]) }}>
                          {k === 'sprint' ? '短' : k === 'mile' ? 'マ' : k === 'middle' ? '中' : '長'} ×{p.distanceTrust[k]}
                        </span></div>
                      ))}
                    </div>
                  </div>

                  {/* ワイド相手数 */}
                  <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#64748b' }}>
                    ワイド相手: 少頭数{p.widePartnersSmall}頭 / 中{p.widePartnersMedium}頭 / 多頭数{p.widePartnersLarge}頭
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === チューニングタブ === */}
      {tab === 'tuning' && tunings.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {tunings.map(t => (
            <div key={t.venueEn} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <h3 style={{ color: '#f1f5f9', fontSize: '1.1rem', margin: 0 }}>{t.venue}</h3>
                <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{t.weeksLearned}週 / {t.totalRaces}R</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.8rem' }}>
                <div style={{ textAlign: 'center', padding: '0.4rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.65rem' }}>ワイドROI</div>
                  <div style={{ color: roiColor(t.performance.wideROI), fontSize: '1.1rem', fontWeight: 700 }}>{t.performance.wideROI}%</div>
                </div>
                <div style={{ textAlign: 'center', padding: '0.4rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.65rem' }}>軸3着内率</div>
                  <div style={{ color: roiColor(t.performance.pivotTop3Rate >= 30 ? 100 : 50), fontSize: '1.1rem', fontWeight: 700 }}>{t.performance.pivotTop3Rate}%</div>
                </div>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                {[
                  ['種牡馬上限', `${t.weights.sireMaxPoints}pt`, t.weights.sireMaxPoints !== 20],
                  ['騎手倍率', `×${t.weights.jockeyMultiplier}`, t.weights.jockeyMultiplier !== 1.0],
                  ['厩舎倍率', `×${t.weights.trainerMultiplier}`, t.weights.trainerMultiplier !== 1.0],
                  ['枠順上限', `${t.weights.frameMaxPoints}pt`, t.weights.frameMaxPoints !== 8],
                  ['ワイド相手', `${t.weights.widePartnerCount}頭`, t.weights.widePartnerCount !== 5],
                ].map(([label, val, changed]) => (
                  <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{label as string}</span>
                    <span style={{ color: changed ? '#facc15' : '#94a3b8' }}>{val as string}</span>
                  </div>
                ))}
                <div style={{ color: '#64748b', fontSize: '0.65rem', marginTop: '0.4rem' }}>最終学習: {t.lastLearnDate}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* === 週別ログタブ === */}
      {tab === 'history' && (
        weeks.length > 0 ? weeks.map(week => (
          <div key={week.date} style={{ ...card, background: 'rgba(30,41,59,0.6)', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', color: '#f1f5f9', marginBottom: '1rem' }}>📅 {week.date.replace(/-/g, '/')} の学習</h2>
            {week.venues.map(v => (
              <div key={v.venue} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                  <h3 style={{ color: '#f1f5f9', fontSize: '1rem', margin: 0 }}>🏇 {v.venue}（{v.racesCount}R）</h3>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>軸3着内 <span style={{ color: v.pivotTop3Rate >= 30 ? '#4ade80' : '#ef4444', fontWeight: 700 }}>{v.pivotTop3Rate}%</span></span>
                    <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>ワイドROI <span style={{ color: roiColor(v.wideROI), fontWeight: 700 }}>{v.wideROI}%</span></span>
                  </div>
                </div>

                {/* 要素別分析 */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: '0.8rem' }}>
                  <thead><tr style={{ borderBottom: '1px solid rgba(100,116,139,0.3)' }}>
                    <th style={{ color: '#94a3b8', textAlign: 'left', padding: '0.3rem 0.5rem' }}>要素</th>
                    <th style={{ color: '#94a3b8', textAlign: 'center', padding: '0.3rem 0.5rem' }}>的中時</th>
                    <th style={{ color: '#94a3b8', textAlign: 'center', padding: '0.3rem 0.5rem' }}>不的中時</th>
                    <th style={{ color: '#94a3b8', textAlign: 'center', padding: '0.3rem 0.5rem' }}>寄与度</th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(v.factorAnalysis).map(([key, stat]) => (
                      <tr key={key} style={{ borderBottom: '1px solid rgba(100,116,139,0.1)' }}>
                        <td style={{ color: '#f1f5f9', padding: '0.3rem 0.5rem' }}>{factorLabel[key] || key}</td>
                        <td style={{ textAlign: 'center', padding: '0.3rem', color: stat.avgHitScore > stat.avgMissScore ? '#4ade80' : '#f1f5f9' }}>{stat.avgHitScore}pt</td>
                        <td style={{ textAlign: 'center', padding: '0.3rem', color: '#94a3b8' }}>{stat.avgMissScore}pt</td>
                        <td style={{ textAlign: 'center', padding: '0.3rem', color: stat.hitContribution >= 0.4 ? '#4ade80' : '#94a3b8' }}>{Math.round(stat.hitContribution * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* インサイト & 調整 */}
                {v.insights.length > 0 && v.insights.map((s, i) => (
                  <div key={`i${i}`} style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '0.3rem 0.6rem', borderLeft: '3px solid #3b82f6', marginBottom: '0.3rem', background: 'rgba(59,130,246,0.05)' }}>💡 {s}</div>
                ))}
                {v.adjustments.length > 0 && v.adjustments.map((s, i) => (
                  <div key={`a${i}`} style={{ color: '#facc15', fontSize: '0.8rem', padding: '0.3rem 0.6rem', borderLeft: '3px solid #facc15', marginBottom: '0.3rem', background: 'rgba(250,204,21,0.05)' }}>🔧 {s}</div>
                ))}
              </div>
            ))}
          </div>
        )) : (
          <div style={{ ...card, textAlign: 'center', color: '#64748b', padding: '3rem' }}>
            <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>📭 まだ学習データがありません</p>
            <p style={{ fontSize: '0.9rem' }}>上の「学習実行」で週末の結果から学習を開始してください</p>
          </div>
        )
      )}
    </main>
  );
}
