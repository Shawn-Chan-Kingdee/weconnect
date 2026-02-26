# WeConnect 增强改进总结

## 📋 完成情况

所有 5 项核心改进已完成并通过语法检查。

---

## 1️⃣ 增强 AI 分类功能

**文件**：`server/services/ai.js`

### 改进内容
- ✅ 新增 `classifyMessage()` 方法，支持 AI 驱动的消息分类
- ✅ 分类优先级：AI > 关键词匹配
- ✅ 分类失败自动回退到关键词匹配

### 关键代码
```javascript
async classifyMessage(content, skill) {
  // 优先 AI 分类
  const result = await this._callModel(model, systemPrompt, userMessage)
  if (['日常沟通', '业务咨询', '事项跟进', '新事项登记'].includes(trimmed)) {
    return trimmed
  }
  // 回退到关键词
  return this._keywordClassify(content, skill)
}
```

---

## 2️⃣ 差异化回复策略

**文件**：`server/services/ai.js`

### 改进内容
- ✅ 定义 4 种消息类别的回复策略常数 `CATEGORY_STRATEGIES`
- ✅ 每种类别有独立的：
  - 回复风格描述
  - 字数限制
  - 关键指引
  - 是否生成待办标志

### 策略定义
| 类别 | 字数 | 风格 | 生成待办 |
|------|------|------|---------|
| 日常沟通 | 20-60 | 轻松自然 | ❌ |
| 业务咨询 | 50-150 | 专业清晰 | ❌ |
| 事项跟进 | 40-120 | 负责明确 | ✅ |
| 新事项登记 | 30-100 | 积极回应 | ✅ |

### 关键代码
```javascript
const CATEGORY_STRATEGIES = {
  '日常沟通': {
    description: '日常闲聊、问候、简短交流',
    shouldCreateTodo: false,
    replyStyle: '轻松自然、简短有礼',
    guidelines: [...]
  },
  '事项跟进': {
    description: '之前事项的进度询问、确认、催促',
    shouldCreateTodo: true,
    replyStyle: '负责明确、给出时间节点',
    guidelines: [...]
  },
  // ...
}
```

---

## 3️⃣ 结构化待办生成

**文件**：`server/services/monitor.js` + `server/services/ai.js`

### 改进内容
- ✅ AI 返回结构化 JSON：`{ text, todoSummary }`
- ✅ `todoSummary` 由 AI 根据消息内容智能生成（而非简单截断）
- ✅ 监控服务识别 `todoSummary` 并创建待办

### 流程
```
新消息 → AI 分类 → AI 生成回复+待办摘要 → 保存待办
                ↓
          {"reply": "...", "todoSummary": "确认XX项目进度"}
```

### 数据库结构
```javascript
// todos 集合新增字段
{
  id: "uuid",
  sourceName: "群名",
  messageId: "关联消息ID",
  content: "AI 生成的待办摘要", // 智能摘要，非简单截断
  category: "事项跟进",
  completed: false,
  isHistorical: false,
  date: "2026-02-26",
  originalDate: "2026-02-25" // 迁移后保留原始日期
}
```

---

## 4️⃣ 启动迁移和 10 天清理

**文件**：`server/services/lifecycle.js`（新创建）

### 改进内容
- ✅ 新增生命周期服务，在服务器启动时自动执行
- ✅ `migratePendingTodos()`：将昨天及之前的未完成待办标记为 `isHistorical`
- ✅ `purgeOldRecords()`：删除 10 天前的消息和已完成待办

### 启动流程
```
服务器启动
    ↓
runStartupTasks()
    ├─ migratePendingTodos()
    │  └─ 找出所有 date < today 且 completed=false 的待办
    │     标记 isHistorical=true，保留 originalDate
    │
    └─ purgeOldRecords()
       ├─ 删除 10 天前的消息
       └─ 删除 10 天前的已完成待办
           （未完成的待办保留，可能是重要事项）
```

### 关键代码
```javascript
function migratePendingTodos() {
  const today = new Date().toISOString().split('T')[0]
  for (const todo of allTodos) {
    if (todo.date < today && !todo.completed && !todo.isHistorical) {
      todosDB.update(todo.id, {
        isHistorical: true,
        originalDate: todo.originalDate || todo.date
      })
    }
  }
}

function purgeOldRecords() {
  const cutoffDate = daysAgo(10)
  // 删除 10 天前的消息
  // 删除 10 天前的已完成待办（不删除未完成的）
}
```

---

## 5️⃣ 消息监控整合

**文件**：`server/services/monitor.js`（重写）

### 改进内容
- ✅ 使用 AI 分类替代纯关键词分类
- ✅ 传入最近 10 条消息作为上下文
- ✅ AI 根据分类策略生成差异化回复
- ✅ 从 AI 返回的 `todoSummary` 创建待办

