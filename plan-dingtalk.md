# 钉钉接入开发计划

> 基于《飞书与钉钉接入设计方案 v2.0》+ 飞书接入经验总结
> 参考：feishu-browser.js / browser.js / yunzhijia-browser.js 模板

---

## 〇、飞书接入经验总结（避坑指南）

飞书接入中遇到的关键问题，钉钉开发时务必注意：

| # | 踩坑 | 原因 | 钉钉预防措施 |
|---|------|------|-------------|
| 1 | `VALID_PLATFORMS` 缺失 | settings.js 硬编码平台白名单，添加飞书源时 platform 回退为 wechat | **第一步就修改** settings.js，加入 `'dingtalk'` |
| 2 | 前端只有双平台按钮 | LaunchPage/DashboardPage/SettingsPage 平台切换器硬编码 | 已改为 `PLATFORM_CONFIG` 循环模式，只需加配置项 |
| 3 | Debug 端点混淆 | 用户访问了 yunzhijia debug 以为是 feishu debug | 钉钉 debug 端点注释中明确标注 URL |
| 4 | 浏览器 page=null | 飞书浏览器正常打开但 service 认为未启动 | 确保 `this.browser = true` 在 launch 成功后设置 |

---

## 一、前置步骤：钉钉网页版 DOM 调研

> **这是飞书接入中最关键的一步**——plan.md 中 80% 的内容来自实际 DOM 分析。
> 钉钉目前缺少这一步，必须先完成。

### 1.1 调研方法

1. 用 Playwright MCP 打开 `https://im.dingtalk.com/`
2. 手动扫码登录
3. 使用 `browser_snapshot` / `read_page` 工具逐层分析 DOM

### 1.2 需要确认的选择器（按优先级）

| 功能 | 需要找到的 DOM | 飞书对应选择器（参考） |
|------|--------------|---------------------|
| **会话列表容器** | 左侧聊天列表的父容器 | `div.list_items` |
| **单条会话** | 每个聊天项的可点击元素 | `[data-feed-id]` |
| **群/联系人名称** | 会话项内的名称文本 | `.a11y_feed_card_main` 内子元素 |
| **未读数** | 未读消息红点/数字 | `.ud__badge__badge__content` |
| **登录检测** | 登录页 vs 已登录的特征 | URL 含 `accounts.feishu.cn` / `.list_items` 存在 |
| **消息列表** | 聊天区域的消息元素 | `.js-message-item.message-item` |
| **发送者名称** | 消息上的发送者昵称 | `.message-info-name` |
| **消息内容** | 消息文本区域 | `.richTextContainer` |
| **自己 vs 他人** | 区分自己和他人消息的标志 | `.message-not-self` |
| **@提及** | @某人的 DOM 特征 | `span.mention[data-lark-user-id]` |
| **消息 ID** | 用于去重的唯一标识 | `element.id` |
| **系统消息** | 需要过滤的系统通知 | `.system-text-background` |
| **输入框** | 富文本编辑器 | `div[contenteditable].zone-container` |
| **发送按钮** | 发送消息的按钮 | `.send__button` |
| **iframe** | 是否有 iframe 嵌套（影响整体架构） | 飞书无 iframe，微信无 iframe，云之家有 |

### 1.3 钉钉已知信息（来自设计文档）

- **URL**: `https://im.dingtalk.com/`
- **类型**: SPA 单页应用（与飞书相同，非 iframe 模式）
- **登录**: 扫码登录，持久化 Context 保存登录态
- **可能的特殊行为**: React 虚拟列表、滚动加载

### 1.4 调研产出

完成 DOM 调研后，应生成与飞书 plan.md 一节"飞书网页版 DOM 结构摘要"相同格式的文档，包含：
- 会话列表 DOM 树结构图
- 消息区域 DOM 树结构图
- 输入框与发送 DOM 结构
- 选择器映射表（现有平台 → 钉钉）
- 选择器稳定性评估（data 属性 > 语义类名 > CSS Modules hash）

---

## 二、新增文件清单

