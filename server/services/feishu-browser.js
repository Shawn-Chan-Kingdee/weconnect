/**
 * Feishu (飞书) Playwright Browser Service
 * Manages the Feishu Web Messenger browser instance and page interactions
 *
 * Based on WeChat browser.js template (single-page, no iframe)
 * with Yunzhijia sender fallback chain
 *
 * Key Feishu DOM traits:
 * - Chat list: div.list_items > [data-feed-id] (virtual scrolling)
 * - Messages: .js-message-item.message-item with element.id as msg ID
 * - Self detection: .message-not-self (inverted) / absence = self
 * - @mention: span.mention[data-lark-user-id] (DOM tag, not plain text)
 * - Input: div[contenteditable].zone-container
 * - Send: span.send__button
 */
import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class FeishuBrowserService {
  constructor() {
    this.browser = null
    this.context = null
    this.page = null
    this.isConnected = false
    this.isLoggedIn = false
    this._myName = null      // cached display name of logged-in user
    this.userDataDir = path.join(__dirname, '..', '..', 'data', 'browser-profile-feishu')
  }

  async launch() {
    if (this.browser) {
      return { success: true, message: '飞书浏览器已在运行' }
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
      await this.page.goto('https://www.feishu.cn/messenger/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })

      this.isConnected = true
      this.browser = true

      return { success: true, message: '飞书网页版已启动，请扫码登录' }
    } catch (err) {
      console.error('[Feishu] Launch error:', err)
      return { success: false, message: `启动失败: ${err.message}` }
    }
  }

  async checkLoginStatus() {
    if (!this.page) return { loggedIn: false }
    try {
      const result = await this.page.evaluate(() => {
        // Not logged in: URL redirects to accounts.feishu.cn
        if (location.hostname.includes('accounts.feishu.cn') ||
            location.hostname.includes('accounts.larksuite.com')) {
          return { loggedIn: false }
        }

        // Logged in: chat list container exists
        const chatList = document.querySelector('.list_items') ||
                         document.querySelector('[data-feed-id]')
        return { loggedIn: !!chatList }
      })
      this.isLoggedIn = result.loggedIn
      return result
    } catch {
      return { loggedIn: false }
    }
  }

  // ── Detect my display name ──────────────────────────────────────────────────

  async getMyName() {
    if (this._myName) return this._myName
    if (!this.page) return null

    try {
      const name = await this.page.evaluate(() => {
        // Method 1: Find messages sent by self (NOT .message-not-self)
        // Only .message-item-first has the sender name displayed
        const selfMessages = document.querySelectorAll(
          '.js-message-item.message-item:not(.message-not-self).message-item-first'
        )
        for (const msg of selfMessages) {
          const nameEl = msg.querySelector('.message-info-name')
          if (nameEl?.textContent?.trim()) return nameEl.textContent.trim()
        }

        // Method 2: Broader search — any self message with name
        const allSelf = document.querySelectorAll(
          '.js-message-item.message-item:not(.message-not-self)'
        )
        for (const msg of allSelf) {
          const nameEl = msg.querySelector('.message-info-name')
          if (nameEl?.textContent?.trim()) return nameEl.textContent.trim()
        }

        // Method 3: Check avatar title/alt of self messages
        for (const msg of allSelf) {
          const avatarEl = msg.querySelector('.message-avatar img')
          const title = avatarEl?.getAttribute('title') || avatarEl?.getAttribute('alt')
          if (title?.trim()) return title.trim()
        }

        return null
      }).catch(() => null)

      if (name) {
        this._myName = name
        console.log(`[Feishu] My name detected: "${name}"`)
        return name
      }

      console.warn('[Feishu] Could not detect my name')
      return null
    } catch (err) {
      console.error('[Feishu] getMyName error:', err.message)
      return null
    }
  }

  async getChatList() {
    if (!this.page || !this.isLoggedIn) return []
    try {
      const list = await this.page.evaluate(() => {
        const items = document.querySelectorAll('[data-feed-id]')
        const results = []
        items.forEach(item => {
          // ── Chat name: find in a11y_feed_card_main ──────────────────
          const mainEl = item.querySelector('.a11y_feed_card_main') ||
                         item.querySelector('[class*="feed_card_main"]')

          let name = ''
          if (mainEl) {
            // The first meaningful text child is the group/chat name
            // Skip tags like "机器人"/"外部" which are inside ud__tag
            const children = mainEl.children
            for (const child of children) {
              if (child.classList.contains('ud__tag') ||
                  child.querySelector('.ud__tag')) continue
              const text = child.textContent?.trim()
              if (text && text.length > 0 && text.length < 100) {
                name = text
                break
              }
            }
          }

          // Fallback: use title attribute or aria-label
          if (!name) {
            name = item.getAttribute('title')?.trim() ||
                   item.getAttribute('aria-label')?.trim() || ''
          }

          // ── Unread count ─────────────────────────────────────────────
          const unreadEl = item.querySelector('.ud__badge__badge__content') ||
                           item.querySelector('.ud__badge__badge')
          const unreadRaw = unreadEl?.textContent?.trim() || '0'
          const unread = parseInt(unreadRaw) || (unreadEl ? 1 : 0)

          if (name) results.push({ name, unread })
        })
        return results
      })

      console.log(`[Feishu] getChatList: found ${list.length} chats, ${list.filter(c => c.unread > 0).length} with unread`)
      if (list.length > 0) {
        console.log(`[Feishu] Chat names: ${list.slice(0, 5).map(c => c.name).join(', ')}`)
      }
      return list
    } catch (err) {
      console.error('[Feishu] getChatList error:', err)
      return []
    }
  }

  async openChat(chatName) {
    if (!this.page) return false
    try {
      // Try exact match first via Playwright locator
      const chatItem = this.page.locator('[data-feed-id]').filter({ hasText: chatName }).first()
      if (await chatItem.count() > 0) {
        await chatItem.click()
        await this.page.waitForTimeout(800)
        console.log(`[Feishu] Opened chat (exact): ${chatName}`)
        return true
      }

      // Search fallback: click search input, type name, click result
      const searchTrigger = this.page.locator('.appNavbar-search-input, [class*="search-input"], [class*="search_input"]').first()
      if (await searchTrigger.count() > 0) {
        await searchTrigger.click()
        await this.page.waitForTimeout(500)

        // Type into the search input that appears
        await this.page.keyboard.type(chatName, { delay: 50 })
        await this.page.waitForTimeout(1500)

        // Look for search result matching the chat name
        const result = this.page.locator('[class*="search"] [class*="item"], [class*="search"] [class*="result"]')
          .filter({ hasText: chatName }).first()
        if (await result.count() > 0) {
          await result.click()
          await this.page.waitForTimeout(800)
          console.log(`[Feishu] Opened chat (search): ${chatName}`)
          return true
        }

        // Clear search
        await this.page.keyboard.press('Escape')
        await this.page.waitForTimeout(300)
      }

      console.warn(`[Feishu] Chat not found: "${chatName}"`)
      return false
    } catch (err) {
      console.error('[Feishu] openChat error:', err)
      return false
    }
  }

  async getMessages(chatName) {
    if (!this.page) return []
    try {
      const opened = await this.openChat(chatName)
      if (!opened) return []

      // Wait for messages to render
      await this.page.waitForTimeout(600)

      const msgs = await this.page.evaluate(() => {
        const items = document.querySelectorAll('.js-message-item.message-item')
        let lastSender = ''

        return Array.from(items).map(msg => {
          // Skip system messages
          if (msg.classList.contains('system-text-background')) return null

          const isMe = !msg.classList.contains('message-not-self')
          const msgId = msg.id || ''

          // ── Sender name (with fallback chain) ───────────────────────
          let senderName = ''

          // 1. Primary: .message-info-name (only on .message-item-first)
          const nameEl = msg.querySelector('.message-info-name')
          if (nameEl?.textContent?.trim()) {
            senderName = nameEl.textContent.trim()
          }

          // 2. Fallback: avatar title/alt
          if (!senderName) {
            const avatarEl = msg.querySelector('.message-avatar img') ||
                             msg.querySelector('.message-avatar')
            senderName = avatarEl?.getAttribute('title')?.trim() ||
                         avatarEl?.getAttribute('alt')?.trim() || ''
          }

          // 3. Fallback: inherit from previous message (consecutive messages)
          if (!senderName && !msg.classList.contains('message-item-first')) {
            senderName = lastSender
          }

          if (senderName) lastSender = senderName

          const sender = isMe ? '我' : senderName

          // ── Content extraction ────────────────────────────────────────
          let content = ''
          let hasImage = false

          // Check message type by class
          if (msg.classList.contains('image-message') ||
              msg.querySelector('.message-image, .image-content')) {
            content = '[图片]'
            hasImage = true
          } else if (msg.classList.contains('file-message') ||
                     msg.querySelector('.file-content, [class*="file_message"]')) {
            const fileNameEl = msg.querySelector('[class*="file_name"], [class*="fileName"]')
            content = fileNameEl?.textContent?.trim()
              ? `[文件] ${fileNameEl.textContent.trim()}`
              : '[文件]'
          } else if (msg.classList.contains('sticker-message') ||
                     msg.querySelector('.sticker-content')) {
            content = '[表情]'
          } else if (msg.classList.contains('video-message') ||
                     msg.querySelector('.video-content')) {
            content = '[视频]'
          } else if (msg.classList.contains('audio-message') ||
                     msg.querySelector('.audio-content')) {
            content = '[语音]'
          } else if (msg.querySelector('.card-message, [class*="card_message"]')) {
            const titleEl = msg.querySelector('[class*="card_title"], [class*="cardTitle"]')
            content = titleEl?.textContent?.trim()
              ? `[卡片] ${titleEl.textContent.trim()}`
              : '[卡片消息]'
          } else {
            // Text message: extract from richTextContainer
            const richText = msg.querySelector('.richTextContainer') ||
                             msg.querySelector('.message-text') ||
                             msg.querySelector('.message-content')
            if (richText) {
              content = richText.innerText?.trim() || richText.textContent?.trim() || ''
            }
          }

          // ── @mention detection (Feishu DOM-based) ────────────────────
          const mentions = msg.querySelectorAll('span.mention[data-lark-user-id]')
          const mentionIds = Array.from(mentions).map(m => m.getAttribute('data-lark-user-id'))
          const mentionTexts = Array.from(mentions).map(m => m.textContent?.trim() || '')

          return {
            type: isMe ? 'me' : 'other',
            sender,
            senderName,
            content,
            hasImage,
            msgId,
            mentions: mentionIds,      // ['all', 'userId123', ...]
            mentionTexts              // ['@所有人', '@张三', ...]
          }
        }).filter(m => m && m.content) // skip nulls (system) and empty
      })

      console.log(`[Feishu] getMessages for "${chatName}": ${msgs.length} messages, ${msgs.filter(m => m.type === 'other').length} from others`)
      return msgs
    } catch (err) {
      console.error('[Feishu] getMessages error:', err)
      return []
    }
  }

  async sendMessage(chatName, text) {
    if (!this.page) return { success: false, message: '浏览器未连接' }
    try {
      const opened = await this.openChat(chatName)
      if (!opened) return { success: false, message: `未找到聊天: ${chatName}` }

      // Locate the contenteditable input
      const editArea = await this.page.$('div[contenteditable="true"].zone-container') ||
                       await this.page.$('div[contenteditable="true"].editor-kit-container') ||
                       await this.page.$('.chatEditorContainer div[contenteditable="true"]')
      if (!editArea) return { success: false, message: '未找到输入框' }

      await editArea.click()
      await this.page.waitForTimeout(200)

      // Clear existing content and type new message
      await this.page.keyboard.press('ControlOrMeta+a')
      await this.page.keyboard.press('Backspace')
      await this.page.waitForTimeout(100)

      // Use keyboard.type for Lark Editor compatibility
      await this.page.keyboard.type(text, { delay: 10 })
      await this.page.waitForTimeout(300)

      // Click send button or press Enter
      const sendBtn = await this.page.$('.send__button:not(.send__button--disable)') ||
                      await this.page.$('span.send__button')
      if (sendBtn) {
        await sendBtn.click()
      } else {
        await this.page.keyboard.press('Enter')
      }

      await this.page.waitForTimeout(500)
      console.log(`[Feishu] Message sent to "${chatName}": ${text.substring(0, 40)}...`)
      return { success: true, message: '消息已发送' }
    } catch (err) {
      console.error('[Feishu] sendMessage error:', err)
      return { success: false, message: `发送失败: ${err.message}` }
    }
  }

  async checkNewMessages(sourceNames) {
    if (!this.page || !this.isLoggedIn) return []
    try {
      const chatList = await this.getChatList()
      const withUnread = chatList.filter(chat =>
        sourceNames.some(name => this._nameMatch(chat.name, name)) && chat.unread > 0
      )
      if (withUnread.length > 0) {
        console.log(`[Feishu] New messages in: ${withUnread.map(c => `${c.name}(${c.unread})`).join(', ')}`)
      }
      return withUnread
    } catch {
      return []
    }
  }

  /**
   * Fuzzy name matching (borrowed from Yunzhijia)
   * Handles spaces, contains relationships, bracket differences
   */
  _nameMatch(a, b) {
    if (!a || !b) return false
    const na = a.replace(/\s+/g, '')
    const nb = b.replace(/\s+/g, '')
    return na === nb || na.includes(nb) || nb.includes(na)
  }

  /**
   * Navigate away from the current chat so future messages show unread badges
   */
  async navigateAway() {
    if (!this.page) return
    try {
      // Strategy 1: Click on a chat without unread messages
      const safeChat = await this.page.evaluate(() => {
        const items = document.querySelectorAll('[data-feed-id]')
        for (const item of items) {
          const badge = item.querySelector('.ud__badge__badge__content')
          if (!badge || !badge.textContent?.trim()) {
            return item.getAttribute('data-feed-id')
          }
        }
        return null
      })

      if (safeChat) {
        await this.page.locator(`[data-feed-id="${safeChat}"]`).click()
        await this.page.waitForTimeout(300)
        console.log('[Feishu] Navigated away to safe chat')
        return
      }

      // Strategy 2: Press Escape
      await this.page.keyboard.press('Escape')
      await this.page.waitForTimeout(200)
      console.log('[Feishu] Navigated away via Escape')
    } catch (err) {
      console.error('[Feishu] navigateAway error:', err.message)
    }
  }

  /**
   * 刷新页面，重新建立连接
   */
  async refreshPage() {
    if (!this.page) return false
    try {
      console.log('[Feishu] Refreshing page...')
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
      await this.page.waitForTimeout(3000) // 等待 React 重新渲染
      this._myName = null
      console.log('[Feishu] Page refreshed successfully')
      return true
    } catch (err) {
      console.error('[Feishu] refreshPage error:', err.message)
      return false
    }
  }

  async close() {
    try {
      if (this.context) await this.context.close()
    } catch { /* ignore */ }
    this.browser = null
    this.context = null
    this.page = null
    this.isConnected = false
    this.isLoggedIn = false
    this._myName = null
  }
}

const feishuBrowserService = new FeishuBrowserService()
export default feishuBrowserService
