import React, { useState, useEffect } from 'react'

const API = '/api'

const PROVIDER_META = {
  anthropic: {
    label: 'Anthropic (Claude)',
    color: '#D97706',
    bg: '#FEF3C7',
    icon: '🟠',
    models: [
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022',
      'claude-3-haiku-20240307'
    ],
    docsUrl: 'https://docs.anthropic.com',
    keyPlaceholder: 'sk-ant-api03-...'
  },
  zhipu: {
    label: '智谱 AI (GLM)',
    color: '#7C3AED',
    bg: '#EDE9FE',
    icon: '🟣',
    models: [
      'glm-4-plus',
      'glm-4',
      'glm-4-flash',
      'glm-4-air',
      'glm-3-turbo'
    ],
    docsUrl: 'https://open.bigmodel.cn',
    keyPlaceholder: 'xxxxxxxx.xxxxxxxx'
  },
  openai_compat: {
    label: 'OpenAI 兼容接口',
    color: '#059669',
    bg: '#D1FAE5',
    icon: '🟢',
    models: [],
    docsUrl: '',
    keyPlaceholder: 'sk-...'
  }
}

const PRESET_PROVIDERS = {
  'qwen-default': { displayProvider: 'openai_compat', displayName: '阿里云 (Qwen)', icon: '🔵', color: '#2563EB', bg: '#DBEAFE',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long', 'qwen-vl-max'] },
  'deepseek-default': { displayProvider: 'openai_compat', displayName: 'Deepseek', icon: '🔷', color: '#0891B2', bg: '#CFFAFE',
    models: ['deepseek-chat', 'deepseek-reasoner'] },
  'openai-default': { displayProvider: 'openai_compat', displayName: 'OpenAI (GPT)', icon: '⚫', color: '#374151', bg: '#F3F4F6',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  'claude-default': { displayProvider: 'anthropic', displayName: 'Anthropic (Claude)', icon: '🟠', color: '#D97706', bg: '#FEF3C7',
    models: ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'] },
  'glm-default': { displayProvider: 'zhipu', displayName: '智谱 AI (GLM)', icon: '🟣', color: '#7C3AED', bg: '#EDE9FE',
    models: ['glm-4-plus', 'glm-4', 'glm-4-flash', 'glm-4-air'] }
}

export default function ModelSettings() {
  const [models, setModels] = useState([])
  const [activeModelId, setActiveModelId] = useState(null)
  const [editId, setEditId] = useState(null)
  const [editData, setEditData] = useState({})
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [testing, setTesting] = useState(null) // modelId being tested
  const [testResult, setTestResult] = useState({}) // { [id]: { success, message, latencyMs } }
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customForm, setCustomForm] = useState({
    name: '', provider: 'openai_compat', model: '', baseUrl: '', apiKey: '',
    temperature: 0.7, maxTokens: 1024
  })

  useEffect(() => {
    loadModels()
    loadActive()
  }, [])

  const loadModels = async () => {
    const res = await fetch(`${API}/models`)
    const data = await res.json()
    setModels(data)
  }

  const loadActive = async () => {
    const res = await fetch(`${API}/settings/config`)
    const config = await res.json()
    setActiveModelId(config?.activeModelId || null)
  }

  const startEdit = (model) => {
    setEditId(model.id)
    setEditData({ ...model })
    setApiKeyInput('') // always fresh
  }

  const saveEdit = async () => {
    const payload = { ...editData }
    if (apiKeyInput) payload.apiKey = apiKeyInput
    else delete payload.apiKey

    await fetch(`${API}/models/${editId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    setEditId(null)
    setApiKeyInput('')
    loadModels()
  }

  const activate = async (id) => {
    await fetch(`${API}/models/${id}/activate`, { method: 'POST' })
    setActiveModelId(id)
  }

  const deactivate = async () => {
    await fetch(`${API}/models/deactivate`, { method: 'POST' })
    setActiveModelId(null)
  }

  const testModel = async (id) => {
    // Save current apiKey first if editing
    if (editId === id && apiKeyInput) await saveEdit()

    setTesting(id)
    setTestResult(prev => ({ ...prev, [id]: null }))
    const res = await fetch(`${API}/models/${id}/test`, { method: 'POST' })
    const result = await res.json()
    setTestResult(prev => ({ ...prev, [id]: result }))
    setTesting(null)
  }

  const addCustomModel = async () => {
    if (!customForm.name || !customForm.model) return
    await fetch(`${API}/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customForm)
    })
    setShowCustomForm(false)
    setCustomForm({ name: '', provider: 'openai_compat', model: '', baseUrl: '', apiKey: '', temperature: 0.7, maxTokens: 1024 })
    loadModels()
  }

  const deleteModel = async (id) => {
    if (!confirm('确认删除此自定义模型？')) return
    await fetch(`${API}/models/${id}`, { method: 'DELETE' })
    if (activeModelId === id) setActiveModelId(null)
    loadModels()
  }

  const getModelMeta = (model) => {
    return PRESET_PROVIDERS[model.id] || PROVIDER_META[model.provider] || PROVIDER_META.openai_compat
  }

  return (
    <div className="model-settings">
      {/* Header Info */}
      <div className="model-header">
        <div className="model-header-info">
          <h2>🤖 AI 模型配置</h2>
          <p>配置用于自动回复的 AI 模型。回复优先级：AI 模型 → MCP 服务 → 模板回复</p>
        </div>
        <div className="model-header-status">
          {activeModelId ? (
            <div className="active-model-badge">
              <span className="active-dot"></span>
              已激活：{models.find(m => m.id === activeModelId)?.name || '...'}
              <button className="btn-deactivate" onClick={deactivate}>停用</button>
            </div>
          ) : (
            <div className="no-model-badge">⚠ 未激活模型，使用模板回复</div>
          )}
        </div>
      </div>

      {/* Model Cards Grid */}
      <div className="model-grid">
        {models.map(model => {
          const meta = getModelMeta(model)
          const isActive = model.id === activeModelId
          const isEditing = editId === model.id
          const result = testResult[model.id]

          return (
            <div key={model.id} className={`model-card ${isActive ? 'model-card--active' : ''} ${isEditing ? 'model-card--editing' : ''}`}>
              {/* Card Header */}
              <div className="model-card-header" style={{ borderColor: meta.color }}>
                <div className="model-card-icon" style={{ background: meta.bg, color: meta.color }}>
                  {meta.icon}
                </div>
                <div className="model-card-title">
                  <h3 style={{ color: meta.color }}>{model.name}</h3>
                  <p className="model-card-model">{model.model}</p>
                </div>
                <div className="model-card-badges">
                  {isActive && <span className="badge-active">已激活</span>}
                  {model.apiKeySet && <span className="badge-key">🔑 已配置</span>}
                  {!model.apiKeySet && <span className="badge-nokey">⚠ 未配置</span>}
                </div>
              </div>

              {/* Editing Form */}
              {isEditing ? (
                <div className="model-edit-form">
                  <label className="skill-label">
                    API Key
                    <div className="api-key-row">
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={e => setApiKeyInput(e.target.value)}
                        placeholder={model.apiKeySet ? '已设置（留空保留原值）' : (meta.keyPlaceholder || 'sk-...')}
                        autoComplete="off"
                      />
                    </div>
                  </label>

                  {/* Model selector */}
                  <label className="skill-label">
                    模型名称
                    {(PRESET_PROVIDERS[model.id]?.models || meta.models || []).length > 0 ? (
                      <select
                        value={editData.model || ''}
                        onChange={e => setEditData(p => ({ ...p, model: e.target.value }))}
                      >
                        {(PRESET_PROVIDERS[model.id]?.models || meta.models).map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        <option value="custom">自定义...</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={editData.model || ''}
                        onChange={e => setEditData(p => ({ ...p, model: e.target.value }))}
                        placeholder="模型名称"
                      />
                    )}
                    {editData.model === 'custom' && (
                      <input
                        type="text"
                        style={{ marginTop: 6 }}
                        value={editData.customModel || ''}
                        onChange={e => setEditData(p => ({ ...p, model: e.target.value, customModel: e.target.value }))}
                        placeholder="输入自定义模型名称"
                      />
                    )}
                  </label>

                  <div className="skill-row">
                    <label className="skill-label">
                      Temperature
                      <input
                        type="number"
                        min="0" max="2" step="0.1"
                        value={editData.temperature || 0.7}
                        onChange={e => setEditData(p => ({ ...p, temperature: parseFloat(e.target.value) }))}
                      />
                    </label>
                    <label className="skill-label">
                      Max Tokens
                      <input
                        type="number"
                        min="100" max="8192" step="100"
                        value={editData.maxTokens || 1024}
                        onChange={e => setEditData(p => ({ ...p, maxTokens: parseInt(e.target.value) }))}
                      />
                    </label>
                  </div>

                  <label className="skill-label">
                    API Base URL
                    <input
                      type="text"
                      value={editData.baseUrl || ''}
                      onChange={e => setEditData(p => ({ ...p, baseUrl: e.target.value }))}
                      placeholder="https://api.example.com/v1"
                    />
                  </label>

                  <div className="model-edit-actions">
                    <button className="btn-primary" onClick={saveEdit}>保存</button>
                    <button className="btn-secondary" onClick={() => { setEditId(null); setApiKeyInput('') }}>取消</button>
                  </div>
                </div>
              ) : (
                <div className="model-card-info">
                  <div className="model-info-row">
                    <span className="model-info-label">Temperature</span>
                    <span>{model.temperature ?? 0.7}</span>
                    <span className="model-info-label" style={{ marginLeft: 16 }}>Max Tokens</span>
                    <span>{model.maxTokens ?? 1024}</span>
                  </div>
                  {model.baseUrl && (
                    <div className="model-info-url" title={model.baseUrl}>
                      {model.baseUrl.replace('https://', '')}
                    </div>
                  )}
                </div>
              )}

              {/* Test Result */}
              {result && (
                <div className={`test-result ${result.success ? 'success' : 'error'}`}>
                  {result.success ? '✓' : '✗'} {result.message}
                  {result.latencyMs && <span className="latency">{result.latencyMs}ms</span>}
                </div>
              )}

              {/* Card Actions */}
              {!isEditing && (
                <div className="model-card-actions">
                  <button className="btn-edit" onClick={() => startEdit(model)}>✏ 配置</button>
                  <button
                    className="btn-test"
                    onClick={() => testModel(model.id)}
                    disabled={testing === model.id || !model.apiKeySet}
                  >
                    {testing === model.id ? '测试中...' : '⚡ 测试'}
                  </button>
                  {isActive ? (
                    <button className="btn-deactivate-sm" onClick={deactivate}>停用</button>
                  ) : (
                    <button
                      className="btn-activate"
                      onClick={() => activate(model.id)}
                      disabled={!model.apiKeySet}
                      title={!model.apiKeySet ? '请先配置 API Key' : ''}
                    >
                      ▶ 激活
                    </button>
                  )}
                  {!model.isPreset && (
                    <button className="btn-delete" onClick={() => deleteModel(model.id)}>🗑</button>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Add Custom Model Card */}
        {!showCustomForm ? (
          <button className="model-add-card" onClick={() => setShowCustomForm(true)}>
            <span className="model-add-icon">+</span>
            <span>添加自定义模型</span>
            <span className="model-add-hint">支持任何 OpenAI 兼容接口</span>
          </button>
        ) : (
          <div className="model-card model-card--new">
            <div className="model-card-header" style={{ borderColor: '#6B7280' }}>
              <div className="model-card-icon" style={{ background: '#F3F4F6', color: '#374151' }}>🔧</div>
              <div className="model-card-title">
                <h3>新增自定义模型</h3>
              </div>
            </div>
            <div className="model-edit-form">
              <label className="skill-label">
                显示名称 *
                <input type="text" value={customForm.name} onChange={e => setCustomForm(p => ({ ...p, name: e.target.value }))} placeholder="如：本地 Ollama" />
              </label>
              <label className="skill-label">
                接口类型
                <select value={customForm.provider} onChange={e => setCustomForm(p => ({ ...p, provider: e.target.value }))}>
                  <option value="openai_compat">OpenAI 兼容接口</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="zhipu">智谱 GLM</option>
                </select>
              </label>
              <label className="skill-label">
                模型名称 *
                <input type="text" value={customForm.model} onChange={e => setCustomForm(p => ({ ...p, model: e.target.value }))} placeholder="如：llama3, mistral, qwen2.5" />
              </label>
              <label className="skill-label">
                API Base URL *
                <input type="text" value={customForm.baseUrl} onChange={e => setCustomForm(p => ({ ...p, baseUrl: e.target.value }))} placeholder="http://localhost:11434/v1" />
              </label>
              <label className="skill-label">
                API Key（本地模型可留空）
                <input type="password" value={customForm.apiKey} onChange={e => setCustomForm(p => ({ ...p, apiKey: e.target.value }))} placeholder="sk-..." />
              </label>
              <div className="model-edit-actions">
                <button className="btn-primary" onClick={addCustomModel}>添加</button>
                <button className="btn-secondary" onClick={() => setShowCustomForm(false)}>取消</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Guide */}
      <div className="model-guide">
        <h3>📖 快速获取 API Key</h3>
        <div className="guide-links">
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="guide-link" style={{ background: '#FEF3C7', color: '#D97706' }}>
            🟠 Anthropic Claude → console.anthropic.com
          </a>
          <a href="https://open.bigmodel.cn/usercenter/apikeys" target="_blank" rel="noreferrer" className="guide-link" style={{ background: '#EDE9FE', color: '#7C3AED' }}>
            🟣 智谱 GLM → open.bigmodel.cn
          </a>
          <a href="https://dashscope.console.aliyun.com" target="_blank" rel="noreferrer" className="guide-link" style={{ background: '#DBEAFE', color: '#2563EB' }}>
            🔵 阿里 Qwen → dashscope.console.aliyun.com
          </a>
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="guide-link" style={{ background: '#CFFAFE', color: '#0891B2' }}>
            🔷 Deepseek → platform.deepseek.com
          </a>
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="guide-link" style={{ background: '#F3F4F6', color: '#374151' }}>
            ⚫ OpenAI → platform.openai.com
          </a>
        </div>
      </div>
    </div>
  )
}
