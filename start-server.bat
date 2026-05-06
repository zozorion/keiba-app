@echo off
REM 競馬予想ダッシュボード自動起動スクリプト
REM このファイルをスタートアップフォルダに配置すると、PC起動時に自動でサーバーが立ち上がります
REM 
REM 配置先: 
REM   Win+R → shell:startup → このファイルをコピー
REM
REM または手動実行: このファイルをダブルクリック

cd /d "c:\Users\srf69\OneDrive\Desktop\運用版\keiba-app"

echo.
echo ========================================
echo   競馬予想ダッシュボード 起動中...
echo ========================================
echo.
echo   ブラウザで以下を開いてください:
echo   http://localhost:3000
echo.
echo   このウィンドウは閉じないでください
echo   （閉じるとサーバーが停止します）
echo ========================================
echo.

npm run dev
