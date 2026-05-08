import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "競馬予想ダッシュボード",
  description: "データ駆動型の競馬予想・自動投稿システム",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <div className="app-container">
          <header className="header">
            <div className="header-brand">
              <div>
                <h1>🏇 競馬予想ダッシュボード</h1>
                <span className="subtitle">DATA-DRIVEN PREDICTION SYSTEM</span>
              </div>
            </div>
            <div className="header-actions">
              <nav className="nav-links">
                <a href="/" className="nav-link active">ダッシュボード</a>
                <a href="/results" className="nav-link">📊 結果検証</a>
                <a href="/posts" className="nav-link">📝 投稿作成</a>
                <a href="/templates-community" className="nav-link">📚 構成テンプレ</a>
                <a href="/queue" className="nav-link">📮 キュー</a>
                <a href="/learning" className="nav-link">🧠 学習ログ</a>
                <a href="/settings" className="nav-link">⚙️ 設定</a>
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
