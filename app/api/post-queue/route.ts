/**
 * 投稿キュー管理API
 * GET  /api/post-queue         — キュー一覧
 * POST /api/post-queue         — キュー自動生成（週末ルーティン）
 * PUT  /api/post-queue         — 承認/拒否/編集
 * DELETE /api/post-queue       — キューから削除
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { postTweet, isTwitterConfigured } from '../../../lib/twitter';
import { generatePostText } from '../posts/route';

const QUEUE_PATH = path.join(process.cwd(), 'data', 'post-queue.json');
const LOG_PATH = path.join(process.cwd(), 'data', 'posts-log.json');

interface QueueItem {
  id: string;
  templateId: string;
  label: string;
  text: string;
  charCount: number;
  scheduledAt: string; // ISO datetime
  status: 'pending' | 'approved' | 'rejected' | 'posted' | 'failed';
  date: string;  // 対象レース日
  raceIndex?: number;
  createdAt: string;
  postedAt?: string;
  tweetId?: string;
  error?: string;
}

function loadQueue(): QueueItem[] {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
}

function saveQueue(queue: QueueItem[]) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function appendLog(item: QueueItem) {
  const log = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')) : [];
  log.push({ ...item, loggedAt: new Date().toISOString() });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log.slice(-200), null, 2));
}

/** 投稿文を生成（直接ロジック呼び出し） */
function generateText(templateId: string, date: string, raceIndex?: number): string {
  return generatePostText(templateId, date, raceIndex);
}

/** 日常テンプレートのローテーション */
const LIFESTYLE_TEMPLATES = ['x-lifestyle-1', 'x-lifestyle-2', 'x-lifestyle-3'];
function pickLifestyle(seed: number): string {
  return LIFESTYLE_TEMPLATES[seed % LIFESTYLE_TEMPLATES.length];
}