| # | 文件路径 | 模板来源 | 预估代码量 | 说明 |
|---|----------|----------|-----------|------|
| 1 | `server/services/dingtalk-browser.js` | **feishu-browser.js** | ~200-500 行 | 钉钉 Playwright 适配器（以飞书为模板，因同为 SPA 无 iframe） |
| 2 | `server/services/dingtalk-monitor.js` | feishu-monitor.js | ~23 行 | 薄包装：import + 工作时间 08:00-22:00 |
| 3 | `server/routes/dingtalk.js` | routes/feishu.js | ~230 行 | Express 路由 + debug 诊断端点 |
| 4 | `data/browser-profile-dingtalk/` | — | 目录 | Chromium 持久化 Context |

---

## 三、现有文件修改清单

| # | 文件 | 改动内容 | 预估行数 |
|---|------|----------|---------|
| 1 | **`server/routes/settings.js`** | `VALID_PLATFORMS` 加入 `'dingtalk'`（⚠️ 飞书踩坑教训，必须第一步做） | 1 行 |
| 2 | **`server.js`** | import 钉钉路由+监控；挂载 `/api/dingtalk`；WebSocket 注册；心跳+诊断+退出 | ~15 行 |
| 3 | **`src/App.jsx`** | 新增 `dingtalkStatus` 状态；`checkAllStatus` 加钉钉轮询；`currentStatus`/`apiPrefix` 加钉钉分支；DashboardPage 传入 `dingtalkStatus` | ~15 行 |
| 4 | **`src/pages/LaunchPage.jsx`** | `PLATFORM_CONFIG` 加入 `dingtalk: { label: '钉钉', color: '#0089FF', short: 'DT' }` | 1 行 |
| 5 | **`src/pages/DashboardPage.jsx`** | `PLATFORM_CONFIG` + `statusMap` 加入 dingtalk；props 接收 `dingtalkStatus` | 3 行 |
| 6 | **`src/pages/SettingsPage.jsx`** | `PLATFORM_CONFIG` 加入 dingtalk | 1 行 |
| 7 | **`CLAUDE.md`** | 更新平台列表、目录结构、工作时间表、版本历史 | ~10 行 |

> 注：前端文件 4-6 已采用 `PLATFORM_CONFIG` + `Object.entries().map()` 循环模式，
> 只需在 config 对象中加一行即可，无需改模板结构。这是飞书开发中的架构优化成果。

---

## 四、dingtalk-browser.js 开发任务分解

> 以 feishu-browser.js 为主模板，替换 DOM 选择器。
> 所有选择器需在 DOM 调研（第一阶段）完成后确定。

### Step 1：基础框架 + launch()

- 复制 feishu-browser.js 的类结构 → `DingtalkBrowserService`
- `userDataDir` → `data/browser-profile-dingtalk/`
- `launch()` 导航至 `https://im.dingtalk.com/`
- viewport `{ width: 1400, height: 900 }`
- Chromium args 保持与飞书一致（反后台节流、反自动化检测）

### Step 2：checkLoginStatus()

- 未登录信号：待调研（可能是 URL 跳转到登录页，或存在扫码 DOM）
- 已登录信号：待调研（会话列表容器存在）
- 飞书参考：`location.hostname.includes('accounts.feishu.cn')` + `.list_items` 存在

### Step 3：getMyName()

- 从自己发的消息中提取名称（与飞书策略相同）
- 回退链：`消息名称元素` → `avatar title/alt` → null
- 缓存 `_myName`

### Step 4：getChatList()

- `page.evaluate()` 遍历会话列表元素
- 提取群名 + 未读数
- 注意虚拟滚动：只需匹配配置的 source 群，不需列出所有群

### Step 5：checkNewMessages(sourceNames)

- 与飞书完全一致：getChatList() + filter unread + _nameMatch()
- 直接复用 `_nameMatch()` 模糊匹配

### Step 6：openChat(chatName)

- Playwright locator 模式点击会话项
- 搜索回退：点击搜索入口 → 输入群名 → 点击结果
- 选择器待 DOM 调研确定

### Step 7：getMessages(chatName)

- openChat() → page.evaluate() 遍历消息元素
- 排除系统消息
- sender 回退链：`名称元素` → `avatar title/alt` → 连续消息继承
- @检测：待确定（可能是 DOM 标签或纯文本匹配）
- 消息类型检测：文本/图片/文件/表情等

### Step 8：sendMessage(chatName, text)

- openChat() → 定位输入框 → keyboard 清空+输入 → 发送
- 选择器待确定

### Step 9：navigateAway()

- 点击无未读消息的其他会话
- 备选：Escape 键

### Step 10：refreshPage() + close()

