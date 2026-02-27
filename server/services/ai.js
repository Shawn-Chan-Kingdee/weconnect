/**
 * AI Model Service (Simplified)
 * - Uses skill.prompt directly as the system context
 * - No category classification, no strategy templates
 * - Returns { text, todoSummary } — AI can optionally return JSON
 */
import { modelsDB, settingsDB } from '../db.js'

class AIService {
  /**
   * Get the currently active model config
   */
  getActiveModel() {
    const config = settingsDB.findById('app-config')
    if (config?.activeModelId) {
      const model = modelsDB.findById(config.activeModelId)
      if (model && model.apiKey) return model
    }
    const all = modelsDB.findAll()
    return all.find(m => m.apiKey) || null
  }

  /**
   * Generate a reply using the skill prompt + active AI model
   * @param {Object} params - { message, sender, sourceName, skill, recentMessages, senderHistory, senderTodos }
   * @returns {{ text: string, todoSummary: string|null }}
   */
  async generateReply({ message, sender, sourceName, skill, recentMessages, senderHistory = [], senderTodos = [] }) {
    const model = this.getActiveModel()
    if (!model || !model.apiKey) {
      console.warn('[AI] No active model configured with API key')
      return { text: '', todoSummary: null }
    }

    const systemPrompt = this._buildSystemPrompt(skill, sourceName)
    const userMessage = this._buildUserMessage({ message, sender, recentMessages, senderHistory, senderTodos })

    console.log(`[AI] Calling ${model.name} (${model.model}) for "${sourceName}"`)

    try {
      const raw = await this._callModel(model, systemPrompt, userMessage)
      if (!raw) return { text: '', todoSummary: null }

      // Try to parse as JSON (AI can optionally return structured response)
      try {
        const parsed = JSON.parse(raw)
        if (parsed.reply) {
          return {
            text: parsed.reply.trim(),
            todoSummary: parsed.todoSummary || null
          }
        }
      } catch { /* not JSON, use as plain text */ }

      return { text: raw.trim(), todoSummary: null }
    } catch (err) {
      console.error(`[AI] generateReply failed (${model.provider}/${model.model}):`, err.message)
      return { text: '', todoSummary: null }
    }
  }

  /**
   * Test a model connection
   */
  async testModel(modelId) {
    const model = modelsDB.findById(modelId)
    if (!model) return { success: false, message: '模型配置不存在' }
    if (!model.apiKey) return { success: false, message: 'API Key 未配置' }

    const start = Date.now()
    try {
      const reply = await this._callModel(
        model,
        '你是一个助手，请用一句话回答用户。',
        '你好，测试连接。请回复"连接成功"。'
      )
      return {
        success: true,
        message: `连接成功！模型回复：${reply.substring(0, 80)}`,
        latencyMs: Date.now() - start
      }
    } catch (err) {
      return { success: false, message: `连接失败：${err.message}`, latencyMs: Date.now() - start }
    }
  }

  // ─── Prompt Builder ───────────────────────────────────────────────────────────

  _buildSystemPrompt(skill, sourceName) {
    const lines = []

    lines.push(`你是一个微信消息助手，负责代替用户回复来自"${sourceName}"的消息。`)
    lines.push('')

    // User's custom prompt (the skill whiteboard)
    const customPrompt = skill?.prompt?.trim()
    if (customPrompt) {
      lines.push(customPrompt)
    } else {
      lines.push('请根据消息内容，以自然友好的语气生成简短的回复。')
    }

    // Terminology
    if (skill?.terminology && Object.keys(skill.terminology).length > 0) {
      lines.push('')
      lines.push('专业术语替换：')
      Object.entries(skill.terminology).forEach(([k, v]) => {
        lines.push(`- "${k}" 替换为 "${v}"`)
      })
    }

    // Optional JSON output instruction
    lines.push('')
    lines.push('【可选】如果此消息需要创建待办事项，请以 JSON 格式返回：')
    lines.push('{"reply": "回复内容", "todoSummary": "待办摘要（20-40字）"}')
    lines.push('否则，直接返回回复文本即可，不需要任何包装。')

    return lines.join('\n')
  }

  _buildUserMessage({ message, sender, recentMessages, senderHistory = [], senderTodos = [] }) {
    const parts = []

    // ── Sender's 36-hour message history (most important context) ──────────────
    if (senderHistory.length > 0) {
      parts.push(`【${sender} 近36小时发言汇总（共${senderHistory.length}条，最新在最后）】`)
      senderHistory.forEach(m => {
        // Use createdAt as reliable timestamp; trim to minute precision
        const raw = m.createdAt || m.senderTime || ''
        const timeStr = raw ? raw.substring(0, 16).replace('T', ' ') : ''
        const content = m.senderContentFull || m.senderContent || ''
        parts.push(timeStr ? `[${timeStr}] ${content}` : content)
      })
      parts.push('')
    }

    // ── Sender's pending todos ──────────────────────────────────────────────────
    if (senderTodos.length > 0) {
      parts.push(`【${sender} 当前待办事项】`)
      senderTodos.forEach(t => {
        const status = t.completed ? '✅已完成' : '⏳待处理'
        const dateStr = t.date ? ` (${t.date})` : ''
        parts.push(`${status}${dateStr}：${t.content}`)
      })
      parts.push('')
    }

    // ── General recent chat context (last 6 messages) ──────────────────────────
    if (recentMessages && recentMessages.length > 0) {
      parts.push('【群内近期对话上下文（最新的在最后）】')
      recentMessages.slice(-6).forEach(m => {
        const role = m.type === 'me' ? '我' : (m.sender || '对方')
        if (m.content) parts.push(`${role}: ${m.content}`)
      })
      parts.push('')
    }

    parts.push(`${sender} 最新消息：`)
    parts.push(message)

    return parts.join('\n')
  }

