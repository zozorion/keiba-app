'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Template { id: string; label: string; category: string; template: string; isCustom: boolean; }
interface Persona { name: string; description: string; tone: string; favHorse: string; signoff: string; }
interface PostConfig { persona: Persona; rules: string[]; }

export default function PostsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [templateText, setTemplateText] = useState('');
  const [preview, setPreview] = useState('');
  const [charCount, setCharCount] = useState(0);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [raceIndex, setRaceIndex] = useState<number | undefined>(undefined);
  const [races, setRaces] = useState<any[]>([]);
  const [twitterOk, setTwitterOk] = useState(false);
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'x' | 'note'>('x');
  const [config, setConfig] = useState<PostConfig>({ persona: { name: '', description: '', tone: '', favHorse: '', signoff: '' }, rules: [] });
  const [showConfig, setShowConfig] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [configSaving, setConfigSaving] = useState(false);

  // 初期化
  useEffect(() => {
    fetch('/api/posts').then(r => r.json()).then(d => {
      setTemplates(d.templates || []);
      setTwitterOk(d.twitterConfigured);
      if (d.templates?.length > 0) { setSelectedId(d.templates[0].id); setTemplateText(d.templates[0].template); }
    });
    fetch('/api/scrape').then(r => r.json()).then(d => {
      const ds = Object.keys(d.available || {}).sort().reverse();
      setDates(ds);
      if (ds.length > 0) setDate(ds[0]);
    });
    fetch('/api/post-config').then(r => r.json()).then(d => setConfig(d)).catch(() => {});
  }, []);

  // 日付変更時にレース一覧を取得
  useEffect(() => {
    if (!date) return;
    fetch(`/api/predict?date=${date}`).then(r => r.json()).then(d => {
      const allRaces: any[] = [];
      Object.values(d.venues || {}).forEach((v: any) => { allRaces.push(...v); });
      allRaces.sort((a: any, b: any) => {
        if (a.race.courseName !== b.race.courseName) return a.race.courseName.localeCompare(b.race.courseName);
        return a.race.raceNumber - b.race.raceNumber;
      });
      setRaces(allRaces);
    }).catch(() => setRaces([]));
  }, [date]);

  // テンプレート変更
  useEffect(() => {
    const t = templates.find(t => t.id === selectedId);
    if (t) setTemplateText(t.template);
  }, [selectedId, templates]);

  // プレビュー生成
  const generatePreview = useCallback(async () => {
    if (!date || !selectedId) return;
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: selectedId, date, raceIndex }),
    });
    const d = await res.json();
    setPreview(d.text || '');
    setCharCount(d.charCount || 0);
  }, [date, selectedId, raceIndex]);

  useEffect(() => { generatePreview(); }, [generatePreview]);

  // X投稿
  const handlePost = async () => {
    if (!confirm('この内容でXに投稿しますか？')) return;
    setPosting(true); setMsg('');
    const res = await fetch('/api/posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: selectedId, date, raceIndex, autoPost: true }),
    });
    const d = await res.json();
    setPosting(false);
    if (d.postResult?.success) { setMsg(`✅ 投稿完了！ ID: ${d.postResult.tweetId}`); }
    else { setMsg(`❌ ${d.postResult?.error || d.text || 'エラー'}`); }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(preview);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    await fetch('/api/posts', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: selectedId, template: templateText }),
    });
    setTemplates(prev => prev.map(t => t.id === selectedId ? { ...t, template: templateText, isCustom: true } : t));
    setMsg('💾 テンプレート保存しました'); setTimeout(() => setMsg(''), 2000);
    generatePreview();
  };

  const saveConfig = async () => {
    setConfigSaving(true);
    await fetch('/api/post-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    setConfigSaving(false);
    setMsg('💾 ペルソナ・ルールを保存しました'); setTimeout(() => setMsg(''), 2000);
    generatePreview();
  };

  const addRule = () => {
    if (!newRule.trim()) return;
    setConfig(prev => ({ ...prev, rules: [...prev.rules, newRule.trim()] }));
    setNewRule('');
  };

  const removeRule = (i: number) => {
    setConfig(prev => ({ ...prev, rules: prev.rules.filter((_, idx) => idx !== i) }));
  };

  const formatDateLabel = (ds: string) => {
    const d = new Date(ds + 'T00:00:00');
    return `${d.getMonth()+1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
  };

  const filteredTemplates = templates.filter(t => t.category === tab);
  const isRaceLevel = ['x-race','x-graded','x-result','x-value','x-course','note-analysis'].includes(selectedId);
  const card: React.CSSProperties = { background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(100,116,139,0.3)', borderRadius: '12px', padding: '1.2rem', marginBottom: '1rem' };
  const btnStyle = (active: boolean, color = '#3b82f6'): React.CSSProperties => ({
    background: active ? `linear-gradient(135deg, ${color}, ${color}dd)` : 'rgba(30,41,59,0.6)',
    color: '#fff', border: active ? 'none' : '1px solid rgba(100,116,139,0.3)',
    borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
  });
  const inputStyle: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', padding: '0.5rem', fontSize: '0.8rem', width: '100%' };

  return (
    <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <Link href="/" style={{ color: '#60a5fa', fontSize: '0.9rem', textDecoration: 'none' }}>← ダッシュボードに戻る</Link>
      <h1 style={{ fontSize: '1.5rem', margin: '1rem 0 0.5rem', color: '#f1f5f9' }}>📝 投稿作成</h1>
      <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        X投稿・note記事を予測データから自動生成{twitterOk ? ' | 🐦 X API接続済み' : ' | ⚠️ X APIキー未設定'}
      </p>

      {/* ペルソナ・ルール設定（折りたたみ） */}
      <div style={{ ...card, border: showConfig ? '1px solid rgba(168,85,247,0.4)' : '1px solid rgba(100,116,139,0.3)' }}>
        <div onClick={() => setShowConfig(!showConfig)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
          <h3 style={{ color: '#a855f7', fontSize: '0.95rem', margin: 0 }}>
            🎭 ペルソナ & ルール {config.persona.name && `— ${config.persona.name}`}
          </h3>
          <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{showConfig ? '▲ 閉じる' : '▼ 開く'}</span>
        </div>

        {showConfig && (
          <div style={{ marginTop: '1rem' }}>
            {/* ペルソナ設定 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'block', marginBottom: '0.2rem' }}>アカウント名</label>
                <input value={config.persona.name} onChange={e => setConfig(p => ({ ...p, persona: { ...p.persona, name: e.target.value } }))} style={inputStyle} placeholder="バカウマちゃんねる" />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'block', marginBottom: '0.2rem' }}>推し馬</label>
                <input value={config.persona.favHorse} onChange={e => setConfig(p => ({ ...p, persona: { ...p.persona, favHorse: e.target.value } }))} style={inputStyle} placeholder="タイトルホルダー" />
              </div>
            </div>

            <div style={{ marginBottom: '0.8rem' }}>
              <label style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'block', marginBottom: '0.2rem' }}>キャラクター設定（ペルソナ）</label>
              <textarea value={config.persona.description} onChange={e => setConfig(p => ({ ...p, persona: { ...p.persona, description: e.target.value } }))}
                style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} placeholder="ギャンブル大好きでIT企業に勤務している30歳の女性..." />
            </div>

            <div style={{ marginBottom: '0.8rem' }}>
              <label style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'block', marginBottom: '0.2rem' }}>口調・トーン</label>
              <textarea value={config.persona.tone} onChange={e => setConfig(p => ({ ...p, persona: { ...p.persona, tone: e.target.value } }))}
                style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="カジュアルで親しみやすい口調。でもデータの話になると急にプロっぽくなる..." />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'block', marginBottom: '0.2rem' }}>署名（投稿末尾）</label>
              <input value={config.persona.signoff} onChange={e => setConfig(p => ({ ...p, persona: { ...p.persona, signoff: e.target.value } }))} style={inputStyle} placeholder="📺 バカウマちゃんねる" />
            </div>

            {/* ルール設定 */}
            <h4 style={{ color: '#f59e0b', fontSize: '0.85rem', margin: '1rem 0 0.5rem' }}>📋 投稿ルール（全テンプレートに適用）</h4>
            {config.rules.map((rule, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                <span style={{ color: '#e2e8f0', fontSize: '0.75rem', flex: 1 }}>・{rule}</span>
                <button onClick={() => removeRule(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <input value={newRule} onChange={e => setNewRule(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRule()}
                style={{ ...inputStyle, flex: 1 }} placeholder="新しいルールを追加..." />
              <button onClick={addRule} style={{ ...btnStyle(true, '#f59e0b'), fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>+ 追加</button>
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button onClick={saveConfig} disabled={configSaving} style={btnStyle(true, '#a855f7')}>
                {configSaving ? '⏳ 保存中...' : '💾 ペルソナ・ルールを保存'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 日付 + レース選択 */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <div>
          <label style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'block', marginBottom: '0.3rem' }}>対象日</label>
          <select value={date} onChange={e => setDate(e.target.value)} style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f1f5f9', padding: '0.5rem', fontSize: '0.9rem' }}>
            {dates.map(d => <option key={d} value={d}>{formatDateLabel(d)}</option>)}
          </select>
        </div>
        {isRaceLevel && (
          <div>
            <label style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'block', marginBottom: '0.3rem' }}>レース</label>
            <select value={raceIndex ?? ''} onChange={e => setRaceIndex(e.target.value ? Number(e.target.value) : undefined)} style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f1f5f9', padding: '0.5rem', fontSize: '0.9rem', maxWidth: '300px' }}>
              <option value="">自動（BEST BET）</option>
              {races.map((r: any, i: number) => (
                <option key={i} value={i}>{r.race.courseName}{r.race.raceNumber}R {r.race.raceName} ◎{r.pivotHorse?.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* カテゴリタブ */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button style={btnStyle(tab === 'x', '#1d9bf0')} onClick={() => { setTab('x'); const f = templates.find(t => t.category === 'x'); if (f) setSelectedId(f.id); }}>🐦 X投稿</button>
        <button style={btnStyle(tab === 'note', '#37b24d')} onClick={() => { setTab('note'); const f = templates.find(t => t.category === 'note'); if (f) setSelectedId(f.id); }}>📝 note</button>
      </div>

      {/* テンプレート選択 */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {filteredTemplates.map(t => (
          <button key={t.id} style={{ ...btnStyle(selectedId === t.id, tab === 'x' ? '#1d9bf0' : '#37b24d'), fontSize: '0.75rem', padding: '0.4rem 0.8rem' }} onClick={() => setSelectedId(t.id)}>
            {t.label} {t.isCustom && '✏️'}
          </button>
        ))}
      </div>

      {/* メイン: テンプレート + プレビュー */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
            <h3 style={{ color: '#f1f5f9', fontSize: '0.95rem', margin: 0 }}>テンプレート</h3>
            <button onClick={handleSave} style={{ ...btnStyle(true, '#f59e0b'), fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}>💾 保存</button>
          </div>
          <textarea value={templateText} onChange={e => setTemplateText(e.target.value)}
            style={{ width: '100%', minHeight: '350px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0', padding: '0.8rem', fontSize: '0.8rem', fontFamily: 'monospace', lineHeight: '1.6', resize: 'vertical' }} />
          <div style={{ marginTop: '0.5rem', color: '#64748b', fontSize: '0.7rem' }}>
            変数: {'{venue}'} {'{raceName}'} {'{pivot_name}'} {'{persona_name}'} {'{persona_signoff}'} {'{persona_fav}'} など
          </div>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
            <h3 style={{ color: '#f1f5f9', fontSize: '0.95rem', margin: 0 }}>プレビュー</h3>
            <span style={{ color: '#4ade80', fontSize: '0.75rem', fontWeight: 600 }}>
              {charCount}文字
            </span>
          </div>
          <div style={{ background: '#0f172a', borderRadius: '8px', padding: '1rem', minHeight: '350px', whiteSpace: 'pre-wrap', fontSize: '0.85rem', lineHeight: '1.7', color: '#e2e8f0' }}>
            {preview || '生成中...'}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
            {tab === 'x' && (
              <button onClick={handlePost} disabled={posting || !twitterOk}
                style={{ ...btnStyle(!posting && twitterOk, '#1d9bf0'), opacity: (!twitterOk || posting) ? 0.5 : 1 }}>
                {posting ? '⏳ 投稿中...' : '🐦 Xに投稿'}
              </button>
            )}
            <button onClick={handleCopy} style={btnStyle(true, '#8b5cf6')}>
              {copied ? '✅ コピー済み！' : '📋 コピー'}
            </button>
            <button onClick={generatePreview} style={btnStyle(false)}>🔄 再生成</button>
          </div>
        </div>
      </div>

      {msg && (
        <div style={{ marginTop: '0.8rem', padding: '0.6rem 1rem', background: msg.includes('✅') || msg.includes('💾') ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: '8px', color: msg.includes('✅') || msg.includes('💾') ? '#4ade80' : '#ef4444', fontSize: '0.85rem' }}>
          {msg}
        </div>
      )}

      {/* 使い方ガイド */}
      <div style={{ ...card, background: 'rgba(29,155,240,0.05)', border: '1px solid rgba(29,155,240,0.2)', marginTop: '1.5rem' }}>
        <h3 style={{ color: '#1d9bf0', fontSize: '0.95rem', marginBottom: '0.8rem' }}>💡 毎週の投稿ルーティン</h3>
        <div style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: '2' }}>
          <div><b style={{ color: '#f59e0b' }}>金曜夜</b> → ①前日予告を投稿（noteリンク付き）</div>
          <div><b style={{ color: '#3b82f6' }}>土曜朝</b> → ②朝イチ注目 + ③個別レース予想（注目2〜3レース）</div>
          <div><b style={{ color: '#3b82f6' }}>土曜中</b> → ⑤的中速報（ワイド的中時）</div>
          <div><b style={{ color: '#f59e0b' }}>土曜夜</b> → ⑥日次まとめ + ⑩馬場傾向速報（明日の予想の参考に！）</div>
          <div><b style={{ color: '#3b82f6' }}>日曜朝</b> → ②朝イチ注目 + ④重賞予想（G1〜G3）</div>
          <div><b style={{ color: '#3b82f6' }}>日曜中</b> → ③個別予想 + ⑤的中速報 + ⑧穴馬ピック</div>
          <div><b style={{ color: '#8b5cf6' }}>日曜夜</b> → ⑥日次まとめ</div>
          <div><b style={{ color: '#8b5cf6' }}>月曜</b> → ⑦週間レポート + ⑨コース解説（フォロワー向け）</div>
        </div>
      </div>
    </main>
  );
}