- refreshPage: `page.reload()` + 等待重新渲染
- close: `context.close()` + 重置状态

---

## 五、routes/dingtalk.js API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/dingtalk/launch` | 启动钉钉浏览器 |
| GET | `/api/dingtalk/status` | 连接/登录/监控状态 |
| GET | `/api/dingtalk/chats` | 会话列表 |
| GET | `/api/dingtalk/messages/:chatName` | 指定群消息 |
| POST | `/api/dingtalk/send` | 发送消息 |
| POST | `/api/dingtalk/monitor/start` | 启动自动监控 |
| POST | `/api/dingtalk/monitor/stop` | 停止自动监控 |
| GET | `/api/dingtalk/debug` | 诊断信息（⚠️ 注释中标注完整 URL） |
| POST | `/api/dingtalk/close` | 关闭浏览器 |

---

## 六、dingtalk-monitor.js（完整代码预览）

```javascript
import { BaseMonitorService } from './base-monitor.js'
import dingtalkBrowserService from './dingtalk-browser.js'

function isWithinWorkingHours() {
  const nowBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const hour = nowBeijing.getUTCHours()
  return hour >= 8 && hour < 22
}

const dingtalkMonitorService = new BaseMonitorService({
  browserService: dingtalkBrowserService,
  platform: 'dingtalk',
  logPrefix: 'DT-Monitor',
  isWithinWorkingHours
})

export default dingtalkMonitorService
```

---

## 七、前端改动详解

### 7.1 已有架构优势

飞书接入时，三个页面已重构为 `PLATFORM_CONFIG` + 循环模式，钉钉只需加配置项：

```javascript
// 所有三个页面的 PLATFORM_CONFIG 统一改为：
const PLATFORM_CONFIG = {
  wechat:    { label: '微信',   color: '#07C160' },
  yunzhijia: { label: '云之家', color: '#1677FF' },
  feishu:    { label: '飞书',   color: '#3370FF' },
  dingtalk:  { label: '钉钉',   color: '#0089FF' }  // 新增
}
```

### 7.2 App.jsx 需要的改动

```javascript
// 1. 新增状态
const [dingtalkStatus, setDingtalkStatus] = useState({ connected: false, loggedIn: false, monitoring: false })

// 2. 更新 currentStatus 派生
const currentStatus = platform === 'yunzhijia' ? yzjStatus
  : platform === 'feishu' ? feishuStatus
  : platform === 'dingtalk' ? dingtalkStatus
  : wechatStatus

// 3. 更新 apiPrefix 派生
const apiPrefix = platform === 'yunzhijia' ? 'yunzhijia'
  : platform === 'feishu' ? 'feishu'
  : platform === 'dingtalk' ? 'dingtalk'
  : 'wechat'

// 4. checkAllStatus 加第四个请求
const [wxRes, yzjRes, fsRes, dtRes] = await Promise.allSettled([
  fetch(`${API}/wechat/status`).then(r => r.json()),
  fetch(`${API}/yunzhijia/status`).then(r => r.json()),
  fetch(`${API}/feishu/status`).then(r => r.json()),
  fetch(`${API}/dingtalk/status`).then(r => r.json())    // 新增
])
if (dtRes.status === 'fulfilled') setDingtalkStatus(dtRes.value)

// 5. handleLaunch 加 dingtalk 分支
else if (platform === 'dingtalk') setDingtalkStatus(status)

// 6. DashboardPage props 加 dingtalkStatus
<DashboardPage dingtalkStatus={dingtalkStatus} ... />
```

### 7.3 DashboardPage 需要的改动

```javascript
// props 解构新增 dingtalkStatus
// statusMap 新增：
const statusMap = {
  wechat: wechatStatus,
  yunzhijia: yzjStatus,
  feishu: feishuStatus,
  dingtalk: dingtalkStatus   // 新增
}
```

---

## 八、server.js 改动详解

```javascript
// 新增 import
import dingtalkRoutes from './server/routes/dingtalk.js'
import dingtalkMonitorService from './server/services/dingtalk-monitor.js'

// 路由挂载
app.use('/api/dingtalk', dingtalkRoutes)

// monitor-status
dingtalk: dingtalkMonitorService.getStatus()

// debug/live
const dtDebug = dingtalkMonitorService.getDebugData()
// + 所有 diagnosis 检查循环加入 ['DingTalk', dtDebug]

// debug/events
let dEvents = dingtalkMonitorService._debugEvents

// WebSocket
dingtalkMonitorService.addWSClient(ws)

// 心跳日志
const d = dingtalkMonitorService.getStatus()
console.log(`[Heartbeat ${ts}] DT: ${formatLine(d)}`)

// 优雅退出
dingtalkMonitorService.stop()
const dtBrowser = (await import('./server/services/dingtalk-browser.js')).default
await dtBrowser.close()
```

