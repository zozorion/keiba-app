/**
 * ヘルスチェック API
 * GET /api/health → { status: "ok", uptime: ... }
 * 
 * Railwayのヘルスチェックに使用。
 * CSVデータの読み込み状況も返す。
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const startedAt = Date.now();

export async function GET() {
  const rawDir = path.join(process.cwd(), 'data', 'raw');
  const hasResults = fs.existsSync(path.join(rawDir, 'results.csv'));
  const hasRaces = fs.existsSync(path.join(rawDir, 'races.csv'));
  const hasSire = fs.existsSync(path.join(rawDir, 'horses_sire.csv'));

  return NextResponse.json({
    status: 'ok',
    uptime: Math.round((Date.now() - startedAt) / 1000),
    dataFiles: {
      'results.csv': hasResults,
      'races.csv': hasRaces,
      'horses_sire.csv': hasSire,
    },
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
}
