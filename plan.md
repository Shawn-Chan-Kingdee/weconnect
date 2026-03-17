# 飞书接入开发计划

> 基于 Playwright 实际打开 feishu.cn/messenger 后的 DOM 分析结果
> 参考：《飞书与钉钉接入设计方案 v2.0》、yunzhijia-browser.js / browser.js 模板

---

## 〇、微信 vs 云之家 vs 飞书 三平台对比分析

### 架构对比

| 对比维度 | 微信 (browser.js) | 云之家 (yunzhijia-browser.js) | 飞书 (feishu.cn) |
|----------|-------------------|-------------------------------|-------------------|
| 页面结构 | 单页面，直接操作 page | **iframe 嵌套**（外页面 → /im/xiaoxi/ iframe） | 单页面，直接操作 page |
| 类名稳定性 | 稳定语义类名（`.chat_item`、`.message`） | 稳定语义类名（`.session-item`、`.chat-item`） | **混合**：语义类名 + CSS Modules hash |
| 自己消息 | `.message.me` 类名 | `data-isme="1"` 属性 | `.message-not-self`（反向判断） |
| 消息 ID | 无原生 ID | `data-msgid` 属性 | `element.id`（飞书消息 ID，如 `7514210624573128705`） |
| @检测 | 纯文本匹配 `@myName` | 纯文本匹配 `@myName` | **`span.mention[data-lark-user-id]`** DOM 标签 |
| 虚拟滚动 | 无 | 无 | ✅ 会话列表虚拟滚动 |
| 输入框 | `#editArea` (contenteditable) | `pre.content-area[contenteditable]` | `div.zone-container[contenteditable]` |
| 发送方式 | `.btn_send` / Enter | `.im-send-btn` / Enter | `.send__button` / Enter |
| 用户名获取 | `.display_name` 等多选择器 | 外页面 + portal iframe + 消息区三级回退 | 需从自己发的消息中读取 |
| 代码量 | ~420 行 | ~690 行（含 iframe + debug 路由） | 预估 ~180 行 |

### 微信框架的优点（可借鉴）

1. **代码更简洁**：微信无 iframe，browser.js 只有 420 行，逻辑清晰。飞书同样无 iframe，应以**微信为主模板**而非云之家
2. **消息类型检测用外层类名**：微信用 `.message_img`、`.message_voice` 等类名判断消息类型，比云之家在内部 `data-msgtype` 属性判断更直观。飞书同样在外层有 `.text-message` 等类名，应采用此模式
3. **openChat 用 Playwright locator**：微信用 `page.locator('.chat_item').filter({ hasText: chatName })` 比云之家的 `frame.evaluate()` 遍历更简洁可读
4. **navigateAway 简单直接**：微信优先找"文件传输助手"点击，备选 Escape 键，逻辑清晰
5. **sendMessage 用 keyboard API**：微信 `page.keyboard.press('ControlOrMeta+a')` + `Backspace` 清空输入框更可靠

### 云之家框架的优点（可借鉴）

1. **sender 名称回退链完备**：`.send-user` → `avatar[title]` → `avatar[alt]` → `data-name/data-sender`，飞书也应有回退机制
2. **_nameMatch() 模糊匹配**：空格、包含关系的模糊比较，飞书直接复用
3. **refreshImFrame() 切页刷新**：云之家通过切换 tab 强制刷新 IM，飞书可简化为 `page.reload()`
4. **详细的 debug 路由**：逐步探测 DOM 状态，排查问题极为方便，飞书必须保留

### 开发策略结论

> **以微信 browser.js 为主模板**，借鉴云之家的 sender 回退链和 debug 路由，适配飞书 DOM 选择器。
>
> 理由：飞书和微信都是单页面无 iframe，架构更接近。微信代码更简洁（420 行 vs 690 行），且飞书的语义化类名（`.js-message-item`、`.message-info-name`）比微信更稳定，开发难度更低。

---

## 一、飞书网页版 DOM 结构摘要（实测确认）

### 1.1 页面特征

