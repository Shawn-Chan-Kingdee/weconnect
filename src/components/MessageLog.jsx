import React from 'react'

const CATEGORY_COLORS = {
  '日常沟通': '#8b95a5',
  '售前咨询': '#3b82f6',
  '项目实施': '#6366f1',
  '问题跟踪': '#ef4444',
  '商务报价': '#f59e0b',
  '操作咨询': '#06b6d4',
  '消息记录': '#8b95a5',
  '待办事项': '#10b981'
}

export default function MessageLog({ messages, onViewDetail, senderFilter, highlightColor }) {
  if (!messages || messages.length === 0) {
    return (
      <div className="message-log-empty">
        <div className="empty-icon">📭</div>
        <p>暂无消息记录</p>
      </div>
    )
  }

  return (
    <div className="message-log">
      <table className="msg-table">
        <thead>
          <tr>
            <th style={{ width: '10%' }}>发言人</th>
            <th style={{ width: '10%' }}>发言时间</th>
            <th style={{ width: '25%' }}>发言内容</th>
            <th style={{ width: '10%' }}>回复时间</th>
            <th style={{ width: '25%' }}>回复内容</th>
            <th style={{ width: '12%' }}>操作分类</th>
            <th style={{ width: '8%' }}>待办</th>
          </tr>
        </thead>
        <tbody>
          {messages.map(msg => {
            const isHighlighted = senderFilter && msg.sender === senderFilter
            return (
            <tr
              key={msg.id}
              className={`msg-row ${isHighlighted ? 'sender-highlight' : ''}`}
              style={isHighlighted ? { backgroundColor: (highlightColor || '#e0f2fe') + '20' } : {}}
            >
              <td className="msg-sender">{msg.sender}</td>
              <td className="msg-time">{formatTime(msg.senderTime)}</td>
              <td
                className="msg-content clickable"
                onClick={() => onViewDetail(msg)}
                title="点击查看详情"
              >
                {truncate(msg.senderContent, 40)}
              </td>
              <td className="msg-time">{msg.replyTime ? formatTime(msg.replyTime) : '-'}</td>
              <td
                className="msg-content clickable"
                onClick={() => onViewDetail(msg)}
                title="点击查看详情"
              >
                {msg.replyContent ? truncate(msg.replyContent, 40) : '-'}
              </td>
              <td>
                <span
                  className="category-badge"
                  style={{ backgroundColor: CATEGORY_COLORS[msg.category] || '#8b95a5' }}
                >
                  {msg.category}
                </span>
              </td>
              <td className="msg-todo">
                {msg.hasTodo ? '📋' : '-'}
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function formatTime(isoStr) {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return isoStr
  }
}

function truncate(str, max) {
  if (!str) return ''
  return str.length > max ? str.substring(0, max) + '...' : str
}
