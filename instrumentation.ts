/**
 * Next.js Instrumentation
 * サーバー起動時にバックグラウンドで:
 * 1. 過去データCSV（results.csv, races.csv, horses_sire.csv）をメモリにプリロード
 * 2. 投稿キューの自動処理を開始
 */

export async function register() {
  // サーバーサイドでのみ実行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // CSV データのプリロード（初回リクエストのブロッキングを回避）
    try {
      const { loadResults, loadRaces, loadSireMap } = await import('./engine/data-loader');
      console.log('[Startup] CSVデータをプリロード中...');
      const t0 = Date.now();
      loadSireMap();
      loadResults();
      loadRaces();
      console.log(`[Startup] CSVプリロード完了 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e: any) {
      console.warn(`[Startup] CSVプリロード失敗（API呼び出し時にリトライします）: ${e.message}`);
    }

    // 自動投稿スケジューラー
    const { startAutoPostScheduler } = await import('./lib/auto-poster');
    startAutoPostScheduler();
  }
}