| 项目 | 值 |
|------|-----|
| URL | `https://{tenant}.feishu.cn/next/messenger/` |
| 技术栈 | React SPA，无 iframe |
| 类名风格 | CSS Modules 随机 hash（如 `_2b17aec6`）+ 语义化类名（如 `message-item`、`list_items`） |
| 虚拟滚动 | 会话列表使用虚拟滚动（`position: absolute; transform: translate()`），消息区不使用 |

### 1.2 会话列表（中间列）

```
div.list_items                          ← 会话列表容器
  └── div (position: absolute)          ← 虚拟滚动包装
    └── div[data-feed-id="xxx"]         ← ★ 单条会话，唯一标识
      └── div.a11y_feed_card_item[data-feed-active]
        ├── div.avatarWithBadge
        │   └── span.ud__badge
        │     ├── img.ud__avatar__image          ← 头像
        │     └── sup.ud__badge__badge           ← ★ 未读数（内含 div.ud__badge__badge__content = "25"）
        └── div.a11y_feed_card_main
          ├── div._2b17aec6                      ← ★ 群名（innerText）
          ├── span.ud__tag > div.ud__tag__content ← 标签（"机器人"/"外部"/"全员"）
          ├── span._49737e67                      ← 时间（"08:57"/"2月24日"）
          └── span._5d806a78                      ← 最新消息预览（"Nicole: 各位好…"）
```

**关键选择器：**
- 会话容器：`div.list_items`
- 单条会话：`[data-feed-id]`
- 群名：`div.a11y_feed_card_main` 内第一个文本节点（CSS hash 类不稳定，需用结构定位）
- 未读数：`sup.ud__badge__badge .ud__badge__badge__content`
- 活跃状态：`[data-feed-active="true"]`

### 1.3 消息区域（右侧）

```
div.js-message-item.message-item        ← ★ 单条消息（可用 .js-message-item 定位）
  属性:
    id="7514210624573128705"            ← 消息ID
    data-position="4"                   ← 位置序号
    data-badge-count="1"                ← badge 计数
  类名标记:
    .message-not-self                   ← ★ 非自己发的
    .message-self                       ← ★ 自己发的（推测，需验证）
    .message-item-first                 ← 该发送者连续消息中的第一条（显示头像和名字）
    .message-me-read                    ← 已读
    .text-message                       ← 文本消息
    .system-text-background             ← 系统消息（创建群组、邀请成员等）

  ├── div.message-left
  │   └── div.message-avatar
  │     └── img.ud__avatar__image       ← 头像
  ├── div.message-right
  │   ├── div.message-info
  │   │   ├── span.message-info-name    ← ★ 发送者名称（"蔡永辉（蔡永辉）"）
  │   │   └── span.message-timestamp    ← 时间戳（"2025年6月10日 14:54"）
  │   └── div.message-section
  │     └── div.message-content
  │       └── div.message-text
  │         └── div.richTextContainer   ← ★ 消息正文
  │           ├── <span>纯文本</span>
  │           └── <a class="link">链接</a>
```

**关键选择器：**
- 所有消息：`.js-message-item`
- 普通消息（非系统）：`.js-message-item.message-item`（排除 `.system-text-background`）
- 发送者名称：`.message-info-name`
- 消息内容：`.message-text .richTextContainer`
- 是否自己：`.message-not-self`（非自己）/ `.message-self`（自己）
- 消息ID：`element.id`
- @提及：`span.mention[data-lark-user-id]`（`data-lark-user-id="all"` = @所有人）
- 系统消息：`.system-text-background`

### 1.4 输入框与发送

```
div.chatEditorContainer                 ← 编辑器容器
  └── div[contenteditable="true"]       ← ★ 输入框
      class="zone-container editor-kit-container innerdocbody"

span.send__button                       ← ★ 发送按钮（.send__button--disable = 禁用态）
```

