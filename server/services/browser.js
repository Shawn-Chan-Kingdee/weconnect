/**
 * Playwright Browser Service
 * Manages the WeChat Web browser instance and page interactions
 *
 * Bug fixes:
 * - getChatList: use multiple selector fallbacks for chat name (h3 is wrong on wx.qq.com)
 * - getMessages: more robust content extraction and type detection
 * - checkLoginStatus: more robust check
 * - Added detailed [Browser] debug logging
 */
import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class BrowserService {
  constructor() {
    this.browser = null
    this.context = null
    this.page = null
    this.isConnected = false
    this.isLoggedIn = false
    this._myName = null      // cached display name of logged-in user
    this.userDataDir = path.join(__dirname, '..', '..', 'data', 'browser-profile')
  }

  async launch() {
    if (this.browser) {
      return { success: true, message: '浏览器已在运行' }
    }

    try {
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 800 },
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
      await this.page.goto('https://wx.qq.com', { waitUntil: 'domcontentloaded', timeout: 30000 })

      this.isConnected = true
      this.browser = true

      return { success: true, message: '微信网页版已启动，请扫码登录' }
    } catch (err) {
      console.error('[Browser] Launch error:', err)
      return { success: false, message: `启动失败: ${err.message}` }
    }
  }

  async checkLoginStatus() {
    if (!this.page) return { loggedIn: false }
    try {
      const result = await this.page.evaluate(() => {
        // Check for QR code (not logged in)
        const qr = document.querySelector('.qrcode') || document.querySelector('#qrcode')
        if (qr && qr.offsetParent !== null) return { loggedIn: false }

        // Check for chat list (logged in)
        const chatList = document.querySelector('.chat_item') ||
                         document.querySelector('#chatArea') ||
                         document.querySelector('.conversations')
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
        // Method 1: WeChat Web header displays the logged-in user nickname
        const sels = [
          '.display_name', '.nickname .display_name',
          '.header .name', '.avatar .nickname'
        ]
        for (const sel of sels) {
          const el = document.querySelector(sel)
          if (el?.textContent?.trim()) return el.textContent.trim()
        }

        // Method 2: scan messages for type='me' and grab avatar title/alt
        const meMessages = document.querySelectorAll('.message.me')
        for (const msg of meMessages) {
          const avatarEl = msg.querySelector('.avatar img, .avatar')
          const title = avatarEl?.getAttribute('title') || avatarEl?.getAttribute('alt')
          if (title?.trim()) return title.trim()
        }

        // Method 3: check if there's a profile/settings area
        const profileEl = document.querySelector('.account .nickname, .info .nickname')
        if (profileEl?.textContent?.trim()) return profileEl.textContent.trim()

        return null
      }).catch(() => null)

      if (name) {
        this._myName = name
        console.log(`[Browser] My name detected: "${name}"`)
        return name
      }

      console.warn('[Browser] Could not detect my name')
      return null
    } catch (err) {
      console.error('[Browser] getMyName error:', err.message)
      return null
    }
  }

  async getChatList() {
    if (!this.page || !this.isLoggedIn) return []
    try {
      const list = await this.page.evaluate(() => {
        const items = document.querySelectorAll('.chat_item')
        const results = []
        items.forEach(item => {
          // ── Try multiple selectors for the chat name ──────────────────
          // WeChat Web uses different class names across versions
          const nameEl =
            item.querySelector('.nickname_text') ||   // most common
            item.querySelector('.nickname') ||
            item.querySelector('h3') ||
            item.querySelector('.contact_name') ||
            item.querySelector('.nick_name') ||
            item.querySelector('[title]')             // some elements carry title attr

          let name = nameEl?.textContent?.trim() || nameEl?.getAttribute('title')?.trim() || ''

          // ── Unread count ─────────────────────────────────────────────
          const unreadEl =
            item.querySelector('.web_wechat_reddot_middle') ||
            item.querySelector('.unread-count') ||
            item.querySelector('.badge')

          const unreadRaw = unreadEl?.textContent?.trim() || '0'
          const unread = parseInt(unreadRaw) || (unreadEl ? 1 : 0) // if badge exists but no number, assume 1

          if (name) results.push({ name, unread })
        })
        return results
      })

      console.log(`[Browser] getChatList: found ${list.length} chats, ${list.filter(c => c.unread > 0).length} with unread`)
      if (list.length > 0) {
        console.log(`[Browser] Chat names: ${list.slice(0, 5).map(c => c.name).join(', ')}`)
      }
      return list
    } catch (err) {
      console.error('[Browser] getChatList error:', err)
      return []
    }
  }

  async openChat(chatName) {
    if (!this.page) return false
    try {
      // Try exact match first
      let chatItem = this.page.locator('.chat_item').filter({ hasText: chatName }).first()
      if (await chatItem.count() > 0) {
        await chatItem.click()
        await this.page.waitForTimeout(600)
        console.log(`[Browser] Opened chat (exact): ${chatName}`)
        return true
      }

      // Try search box fallback
      const searchBox = this.page.locator('input[placeholder="搜索"]').first()
      if (await searchBox.count() > 0) {
        await searchBox.click()
        await searchBox.fill(chatName)
        await this.page.waitForTimeout(1200)

        const result = this.page.locator('.search_list .contact_item, .search-list .chat_item').filter({ hasText: chatName }).first()
        if (await result.count() > 0) {
          await result.click()
          await this.page.waitForTimeout(600)
          console.log(`[Browser] Opened chat (search): ${chatName}`)
          return true
        }

        // Clear search
        await searchBox.fill('')
        await this.page.keyboard.press('Escape')
      }

      console.warn(`[Browser] Chat not found: "${chatName}"`)
      return false
    } catch (err) {
      console.error('[Browser] openChat error:', err)
      return false
    }
  }

  async getMessages(chatName) {
    if (!this.page) return []
    try {
      const opened = await this.openChat(chatName)
      if (!opened) return []

      // Wait a moment for messages to load
      await this.page.waitForTimeout(500)

      const msgs = await this.page.evaluate(() => {
        const items = document.querySelectorAll('.message')
        return Array.from(items).map(msg => {
          const isMe = msg.classList.contains('me')
          const isSystem = msg.classList.contains('message_system') || msg.classList.contains('system')

          // ── Sender name ───────────────────────────────────────────────
          const nickEl = msg.querySelector('.nickname') || msg.querySelector('.alias')
          let senderName = nickEl?.textContent?.trim() || ''

          // Fallback: avatar title/alt
          if (!senderName) {
            const avatarEl = msg.querySelector('.avatar img') || msg.querySelector('.avatar')
            senderName = avatarEl?.getAttribute('title')?.trim() ||
                         avatarEl?.getAttribute('alt')?.trim() || ''
          }

          const sender = isMe ? '我' : senderName

          // ── Determine message type by outer class first ───────────────
          // WeChat marks message type on the outer .message element itself:
          //   .message_img → image, .message_voice → audio, .message_video → video
          //   .message_app → shared link/file,  plain text has no such class
          const isImgMsg   = msg.classList.contains('message_img')
          const isVoiceMsg = msg.classList.contains('message_voice')
          const isVideoMsg = msg.classList.contains('message_video')
          const isAppMsg   = msg.classList.contains('message_app')

          // ── Content extraction ────────────────────────────────────────
          let content = ''
          let hasImage = false

          if (isImgMsg) {
            // Real image message — do NOT use .bubble img (would also match emoji)
            content = '[图片]'
            hasImage = true
          } else if (isVoiceMsg) {
            content = '[语音]'
          } else if (isVideoMsg) {
            content = '[视频]'
          } else if (isAppMsg) {
            // Shared link / mini-program / file
            const titleEl = msg.querySelector('.title') || msg.querySelector('.appmsg_title')
            const descEl  = msg.querySelector('.desc')  || msg.querySelector('.appmsg_desc')
            content = titleEl?.innerText?.trim()
              ? `[链接] ${titleEl.innerText.trim()}${descEl ? ': ' + descEl.innerText.trim() : ''}`
              : '[链接/文件]'
          } else {
            // Text message — .plain holds the text; emoji inside it are <img> tags
            // innerText will correctly skip <img> nodes (they have no alt text in WeChat)
            const plainEl = msg.querySelector('.plain')
            if (plainEl) {
              content = plainEl.innerText?.trim() || plainEl.textContent?.trim() || ''
            } else {
              // Fallback for other bubble layouts
              const bubbleEl =
                msg.querySelector('.bubble .content') ||
                msg.querySelector('.bubble')
              content = bubbleEl?.innerText?.trim() || ''
            }
          }

          return {
            type: isSystem ? 'system' : (isMe ? 'me' : 'other'),
            sender,
            senderName,       // real name even for 'me' messages
            content,
            hasImage
          }
        }).filter(m => m.type !== 'system' && m.content) // skip system msgs and empty
      })

      console.log(`[Browser] getMessages for "${chatName}": ${msgs.length} messages, ${msgs.filter(m => m.type === 'other').length} from others`)
      return msgs
    } catch (err) {
      console.error('[Browser] getMessages error:', err)
      return []
    }
  }

  async sendMessage(chatName, text) {
    if (!this.page) return { success: false, message: '浏览器未连接' }
    try {
      const opened = await this.openChat(chatName)
      if (!opened) return { success: false, message: `未找到聊天: ${chatName}` }

      const editArea = await this.page.$('#editArea')
      if (!editArea) return { success: false, message: '未找到输入框' }

      await editArea.click()
      await this.page.waitForTimeout(200)

      // Clear and type
      await this.page.keyboard.press('ControlOrMeta+a')
      await this.page.keyboard.press('Backspace')
      await editArea.evaluate((el, msg) => {
        el.textContent = msg
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, text)

      await this.page.waitForTimeout(300)

      const sendBtn = await this.page.$('.btn_send')
      if (sendBtn) {
        await sendBtn.click()
      } else {
        await this.page.keyboard.press('Enter')
      }

      await this.page.waitForTimeout(500)
      console.log(`[Browser] Message sent to "${chatName}": ${text.substring(0, 40)}...`)
      return { success: true, message: '消息已发送' }
    } catch (err) {
      console.error('[Browser] sendMessage error:', err)
      return { success: false, message: `发送失败: ${err.message}` }
    }
  }

  async checkNewMessages(sourceNames) {
    if (!this.page || !this.isLoggedIn) return []
    try {
      const chatList = await this.getChatList()
      const withUnread = chatList.filter(chat =>
        sourceNames.some(name =>
          chat.name === name ||
          chat.name.includes(name) ||
          name.includes(chat.name)
        ) && chat.unread > 0
      )
      if (withUnread.length > 0) {
        console.log(`[Browser] New messages in: ${withUnread.map(c => `${c.name}(${c.unread})`).join(', ')}`)
      }
      return withUnread
    } catch {
      return []
    }
  }

  /**
   * Navigate away from the current chat so that future incoming messages
   * will show the unread badge. Without this, WeChat Web auto-reads
   * messages in the currently-viewed chat.
   */
  async navigateAway() {
    if (!this.page) return
    try {
      // Strategy 1: Click on "文件传输助手" (File Transfer) — always exists, safe
      const fileHelper = this.page.locator('.chat_item').filter({ hasText: '文件传输助手' }).first()
      if (await fileHelper.count() > 0) {
        await fileHelper.click()
        await this.page.waitForTimeout(300)
        console.log('[Browser] Navigated away to 文件传输助手')
        return
      }

      // Strategy 2: Press Escape to close/deselect current chat
      await this.page.keyboard.press('Escape')
      await this.page.waitForTimeout(200)
      console.log('[Browser] Navigated away via Escape')
    } catch (err) {
      console.error('[Browser] navigateAway error:', err.message)
    }
  }

  /**
   * 刷新页面，重新建立 WebSocket 连接
   * 解决后台窗口 WebSocket 断连导致 DOM 不再更新的问题
   */
  async refreshPage() {
    if (!this.page) return false
    try {
      console.log('[Browser] Refreshing page to re-establish WebSocket...')
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
      await this.page.waitForTimeout(2000) // 等待 WebSocket 重连
      // 清除 myName 缓存，下次重新检测
      this._myName = null
      console.log('[Browser] Page refreshed successfully')
      return true
    } catch (err) {
      console.error('[Browser] refreshPage error:', err.message)
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

const browserService = new BrowserService()
export default browserService
