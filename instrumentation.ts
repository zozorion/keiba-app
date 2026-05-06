/**
 * Next.js Instrumentation
 * サーバー起動時にバックグラウンドで投稿キューの自動処理を開始。
 * ブラウザを開いていなくても、dev serverが動いていれば自動投稿される。
 */

export async function register() {
  // サーバーサイドでのみ実行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startAutoPostScheduler } = await import('./lib/auto-poster');
    startAutoPostScheduler();
  }
}
