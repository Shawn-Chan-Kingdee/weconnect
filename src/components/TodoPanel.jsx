import React from 'react'

const SENDER_COLORS = [
  '#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#6366f1',
  '#ec4899', '#06b6d4', '#f97316', '#8b5cf6', '#14b8a6'
]

function getSenderColor(sender, index) {
  return SENDER_COLORS[index % SENDER_COLORS.length]
}

export default function TodoPanel({ todayNew = [], historicalPending = [], onToggle, onSenderFilter, activeSender, today }) {
  return (
    <div className="todo-panel">
      <h2 className="todo-title">📋 待办事项</h2>

      {/* Today's items (2/3 height) */}
      <div className="todo-section today-section">
        <h3 className="todo-section-title">
          今日事项
          <span className="todo-count">{todayNew.filter(t => !t.completed).length}</span>
        </h3>
        <div className="todo-list">
          {todayNew.length === 0 ? (
            <p className="todo-empty">暂无今日事项</p>
          ) : (
            todayNew.map((todo, idx) => {
              const senderColor = getSenderColor(todo.sender, idx)
              const isActive = activeSender === todo.sender
              return (
              <div
                key={todo.id}
                className={`todo-item ${todo.completed ? 'completed' : ''} ${isActive ? 'active-filter' : ''}`}
                onClick={() => onSenderFilter && onSenderFilter(isActive ? null : todo.sender, isActive ? null : senderColor)}
                style={{
                  cursor: 'pointer',
                  borderLeft: `3px solid ${senderColor}`,
                  backgroundColor: isActive ? senderColor + '15' : undefined
                }}
              >
                <button
                  className="todo-toggle"
                  onClick={(e) => { e.stopPropagation(); onToggle(todo.id) }}
                  title={todo.completed ? '恢复为待办' : '标记为办结'}
                >
                  {todo.completed ? '✓' : '○'}
                </button>
                <div className="todo-content">
                  <span className="todo-sender-tag" style={{ color: senderColor, fontSize: 11, fontWeight: 600 }}>
                    {todo.sender}
                  </span>
                  <span className={`todo-text ${todo.completed ? 'line-through' : ''}`}>
                    {todo.content}
                  </span>
                  <span className="todo-meta">
                    {todo.sourceName} · {todo.category}
                  </span>
                </div>
              </div>
              )
            })
          )}
        </div>
      </div>

      {/* Historical pending items (1/3 height) */}
      <div className="todo-section history-section">
        <h3 className="todo-section-title">
          历史待办
          <span className="todo-count">{historicalPending.filter(t => !t.completed).length}</span>
        </h3>
        <div className="todo-list">
          {historicalPending.length === 0 ? (
            <p className="todo-empty">无历史待办</p>
          ) : (
            historicalPending.map((todo, idx) => {
              const senderColor = getSenderColor(todo.sender, idx)
              const isActive = activeSender === todo.sender
              return (
              <div
                key={todo.id}
                className={`todo-item ${todo.completed ? 'completed' : ''} ${isActive ? 'active-filter' : ''}`}
                onClick={() => onSenderFilter && onSenderFilter(isActive ? null : todo.sender, isActive ? null : senderColor)}
                style={{
                  cursor: 'pointer',
                  borderLeft: `3px solid ${senderColor}`,
                  backgroundColor: isActive ? senderColor + '15' : undefined
                }}
              >
                <button
                  className="todo-toggle"
                  onClick={(e) => { e.stopPropagation(); onToggle(todo.id) }}
                  title={todo.completed ? '恢复为待办' : '标记为办结'}
                >
                  {todo.completed ? '✓' : '○'}
                </button>
                <div className="todo-content">
                  <span className="todo-sender-tag" style={{ color: senderColor, fontSize: 11, fontWeight: 600 }}>
                    {todo.sender}
                  </span>
                  <span className={`todo-text ${todo.completed ? 'line-through' : ''}`}>{todo.content}</span>
                  <span className="todo-meta">
                    {todo.date} · {todo.sourceName}
                  </span>
                </div>
              </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
