'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface CommunityTemplate {
  id: string;
  createdAt: string;
  sourceTweet: string;
  sourceAuthor?: string;
  name: string;
  structurePrompt: string;
  tags: string[];
  tone: string;
  length: string;
  structureNotes?: string;
  useCount: number;
  favorited: boolean;
}

export default function CommunityTemplatesPage() {
  const [templates, setTemplates] = useState<CommunityTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceTweet, setSourceTweet] = useState('');
  const [sourceAuthor, setSourceAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/community-templates')
      .then(r => r.json())
      .then(d => setTemplates(d.templates || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (!sourceTweet.trim()) { setError('投稿テキストを入れてください'); return; }
    setSubmitting(true); setError(''); setMsg('');
    try {
      const res = await fetch('/api/community-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTweet, sourceAuthor: sourceAuthor || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `エラー: ${res.status}`);
      } else {
        setMsg(`✅ 「${json.template.name}」として保存しました`);
        setSourceTweet('');
        setSourceAuthor('');
        load();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('このテンプレを削除しますか？')) return;
    await fetch(`/api/community-templates?id=${id}`, { method: 'DELETE' });
    load();
  }

  async function toggleFavorite(id: string, current: boolean) {
    await fetch('/api/community-templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, favorited: !current }),
    });
    load();
  }

  return (
    <main>
      <Link href="/" className="btn btn-ghost" style={{ marginBottom: 16 }}>
        ← ダッシュボードに戻る
      </Link>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, marginBottom: 4 }}>📚 構成テンプレライブラリ</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
          他人のいい投稿を貼り付けると、AIが「構成・骨組み」だけ抽出して保存します。<br />
          投稿生成時に確率でランダム選択され、Geminiに「この骨組みで書いて」と渡されます（内容ではなく型のみ流用）。
        </p>
      </div>

      {/* 新規追加フォーム */}
      <div className="settings-section" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>➕ 新しい投稿を分析して保存</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={sourceTweet}
            onChange={e => setSourceTweet(e.target.value)}
            placeholder="ここにいいなと思った他人のXポストを貼り付け（最大2000字）"
            rows={6}
            style={{
              padding: 12, borderRadius: 'var(--radius-md)',
              background: 'var(--bg-input)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: '0.9rem',
              resize: 'vertical',
            }}
          />
          <input
            type="text"
            value={sourceAuthor}
            onChange={e => setSourceAuthor(e.target.value)}
            placeholder="出典 (任意。例: @account_name)"
            style={{
              padding: 8, borderRadius: 'var(--radius-md)',
              background: 'var(--bg-input)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', fontSize: '0.9rem',
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              disabled={submitting || !sourceTweet.trim()}
              onClick={submit}
            >
              {submitting ? '🤖 AI分析中...' : '🧠 AIで構成を抽出して保存'}
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{sourceTweet.length} 字</span>
            {msg && <span style={{ color: 'var(--success, #22c55e)', fontSize: '0.85rem' }}>{msg}</span>}
            {error && <span style={{ color: 'var(--error, #ef4444)', fontSize: '0.85rem' }}>⚠️ {error}</span>}
          </div>
        </div>
      </div>

      {/* テンプレ一覧 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>📋 保存済みテンプレ ({templates.length})</h3>
        {loading && <span style={{ color: 'var(--text-muted)' }}>読み込み中...</span>}
      </div>

      {templates.length === 0 && !loading && (
        <div className="empty-state">
          <p>まだテンプレがありません。上のフォームから投稿を貼り付けて分析してみてください。</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {templates.map(t => (
          <div key={t.id} className="settings-section" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <h4 style={{ margin: 0, fontSize: '1.05rem' }}>{t.name}</h4>
                  <span className="status-badge" style={{ fontSize: '0.7rem' }}>{t.tone}</span>
                  <span className="status-badge" style={{ fontSize: '0.7rem' }}>{t.length}</span>
                  {t.tags.map(tag => (
                    <span key={tag} className="status-badge status-ready" style={{ fontSize: '0.7rem' }}>#{tag}</span>
                  ))}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  使用 {t.useCount}回 / 登録 {new Date(t.createdAt).toLocaleDateString('ja-JP')}
                  {t.sourceAuthor && <> / 出典: {t.sourceAuthor}</>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                  onClick={() => toggleFavorite(t.id, t.favorited)}
                  title={t.favorited ? 'お気に入り解除' : 'お気に入りに追加（ピック確率3倍）'}
                >
                  {t.favorited ? '⭐' : '☆'}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: '0.85rem', color: 'var(--error, #ef4444)' }}
                  onClick={() => remove(t.id)}
                >🗑️</button>
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <details>
                <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem' }}>構成プロンプト（Geminiへの指示）</summary>
                <p style={{
                  background: 'var(--bg-input)', padding: 10, borderRadius: 'var(--radius-md)',
                  fontSize: '0.85rem', whiteSpace: 'pre-wrap', marginTop: 6, marginBottom: 6,
                }}>{t.structurePrompt}</p>
                {t.structureNotes && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
                    📝 {t.structureNotes}
                  </p>
                )}
              </details>
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem' }}>元投稿</summary>
                <p style={{
                  background: 'var(--bg-input)', padding: 10, borderRadius: 'var(--radius-md)',
                  fontSize: '0.85rem', whiteSpace: 'pre-wrap', marginTop: 6, opacity: 0.85,
                }}>{t.sourceTweet}</p>
              </details>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
