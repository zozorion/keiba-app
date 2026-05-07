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
async function generateText(templateId: string, date: string, raceIndex?: number, scheduledAt?: string): Promise<string> {
  return await generatePostText(templateId, date, raceIndex, scheduledAt);
}

/** 日常テンプレートのローテーション */
const LIFESTYLE_TEMPLATES = ['x-lifestyle-1', 'x-lifestyle-2', 'x-lifestyle-3'];
function pickLifestyle(seed: number): string {
  return LIFESTYLE_TEMPLATES[seed % LIFESTYLE_TEMPLATES.length];
}

/** 重賞レースを predictions.json → entries.json の順でフォールバック検出 */
interface GradedRace {
  raceName: string; grade: string; venue: string; surface: string;
  distance: number; raceNumber: number; raceIndex: number;
  date: string; // satDate or sunDate
}

/** 主要G1レース名パターン（スクレイパーがgrade取得に失敗した場合のフォールバック） */
const G1_RACE_NAMES = /天皇賞|ダービー|皐月賞|桜花賞|オークス|菊花賞|有馬記念|ジャパンC|安田記念|マイルCS|スプリンターズ|高松宮記念|フェブラリー|チャンピオンズC|NHKマイル|ヴィクトリアマイル|宝塚記念|エリザベス女王杯|秋華賞|阪神JF|朝日杯FS|ホープフルS/;

function detectGradedRaces(satDate: string, sunDate: string): GradedRace[] {
  const found: GradedRace[] = [];
  const seenRaceIds = new Set<string>();

  for (const d of [satDate, sunDate]) {
    // まず predictions.json を確認（枠順確定後）
    const predPath = path.join(process.cwd(), 'data', 'weekly', d, 'predictions.json');
    if (fs.existsSync(predPath)) {
      const preds = JSON.parse(fs.readFileSync(predPath, 'utf-8')).predictions || [];
      for (let i = 0; i < preds.length; i++) {
        const p = preds[i];
        let grade = p.grade;
        // gradeがOPだがレース名がG1パターンにマッチする場合は修正
        if ((!grade || grade === 'OP') && G1_RACE_NAMES.test(p.raceName)) grade = 'G1';
        if (grade && /G[123]/.test(grade)) {
          seenRaceIds.add(p.raceId || `${d}_${p.raceNumber}`);
          found.push({
            raceName: p.raceName, grade, venue: p.venue,
            surface: p.surface, distance: p.distance,
            raceNumber: p.raceNumber, raceIndex: i, date: d,
          });
        }
      }
      continue; // predictions があればそれを使う
    }

    // predictions.json が無い場合 → entries.json から検出（枠順確定前）
    const entriesPath = path.join(process.cwd(), 'data', 'weekly', d, 'entries.json');
    if (fs.existsSync(entriesPath)) {
      const races = JSON.parse(fs.readFileSync(entriesPath, 'utf-8')).races || [];
      for (let i = 0; i < races.length; i++) {
        const r = races[i];
        let grade = r.grade;
        if ((!grade || grade === 'OP') && G1_RACE_NAMES.test(r.raceName)) grade = 'G1';
        if (grade && /G[123]/.test(grade)) {
          const key = r.raceId || `${d}_${r.raceNumber}`;
          if (seenRaceIds.has(key)) continue;
          found.push({
            raceName: r.raceName, grade, venue: r.courseName || '',
            surface: r.surface || '', distance: r.distance || 0,
            raceNumber: r.raceNumber || 0, raceIndex: i, date: d,
          });
        }
      }
    }
  }
  return found;
}

/** グレードに応じた平日追加投稿テンプレ */
function getGradedWeekdayTemplates(grade: string): string[] {
  if (grade === 'G1') return ['x-graded-history', 'x-graded-memory', 'x-graded-data'];
  if (grade === 'G2') return ['x-graded-history', 'x-graded-data'];
  return ['x-graded-data']; // G3
}

