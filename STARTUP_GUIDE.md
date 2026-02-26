# 🚀 WeConnect 启动指南

## 环境准备

### 1. 安装依赖
```bash
cd weconnect
npm run setup
```
这会同时安装 npm 包和下载 Playwright Chromium 浏览器。

### 2. 启动服务

#### 开发模式（推荐调试）
```bash
npm run dev
```
- 前端运行在 `http://localhost:5173`
- 后端运行在 `http://localhost:3210`
- 后端支持热更新

#### 生产模式
```bash
npm run build
npm start
```
- 完整应用运行在 `http://localhost:3210`

---

## 核心流程验证

### Step 1：启动微信网页版
1. 打开应用，点击"启动微信"按钮
2. 扫码登录微信网页版（wx.qq.com）
3. 检查日志输出 `[Browser]` 相关日志

**关键文件**：`server/services/browser.js`

### Step 2：配置消息来源 & AI 模型
1. 进入"消息来源 & Skill"标签
2. 创建新消息来源（群聊/个人）
3. 配置回复语气、态度、分类关键词、回复模板
4. 切换到"AI 模型配置"标签，选择 Claude/GLM/Qwen/Deepseek 等
5. 填入 API Key 并测试连接

**关键文件**：
- `server/services/ai.js` - AI 模型调用
- `server/routes/models.js` - 模型 API
- `server/routes/settings.js` - 来源配置 API

### Step 3：启动监控和查看仪表盘
1. 进入仪表盘，点击"开始监控"按钮
2. 监控服务每 5 秒轮询一次微信
3. 当有新消息时：
   - 使用 AI 自动分类（日常沟通 / 业务咨询 / 事项跟进 / 新事项登记）
   - 根据分类策略生成回复
   - 自动发送回复到微信
   - 创建待办事项（如果需要）
   - 记录消息和回复到数据库
   - 实时推送到前端显示

**关键文件**：
- `server/services/monitor.js` - 消息监控与处理
- `server/services/lifecycle.js` - 启动迁移和 10 天清理

---

## 核心改进点验证

### ✅ 1. AI 驱动的消息分类
**代码位置**：`server/services/ai.js` 的 `classifyMessage()` 方法
```javascript
// 优先使用 AI 分类，失败回退到关键词
const category = await aiService.classifyMessage(msg.content, skill)
```
- 输出应显示：`[AI] Classified as "业务咨询": message preview...`

### ✅ 2. 差异化回复策略
**代码位置**：`server/services/ai.js` 的 `CATEGORY_STRATEGIES`
- 日常沟通：20-60字，轻松自然
- 业务咨询：50-150字，专业清晰
- 事项跟进：40-120字，给出时间节点
- 新事项登记：30-100字，确认收到并给出安排

**验证**：查看生成的回复长度和风格是否符合分类

### ✅ 3. 结构化待办生成
**代码位置**：`server/services/monitor.js` 和 `server/services/ai.js`
- AI 返回 JSON：`{ reply: "...", todoSummary: "..." }`
- 待办摘要由 AI 生成，而非简单截断消息
- 日志显示：`[Monitor] AI reply for xxx [业务咨询]: ...`

### ✅ 4. 启动迁移和数据清理
**代码位置**：`server/services/lifecycle.js`
- 服务器启动时自动运行
- 日志显示：`[Lifecycle] Running startup tasks...`
- 将前一天的未完成待办标记为 `isHistorical`
- 清除 10 天前的消息和已完成待办

**验证步骤**：
```bash
# 查看日志
tail -f node.log

# 检查待办 API 返回格式
curl http://localhost:3210/api/todos/dashboard
```

---

## 数据库结构

### messages.json
```json
{
  "id": "uuid",
  "sourceName": "群聊名称",
  "sender": "发送者",
  "senderTime": "ISO时间",
  "senderContent": "消息内容（前100字）",
  "senderContentFull": "完整消息内容",
  "replyContent": "回复内容（前100字）",
  "replyContentFull": "完整回复内容",
  "category": "业务咨询",
  "hasTodo": true,
  "processed": true,
  "date": "2026-02-26"
}
```

### todos.json
```json
{
  "id": "uuid",
  "sourceName": "群聊名称",
  "messageId": "关联的消息ID",
  "content": "AI 生成的待办摘要",
  "category": "事项跟进",
  "completed": false,
  "isHistorical": false,
  "date": "2026-02-26",
  "originalDate": "前一天的日期（如果已迁移）",
  "completedAt": null
}
```

---

## 调试技巧

### 1. 查看完整日志
```bash
npm run dev 2>&1 | tee server.log
```

### 2. 测试 AI 调用
```bash
# 直接测试分类
curl -X POST http://localhost:3210/api/messages/classify \
  -H "Content-Type: application/json" \
  -d '{
    "content": "我们的新项目什么时候能上线？",
    "skillKeywords": {}
  }'
```

### 3. 检查数据目录
```bash
# 查看生成的数据文件
ls -la data/
cat data/messages.json | jq '.' | head -100
```

### 4. WebSocket 实时监听
```javascript
// 在浏览器控制台
const ws = new WebSocket('ws://localhost:3210/ws')
ws.onmessage = (e) => console.log('WS:', JSON.parse(e.data))
```

---

## 常见问题排查

### Q: "连接 AI 模型失败" 的日志
**原因**：API Key 未配置或无效
**解决**：
1. 检查 Models 设置是否激活了某个模型
2. 确认 API Key 正确（不包括多余空格）
3. 点击"测试连接"按钮验证

### Q: 消息未被自动分类或回复
**原因**：监控未启动或自动回复被禁用
**解决**：
1. 检查仪表盘"开始监控"按钮状态
2. 检查消息来源的"自动回复"开关
3. 查看浏览器控制台的 WebSocket 连接状态

### Q: 待办事项未生成
**原因**：该消息分类不属于"需要待办"的类别
**解决**：
- 只有"事项跟进"和"新事项登记"默认生成待办
- "日常沟通"和"业务咨询"不生成待办（除非 AI 输出了 `todoSummary`）

### Q: 启动后找不到日期选择器或消息
**原因**：前端构建失败或 API 连接问题
**解决**：
1. 检查后端是否正确启动：`curl http://localhost:3210/api/health`
2. 在浏览器开发工具的 Network 标签查看 API 响应
3. 查看浏览器控制台的 JavaScript 错误

---

## 文件清单

已完成的文件：
- ✅ `server/services/ai.js` - AI 服务（分类、策略、调用）
- ✅ `server/services/monitor.js` - 消息监控（整合 AI 分类和策略）
- ✅ `server/services/lifecycle.js` - 生命周期（新创建）
- ✅ `server.js` - 服务器入口（已更新调用 lifecycle）
- ✅ `server/routes/todos.js` - 待办路由（已适配 isHistorical）
- ✅ 所有前端组件和 CSS（原始实现）

所有代码已通过语法检查：`node --check`

---

## 下一步

1. **在您的机器上运行项目**
   ```bash
   npm run setup
   npm run dev
   ```

2. **访问应用**
   - 开发模式：http://localhost:5173
   - 后端 API：http://localhost:3210/api

3. **扫码登录微信**

4. **配置消息来源和 AI 模型**

5. **启动监控并发送测试消息**

祝您使用愉快！ 🎉