### 1.5 其他关键元素

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 搜索入口 | `div.appNavbar-search-input` | 点击后弹出搜索面板 |
| 群标题 | `div.chat-header-meta` 附近 | 当前打开的群名 |
| 登录页 | URL 包含 `accounts.feishu.cn` | 未登录时重定向 |
| 用户名 | 需通过发自己的消息后从 `.message-info-name` 读取 | 无直接个人信息入口 |

---

## 二、选择器映射表（微信 → 飞书）

> 以微信 browser.js 为模板，逐方法替换选择器

| 方法 | 微信选择器 | 飞书选择器 | 备注 |
|------|-----------|-----------|------|
| checkLoginStatus | `.qrcode` (未登录) / `.chat_item` (已登录) | URL 含 `accounts.feishu.cn` (未登录) / `.list_items` (已登录) | 飞书用 URL 判断更可靠 |
| getMyName | `.display_name`、`.message.me .avatar[title]` | `.js-message-item:not(.message-not-self) .message-info-name` | 从自己消息中提取 |
| getChatList | `.chat_item` → `.nickname_text` + `.web_wechat_reddot_middle` | `[data-feed-id]` → `.a11y_feed_card_main` 内文本 + `.ud__badge__badge__content` | 飞书有虚拟滚动但不影响 |
| openChat | `page.locator('.chat_item').filter({hasText})` | `page.locator('[data-feed-id]').filter({hasText})` | 同为 Playwright locator 模式 |
| getMessages | `.message` → `.nickname` + `.plain` + `.message.me` | `.js-message-item.message-item` → `.message-info-name` + `.richTextContainer` + `.message-not-self` | 飞书有消息 ID `element.id` |
| 消息类型 | `.message_img`/`.message_voice`/`.message_app` | `.text-message`/`.image-message`/`.file-message`（需验证） | 飞书类名更语义化 |
| @检测 | 文本匹配 `content.includes('@' + myName)` | `span.mention[data-lark-user-id]` DOM 标签 | 飞书更可靠 |
| sendMessage | `#editArea` + `.btn_send` / Enter | `div[contenteditable].zone-container` + `.send__button` / Enter | 相同模式 |
| navigateAway | `.chat_item` 文件传输助手 / Escape | `[data-feed-id]` 无未读的第一个 / Escape | 逻辑相同 |

---

## 三、新增文件清单

| # | 文件路径 | 模板来源 | 代码量 | 说明 |
|---|----------|----------|--------|------|
| 1 | `server/services/feishu-browser.js` | **browser.js（微信）** | ~180 行 | 复制微信模板，替换选择器映射表中的选择器；加入云之家的 sender 回退链 |
| 2 | `server/services/feishu-monitor.js` | yunzhijia-monitor.js | ~20 行 | 只改 import 和工作时间 |
| 3 | `server/routes/feishu.js` | routes/yunzhijia.js | ~80 行 | 只改 import 和中文提示 |

---

## 四、现有文件修改

| 文件 | 改动 | 行数 |
|------|------|------|
| `server.js` | import 飞书路由+监控；挂载 `/api/feishu`；WebSocket 注册；心跳+诊断+退出 | ~15 行 |
| `CLAUDE.md` | 更新平台列表、目录结构、工作时间表 | ~5 行 |

---

## 五、feishu-browser.js 开发任务分解

> 以微信 browser.js 为模板逐方法改写，总体比云之家更简单（无 iframe）

### Step 1：基础框架 + launch()
- **复制微信 browser.js 的类结构**（BrowserService 类 → FeishuBrowserService 类）
- 删除微信特有变量，保留：`browser`、`context`、`page`、`isConnected`、`isLoggedIn`、`_myName`
- `userDataDir` 改为 `data/browser-profile-feishu/`
- `launch()` 导航至 `https://www.feishu.cn/messenger/`
- viewport 改为 `{ width: 1400, height: 900 }`（飞书三栏布局需更宽）

### Step 2：checkLoginStatus()
- 直接复制微信的简洁模式（page.evaluate 判断 DOM）
- 未登录信号：`location.hostname.includes('accounts.feishu.cn')` 或存在登录二维码
- 已登录信号：`.list_items` 容器存在（会话列表已渲染）
- **比微信更简单**：飞书未登录时 URL 直接跳转，无需检查 QR 码可见性

