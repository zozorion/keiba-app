'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type JobStatus = 'idle' | 'running' | 'done' | 'error';

interface DataStatus {
  [date: string]: { hasEntries: boolean; hasResults: boolean; hasPredictions: boolean; racesCount: number };
}

export default function SettingsPage() {
  const [satDate, setSatDate] = useState('');
  const [sunDate, setSunDate] = useState('');
  const [scrapeStatus, setScrapeStatus] = useState<JobStatus>('idle');
  const [scrapeJobId, setScrapeJobId] = useState('');
  const [scrapeOutput, setScrapeOutput] = useState<string[]>([]);
  const [learnStatus, setLearnStatus] = useState<JobStatus>('idle');
  const [learnMessage, setLearnMessage] = useState('');
  const [dataStatus, setDataStatus] = useState<DataStatus>({});
  const [activeTab, setActiveTab] = useState<'scrape' | 'learn'>('scrape');
  const [oddsStatus, setOddsStatus] = useState<JobStatus>('idle');
  const [oddsMessage, setOddsMessage] = useState('');

  // 今週末の日付を自動設定
  useEffect(() => {
    const now = new Date();
    const day = now.getDay();
    // 次の土曜日を求める
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    const sat = new Date(now);
    sat.setDate(now.getDate() + (day === 6 ? 0 : day === 0 ? 6 : daysUntilSat));
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    setSatDate(fmt(sat));
    setSunDate(fmt(sun));
  }, []);

  // データ状況を取得
  const fetchDataStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/scrape');
      const data = await res.json();
      setDataStatus(data.available || {});
    } catch {}
  }, []);

  useEffect(() => { fetchDataStatus(); }, [fetchDataStatus]);

  // スクレイプ実行
  const runScrape = async (dates: string[]) => {
    setScrapeStatus('running');
    setScrapeOutput(['🚀 スクレイプを開始しています...']);
    try {
      const params = dates.map(d => `date=${d}`).join('&');
      const res = await fetch(`/api/scrape?${params}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setScrapeJobId(data.jobId);
        setScrapeOutput(prev => [...prev, `✅ ジョブ開始: ${data.message}`]);
      } else {
        setScrapeStatus('error');
        setScrapeOutput(prev => [...prev, `❌ ${data.error}`]);
      }
    } catch (e: any) {
      setScrapeStatus('error');
      setScrapeOutput(prev => [...prev, `❌ ${e.message}`]);
    }
  };

  // ジョブ進捗ポーリング
  useEffect(() => {
    if (!scrapeJobId || scrapeStatus !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/scrape?jobId=${scrapeJobId}`);
        const data = await res.json();
        setScrapeOutput(data.recentOutput || []);
        if (data.status === 'done') {
          setScrapeStatus('done');
          fetchDataStatus();
          clearInterval(interval);
        } else if (data.status === 'error') {
          setScrapeStatus('error');
          clearInterval(interval);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [scrapeJobId, scrapeStatus, fetchDataStatus]);

  // 学習実行
  const runLearn = async () => {
    setLearnStatus('running');
    setLearnMessage('🧠 学習を実行中...');
    try {
      // 土日両方の学習を実行
      for (const date of [satDate, sunDate]) {
        const ds = dataStatus[date];
        if (!ds?.hasResults) continue;
        // まず予測を生成
        await fetch(`/api/predict?date=${date}`);
        // 学習実行
        const res = await fetch(`/api/learn?date=${date}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          setLearnMessage(prev => prev + `\n✅ ${date}: ${data.venueResults?.length || 0}会場学習完了`);
        }
      }
      setLearnStatus('done');
      setLearnMessage(prev => prev + '\n\n🎉 学習完了！学習ログページで結果を確認できます');
      fetchDataStatus();
    } catch (e: any) {
      setLearnStatus('error');
      setLearnMessage(`❌ ${e.message}`);
    }
  };

  const card = {
    background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(100,116,139,0.3)',
    borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem',
  };
  const btn = (active: boolean, disabled: boolean, color: string = '#3b82f6') => ({
    background: disabled ? '#475569' : active ? `linear-gradient(135deg, ${color}, ${color}dd)` : 'rgba(30,41,59,0.6)',
    color: '#fff', border: active ? 'none' : '1px solid rgba(100,116,139,0.3)',
    borderRadius: '8px', padding: '0.6rem 1.5rem', cursor: disabled ? 'not-allowed' as const : 'pointer' as const,
    fontSize: '0.95rem', fontWeight: 600,
  });

  const statusBadge = (has: boolean, label: string) => (
    <span style={{
      display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600,
      background: has ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)',
      color: has ? '#4ade80' : '#ef4444',
    }}>{has ? '✅' : '❌'} {label}</span>
  );

  return (
    <main style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <Link href="/" style={{ color: '#60a5fa', fontSize: '0.9rem', textDecoration: 'none' }}>← ダッシュボードに戻る</Link>

      <h1 style={{ fontSize: '1.6rem', margin: '1rem 0', color: '#f1f5f9' }}>⚙️ 運用パネル</h1>
      <p style={{ color: '#94a3b8', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        データ取得・予測・学習をすべてこの画面から実行できます
      </p>

      {/* 日付設定 */}
      <div style={card}>
        <h2 style={{ fontSize: '1.1rem', color: '#f1f5f9', marginBottom: '1rem' }}>📅 対象日設定</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.3rem' }}>土曜日</label>
            <input type="date" value={satDate} onChange={e => setSatDate(e.target.value)}
              style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f1f5f9', padding: '0.5rem 1rem', fontSize: '1rem' }} />
          </div>
          <div>
            <label style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.3rem' }}>日曜日</label>
            <input type="date" value={sunDate} onChange={e => setSunDate(e.target.value)}
              style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f1f5f9', padding: '0.5rem 1rem', fontSize: '1rem' }} />
          </div>
        </div>

        {/* データ状況表示 */}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {[satDate, sunDate].filter(Boolean).map(d => {
            const ds = dataStatus[d];
            return (
              <div key={d} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.8rem', flex: '1', minWidth: '200px' }}>
                <div style={{ color: '#f1f5f9', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>{d}</div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {statusBadge(!!ds?.hasEntries, `出走表${ds?.racesCount ? `(${ds.racesCount}R)` : ''}`)}
                  {statusBadge(!!ds?.hasResults, '結果')}
                  {statusBadge(!!ds?.hasPredictions, '予測')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* タブ切替 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button style={btn(activeTab === 'scrape', false, '#f59e0b')} onClick={() => setActiveTab('scrape')}>
          📥 データ取得
        </button>
        <button style={btn(activeTab === 'learn', false, '#8b5cf6')} onClick={() => setActiveTab('learn')}>
          🧠 学習実行
        </button>
      </div>

      {/* スクレイプパネル */}
      {activeTab === 'scrape' && (
        <div style={card}>
          <h2 style={{ fontSize: '1.1rem', color: '#f1f5f9', marginBottom: '0.5rem' }}>📥 netkeibaからデータ取得</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '1rem' }}>
            出走表と結果データをnetkeibaから自動取得します。レースIDは自動検出されます。
          </p>

          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <button onClick={() => runScrape([satDate, sunDate])} disabled={scrapeStatus === 'running'}
              style={btn(true, scrapeStatus === 'running', '#f59e0b')}>
              {scrapeStatus === 'running' ? '⏳ 取得中...' : '📥 土日まとめて取得'}
            </button>
            <button onClick={() => runScrape([satDate])} disabled={scrapeStatus === 'running'}
              style={btn(false, scrapeStatus === 'running')}>
              土曜のみ
            </button>
            <button onClick={() => runScrape([sunDate])} disabled={scrapeStatus === 'running'}
              style={btn(false, scrapeStatus === 'running')}>
              日曜のみ
            </button>
          </div>

          {/* 進捗表示 */}
          {scrapeOutput.length > 0 && (
            <div style={{
              background: '#0f172a', borderRadius: '8px', padding: '1rem', maxHeight: '300px',
              overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: '1.6',
            }}>
              {scrapeOutput.map((line, i) => (
                <div key={i} style={{
                  color: line.includes('✅') ? '#4ade80' : line.includes('❌') || line.includes('ERROR') ? '#ef4444' :
                    line.includes('🔑') || line.includes('🔍') ? '#facc15' : '#94a3b8',
                }}>{line}</div>
              ))}
              {scrapeStatus === 'running' && (
                <div style={{ color: '#60a5fa' }}>⏳ 処理中... (自動更新)</div>
              )}
            </div>
          )}

          {scrapeStatus === 'done' && (
            <div style={{ marginTop: '0.8rem', padding: '0.6rem 1rem', background: 'rgba(74,222,128,0.1)', borderRadius: '8px', color: '#4ade80', fontSize: '0.85rem' }}>
              ✅ スクレイプ完了！ダッシュボードで予測を確認できます
            </div>
          )}

          {/* オッズ再取得セクション */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(100,116,139,0.2)' }}>
            <h3 style={{ fontSize: '1rem', color: '#f59e0b', marginBottom: '0.5rem' }}>📊 オッズ再取得（当日朝用）</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginBottom: '0.8rem', lineHeight: '1.6' }}>
              レース当日の朝に実行してください。最新の単勝オッズを取得し、<br />
              <strong style={{ color: '#f59e0b' }}>期待値スコア（強さ×オッズ乖離）</strong>を有効化します。
              オッズなしでは回収率ベースの判断ができません。
            </p>
            <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
              <button
                onClick={async () => {
                  setOddsStatus('running');
                  setOddsMessage('📊 オッズを取得中...');
                  try {
                    for (const d of [satDate, sunDate]) {
                      const ds = dataStatus[d];
                      if (!ds?.hasEntries) continue;
                      const res = await fetch(`/api/refresh-odds?date=${d}`, { method: 'POST' });
                      const data = await res.json();
                      if (data.success) {
                        setOddsMessage(prev => prev + `\n✅ ${d}: ${data.message}`);
                      } else {
                        setOddsMessage(prev => prev + `\n⚠️ ${d}: ${data.error}`);
                      }
                    }
                    setOddsStatus('done');
                    setOddsMessage(prev => prev + '\n\n🎯 期待値スコアが有効になりました！ダッシュボードで確認してください');
                    fetchDataStatus();
                  } catch (e: any) {
                    setOddsStatus('error');
                    setOddsMessage(`❌ ${e.message}`);
                  }
                }}
                disabled={oddsStatus === 'running'}
                style={btn(true, oddsStatus === 'running', '#f59e0b')}
              >
                {oddsStatus === 'running' ? '⏳ 取得中...' : '📊 オッズを取得する'}
              </button>
            </div>
            {oddsMessage && (
              <div style={{
                marginTop: '0.8rem', background: '#0f172a', borderRadius: '8px', padding: '1rem',
                fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: '1.8', whiteSpace: 'pre-wrap',
                color: oddsStatus === 'error' ? '#ef4444' : '#94a3b8',
              }}>
                {oddsMessage}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 学習パネル */}
      {activeTab === 'learn' && (
        <div style={card}>
          <h2 style={{ fontSize: '1.1rem', color: '#f1f5f9', marginBottom: '0.5rem' }}>🧠 週末学習の実行</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '1rem' }}>
            結果データから学習を実行し、スコアリング重みを自動更新します。
            <br />※結果データ（✅ 結果）がある日のみ学習が実行されます。
          </p>

          <button onClick={runLearn} disabled={learnStatus === 'running'}
            style={btn(true, learnStatus === 'running', '#8b5cf6')}>
            {learnStatus === 'running' ? '⏳ 学習中...' : '🧠 学習を実行する'}
          </button>

          {learnMessage && (
            <div style={{
              marginTop: '1rem', background: '#0f172a', borderRadius: '8px', padding: '1rem',
              fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: '1.8', whiteSpace: 'pre-wrap',
              color: learnStatus === 'error' ? '#ef4444' : '#94a3b8',
            }}>
              {learnMessage}
            </div>
          )}

          {learnStatus === 'done' && (
            <div style={{ marginTop: '0.8rem' }}>
              <Link href="/learning" style={{
                display: 'inline-block', padding: '0.5rem 1rem', background: 'rgba(139,92,246,0.2)',
                borderRadius: '8px', color: '#a78bfa', textDecoration: 'none', fontSize: '0.85rem',
              }}>
                📊 学習ログを確認する →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* 使い方ガイド */}
      <div style={{ ...card, background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)' }}>
        <h2 style={{ fontSize: '1rem', color: '#60a5fa', marginBottom: '0.8rem' }}>💡 毎週の使い方</h2>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: '2' }}>
          <div><span style={{ color: '#f59e0b', fontWeight: 700 }}>① 金曜夜</span> → この画面で「📥 土日まとめて取得」をクリック（出走表を取得）</div>
          <div><span style={{ color: '#f59e0b', fontWeight: 700 }}>② 土曜朝</span> → この画面で「📊 オッズを取得する」をクリック（期待値スコア有効化）</div>
          <div><span style={{ color: '#3b82f6', fontWeight: 700 }}>③ 土曜朝</span> → <Link href="/" style={{ color: '#60a5fa', textDecoration: 'none' }}>ダッシュボード</Link>で<strong style={{ color: '#f59e0b' }}>期待値スコア</strong>を確認 → 馬券購入</div>
          <div><span style={{ color: '#f59e0b', fontWeight: 700 }}>④ 土曜夕</span> → この画面で「土曜のみ」をクリック（結果を取得）</div>
          <div><span style={{ color: '#f59e0b', fontWeight: 700 }}>⑤ 日曜朝</span> → 「📊 オッズを取得する」→ ダッシュボードで期待値確認 → 馬券購入</div>
          <div><span style={{ color: '#f59e0b', fontWeight: 700 }}>⑥ 日曜夕</span> → この画面で「日曜のみ」をクリック（結果を取得）</div>
          <div><span style={{ color: '#8b5cf6', fontWeight: 700 }}>⑦ 月曜朝</span> → この画面で「🧠 学習を実行する」をクリック</div>
          <div><span style={{ color: '#4ade80', fontWeight: 700 }}>⑧ 確認</span> → <Link href="/learning" style={{ color: '#60a5fa', textDecoration: 'none' }}>学習ログ</Link>で成績と学習結果を確認</div>
        </div>
      </div>
    </main>
  );
}
