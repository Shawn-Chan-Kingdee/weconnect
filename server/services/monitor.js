/**
 * Message Monitor Service
 * - Dual-track polling: fast (random 2.03–10.87 s) + full-scan (random 36.36–100.69 s)
 * - Active only on Beijing-time weekdays (Mon–Fri) 09:00–20:00
 * - Full-scan reads (unread + 20) messages, capped at actual available count
 * - Dedup by first DEDUP_LEN chars, consistent across store and lookup
 */
import { v4 as uuidv4 } from 'uuid'
import browserService from './browser.js'
import aiService from './ai.js'
import { sourcesDB, messagesDB, todosDB } from '../db.js'

const DEDUP_LEN = 80 // chars used for dedup key — must be consistent

// ── Polling timing constants (ms) ───────────────────────────────────────────
const FAST_MIN_MS  =  2030   // 2.03 s
const FAST_MAX_MS  = 10870   // 10.87 s
const FULL_MIN_MS  = 36360   // 36.36 s
const FULL_MAX_MS  = 100690  // 100.69 s
const FULL_EXTRA_MSGS = 20   // extra messages beyond unread count for full scan

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Returns true if the current moment falls within the active monitoring window:
 * Beijing time (UTC+8), Monday–Friday, 09:00–20:00.
 */
function isWithinWorkingHours() {
  const nowBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000) // UTC → CST
  const dayOfWeek  = nowBeijing.getUTCDay()   // 0=Sun, 1=Mon … 6=Sat
  const hour       = nowBeijing.getUTCHours() // 0–23 in Beijing time

  const isWeekday  = dayOfWeek >= 1 && dayOfWeek <= 5
  const isWorkHour = hour >= 9 && hour < 20

  return isWeekday && isWorkHour
}

