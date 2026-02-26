import React, { useState } from 'react'

export default function LaunchPage({ onLaunch, status, onSkipToSettings }) {
  const [launching, setLaunching] = useState(false)
  const [message, setMessage] = useState('')

  const handleLaunch = async () => {
    setLaunching(true)
    setMessage('正在启动微信网页版...')
    const result = await onLaunch()
    setMessage(result.message)
    if (!result.success) {
      setLaunching(false)
    }
  }

  return (
    <div className="launch-page">
      <div className="launch-container">
        <div className="launch-logo">
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
            <rect width="80" height="80" rx="20" fill="#07C160"/>
            <path d="M28 30C28 26 31 23 35 23H45C49 23 52 26 52 30V38C52 42 49 45 45 45H42L36 51V45H35C31 45 28 42 28 38V30Z" fill="white"/>
            <circle cx="37" cy="34" r="2" fill="#07C160"/>
            <circle cx="43" cy="34" r="2" fill="#07C160"/>
          </svg>
        </div>

        <h1 className="launch-title">WeConnect</h1>
        <p className="launch-subtitle">微信智能消息助手</p>

        {!launching ? (
          <button className="launch-btn" onClick={handleLaunch}>
            <span className="launch-btn-icon">▶</span>
            启动微信网页版
          </button>
        ) : (
          <div className="launch-status">
            {!status.loggedIn ? (
              <>
                <div className="launch-spinner"></div>
                <p className="launch-message">{message || '请在手机上扫描二维码登录...'}</p>
                <p className="launch-hint">请打开手机微信，扫描浏览器中显示的二维码</p>
              </>
            ) : (
              <>
                <div className="launch-success">✓</div>
                <p className="launch-message">登录成功！正在进入设置...</p>
              </>
            )}
          </div>
        )}

        {status.loggedIn && (
          <button className="launch-btn secondary" onClick={onSkipToSettings}>
            进入消息设置 →
          </button>
        )}
      </div>

      <footer className="launch-footer">
        <p>WeConnect v1.0 · 本地运行 · 数据安全</p>
      </footer>
    </div>
  )
}
