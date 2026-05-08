/**
 * コミュニティ投稿テンプレートAPI
 * GET    /api/community-templates                 — 一覧
 * POST   /api/community-templates  { sourceTweet, sourceAuthor? } — AI分析→保存
 * DELETE /api/community-templates?id=xxx          — 削除
 * PATCH  /api/community-templates  { id, favorited } — お気に入り切替
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listTemplates,
  addTemplateFromTweet,
  deleteTemplate,
  setFavorited,
} from '../../../lib/community-templates';

export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ templates: listTemplates() });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON ボディが不正です' }, { status: 400 });
  }
  const { sourceTweet, sourceAuthor } = body || {};
  if (!sourceTweet || typeof sourceTweet !== 'string') {
    return NextResponse.json({ error: 'sourceTweet が必要です' }, { status: 400 });
  }
  const result = await addTemplateFromTweet(sourceTweet, sourceAuthor);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ template: result.template });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });
  const ok = deleteTemplate(id);
  if (!ok) return NextResponse.json({ error: '該当テンプレが見つかりません' }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON ボディが不正です' }, { status: 400 });
  }
  const { id, favorited } = body || {};
  if (!id || typeof favorited !== 'boolean') {
    return NextResponse.json({ error: 'id と favorited(boolean) が必要です' }, { status: 400 });
  }
  const ok = setFavorited(id, favorited);
  if (!ok) return NextResponse.json({ error: '該当テンプレが見つかりません' }, { status: 404 });
  return NextResponse.json({ success: true });
}
