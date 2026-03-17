/**
 * Base Monitor Service — 统一消息处理逻辑
 * WeChat 和 Yunzhijia 的 monitor 共用此基类。
 *
 * 核心行为：
 * 1. @me 触发：只处理群聊中 @我 的消息，作为触发点
 * 2. 碎片化收集：触发后收集该 sender 后续所有消息 + 我的回复，构建完整对话上下文
 * 3. 启动快照：首次扫描时记录已有消息的 dedupKey，不回复历史消息
 * 4. AI 输出：强制 JSON {reply, category, todoSummary}
 * 5. 去重：内容前 80 字符作 dedupKey
 * 6. 双轨轮询：fast (2–11 s) + full-scan (36–101 s)
 * 7. 防卡死：所有浏览器操作带超时保护，轮询循环不会因异常中断
 * 8. 防陈旧：连续多次无新消息时，自动刷新浏览器页面保活
 */
import { v4 as uuidv4 } from 'uuid'
import aiService from './ai.js'
import { sourcesDB, messagesDB, todosDB } from '../db.js'

const DEDUP_LEN = 80
const FAST_MIN_MS  =  2030
const FAST_MAX_MS  = 10870
const FULL_MIN_MS  = 36360
const FULL_MAX_MS  = 100690
const FULL_EXTRA_MSGS = 20
const BROWSER_OP_TIMEOUT = 15000     // 浏览器单次操作超时 15s
const STALE_THRESHOLD = 8            // 连续 N 次全扫描无新消息 → 刷新页面
const DEBUG_RING_SIZE = 200          // 每个 monitor 保留最近 200 条事件

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * 给 Promise 加超时保护，防止浏览器操作卡死
 */
function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`[Timeout] ${label} exceeded ${ms}ms`)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

/**
 * 带计时的 withTimeout，返回 { result, durationMs }
 */
async function withTimedTimeout(promise, ms, label) {
  const t0 = Date.now()
  const result = await withTimeout(promise, ms, label)
  return { result, durationMs: Date.now() - t0 }
}

