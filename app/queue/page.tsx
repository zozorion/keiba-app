'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import './queue.css';

interface QueueItem {
  id: string; templateId: string; label: string; text: string; charCount: number;
  scheduledAt: string; status: 'pending' | 'approved' | 'rejected' | 'posted' | 'failed';
  date: string; postedAt?: string; tweetId?: string; error?: string;
}

interface GradedRace {
  raceName: string; grade: string; venue: string; date: string;
}

export default function QueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<any>({});
  const [twitterOk, setTwitterOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<'weekday' | 'weekend' | null>(null);
  const [satDate, setSatDate] = useState('');
  const [sunDate, setSunDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [msg, setMsg] = useState('');
  const [graded, setGraded] = useState<GradedRace[]>([]);
  const [editSchedules, setEditSchedules] = useState<Record<string, string>>({});

  useEffect(() => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    const sat = new Date(now);
    sat.setDate(now.getDate() + (day === 6 ? 0 : day === 0 ? 6 : daysUntilSat));
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    setSatDate(sat.toISOString().split('T')[0]);
    setSunDate(sun.toISOString().split('T')[0]);
  }, []);

  const fetchQueue = useCallback(async () => {
    const res = await fetch('/api/post-queue');
    const data = await res.json();
    setQueue(data.queue || []);
    setStats(data.stats || {});
    setTwitterOk(data.twitterConfigured);
    setLoading(false);
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);
  useEffect(() => {
    const interval = setInterval(fetchQueue, 30000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const generateQueue = async (phase: 'weekday' | 'weekend') => {
    setGenerating(phase); setMsg('');
    const res = await fetch('/api/post-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: `generate-${phase}`, satDate, sunDate }),
    });
    const data = await res.json();
    setGenerating(null);
    if (data.success) {
      setMsg(`✅ ${data.generated}件の投稿を生成しました`);
      if (data.graded?.length) setGraded(data.graded);
      fetchQueue();
    } else setMsg(`❌ ${data.error}`);
  };

  const updateItem = async (id: string, updates: any) => {
    await fetch('/api/post-queue', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    });
    fetchQueue();
  };

  const approveAll = async () => {
    await fetch('/api/post-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve-all' }),
    });
    setMsg('✅ 全て承認しました'); fetchQueue();
  };

  const clearDone = async () => {
    await fetch('/api/post-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear-done' }),
    });
    fetchQueue();
  };

  const statusLabel: Record<string, string> = {
    pending: '⏳ 保留', approved: '✅ 承認', rejected: '❌ 拒否',
    posted: '📤 投稿済', failed: '⚠️ 失敗'
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const borderColor = (s: string) =>
    s === 'approved' ? '#4ade80' : s === 'posted' ? '#60a5fa' :
    s === 'rejected' ? '#ef4444' : s === 'failed' ? '#ef4444' : '#facc15';

  const isGradedItem = (item: QueueItem) => item.templateId.startsWith('x-graded-') && item.templateId !== 'x-graded';

  // ISO文字列をdatetime-local用に変換
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const getSchedule = (item: QueueItem) => editSchedules[item.id] || toLocalInput(item.scheduledAt);
  const setSchedule = (id: string, val: string) => setEditSchedules(prev => ({ ...prev, [id]: val }));

  return (
    <main className="queue-page">
      <Link href="/" className="queue-back">← ダッシュボードに戻る</Link>
      <h1 className="queue-title">📮 投稿キュー</h1>
      <p className="queue-subtitle">
        承認した投稿は指定時刻に自動でXに投稿されます
        <span className={`queue-twitter-badge ${twitterOk ? 'ok' : 'ng'}`}>
          {twitterOk ? '🐦 接続済み' : '⚠️ X未接続'}
        </span>
      </p>

      {/* ステータスバー */}
      <div className="queue-stats">
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} className={`queue-stat-badge status-${k}`}>
            {statusLabel[k] || k}: {String(v)}
          </div>
        ))}
      </div>

      {/* キュー生成 */}
      <div className="queue-card queue-gen">
        <h3>🔄 週間キュー生成</h3>
        <div className="queue-gen-controls">
          <div>
            <label>土曜</label>
            <input type="date" value={satDate} onChange={e => setSatDate(e.target.value)} />
          </div>
          <div>
            <label>日曜</label>
            <input type="date" value={sunDate} onChange={e => setSunDate(e.target.value)} />
          </div>
          <div className="queue-gen-buttons">
            <button onClick={() => generateQueue('weekday')} disabled={!!generating} className="queue-btn queue-btn-weekday">
              {generating === 'weekday' ? '⏳ 生成中...' : '📝 平日キュー (月〜木)'}
            </button>
            <button onClick={() => generateQueue('weekend')} disabled={!!generating} className="queue-btn queue-btn-weekend">
              {generating === 'weekend' ? '⏳ 生成中...' : '🏇 週末キュー (金〜日)'}
            </button>
          </div>
          <div className="queue-gen-buttons">
            <button onClick={approveAll} className="queue-btn queue-btn-approve" disabled={stats.pending === 0}>✅ 全て承認</button>
            <button onClick={clearDone} className="queue-btn queue-btn-clear">🗑️ 完了分削除</button>
          </div>
        </div>

        {graded.length > 0 && (
          <div className="queue-graded-badges">
            {graded.map((g, i) => (
              <span key={i} className={`queue-graded-badge grade-${g.grade.toLowerCase().replace(/\s/g, '')}`}>
                🏆 {g.grade}: {g.raceName}（{g.venue}）
              </span>
            ))}
          </div>
        )}
      </div>

      {msg && (
        <div className={`queue-msg ${msg.includes('✅') ? 'success' : 'error'}`}>{msg}</div>
      )}

      {/* キュー一覧 */}
      {loading ? (
        <div className="queue-empty">読み込み中...</div>
      ) : queue.length === 0 ? (
        <div className="queue-card queue-empty">
          <p>キューは空です。上のボタンで投稿を生成してください</p>
        </div>
      ) : (
        <div>
          {queue.map(item => (
            <div key={item.id}
              className={`queue-card queue-item ${(item.status === 'rejected' || item.status === 'posted') ? 'done' : ''} ${isGradedItem(item) ? 'graded-item' : ''}`}
              style={{ borderLeftColor: isGradedItem(item) ? '#f59e0b' : borderColor(item.status) }}>

              <div className="queue-item-header">
                <div className="queue-item-meta">
                  <span className={`status-badge status-${item.status}`}>{statusLabel[item.status]}</span>
                  <span className="queue-item-label">{item.label}</span>
                  <span className="queue-item-chars">{item.charCount}字</span>
                </div>
                <span className="queue-item-time">🕐 {formatTime(item.scheduledAt)}</span>
              </div>

              <div onClick={() => { setExpandedId(expandedId === item.id ? null : item.id); setEditText(item.text); }}
                className={`queue-item-preview ${expandedId === item.id ? 'expanded' : 'collapsed'}`}>
                {expandedId === item.id ? item.text : item.text.replace(/\n/g, ' ').substring(0, 100) + '...'}
              </div>

              {expandedId === item.id && (
                <div className="queue-edit-area">
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} />
                  <div className="queue-item-actions">
                    <button onClick={() => { updateItem(item.id, { text: editText }); setExpandedId(null); }}
                      className="queue-btn queue-btn-save">💾 保存</button>
                  </div>
                </div>
              )}

              {(item.status === 'pending' || item.status === 'approved') && (
                <div className="queue-item-actions-wrap">
                  {item.status === 'pending' && (
                    <div className="queue-schedule-edit">
                      <label>📅 投稿時刻:</label>
                      <input
                        type="datetime-local"
                        value={getSchedule(item)}
                        onChange={e => setSchedule(item.id, e.target.value)}
                        className="queue-schedule-input"
                      />
                    </div>
                  )}
                  <div className="queue-item-actions">
                    {item.status === 'pending' && (
                      <button onClick={() => {
                        const sched = editSchedules[item.id];
                        const updates: any = { status: 'approved' };
                        if (sched) updates.scheduledAt = new Date(sched).toISOString();
                        updateItem(item.id, updates);
                      }} className="queue-btn queue-btn-approve">✅ 承認</button>
                    )}
                    {item.status === 'pending' && (
                      <button onClick={() => updateItem(item.id, { status: 'rejected' })} className="queue-btn queue-btn-reject">❌ 拒否</button>
                    )}
                    {item.status === 'approved' && (
                      <button onClick={() => updateItem(item.id, { status: 'pending' })} className="queue-btn queue-btn-pending">⏸️ 保留に戻す</button>
                    )}
                  </div>
                </div>
              )}

              {item.error && <div className="queue-item-error">⚠️ {item.error}</div>}
              {item.tweetId && <div className="queue-item-tweet-id">📤 Tweet ID: {item.tweetId}</div>}
            </div>
          ))}
        </div>
      )}

      {/* 運用ガイド */}
      <div className="queue-card queue-help">
        <h3>💡 週間運用フロー</h3>
        <div className="queue-help-body">
          <div><b>月曜〜:</b> 「📝 平日キュー」で月〜木の日常投稿を生成・承認</div>
          <div><b>金曜夕方:</b> データ取得ボタン（枠順確定後）→ 予測生成</div>
          <div><b>金曜夜:</b> 「🏇 週末キュー」で金〜日のレース投稿を生成・承認</div>
          <div><b>土〜日:</b> 承認済み投稿が<b style={{ color: '#4ade80' }}>自動でXに投稿</b>される</div>
          <div style={{ marginTop: '8px', color: '#f59e0b' }}>
            🏆 重賞ウィークは自動検出！ G1は+5件、G2は+3件、G3は+1件の特化投稿が追加
          </div>
          <div className="queue-help-ok">✅ サーバー起動中はバックグラウンドで30秒ごとに自動チェック</div>
        </div>
      </div>
    </main>
  );
}
