/**
 * Gemini Pro クライアント
 *
 * .env.local の GEMINI_API_KEY を読む。
 * 投稿文の動的生成に使用。
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

function getApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

export function isGeminiConfigured(): boolean {
  return !!getApiKey();
}

export interface GenerateOptions {
  systemInstruction: string;
  userPrompt: string;
  /** 0.0〜1.0。投稿文の自然なバラつきを出すため少し高めを推奨 */
  temperature?: number;
  /** 出力上限トークン */
  maxOutputTokens?: number;
}

export interface GenerateResult {
  ok: boolean;
  text: string;
  error?: string;
}

/**
 * Gemini にテキスト生成を依頼。
 * 失敗時は ok: false を返す（呼び元でフォールバック判断）。
 */
export async function generateWithGemini(opts: GenerateOptions): Promise<GenerateResult> {
  const key = getApiKey();
  if (!key) {
    return { ok: false, text: '', error: 'GEMINI_API_KEY が未設定です。.env.local に追加してください。' };
  }

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: opts.systemInstruction,
      generationConfig: {
        temperature: opts.temperature ?? 0.95,
        maxOutputTokens: opts.maxOutputTokens ?? 800,
      },
    });

    const result = await model.generateContent(opts.userPrompt);
    const text = result.response.text().trim();
    return { ok: true, text };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, text: '', error: msg };
  }
}
