/**
 * Playwright Browser Service — Yunzhijia (云之家) Web IM
 * Adapter that mirrors browser.js but targets yunzhijia.com/im/xiaoxi/
 *
 * Page structure (confirmed via live DOM inspection):
 *   Main page → iframe[/im/xiaoxi/]
 *     .im-container
 *       .im-sidebar → .im-list-wrapper → li.session-item
 *       .im-chat-container
 *         .im-chat-title
 *         .im-chat-main-wrapper → .im-chat-p-ms
 *           .im-chat-pannel#msg-list → .im-chat-content → .chat-item
 *           .im-message-sendbox → pre.content-area[contenteditable]
 *
 * Session item: li.session-item
 *   id = "55822d6de4b0a52c4abeffc4-XT-10001"
 *   data-updatetime = "2026-02-27 20:42:01"
 *   .session-item-name .name-list → chat name
 *   .session-item-time → time
 *   .session-item-msg → last message preview
 *
 * Message bubble: .chat-item
 *   .chat-item-content
 *     img.avatar[title="发送者", data-fid="..."]
 *     .msg[data-msgid="..."]
 *       .msg-wrap
 *         .send-info → .send-user + .company + .send-time
 *         .send-body[data-isme="0/1", data-msgtype="2", data-sendtime="...", data-msgid="..."]
 *           .send-content → actual text
 *
 * Tech: Vue 2.2.6 + Vuex + Backbone.js + jQuery, loaded inside iframe
 */
