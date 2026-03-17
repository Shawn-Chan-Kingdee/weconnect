/**
 * WeChat Browser Control Routes
 */
import { Router } from 'express'
import browserService from '../services/browser.js'
import monitorService from '../services/monitor.js'
import { settingsDB } from '../db.js'

const router = Router()

// Launch WeChat web
router.post('/launch', async (req, res) => {
  try {
    const result = await browserService.launch()
    if (result.success) {
      settingsDB.update('app-config', { lastStarted: new Date().toISOString(), wechatConnected: true })
    }
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Check login status
router.get('/status', async (req, res) => {
  try {
    const status = await browserService.checkLoginStatus()
    res.json({
      connected: browserService.isConnected,
      loggedIn: status.loggedIn,
      monitoring: monitorService.isRunning
    })
  } catch (err) {
    res.json({ connected: false, loggedIn: false, monitoring: false })
  }
})

// Get chat list
router.get('/chats', async (req, res) => {
  try {
    const chats = await browserService.getChatList()
    res.json(chats)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get messages from a specific chat
router.get('/messages/:chatName', async (req, res) => {
  try {
    const messages = await browserService.getMessages(decodeURIComponent(req.params.chatName))
    res.json(messages)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send a message
router.post('/send', async (req, res) => {
  try {
    const { chatName, text } = req.body
    const result = await browserService.sendMessage(chatName, text)
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Start monitoring
router.post('/monitor/start', async (req, res) => {
  try {
    await monitorService.start()
    res.json({ success: true, message: '监控已启动' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Stop monitoring
router.post('/monitor/stop', async (req, res) => {
  try {
    monitorService.stop()
    res.json({ success: true, message: '监控已停止' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── Diagnostic endpoint ────────────────────────────────────────────────────
// 访问 http://localhost:3210/api/wechat/debug 查看每一步的状态
router.get('/debug', async (req, res) => {
  const report = {
    timestamp: new Date().toISOString(),
    steps: []
  }

  const step = (name, data) => report.steps.push({ step: name, ...data })

  try {
    // 1. 浏览器状态
    step('browser', {
      hasPage: !!browserService.page,
      isConnected: browserService.isConnected,
      isLoggedIn: browserService.isLoggedIn,
      cachedMyName: browserService._myName
    })

    if (!browserService.page) {
      step('STOP', { reason: '浏览器未启动 (page = null)' })
      return res.json(report)
    }

    // 2. 页面 URL
    const pageUrl = browserService.page.url()
    step('pageUrl', { url: pageUrl })

    // 3. 登录检测
    const loginStatus = await browserService.checkLoginStatus()
    step('loginStatus', loginStatus)

    if (!loginStatus.loggedIn) {
      step('STOP', { reason: '未登录' })
      return res.json(report)
    }

    // 4. 数据源匹配
    const { sourcesDB } = await import('../db.js')
    const wxSources = sourcesDB.findAll().filter(s => s.enabled !== false && (s.platform || 'wechat') === 'wechat')
    step('sources', {
      count: wxSources.length,
      list: wxSources.map(s => ({ id: s.id, name: s.name, enabled: s.enabled }))
    })

    // 5. Monitor 状态 + 诊断数据
    step('monitor', monitorService.getStatus())

    // 6. Chat 列表
    const chatList = await browserService.getChatList()
    step('chatList', {
      total: chatList.length,
      withUnread: chatList.filter(c => c.unread > 0).length,
      sample: chatList.slice(0, 8).map(c => ({ name: c.name, unread: c.unread }))
    })

    // 7. 尝试读取消息（所有 source）
    const messagesResults = []
    for (const src of wxSources) {
      try {
        const msgs = await browserService.getMessages(src.name)
        messagesResults.push({
          sourceName: src.name,
          totalMessages: msgs.length,
          otherMessages: msgs.filter(m => m.type !== 'me').length,
          meMessages: msgs.filter(m => m.type === 'me').length,
          sampleOther: msgs.filter(m => m.type !== 'me').slice(-5).map(m => ({
            sender: m.sender,
            senderName: m.senderName,
            content: (m.content || '').substring(0, 80),
            type: m.type
          }))
        })
      } catch (err) {
        messagesResults.push({ sourceName: src.name, error: err.message })
      }
    }
    if (messagesResults.length > 0) {
      step('getMessages', messagesResults)
    }

    // 8. 检测 myName
    try {
      // 清缓存强制重新检测
      const origName = browserService._myName
      browserService._myName = null
      const myName = await browserService.getMyName()
      step('myName', { detected: myName, wasCached: origName })
    } catch (err) {
      step('myName_ERROR', { error: err.message })
    }

  } catch (err) {
    step('ERROR', { message: err.message, stack: err.stack?.split('\n').slice(0, 3) })
  }

  res.json(report)
})

// Close browser
router.post('/close', async (req, res) => {
  try {
    monitorService.stop()
    await browserService.close()
    settingsDB.update('app-config', { wechatConnected: false })
    res.json({ success: true, message: '浏览器已关闭' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
