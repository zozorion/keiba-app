/**
 * X OAuth 1.0a トークン取得スクリプト
 * 
 * nakazo_ethのアプリ（クレジット付き）で @bakauma_ 用のアクセストークンを発行する。
 * 
 * 事前準備:
 *   nakazo_ethのDeveloper Portal → アプリ設定 → User authentication settings で
 *   Callback URL に http://127.0.0.1:3333/callback を追加しておくこと。
 * 
 * 使い方: node scripts/oauth-setup.js
 */

const http = require('http');
const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

// .env.local からAPI Key/Secretを読み取る
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const getEnv = (key) => {
  const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match ? match[1].trim() : '';
};

const API_KEY = getEnv('X_API_KEY');
const API_SECRET = getEnv('X_API_SECRET');
const CALLBACK_URL = 'http://127.0.0.1:3333/callback';
const PORT = 3333;

if (!API_KEY || !API_SECRET) {
  console.error('❌ .env.local に X_API_KEY / X_API_SECRET が見つかりません');
  process.exit(1);
}

async function main() {
  console.log('=== X OAuth トークン取得ツール ===\n');

  // Step 1: リクエストトークン取得
  const client = new TwitterApi({ appKey: API_KEY, appSecret: API_SECRET });
  
  let authLink;
  try {
    authLink = await client.generateAuthLink(CALLBACK_URL, { linkMode: 'authorize' });
  } catch (e) {
    console.error('❌ リクエストトークン取得失敗:', e.message);
    console.error('\n→ nakazo_ethのDeveloper Portal で:');
    console.error('  1. アプリの User authentication settings を開く');
    console.error('  2. Callback URL に http://127.0.0.1:3333/callback を追加');
    console.error('  3. App permissions を Read and Write に設定');
    console.error('  4. Save して再実行');
    process.exit(1);
  }

  console.log('✅ リクエストトークン取得成功\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('以下のURLをブラウザで開いて、@bakauma_ でログインして「許可」を押してください:');
  console.log('\n' + authLink.url + '\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n⏳ ブラウザからのコールバックを待機中...\n');

  // Step 2: ローカルサーバーでコールバック待ち
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const oauthToken = url.searchParams.get('oauth_token');
      const oauthVerifier = url.searchParams.get('oauth_verifier');

      if (!oauthVerifier) {
        res.writeHead(400);
        res.end('認証がキャンセルされました');
        server.close();
        process.exit(1);
      }

      try {
        // Step 3: アクセストークン取得
        const loginClient = new TwitterApi({
          appKey: API_KEY,
          appSecret: API_SECRET,
          accessToken: authLink.oauth_token,
          accessSecret: authLink.oauth_token_secret,
        });

        const { accessToken, accessSecret, screenName, userId } = 
          await loginClient.login(oauthVerifier);

        console.log(`\n✅ 認証成功！ @${screenName} (ID: ${userId})\n`);
        console.log('━━━━━━━━━━━ トークン取得完了 ━━━━━━━━━━━');
        console.log('→ .env.local に自動保存します...');

        // Step 4: .env.local に書き込み
        const envPath = path.join(__dirname, '..', '.env.local');
        let envContent = fs.readFileSync(envPath, 'utf-8');
        
        envContent = envContent.replace(/^X_API_KEY=.*/m, `X_API_KEY=${API_KEY}`);
        envContent = envContent.replace(/^X_API_SECRET=.*/m, `X_API_SECRET=${API_SECRET}`);
        envContent = envContent.replace(/^X_ACCESS_TOKEN=.*/m, `X_ACCESS_TOKEN=${accessToken}`);
        envContent = envContent.replace(/^X_ACCESS_TOKEN_SECRET=.*/m, `X_ACCESS_TOKEN_SECRET=${accessSecret}`);
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ .env.local を更新しました！');
        console.log('→ npm run dev を再起動すれば自動投稿が動きます\n');

        // ブラウザに成功メッセージ
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#1a1a2e;color:#fff">
            <h1>✅ 認証成功！</h1>
            <p>@${screenName} のアクセストークンを取得しました。</p>
            <p>.env.local に自動保存済みです。</p>
            <p style="color:#888">このページは閉じてOKです。</p>
          </body></html>
        `);
      } catch (e) {
        console.error('❌ アクセストークン取得失敗:', e.message);
        res.writeHead(500);
        res.end('トークン取得に失敗しました: ' + e.message);
      }

      server.close();
      resolve();
    });

    server.listen(PORT, () => {
      console.log(`ローカルサーバー起動: http://127.0.0.1:${PORT}`);
    });
  });
}

main().catch(console.error);