import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class YunzhijiaBrowserService {
  constructor() {
    this.browser = null
    this.context = null
    this.page = null        // outer page (yunzhijia.com layout)
    this.imFrame = null      // iframe handle for /im/xiaoxi/
    this.isConnected = false
    this.isLoggedIn = false
    this._myName = null      // cached display name of logged-in user
    this.userDataDir = path.join(__dirname, '..', '..', 'data', 'yzj-browser-profile')
  }

  // ── Launch ──────────────────────────────────────────────────────────────────

  async launch() {
    if (this.browser) {
      return { success: true, message: '云之家浏览器已在运行' }
    }

    try {
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        viewport: { width: 1400, height: 900 },
        locale: 'zh-CN',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-ipc-flooding-protection'
        ]
      })

      this.page = this.context.pages()[0] || await this.context.newPage()
      await this.page.goto('https://www.yunzhijia.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })

      this.isConnected = true
      this.browser = true

      return { success: true, message: '云之家已启动，请登录' }
    } catch (err) {
      console.error('[YZJ-Browser] Launch error:', err)
      return { success: false, message: `启动失败: ${err.message}` }
    }
  }

  // ── IM Frame accessor ───────────────────────────────────────────────────────

  /**
   * Locate and cache the /im/xiaoxi/ iframe.
   * The IM module lives inside an iframe, so all DOM queries must go through it.
   */
  async _getImFrame() {
    if (!this.page) return null
    try {
      // Try cached frame first
      if (this.imFrame) {
        try {
          // Quick liveness check
          await this.imFrame.evaluate(() => document.readyState)
          return this.imFrame
        } catch {
          this.imFrame = null
        }
      }

      // First: navigate to IM tab if not already there
      const currentUrl = this.page.url()
      if (!currentUrl.includes('/im/') && !currentUrl.includes('tab=im')) {
        // Click the "消息" nav tab
        const msgTab = this.page.locator('text=消息').first()
        if (await msgTab.count() > 0) {
          await msgTab.click()
          await this.page.waitForTimeout(1500)
        }
      }

      // Locate the IM iframe (try multiple URL patterns)
      const frames = this.page.frames()
      const imPatterns = ['/im/xiaoxi/', '/im/']
      for (const frame of frames) {
        const frameUrl = frame.url()
        if (imPatterns.some(p => frameUrl.includes(p)) && frameUrl !== this.page.url()) {
          this.imFrame = frame
          console.log('[YZJ-Browser] IM iframe located:', frameUrl.slice(0, 80))
          return frame
        }
      }

      // Fallback: try any non-main frame that has the IM DOM
      for (const frame of frames) {
        if (frame === this.page.mainFrame()) continue
        try {
          const hasImDom = await frame.evaluate(() =>
            !!document.querySelector('.im-container, .session-item, .im-chat-content')
          )
          if (hasImDom) {
            this.imFrame = frame
            console.log('[YZJ-Browser] IM iframe found via DOM fallback:', frame.url().slice(0, 80))
            return frame
          }
        } catch { /* frame not accessible */ }
      }

      console.warn('[YZJ-Browser] IM iframe not found')
      return null
    } catch (err) {
      console.error('[YZJ-Browser] _getImFrame error:', err.message)
      return null
    }
  }

  // ── Login status ────────────────────────────────────────────────────────────

  async checkLoginStatus() {
    if (!this.page) return { loggedIn: false }
    try {
      const url = this.page.url()

      // 明确未登录：在登录页面
      const loginKeywords = ['/login', '/register', '/activate', '/sso', 'oauth']
      if (!url || url === 'about:blank') return { loggedIn: false }
      if (loginKeywords.some(k => url.includes(k))) {
        this.isLoggedIn = false
        return { loggedIn: false }
      }

      // 已登录的信号：
      // 1. URL 包含 yunzhijia.com 且不是登录页
      // 2. DOM 中存在 IM iframe
      const loggedIn = await this.page.evaluate(() => {
        // 有 IM iframe = 肯定已登录
        const hasImIframe = Array.from(document.querySelectorAll('iframe'))
          .some(f => f.src && f.src.includes('/im/'))
        if (hasImIframe) return true

        // 有导航栏元素（宽松匹配）
        const nav = document.querySelector('nav, [class*="nav"], [class*="header"], [class*="sidebar"]')
        if (nav) return true

        // 页面有实质内容且不含登录表单
        const loginForm = document.querySelector('input[type="password"], .login, [class*="login"]')
        return !loginForm && document.body?.innerHTML?.length > 5000
      })

      this.isLoggedIn = loggedIn
      console.log(`[YZJ-Browser] Login status: ${loggedIn ? '已登录' : '未登录'} (url: ${url.slice(0, 60)})`)
      return { loggedIn }
    } catch (err) {
      console.error('[YZJ-Browser] checkLoginStatus error:', err.message)
      return { loggedIn: false }
    }
  }

  // ── Detect my display name ──────────────────────────────────────────────────

  async getMyName() {
    if (this._myName) return this._myName

    try {
      // Method 1: look in outer page for user profile area
      if (this.page) {
        const outerName = await this.page.evaluate(() => {
          const sels = [
            '.user-name', '.username', '.avatar-name',
            '.yzj-header .name', '.home-nav .name',
            '[class*="user-info"] .name', '.personal-info .name'
          ]
          for (const sel of sels) {
            const el = document.querySelector(sel)
            if (el?.textContent?.trim()) return el.textContent.trim()
          }
          return null
        }).catch(() => null)
        if (outerName) {
          this._myName = outerName
          console.log(`[YZJ-Browser] My name (header): "${outerName}"`)
          return outerName
        }
      }

      // Method 2: look in portal iframe
      if (this.page) {
        for (const frame of this.page.frames()) {
          if (frame.url().includes('/portal/')) {
            const name = await frame.evaluate(() => {
              const el = document.querySelector('.user-name, .avatar-name, [class*="user"] .name')
              return el?.textContent?.trim() || null
            }).catch(() => null)
            if (name) {
              this._myName = name
              console.log(`[YZJ-Browser] My name (portal): "${name}"`)
              return name
            }
          }
        }
      }

      // Method 3: look for "me" messages in IM frame (CSS class .chat-item.me OR data-isme="1")
      const frame = await this._getImFrame()
      if (frame) {
        const imName = await frame.evaluate(() => {
          // Strategy A: find chat items with class "me"
          const meItems = document.querySelectorAll('.chat-item.me')
          for (const item of meItems) {
            // Get name from .send-user
            const senderEl = item.querySelector('.send-user')
            if (senderEl?.textContent?.trim()) return senderEl.textContent.trim()
            // Fallback: get name from avatar title
            const avatarEl = item.querySelector('img.avatar[title]')
            if (avatarEl?.getAttribute('title')?.trim()) return avatarEl.getAttribute('title').trim()
          }

          // Strategy B: find send-body with data-isme="1"
          const myBodies = document.querySelectorAll('.send-body[data-isme="1"]')
          for (const body of myBodies) {
            const chatItem = body.closest('.chat-item')
            if (chatItem) {
              const senderEl = chatItem.querySelector('.send-user')
              if (senderEl?.textContent?.trim()) return senderEl.textContent.trim()
            }
          }

          // Strategy C: avatar with title matching (check if any avatar title matches session owner)
          const avatars = document.querySelectorAll('img.avatar[title]')
          const nameCounts = {}
          for (const av of avatars) {
            const name = av.getAttribute('title')?.trim()
            if (name) nameCounts[name] = (nameCounts[name] || 0) + 1
          }
          // In a group chat where the user has sent messages, their avatar appears
          // with the .chat-item.me parent - already covered above. But as extra fallback:
          return null
        }).catch(() => null)
        if (imName) {
          this._myName = imName
          console.log(`[YZJ-Browser] My name (messages): "${imName}"`)
          return imName
        }
      }

      console.warn('[YZJ-Browser] Could not detect my name')
      return null
    } catch (err) {
      console.error('[YZJ-Browser] getMyName error:', err.message)
      return null
    }
  }

  // ── Chat list ───────────────────────────────────────────────────────────────

  async getChatList() {
    const frame = await this._getImFrame()
    if (!frame) return []

    try {
      const list = await frame.evaluate(() => {
        const items = document.querySelectorAll('.session-item')
        const results = []

        items.forEach(item => {
          // Chat name
          const nameEl = item.querySelector('.name-list') ||
                         item.querySelector('.session-item-name span') ||
                         item.querySelector('.session-item-name')
          const name = nameEl?.textContent?.trim() || ''

          // Unread badge
          const unreadEl = item.querySelector('.unread-count') ||
                           item.querySelector('.unread') ||
                           item.querySelector('.session-unread-count')
          const unreadRaw = unreadEl?.textContent?.trim() || '0'
          const unread = parseInt(unreadRaw) || (unreadEl ? 1 : 0)

          if (name) results.push({ name, unread })
        })

        return results
      })

      console.log(`[YZJ-Browser] getChatList: ${list.length} chats, ${list.filter(c => c.unread > 0).length} with unread`)
      return list
    } catch (err) {
      console.error('[YZJ-Browser] getChatList error:', err)
      return []
    }
  }

  // ── Open chat ───────────────────────────────────────────────────────────────

  async openChat(chatName) {
    const frame = await this._getImFrame()
    if (!frame) return false

    try {
      // Click matching session item (fuzzy: ignore spaces)
      const clicked = await frame.evaluate((targetName) => {
        const normalize = s => s.replace(/\s+/g, '')
        const target = normalize(targetName)
        const items = document.querySelectorAll('.session-item')
        for (const item of items) {
          const nameEl = item.querySelector('.name-list') ||
                         item.querySelector('.session-item-name span') ||
                         item.querySelector('.session-item-name')
          const name = nameEl?.textContent?.trim() || ''
          const norm = normalize(name)
          if (name === targetName || norm === target ||
              norm.includes(target) || target.includes(norm)) {
            item.click()
            return true
          }
        }
        return false
      }, chatName)

      if (clicked) {
        await frame.waitForTimeout(800)
        console.log(`[YZJ-Browser] Opened chat: ${chatName}`)
        return true
      }

      // Fallback: try search
      const searchBox = frame.locator('input[placeholder*="搜索"], input.search-input').first()
      if (await searchBox.count() > 0) {
        await searchBox.click()
        await searchBox.fill(chatName)
        await frame.waitForTimeout(1200)

        const result = frame.locator('.session-item').filter({ hasText: chatName }).first()
        if (await result.count() > 0) {
          await result.click()
          await frame.waitForTimeout(800)
          console.log(`[YZJ-Browser] Opened chat (search): ${chatName}`)
          return true
        }

        // Clear search
        await searchBox.fill('')
      }

      console.warn(`[YZJ-Browser] Chat not found: "${chatName}"`)
      return false
    } catch (err) {
      console.error('[YZJ-Browser] openChat error:', err)
      return false
    }
  }

  // ── Get messages ────────────────────────────────────────────────────────────

  async getMessages(chatName) {
    const frame = await this._getImFrame()
    if (!frame) return []

    try {
      const opened = await this.openChat(chatName)
      if (!opened) return []

      await frame.waitForTimeout(500)

      const msgs = await frame.evaluate(() => {
        const chatContent = document.querySelector('.im-chat-content')
        if (!chatContent) return []

        const items = chatContent.querySelectorAll('.chat-item')
        return Array.from(items).map(item => {
          const sendBody = item.querySelector('.send-body')
          if (!sendBody) return null

          // isMe: multiple strategies
          //  1. CSS class .chat-item.me (some messages have it)
          //  2. data-isme="1" attribute on send-body
          //  3. Will be enhanced with senderName matching after extraction (see below)
          let isMe = item.classList.contains('me') || sendBody.getAttribute('data-isme') === '1'
          const msgType = sendBody.getAttribute('data-msgtype') || ''
          const msgId = sendBody.getAttribute('data-msgid') || ''
          const rawSendTime = sendBody.getAttribute('data-sendtime') || ''

          // Sender — always get real name (not '我')
          const senderEl = item.querySelector('.send-user')
          let senderName = senderEl?.textContent?.trim() || ''

          // Fallback 1: avatar title attribute (e.g. title="陈少斌")
          if (!senderName) {
            const avatarEl = item.querySelector('img.avatar[title]')
            senderName = avatarEl?.getAttribute('title')?.trim() || ''
          }

          // Fallback 2: any avatar (with or without [title]) — check alt, aria-label
          if (!senderName) {
            const anyAvatar = item.querySelector('img.avatar') || item.querySelector('.avatar img')
            senderName = anyAvatar?.getAttribute('title')?.trim() ||
                         anyAvatar?.getAttribute('alt')?.trim() || ''
          }

          // Fallback 3: data-name or data-sender on send-body or chat-item
          if (!senderName) {
            senderName = sendBody.getAttribute('data-name')?.trim() ||
                         sendBody.getAttribute('data-sender')?.trim() ||
                         item.getAttribute('data-name')?.trim() ||
                         item.getAttribute('data-sender')?.trim() || ''
          }

          // Content based on msgtype
          let content = ''
          let hasImage = false
          const contentEl = item.querySelector('.send-content')

          switch (msgType) {
            case '6':  content = '[图片]'; hasImage = true; break
            case '19': content = '[语音]'; break
            case '34': content = '[视频]'; break
            case '36': content = '[文件]'; break
            default:
              if (contentEl) {
                // Clone to avoid modifying DOM
                const clone = contentEl.cloneNode(true)
                // ONLY remove the UI "回复" button — be very precise!
                // Do NOT use [class*="reply"] as it would also remove reply-quote content blocks
                clone.querySelectorAll('a').forEach(el => {
                  const text = el.textContent?.trim()
                  // Only remove <a> whose sole text is "回复" (the UI reply button)
                  if (text === '回复') el.remove()
                })
                content = clone.innerText?.trim() || clone.textContent?.trim() || ''
                // Strip any remaining trailing standalone "回复" (UI artifact)
                content = content.replace(/\n?回复\s*$/, '').trim()
              }
              break
          }

          // Visible time
          const timeEl = item.querySelector('.send-time')
          const time = timeEl?.textContent?.trim() || ''

          return {
            isMe,               // preliminary; will be refined with myName matching
            senderName,         // 真实名称（即使是自己的消息也返回真实名）
            content,
            time,
            rawSendTime,        // data-sendtime 原始值
            msgId,
            hasImage
          }
        }).filter(m => m && m.content)
      })

      // Post-process: refine isMe using cached myName (senderName matching)
      const myName = this._myName
      const result = msgs.map(m => {
        // If CSS/data-isme already detected, trust it; otherwise check senderName
        const finalIsMe = m.isMe || (myName && m.senderName === myName)
        return {
          type: finalIsMe ? 'me' : 'other',
          sender: finalIsMe ? '我' : m.senderName,
          senderName: m.senderName,
          content: m.content,
          time: m.time,
          rawSendTime: m.rawSendTime,
          msgId: m.msgId,
          hasImage: m.hasImage
        }
      })

      console.log(`[YZJ-Browser] getMessages for "${chatName}": ${result.length} msgs (me=${result.filter(m => m.type === 'me').length}, other=${result.filter(m => m.type === 'other').length})`)
      return result
    } catch (err) {
      console.error('[YZJ-Browser] getMessages error:', err)
      return []
    }
  }

  // ── Send message ────────────────────────────────────────────────────────────

  async sendMessage(chatName, text) {
    const frame = await this._getImFrame()
    if (!frame) return { success: false, message: '云之家 IM 未连接' }

    try {
      const opened = await this.openChat(chatName)
      if (!opened) return { success: false, message: `未找到聊天: ${chatName}` }

      // Find the contenteditable input area
      const inputArea = frame.locator('pre.content-area[contenteditable="true"]').first()
      if (await inputArea.count() === 0) {
        return { success: false, message: '未找到输入框' }
      }

      await inputArea.click()
      await frame.waitForTimeout(200)

      // Clear and type text
      await inputArea.evaluate((el, msg) => {
        el.textContent = msg
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, text)

      await frame.waitForTimeout(300)

      // Try send button, fallback to Enter
      const sendBtn = frame.locator('.im-send-btn, .send-btn, button:has-text("发送")').first()
      if (await sendBtn.count() > 0) {
        await sendBtn.click()
      } else {
        // Yunzhijia uses Ctrl+Enter or Enter to send
        await frame.locator('pre.content-area').press('Enter')
      }

      await frame.waitForTimeout(500)
      console.log(`[YZJ-Browser] Message sent to "${chatName}": ${text.substring(0, 40)}...`)
      return { success: true, message: '消息已发送' }
    } catch (err) {
      console.error('[YZJ-Browser] sendMessage error:', err)
      return { success: false, message: `发送失败: ${err.message}` }
    }
  }

  // ── Fuzzy name matching helper ──────────────────────────────────────────────

  _nameMatch(a, b) {
    if (!a || !b) return false
    // 精确匹配
    if (a === b) return true
    // 去掉空格后匹配（云之家群名可能和用户输入有空格差异）
    const na = a.replace(/\s+/g, '')
    const nb = b.replace(/\s+/g, '')
    if (na === nb) return true
    if (na.includes(nb) || nb.includes(na)) return true
    // 原始字符串的 includes 匹配
    if (a.includes(b) || b.includes(a)) return true
    return false
  }

  // ── Check new messages (unread badges) ──────────────────────────────────────

  async checkNewMessages(sourceNames) {
    if (!this.page || !this.isLoggedIn) return []
    try {
      const chatList = await this.getChatList()
      const withUnread = chatList.filter(chat =>
        sourceNames.some(name => this._nameMatch(chat.name, name)) && chat.unread > 0
      )
      if (withUnread.length > 0) {
        console.log(`[YZJ-Browser] New messages in: ${withUnread.map(c => `${c.name}(${c.unread})`).join(', ')}`)
      }
      return withUnread
    } catch {
      return []
    }
  }

  // ── Navigate away ───────────────────────────────────────────────────────────

  async navigateAway() {
    const frame = await this._getImFrame()
    if (!frame) return

    try {
      // 优先找"文件传输助手"，否则点第一个 session item 转移焦点
      const clicked = await frame.evaluate(() => {
        const items = document.querySelectorAll('.session-item')
        if (!items.length) return false

        // 尝试找文件传输助手
        for (const item of items) {
          const nameEl = item.querySelector('.name-list') ||
                         item.querySelector('.session-item-name span') ||
                         item.querySelector('.session-item-name')
          const name = nameEl?.textContent?.trim() || ''
          if (name === '文件传输助手') {
            item.click()
            return 'helper'
          }
        }

        // 找不到则点第一个不带未读的 session item（减少对其他会话的干扰）
        for (const item of items) {
          const badge = item.querySelector('.unread-count, .unread')
          if (!badge) {
            item.click()
            return 'first'
          }
        }

        // 都有未读时点第一个
        items[0].click()
        return 'fallback'
      })

      if (clicked) {
        await frame.waitForTimeout(300)
        console.log(`[YZJ-Browser] Navigated away (${clicked})`)
      }
    } catch (err) {
      console.error('[YZJ-Browser] navigateAway error:', err.message)
    }
  }

  // ── Force refresh IM iframe ────────────────────────────────────────────────
  // 解决后台窗口 WebSocket 断连导致新消息不推送的问题

  async refreshImFrame() {
    try {
      if (!this.page) return false

      // 清缓存强制重新获取
      this.imFrame = null

      // 点击"消息"tab 强制刷新 IM 模块（先切走再切回来）
      const msgTab = this.page.locator('text=消息').first()
      if (await msgTab.count() > 0) {
        const workTab = this.page.locator('text=工作').first()
        if (await workTab.count() > 0) {
          await workTab.click()
          await this.page.waitForTimeout(800)
        }
        await msgTab.click()
        await this.page.waitForTimeout(1500)
        console.log('[YZJ-Browser] IM frame refreshed')
      }
      return true
    } catch (err) {
      console.error('[YZJ-Browser] refreshImFrame error:', err.message)
      return false
    }
  }

  // ── Close ───────────────────────────────────────────────────────────────────

  async close() {
    try {
      if (this.context) await this.context.close()
    } catch { /* ignore */ }
    this.browser = null
    this.context = null
    this.page = null
    this.imFrame = null
    this.isConnected = false
    this.isLoggedIn = false
    this._myName = null
  }
}

const yunzhijiaBrowserService = new YunzhijiaBrowserService()
export default yunzhijiaBrowserService
