/**
 * 自動投稿スケジューラー
 * サーバーサイドで30秒ごとにキューをチェックし、
 * 承認済み＆時刻到来の投稿を自動でXに送信する。
 * ブラウザを開く必要なし。
 */

import fs from 'fs';
import path from 'path';
import { postTweet, isTwitterConfigured } from './twitter';

const QUEUE_PATH = path.join(process.cwd(), 'data', 'post-queue.json');
const LOG_PATH = path.join(process.cwd(), 'data', 'posts-log.json');

interface QueueItem {
  id: string;
  templateId: string;
  label: string;
  text: string;
  charCount: number;
  scheduledAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'posted' | 'failed';
  date: string;
  raceIndex?: number;
  createdAt: string;
  postedAt?: string;
  tweetId?: string;
  error?: string;
}

function loadQueue(): QueueItem[] {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueItem[]) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function appendLog(item: QueueItem) {
  const log = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')) : [];
  log.push({ ...item, loggedAt: new Date().toISOString() });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log.slice(-200), null, 2));
}

async function processQueue() {
  if (!isTwitterConfigured()) return;

  const queue = loadQueue();
  const now = new Date();
  // ローカル時刻文字列を生成（YYYY-MM-DDTHH:mm:ss）
  const nowStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + 'T' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');

  let changed = false;

  for (const item of queue) {
    if (item.status === 'approved' && item.scheduledAt <= nowStr) {
      console.log(`[AutoPoster] 投稿中: ${item.label} (${item.scheduledAt})`);
      try {
        const result = await postTweet(item.text);
        if (result.success) {
          item.status = 'posted';
          item.postedAt = new Date().toISOString();
          item.tweetId = result.tweetId;
          console.log(`[AutoPoster] ✅ 投稿完了: ${item.label} → ${result.tweetId}`);
        } else {
          item.status = 'failed';
          item.error = result.error;
          console.log(`[AutoPoster] ❌ 失敗: ${item.label} → ${result.error}`);
        }
      } catch (e: any) {
        item.status = 'failed';
        item.error = e.message;
        console.log(`[AutoPoster] ❌ エラー: ${item.label} → ${e.message}`);
      }
      changed = true;
      appendLog(item);
      // 各投稿後に即保存（リトライ防止）
      saveQueue(queue);
      // レート制限対策（2秒間隔）
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (changed) {
    console.log(`[AutoPoster] キュー処理完了`);
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startAutoPostScheduler() {
  if (intervalId) return; // 多重起動防止

  console.log('[AutoPoster] 🚀 自動投稿スケジューラー開始（30秒間隔）');

  // 起動時に1回チェック
  processQueue().catch(console.error);

  // 30秒ごとにチェック
  intervalId = setInterval(() => {
    processQueue().catch(console.error);
  }, 30_000);
}

export function stopAutoPostScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[AutoPoster] ⏹ 自動投稿スケジューラー停止');
  }
}