/** 週間の投稿キューを自動生成（月〜日） */
async function generateWeeklyQueue(satDate: string, sunDate: string): Promise<QueueItem[]> {
  const items: QueueItem[] = [];
  const now = new Date();
  const id = () => `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // 予測データの有無を確認
  const satPredPath = path.join(process.cwd(), 'data', 'weekly', satDate, 'predictions.json');
  const sunPredPath = path.join(process.cwd(), 'data', 'weekly', sunDate, 'predictions.json');
  const hasSat = fs.existsSync(satPredPath);
  const hasSun = fs.existsSync(sunPredPath);

  // 注目レースのindexを取得
  const getTopRaceIndices = (predPath: string, count: number): number[] => {
    if (!fs.existsSync(predPath)) return [];
    const preds = JSON.parse(fs.readFileSync(predPath, 'utf-8')).predictions || [];
    return preds
      .map((p: any, i: number) => ({ i, score: p.pivotHorse?.score || 0, shouldBet: p.shouldBet }))
      .filter((p: any) => p.shouldBet !== false)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, count)
      .map((p: any) => p.i);
  };

  // ====== 日付計算 ======
  const satD = new Date(satDate + 'T00:00:00');
  const monDate = new Date(satD); monDate.setDate(satD.getDate() - 5); // 月曜
  const getDateStr = (base: Date, offset: number) => {
    const d = new Date(base); d.setDate(base.getDate() + offset);
    return d.toISOString().split('T')[0];
  };
  const monStr = getDateStr(monDate, 0);
  const tueStr = getDateStr(monDate, 1);
  const wedStr = getDateStr(monDate, 2);
  const thuStr = getDateStr(monDate, 3);
  const friStr = getDateStr(monDate, 4);
  const nextMonStr = getDateStr(monDate, 7);

  // ====== 月曜 ======
  // 週間レポート（前週の成績）
  items.push({
    id: id(), templateId: 'x-weekly', label: '🐦⑦ 週間レポート', date: satDate,
    text: generateText('x-weekly', satDate),
    charCount: 0, scheduledAt: `${monStr}T10:00:00`,
    status: 'pending', createdAt: now.toISOString(),
  });
  // 日常（月曜夜）
  items.push({
    id: id(), templateId: pickLifestyle(0), label: '🐦 日常ツイート（月）', date: monStr,
    text: generateText(pickLifestyle(0), monStr),
    charCount: 0, scheduledAt: `${monStr}T20:00:00`,
    status: 'pending', createdAt: now.toISOString(),
  });

  // ====== 火曜 ======
  items.push({
    id: id(), templateId: pickLifestyle(1), label: '🐦 日常ツイート（火）', date: tueStr,
    text: generateText(pickLifestyle(1), tueStr),
    charCount: 0, scheduledAt: `${tueStr}T21:00:00`,
    status: 'pending', createdAt: now.toISOString(),
  });

  // ====== 水曜 ======
  items.push({
    id: id(), templateId: 'x-course', label: '🐦⑨ コース解説', date: satDate,
    text: generateText('x-course', satDate),
    charCount: 0, scheduledAt: `${wedStr}T12:00:00`,
    status: 'pending', createdAt: now.toISOString(),
  });

  // ====== 木曜 ======
  items.push({
    id: id(), templateId: pickLifestyle(2), label: '🐦 日常ツイート（木）', date: thuStr,
    text: generateText(pickLifestyle(2), thuStr),
    charCount: 0, scheduledAt: `${thuStr}T22:00:00`,
    status: 'pending', createdAt: now.toISOString(),
  });

  // ====== 金曜 ======
  if (hasSat) {
    items.push({
      id: id(), templateId: 'x-preview', label: '🐦① 前日予告', date: satDate,
      text: generateText('x-preview', satDate),
      charCount: 0, scheduledAt: `${friStr}T20:30:00`,
      status: 'pending', createdAt: now.toISOString(),
    });
  }
  items.push({
    id: id(), templateId: pickLifestyle(0), label: '🐦 日常ツイート（金）', date: friStr,
    text: generateText(pickLifestyle(0), friStr),
    charCount: 0, scheduledAt: `${friStr}T22:00:00`,
    status: 'pending', createdAt: now.toISOString(),
  });

  // ====== 土曜 ======
  if (hasSat) {
    items.push({
      id: id(), templateId: 'x-morning', label: '🐦② 朝イチ注目（土）', date: satDate,
      text: generateText('x-morning', satDate),
      charCount: 0, scheduledAt: `${satDate}T08:00:00`,
      status: 'pending', createdAt: now.toISOString(),
    });

    const satTop = getTopRaceIndices(satPredPath, 3);
    const satPreds = JSON.parse(fs.readFileSync(satPredPath, 'utf-8')).predictions || [];
    for (const ri of satTop) {
      const race = satPreds[ri];
      const postTime = race?.postTime || '12:00';
      const [h, m] = postTime.split(':').map(Number);
      const schedH = Math.max(h - 1, 8);
      items.push({
        id: id(), templateId: race?.grade ? 'x-graded' : 'x-race',
        label: `🐦${race?.grade ? '④ 重賞' : '③ 個別'}予想 ${race?.venue}${race?.raceNumber}R`,
        date: satDate, raceIndex: ri,
        text: generateText(race?.grade ? 'x-graded' : 'x-race', satDate, ri),
        charCount: 0, scheduledAt: `${satDate}T${String(schedH).padStart(2,'0')}:${String(m || 0).padStart(2,'0')}:00`,
        status: 'pending', createdAt: now.toISOString(),
      });
    }

    items.push({
      id: id(), templateId: 'x-daily', label: '🐦⑥ 日次まとめ（土）', date: satDate,
      text: generateText('x-daily', satDate),
      charCount: 0, scheduledAt: `${satDate}T18:00:00`,
      status: 'pending', createdAt: now.toISOString(),
    });

    items.push({
      id: id(), templateId: 'x-bias', label: '🐦⑩ 馬場傾向速報（土→日）', date: satDate,
      text: generateText('x-bias', satDate),
      charCount: 0, scheduledAt: `${satDate}T19:00:00`,
      status: 'pending', createdAt: now.toISOString(),
    });
  }

  // ====== 日曜 ======
  if (hasSun) {
    items.push({
      id: id(), templateId: 'x-morning', label: '🐦② 朝イチ注目（日）', date: sunDate,
      text: generateText('x-morning', sunDate),
      charCount: 0, scheduledAt: `${sunDate}T08:00:00`,
      status: 'pending', createdAt: now.toISOString(),
    });

    const sunTop = getTopRaceIndices(sunPredPath, 3);
    const sunPreds = JSON.parse(fs.readFileSync(sunPredPath, 'utf-8')).predictions || [];
    for (const ri of sunTop) {
      const race = sunPreds[ri];
      const postTime = race?.postTime || '12:00';
      const [h] = postTime.split(':').map(Number);
      const schedH = Math.max(h - 1, 8);
      items.push({
        id: id(), templateId: race?.grade ? 'x-graded' : 'x-race',
        label: `🐦${race?.grade ? '④ 重賞' : '③ 個別'}予想 ${race?.venue}${race?.raceNumber}R`,
        date: sunDate, raceIndex: ri,
        text: generateText(race?.grade ? 'x-graded' : 'x-race', sunDate, ri),
        charCount: 0, scheduledAt: `${sunDate}T${String(schedH).padStart(2,'0')}:00:00`,
        status: 'pending', createdAt: now.toISOString(),
      });
    }

    items.push({
      id: id(), templateId: 'x-value', label: '🐦⑧ 穴馬ピック（日）', date: sunDate,
      text: generateText('x-value', sunDate),
      charCount: 0, scheduledAt: `${sunDate}T11:30:00`,
      status: 'pending', createdAt: now.toISOString(),
    });

    items.push({
      id: id(), templateId: 'x-daily', label: '🐦⑥ 日次まとめ（日）', date: sunDate,
      text: generateText('x-daily', sunDate),
      charCount: 0, scheduledAt: `${sunDate}T18:00:00`,
      status: 'pending', createdAt: now.toISOString(),
    });
  }

  // 文字数を計算
  items.forEach(item => { item.charCount = item.text.length; });

  return items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/** 時刻が来た承認済み投稿を自動投稿 */
async function processApprovedPosts(queue: QueueItem[]): Promise<number> {
  const now = new Date().toISOString();
  let posted = 0;

  for (const item of queue) {
    if (item.status === 'approved' && item.scheduledAt <= now) {
      const result = await postTweet(item.text);
      if (result.success) {
        item.status = 'posted';
        item.postedAt = new Date().toISOString();
        item.tweetId = result.tweetId;
        posted++;
      } else {
        item.status = 'failed';
        item.error = result.error;
      }
      appendLog(item);
      // レート制限対策
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return posted;
}

export async function GET() {
  let queue = loadQueue();

  // 時刻が来た承認済み投稿を自動実行
  if (isTwitterConfigured()) {
    const posted = await processApprovedPosts(queue);
    if (posted > 0) saveQueue(queue);
  }

  // ステータス別集計
  const stats = {
    pending: queue.filter(q => q.status === 'pending').length,
    approved: queue.filter(q => q.status === 'approved').length,
    rejected: queue.filter(q => q.status === 'rejected').length,
    posted: queue.filter(q => q.status === 'posted').length,
    failed: queue.filter(q => q.status === 'failed').length,
  };

  return NextResponse.json({ queue, stats, twitterConfigured: isTwitterConfigured() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, satDate, sunDate } = body;

  if (action === 'generate') {
    if (!satDate || !sunDate) {
      return NextResponse.json({ error: 'satDate と sunDate が必要です' }, { status: 400 });
    }
    const items = await generateWeeklyQueue(satDate, sunDate);
    // 既存キューに追加（同じ日のものは上書き）
    let queue = loadQueue();
    queue = queue.filter(q => q.date !== satDate && q.date !== sunDate);
    queue.push(...items);
    queue.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    saveQueue(queue);
    return NextResponse.json({ success: true, generated: items.length, queue });
  }

  if (action === 'approve-all') {
    const queue = loadQueue();
    queue.forEach(q => { if (q.status === 'pending') q.status = 'approved'; });
    saveQueue(queue);
    return NextResponse.json({ success: true, approved: queue.filter(q => q.status === 'approved').length });
  }

  if (action === 'clear-done') {
    let queue = loadQueue();
    queue = queue.filter(q => q.status !== 'posted' && q.status !== 'rejected');
    saveQueue(queue);
    return NextResponse.json({ success: true, remaining: queue.length });
  }

  return NextResponse.json({ error: '不明なaction' }, { status: 400 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, status, text, scheduledAt } = body;

  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const queue = loadQueue();
  const item = queue.find(q => q.id === id);
  if (!item) return NextResponse.json({ error: 'アイテムが見つかりません' }, { status: 404 });

  if (status) item.status = status;
  if (text) { item.text = text; item.charCount = text.length; }
  if (scheduledAt) item.scheduledAt = scheduledAt;

  saveQueue(queue);
  return NextResponse.json({ success: true, item });
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  let queue = loadQueue();
  queue = queue.filter(q => q.id !== id);
  saveQueue(queue);
  return NextResponse.json({ success: true });
}