### Step 3：getMyName()
- 策略A（首选）：查找非 `.message-not-self` 的 `.js-message-item` 中的 `.message-info-name`
- 策略B：页面 evaluate 查找左上角头像/个人信息区（需进一步实测）
- 策略C（从微信借鉴）：查找 `.message-self`（如果飞书有此类名）的 avatar 或 name
- 缓存 `_myName`，首次获取后复用

### Step 4：getChatList()
- **借鉴微信模式**：`page.evaluate()` 遍历 `[data-feed-id]` 元素
- 群名提取：`el.querySelector('.a11y_feed_card_main')` → 找第一个包含实际文本的子元素
- 未读数：`el.querySelector('.ud__badge__badge__content')?.textContent` → `parseInt()` 或 0
- 虚拟滚动不影响：BaseMonitor 只关心配置的 source 群是否有未读，不需要列出所有群

### Step 5：checkNewMessages(sourceNames)
- 直接复制微信的实现（getChatList + filter）
- **从云之家借鉴 `_nameMatch()`**：加入模糊匹配（去空格、包含关系）

### Step 6：openChat(chatName)
- **用微信的 Playwright locator 模式**（更简洁）：
  ```js
  page.locator('[data-feed-id]').filter({ hasText: chatName }).first().click()
  ```
- 搜索回退：点击 `div.appNavbar-search-input` 触发搜索 → 输入群名 → 点击结果

### Step 7：getMessages(chatName)
- 调用 `openChat()` 后 `page.evaluate()` 遍历 `.js-message-item.message-item`
- **排除系统消息**：过滤掉 `.system-text-background`
- 发送者（**从云之家借鉴回退链**）：
  1. `.message-info-name`（首选）
  2. `.message-avatar img` 的 title/alt 属性
  3. 连续消息继承上一条 sender（`.message-item-first` 才有名字）
- 内容：`.message-text .richTextContainer` → `innerText`
- isMe：**`!el.classList.contains('message-not-self')`**
- **飞书特有优势**：消息自带 `element.id` 作为唯一标识，可用于更精确的去重

### Step 8：sendMessage(chatName, text)
- **复制微信模式**：openChat → 定位 `[contenteditable="true"].zone-container` → keyboard 清空+输入
- 发送：`.send__button` click 或 Enter

### Step 9：navigateAway()
- **复制微信的"文件传输助手"优先策略**
- 飞书备选：点击第一个无 `.ud__badge__badge` 的 `[data-feed-id]` 元素
- 终极备选：Escape 键

### Step 10：refreshPage() + close()
- `refreshPage`：直接 `page.reload()`（微信模式，比云之家的 tab 切换更简单）
- `close`：`context.close()` + 重置所有状态（与微信完全一致）

---

## 六、feishu-monitor.js（完整代码）

```javascript
import { BaseMonitorService } from './base-monitor.js'
import feishuBrowserService from './feishu-browser.js'

function isWithinWorkingHours() {
  const nowBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const hour = nowBeijing.getUTCHours()
  return hour >= 8 && hour < 22
}

const feishuMonitorService = new BaseMonitorService({
  browserService: feishuBrowserService,
  platform: 'feishu',
  logPrefix: 'Feishu-Monitor',
  isWithinWorkingHours
})

export default feishuMonitorService
```

---

## 七、routes/feishu.js API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/feishu/launch` | 启动飞书浏览器 |
| GET | `/api/feishu/status` | 连接/登录/监控状态 |
| GET | `/api/feishu/chats` | 会话列表 |
| GET | `/api/feishu/messages/:chatName` | 指定群消息 |
| POST | `/api/feishu/send` | 发送消息 |
| POST | `/api/feishu/monitor/start` | 启动监控 |
| POST | `/api/feishu/monitor/stop` | 停止监控 |
| GET | `/api/feishu/debug` | 诊断信息 |
| POST | `/api/feishu/close` | 关闭浏览器 |

