/**
 * Playwright Browser Service
 * Manages the WeChat Web browser instance and page interactions
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
    this.userDataDir = path.join(__dirname, '..', '..', 'data', 'browser-profile')
  }

  async launch() {
    if (this.browser) {
      return { success: true, message: '浏览器已在运行' }
    }

    try {
      // Use persistent context to preserve login session
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 800 },
        locale: 'zh-CN',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox'
        ]
      })

      this.page = this.context.pages()[0] || await this.context.newPage()
      await this.page.goto('https://wx.qq.com', { waitUntil: 'domcontentloaded', timeout: 30000 })

      this.isConnected = true
      this.browser = true // marker

      return { success: true, message: '微信网页版已启动，请扫码登录' }
    } catch (err) {
      console.error('Browser launch error:', err)
      return { success: false, message: `启动失败: ${err.message}` }
    }
  }

  async checkLoginStatus() {
    if (!this.page) return { loggedIn: false }
    try {
      // Check if chat list is visible (indicates logged in)
      const chatList = await this.page.$('.chat_item')
      const loginQR = await this.page.$('.qrcode')
      this.isLoggedIn = !!chatList && !loginQR
      return { loggedIn: this.isLoggedIn }
    } catch {
      return { loggedIn: false }
    }
  }

  async getChatList() {
    if (!this.page || !this.isLoggedIn) return []
    try {
      return await this.page.evaluate(() => {
        const items = document.querySelectorAll('.chat_item')
        return Array.from(items).map(item => {
          const nameEl = item.querySelector('h3')
          const timeEl = item.querySelector('.attr')
          const previewEl = item.querySelector('.msg_content') || item.querySelector('p:last-child')
          const unreadEl = item.querySelector('.web_wechat_reddot_middle')
          return {
            name: nameEl?.textContent?.trim() || '',
            time: timeEl?.textContent?.trim() || '',
            preview: previewEl?.textContent?.trim() || '',
            unread: unreadEl ? parseInt(unreadEl.textContent) || 0 : 0
          }
        })
      })
    } catch (err) {
      console.error('getChatList error:', err)
      return []
    }
  }

  async openChat(chatName) {
    if (!this.page) return false
    try {
      // Click on chat item by name
      const chatItem = await this.page.locator('.chat_item').filter({ hasText: chatName }).first()
      if (await chatItem.count() > 0) {
        await chatItem.click()
        await this.page.waitForTimeout(500)
        return true
      }

      // If not in visible list, search for it
      const searchBox = await this.page.$('input[placeholder="搜索"]')
      if (searchBox) {
        await searchBox.click()
        await searchBox.fill(chatName)
        await this.page.waitForTimeout(1000)
        const result = await this.page.locator('.search_list .contact_item').filter({ hasText: chatName }).first()
        if (await result.count() > 0) {
          await result.click()
          await this.page.waitForTimeout(500)
          return true
        }
      }
      return false
    } catch (err) {
      console.error('openChat error:', err)
      return false
    }
  }

  async getMessages(chatName) {
    if (!this.page) return []
    try {
      const opened = await this.openChat(chatName)
      if (!opened) return []

      return await this.page.evaluate(() => {
        const msgs = document.querySelectorAll('.message')
        return Array.from(msgs).map(msg => {
          const isMe = msg.classList.contains('me')
          const isSystem = msg.classList.contains('message_system')
          const nickEl = msg.querySelector('.nickname')
          const contentEl = msg.querySelector('.plain') || msg.querySelector('.bubble')
          const timeEl = msg.querySelector('.message_system .content')
          const imgEl = msg.querySelector('.msg_img') || msg.querySelector('.bubble img')

          return {
            type: isSystem ? 'system' : (isMe ? 'me' : 'other'),
            sender: isMe ? '我' : (nickEl?.textContent?.trim() || ''),
            content: contentEl?.textContent?.trim() || (imgEl ? '[图片]' : ''),
            time: timeEl?.textContent?.trim() || '',
            hasImage: !!imgEl
          }
        })
      })
    } catch (err) {
      console.error('getMessages error:', err)
      return []
    }
  }

  async sendMessage(chatName, text) {
    if (!this.page) return { success: false, message: '浏览器未连接' }
    try {
      const opened = await this.openChat(chatName)
      if (!opened) return { success: false, message: `未找到聊天: ${chatName}` }

      // Focus edit area and type message
      const editArea = await this.page.$('#editArea')
      if (!editArea) return { success: false, message: '未找到输入框' }

      await editArea.click()
      await this.page.waitForTimeout(200)

      // Clear existing content and type new message
      await this.page.keyboard.press('Meta+a')
      await this.page.keyboard.press('Backspace')
      await editArea.evaluate((el, msg) => {
        el.textContent = msg
        // Trigger input event for Angular
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, text)

      await this.page.waitForTimeout(200)

      // Click send button
      const sendBtn = await this.page.$('.btn_send')
      if (sendBtn) {
        await sendBtn.click()
      } else {
        await this.page.keyboard.press('Enter')
      }

      await this.page.waitForTimeout(500)
      return { success: true, message: '消息已发送' }
    } catch (err) {
      console.error('sendMessage error:', err)
      return { success: false, message: `发送失败: ${err.message}` }
    }
  }

  async checkNewMessages(sourceNames) {
    if (!this.page || !this.isLoggedIn) return []
    try {
      const chatList = await this.getChatList()
      return chatList.filter(chat =>
        sourceNames.includes(chat.name) && chat.unread > 0
      )
    } catch {
      return []
    }
  }

  async close() {
    try {
      if (this.context) {
        await this.context.close()
      }
    } catch { /* ignore */ }
    this.browser = null
    this.context = null
    this.page = null
    this.isConnected = false
    this.isLoggedIn = false
  }
}

// Singleton
const browserService = new BrowserService()
export default browserService
