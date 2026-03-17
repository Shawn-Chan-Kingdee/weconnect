/**
 * WeConnect Server
 * Express backend with WebSocket support for real-time updates
 * Supports tri-platform monitoring: WeChat + Yunzhijia (云之家) + Feishu (飞书)
 */
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'

import wechatRoutes from './server/routes/wechat.js'
import yunzhijiaRoutes from './server/routes/yunzhijia.js'
import settingsRoutes from './server/routes/settings.js'
import messagesRoutes from './server/routes/messages.js'
import todosRoutes from './server/routes/todos.js'
import modelsRoutes from './server/routes/models.js'
import monitorService from './server/services/monitor.js'
import yzjMonitorService from './server/services/yunzhijia-monitor.js'
import feishuRoutes from './server/routes/feishu.js'
import feishuMonitorService from './server/services/feishu-monitor.js'
const BROWSER_OP_TIMEOUT = 15000  // 与 base-monitor.js 保持一致
import { runStartupTasks } from './server/services/lifecycle.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const server = createServer(app)
const PORT = process.env.PORT || 3210

// Middleware
app.use(cors())
app.use(express.json())

// API Routes
app.use('/api/wechat', wechatRoutes)
app.use('/api/yunzhijia', yunzhijiaRoutes)
app.use('/api/feishu', feishuRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/todos', todosRoutes)
app.use('/api/models', modelsRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── 双平台监控综合诊断 ──────────────────────────────────────────────────────
// 访问 http://localhost:3210/api/monitor-status 查看两个监控器的实时状态
app.get('/api/monitor-status', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    wechat: monitorService.getStatus(),
    yunzhijia: yzjMonitorService.getStatus(),
    feishu: feishuMonitorService.getStatus()
  })
})

// ── 完整 Debug 诊断端点（含事件日志 + 计时统计 + 对比分析）──────────────────
// 访问 http://localhost:3210/api/debug/live 获取两个监控器的完整诊断数据
app.get('/api/debug/live', (req, res) => {
  const wechatDebug = monitorService.getDebugData()
  const yzjDebug = yzjMonitorService.getDebugData()
  const feishuDebug = feishuMonitorService.getDebugData()

  // ── 自动诊断分析 ──────────────────────────────────────────────────
  const issues = []

  // 检查1: 监控是否在运行
  if (!wechatDebug.isRunning) issues.push('❌ WeChat monitor 未运行')
  if (!yzjDebug.isRunning) issues.push('❌ Yunzhijia monitor 未运行')
  if (!feishuDebug.isRunning) issues.push('❌ Feishu monitor 未运行')

  // 检查2: 登录状态
  if (wechatDebug.isRunning && wechatDebug.stats.lastLoginCheck === false) {
    issues.push('❌ WeChat 未登录 (lastLoginCheck=false)')
  }
  if (yzjDebug.isRunning && yzjDebug.stats.lastLoginCheck === false) {
    issues.push('❌ Yunzhijia 未登录 (lastLoginCheck=false)')
  }
  if (feishuDebug.isRunning && feishuDebug.stats.lastLoginCheck === false) {
    issues.push('❌ Feishu 未登录 (lastLoginCheck=false)')
  }

  // 检查3: 扫描锁卡死
  if (wechatDebug.scanning) issues.push('⚠ WeChat _scanning=true (可能卡死)')
  if (yzjDebug.scanning) issues.push('⚠ Yunzhijia _scanning=true (可能卡死)')
  if (feishuDebug.scanning) issues.push('⚠ Feishu _scanning=true (可能卡死)')

  // 检查4: myName 检测
  if (wechatDebug.isRunning && !wechatDebug.stats.myNameDetected) {
    issues.push('⚠ WeChat myName=null (群聊@me无法触发)')
  }
  if (yzjDebug.isRunning && !yzjDebug.stats.myNameDetected) {
    issues.push('⚠ Yunzhijia myName=null (群聊@me无法触发)')
  }
  if (feishuDebug.isRunning && !feishuDebug.stats.myNameDetected) {
    issues.push('⚠ Feishu myName=null (群聊@me无法触发)')
  }

  // 检查5: 轮询活跃度对比
  const now = Date.now()
  for (const [label, debug] of [['WeChat', wechatDebug], ['Yunzhijia', yzjDebug], ['Feishu', feishuDebug]]) {
    if (!debug.isRunning) continue
    const lastFast = debug.stats.lastFastPoll ? new Date(debug.stats.lastFastPoll).getTime() : 0
    const lastFull = debug.stats.lastFullScan ? new Date(debug.stats.lastFullScan).getTime() : 0
    const lastActivity = Math.max(lastFast, lastFull)
    const silentMs = now - lastActivity
    if (silentMs > 120000) {
      issues.push(`❌ ${label} 已 ${Math.round(silentMs/1000)}s 无活动 (轮询可能已死)`)
    } else if (silentMs > 30000) {
      issues.push(`⚠ ${label} 已 ${Math.round(silentMs/1000)}s 无活动`)
    }
  }

  // 检查6: 错误率
  for (const [label, debug] of [['WeChat', wechatDebug], ['Yunzhijia', yzjDebug], ['Feishu', feishuDebug]]) {
    if (!debug.isRunning) continue
    const totalOps = debug.stats.fastPolls + debug.stats.fullScans
    if (totalOps > 0 && debug.stats.errors / totalOps > 0.3) {
      issues.push(`⚠ ${label} 错误率 ${Math.round(debug.stats.errors/totalOps*100)}% (${debug.stats.errors}/${totalOps})`)
    }
  }

  // 检查7: 操作超时
  for (const [label, debug] of [['WeChat', wechatDebug], ['Yunzhijia', yzjDebug], ['Feishu', feishuDebug]]) {
    if (!debug.isRunning) continue
    for (const [op, timing] of Object.entries(debug.timings)) {
      if (timing.maxMs > BROWSER_OP_TIMEOUT * 0.8 && timing.count > 0) {
        issues.push(`⚠ ${label}/${op} 最大耗时 ${timing.maxMs}ms (接近超时 ${BROWSER_OP_TIMEOUT}ms)`)
      }
    }
  }

  // 检查8: fast poll 频繁跳过（_scanning 锁争用）
  for (const [label, debug] of [['WeChat', wechatDebug], ['Yunzhijia', yzjDebug], ['Feishu', feishuDebug]]) {
    if (!debug.isRunning) continue
    if (debug.stats.fastPolls > 0 && debug.stats.fastSkipped / debug.stats.fastPolls > 0.5) {
      issues.push(`⚠ ${label} fast poll ${Math.round(debug.stats.fastSkipped/debug.stats.fastPolls*100)}% 被跳过 (scanning锁争用)`)
    }
  }

  // 检查9: 连续空扫描
  for (const [label, debug] of [['WeChat', wechatDebug], ['Yunzhijia', yzjDebug], ['Feishu', feishuDebug]]) {
    if (debug.consecutiveEmpty > 3) {
      issues.push(`⚠ ${label} 连续 ${debug.consecutiveEmpty} 次全扫描无新消息`)
    }
  }

  res.json({
    timestamp: new Date().toISOString(),
    diagnosis: {
      issueCount: issues.length,
      issues,
      verdict: issues.length === 0 ? '✅ 三个平台均正常运行' :
               issues.some(i => i.startsWith('❌')) ? '🔴 存在严重问题' : '🟡 存在警告'
    },
    wechat: wechatDebug,
    yunzhijia: yzjDebug,
    feishu: feishuDebug
  })
})

