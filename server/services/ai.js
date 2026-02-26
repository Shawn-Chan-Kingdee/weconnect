/**
 * AI Model Service (Enhanced)
 * - AI-powered message classification
 * - Category-specific reply strategies
 * - Structured JSON output with todoSummary
 */
import { modelsDB, settingsDB } from '../db.js'

// ─── Category Strategies ─────────────────────────────────────────────────────

const CATEGORY_STRATEGIES = {
  '日常沟通': {
    description: '日常闲聊、问候、简短交流',
    shouldCreateTodo: false,
    replyStyle: '轻松自然、简短有礼',
    guidelines: [
      '回复控制在20-60字',
      '保持轻松友好的语气',
      '不需要展开过多内容',
      '适当使用语气词让回复更自然'
    ]
  },
  '业务咨询': {
    description: '产品/服务/价格/方案的咨询与问答',
    shouldCreateTodo: false,
    replyStyle: '专业清晰、有条理',
    guidelines: [
      '回复控制在50-150字',
      '给出明确的信息或方向',
      '如果需要时间确认，告知对方预计回复时间',
      '涉及报价时说明会单独确认',
      '保持专业但不失亲和'
    ]
  },
  '事项跟进': {
    description: '之前事项的进度询问、确认、催促',
    shouldCreateTodo: true,
    replyStyle: '负责明确、给出时间节点',
    guidelines: [
      '回复控制在40-120字',
      '明确告知当前状态或下一步动作',
      '如可能给出具体时间承诺',
      '表达对事项的重视',
      '避免模糊的"尽快"类回复'
    ]
  },
  '新事项登记': {
    description: '新的任务、需求、请求、安排',
    shouldCreateTodo: true,
    replyStyle: '积极回应、确认收到',
    guidelines: [
      '回复控制在30-100字',
      '明确确认已收到并会处理',
      '简要复述关键要求确保理解正确',
      '如可能给出初步安排时间',
      '让对方放心事项已被记录'
    ]
  }
}

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
   * AI-powered message classification
   * Falls back to keyword matching if AI is unavailable
   * @param {string} content - message text
   * @param {Object} skill - source skill config
   * @returns {string} category name
   */
  async classifyMessage(content, skill) {
    if (!content) return '日常沟通'

    // Try AI classification first
    const model = this.getActiveModel()
    if (model && model.apiKey) {
      try {
        const systemPrompt = `你是一个消息分类器。将微信消息分成以下4类之一，只返回类别名称，不要任何额外文字：
- 日常沟通：日常闲聊、问候、感谢、简短交流
- 业务咨询：产品/服务/价格/方案/合同的咨询与问答
- 事项跟进：之前事项的进度询问、确认、催促、更新
- 新事项登记：新的任务、需求、请求、安排、立项`

        const userMessage = `请分类以下消息：\n${content}`
        const result = await this._callModel(model, systemPrompt, userMessage)
        const trimmed = result.trim()

        // Validate it's one of the 4 categories
        if (['日常沟通', '业务咨询', '事项跟进', '新事项登记'].includes(trimmed)) {
          console.log(`[AI] Classified as "${trimmed}": ${content.substring(0, 40)}...`)
          return trimmed
        }
      } catch (err) {
        console.error('[AI] Classification failed, using keyword fallback:', err.message)
      }
    }

    // Keyword fallback
    return this._keywordClassify(content, skill)
  }

  /**
   * Keyword-based classification fallback
   */
  _keywordClassify(content, skill) {
    const text = content.toLowerCase()
    const keywords = skill?.classifyKeywords || {}

    if (keywords.business?.some(k => text.includes(k)) ||
        /报价|合同|方案|需求|咨询|价格|服务|产品/.test(text)) {
      return '业务咨询'
    }
    if (keywords.followup?.some(k => text.includes(k)) ||
        /进度|跟进|更新|状态|完成了吗|什么时候|怎么样了/.test(text)) {
      return '事项跟进'
    }
    if (keywords.newItem?.some(k => text.includes(k)) ||
        /新项目|新需求|安排|登记|立项|开始|麻烦.*处理/.test(text)) {
      return '新事项登记'
    }
    return '日常沟通'
  }

  /**
   * Generate a reply with category-specific strategy
   * Returns structured result: { text, todoSummary, category }
   * @param {Object} params - { message, sender, sourceName, category, skill, recentMessages }
   * @returns {{ text: string, todoSummary: string|null }}
   */
  async generateReply(params) {
    const model = this.getActiveModel()
    if (!model || !model.apiKey) {
      return { text: '', todoSummary: null }
    }

    const { category } = params
    const strategy = CATEGORY_STRATEGIES[category] || CATEGORY_STRATEGIES['日常沟通']

    const systemPrompt = this._buildStrategyPrompt(params, strategy)
    const userMessage = this._buildContextMessage(params)

    try {
      const raw = await this._callModel(model, systemPrompt, userMessage)

      // Try to parse as JSON (structured response)
      try {
        const parsed = JSON.parse(raw)
        return {
          text: (parsed.reply || parsed.text || raw).trim(),
          todoSummary: parsed.todoSummary || parsed.todo || null
        }
      } catch {
        // Plain text response
        return { text: raw.trim(), todoSummary: strategy.shouldCreateTodo ? `[${params.sender}] ${params.message.substring(0, 60)}` : null }
      }
    } catch (err) {
      console.error(`[AI] Reply generation failed (${model.provider}/${model.model}):`, err.message)
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
      const reply = await this._callModel(model, '你是一个助手，请用一句话回答用户。', '你好，测试连接。请回复"连接成功"。')
      return {
        success: true,
        message: `连接成功！模型回复：${reply.substring(0, 60)}`,
        latencyMs: Date.now() - start
      }
    } catch (err) {
      return { success: false, message: `连接失败：${err.message}`, latencyMs: Date.now() - start }
    }
  }

  // ─── Strategy Prompt Builder ──────────────────────────────────────────────────

  _buildStrategyPrompt({ sourceName, category, skill }, strategy) {
    const tone = skill?.tone || '专业友好'
    const attitude = skill?.attitude || '积极主动'
    const templates = skill?.replyTemplates || {}

    let lines = [
      `你是一个微信消息助手，负责代替用户回复来自"${sourceName}"的消息。`,
      '',
      `【当前消息类别】${category}`,
      `【类别说明】${strategy.description}`,
      `【回复风格】${strategy.replyStyle}`,
      `【语气要求】${tone}`,
      `【态度要求】${attitude}`,
      '',
      '【回复指引】'
    ]

    strategy.guidelines.forEach(g => lines.push(`- ${g}`))

    // Add terminology
    if (skill?.terminology && Object.keys(skill.terminology).length > 0) {
      lines.push('', '【专业术语映射】')
      Object.entries(skill.terminology).forEach(([k, v]) => {
        lines.push(`- "${k}" → "${v}"`)
      })
    }

    // Add template reference
    const templateMap = { '业务咨询': 'business', '事项跟进': 'followup', '新事项登记': 'newItem', '日常沟通': 'daily' }
    const tplKey = templateMap[category] || 'daily'
    if (templates[tplKey]) {
      lines.push('', `【参考模板（可灵活改写）】${templates[tplKey]}`)
    }

    // Response format instructions
    if (strategy.shouldCreateTodo) {
      lines.push(
        '',
        '【输出格式】请以 JSON 格式返回，包含两个字段：',
        '- reply: 回复内容文本',
        '- todoSummary: 待办事项摘要（简短描述需要跟进/处理的事项，20-40字）',
        '',
        '示例输出：',
        '{"reply": "收到，我会在今天下午确认项目进度后回复您。", "todoSummary": "确认XX项目进度并回复张三"}'
      )
    } else {
      lines.push(
        '',
        '【输出格式】直接返回回复文本，不要加引号、前缀或说明。'
      )
    }

    return lines.join('\n')
  }

  _buildContextMessage({ message, sender, recentMessages }) {
    let parts = []

    // Add recent context if available
    if (recentMessages && recentMessages.length > 0) {
      parts.push('【近期对话记录】')
      recentMessages.slice(-5).forEach(m => {
        const role = m.type === 'me' ? '我' : m.sender || '对方'
        parts.push(`${role}: ${m.content}`)
      })
      parts.push('')
    }

    parts.push(`${sender} 发来新消息：`)
    parts.push(message)
    parts.push('')
    parts.push('请生成回复：')

    return parts.join('\n')
  }

  // ─── Unified Model Caller ───────────────────────────────────────────────────

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
