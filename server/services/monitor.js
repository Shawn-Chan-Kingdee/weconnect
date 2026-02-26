/**
 * Message Monitor Service (Enhanced)
 * - AI-powered classification (with keyword fallback)
 * - Category-specific reply strategies via AI
 * - Structured todo generation from AI output
 * - Recent message context for better replies
 */
import { v4 as uuidv4 } from 'uuid'
import browserService from './browser.js'
import aiService from './ai.js'
import { sourcesDB, messagesDB, todosDB } from '../db.js'

class MonitorService {
  constructor() {
    this.isRunning = false
    this.pollInterval = null
    this.wsClients = new Set()
    this.pollIntervalMs = 5000
  }

  addWSClient(ws) {
    this.wsClients.add(ws)
    ws.on('close', () => this.wsClients.delete(ws))
  }

  broadcast(type, data) {
    const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() })
    this.wsClients.forEach(ws => {
      try { ws.send(msg) } catch { /* ignore */ }
    })
  }

  async start() {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[Monitor] Started monitoring...')
    this.pollInterval = setInterval(() => this._poll(), this.pollIntervalMs)
  }

  stop() {
    this.isRunning = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    console.log('[Monitor] Stopped monitoring.')
  }

  async _poll() {
    if (!this.isRunning) return

    try {
      const loginStatus = await browserService.checkLoginStatus()
      if (!loginStatus.loggedIn) return

      const sources = sourcesDB.findAll()
      if (sources.length === 0) return

      const sourceNames = sources.map(s => s.name)
      const chatsWithNew = await browserService.checkNewMessages(sourceNames)

      for (const chat of chatsWithNew) {
        await this._processNewMessages(chat, sources.find(s => s.name === chat.name))
      }
    } catch (err) {
      console.error('[Monitor] Poll error:', err)
    }
  }

  async _processNewMessages(chat, source) {
    if (!source) return

    try {
      // Open the chat and read messages
      const messages = await browserService.getMessages(chat.name)
      if (!messages || messages.length === 0) return

      // Get the latest unread messages from others
      const newMessages = messages.filter(m => m.type === 'other').slice(-chat.unread)

      for (const msg of newMessages) {
        // Check if already processed
        const existing = messagesDB.findOne({
          sourceName: chat.name,
          senderContent: msg.content?.substring(0, 50),
          processed: true
        })
        if (existing) continue

        // Step 1: AI Classification (with keyword fallback)
        const category = await aiService.classifyMessage(msg.content, source.skill)

        // Step 2: Get recent messages for context
        const recentMessages = messages.slice(-10) // last 10 messages for context

        // Step 3: Generate reply with category-specific strategy
        const aiResult = await this._generateReply(msg, source, category, recentMessages)

        // Step 4: Build and save the record
        const today = new Date().toISOString().split('T')[0]
        const record = {
          id: uuidv4(),
          sourceName: chat.name,
          sender: msg.sender,
          senderTime: msg.time || new Date().toISOString(),
          senderContent: msg.content?.substring(0, 100),
          senderContentFull: msg.content,
          replyTime: null,
          replyContent: aiResult?.text?.substring(0, 100) || '',
          replyContentFull: aiResult?.text || '',
          category: category,
          hasTodo: false,
          processed: true,
          date: today
        }

        // Step 5: Send reply if configured
        if (aiResult && aiResult.text && source.skill?.autoReply) {
          // Check replyTo filter
          const replyTo = source.skill.replyTo
          const shouldReply = !replyTo || replyTo.length === 0 ||
            replyTo.includes(msg.sender) || replyTo.includes('*')

          if (shouldReply) {
            const sendResult = await browserService.sendMessage(chat.name, aiResult.text)
            if (sendResult.success) {
              record.replyTime = new Date().toISOString()
            }
          }
        }

        // Step 6: Create todo if AI or strategy indicates it
        const todoSummary = aiResult?.todoSummary
        if (todoSummary) {
          record.hasTodo = true
          todosDB.insert({
            id: uuidv4(),
            sourceName: chat.name,
            messageId: record.id,
            content: todoSummary,
            category: category,
            completed: false,
            isHistorical: false,
            date: today,
            completedAt: null
          })
        }

        messagesDB.insert(record)

        // Broadcast to frontend via WebSocket
        this.broadcast('new_message', record)
        if (record.hasTodo) {
          this.broadcast('new_todo', { sourceName: chat.name, content: todoSummary })
        }
      }
    } catch (err) {
      console.error('[Monitor] Process error:', err)
    }
  }

  /**
   * Generate reply using 3-tier priority: AI → MCP → Template
   */
  async _generateReply(msg, source, category, recentMessages) {
    const skill = source.skill
    if (!skill || !skill.autoReply) {
      return null
    }

    let result = { text: '', todoSummary: null }

    // Priority 1: AI model with category-specific strategy
    try {
      const aiResult = await aiService.generateReply({
        message: msg.content,
        sender: msg.sender,
        sourceName: source.name,
        category,
        skill,
        recentMessages
      })
      if (aiResult && aiResult.text) {
        result = aiResult
        console.log(`[Monitor] AI reply for ${source.name} [${category}]: ${result.text.substring(0, 60)}...`)
      }
    } catch (err) {
      console.error('[Monitor] AI generation error:', err)
    }

    // Priority 2: MCP external service
    if (!result.text && skill.mcpService) {
      try {
        const mcpReply = await this._callMCPService(skill.mcpService, msg, category)
        if (mcpReply) result.text = mcpReply
      } catch (err) {
        console.error('[Monitor] MCP call error:', err)
      }
    }

    // Priority 3: Template fallback
    if (!result.text) {
      const templates = skill.replyTemplates || {}
      switch (category) {
        case '业务咨询':
          result.text = templates.business || '收到您的咨询，我会尽快处理并回复您。'
          break
        case '事项跟进':
          result.text = templates.followup || '好的，我确认一下最新进度后回复您。'
          result.todoSummary = result.todoSummary || `[${msg.sender}] ${msg.content.substring(0, 50)} - 跟进`
          break
        case '新事项登记':
          result.text = templates.newItem || '已记录，我会尽快安排处理。'
          result.todoSummary = result.todoSummary || `[${msg.sender}] ${msg.content.substring(0, 50)} - 新事项`
          break
        default:
          result.text = templates.daily || '收到，谢谢！'
          break
      }
    }

    // Apply terminology substitutions
    if (skill.terminology && result.text) {
      for (const [key, val] of Object.entries(skill.terminology)) {
        result.text = result.text.replace(new RegExp(key, 'g'), val)
      }
    }

    return result
  }

  async _callMCPService(mcpConfig, msg, category) {
    try {
      const url = mcpConfig.url
      if (!url) return ''

      const body = {
        message: msg.content,
        sender: msg.sender,
        category: category,
        ...(mcpConfig.extraParams || {})
      }

      const response = await fetch(url, {
        method: mcpConfig.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(mcpConfig.headers || {})
        },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        const data = await response.json()
        return data.reply || data.text || data.message || ''
      }
    } catch (err) {
      console.error('[MCP] Service call failed:', err)
    }
    return ''
  }
}

const monitorService = new MonitorService()
export default monitorService