class MonitorService {
  constructor() {
    this.isRunning    = false
    this.fastTimer    = null   // fast-poll setTimeout handle
    this.fullTimer    = null   // full-scan setTimeout handle
    this.wsClients    = new Set()
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

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start() {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[Monitor] Started — fast poll every ~2–11 s, full scan every ~36–101 s')
    console.log('[Monitor] Active window: Mon–Fri 09:00–20:00 Beijing time')
    this._scheduleFast()
    this._scheduleFull()
  }

  stop() {
    this.isRunning = false
    if (this.fastTimer) { clearTimeout(this.fastTimer); this.fastTimer = null }
    if (this.fullTimer) { clearTimeout(this.fullTimer); this.fullTimer = null }
    console.log('[Monitor] Stopped.')
  }

  // ── Scheduling helpers ─────────────────────────────────────────────────────

  _scheduleFast() {
    if (!this.isRunning) return
    const delay = randBetween(FAST_MIN_MS, FAST_MAX_MS)
    this.fastTimer = setTimeout(async () => {
      await this._fastPoll()
      this._scheduleFast()  // re-schedule with a new random delay
    }, delay)
  }

  _scheduleFull() {
    if (!this.isRunning) return
    const delay = randBetween(FULL_MIN_MS, FULL_MAX_MS)
    this.fullTimer = setTimeout(async () => {
      await this._fullScan()
      this._scheduleFull()  // re-schedule with a new random delay
    }, delay)
  }

  // ── Working-hours gate ─────────────────────────────────────────────────────

  _checkWorkingHours(label) {
    if (!isWithinWorkingHours()) {
      const nowBJ = new Date(Date.now() + 8 * 60 * 60 * 1000)
      const timeStr = nowBJ.toISOString().slice(11, 19)
      const days = ['日', '一', '二', '三', '四', '五', '六']
      const day = days[nowBJ.getUTCDay()]
      console.log(`[Monitor] ${label} skipped — outside working hours (周${day} ${timeStr} BJ)`)
      return false
    }
    return true
  }

  // ── Fast poll: detect unread badges only ──────────────────────────────────

  async _fastPoll() {
    if (!this.isRunning) return
    if (!this._checkWorkingHours('Fast poll')) return

    try {
      const loginStatus = await browserService.checkLoginStatus()
      if (!loginStatus.loggedIn) return

      const sources = sourcesDB.findAll().filter(s => s.enabled !== false)
      if (sources.length === 0) return

      const sourceNames     = sources.map(s => s.name)
      const chatsWithUnread = await browserService.checkNewMessages(sourceNames)
      if (chatsWithUnread.length === 0) return

      let didOpenChat = false
      for (const chat of chatsWithUnread) {
        const source = sources.find(s =>
          s.name === chat.name || chat.name.includes(s.name) || s.name.includes(chat.name)
        )
        if (source) {
          const found = await this._scanSource(source, chat.unread, 'fast')
          if (found > 0) didOpenChat = true
        }
      }

      if (didOpenChat) await browserService.navigateAway()
    } catch (err) {
      console.error('[Monitor] Fast poll error:', err)
    }
  }

  // ── Full scan: check ALL sources regardless of unread badge ───────────────

  async _fullScan() {
    if (!this.isRunning) return
    if (!this._checkWorkingHours('Full scan')) return

    try {
      const loginStatus = await browserService.checkLoginStatus()
      if (!loginStatus.loggedIn) return

      const sources = sourcesDB.findAll().filter(s => s.enabled !== false)
      if (sources.length === 0) return

      // Get current unread counts to determine scan depth
      const sourceNames     = sources.map(s => s.name)
      const chatsWithUnread = await browserService.checkNewMessages(sourceNames)

      console.log(`[Monitor] Full scan: ${sources.length} source(s)`)

      let didOpenChat = false
      for (const source of sources) {
        const unreadEntry = chatsWithUnread.find(c =>
          c.name === source.name || c.name.includes(source.name) || source.name.includes(c.name)
        )
        const unreadCount = unreadEntry?.unread || 0
        const found = await this._scanSource(source, unreadCount, 'full')
        if (found > 0) didOpenChat = true
      }

      if (didOpenChat) await browserService.navigateAway()
    } catch (err) {
      console.error('[Monitor] Full scan error:', err)
    }
  }

  /**
   * Scan a single source for new messages.
   * - fast mode: reads (unread + FULL_EXTRA_MSGS) messages
   * - full mode: reads (unread + FULL_EXTRA_MSGS) messages (same formula, deeper context)
   * Returns number of new messages processed.
   */
  async _scanSource(source, unreadCount = 0, mode = 'fast') {
    try {
      const messages = await browserService.getMessages(source.name)
      if (!messages || messages.length === 0) return 0

      const otherMessages = messages.filter(m => m.type === 'other')

      // Scan depth: unread count + extra buffer, capped at actual available messages
      const scanCount    = unreadCount + FULL_EXTRA_MSGS
      const recentMessages = otherMessages.slice(-Math.min(scanCount, otherMessages.length))

      let newCount = 0

      for (const msg of recentMessages) {
        if (!msg.content) continue

        // ── Deduplication (consistent key length) ──────────────────────
        const dedupKey = msg.content.substring(0, DEDUP_LEN)
        const existing = messagesDB.findOne({ sourceName: source.name, dedupKey, processed: true })
        if (existing) continue  // already processed, skip silently

        newCount++
        console.log(`[Monitor] New msg from ${msg.sender}: "${msg.content.substring(0, 60)}"`)

        const today = new Date().toISOString().split('T')[0]
        let aiResult = { text: '', todoSummary: null }
        let shouldReply = false

        // ── Collect sender context (36h history + current todos) ────────
        const senderHistory = this._getSenderHistory(source.name, msg.sender)
        const senderTodos   = this._getSenderTodos(source.name, msg.sender)
        if (senderHistory.length > 0) {
          console.log(`[Monitor] Sender history: ${senderHistory.length} msg(s) from "${msg.sender}" in 36h`)
        }

        // ── Generate AI reply (only if autoReply enabled) ───────────────
        if (source.skill?.autoReply) {
          const rawReplyTo = source.skill.replyTo || ['*']
          // Flatten: support both ["a","b"] and ["a；b；c"] (semicolon-separated from frontend)
          const replyTo = rawReplyTo.flatMap(r =>
            r.includes('；') || r.includes(';')
              ? r.split(/[；;]/).map(s => s.trim()).filter(Boolean)
              : [r]
          )
          shouldReply = replyTo.includes('*') || replyTo.includes(msg.sender)

          if (shouldReply) {
            aiResult = await aiService.generateReply({
              message: msg.content,
              sender: msg.sender,
              sourceName: source.name,
              skill: source.skill,
              recentMessages: messages.slice(-10),
              senderHistory,   // 36h sender history (≤20 items)
              senderTodos      // sender's current + unfinished todos
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

        // ── Merge and upsert sender's consolidated todo ─────────────────
        // Triggers when: autoReply is on AND sender is in replyTo list
        // AND there's something to merge (new summary or existing todos)
        if (shouldReply && (aiResult.todoSummary || senderTodos.length > 0)) {
          record.hasTodo = true
          this._mergeSenderTodos({
            source,
            sender: msg.sender,
            senderHistory,
            aiReply: aiResult.text,
            senderTodos,
            newTodoSummary: aiResult.todoSummary,
            triggerMessageId: record.id,
            today
          }).catch(err => console.error('[Monitor] _mergeSenderTodos error:', err.message))
        }

        messagesDB.insert(record)

        // ── WebSocket broadcast ─────────────────────────────────────────
        this.broadcast('new_message', record)
        // note: new_todo broadcast is handled inside _mergeSenderTodos()
      }

      if (newCount > 0) {
        console.log(`[Monitor] Processed ${newCount} new message(s) from "${source.name}"`)
      }
      return newCount
    } catch (err) {
      console.error('[Monitor] _scanSource error:', err)
      return 0
    }
  }

  // ── Sender-context helpers ──────────────────────────────────────────────────

  /**
   * Get up to 20 messages from a specific sender in a source, within the last 36 hours.
   * Uses createdAt (reliable) as the primary timestamp.
   */
  _getSenderHistory(sourceName, sender) {
    const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
    const all = messagesDB.findAll({ sourceName, sender })
    const recent = all
      .filter(m => {
        const t = m.createdAt || m.senderTime || ''
        return t >= cutoff
      })
      .sort((a, b) => {
        const ta = a.createdAt || a.senderTime || ''
        const tb = b.createdAt || b.senderTime || ''
        return ta.localeCompare(tb)
      })
    return recent.slice(-20) // cap at 20 per requirement
  }

  /**
   * Get today's todos + all unfinished historical todos for a sender in a source.
   */
  _getSenderTodos(sourceName, sender) {
    const today = new Date().toISOString().split('T')[0]
    return todosDB.findAll({ sourceName, sender })
      .filter(t => t.date === today || !t.completed)
  }

  /**
   * Ask AI to merge all sender context into a single consolidated todo summary,
   * then upsert (update existing or create new) the sender's todo entry.
   * Also fires the webhook if configured.
   */
  async _mergeSenderTodos({ source, sender, senderHistory, aiReply, senderTodos, newTodoSummary, triggerMessageId, today }) {
    const mergedContent = await aiService.mergeTodos({
      sender,
      sourceName: source.name,
      senderHistory,
      aiReply,
      existingTodos: senderTodos,
      newTodoSummary
    })

    if (!mergedContent) return

    // Upsert: one active (not completed) todo per sender per source
    const existing = todosDB.findAll({ sourceName: source.name, sender })
      .find(t => !t.completed)

    let todoId
    if (existing) {
      todoId = existing.id
      todosDB.update(existing.id, {
        content: mergedContent,
        date: today,
        messageId: triggerMessageId,
        isHistorical: false
      })
      console.log(`[Monitor] Todo merged for "${sender}": "${mergedContent.substring(0, 60)}"`)
    } else {
      todoId = uuidv4()
      todosDB.insert({
        id: todoId,
        sourceName: source.name,
        sender,
        messageId: triggerMessageId,
        content: mergedContent,
        category: '待办事项',
        completed: false,
        isHistorical: false,
        date: today,
        completedAt: null
      })
      console.log(`[Monitor] Todo created for "${sender}": "${mergedContent.substring(0, 60)}"`)
    }

    // Broadcast to frontend
    this.broadcast('new_todo', { sourceName: source.name, sender, content: mergedContent })

    // ── Fire webhook if configured ──────────────────────────────────
    const webhookUrl = source.skill?.todoWebhook?.url
    if (webhookUrl) {
      this._callTodoWebhook(webhookUrl, source.skill.todoWebhook, {
        todoId,
        messageId: triggerMessageId,
        sourceName: source.name,
        sender,
        summary: mergedContent,
        reply: aiReply || '',
        date: today,
        timestamp: new Date().toISOString()
      }).catch(err => console.error('[Webhook] Todo webhook failed:', err.message))
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
