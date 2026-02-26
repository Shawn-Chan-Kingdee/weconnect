import React, { useState, useEffect } from 'react'
import ModelSettings from '../components/ModelSettings.jsx'

const API = '/api'

const DEFAULT_SKILL = {
  autoReply: false,
  replyTo: ['*'],
  tone: '专业友好',
  attitude: '积极主动',
  terminology: {},
  replyTemplates: {
    daily: '收到，谢谢！',
    business: '收到您的咨询，我会尽快处理。',
    followup: '好的，我确认进度后回复您。',
    newItem: '已记录，我会尽快安排。'
  },
  classifyKeywords: {
    business: ['报价', '合同', '方案', '需求'],
    followup: ['进度', '跟进', '状态', '完成'],
    newItem: ['新项目', '安排', '登记', '新需求']
  },
  mcpService: null
}

export default function SettingsPage({ sources, setSources, onComplete, onBack }) {
  const [activeTab, setActiveTab] = useState('sources') // 'sources' | 'models'
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editSkill, setEditSkill] = useState(null)
  const [error, setError] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpMethod, setMcpMethod] = useState('POST')
  const [replyToStr, setReplyToStr] = useState('')

  useEffect(() => {
    fetch(`${API}/settings/sources`).then(r => r.json()).then(setSources).catch(() => {})
  }, [])

  const addSource = async () => {
    if (!newName.trim()) { setError('请输入名称'); return }
    if (sources.length >= 5) { setError('最多5个消息来源'); return }
    try {
      const res = await fetch(`${API}/settings/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), skill: DEFAULT_SKILL })
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setSources(prev => [...prev, data])
      setNewName('')
      setError('')
    } catch (err) { setError(err.message) }
  }

  const removeSource = async (id) => {
    await fetch(`${API}/settings/sources/${id}`, { method: 'DELETE' })
    setSources(prev => prev.filter(s => s.id !== id))
    if (editingId === id) { setEditingId(null); setEditSkill(null) }
  }

  const startEdit = (source) => {
    setEditingId(source.id)
    setEditSkill({ ...DEFAULT_SKILL, ...source.skill })
    setReplyToStr((source.skill?.replyTo || ['*']).join(', '))
    setMcpUrl(source.skill?.mcpService?.url || '')
    setMcpMethod(source.skill?.mcpService?.method || 'POST')
  }

  const saveSkill = async () => {
    if (!editingId || !editSkill) return
    const skill = {
      ...editSkill,
      replyTo: replyToStr.split(',').map(s => s.trim()).filter(Boolean),
      mcpService: mcpUrl ? { url: mcpUrl, method: mcpMethod, headers: {} } : null
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
          >
            📋 消息来源 & Skill
          </button>
          <button
            className={`settings-tab ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => setActiveTab('models')}
          >
            🤖 AI 模型配置
          </button>
        </div>
        <button className="btn-primary" onClick={handleComplete} disabled={sources.length === 0}>
          完成设置 →
        </button>
      </div>

      {/* Tab: Sources & Skills */}
      {activeTab === 'sources' && (
        <div className="settings-body">
          {/* Left: Source List */}
          <div className="settings-sources">
            <h2>消息来源 <span className="badge">{sources.length}/5</span></h2>
            <div className="source-input-row">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSource()}
                placeholder="输入群名或联系人名称..."
                maxLength={50}
              />
              <button className="btn-add" onClick={addSource} disabled={sources.length >= 5}>
                + 添加
              </button>
            </div>
            {error && <p className="error-msg">{error}</p>}

            <div className="source-list">
              {sources.map((source, idx) => (
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
                    <span>语气: {source.skill?.tone || '默认'}</span>
                    <span>态度: {source.skill?.attitude || '默认'}</span>
                    {source.skill?.mcpService?.url && <span className="mcp-badge">MCP</span>}
                  </div>
                </div>
              ))}
              {sources.length === 0 && (
                <div className="empty-hint">还没有消息来源，请在上方输入添加</div>
              )}
            </div>
          </div>

          {/* Right: Skill Editor */}
          <div className="settings-skill">
            {editSkill ? (
              <>
                <h2>Skill 配置 — {sources.find(s => s.id === editingId)?.name}</h2>

                <div className="skill-section">
                  <h3>基本设置</h3>
                  <label className="skill-toggle">
                    <input
                      type="checkbox"
                      checked={editSkill.autoReply}
                      onChange={e => setEditSkill(p => ({ ...p, autoReply: e.target.checked }))}
                    />
                    <span>启用自动回复</span>
                  </label>
                  <label className="skill-label">
                    回复对象（<code>*</code> 表示所有人，多个用逗号分隔）
                    <input
                      type="text"
                      value={replyToStr}
                      onChange={e => setReplyToStr(e.target.value)}
                      placeholder="*, 张三, 李四"
                    />
                  </label>
                  <div className="skill-row">
                    <label className="skill-label">
                      回复语气
                      <select value={editSkill.tone} onChange={e => setEditSkill(p => ({ ...p, tone: e.target.value }))}>
                        <option>专业友好</option>
                        <option>正式严谨</option>
                        <option>轻松活泼</option>
                        <option>简洁高效</option>
                      </select>
                    </label>
                    <label className="skill-label">
                      回复态度
                      <select value={editSkill.attitude} onChange={e => setEditSkill(p => ({ ...p, attitude: e.target.value }))}>
                        <option>积极主动</option>
                        <option>稳健审慎</option>
                        <option>热情服务</option>
                        <option>中立客观</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="skill-section">
                  <h3>回复模板 <span className="skill-hint-inline">（AI 模型已激活时作为参考；未激活时直接使用）</span></h3>
                  {[
                    ['daily', '日常沟通'],
                    ['business', '业务咨询'],
                    ['followup', '事项跟进'],
                    ['newItem', '新事项登记']
                  ].map(([key, label]) => (
                    <label className="skill-label" key={key}>
                      {label}
                      <textarea
                        rows={2}
                        value={editSkill.replyTemplates?.[key] || ''}
                        onChange={e => setEditSkill(p => ({
                          ...p,
                          replyTemplates: { ...p.replyTemplates, [key]: e.target.value }
                        }))}
                      />
                    </label>
                  ))}
                </div>

                <div className="skill-section">
                  <h3>分类关键词</h3>
                  {[
                    ['business', '业务咨询'],
                    ['followup', '事项跟进'],
                    ['newItem', '新事项登记']
                  ].map(([key, label]) => (
                    <label className="skill-label" key={key}>
                      {label}
                      <input
                        type="text"
                        value={(editSkill.classifyKeywords?.[key] || []).join(', ')}
                        onChange={e => setEditSkill(p => ({
                          ...p,
                          classifyKeywords: {
                            ...p.classifyKeywords,
                            [key]: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                          }
                        }))}
                        placeholder="关键词1, 关键词2, ..."
                      />
                    </label>
                  ))}
                </div>

                <div className="skill-section">
                  <h3>MCP 外部服务（可选）</h3>
                  <label className="skill-label">
                    服务 URL
                    <input
                      type="text"
                      value={mcpUrl}
                      onChange={e => setMcpUrl(e.target.value)}
                      placeholder="https://api.example.com/reply"
                    />
                  </label>
                  <label className="skill-label">
                    请求方法
                    <select value={mcpMethod} onChange={e => setMcpMethod(e.target.value)}>
                      <option>POST</option>
                      <option>GET</option>
                    </select>
                  </label>
                  <p className="skill-hint">接收 <code>{`{ message, sender, category }`}</code>，返回 <code>{`{ reply }`}</code></p>
                </div>

                <div className="skill-actions">
                  <button className="btn-primary" onClick={saveSkill}>保存 Skill</button>
                  <button className="btn-secondary" onClick={() => { setEditingId(null); setEditSkill(null) }}>取消</button>
                </div>
              </>
            ) : (
              <div className="skill-placeholder">
                <div className="skill-placeholder-icon">⚙️</div>
                <p>选择左侧消息来源以配置 Skill</p>
                <p className="skill-placeholder-desc">Skill 定义如何自动处理每个对话，包括回复语气、分类规则和模板</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: AI Model Config */}
      {activeTab === 'models' && (
        <ModelSettings />
      )}
    </div>
  )
}
