/**
 * スクレイプ実行API
 * POST /api/scrape?date=2026-05-09&date=2026-05-10
 * GET  /api/scrape/status?id=xxx
 * 
 * UIからボタン1つでスクレイプを実行する
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// 実行中のジョブを管理
const jobs = new Map<string, any>();

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const dates = searchParams.getAll('date');

  if (dates.length === 0) {
    return NextResponse.json({ error: 'date パラメータが必要です (例: ?date=2026-05-09&date=2026-05-10)' }, { status: 400 });
  }

  // ジョブID生成
  const jobId = `scrape_${Date.now()}`;
  const job: { status: string; output: string[]; startedAt: string; finishedAt?: string; error?: string } = {
    status: 'running',
    output: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  // スクレイパーを子プロセスで実行
  const scriptPath = path.join(process.cwd(), 'scripts', 'scrape-weekend.mjs');
  
  if (!fs.existsSync(scriptPath)) {
    return NextResponse.json({ error: 'スクレイプスクリプトが見つかりません' }, { status: 500 });
  }

  const child = spawn('node', [scriptPath, ...dates], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (data: Buffer) => {
    const lines = data.toString('utf-8').split('\n').filter(l => l.trim());
    job.output.push(...lines);
    // 最大500行保持
    if (job.output.length > 500) job.output = job.output.slice(-500);
  });

  child.stderr.on('data', (data: Buffer) => {
    job.output.push(`[ERROR] ${data.toString('utf-8').trim()}`);
  });

  child.on('close', (code: number | null) => {
    job.status = code === 0 ? 'done' : 'error';
    job.finishedAt = new Date().toISOString();
    if (code !== 0) job.error = `終了コード: ${code}`;
    // 30分後にジョブを削除
    setTimeout(() => jobs.delete(jobId), 30 * 60 * 1000);
  });

  child.on('error', (err: Error) => {
    job.status = 'error';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
  });

  return NextResponse.json({
    success: true,
    jobId,
    message: `${dates.join(', ')} のスクレイプを開始しました`,
    dates,
  });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const jobId = searchParams.get('jobId');

  if (jobId) {
    const job = jobs.get(jobId);
    if (!job) {
      return NextResponse.json({ error: 'ジョブが見つかりません' }, { status: 404 });
    }
    return NextResponse.json({
      jobId,
      ...job,
      // 最新の20行だけ返す（UIに表示用）
      recentOutput: job.output.slice(-20),
      totalLines: job.output.length,
    });
  }

  // ジョブIDなし → 利用可能な日付のデータ状況を返す
  const weeklyDir = path.join(process.cwd(), 'data', 'weekly');
  const available: Record<string, { hasEntries: boolean; hasResults: boolean; hasPredictions: boolean; racesCount: number }> = {};

  if (fs.existsSync(weeklyDir)) {
    const dirs = fs.readdirSync(weeklyDir).filter(d => d.match(/^\d{4}-\d{2}-\d{2}$/));
    for (const dir of dirs) {
      const dirPath = path.join(weeklyDir, dir);
      const hasEntries = fs.existsSync(path.join(dirPath, 'entries.json'));
      const hasResults = fs.existsSync(path.join(dirPath, 'results.json'));
      const hasPredictions = fs.existsSync(path.join(dirPath, 'predictions.json'));
      let racesCount = 0;
      if (hasEntries) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dirPath, 'entries.json'), 'utf-8'));
          racesCount = data.races?.length || 0;
        } catch {}
      }
      available[dir] = { hasEntries, hasResults, hasPredictions, racesCount };
    }
  }

  return NextResponse.json({ available, activeJobs: [...jobs.entries()].map(([id, j]) => ({ id, status: j.status, startedAt: j.startedAt })) });
}
