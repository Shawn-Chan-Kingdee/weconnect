/**
 * Message Monitor Service (Simplified)
 * - No category classification — AI uses skill.prompt directly
 * - Fixed deduplication key consistency
 * - Records messages even when autoReply is off (monitoring-only mode)
 * - Detailed logging for diagnosis
 */
import { v4 as uuidv4 } from 'uuid'
import browserService from './browser.js'
import aiService from './ai.js'
import { sourcesDB, messagesDB, todosDB } from '../db.js'

const DEDUP_LEN = 80 // chars used for dedup key — must be consistent

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
      if (!loginStatus.loggedIn) {
        console.log('[Monitor] Not logged in, skipping poll')
        return
      }

      const sources = sourcesDB.findAll().filter(s => s.enabled !== false)
      if (sources.length === 0) {
        console.log('[Monitor] No sources configured')
        return
      }

      const sourceNames = sources.map(s => s.name)
      const chatsWithNew = await browserService.checkNewMessages(sourceNames)

      if (chatsWithNew.length === 0) return

      for (const chat of chatsWithNew) {
        // Fuzzy match: allow partial name match
        const source = sources.find(s =>
          s.name === chat.name ||
          chat.name.includes(s.name) ||
          s.name.includes(chat.name)
        )
        if (source) {
          await this._processNewMessages(chat, source)
        }
      }
    } catch (err) {
      console.error('[Monitor] Poll error:', err)
    }
  }

  async _processNewMessages(chat, source) {
    try {
      console.log(`[Monitor] Processing "${chat.name}" (unread: ${chat.unread})`)

      const messages = await browserService.getMessages(chat.name)
      if (!messages || messages.length === 0) {
        console.log(`[Monitor] No messages loaded for "${chat.name}"`)
        return
      }

      // Get new messages from others (last N based on unread count)
      const otherMessages = messages.filter(m => m.type === 'other')
      const newMessages = otherMessages.slice(-Math.max(chat.unread, 1))
      console.log(`[Monitor] ${otherMessages.length} msgs from others, processing last ${newMessages.length}`)

      for (const msg of newMessages) {
        if (!msg.content) continue

        // ── Deduplication (consistent key length) ──────────────────────
        const dedupKey = msg.content.substring(0, DEDUP_LEN)
        const existing = messagesDB.findOne({ sourceName: source.name, dedupKey, processed: true })
        if (existing) {
          console.log(`[Monitor] Duplicate skipped: "${dedupKey.substring(0, 30)}"`)
          continue
        }

        console.log(`[Monitor] New msg from ${msg.sender}: "${msg.content.substring(0, 60)}"`)

        const today = new Date().toISOString().split('T')[0]
        let aiResult = { text: '', todoSummary: null }

        // ── Generate AI reply (only if autoReply enabled) ───────────────
        if (source.skill?.autoReply) {
          const rawReplyTo = source.skill.replyTo || ['*']
          // Flatten: support both ["a","b"] and ["a；b；c"] (semicolon-separated from frontend)
          const replyTo = rawReplyTo.flatMap(r =>
            r.includes('；') || r.includes(';')
              ? r.split(/[；;]/).map(s => s.trim()).filter(Boolean)
              : [r]
          )
          const shouldReply = replyTo.includes('*') || replyTo.includes(msg.sender)

          if (shouldReply) {
            aiResult = await aiService.generateReply({
              message: msg.content,
              sender: msg.sender,
              sourceName: source.name,
              skill: source.skill,
              recentMessages: messages.slice(-10)
            })
            console.log(`[Monitor] AI reply: "${aiResult.text?.substring(0, 60)}"`)
          } else {
            console.log(`[Monitor] Sender "${msg.sender}" not in replyTo list, skipping reply`)
          }
        } else {
          console.log(`[Monitor] autoReply=false for "${source.name}", recording only`)
        }

        // ── Build and save record ───────────────────────────────────────
        const record = {
          id: uuidv4(),
          sourceName: source.name,
          sender: msg.sender,
          senderTime: msg.time || new Date().toISOString(),
          senderContent: msg.content.substring(0, DEDUP_LEN),
          senderContentFull: msg.content,
          dedupKey,
          replyContent: aiResult.text?.substring(0, 100) || '',
          replyContentFull: aiResult.text || '',
          replyTime: null,
          category: aiResult.todoSummary ? '待办事项' : '消息记录',
          hasTodo: false,
          processed: true,
          date: today
        }

        // ── Send reply ──────────────────────────────────────────────────
        if (aiResult.text && source.skill?.autoReply) {
          const sendResult = await browserService.sendMessage(source.name, aiResult.text)
          if (sendResult.success) {
            record.replyTime = new Date().toISOString()
            console.log(`[Monitor] Reply sent to "${source.name}"`)
          } else {
            console.warn(`[Monitor] Send failed: ${sendResult.message}`)
          }
        }

        // ── Create todo if AI returned a summary ────────────────────────
        if (aiResult.todoSummary) {
          record.hasTodo = true
          const todoId = uuidv4()
          todosDB.insert({
            id: todoId,
            sourceName: source.name,
            messageId: record.id,
            content: aiResult.todoSummary,
            category: '待办事项',
            completed: false,
            isHistorical: false,
            date: today,
            completedAt: null
          })
          console.log(`[Monitor] Todo created: "${aiResult.todoSummary}"`)

          // ── Call internal todo webhook (if configured) ──────────────
          const webhookUrl = source.skill?.todoWebhook?.url
          if (webhookUrl) {
            this._callTodoWebhook(webhookUrl, source.skill.todoWebhook, {
              todoId,
              messageId: record.id,
              sourceName: source.name,
              sender: msg.sender,
              senderTime: record.senderTime,
              originalMessage: msg.content,
              summary: aiResult.todoSummary,
              reply: aiResult.text || '',
              date: today,
              timestamp: new Date().toISOString()
            }).catch(err => console.error('[Webhook] Todo webhook failed:', err.message))
          }
        }

        messagesDB.insert(record)

        // ── WebSocket broadcast ─────────────────────────────────────────
        this.broadcast('new_message', record)
        if (record.hasTodo) {
          this.broadcast('new_todo', { sourceName: source.name, content: aiResult.todoSummary })
        }
      }
    } catch (err) {
      console.error('[Monitor] _processNewMessages error:', err)
    }
  }

  /**
   * Call the configured internal todo webhook
   * @param {string} url - target endpoint
   * @param {Object} webhookConfig - { url, method, headers, bodyTemplate }
   * @param {Object} payload - todo data to send
   */
  async _callTodoWebhook(url, webhookConfig, payload) {
    const method = webhookConfig.method || 'POST'

    // Support custom body template (replace {{key}} placeholders)
    let body
    if (webhookConfig.bodyTemplate) {
      let tpl = webhookConfig.bodyTemplate
      Object.entries(payload).forEach(([k, v]) => {
        tpl = tpl.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? ''))
      })
      try { body = JSON.parse(tpl) } catch { body = tpl }
    } else {
      body = payload // default: send full payload
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(webhookConfig.headers || {})
    }

    console.log(`[Webhook] POST ${url} — "${payload.summary}"`)
    const res = await fetch(url, {
      method,
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`HTTP ${res.status}: ${errText.substring(0, 100)}`)
    }

    const result = await res.text()
    console.log(`[Webhook] Response: ${result.substring(0, 80)}`)
    return result
  }
}

const monitorService = new MonitorService()
export default monitorService
