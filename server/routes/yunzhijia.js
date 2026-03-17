/**
 * Yunzhijia (云之家) Browser Control Routes
 * Mirrors wechat.js but uses yunzhijia services.
 */
import { Router } from 'express'
import yzjBrowserService from '../services/yunzhijia-browser.js'
import yzjMonitorService from '../services/yunzhijia-monitor.js'
import { settingsDB } from '../db.js'

const router = Router()

// Launch Yunzhijia web
router.post('/launch', async (req, res) => {
  try {
    const result = await yzjBrowserService.launch()
    if (result.success) {
      settingsDB.update('app-config', { lastStartedYzj: new Date().toISOString(), yunzhijiaConnected: true })
    }
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Check login status
router.get('/status', async (req, res) => {
  try {
    const status = await yzjBrowserService.checkLoginStatus()
    res.json({
      connected: yzjBrowserService.isConnected,
      loggedIn: status.loggedIn,
      monitoring: yzjMonitorService.isRunning
    })
  } catch (err) {
    res.json({ connected: false, loggedIn: false, monitoring: false })
  }
})

// Get chat list
router.get('/chats', async (req, res) => {
  try {
    const chats = await yzjBrowserService.getChatList()
    res.json(chats)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get messages from a specific chat
router.get('/messages/:chatName', async (req, res) => {
  try {
    const messages = await yzjBrowserService.getMessages(decodeURIComponent(req.params.chatName))
    res.json(messages)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send a message
router.post('/send', async (req, res) => {
  try {
    const { chatName, text } = req.body
    const result = await yzjBrowserService.sendMessage(chatName, text)
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Start monitoring
router.post('/monitor/start', async (req, res) => {
  try {
    await yzjMonitorService.start()
    res.json({ success: true, message: '云之家监控已启动' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Stop monitoring
router.post('/monitor/stop', async (req, res) => {
  try {
    yzjMonitorService.stop()
    res.json({ success: true, message: '云之家监控已停止' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── Diagnostic endpoint ────────────────────────────────────────────────────
// 访问 http://localhost:3210/api/yunzhijia/debug 查看每一步的状态
router.get('/debug', async (req, res) => {
  const report = {
    timestamp: new Date().toISOString(),
    steps: []
  }

  const step = (name, data) => report.steps.push({ step: name, ...data })

  try {
    // 1. 浏览器状态
    step('browser', {
      hasPage: !!yzjBrowserService.page,
      isConnected: yzjBrowserService.isConnected,
      isLoggedIn: yzjBrowserService.isLoggedIn,
      cachedImFrame: !!yzjBrowserService.imFrame
    })

    if (!yzjBrowserService.page) {
      step('STOP', { reason: '浏览器未启动 (page = null)' })
      return res.json(report)
    }

    // 2. 页面 URL
    const pageUrl = yzjBrowserService.page.url()
    step('pageUrl', { url: pageUrl })

    // 3. 所有 frames
    const frames = yzjBrowserService.page.frames()
    const frameInfo = frames.map(f => ({
      url: f.url().slice(0, 120),
      isMain: f === yzjBrowserService.page.mainFrame()
    }))
    step('frames', { count: frames.length, list: frameInfo })

    // 4. 尝试获取 IM Frame
    yzjBrowserService.imFrame = null  // 清缓存强制重新查找
    const imFrame = await yzjBrowserService._getImFrame()
    step('imFrame', {
      found: !!imFrame,
      url: imFrame ? imFrame.url().slice(0, 120) : null
    })

    if (!imFrame) {
      step('STOP', { reason: 'IM iframe 未找到' })
      return res.json(report)
    }

    // 5. IM frame 内部 DOM 结构探测
    const domProbe = await imFrame.evaluate(() => {
      const probe = {}

      // 会话列表
      probe.sessionItems = document.querySelectorAll('.session-item').length
      probe.imContainer = !!document.querySelector('.im-container')
      probe.imSidebar = !!document.querySelector('.im-sidebar')
      probe.imListWrapper = !!document.querySelector('.im-list-wrapper')

      // 聊天面板
      probe.imChatContainer = !!document.querySelector('.im-chat-container')
      probe.imChatContent = !!document.querySelector('.im-chat-content')
      probe.chatItems = document.querySelectorAll('.chat-item').length

      // 消息元素
      probe.sendBodies = document.querySelectorAll('.send-body').length
      probe.sendContents = document.querySelectorAll('.send-content').length
      probe.msgElements = document.querySelectorAll('.msg').length
      probe.sendUsers = document.querySelectorAll('.send-user').length

      // 输入框
      probe.contentArea = !!document.querySelector('pre.content-area[contenteditable]')

      // 前3个session的名称
      const firstSessions = []
      document.querySelectorAll('.session-item').forEach((item, i) => {
        if (i >= 3) return
        const nameEl = item.querySelector('.name-list') ||
                       item.querySelector('.session-item-name span') ||
                       item.querySelector('.session-item-name')
        firstSessions.push(nameEl?.textContent?.trim() || '(空)')
      })
      probe.firstSessions = firstSessions

      // 第一个 chat-item 的内部结构
      const firstChat = document.querySelector('.chat-item')
      if (firstChat) {
        probe.firstChatHTML = firstChat.innerHTML.substring(0, 500)
      }

      // 如果没有 chat-item，探测 im-chat-content 下所有子元素
      const chatContent = document.querySelector('.im-chat-content')
      if (chatContent) {
        const children = chatContent.children
        probe.chatContentChildren = Array.from(children).slice(0, 5).map(el => ({
          tag: el.tagName.toLowerCase(),
          class: el.className?.substring?.(0, 80) || '',
          childCount: el.children.length
        }))
      }

      return probe
    })
    step('domProbe', domProbe)

    // 6. 数据源匹配
    const { sourcesDB } = await import('../db.js')
    const yzjSources = sourcesDB.findAll({ platform: 'yunzhijia' })
    step('sources', {
      count: yzjSources.length,
      list: yzjSources.map(s => ({ name: s.name, enabled: s.enabled }))
    })

    // 7. Monitor 状态 + 快照诊断 + 完整运行时数据
    step('monitor', yzjMonitorService.getStatus())

    // 8. 尝试读取消息（所有 source）
    const messagesResults = []
    for (const src of yzjSources) {
      try {
        const msgs = await yzjBrowserService.getMessages(src.name)
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
        messagesResults.push({
          sourceName: src.name,
          error: err.message
        })
      }
    }
    if (messagesResults.length > 0) {
      step('getMessages', messagesResults)
    }

    // 9. 检测 myName
    try {
      const myName = await yzjBrowserService.getMyName()
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
    yzjMonitorService.stop()
    await yzjBrowserService.close()
    settingsDB.update('app-config', { yunzhijiaConnected: false })
    res.json({ success: true, message: '云之家浏览器已关闭' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
