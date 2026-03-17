/**
 * Feishu (飞书) Browser Control Routes
 * Mirrors yunzhijia.js but uses feishu services.
 */
import { Router } from 'express'
import feishuBrowserService from '../services/feishu-browser.js'
import feishuMonitorService from '../services/feishu-monitor.js'
import { settingsDB } from '../db.js'

const router = Router()

// Launch Feishu web
router.post('/launch', async (req, res) => {
  try {
    const result = await feishuBrowserService.launch()
    if (result.success) {
      settingsDB.update('app-config', { lastStartedFeishu: new Date().toISOString(), feishuConnected: true })
    }
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Check login status
router.get('/status', async (req, res) => {
  try {
    const status = await feishuBrowserService.checkLoginStatus()
    res.json({
      connected: feishuBrowserService.isConnected,
      loggedIn: status.loggedIn,
      monitoring: feishuMonitorService.isRunning
    })
  } catch (err) {
    res.json({ connected: false, loggedIn: false, monitoring: false })
  }
})

// Get chat list
router.get('/chats', async (req, res) => {
  try {
    const chats = await feishuBrowserService.getChatList()
    res.json(chats)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get messages from a specific chat
router.get('/messages/:chatName', async (req, res) => {
  try {
    const messages = await feishuBrowserService.getMessages(decodeURIComponent(req.params.chatName))
    res.json(messages)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send a message
router.post('/send', async (req, res) => {
  try {
    const { chatName, text } = req.body
    const result = await feishuBrowserService.sendMessage(chatName, text)
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Start monitoring
router.post('/monitor/start', async (req, res) => {
  try {
    await feishuMonitorService.start()
    res.json({ success: true, message: '飞书监控已启动' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Stop monitoring
router.post('/monitor/stop', async (req, res) => {
  try {
    feishuMonitorService.stop()
    res.json({ success: true, message: '飞书监控已停止' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── Diagnostic endpoint ────────────────────────────────────────────────────
// 访问 http://localhost:3210/api/feishu/debug 查看每一步的状态
router.get('/debug', async (req, res) => {
  const report = {
    timestamp: new Date().toISOString(),
    steps: []
  }

  const step = (name, data) => report.steps.push({ step: name, ...data })

  try {
    // 1. 浏览器状态
    step('browser', {
      hasPage: !!feishuBrowserService.page,
      isConnected: feishuBrowserService.isConnected,
      isLoggedIn: feishuBrowserService.isLoggedIn
    })

    if (!feishuBrowserService.page) {
      step('STOP', { reason: '浏览器未启动 (page = null)' })
      return res.json(report)
    }

    // 2. 页面 URL
    const pageUrl = feishuBrowserService.page.url()
    step('pageUrl', { url: pageUrl })

    // 3. DOM 结构探测（飞书无 iframe，直接在 page 上操作）
    const domProbe = await feishuBrowserService.page.evaluate(() => {
      const probe = {}

      // 会话列表
      probe.listItems = !!document.querySelector('.list_items')
      probe.feedItems = document.querySelectorAll('[data-feed-id]').length

      // 消息区域
      probe.messageItems = document.querySelectorAll('.js-message-item.message-item').length
      probe.systemMessages = document.querySelectorAll('.system-text-background').length

      // 输入框
      probe.editorContainer = !!document.querySelector('.chatEditorContainer')
      probe.contentEditable = !!document.querySelector('div[contenteditable="true"].zone-container')

      // 发送按钮
      probe.sendButton = !!document.querySelector('.send__button')
      probe.sendButtonDisabled = !!document.querySelector('.send__button--disable')

      // 前3个会话的名称
      const firstFeeds = []
      document.querySelectorAll('[data-feed-id]').forEach((item, i) => {
        if (i >= 3) return
        const mainEl = item.querySelector('.a11y_feed_card_main')
        if (mainEl) {
          const children = mainEl.children
          for (const child of children) {
            if (child.classList.contains('ud__tag')) continue
            const text = child.textContent?.trim()
            if (text && text.length > 0 && text.length < 100) {
              firstFeeds.push(text)
              break
            }
          }
        }
      })
      probe.firstFeeds = firstFeeds

      // 登录状态
      probe.isLoginPage = location.hostname.includes('accounts.feishu.cn')

      return probe
    })
    step('domProbe', domProbe)

    // 4. 数据源匹配
    const { sourcesDB } = await import('../db.js')
    const feishuSources = sourcesDB.findAll({ platform: 'feishu' })
    step('sources', {
      count: feishuSources.length,
      list: feishuSources.map(s => ({ name: s.name, enabled: s.enabled }))
    })

    // 5. Monitor 状态
    step('monitor', feishuMonitorService.getStatus())

    // 6. 尝试读取消息（所有 source）
    const messagesResults = []
    for (const src of feishuSources) {
      try {
        const msgs = await feishuBrowserService.getMessages(src.name)
        messagesResults.push({
          sourceName: src.name,
          totalMessages: msgs.length,
          otherMessages: msgs.filter(m => m.type !== 'me').length,
          meMessages: msgs.filter(m => m.type === 'me').length,
          sampleOther: msgs.filter(m => m.type !== 'me').slice(-5).map(m => ({
            sender: m.sender,
            senderName: m.senderName,
            content: (m.content || '').substring(0, 80),
            type: m.type,
            msgId: m.msgId
          }))
        })
      } catch (err) {
        messagesResults.push({
          sourceName: src.name,
          error: err.message
        })
      }
    }
    if (messagesResults.length > 0) {
      step('getMessages', messagesResults)
    }

    // 7. 检测 myName
    try {
      const myName = await feishuBrowserService.getMyName()
      step('myName', { detected: myName })
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
    feishuMonitorService.stop()
    await feishuBrowserService.close()
    settingsDB.update('app-config', { feishuConnected: false })
    res.json({ success: true, message: '飞书浏览器已关闭' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
