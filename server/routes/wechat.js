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
