import React, { useState, useEffect, useCallback, useRef } from 'react'
import MessageLog from '../components/MessageLog.jsx'
import TodoPanel from '../components/TodoPanel.jsx'

const API = '/api'

const PLATFORM_CONFIG = {
  wechat:    { label: '微信',   color: '#07C160' },
  yunzhijia: { label: '云之家', color: '#1677FF' },
  feishu:    { label: '飞书',   color: '#3370FF' }
}

function getDateRange() {
  const dates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

function formatDateLabel(dateStr) {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (dateStr === today) return '今天'
  if (dateStr === yesterday) return '昨天'
  return dateStr.slice(5) // MM-DD
}

export default function DashboardPage({ sources, platform, onPlatformChange, wechatStatus, yzjStatus, feishuStatus, wsMessages, onGoToSettings, onLaunch }) {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [activeTab, setActiveTab] = useState(0)
  const [messages, setMessages] = useState([])
  const [todos, setTodos] = useState({ todayNew: [], historicalPending: [] })
  const [detailMsg, setDetailMsg] = useState(null)
  const [senderFilter, setSenderFilter] = useState(null)
  const [highlightColor, setHighlightColor] = useState(null)
  const dateRange = getDateRange()

  // Launch state
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState('')
  const pollRef = useRef(null)

  // Current platform status
  const statusMap = { wechat: wechatStatus, yunzhijia: yzjStatus, feishu: feishuStatus }
  const status = statusMap[platform] || wechatStatus
  const apiPrefix = platform === 'yunzhijia' ? 'yunzhijia' : platform === 'feishu' ? 'feishu' : 'wechat'
  const pcfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.wechat
  const platformLabel = pcfg.label

  // Filter sources by platform
  const platformSources = sources.filter(s => (s.platform || 'wechat') === platform)

  // Reset tab when switching platform
  useEffect(() => {
    setActiveTab(0)
  }, [platform])

  const handleLaunchClick = async () => {
    if (launching) return
    setLaunching(true)
    setLaunchMsg(`正在启动${platformLabel}浏览器...`)
    try {
      const result = await onLaunch()
      if (result.success) {
        const loginMsg = platform === 'yunzhijia' ? '请在浏览器中登录云之家...'
          : platform === 'feishu' ? '请在浏览器中登录飞书...'
          : '请用手机微信扫码登录...'
        setLaunchMsg(loginMsg)
        pollRef.current = setInterval(async () => {
          try {
            const res = await fetch(`${API}/${apiPrefix}/status`)
            const s = await res.json()
            if (s.loggedIn) {
              clearInterval(pollRef.current)
              setLaunchMsg('已登录，正在启动监控...')
              await fetch(`${API}/${apiPrefix}/monitor/start`, { method: 'POST' })
              setLaunching(false)
              setLaunchMsg('')
            }
          } catch {}
        }, 2000)
        setTimeout(() => {
          if (pollRef.current) {
            clearInterval(pollRef.current)
            setLaunching(false)
            setLaunchMsg('')
          }
        }, 180000)
      } else {
        setLaunchMsg(result.message || '启动失败')
        setTimeout(() => { setLaunching(false); setLaunchMsg('') }, 3000)
      }
    } catch (err) {
      setLaunchMsg(err.message)
      setTimeout(() => { setLaunching(false); setLaunchMsg('') }, 3000)
    }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const fetchMessages = useCallback(async () => {
    if (platformSources.length === 0) return
    const source = platformSources[activeTab]
    if (!source) return
    try {
      const res = await fetch(`${API}/messages?date=${selectedDate}&source=${encodeURIComponent(source.name)}`)
      const data = await res.json()
      setMessages(data)
    } catch {}
  }, [selectedDate, activeTab, platformSources])

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch(`${API}/todos/dashboard`)
      const data = await res.json()
      setTodos(data)
    } catch {}
  }, [])

  useEffect(() => { fetchMessages() }, [fetchMessages])
  useEffect(() => { fetchTodos() }, [fetchTodos])

  useEffect(() => {
    if (wsMessages.length > 0) {
      const last = wsMessages[wsMessages.length - 1]
      if (last.type === 'new_message' || last.type === 'new_todo') {
        fetchMessages()
        fetchTodos()
      }
    }
  }, [wsMessages])

  useEffect(() => {
    const iv = setInterval(() => { fetchMessages(); fetchTodos() }, 10000)
    return () => clearInterval(iv)
  }, [fetchMessages, fetchTodos])

  const toggleTodo = async (id) => {
    try {
      const res = await fetch(`${API}/todos/${id}/toggle`, { method: 'PUT' })
      const data = await res.json()
      if (!data.error) fetchTodos()
    } catch {}
  }

  return (
    <div className="dashboard">
      {/* Top Bar */}
      <div className="dashboard-topbar">
        <div className="topbar-left">
          <div className="topbar-logo">
            <svg width="28" height="28" viewBox="0 0 80 80" fill="none">
              <rect width="80" height="80" rx="20" fill={pcfg.color}/>
              <path d="M28 30C28 26 31 23 35 23H45C49 23 52 26 52 30V38C52 42 49 45 45 45H42L36 51V45H35C31 45 28 42 28 38V30Z" fill="white"/>
            </svg>
          </div>
          <span className="topbar-title">WeConnect</span>

          {/* Platform Switcher */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 16, background: '#f0f0f0', borderRadius: 6, padding: 2 }}>
            {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => onPlatformChange(key)}
                style={{
                  padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: platform === key ? cfg.color : 'transparent',
                  color: platform === key ? 'white' : '#666'
                }}
              >
                {cfg.label}
                {statusMap[key]?.monitoring && <span style={{ marginLeft: 4, fontSize: 10 }}>●</span>}
              </button>
            ))}
          </div>

          {/* Launch / Relaunch Button */}
          <div className="topbar-launch">
            {!launching ? (
              <button
                className={`btn-topbar-launch ${status.loggedIn ? 'relaunching' : 'offline'}`}
                onClick={handleLaunchClick}
                title={status.loggedIn ? `重新启动${platformLabel}网页` : `启动${platformLabel}`}
              >
                <span className="btn-launch-icon">
                  {status.loggedIn ? '↻' : '▶'}
                </span>
                {status.loggedIn ? '重启网页' : `启动${platformLabel}`}
              </button>
            ) : (
              <div className="topbar-launching">
                <span className="topbar-spinner"></span>
                <span className="topbar-launch-msg">{launchMsg}</span>
              </div>
            )}
          </div>
        </div>
        <div className="topbar-right">
          <span className={`status-dot ${status.loggedIn ? 'online' : 'offline'}`}></span>
          <span className="status-text">{status.loggedIn ? '在线' : '离线'}</span>
          <span className={`status-dot ${status.monitoring ? 'monitoring' : ''}`}></span>
          <span className="status-text">{status.monitoring ? '监控中' : '未监控'}</span>
          <button className="btn-settings" onClick={onGoToSettings}>⚙ 设置</button>
        </div>
      </div>

      <div className="dashboard-body">
        {/* Main Content Area (4/5) */}
        <div className="dashboard-main">
          {/* Date Selector */}
          <div className="date-bar">
            {dateRange.map(date => (
              <button
                key={date}
                className={`date-btn ${selectedDate === date ? 'active' : ''}`}
                onClick={() => setSelectedDate(date)}
              >
                {formatDateLabel(date)}
              </button>
            ))}
          </div>

          {/* Tab Selector for Sources (filtered by platform) */}
          <div className="source-tabs">
            {platformSources.length === 0 ? (
              <div style={{ padding: '8px 16px', color: '#999', fontSize: 13 }}>
                当前平台（{platformLabel}）暂无消息来源，请前往设置添加
              </div>
            ) : (
              platformSources.map((source, idx) => (
                <button
                  key={source.id}
                  className={`source-tab ${activeTab === idx ? 'active' : ''}`}
                  onClick={() => setActiveTab(idx)}
                >
                  {source.name}
                </button>
              ))
            )}
          </div>

          {/* Sender Filter Banner */}
          {senderFilter && (
            <div style={{
              padding: '6px 16px', background: (highlightColor || '#3b82f6') + '15',
              borderLeft: `3px solid ${highlightColor || '#3b82f6'}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 13, borderRadius: 4, margin: '0 0 8px'
            }}>
              <span>筛选：<b>{senderFilter}</b> 的会话记录</span>
              <button onClick={() => { setSenderFilter(null); setHighlightColor(null) }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#999' }}>✕</button>
            </div>
          )}

          {/* Message Log Table */}
          <MessageLog
            messages={messages}
            onViewDetail={(msg) => setDetailMsg(msg)}
            senderFilter={senderFilter}
            highlightColor={highlightColor}
          />
        </div>

        {/* Todo Sidebar (1/5) */}
        <div className="dashboard-sidebar">
          <TodoPanel
            todayNew={todos.todayNew}
            historicalPending={todos.historicalPending}
            onToggle={toggleTodo}
            onSenderFilter={(sender, color) => { setSenderFilter(sender); setHighlightColor(color) }}
            activeSender={senderFilter}
            today={new Date().toISOString().split('T')[0]}
          />
        </div>
      </div>

      {/* Message Detail Modal */}
      {detailMsg && (
        <div className="modal-overlay" onClick={() => setDetailMsg(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>消息详情</h3>
              <button className="modal-close" onClick={() => setDetailMsg(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-section">
                <h4>发言内容</h4>
                <p className="detail-sender">{detailMsg.sender} · {detailMsg.senderTime}</p>
                <div className="detail-text">{detailMsg.senderContentFull || detailMsg.senderContent}</div>
              </div>
              {detailMsg.replyContent && (
                <div className="detail-section">
                  <h4>回复内容</h4>
                  <p className="detail-sender">自动回复 · {detailMsg.replyTime}</p>
                  <div className="detail-text">{detailMsg.replyContentFull || detailMsg.replyContent}</div>
                </div>
              )}
              <div className="detail-meta">
                <span className={`category-tag cat-${detailMsg.category}`}>{detailMsg.category}</span>
                {detailMsg.hasTodo && <span className="todo-tag">📋 已生成待办</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
