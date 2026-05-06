/**
 * 競馬予想エンジン — データローダー
 * results.csv, races.csv, horses_sire.csv, 分析済JSONを読み込み
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { PastRecord, AnalyzedData, SireRankingEntry } from './types';
import { VENUE_MAP } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const ANALYZED_DIR = path.join(DATA_DIR, 'analyzed');

// ============================================================
// CSV読み込みキャッシュ
// ============================================================
let resultsCache: any[] | null = null;
let racesCache: any[] | null = null;
let sireCache: Map<string, string> | null = null;

/**
 * results.csv を読み込み（キャッシュ付き）
 */
export function loadResults(): any[] {
  if (resultsCache) return resultsCache;

  const csvPath = path.join(RAW_DIR, 'results.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn(`results.csv not found at ${csvPath}`);
    return [];
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  resultsCache = parse(content, {
    columns: true,
    skip_empty_lines: true,
    cast: (value: string, context: any) => {
      // 数値カラムをキャスト
      const numCols = [
        'finish_position', 'bracket_number', 'horse_number',
        'age', 'weight_carry', 'time_seconds', 'last_3f',
        'odds', 'popularity', 'horse_weight', 'weight_diff', 'num_runners'
      ];
      if (numCols.includes(context.column)) {
        const n = parseFloat(value);
        return isNaN(n) ? null : n;
      }
      return value;
    }
  });

  console.log(`Loaded ${resultsCache!.length.toLocaleString()} results`);
  return resultsCache!;
}

/**
 * races.csv を読み込み（キャッシュ付き）
 */
export function loadRaces(): any[] {
  if (racesCache) return racesCache;

  const csvPath = path.join(RAW_DIR, 'races.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn(`races.csv not found at ${csvPath}`);
    return [];
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  racesCache = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    cast: (value: string, context: any) => {
      const numCols = ['distance', 'course_code', 'race_number', 'date'];
      if (numCols.includes(context.column)) {
        const n = parseFloat(value);
        return isNaN(n) ? null : n;
      }
      return value;
    }
  });

  console.log(`Loaded ${racesCache!.length.toLocaleString()} races`);
  return racesCache!;
}

/**
 * 馬名 → 種牡馬マッピングを読み込み
 */
export function loadSireMap(): Map<string, string> {
  if (sireCache) return sireCache;

  const csvPath = path.join(RAW_DIR, 'horses_sire.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn(`horses_sire.csv not found at ${csvPath}`);
    return new Map();
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];

  sireCache = new Map();
  for (const r of records) {
    if (r.horse_name && r.sire) {
      sireCache.set(r.horse_name, r.sire);
    }
  }

  console.log(`Loaded ${sireCache.size.toLocaleString()} horse-sire mappings`);
  return sireCache;
}

/**
 * 分析済JSONを読み込み
 * @param courseName - 競馬場英名（tokyo, kyoto等）
 * @param surface - "turf" | "dirt"
 * @param distance - 距離(m)
 */
export function loadAnalyzedData(
  courseName: string,
  surface: string,
  distance: number
): AnalyzedData | null {
  const filePath = path.join(ANALYZED_DIR, courseName, `${surface}_${distance}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as AnalyzedData;
  } catch (e) {
    console.error(`Failed to parse ${filePath}:`, e);
    return null;
  }
}

/**
 * 馬名から過去成績を取得
 * データ事実のみを返す
 */
export function getHorseHistory(
  horseName: string,
  beforeDate: number = 99999999,
  maxRecent: number = 10
): PastRecord[] {
  const results = loadResults();
  const races = loadRaces();

  // 馬名でフィルタ
  const horseResults = results.filter((r: any) => r.horse_name === horseName);
  if (horseResults.length === 0) return [];

  // races情報をマージ
  const raceMap = new Map<string, any>();
  for (const race of races) {
    raceMap.set(race.race_id, race);
  }

  const records: PastRecord[] = [];
  for (const r of horseResults) {
    const raceInfo = raceMap.get(r.race_id);
    const dateInt = raceInfo?.date ?? parseInt(r.race_id?.substring(0, 8) || '0');

    if (dateInt >= beforeDate) continue; // 未来データ除外

    records.push({
      raceId: r.race_id,
      date: dateInt,
      finish: r.finish_position,
      last3f: r.last_3f,
      passingOrder: r.passing_order || '',
      odds: r.odds,
      popularity: r.popularity,
      surface: raceInfo?.surface || '',
      distance: raceInfo?.distance || 0,
      courseName: raceInfo?.course_name || '',
      condition: raceInfo?.track_condition || '',
      timeSeconds: r.time_seconds,
      numRunners: r.num_runners,
      weightCarry: r.weight_carry,
    });
  }

  // 日付降順ソート
  records.sort((a, b) => b.date - a.date);

  return records.slice(0, maxRecent);
}

/**
 * 使用可能な全分析データの一覧を取得
 */
export function listAvailableAnalysis(): { course: string; surface: string; distance: number }[] {
  const result: { course: string; surface: string; distance: number }[] = [];

  if (!fs.existsSync(ANALYZED_DIR)) return result;

  const venues = fs.readdirSync(ANALYZED_DIR);
  for (const venue of venues) {
    const venueDir = path.join(ANALYZED_DIR, venue);
    if (!fs.statSync(venueDir).isDirectory()) continue;

    const files = fs.readdirSync(venueDir);
    for (const file of files) {
      const match = file.match(/^(turf|dirt)_(\d+)\.json$/);
      if (match) {
        result.push({
          course: venue,
          surface: match[1],
          distance: parseInt(match[2]),
        });
      }
    }
  }

  return result;
}

/**
 * キャッシュクリア（テスト用）
 */
export function clearCache(): void {
  resultsCache = null;
  racesCache = null;
  sireCache = null;
}
