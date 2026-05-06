'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import './queue.css';

interface QueueItem {
  id: string; templateId: string; label: string; text: string; charCount: number;
  scheduledAt: string; status: 'pending' | 'approved' | 'rejected' | 'posted' | 'failed';
  date: string; postedAt?: string; tweetId?: string; error?: string;
}

export default function QueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<any>({});
  const [twitterOk, setTwitterOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [satDate, setSatDate] = useState('');
  const [sunDate, setSunDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [msg, setMsg] = useState('');

  // 今週末の日付を自動設定
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

  // 30秒ごとにポーリング
  useEffect(() => {
    const interval = setInterval(fetchQueue, 30000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const generateQueue = async () => {
    setGenerating(true); setMsg('');
    const res = await fetch('/api/post-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', satDate, sunDate }),
    });
    const data = await res.json();
    setGenerating(false);
    if (data.success) { setMsg(`✅ ${data.generated}件の投稿を生成しました`); fetchQueue(); }
    else setMsg(`❌ ${data.error}`);
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
            <button onClick={generateQueue} disabled={generating} className="queue-btn queue-btn-generate">
              {generating ? '⏳ 生成中...' : '🔄 週間キューを生成'}
            </button>
            <button onClick={approveAll} className="queue-btn queue-btn-approve" disabled={stats.pending === 0}>✅ 全て承認</button>
            <button onClick={clearDone} className="queue-btn queue-btn-clear">🗑️ 完了分削除</button>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`queue-msg ${msg.includes('✅') ? 'success' : 'error'}`}>{msg}</div>
      )}

      {/* キュー一覧 */}
      {loading ? (
        <div className="queue-empty">読み込み中...</div>
      ) : queue.length === 0 ? (
        <div className="queue-card queue-empty">
          <p>キューは空です。「🔄 週間キューを生成」で月〜日の投稿を一括作成できます</p>
        </div>
      ) : (
        <div>
          {queue.map(item => (
            <div key={item.id}
              className={`queue-card queue-item ${(item.status === 'rejected' || item.status === 'posted') ? 'done' : ''}`}
              style={{ borderLeftColor: borderColor(item.status) }}>

              {/* ヘッダー */}
              <div className="queue-item-header">
                <div className="queue-item-meta">
                  <span className={`status-badge status-${item.status}`}>{statusLabel[item.status]}</span>
                  <span className="queue-item-label">{item.label}</span>
                  <span className="queue-item-chars">{item.charCount}字</span>
                </div>
                <span className="queue-item-time">🕐 {formatTime(item.scheduledAt)}</span>
              </div>

              {/* プレビュー */}
              <div onClick={() => { setExpandedId(expandedId === item.id ? null : item.id); setEditText(item.text); }}
                className={`queue-item-preview ${expandedId === item.id ? 'expanded' : 'collapsed'}`}>
                {expandedId === item.id ? item.text : item.text.replace(/\n/g, ' ').substring(0, 100) + '...'}
              </div>

              {/* 展開時: 編集エリア */}
              {expandedId === item.id && (
                <div className="queue-edit-area">
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} />
                  <div className="queue-item-actions">
                    <button onClick={() => { updateItem(item.id, { text: editText }); setExpandedId(null); }}
                      className="queue-btn queue-btn-save">💾 保存</button>
                  </div>
                </div>
              )}

              {/* アクションボタン */}
              {(item.status === 'pending' || item.status === 'approved') && (
                <div className="queue-item-actions">
                  {item.status === 'pending' && (
                    <button onClick={() => updateItem(item.id, { status: 'approved' })} className="queue-btn queue-btn-approve">✅ 承認</button>
                  )}
                  {item.status === 'pending' && (
                    <button onClick={() => updateItem(item.id, { status: 'rejected' })} className="queue-btn queue-btn-reject">❌ 拒否</button>
                  )}
                  {item.status === 'approved' && (
                    <button onClick={() => updateItem(item.id, { status: 'pending' })} className="queue-btn queue-btn-pending">⏸️ 保留に戻す</button>
                  )}
                </div>
              )}

              {/* エラー・成功表示 */}
              {item.error && <div className="queue-item-error">⚠️ {item.error}</div>}
              {item.tweetId && <div className="queue-item-tweet-id">📤 Tweet ID: {item.tweetId}</div>}
            </div>
          ))}
        </div>
      )}

      {/* 仕組み説明 */}
      <div className="queue-card queue-help">
        <h3>💡 自動投稿の仕組み</h3>
        <div className="queue-help-body">
          <div>1. 「🔄 週間キューを生成」→ 月〜日の全投稿が一覧で表示</div>
          <div>2. 各投稿を確認して「✅ 承認」or「❌ 拒否」（一括承認もOK）</div>
          <div>3. 承認した投稿は<b style={{ color: '#4ade80' }}>指定時刻に自動でXに投稿</b>される</div>
          <div>4. サーバー起動中はバックグラウンドで30秒ごとに自動チェック</div>
          <div className="queue-help-ok">✅ ブラウザを閉じてもサーバーが動いていれば自動投稿されます</div>
        </div>
      </div>
    </main>
  );
}
