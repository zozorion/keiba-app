/**
 * X (Twitter) API クライアント
 * twitter-api-v2 を使用した投稿機能
 */

import { TwitterApi } from 'twitter-api-v2';

// クライアントは毎回新しいenvを読むためにキャッシュしない
function getClient(): TwitterApi | null {
  const apiKey = process.env.X_API_KEY || process.env.TWITTER_API_KEY;
  const apiSecret = process.env.X_API_SECRET || process.env.TWITTER_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET || process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    return null;
  }

  return new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken: accessToken,
    accessSecret: accessSecret,
  });
}

/** X APIが設定済みかチェック */
export function isTwitterConfigured(): boolean {
  return !!(
    (process.env.X_API_KEY || process.env.TWITTER_API_KEY) &&
    (process.env.X_API_SECRET || process.env.TWITTER_API_SECRET) &&
    (process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN) &&
    (process.env.X_ACCESS_TOKEN_SECRET || process.env.TWITTER_ACCESS_SECRET)
  );
}

/** ツイートを投稿 */
export async function postTweet(text: string): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  const tw = getClient();
  if (!tw) {
    return { success: false, error: 'X APIキーが未設定です。.env.localにTWITTER_API_KEY等を設定してください。' };
  }

  try {
    const { data } = await tw.v2.tweet(text);
    return { success: true, tweetId: data.id };
  } catch (e: any) {
    // レート制限
    if (e?.code === 429) {
      return { success: false, error: 'レート制限中です。しばらく待ってから再試行してください。' };
    }
    return { success: false, error: e?.message || '投稿に失敗しました' };
  }
}

/** スレッド（連続ツイート）を投稿 */
export async function postThread(texts: string[]): Promise<{ success: boolean; tweetIds?: string[]; error?: string }> {
  const tw = getClient();
  if (!tw) {
    return { success: false, error: 'X APIキーが未設定です。' };
  }

  try {
    const tweetIds: string[] = [];
    let replyTo: string | undefined;

    for (const text of texts) {
      const options: any = {};
      if (replyTo) {
        options.reply = { in_reply_to_tweet_id: replyTo };
      }
      const { data } = await tw.v2.tweet(text, options);
      tweetIds.push(data.id);
      replyTo = data.id;
      // レート制限対策
      await new Promise(r => setTimeout(r, 1000));
    }

    return { success: true, tweetIds };
  } catch (e: any) {
    return { success: false, error: e?.message || 'スレッド投稿に失敗しました' };
  }
}