export class BaseMonitorService {
  /**
   * @param {Object} opts
   * @param {Object} opts.browserService  - 平台浏览器适配器 (browser.js / yunzhijia-browser.js)
   * @param {string} opts.platform        - 'wechat' | 'yunzhijia'
   * @param {string} opts.logPrefix       - 日志前缀 e.g. 'Monitor' | 'YZJ-Monitor'
   * @param {Function} opts.isWithinWorkingHours - () => boolean
   */
  constructor({ browserService, platform, logPrefix, isWithinWorkingHours }) {
    this.browserService = browserService
    this.platform = platform
    this.logPrefix = logPrefix
    this._isWithinWorkingHours = isWithinWorkingHours

    this.isRunning = false
    this.startedAt = null
    this.fastTimer = null
    this.fullTimer = null
    this.wsClients = new Set()
    this._scanning = false             // 扫描锁：防止 fast/full 同时操作浏览器
    this._fullScanCount = 0            // 全扫描计数器，用于触发定期 IM 刷新
    this._consecutiveEmpty = 0         // 连续无新消息的全扫描次数（用于陈旧检测）

    // 启动快照：记录首次扫描时已有消息的 dedupKey，避免回复历史消息
    this._snapshotDone = new Set()     // source.id → 已完成快照
    this._snapshotKeys = new Set()     // "sourceName:dedupKey" → 已见过

    // 运行时诊断计数器
    this._stats = {
      fastPolls: 0,
      fullScans: 0,
      fastSkipped: 0,
      messagesProcessed: 0,
      errors: 0,
      lastFastPoll: null,
      lastFullScan: null,
      lastError: null,
      myNameDetected: null,
      lastLoginCheck: null
    }

    // ── Debug 事件环形缓冲区 ─────────────────────────────────────────
    this._debugEvents = []       // { ts, event, detail, durationMs? }
    this._debugTimings = {       // 各操作的累计耗时统计
      checkLoginStatus: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
      checkNewMessages: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
      getMessages:      { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
      getMyName:        { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
      sendMessage:      { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
      navigateAway:     { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
      openChat:         { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 }
    }
  }

  // ── Debug helpers ──────────────────────────────────────────────────────────

  _debugLog(event, detail = {}, durationMs = null) {
    const entry = {
      ts: new Date().toISOString(),
      event,
      ...detail
    }
    if (durationMs !== null) entry.durationMs = durationMs
    this._debugEvents.push(entry)
    if (this._debugEvents.length > DEBUG_RING_SIZE) {
      this._debugEvents.shift()
    }
  }

  _recordTiming(op, ms) {
    const t = this._debugTimings[op]
    if (!t) return
    t.count++
    t.totalMs += ms
    t.lastMs = ms
    if (ms > t.maxMs) t.maxMs = ms
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  addWSClient(ws) {
    this.wsClients.add(ws)
    ws.on('close', () => this.wsClients.delete(ws))
  }

  broadcast(type, data) {
    const msg = JSON.stringify({ type, data, platform: this.platform, timestamp: new Date().toISOString() })
    this.wsClients.forEach(ws => {
      try { ws.send(msg) } catch { /* ignore */ }
    })
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start() {
    if (this.isRunning) return
    this.isRunning = true
    this.startedAt = Date.now()
    this._snapshotDone = new Set()
    this._snapshotKeys = new Set()

    console.log(`[${this.logPrefix}] Started — fast ~2–11 s, full ~36–101 s, @me filter ON`)
    this._scheduleFast()
    this._scheduleFull()
  }

  stop() {
    this.isRunning = false
    if (this.fastTimer) { clearTimeout(this.fastTimer); this.fastTimer = null }
    if (this.fullTimer) { clearTimeout(this.fullTimer); this.fullTimer = null }
    console.log(`[${this.logPrefix}] Stopped.`)
  }

  // ── 诊断接口 ──────────────────────────────────────────────────────────────

  getStatus() {
    return {
      platform: this.platform,
      isRunning: this.isRunning,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      scanning: this._scanning,
      snapshotDone: [...this._snapshotDone],
      snapshotKeysCount: this._snapshotKeys.size,
      consecutiveEmpty: this._consecutiveEmpty,
      fullScanCount: this._fullScanCount,
      wsClients: this.wsClients.size,
      stats: { ...this._stats }
    }
  }

  /**
   * 完整的 debug 诊断数据（含事件日志和计时统计）
   */
  getDebugData() {
    return {
      ...this.getStatus(),
      timings: { ...this._debugTimings },
      recentEvents: this._debugEvents.slice(-50),   // 最近 50 条事件
      allEventsCount: this._debugEvents.length
    }
  }

  // ── Scheduling（防弹式：.finally 确保循环永不中断）────────────────────────

  _scheduleFast() {
    if (!this.isRunning) return
    this.fastTimer = setTimeout(() => {
      // 用 .catch + .finally 确保无论发生什么，轮询循环都会继续
      this._fastPoll()
        .catch(err => {
          console.error(`[${this.logPrefix}] !!UNCAUGHT fast poll error:`, err?.message || err)
          this._stats.errors++
          this._stats.lastError = `fast: ${err?.message || 'unknown'}`
        })
        .finally(() => this._scheduleFast())
    }, randBetween(FAST_MIN_MS, FAST_MAX_MS))
  }

  _scheduleFull() {
    if (!this.isRunning) return
    this.fullTimer = setTimeout(() => {
      this._fullScan()
        .catch(err => {
          console.error(`[${this.logPrefix}] !!UNCAUGHT full scan error:`, err?.message || err)
          this._stats.errors++
          this._stats.lastError = `full: ${err?.message || 'unknown'}`
        })
        .finally(() => this._scheduleFull())
    }, randBetween(FULL_MIN_MS, FULL_MAX_MS))
  }

  _checkWorkingHours(label) {
    if (!this._isWithinWorkingHours()) {
      const nowBJ = new Date(Date.now() + 8 * 60 * 60 * 1000)
      const timeStr = nowBJ.toISOString().slice(11, 19)
      const days = ['日', '一', '二', '三', '四', '五', '六']
      console.log(`[${this.logPrefix}] ${label} skipped — 非工作时段 (周${days[nowBJ.getUTCDay()]} ${timeStr} BJ)`)
      return false
    }
    return true
  }

  // ── Source helpers ─────────────────────────────────────────────────────────

  _getSources() {
    return sourcesDB.findAll()
      .filter(s => s.enabled !== false && (s.platform || 'wechat') === this.platform)
  }

  _nameMatch(a, b) {
    if (!a || !b) return false
    if (a === b) return true
    const na = a.replace(/\s+/g, '')
    const nb = b.replace(/\s+/g, '')
    if (na === nb) return true
    if (na.includes(nb) || nb.includes(na)) return true
    if (a.includes(b) || b.includes(a)) return true
    return false
  }

  // ── Fast poll（带超时保护 + 诊断日志）──────────────────────────────────────

  async _fastPoll() {
    if (!this.isRunning) return
    if (this._scanning) {
      this._stats.fastSkipped++
      this._debugLog('fast_skipped', { reason: 'scanning_locked' })
      return
    }
    if (!this._checkWorkingHours('Fast poll')) {
      this._debugLog('fast_skipped', { reason: 'outside_working_hours' })
      return
    }

    this._scanning = true
    this._stats.fastPolls++
    this._stats.lastFastPoll = new Date().toISOString()
    const pollStart = Date.now()
    try {
      // checkLoginStatus（带计时）
      const { result: loginStatus, durationMs: loginMs } = await withTimedTimeout(
        this.browserService.checkLoginStatus(),
        BROWSER_OP_TIMEOUT, `${this.logPrefix}/checkLoginStatus`
      )
      this._recordTiming('checkLoginStatus', loginMs)
      this._stats.lastLoginCheck = loginStatus.loggedIn

      if (!loginStatus.loggedIn) {
        this._debugLog('fast_not_logged_in', { loginMs })
        console.log(`[${this.logPrefix}] Fast poll: 未登录，跳过`)
        return
      }

      const sources = this._getSources()
      if (sources.length === 0) {
        this._debugLog('fast_no_sources')
        return
      }

      // checkNewMessages（带计时）
      const sourceNames = sources.map(s => s.name)
      const { result: chatsWithUnread, durationMs: checkMs } = await withTimedTimeout(
        this.browserService.checkNewMessages(sourceNames),
        BROWSER_OP_TIMEOUT, `${this.logPrefix}/checkNewMessages`
      )
      this._recordTiming('checkNewMessages', checkMs)

      if (chatsWithUnread.length === 0) {
        this._debugLog('fast_no_unread', { loginMs, checkMs, sourceCount: sources.length })
        return
      }

      let totalFound = 0
      let scannedAny = false
      for (const chat of chatsWithUnread) {
        const source = sources.find(s => this._nameMatch(s.name, chat.name))
        if (source) {
          scannedAny = true
          const found = await this._scanSource(source, chat.unread, 'fast')
          if (found > 0) totalFound += found
        }
      }

      // ★ 同样的修复：只要打开过聊天就必须 navigateAway，否则未读红点消失
      if (scannedAny) {
        const { durationMs: navMs } = await withTimedTimeout(
          this.browserService.navigateAway(),
          BROWSER_OP_TIMEOUT, `${this.logPrefix}/navigateAway`
        ).catch(err => {
          console.warn(`[${this.logPrefix}] navigateAway failed:`, err?.message)
          return { durationMs: 0 }
        })
        this._recordTiming('navigateAway', navMs)
      }

      this._debugLog('fast_done', {
        totalMs: Date.now() - pollStart,
        loginMs, checkMs,
        unread: chatsWithUnread.map(c => `${c.name}(${c.unread})`),
        found: totalFound
      })
    } catch (err) {
      console.error(`[${this.logPrefix}] Fast poll error:`, err?.message || err)
      this._stats.errors++
      this._stats.lastError = `fast: ${err?.message || 'unknown'}`
      this._debugLog('fast_error', { error: err?.message, totalMs: Date.now() - pollStart })
    } finally {
      this._scanning = false
    }
  }

  // ── Full scan（带超时保护 + 陈旧检测 + 页面保活）───────────────────────────

  async _fullScan() {
    if (!this.isRunning) return
    if (this._scanning) {
      this._debugLog('full_skipped', { reason: 'scanning_locked' })
      return
    }
    if (!this._checkWorkingHours('Full scan')) {
      this._debugLog('full_skipped', { reason: 'outside_working_hours' })
      return
    }

    this._scanning = true
    this._stats.fullScans++
    this._stats.lastFullScan = new Date().toISOString()
    const scanStart = Date.now()
    try {
      // checkLoginStatus（带计时）
      const { result: loginStatus, durationMs: loginMs } = await withTimedTimeout(
        this.browserService.checkLoginStatus(),
        BROWSER_OP_TIMEOUT, `${this.logPrefix}/checkLoginStatus`
      )
      this._recordTiming('checkLoginStatus', loginMs)
      this._stats.lastLoginCheck = loginStatus.loggedIn

      if (!loginStatus.loggedIn) {
        this._debugLog('full_not_logged_in', { loginMs })
        console.log(`[${this.logPrefix}] Full scan: 未登录，跳过`)
        return
      }

      const sources = this._getSources()
      if (sources.length === 0) {
        this._debugLog('full_no_sources')
        console.log(`[${this.logPrefix}] Full scan: 无有效数据源`)
        return
      }

      // checkNewMessages（带计时）
      const sourceNames = sources.map(s => s.name)
      const { result: chatsWithUnread, durationMs: checkMs } = await withTimedTimeout(
        this.browserService.checkNewMessages(sourceNames),
        BROWSER_OP_TIMEOUT, `${this.logPrefix}/checkNewMessages`
      )
      this._recordTiming('checkNewMessages', checkMs)

      this._fullScanCount++

      // ── 陈旧检测 + 页面保活 ──────────────────────────────────────
      const needRefresh =
        (this._fullScanCount % 5 === 0) ||
        (this._consecutiveEmpty >= STALE_THRESHOLD)

      if (needRefresh) {
        const reason = this._consecutiveEmpty >= STALE_THRESHOLD
          ? `陈旧检测 (连续 ${this._consecutiveEmpty} 次无新消息)`
          : `定期保活 (scan #${this._fullScanCount})`
        console.log(`[${this.logPrefix}] 页面刷新: ${reason}`)
        this._debugLog('page_refresh', { reason, fullScanCount: this._fullScanCount, consecutiveEmpty: this._consecutiveEmpty })

        if (typeof this.browserService.refreshImFrame === 'function') {
          await withTimeout(
            this.browserService.refreshImFrame(),
            BROWSER_OP_TIMEOUT, `${this.logPrefix}/refreshImFrame`
          ).catch(err => console.warn(`[${this.logPrefix}] refreshImFrame failed:`, err?.message))
        } else if (typeof this.browserService.refreshPage === 'function') {
          await withTimeout(
            this.browserService.refreshPage(),
            BROWSER_OP_TIMEOUT * 2, `${this.logPrefix}/refreshPage`
          ).catch(err => console.warn(`[${this.logPrefix}] refreshPage failed:`, err?.message))
        }

        if (this._consecutiveEmpty >= STALE_THRESHOLD) {
          this._consecutiveEmpty = 0
        }
      }

      console.log(`[${this.logPrefix}] Full scan #${this._fullScanCount}: ${sources.length} source(s), unread=[${chatsWithUnread.map(c => `${c.name}(${c.unread})`).join(',')}]`)

      let totalNew = 0
      const sourceResults = []
      for (const source of sources) {
        const unreadEntry = chatsWithUnread.find(c => this._nameMatch(c.name, source.name))
        const srcStart = Date.now()
        const found = await this._scanSource(source, unreadEntry?.unread || 0, 'full')
        const srcMs = Date.now() - srcStart
        sourceResults.push({ name: source.name, found, durationMs: srcMs, unread: unreadEntry?.unread || 0 })
        if (found > 0) totalNew += found
      }

      if (totalNew > 0) {
        this._consecutiveEmpty = 0
      } else {
        this._consecutiveEmpty++
      }

      // ★ 关键修复：无论是否找到新消息，都必须 navigateAway
      // getMessages() 内部调用 openChat()，如果不切走，当前聊天窗口保持打开
      // 微信/云之家对"正在查看的聊天"不显示未读红点 → fast poll 的 checkNewMessages 永远检测不到新消息
      if (sources.length > 0) {
        const { durationMs: navMs } = await withTimedTimeout(
          this.browserService.navigateAway(),
          BROWSER_OP_TIMEOUT, `${this.logPrefix}/navigateAway`
        ).catch(err => {
          console.warn(`[${this.logPrefix}] navigateAway failed:`, err?.message)
          return { durationMs: 0 }
        })
        this._recordTiming('navigateAway', navMs)
      }

      this._debugLog('full_done', {
        totalMs: Date.now() - scanStart,
        loginMs, checkMs,
        scanCount: this._fullScanCount,
        consecutiveEmpty: this._consecutiveEmpty,
        totalNew,
        sources: sourceResults
      })
    } catch (err) {
      console.error(`[${this.logPrefix}] Full scan error:`, err?.message || err)
      this._stats.errors++
      this._stats.lastError = `full: ${err?.message || 'unknown'}`
      this._debugLog('full_error', { error: err?.message, totalMs: Date.now() - scanStart })
    } finally {
      this._scanning = false
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ══  核心消息处理（@me 过滤 + sender 合并 + AI 调用）                   ══
  // ══════════════════════════════════════════════════════════════════════════

  async _scanSource(source, unreadCount = 0, mode = 'fast') {
    try {
      // ── 1. 获取消息（带计时+超时保护）────────────────────────────────
      const { result: messages, durationMs: getMsgMs } = await withTimedTimeout(
        this.browserService.getMessages(source.name),
        BROWSER_OP_TIMEOUT, `${this.logPrefix}/getMessages(${source.name})`
      )
      this._recordTiming('getMessages', getMsgMs)

      if (!messages || messages.length === 0) {
        this._debugLog('scan_empty_messages', { source: source.name, mode, getMsgMs })
        console.log(`[${this.logPrefix}] _scanSource "${source.name}": 获取消息为空 (${getMsgMs}ms)`)
        return 0
      }

      // ── 2. 检测"我"的名字（必须在快照之前，确保首次就能缓存）──────────
      let myName = null
      let myNameMs = 0
      if (typeof this.browserService.getMyName === 'function') {
        const t0 = Date.now()
        myName = await withTimeout(
          this.browserService.getMyName(),
          BROWSER_OP_TIMEOUT, `${this.logPrefix}/getMyName`
        ).catch(err => {
          console.warn(`[${this.logPrefix}] getMyName timeout/error: ${err?.message}`)
          return null
        })
        myNameMs = Date.now() - t0
        this._recordTiming('getMyName', myNameMs)
      }
      this._stats.myNameDetected = myName

      if (!myName) {
        console.warn(`[${this.logPrefix}] ⚠ myName=null for "${source.name}" — 群聊@me检测将失效，仅私聊可触发`)
      }

      // ── 3. 启动快照（每个 source 首次扫描时执行一次）────────────────
      //   ★ 只快照"DB 中已有 processed 记录"的消息
      //   如果消息在聊天窗口中可见但 DB 没有处理记录，说明是未被回复的旧消息 → 不拦截
      //   这样重启后，之前遗漏的 @me 消息仍可被处理
      if (!this._snapshotDone.has(source.id)) {
        let snapped = 0
        let skippedNew = 0
        for (const msg of messages) {
          if (!msg.content) continue
          const dedupKey = msg.content.substring(0, DEDUP_LEN)
          const key = `${source.name}:${dedupKey}`
          // 只有 DB 里确认处理过的消息才加入快照
          const inDB = !!messagesDB.findOne({ sourceName: source.name, dedupKey, processed: true })
          if (inDB) {
            this._snapshotKeys.add(key)
            snapped++
          } else {
            skippedNew++
          }
        }
        this._snapshotDone.add(source.id)
        console.log(`[${this.logPrefix}] Snapshot "${source.name}": ${snapped} confirmed in DB, ${skippedNew} new/pending (will process on next scan)`)
        // ★ 不再 return 0 — 如果有未处理的消息，立即进入后续流程处理
        if (skippedNew === 0) return 0
      }

      // ── 4a. 找到有 @me 触发消息的 sender 及其触发位置 ────────────
      //   对于私聊，跳过 @me 过滤，直接处理所有来自对方的消息
      //   triggerSenders: Map<senderName, firstTriggerIndex>
      const scanCount = unreadCount + FULL_EXTRA_MSGS
      const recentSlice = messages.slice(-Math.min(scanCount, messages.length))

      // 检测是否是私聊：只有一个非自己的 sender（排除自己的消息）
      const senders = new Set()
      for (const m of recentSlice) {
        if (m.type !== 'me' && !(myName && m.senderName === myName)) {
          senders.add(m.sender || m.senderName || 'unknown')
        }
      }
      const isPrivateChat = senders.size === 1

      const triggerSenders = new Map()
      let skippedProcessed = 0
      let skippedNoTrigger = 0
      for (let i = 0; i < recentSlice.length; i++) {
        const m = recentSlice[i]
        if (m.type === 'me' || !m.content) continue
        if (myName && m.senderName === myName) continue

        const sKey = m.sender || m.senderName || 'unknown'
        const dedupKey = m.content.substring(0, DEDUP_LEN)
        const snapshotKey = `${source.name}:${dedupKey}`
        const isProcessed = this._snapshotKeys.has(snapshotKey) ||
                            !!messagesDB.findOne({ sourceName: source.name, dedupKey, processed: true })

        if (isProcessed) { skippedProcessed++; continue }

        let isTriggered = false

        if (isPrivateChat) {
          // 私聊：所有对方消息都是触发点
          isTriggered = true
        } else if (myName && m.content.includes(`@${myName}`)) {
          // 群聊：需要 @me
          isTriggered = true
        }

        if (isTriggered && !triggerSenders.has(sKey)) {
          triggerSenders.set(sKey, i)
        } else if (!isTriggered) {
          skippedNoTrigger++
        }
      }

      if (triggerSenders.size === 0) {
        // 关键诊断日志：为什么没有找到触发消息
        const detail = {
          source: source.name, mode, getMsgMs, myNameMs,
          totalMsgs: messages.length, scanned: recentSlice.length,
          alreadyProcessed: skippedProcessed, noTrigger: skippedNoTrigger,
          myName: myName || 'NULL', isPrivateChat, senders: [...senders]
        }
        if (mode === 'full') {
          console.log(`[${this.logPrefix}] _scanSource "${source.name}": 无触发消息 (total=${messages.length}, scanned=${recentSlice.length}, alreadyProcessed=${skippedProcessed}, noTrigger=${skippedNoTrigger}, myName=${myName || 'NULL'}, private=${isPrivateChat}, senders=[${[...senders].join(',')}])`)
        }
        this._debugLog('scan_no_triggers', detail)
        return 0
      }

      // ── 4b. 收集每个 trigger sender 的完整对话上下文 ──────────────
      //   从 @me 触发点开始，收集该 sender 后续所有消息 + 我的回复
      //   对于私聊，不区分 trigger vs follow-up，都归入 triggerMsgs
      const senderContextMap = new Map()  // senderName → { triggerMsgs, followUpMsgs, myReplies }

      for (const [senderKey, triggerIdx] of triggerSenders) {
        const triggerMsgs = []    // sender 的 @me 消息或私聊主消息（新的、未处理的）
        const followUpMsgs = []   // sender 后续的碎片化消息（群聊专用）
        const myReplies = []      // 我对该 sender 的回复

        for (let i = triggerIdx; i < recentSlice.length; i++) {
          const m = recentSlice[i]
          if (!m.content) continue

          const mSender = m.sender || m.senderName || 'unknown'

          if (m.type === 'me' || (myName && m.senderName === myName)) {
            // 我的回复消息
            myReplies.push(m)
          } else if (mSender === senderKey) {
            const dedupKey = m.content.substring(0, DEDUP_LEN)
            const snapshotKey = `${source.name}:${dedupKey}`
            const isOld = this._snapshotKeys.has(snapshotKey) ||
                          !!messagesDB.findOne({ sourceName: source.name, dedupKey, processed: true })

            if (isOld) continue

            if (isPrivateChat) {
              // 私聊：所有消息都归入 triggerMsgs
              triggerMsgs.push(m)
            } else if (myName && m.content.includes(`@${myName}`)) {
              // 群聊：@me 消息进入 triggerMsgs
              triggerMsgs.push(m)
            } else {
              // 群聊：后续碎片化消息进入 followUpMsgs
              followUpMsgs.push(m)
            }
          }
        }

        if (triggerMsgs.length > 0) {
          senderContextMap.set(senderKey, { triggerMsgs, followUpMsgs, myReplies })
        }
      }

      if (senderContextMap.size === 0) return 0

      // ── 5. 逐 sender 处理：完整对话上下文 → AI → 回复 ──────────────
      //   ★ 关键：每个 sender 独立 try/catch，一个 sender 失败不影响其他 sender
      let totalNew = 0
      const today = new Date().toISOString().split('T')[0]

      for (const [sender, ctx] of senderContextMap) {
        const senderStart = Date.now()
        try {
        const { triggerMsgs, followUpMsgs, myReplies } = ctx
        const allNewSenderMsgs = [...triggerMsgs, ...followUpMsgs]

        const senderHistory = this._getSenderHistory(source.name, sender)
        const senderTodos   = this._getSenderTodos(source.id, sender)
        const latestMsg     = allNewSenderMsgs[allNewSenderMsgs.length - 1]

        console.log(`[${this.logPrefix}] @me from ${sender}: ${triggerMsgs.length} trigger + ${followUpMsgs.length} follow-up + ${myReplies.length} my replies`)

        // ── 构建完整对话上下文（sender消息 + 我的回复，按时间排序）──
        const conversationContext = []
        for (let i = triggerSenders.get(sender); i < recentSlice.length; i++) {
          const m = recentSlice[i]
          if (!m.content) continue
          const mSender = m.sender || m.senderName || 'unknown'
          const isMe = m.type === 'me' || (myName && m.senderName === myName)
          if (isMe || mSender === sender) {
            conversationContext.push({
              role: isMe ? '我' : sender,
              content: m.content,
              time: m.time || ''
            })
          }
        }

        // ── 生成 AI 回复（带超时保护）──────────────────────────────
        let aiResult = { text: '', category: '消息记录', todoSummary: null }

        if (source.skill?.autoReply && myName) {
          // 合并 DB 历史 + 本轮所有新消息
          const mergedHistory = [
            ...senderHistory,
            ...allNewSenderMsgs.map(m => ({
              senderContentFull: m.content,
              senderContent: m.content.substring(0, DEDUP_LEN),
              senderTime: m.time || '',
              sender,
              createdAt: new Date().toISOString()
            }))
          ]

          // 合并所有新消息的内容作为完整发言（碎片化合并）
          const fullMessage = allNewSenderMsgs.map(m => m.content).join('\n')

          const aiStart = Date.now()
          aiResult = await withTimeout(
            aiService.generateReply({
              message: fullMessage,
              sender,
              sourceName: source.name,
              skill: source.skill,
              recentMessages: messages.slice(-10),
              senderHistory: mergedHistory,
              senderTodos,
              conversationContext,
              platform: this.platform
            }),
            30000,  // AI 调用 30s 超时（比浏览器操作的 15s 更宽松）
            `${this.logPrefix}/AI(${sender})`
          )
          const aiMs = Date.now() - aiStart

          console.log(`[${this.logPrefix}] AI → reply="${(aiResult.text || '').substring(0, 50)}" category="${aiResult.category}" todo=${!!aiResult.todoSummary} (${aiMs}ms)`)
          this._debugLog('ai_reply', { sender, source: source.name, aiMs, hasText: !!aiResult.text, category: aiResult.category })
        } else if (!myName) {
          console.log(`[${this.logPrefix}] myName unknown, recording only`)
        } else {
          console.log(`[${this.logPrefix}] autoReply=false, recording only`)
        }

        // ── 保存所有新消息 + 只对最新消息发回复 ────────────────────
        for (let i = 0; i < allNewSenderMsgs.length; i++) {
          const msg = allNewSenderMsgs[i]
          const isLatest = (i === allNewSenderMsgs.length - 1)
          const dedupKey = msg.content.substring(0, DEDUP_LEN)

          const record = {
            id: uuidv4(),
            sourceName: source.name,
            platform: this.platform,
            sender,
            senderTime: msg.time || new Date().toISOString(),
            senderContent: msg.content.substring(0, DEDUP_LEN),
            senderContentFull: msg.content,
            dedupKey,
            replyContent:     isLatest ? ((aiResult.text || '').substring(0, 100)) : '',
            replyContentFull: isLatest ? (aiResult.text || '') : '',
            replyTime: null,
            category: isLatest ? (aiResult.category || '消息记录') : '消息记录',
            hasTodo: false,
            processed: true,
            date: today
          }

          // 标记 snapshot 防止重复处理
          this._snapshotKeys.add(`${source.name}:${dedupKey}`)

          // 只对最新消息发送回复（带超时保护 + 计时）
          if (isLatest && aiResult.text && source.skill?.autoReply && myName) {
            // ★ 清理 AI 回复中的自我 @：避免回复时错误地 @自己
            const escName = myName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const replyText = aiResult.text.replace(new RegExp(`@${escName}\\s?`, 'g'), '').trim()

            if (!replyText) {
              console.warn(`[${this.logPrefix}] Reply became empty after stripping self-@, skipping send`)
            } else {
              const sendStart = Date.now()
              const sendResult = await withTimeout(
                this.browserService.sendMessage(source.name, replyText),
                BROWSER_OP_TIMEOUT, `${this.logPrefix}/sendMessage`
              ).catch(err => ({ success: false, message: `timeout: ${err?.message}` }))
              const sendMs = Date.now() - sendStart
              this._recordTiming('sendMessage', sendMs)
              if (sendResult.success) {
                record.replyTime = new Date().toISOString()
                console.log(`[${this.logPrefix}] Reply sent to "${source.name}" for ${sender} (${sendMs}ms)`)
                this._debugLog('reply_sent', { sender, source: source.name, sendMs })
              } else {
                console.warn(`[${this.logPrefix}] Send failed for ${sender}: ${sendResult.message} (${sendMs}ms)`)
                this._debugLog('reply_failed', { sender, source: source.name, sendMs, error: sendResult.message })
              }
            }
          }

          // 待办事项处理
          if (isLatest && (aiResult.todoSummary || senderTodos.length > 0)) {
            record.hasTodo = true
            if (aiResult.todoSummary) record.category = aiResult.category || '待办事项'
            this._mergeSenderTodos({
              source,
              groupId: source.id,
              sender,
              senderHistory,
              aiReply: aiResult.text,
              senderTodos,
              newTodoSummary: aiResult.todoSummary,
              triggerMessageId: record.id,
              today
            }).catch(err => console.error(`[${this.logPrefix}] _mergeSenderTodos error:`, err.message))
          }

          messagesDB.insert(record)
          this.broadcast('new_message', record)
          totalNew++
        }

        this._debugLog('sender_done', {
          sender, source: source.name, mode,
          msgCount: allNewSenderMsgs.length,
          durationMs: Date.now() - senderStart
        })

        } catch (senderErr) {
          // ★ 单个 sender 失败不影响其他 sender 的处理
          console.error(`[${this.logPrefix}] ❌ sender "${sender}" processing failed:`, senderErr?.message || senderErr)
          this._stats.errors++
          this._stats.lastError = `sender(${sender}): ${senderErr?.message || 'unknown'}`
          this._debugLog('sender_error', {
            sender, source: source.name, mode,
            error: senderErr?.message,
            durationMs: Date.now() - senderStart
          })
        }
      }

      if (totalNew > 0) {
        this._stats.messagesProcessed += totalNew
        console.log(`[${this.logPrefix}] Processed ${totalNew} new @me message(s) from "${source.name}"`)
        this._debugLog('scan_processed', {
          source: source.name, mode, totalNew, getMsgMs, myNameMs,
          triggerSenders: [...triggerSenders.keys()]
        })
      }
      return totalNew
    } catch (err) {
      console.error(`[${this.logPrefix}] _scanSource error:`, err)
      this._debugLog('scan_error', { source: source.name, mode, error: err?.message })
      return 0
    }
  }

  // ── Sender context helpers ─────────────────────────────────────────────────

  _getSenderHistory(sourceName, sender) {
    const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
    const all = messagesDB.findAll({ sourceName, sender })
    return all
      .filter(m => (m.createdAt || m.senderTime || '') >= cutoff)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      .slice(-20)
  }

  _getSenderTodos(groupId, sender) {
    const today = new Date().toISOString().split('T')[0]
    return todosDB.findAll({ groupId, sender })
      .filter(t => t.date === today || !t.completed)
  }

  // ── Todo merge + webhook ──────────────────────────────────────────────────

  async _mergeSenderTodos({ source, groupId, sender, senderHistory, aiReply, senderTodos, newTodoSummary, triggerMessageId, today }) {
    const mergedContent = await aiService.mergeTodos({
      sender,
      groupId,
      sourceName: source.name,
      senderHistory,
      aiReply,
      existingTodos: senderTodos,
      newTodoSummary
    })

    if (!mergedContent) return

    const existing = todosDB.findAll({ groupId, sender }).find(t => !t.completed)

    let todoId
    if (existing) {
      todoId = existing.id
      todosDB.update(existing.id, {
        content: mergedContent,
        date: today,
        messageId: triggerMessageId,
        isHistorical: false
      })
      console.log(`[${this.logPrefix}] Todo merged: "${sender}" → "${mergedContent.substring(0, 60)}"`)
    } else {
      todoId = uuidv4()
      todosDB.insert({
        id: todoId,
        groupId,
        sourceName: source.name,
        platform: this.platform,
        sender,
        messageId: triggerMessageId,
        content: mergedContent,
        category: '待办事项',
        completed: false,
        isHistorical: false,
        date: today,
        completedAt: null
      })
      console.log(`[${this.logPrefix}] Todo created: "${sender}" → "${mergedContent.substring(0, 60)}"`)
    }

    this.broadcast('new_todo', { groupId, sourceName: source.name, sender, content: mergedContent })

    // Webhook
    const webhookUrl = source.skill?.todoWebhook?.url
    if (webhookUrl) {
      this._callTodoWebhook(webhookUrl, source.skill.todoWebhook, {
        todoId, groupId, platform: this.platform, messageId: triggerMessageId,
        sourceName: source.name, sender, summary: mergedContent,
        reply: aiReply || '', date: today, timestamp: new Date().toISOString()
      }).catch(err => console.error(`[${this.logPrefix}] Webhook failed:`, err.message))
    }
  }

  async _callTodoWebhook(url, webhookConfig, payload) {
    const method = webhookConfig.method || 'POST'
    let body
    if (webhookConfig.bodyTemplate) {
      let tpl = webhookConfig.bodyTemplate
      Object.entries(payload).forEach(([k, v]) => {
        tpl = tpl.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? ''))
      })
      try { body = JSON.parse(tpl) } catch { body = tpl }
    } else {
      body = payload
    }

    const headers = { 'Content-Type': 'application/json', ...(webhookConfig.headers || {}) }
    console.log(`[${this.logPrefix}] Webhook POST ${url}`)
    const res = await fetch(url, {
      method, headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`HTTP ${res.status}: ${errText.substring(0, 100)}`)
    }
  }
}
