import React, { useState, useEffect } from 'react'
import ModelSettings from '../components/ModelSettings.jsx'

const API = '/api'

const PLATFORM_CONFIG = {
  wechat:    { label: '微信',   color: '#07C160' },
  yunzhijia: { label: '云之家', color: '#1677FF' },
  feishu:    { label: '飞书',   color: '#3370FF' }
}

const DEFAULT_SKILL = {
  autoReply: false,
  replyTo: ['*'],
  prompt: '',
  terminology: {},
  todoWebhook: null   // { url, method, headers, bodyTemplate }
}

export default function SettingsPage({ sources, setSources, platform, onPlatformChange, onComplete, onBack }) {
  const [activeTab, setActiveTab] = useState('sources')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editSkill, setEditSkill] = useState(null)
  const [error, setError] = useState('')
  const [replyToStr, setReplyToStr] = useState('')
  const [termStr, setTermStr] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookMethod, setWebhookMethod] = useState('POST')
  const [webhookHeaders, setWebhookHeaders] = useState('') // "Key: Value" per line
  const [webhookBodyTpl, setWebhookBodyTpl] = useState('')
  const [webhookTesting, setWebhookTesting] = useState(false)
  const [webhookTestResult, setWebhookTestResult] = useState(null)

  const pcfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.wechat
  const platformLabel = pcfg.label

  // Filter sources by current platform
  const platformSources = sources.filter(s => (s.platform || 'wechat') === platform)

  useEffect(() => {
    fetch(`${API}/settings/sources`).then(r => r.json()).then(setSources).catch(() => {})
  }, [])

  const addSource = async () => {
    if (!newName.trim()) { setError('请输入名称'); return }
    if (platformSources.length >= 5) { setError(`每个平台最多5个消息来源`); return }
    try {
      const res = await fetch(`${API}/settings/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), platform })
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      const updated = [...sources, data]
      setSources(updated)
      setNewName('')
      setError('')
      startEdit(data)
    } catch (err) { setError(err.message) }
  }

  const removeSource = async (id) => {
    await fetch(`${API}/settings/sources/${id}`, { method: 'DELETE' })
    setSources(prev => prev.filter(s => s.id !== id))
    if (editingId === id) { setEditingId(null); setEditSkill(null) }
  }

  const startEdit = (source) => {
    const skill = { ...DEFAULT_SKILL, ...source.skill }
    setEditingId(source.id)
    setEditSkill(skill)
    setReplyToStr((skill.replyTo || ['*']).join(', '))
    const terms = skill.terminology || {}
    setTermStr(Object.entries(terms).map(([k, v]) => `${k}=${v}`).join('\n'))
    // Webhook
    const wh = skill.todoWebhook || {}
    setWebhookUrl(wh.url || '')
    setWebhookMethod(wh.method || 'POST')
    setWebhookHeaders(Object.entries(wh.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n'))
    setWebhookBodyTpl(wh.bodyTemplate || '')
    setWebhookTestResult(null)
  }

  const saveSkill = async () => {
    if (!editingId || !editSkill) return
    const terminology = {}
    termStr.split('\n').forEach(line => {
      const idx = line.indexOf('=')
      if (idx > 0) {
        const k = line.substring(0, idx).trim()
        const v = line.substring(idx + 1).trim()
        if (k && v) terminology[k] = v
      }
    })
    // Parse webhook headers: "Key: Value" per line
    const parsedHeaders = {}
    webhookHeaders.split('\n').forEach(line => {
      const idx = line.indexOf(':')
      if (idx > 0) {
        parsedHeaders[line.substring(0, idx).trim()] = line.substring(idx + 1).trim()
      }
    })

    const todoWebhook = webhookUrl.trim() ? {
      url: webhookUrl.trim(),
      method: webhookMethod,
      headers: parsedHeaders,
      bodyTemplate: webhookBodyTpl.trim() || null
    } : null

    const skill = {
      ...editSkill,
      replyTo: replyToStr.split(',').map(s => s.trim()).filter(Boolean),
      terminology,
      todoWebhook
    }
    await fetch(`${API}/settings/sources/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill })
    })
    setSources(prev => prev.map(s => s.id === editingId ? { ...s, skill } : s))
    setEditingId(null)
    setEditSkill(null)
  }

  const testWebhook = async () => {
    if (!webhookUrl.trim()) return
    setWebhookTesting(true)
    setWebhookTestResult(null)
    try {
      const parsedHeaders = {}
      webhookHeaders.split('\n').forEach(line => {
        const idx = line.indexOf(':')
        if (idx > 0) parsedHeaders[line.substring(0, idx).trim()] = line.substring(idx + 1).trim()
      })

      const testPayload = {
        todoId: 'test-' + Date.now(),
        messageId: 'test-msg',
        sourceName: sources.find(s => s.id === editingId)?.name || 'test',
        sender: '测试用户',
        senderTime: new Date().toISOString(),
        originalMessage: '这是一条测试消息',
        summary: '【测试】Webhook 连通性验证',
        reply: '收到，已处理',
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      }

      let body = testPayload
      if (webhookBodyTpl.trim()) {
        let tpl = webhookBodyTpl
        Object.entries(testPayload).forEach(([k, v]) => {
          tpl = tpl.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
        })
        try { body = JSON.parse(tpl) } catch { body = tpl }
      }

      const res = await fetch(webhookUrl.trim(), {
        method: webhookMethod,
        headers: { 'Content-Type': 'application/json', ...parsedHeaders },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      })
      const text = await res.text()
      setWebhookTestResult({ ok: res.ok, status: res.status, body: text.substring(0, 200) })
    } catch (err) {
      setWebhookTestResult({ ok: false, status: 0, body: err.message })
    }
    setWebhookTesting(false)
  }

  const handleComplete = () => {
    if (sources.length === 0) { setError('请至少添加一个消息来源'); return }
    onComplete(sources)
  }

  return (
    <div className="settings-page">
      {/* Header */}
      <div className="settings-header">
        <button className="btn-back" onClick={onBack}>← 返回</button>
        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'sources' ? 'active' : ''}`}
            onClick={() => setActiveTab('sources')}
          >📋 消息来源 & Prompt</button>
          <button
            className={`settings-tab ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => setActiveTab('models')}
          >🤖 AI 模型配置</button>
        </div>
        <button className="btn-primary" onClick={handleComplete} disabled={sources.length === 0}>
          完成设置 →
        </button>
      </div>

      {activeTab === 'sources' && (
        <div className="settings-body">
          {/* Left: Source List */}
          <div className="settings-sources">
            <h2>消息来源 <span className="badge">{platformSources.length}/5</span></h2>

            {/* Platform Switcher */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => { onPlatformChange(key); setEditingId(null); setEditSkill(null) }}
                  style={{
                    padding: '5px 14px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    background: platform === key ? cfg.color : '#f0f0f0',
                    color: platform === key ? 'white' : '#666'
                  }}
                >
                  {cfg.label}
                </button>
              ))}
            </div>

            <div className="source-input-row">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSource()}
                placeholder={`输入群名或联系人（需与${platformLabel}显示完全一致）`}
                maxLength={50}
              />
              <button className="btn-add" onClick={addSource} disabled={platformSources.length >= 5}>
                + 添加
              </button>
            </div>
            {error && <p className="error-msg">{error}</p>}

            <div className="source-list">
              {platformSources.map((source, idx) => (
                <div
                  key={source.id}
                  className={`source-card ${editingId === source.id ? 'active' : ''}`}
                  onClick={() => startEdit(source)}
                >
                  <div className="source-card-header">
                    <span className="source-index">{idx + 1}</span>
                    <span className="source-name">{source.name}</span>
                    <span className={`source-badge ${source.skill?.autoReply ? 'auto' : 'manual'}`}>
                      {source.skill?.autoReply ? '自动回复' : '仅监控'}
                    </span>
                    <button className="btn-remove" onClick={e => { e.stopPropagation(); removeSource(source.id) }}>×</button>
                  </div>
                  <div className="source-card-meta">
                    {source.skill?.prompt
                      ? <span className="prompt-preview">Prompt: {source.skill.prompt.substring(0, 45)}…</span>
                      : <span className="prompt-empty">⚠ 未配置 Prompt，点击配置</span>
                    }
                  </div>
                </div>
              ))}
              {platformSources.length === 0 && (
                <div className="empty-hint">当前平台（{platformLabel}）还没有消息来源，请在上方输入添加</div>
              )}
            </div>
          </div>

          {/* Right: Prompt Editor */}
          <div className="settings-skill">
            {editSkill ? (
              <>
                <h2>
                  Prompt 配置
                  <span className="source-name-title"> — {sources.find(s => s.id === editingId)?.name}</span>
                </h2>

                {/* Auto reply toggle */}
                <div className="skill-section">
                  <h3>回复设置</h3>
                  <label className="skill-toggle">
                    <input
                      type="checkbox"
                      checked={editSkill.autoReply}
                      onChange={e => setEditSkill(p => ({ ...p, autoReply: e.target.checked }))}
                    />
                    <span>启用自动回复</span>
                    <span className="toggle-hint">（关闭则仅监控记录，不发送回复）</span>
                  </label>
                  <label className="skill-label" style={{ marginTop: 12 }}>
                    回复对象
                    <span className="skill-hint-inline"> — * 表示所有人，多个用英文逗号分隔</span>
                    <input
                      type="text"
                      value={replyToStr}
                      onChange={e => setReplyToStr(e.target.value)}
                      placeholder="* 或 张三, 李四"
                    />
                  </label>
                </div>

                {/* Prompt Whiteboard — core feature */}
                <div className="skill-section prompt-section">
                  <h3>AI 回复 Prompt
                    <span className="skill-hint-inline"> — 直接写给大模型的指令</span>
                  </h3>
                  <p className="prompt-tip">
                    💡 用自然语言写清楚 AI 的角色、回复风格和注意事项即可。<br />
                    如需自动创建待办，可在 Prompt 中说明，AI 会返回 JSON：
                    <code> {`{"reply":"...","todoSummary":"..."}`}</code>
                  </p>
                  <textarea
                    className="prompt-textarea"
                    rows={14}
                    value={editSkill.prompt}
                    onChange={e => setEditSkill(p => ({ ...p, prompt: e.target.value }))}
                    placeholder={`示例 Prompt：

你是一个专业的商务助理，负责处理来自"超票新动能"群的消息。

【角色】代替创始人回复群内消息，态度积极、简洁专业。

【回复规则】
- 对于咨询/问题：给出明确答复或告知跟进时间
- 对于任务安排：确认收到，并给出初步时间预期
- 控制在 80 字以内
- 口语化，不要太正式

【需要待办时】返回 JSON 格式：
{"reply": "回复内容", "todoSummary": "需要处理的事项摘要"}`}
                  />
                  <div className="prompt-char-count">{editSkill.prompt?.length || 0} 字</div>
                </div>

                {/* Terminology — optional */}
                <div className="skill-section">
                  <h3>术语替换 <span className="skill-hint-inline">（可选，每行一条，格式：原词=替换词）</span></h3>
                  <textarea
                    className="term-textarea"
                    rows={3}
                    value={termStr}
                    onChange={e => setTermStr(e.target.value)}
                    placeholder={'客户=甲方\nBug=问题'}
                  />
                </div>

                {/* Todo Webhook */}
                <div className="skill-section webhook-section">
                  <h3>📡 待办事项 Webhook
                    <span className="skill-hint-inline"> — AI 生成待办时自动推送到内部系统</span>
                  </h3>
                  <p className="webhook-tip">
                    配置后，每次 AI 返回 todoSummary 时，WeConnect 会立即 POST 到此地址。<br />
                    默认发送完整的待办数据，也可自定义请求体模板。
                  </p>

                  <div className="webhook-row">
                    <label className="skill-label webhook-method-label">
                      方法
                      <select value={webhookMethod} onChange={e => setWebhookMethod(e.target.value)}>
                        <option>POST</option>
                        <option>PUT</option>
                        <option>PATCH</option>
                      </select>
                    </label>
                    <label className="skill-label webhook-url-label">
                      接口地址
                      <input
                        type="text"
                        value={webhookUrl}
                        onChange={e => { setWebhookUrl(e.target.value); setWebhookTestResult(null) }}
                        placeholder="https://your-api.com/api/todos/create"
                      />
                    </label>
                  </div>

                  <label className="skill-label">
                    请求头 <span className="skill-hint-inline">（每行一条，格式：Header-Name: value）</span>
                    <textarea
                      className="term-textarea"
                      rows={3}
                      value={webhookHeaders}
                      onChange={e => setWebhookHeaders(e.target.value)}
                      placeholder={'Authorization: Bearer your-token\nX-Source: weconnect'}
                    />
                  </label>

                  <label className="skill-label">
                    自定义请求体 <span className="skill-hint-inline">（可选，留空则发送完整数据，支持 {`{{占位符}}`}）</span>
                    <textarea
                      className="term-textarea"
                      rows={5}
                      value={webhookBodyTpl}
                      onChange={e => setWebhookBodyTpl(e.target.value)}
                      placeholder={`留空则发送完整 JSON，或自定义格式，例如：\n{\n  "title": "{{summary}}",\n  "from": "{{sender}}",\n  "group": "{{sourceName}}",\n  "msg": "{{originalMessage}}"\n}`}
                    />
                  </label>

                  <div className="webhook-actions">
                    <button
                      className="btn-test-webhook"
                      onClick={testWebhook}
                      disabled={!webhookUrl.trim() || webhookTesting}
                    >
                      {webhookTesting ? '测试中…' : '🔗 测试连通性'}
                    </button>
                    {webhookTestResult && (
                      <span className={`webhook-test-result ${webhookTestResult.ok ? 'ok' : 'fail'}`}>
                        {webhookTestResult.ok
                          ? `✅ ${webhookTestResult.status} 成功 — ${webhookTestResult.body}`
                          : `❌ ${webhookTestResult.status || '错误'} — ${webhookTestResult.body}`
                        }
                      </span>
                    )}
                  </div>

                  <div className="webhook-payload-hint">
                    <strong>默认发送的字段：</strong>
                    <code>todoId · messageId · sourceName · sender · senderTime · originalMessage · summary · reply · date · timestamp</code>
                  </div>
                </div>

                <div className="skill-actions">
                  <button className="btn-primary" onClick={saveSkill}>💾 保存配置</button>
                  <button className="btn-secondary" onClick={() => { setEditingId(null); setEditSkill(null) }}>取消</button>
                </div>
              </>
            ) : (
              <div className="skill-placeholder">
                <div className="skill-placeholder-icon">✏️</div>
                <p>点击左侧消息来源开始配置 Prompt</p>
                <p className="skill-placeholder-desc">
                  直接用自然语言写 Prompt，AI 将按照你的要求处理消息。<br />
                  无需分类规则和回复模板。
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'models' && <ModelSettings />}
    </div>
  )
}