### 监控流程
```
轮询微信（每 5 秒）
    ↓
检查登录状态 → 获取消息来源 → 查找有新消息的聊天
    ↓
_processNewMessages() 对每条新消息：
    1. AI 分类 (with 关键词回退)
       category = await aiService.classifyMessage()

    2. 获取上下文 (最近 10 条消息)
       recentMessages = messages.slice(-10)

    3. AI 生成回复 (with 差异化策略)
       result = await aiService.generateReply({
         message, sender, category, recentMessages
       })
       // 返回: { text, todoSummary }

    4. 发送回复到微信
       browserService.sendMessage()

    5. 记录消息到数据库
       messagesDB.insert(record)

    6. 创建待办 (如果 AI 返回了 todoSummary)
       if (result.todoSummary) {
         todosDB.insert({...})
       }

    7. 推送到前端 (via WebSocket)
       this.broadcast('new_message', record)
```

### 优先级回退
1. **优先**：AI 模型生成 (with 分类特定策略)
2. **次选**：MCP 外部服务
3. **最后**：回复模板

---

## 📊 API 更新

### `/api/todos/dashboard`
返回格式更新：
```json
{
  "todayNew": [
    {
      "id": "uuid",
      "content": "AI 生成的待办摘要",
      "category": "新事项登记",
      "completed": false,
      "isHistorical": false,
      "date": "2026-02-26"
    }
  ],
  "historicalPending": [
    {
      "id": "uuid",
      "content": "...",
      "category": "事项跟进",
      "completed": false,
      "isHistorical": true,
      "date": "2026-02-25",
      "originalDate": "2026-02-25"
    }
  ],
  "today": "2026-02-26"
}
```

---

## 🔧 技术细节

### 文件修改清单
| 文件 | 操作 | 更改行数 |
|------|------|---------|
| `server/services/ai.js` | 完全重写 | ~380 → ~380 |
| `server/services/monitor.js` | 完全重写 | ~274 → ~230 |
| `server/services/lifecycle.js` | **新建** | - |
| `server.js` | 修改 | +2 行 (import + call) |
| `server/routes/todos.js` | 修改 | +15 行 (isHistorical 支持) |

### 语法检查结果
```bash
✅ ai.js - OK
✅ monitor.js - OK
✅ lifecycle.js - OK
✅ server.js - OK
✅ todos.js - OK
```

---

## 🎯 验证清单

在您的机器上启动项目后，可以用以下方式验证：

### 1. AI 分类验证
- [ ] 发送"我需要报价单"的消息 → 应分类为"业务咨询"
- [ ] 发送"项目进度怎么样了" → 应分类为"事项跟进"
- [ ] 发送"帮我创建新项目" → 应分类为"新事项登记"
- [ ] 发送"你好，最近怎么样" → 应分类为"日常沟通"

### 2. 差异化回复验证
- [ ] "业务咨询"的回复长度应在 50-150 字
- [ ] "日常沟通"的回复长度应在 20-60 字
- [ ] "事项跟进"的回复应包含明确的时间承诺

### 3. 待办生成验证
- [ ] "事项跟进"和"新事项登记"应生成待办
- [ ] "日常沟通"和"业务咨询"不应生成待办（除非 AI 输出）
- [ ] 待办内容应是智能摘要，非简单截断

### 4. 启动迁移验证
- [ ] 手动添加昨天日期的未完成待办
- [ ] 重启服务器
- [ ] 检查该待办的 `isHistorical` 应为 `true`
- [ ] 检查服务器日志：`[Lifecycle] Migrated X pending todo(s) to historical.`

### 5. 10 天清理验证
- [ ] 手动添加 11 天前日期的消息（通过直接修改 JSON）
- [ ] 重启服务器
- [ ] 检查该消息已被删除
- [ ] 检查服务器日志：`[Lifecycle] Purged X message(s)...`

---

## 📝 日志示例

启动后，您应该看到类似的日志：

```
✓ 服务器启动
[Lifecycle] Running startup tasks...
[Lifecycle] Migrated 3 pending todo(s) to historical.
[Lifecycle] Purged 2 message(s) and 1 completed todo(s) older than 10 days.
[Lifecycle] Startup tasks completed.

✓ 监控开始
[Monitor] Started monitoring...

✓ 新消息处理示例
[AI] Classified as "事项跟进": "项目进度..."
[Monitor] AI reply for xxx [事项跟进]: "好的，我确认..."
```

---

## 🎉 总结

✅ 所有 5 项核心改进完成
✅ 代码通过语法检查
✅ 遵循所有用户要求的原则
✅ 文件和 API 兼容性保持

请在您的机器上运行项目进行人工测试！