// ── 仅获取最近事件（轻量端点，用于快速轮询）────────────────────────────────
app.get('/api/debug/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 20
  const since = req.query.since || null  // ISO timestamp

  let wEvents = monitorService._debugEvents
  let yEvents = yzjMonitorService._debugEvents
  let fEvents = feishuMonitorService._debugEvents

  if (since) {
    wEvents = wEvents.filter(e => e.ts > since)
    yEvents = yEvents.filter(e => e.ts > since)
    fEvents = fEvents.filter(e => e.ts > since)
  }

  // 合并三个平台的事件，按时间排序
  const merged = [
    ...wEvents.slice(-limit).map(e => ({ ...e, platform: 'wechat' })),
    ...yEvents.slice(-limit).map(e => ({ ...e, platform: 'yunzhijia' })),
    ...fEvents.slice(-limit).map(e => ({ ...e, platform: 'feishu' }))
  ].sort((a, b) => a.ts.localeCompare(b.ts)).slice(-limit)

  res.json({ timestamp: new Date().toISOString(), events: merged })
})

// Serve frontend in production
const distPath = path.join(__dirname, 'dist')
app.use(express.static(distPath))
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'))
  }
})

// WebSocket for real-time updates
// Both monitors share the same WS clients for unified frontend updates
const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (ws) => {
  console.log('[WS] Client connected')
  monitorService.addWSClient(ws)
  yzjMonitorService.addWSClient(ws)
  feishuMonitorService.addWSClient(ws)

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
      }
    } catch { /* ignore */ }
  })
})

// Start server
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║      WeConnect 智能消息助手 (多平台)        ║
  ║──────────────────────────────────────────────║
  ║  服务地址: http://localhost:${PORT}             ║
  ║  API地址:  http://localhost:${PORT}/api         ║
  ║  微信API:  /api/wechat                       ║
  ║  云之家API: /api/yunzhijia                    ║
  ║  飞书API:  /api/feishu                       ║
  ║  诊断:     /api/debug/live                   ║
  ║  状态:     运行中 ✓                          ║
  ╚══════════════════════════════════════════════╝
  `)

  // Run startup lifecycle tasks (migrate todos, purge old data)
  runStartupTasks()

  // ── 双平台心跳对比日志（每 60 秒输出一次）─────────────────────────────
  setInterval(() => {
    const w = monitorService.getStatus()
    const y = yzjMonitorService.getStatus()
    const f = feishuMonitorService.getStatus()
    const ts = new Date().toISOString().slice(11, 19)

    // 只在至少一个 monitor 运行时输出
    if (!w.isRunning && !y.isRunning && !f.isRunning) return

    const formatLine = (s) => s.isRunning
      ? `running login=${s.stats.lastLoginCheck} fast=${s.stats.fastPolls}(skip=${s.stats.fastSkipped}) full=${s.stats.fullScans} msgs=${s.stats.messagesProcessed} err=${s.stats.errors} myName=${s.stats.myNameDetected || 'NULL'} empty=${s.consecutiveEmpty} scanning=${s.scanning}`
      : 'STOPPED'

    console.log(`[Heartbeat ${ts}] WX: ${formatLine(w)}`)
    console.log(`[Heartbeat ${ts}] YZJ: ${formatLine(y)}`)
    console.log(`[Heartbeat ${ts}] FS: ${formatLine(f)}`)
  }, 60000)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n正在关闭...')
  monitorService.stop()
  yzjMonitorService.stop()
  feishuMonitorService.stop()
  const browserService = (await import('./server/services/browser.js')).default
  const yzjBrowserService = (await import('./server/services/yunzhijia-browser.js')).default
  const feishuBrowser = (await import('./server/services/feishu-browser.js')).default
  await browserService.close()
  await yzjBrowserService.close()
  await feishuBrowser.close()
  process.exit(0)
})
