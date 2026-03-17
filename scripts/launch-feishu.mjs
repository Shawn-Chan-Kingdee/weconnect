/**
 * 临时脚本：用 Playwright 打开飞书网页版
 * 用于调研 DOM 结构、确认登录流程
 *
 * 使用方法: node scripts/launch-feishu.mjs
 */
import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const userDataDir = path.join(__dirname, '..', 'data', 'browser-profile-feishu')

console.log('[Feishu] 正在启动浏览器...')
console.log('[Feishu] 用户数据目录:', userDataDir)

const context = await chromium.launchPersistentContext(userDataDir, {
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

const page = context.pages()[0] || await context.newPage()

console.log('[Feishu] 正在导航至飞书 Messenger...')
await page.goto('https://www.feishu.cn/messenger/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000
})

console.log('[Feishu] ✅ 飞书已打开')
console.log('[Feishu] 当前 URL:', page.url())
console.log('[Feishu] 如果需要登录，请在浏览器窗口中完成扫码')
console.log('[Feishu] 登录状态会自动保存到 browser-profile-feishu/')
console.log('[Feishu] 按 Ctrl+C 关闭浏览器')

// 保持浏览器打开，等待用户操作
process.on('SIGINT', async () => {
  console.log('\n[Feishu] 正在关闭...')
  await context.close()
  process.exit(0)
})

// 每 10 秒输出页面状态
setInterval(async () => {
  try {
    const url = page.url()
    const title = await page.title()
    console.log(`[Feishu] 页面状态: ${title} | ${url}`)
  } catch (e) {
    console.log('[Feishu] 页面已关闭或不可访问')
  }
}, 10000)
