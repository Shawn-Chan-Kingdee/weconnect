import React from 'react'

export default function TodoPanel({ todayNew = [], historicalPending = [], onToggle, today }) {
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
            todayNew.map(todo => (
              <div key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                <button
                  className="todo-toggle"
                  onClick={() => onToggle(todo.id)}
                  title={todo.completed ? '恢复为待办' : '标记为办结'}
                >
                  {todo.completed ? '✓' : '○'}
                </button>
                <div className="todo-content">
                  <span className={`todo-text ${todo.completed ? 'line-through' : ''}`}>
                    {todo.content}
                  </span>
                  <span className="todo-meta">
                    {todo.sourceName} · {todo.category}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Historical pending items (1/3 height) */}
      <div className="todo-section history-section">
        <h3 className="todo-section-title">
          历史待办
          <span className="todo-count">{historicalPending.length}</span>
        </h3>
        <div className="todo-list">
          {historicalPending.length === 0 ? (
            <p className="todo-empty">无历史待办</p>
          ) : (
            historicalPending.map(todo => (
              <div key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                {todo.date === today ? (
                  <button
                    className="todo-toggle"
                    onClick={() => onToggle(todo.id)}
                    title="标记为办结"
                  >
                    ○
                  </button>
                ) : (
                  <button
                    className="todo-toggle"
                    onClick={() => onToggle(todo.id)}
                    title="标记为办结"
                  >
                    ○
                  </button>
                )}
                <div className="todo-content">
                  <span className="todo-text">{todo.content}</span>
                  <span className="todo-meta">
                    {todo.date} · {todo.sourceName}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
