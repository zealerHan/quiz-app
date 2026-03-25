@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 武汉地铁5号线 乘务考核系统 v3
color 0B
echo.
echo  ╔══════════════════════════════════════╗
echo  ║  武汉地铁5号线 乘务业务考核系统 v3   ║
echo  ╚══════════════════════════════════════╝
echo.
node --version >nul 2>&1
if errorlevel 1 (echo  ❌ 请先安装 Node.js: https://nodejs.org/zh-cn/ & pause & exit /b)
if not exist "data" mkdir data
if not exist "logs" mkdir logs
if not exist ".env" (copy .env.example .env >nul & echo  ⚠  已创建 .env，请按需修改)
if not exist "node_modules" (
  echo  📦 安装依赖（首次约2分钟）...
  npm install --registry https://registry.npmmirror.com
  if errorlevel 1 (echo  ❌ 安装失败 & pause & exit /b)
)
if not exist "dist" (echo  🔨 构建前端... & npm run build)
echo  ✅ 启动成功！
echo.
echo  局域网访问地址（班组成员手机用 Chrome 输入）：
ipconfig | findstr /R "IPv4.*192\."
echo.
echo  格式：http://192.168.x.x:3000
echo  按 Ctrl+C 停止
echo.
node server/index.js
pause