/** グレードに応じた週末追加投稿テンプレ */
function getGradedWeekendTemplates(grade: string): string[] {
  if (grade === 'G1') return ['x-graded-preview', 'x-graded-ranking', 'x-graded-odds', 'x-graded-upset', 'x-graded-countdown'];
  if (grade === 'G2') return ['x-graded-preview', 'x-graded-keyhorse', 'x-graded-upset'];
  return ['x-graded-keyhorse']; // G3
}

/** グレード用ラベル生成 */
const GRADED_LABELS: Record<string, string> = {
  'x-graded-history': '🏆 レースの歴史', 'x-graded-memory': '🏆 思い出話',
  'x-graded-data': '🏆 データ考察', 'x-graded-preview': '🏆 出走馬注目点',
  'x-graded-ranking': '🏆 全頭短評', 'x-graded-odds': '🏆 オッズ考察',
  'x-graded-keyhorse': '🏆 鍵馬ピック', 'x-graded-countdown': '🏆 直前カウントダウン',
  'x-graded-upset': '🏆 激走穴馬',
};

type Plan = { templateId: string; label: string; date: string; raceIndex?: number; scheduledAt: string };

/** 共通: plansからキューアイテムを生成 */
async function buildQueueItems(plans: Plan[]): Promise<QueueItem[]> {
  const items: QueueItem[] = [];
  const now = new Date();
  const id = () => `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  for (const p of plans) {
    const text = await generateText(p.templateId, p.date, p.raceIndex, p.scheduledAt);
    items.push({
      id: id(), templateId: p.templateId, label: p.label, date: p.date,
      raceIndex: p.raceIndex, text, charCount: text.length,
      scheduledAt: p.scheduledAt, status: 'pending', createdAt: now.toISOString(),
    });
  }
  return items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/** Phase 1: 平日キュー（月〜木） */
async function generateWeekdayQueue(satDate: string, sunDate: string): Promise<QueueItem[]> {
  const satD = new Date(satDate + 'T00:00:00');
  const monDate = new Date(satD); monDate.setDate(satD.getDate() - 5);
  const getDateStr = (base: Date, offset: number) => {
    const d = new Date(base); d.setDate(base.getDate() + offset);
    return d.toISOString().split('T')[0];
  };
  const monStr = getDateStr(monDate, 0);
  const tueStr = getDateStr(monDate, 1);
  const wedStr = getDateStr(monDate, 2);
  const thuStr = getDateStr(monDate, 3);

  const plans: Plan[] = [];

  // ====== 月曜 ======
  plans.push({ templateId: 'x-weekly', label: '🐦⑦ 週間レポート', date: satDate, scheduledAt: `${monStr}T10:00:00` });
  plans.push({ templateId: pickLifestyle(0), label: '🐦 日常ツイート（月）', date: monStr, scheduledAt: `${monStr}T20:00:00` });

  // ====== 火曜 ======
  plans.push({ templateId: pickLifestyle(1), label: '🐦 日常ツイート（火）', date: tueStr, scheduledAt: `${tueStr}T21:00:00` });

  // ====== 水曜 ======
  plans.push({ templateId: 'x-course', label: '🐦⑨ コース解説', date: satDate, scheduledAt: `${wedStr}T12:00:00` });

  // ====== 木曜 ======
  plans.push({ templateId: pickLifestyle(2), label: '🐦 日常ツイート（木）', date: thuStr, scheduledAt: `${thuStr}T22:00:00` });

  // ====== 重賞 平日追加（予測データなしでもレース名で生成可能） ======
  const graded = detectGradedRaces(satDate, sunDate);
  const weekdaySlots = [
    { day: tueStr, time: '12:00:00' },
    { day: wedStr, time: '20:00:00' },
    { day: thuStr, time: '12:00:00' },
  ];
  let slotIdx = 0;
  for (const race of graded) {
    const templates = getGradedWeekdayTemplates(race.grade);
    for (const tmpl of templates) {
      if (slotIdx >= weekdaySlots.length) break;
      const slot = weekdaySlots[slotIdx++];
      plans.push({
        templateId: tmpl,
        label: `${GRADED_LABELS[tmpl]} ${race.raceName}`,
        date: race.date, raceIndex: race.raceIndex,
        scheduledAt: `${slot.day}T${slot.time}`,
      });
    }
  }

  return buildQueueItems(plans);
}

/** Phase 2: 週末キュー（金〜日） */
async function generateWeekendQueue(satDate: string, sunDate: string): Promise<QueueItem[]> {
  const satD = new Date(satDate + 'T00:00:00');
  const monDate = new Date(satD); monDate.setDate(satD.getDate() - 5);
  const friStr = new Date(monDate.getTime()); friStr.setDate(monDate.getDate() + 4);
  const friDateStr = friStr.toISOString().split('T')[0];

  const satPredPath = path.join(process.cwd(), 'data', 'weekly', satDate, 'predictions.json');
  const sunPredPath = path.join(process.cwd(), 'data', 'weekly', sunDate, 'predictions.json');
  const hasSat = fs.existsSync(satPredPath);
  const hasSun = fs.existsSync(sunPredPath);

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

  const plans: Plan[] = [];

  // ====== 金曜 ======
  if (hasSat) plans.push({ templateId: 'x-preview', label: '🐦① 前日予告', date: satDate, scheduledAt: `${friDateStr}T20:30:00` });
  plans.push({ templateId: pickLifestyle(0), label: '🐦 日常ツイート（金）', date: friDateStr, scheduledAt: `${friDateStr}T22:00:00` });

  // ====== 土曜 ======
  if (hasSat) {
    plans.push({ templateId: 'x-morning', label: '🐦② 朝イチ注目（土）', date: satDate, scheduledAt: `${satDate}T08:00:00` });
    const satTop = getTopRaceIndices(satPredPath, 3);
    const satPreds = JSON.parse(fs.readFileSync(satPredPath, 'utf-8')).predictions || [];
    for (const ri of satTop) {
      const race = satPreds[ri];
      const postTime = race?.postTime || '12:00';
      const [h, m] = postTime.split(':').map(Number);
      const schedH = Math.max(h - 1, 8);
      plans.push({
        templateId: race?.grade ? 'x-graded' : 'x-race',
        label: `🐦${race?.grade ? '④ 重賞' : '③ 個別'}予想 ${race?.venue}${race?.raceNumber}R`,
        date: satDate, raceIndex: ri,
        scheduledAt: `${satDate}T${String(schedH).padStart(2,'0')}:${String(m || 0).padStart(2,'0')}:00`,
      });
    }
    plans.push({ templateId: 'x-daily', label: '🐦⑥ 日次まとめ（土）', date: satDate, scheduledAt: `${satDate}T18:00:00` });
    plans.push({ templateId: 'x-bias', label: '🐦⑩ 馬場傾向速報（土→日）', date: satDate, scheduledAt: `${satDate}T19:00:00` });
  }

  // ====== 日曜 ======
  if (hasSun) {
    plans.push({ templateId: 'x-morning', label: '🐦② 朝イチ注目（日）', date: sunDate, scheduledAt: `${sunDate}T08:00:00` });
    const sunTop = getTopRaceIndices(sunPredPath, 3);
    const sunPreds = JSON.parse(fs.readFileSync(sunPredPath, 'utf-8')).predictions || [];
    for (const ri of sunTop) {
      const race = sunPreds[ri];
      const postTime = race?.postTime || '12:00';
      const [h] = postTime.split(':').map(Number);
      const schedH = Math.max(h - 1, 8);
      plans.push({
        templateId: race?.grade ? 'x-graded' : 'x-race',
        label: `🐦${race?.grade ? '④ 重賞' : '③ 個別'}予想 ${race?.venue}${race?.raceNumber}R`,
        date: sunDate, raceIndex: ri,
        scheduledAt: `${sunDate}T${String(schedH).padStart(2,'0')}:00:00`,
      });
    }
    plans.push({ templateId: 'x-value', label: '🐦⑧ 穴馬ピック（日）', date: sunDate, scheduledAt: `${sunDate}T11:30:00` });
    plans.push({ templateId: 'x-daily', label: '🐦⑥ 日次まとめ（日）', date: sunDate, scheduledAt: `${sunDate}T18:00:00` });
  }

  // ====== 重賞 週末追加 ======
  const graded = detectGradedRaces(satDate, sunDate);
  for (const race of graded) {
    const templates = getGradedWeekendTemplates(race.grade);
    const raceDay = race.date;
    const prevDay = new Date(raceDay + 'T00:00:00');
    prevDay.setDate(prevDay.getDate() - 1);
    const prevDayStr = prevDay.toISOString().split('T')[0];

    // 週末追加投稿のスロット割り当て
    const weekendSlots: { day: string; time: string }[] = [];
    for (const tmpl of templates) {
      if (tmpl === 'x-graded-countdown') {
        weekendSlots.push({ day: raceDay, time: '08:30:00' });
      } else if (tmpl === 'x-graded-preview') {
        weekendSlots.push({ day: prevDayStr, time: '18:00:00' });
      } else if (tmpl === 'x-graded-ranking') {
        weekendSlots.push({ day: prevDayStr, time: '21:00:00' });
      } else if (tmpl === 'x-graded-odds') {
        weekendSlots.push({ day: raceDay, time: '09:30:00' });
      } else if (tmpl === 'x-graded-upset') {
        weekendSlots.push({ day: raceDay, time: '10:00:00' });
      } else if (tmpl === 'x-graded-keyhorse') {
        weekendSlots.push({ day: raceDay, time: '10:30:00' });
      }
    }

    for (let i = 0; i < templates.length; i++) {
      const slot = weekendSlots[i];
      if (!slot) continue;
      plans.push({
        templateId: templates[i],
        label: `${GRADED_LABELS[templates[i]]} ${race.raceName}`,
        date: race.date, raceIndex: race.raceIndex,
        scheduledAt: `${slot.day}T${slot.time}`,
      });
    }
  }

  return buildQueueItems(plans);
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

  if (action === 'generate-weekday') {
    if (!satDate || !sunDate) {
      return NextResponse.json({ error: 'satDate と sunDate が必要です' }, { status: 400 });
    }
    const items = await generateWeekdayQueue(satDate, sunDate);
    const graded = detectGradedRaces(satDate, sunDate);
    // 既存キューから月〜木のscheduledAtのものだけ除去（金〜日は残す）
    let queue = loadQueue();
    const satD = new Date(satDate + 'T00:00:00');
    const friDate = new Date(satD); friDate.setDate(satD.getDate() - 1);
    const friStr = friDate.toISOString().split('T')[0];
    queue = queue.filter(q => q.scheduledAt >= `${friStr}T00:00:00`);
    queue.push(...items);
    queue.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    saveQueue(queue);
    return NextResponse.json({ success: true, generated: items.length, graded, queue });
  }

  if (action === 'generate-weekend') {
    if (!satDate || !sunDate) {
      return NextResponse.json({ error: 'satDate と sunDate が必要です' }, { status: 400 });
    }
    const items = await generateWeekendQueue(satDate, sunDate);
    const graded = detectGradedRaces(satDate, sunDate);
    // 既存キューから金〜日のscheduledAtのものだけ除去（月〜木は残す）
    let queue = loadQueue();
    const satD = new Date(satDate + 'T00:00:00');
    const friDate = new Date(satD); friDate.setDate(satD.getDate() - 1);
    const friStr = friDate.toISOString().split('T')[0];
    queue = queue.filter(q => q.scheduledAt < `${friStr}T00:00:00`);
    queue.push(...items);
    queue.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    saveQueue(queue);
    return NextResponse.json({ success: true, generated: items.length, graded, queue });
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