---

## 八、server.js 改动

```javascript
// 新增 import（在现有 import 之后）
import feishuRoutes from './server/routes/feishu.js'
import feishuMonitorService from './server/services/feishu-monitor.js'

// 新增路由挂载（在 yunzhijia 之后）
app.use('/api/feishu', feishuRoutes)

// WebSocket 注册（wss.on('connection') 回调内新增）
feishuMonitorService.addWSClient(ws)

// /api/monitor-status 新增
feishu: feishuMonitorService.getStatus()

// /api/debug/live 新增
const fsDebug = feishuMonitorService.getDebugData()
// + 加入 diagnosis issues 检查

// /api/debug/events 新增
const fEvents = feishuMonitorService._debugEvents

// 心跳日志新增 Feishu 行

// SIGINT 新增
feishuMonitorService.stop()
const feishuBrowser = (await import('./server/services/feishu-browser.js')).default
await feishuBrowser.close()
```

---

## 九、开发注意事项

### 选择器优先级（稳定性排序）
1. **data 属性**（最稳定）：`data-feed-id`、`data-feed-active`、`data-position`、`data-lark-user-id`
2. **语义化类名**（稳定）：`js-message-item`、`message-item`、`message-info-name`、`list_items`、`message-not-self`
3. **组件库类名**（较稳定）：`ud__badge__badge__content`、`ud__avatar__image`、`a11y_feed_card_main`
4. **CSS Modules hash**（不可靠，禁用）：`_2b17aec6`、`_49737e67` 等

### 飞书相对微信/云之家的简化
- 无 iframe → 省去 `_getImFrame()` 及所有 frame 相关代码（-100 行）
- 消息有原生 ID（`element.id`）→ 可用于更精确去重
- @提及有 DOM 标签 → 比纯文本匹配更可靠，可区分 @个人 vs @所有人
- 消息自身类名判断（`.message-not-self`）→ 比 `data-isme` 属性更直接

### 需注意的飞书特殊行为
1. **虚拟滚动的会话列表**：`list_items` 内只渲染可见项（`position: absolute`），监控只需关注可见范围内的未读群即可
2. **连续消息省略发送者**：同一发送者连续消息只有第一条（`.message-item-first`）显示名字，后续消息需继承上一条的 `senderName`
3. **富文本编辑器**：飞书用 Lark Editor（非简单 contenteditable），发送消息可能需要先 focus 再用 keyboard API 输入
4. **登录后 URL 变化**：`feishu.cn/messenger/` → `{tenant}.feishu.cn/next/messenger/`，checkLoginStatus 需兼容
5. **所有浏览器操作用 `withTimeout()` 包装**：超时 15000ms

---

## 十、实施顺序

| 阶段 | 任务 | 预估 |
|------|------|------|
| 1 | 编写 `feishu-browser.js`（Step 1-9） | 2-3h |
| 2 | 编写 `feishu-monitor.js` + `routes/feishu.js` | 30min |
| 3 | 修改 `server.js` 挂载飞书 | 15min |
| 4 | 手动测试（启动 → 登录 → 读消息 → 发消息 → 监控） | 1-2h |
| 5 | 更新 `CLAUDE.md` | 10min |
| **合计** | | **4-6h** |

---

## 十一、验证标准

- [ ] `POST /api/feishu/launch` 成功打开飞书浏览器
- [ ] `GET /api/feishu/status` 返回 `{ connected: true, loggedIn: true }`
- [ ] `GET /api/feishu/chats` 返回含群名+未读数的列表
- [ ] `GET /api/feishu/messages/{群名}` 返回消息列表（含 sender/content/type）
- [ ] `POST /api/feishu/send` 成功发送消息
- [ ] `POST /api/feishu/monitor/start` 启动后能自动检测 @me 消息并回复
- [ ] `GET /api/debug/live` 显示飞书平台运行状态
- [ ] 微信/云之家功能不受影响