  /**
   * Ask AI to merge sender's message history + AI reply + existing todos
   * into a single consolidated todo summary for the sender.
   * @param {Object} params - { sender, sourceName, senderHistory, aiReply, existingTodos, newTodoSummary }
   * @returns {string|null} merged todo text, or null on failure
   */
  async mergeTodos({ sender, sourceName, senderHistory, aiReply, existingTodos, newTodoSummary }) {
    const model = this.getActiveModel()
    if (!model || !model.apiKey) return newTodoSummary || null

    // Nothing to merge — skip the API call
    if (!newTodoSummary && existingTodos.length === 0) return null

    const systemPrompt = [
      '你是一个智能待办事项管理助手。',
      '请根据提供的发言记录、AI回复和现有待办事项，生成一份合并后的待办事项总结。',
      '',
      '合并规则：',
      '1. 保留所有未完成的历史待办事项',
      '2. 将新产生的待办内容合并进去，去除重复或已解决的条目',
      '3. 结合 AI 回复的内容，判断是否有新的待办或待跟进事项',
      '4. 输出格式：纯文本，每条待办以"- "开头，100-300字以内',
      '5. 只输出待办事项摘要，不要输出任何解释或说明'
    ].join('\n')

    const parts = []
    parts.push(`群组：${sourceName}`)
    parts.push(`联系人：${sender}`)
    parts.push('')

    if (senderHistory.length > 0) {
      parts.push(`【${sender} 近36小时发言（${senderHistory.length}条）】`)
      senderHistory.forEach(m => {
        const raw = m.createdAt || m.senderTime || ''
        const timeStr = raw ? raw.substring(0, 16).replace('T', ' ') : ''
        const content = m.senderContentFull || m.senderContent || ''
        parts.push(timeStr ? `[${timeStr}] ${content}` : content)
      })
      parts.push('')
    }

    if (aiReply) {
      parts.push('【AI生成的回复】')
      parts.push(aiReply)
      parts.push('')
    }

    if (existingTodos.length > 0) {
      parts.push('【现有待办事项（需保留未完成项）】')
      existingTodos.forEach(t => {
        const status = t.completed ? '✅已完成' : '⏳未完成'
        const dateStr = t.date ? ` (${t.date})` : ''
        parts.push(`${status}${dateStr}：${t.content}`)
      })
      parts.push('')
    }

    if (newTodoSummary) {
      parts.push('【本次消息新增待办摘要】')
      parts.push(newTodoSummary)
      parts.push('')
    }

    parts.push(`请合并上述内容，生成 ${sender} 的最新待办事项总结：`)

    const userMessage = parts.join('\n')

    console.log(`[AI] mergeTodos for "${sender}" in "${sourceName}" (${existingTodos.length} existing todos)`)

    try {
      const raw = await this._callModel(model, systemPrompt, userMessage)
      return raw?.trim() || newTodoSummary || null
    } catch (err) {
      console.error('[AI] mergeTodos failed:', err.message)
      return newTodoSummary || null
    }
  }

  // ─── Provider Dispatch ────────────────────────────────────────────────────────

  async _callModel(model, systemPrompt, userMessage) {
    switch (model.provider) {
      case 'anthropic':
        return await this._callAnthropic(model, systemPrompt, userMessage)
      case 'zhipu':
        return await this._callZhipu(model, systemPrompt, userMessage)
      case 'openai_compat':
      default:
        return await this._callOpenAICompat(model, systemPrompt, userMessage)
    }
  }

  async _callAnthropic(model, systemPrompt, userMessage) {
    const response = await fetch(`${model.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': model.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model.model,
        max_tokens: model.maxTokens || 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`HTTP ${response.status}: ${err.substring(0, 200)}`)
    }
    const data = await response.json()
    return data.content?.[0]?.text?.trim() || ''
  }

  async _callZhipu(model, systemPrompt, userMessage) {
    const response = await fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: JSON.stringify({
        model: model.model,
        temperature: model.temperature || 0.7,
        max_tokens: model.maxTokens || 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`HTTP ${response.status}: ${err.substring(0, 200)}`)
    }
    const data = await response.json()
    return data.choices?.[0]?.message?.content?.trim() || ''
  }

  async _callOpenAICompat(model, systemPrompt, userMessage) {
    const response = await fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: JSON.stringify({
        model: model.model,
        temperature: model.temperature || 0.7,
        max_tokens: model.maxTokens || 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`HTTP ${response.status}: ${err.substring(0, 200)}`)
    }
    const data = await response.json()
    return data.choices?.[0]?.message?.content?.trim() || ''
  }
}

const aiService = new AIService()
export default aiService
