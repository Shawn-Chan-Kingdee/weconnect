# CLAUDE.md — WeConnect / IM 工具消息监控与回复系统

> 给 Claude 的项目说明。每次开始新任务时先读本文件，不要重复发现已知问题。

---

## 项目定位

**IM 工具消息监控与回复系统**（代号 WeConnect）：本地运行的 IM 多平台群聊监控 + AI 自动回复工具。

- 当前支持平台：**微信网页版**（wx.qq.com）、**云之家**（yunzhijia.com）、**飞书**（feishu.cn）
- 核心流程：群聊 @me → 收集 sender 上下文 → 调用 AI → 发送回复 → 保存待办

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite，端口 5173（dev）|
| 后端 | Node.js (ESM) + Express，端口 3000 |
| 数据库 | JSON 文件（data/ 目录），lowdb 风格手写 |
| 自动化 | Playwright Chromium，持久化 Context |
| 实时推送 | WebSocket（ws 库） |

---

## 目录结构（关键文件）

```
server/
  server.js                      # Express 入口，挂载所有路由
  db.js                          # sourcesDB / messagesDB / todosDB
  services/
    base-monitor.js              # ★ 核心：三平台共用监控基类
    monitor.js                   # 微信 monitor 包装（工作时间 09-21 北京）
    yunzhijia-monitor.js         # 云之家 monitor 包装（工作时间 07-22 北京）
    feishu-monitor.js            # 飞书 monitor 包装（工作时间 08-22 北京）
    browser.js                   # 微信 Playwright 适配器
    yunzhijia-browser.js         # 云之家 Playwright 适配器
    feishu-browser.js            # 飞书 Playwright 适配器（单页面，无 iframe）
    ai.js                        # AI 调用统一层（OpenAI 兼容）
    lifecycle.js                 # 定时清理（10天保留期）
  routes/
    wechat.js                    # /api/wechat/* 路由（启动/停止/状态）
    yunzhijia.js                 # /api/yunzhijia/* 路由
    feishu.js                    # /api/feishu/* 路由
    messages.js                  # /api/messages/*
    todos.js                     # /api/todos/*
    models.js                    # /api/models/*
    settings.js                  # /api/settings/*
src/                             # React 前端
data/
  sources.json                   # 监控群配置（含 Skill）
  messages.json                  # 消息记录
  todos.json                     # 待办事项
  models.json                    # AI 模型配置（含 API Key，勿提交 git）
  settings.json                  # 全局配置
  browser-profile-wechat/        # 微信登录持久化
  browser-profile-yunzhijia/     # 云之家登录持久化
  browser-profile-feishu/        # 飞书登录持久化
```

---

## base-monitor.js — 核心行为规范

### 常量
```js
DEDUP_LEN = 80          // dedupKey = 消息前 80 字符
FAST_MIN/MAX = 2030/10870 ms
FULL_MIN/MAX = 36360/100690 ms
BROWSER_OP_TIMEOUT = 15000 ms   // 所有浏览器操作超时
STALE_THRESHOLD = 8             // 连续 N 次全扫描无新消息 → 刷新页面
DEBUG_RING_SIZE = 200           // 诊断事件环形缓冲
```

### 扫描流程（_scanSource 顺序，不可随意调换）
1. `checkLoginStatus()` — 登录检测
2. `getMyName()` — **必须在快照之前**，首次即缓存 myName
3. 快照（仅首次）— **只快照 DB 中 `processed:true` 的消息**，未处理消息不快照
4. `checkNewMessages()` / `getChatMessages()` — 读取消息
5. 去重：`_snapshotKeys` (内存) + `messagesDB.findOne({dedupKey, processed:true})` (DB)
6. AI 调用（含 30s 超时保护）
7. 发送回复前 **strip self-@**：`replyText.replace(@myName, '')`
8. `navigateAway()` — 每次扫描后必须离开聊天窗口（保证下次有未读红点）

### 关键约束
- **快照只记录 DB confirmed 消息**：不要改回"快照所有可见消息"，否则重启后会漏处理未回复消息
- **getMyName 在快照前**：不要移到快照后，否则首次扫描 myName=null，无法识别 @me
- **navigateAway 必须调用**：每次读完消息后必须调用，否则后续消息不产生未读红点
- **per-sender 并行 + try/catch 隔离**：单个 sender 异常不影响其他 sender

---

## 工作时间（北京时间 UTC+8）

| 平台 | 工作时段 | 实现位置 |
|------|---------|---------|
| 微信 | 09:00–21:00 | `monitor.js` → `isWithinWorkingHours()` |
| 云之家 | 07:00–22:00 | `yunzhijia-monitor.js` → `isWithinWorkingHours()` |
| 飞书 | 08:00–22:00 | `feishu-monitor.js` → `isWithinWorkingHours()` |

工作时段外：监控继续运行，但不调用 AI、不发送回复。

---

## 诊断接口

```
GET /api/debug/live    # 当前运行状态（fastPolls, messagesProcessed, myNameDetected, timings...）
GET /api/debug/events  # 最近 200 条诊断事件
```

排查"消息没有被处理"时优先看这两个接口：
- `myNameDetected: null` → 重启服务，等待首次全量扫描
- `messagesProcessed: 0` → 检查 /events 中的 Snapshot 日志

---

## AI 输出格式

AI 必须返回 JSON（base-monitor 强制解析）：
```json
{"reply": "回复内容", "category": "消息记录|待办事项", "todoSummary": "跟进事项（可选）"}
```
todoSummary 有值时自动创建待办，并触发 Webhook（如配置）。

---

## 数据模型

### Source（sources.json）
```js
{ id, name, platform: 'wechat'|'yunzhijia'|'feishu', skill: { autoReply, replyTo, prompt, glossary, webhook } }
```

### Message（messages.json）
```js
{ id, sourceName, sender, content, dedupKey, aiReply, category, processed, createdAt }
```

### Todo（todos.json）
```js
{ id, sourceName, sender, summary, messageId, completed, isHistory, createdAt }
```

---

## 重要开发约定

1. **ESM only**：所有文件用 `import/export`，不用 `require()`
2. **浏览器操作必须用 `withTimeout`**：防止 Playwright 卡死挂起整个轮询
3. **sender 名称回退链**：
   - 微信：`nickEl.textContent` → `avatar[title]` → `avatar[alt]`
   - 云之家：`.name` → `avatar[title]/[alt]` → `data-name/data-sender`
   - 飞书：`.message-info-name` → `avatar[title]/[alt]` → 继承上条 sender（连续消息）
4. **不要在 conversationContext / fullMessage 里 strip @**：只在发送前对 `replyText` strip
5. **browser-profile 不提交 git**：`.gitignore` 已排除 `data/`

---

## 版本历史摘要

| 版本 | 要点 |
|------|------|
| v1.2 | 飞书支持（单页面 Playwright 适配器）；三平台统一诊断；sender 回退链增加连续消息继承 |
| v1.1 | 云之家支持；快照改为 DB-verified；myName 移至快照前；自身 @ strip；工作时间延至 21:00 |
| v1.05 | 36h 上下文汇总；待办合并更新；二次 AI 调用生成待办摘要；Webhook 同步 |
| v1.0 | 微信监控基础版 |

---

## 操作手册

完整用户操作手册（含双平台使用说明）：
`IM工具消息监控与回复系统 操作手册 v1.1.docx`