---

## 九、实施顺序

| 阶段 | 任务 | 前置条件 | 预估工时 |
|------|------|---------|---------|
| **0** | **DOM 调研**：Playwright 打开 im.dingtalk.com，分析 DOM 结构 | 钉钉账号+扫码登录 | 1-2h |
| **0** | 生成选择器映射表 + DOM 结构摘要 | DOM 调研完成 | 30min |
| **1a** | 修改 `settings.js` VALID_PLATFORMS（⚠️ 最先做！） | 无 | 5min |
| **1b** | 创建 `data/browser-profile-dingtalk/` 目录 | 无 | 1min |
| **1c** | 编写 `dingtalk-browser.js`（核心适配器） | DOM 调研 + 选择器映射 | 2-3h |
| **1d** | 编写 `dingtalk-monitor.js` | 无 | 10min |
| **1e** | 编写 `routes/dingtalk.js`（含 debug 端点） | 无 | 30min |
| **2a** | 修改 `server.js` 挂载钉钉 | 后端文件就绪 | 20min |
| **2b** | 修改前端四个文件（App + 三页面） | 后端就绪 | 30min |
| **3** | 手动测试（启动 → 登录 → 读消息 → 发消息 → 监控） | 全部代码完成 | 1-2h |
| **4** | 更新 `CLAUDE.md` v1.3 | 测试通过 | 15min |
| **合计** | | | **6-9h** |

---

## 十、验证标准

- [ ] `POST /api/dingtalk/launch` 成功打开钉钉浏览器
- [ ] `GET /api/dingtalk/status` 返回 `{ connected: true, loggedIn: true }`
- [ ] `GET /api/dingtalk/chats` 返回含群名+未读数的列表
- [ ] `GET /api/dingtalk/messages/{群名}` 返回消息列表（含 sender/content/type）
- [ ] `POST /api/dingtalk/send` 成功发送消息
- [ ] `POST /api/dingtalk/monitor/start` 启动后能自动检测 @me 消息并回复
- [ ] `GET /api/dingtalk/debug` 显示完整诊断信息
- [ ] `GET /api/debug/live` 显示四个平台运行状态
- [ ] 前端设置页"钉钉"tab 可添加/管理消息来源
- [ ] 微信/云之家/飞书功能不受影响（回归测试）
- [ ] 消息去重正常（重启后不重复处理已回复消息）

---

## 十一、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 钉钉网页版 DOM 与预期不符 | 选择器方案需要调整 | DOM 调研阶段充分验证，优先使用 data-* 属性 |
| 钉钉有 iframe 嵌套 | 需参考云之家的 `_getImFrame()` 模式 | 调研阶段先确认是否有 iframe |
| 钉钉反自动化检测 | Playwright 可能被拦截 | 使用 stealth args + 持久化 Context |
| @检测是纯文本而非 DOM | 需回退到微信/云之家的文本匹配模式 | base-monitor 已支持文本匹配 |
| 虚拟列表影响消息读取 | 可能只能读到部分可见消息 | BaseMonitor 只需最新消息，不影响核心流程 |
| 四个 Chromium 实例资源压力 | 内存占用高 | 各平台按需启动，不用的可关闭 |

---

## 十二、与飞书接入的关键差异

| 维度 | 飞书 | 钉钉（预期） |
|------|------|-------------|
| 主模板 | 微信 browser.js（同为 SPA 无 iframe） | feishu-browser.js（最新、最完善的 SPA 模板） |
| @检测 | DOM 标签 `span.mention` | 待确认（可能是 DOM 或纯文本） |
| 连续消息 | `.message-item-first` 标记 | 待确认（类似机制） |
| 消息 ID | `element.id` | 待确认 |
| 前端改动量 | 大（从双平台重构为三平台循环） | 小（只加 PLATFORM_CONFIG 一行） |
| 钉钉颜色 | — | `#0089FF`（钉钉品牌蓝） |
