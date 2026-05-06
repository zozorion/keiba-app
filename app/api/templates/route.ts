/**
 * テンプレートAPI Route
 * GET  /api/templates — テンプレート一覧取得
 * POST /api/templates — テンプレート更新
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const TEMPLATES_DIR = path.join(process.cwd(), 'templates');
const DEFAULTS_PATH = path.join(TEMPLATES_DIR, 'defaults.json');
const CUSTOM_PATH = path.join(TEMPLATES_DIR, 'custom.json');

function loadTemplates() {
  const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf-8'));

  // カスタム設定があればマージ
  if (fs.existsSync(CUSTOM_PATH)) {
    const custom = JSON.parse(fs.readFileSync(CUSTOM_PATH, 'utf-8'));
    return { ...defaults, ...custom };
  }

  return defaults;
}

export async function GET() {
  try {
    const templates = loadTemplates();
    return NextResponse.json(templates);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, template, name, description } = body;

    if (!key || !template) {
      return NextResponse.json({ error: 'key and template are required' }, { status: 400 });
    }

    // カスタム設定を読み込みまたは初期化
    let custom: any = {};
    if (fs.existsSync(CUSTOM_PATH)) {
      custom = JSON.parse(fs.readFileSync(CUSTOM_PATH, 'utf-8'));
    }

    custom[key] = {
      name: name || key,
      template,
      description: description || '',
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(CUSTOM_PATH, JSON.stringify(custom, null, 2), 'utf-8');

    return NextResponse.json({ success: true, key });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
