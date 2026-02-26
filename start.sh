#!/bin/bash
# WeConnect 快速启动脚本

echo "🚀 启动 WeConnect..."

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
  echo "📦 首次运行，安装依赖..."
  npm install
  echo "🌐 安装 Playwright 浏览器..."
  npx playwright install chromium
fi

# 杀掉已有的 node 进程（避免端口占用）
echo "🔄 清理旧进程..."
pkill -f "node server.js" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

# 启动
echo "✅ 启动服务..."
npm run dev
