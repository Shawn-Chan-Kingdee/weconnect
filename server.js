/**
 * WeConnect Server
 * Express backend with WebSocket support for real-time updates
 * Supports dual-platform monitoring: WeChat + Yunzhijia (云之家)
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
app.use('/api/settings', settingsRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/todos', todosRoutes)
app.use('/api/models', modelsRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
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
  ║  状态:     运行中 ✓                          ║
  ╚══════════════════════════════════════════════╝
  `)

  // Run startup lifecycle tasks (migrate todos, purge old data)
  runStartupTasks()
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n正在关闭...')
  monitorService.stop()
  yzjMonitorService.stop()
  const browserService = (await import('./server/services/browser.js')).default
  const yzjBrowserService = (await import('./server/services/yunzhijia-browser.js')).default
  await browserService.close()
  await yzjBrowserService.close()
  process.exit(0)
})
