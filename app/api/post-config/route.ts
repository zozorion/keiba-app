/**
 * 投稿設定API（ペルソナ & ルール）
 * GET  /api/post-config  — 現在の設定を取得
 * PUT  /api/post-config  — 設定を更新
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'post-config.json');

export interface PostConfig {
  persona: {
    name: string;
    description: string;
    tone: string;
    favHorse: string;
    signoff: string;
  };
  rules: string[];
}

export function loadPostConfig(): PostConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }
  return {
    persona: { name: '', description: '', tone: '', favHorse: '', signoff: '' },
    rules: [],
  };
}

export function applyRules(text: string, config: PostConfig): string {
  let result = text;
  // Markdown記法を除去
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');  // **太字** → 太字
  result = result.replace(/^#{1,6}\s/gm, '');         // ## 見出し → 見出し
  result = result.replace(/`(.+?)`/g, '$1');           // `code` → code
  result = result.replace(/\[(.+?)\]\(.+?\)/g, '$1');  // [text](url) → text

  // ペルソナ変数の注入
  result = result.replace(/\{persona_name\}/g, config.persona.name || '');
  result = result.replace(/\{persona_signoff\}/g, config.persona.signoff || '');
  result = result.replace(/\{persona_fav\}/g, config.persona.favHorse || '');

  // ptスコア表記を除去
  result = result.replace(/[\(（]\d+pt[\)）]/g, '');  // （80pt）や(80pt)
  result = result.replace(/\s*\d+pt\s*/g, ' ');        // 単体の80pt

  return result.trim();
}

export async function GET() {
  const config = loadPostConfig();
  return NextResponse.json(config);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(body, null, 2));
  return NextResponse.json({ success: true });
}
