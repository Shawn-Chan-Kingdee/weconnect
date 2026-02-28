import React, { useState } from 'react'

export default function LaunchPage({ onLaunch, status, platform, onPlatformChange, onSkipToSettings }) {
  const [launching, setLaunching] = useState(false)
  const [message, setMessage] = useState('')

  const isYzj = platform === 'yunzhijia'
  const platformLabel = isYzj ? '云之家' : '微信网页版'

  const handleLaunch = async () => {
    setLaunching(true)
    setMessage(`正在启动${platformLabel}...`)
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
            <rect width="80" height="80" rx="20" fill={isYzj ? '#1677FF' : '#07C160'}/>
            <path d="M28 30C28 26 31 23 35 23H45C49 23 52 26 52 30V38C52 42 49 45 45 45H42L36 51V45H35C31 45 28 42 28 38V30Z" fill="white"/>
            {!isYzj && <>
              <circle cx="37" cy="34" r="2" fill="#07C160"/>
              <circle cx="43" cy="34" r="2" fill="#07C160"/>
            </>}
            {isYzj && <text x="36" y="38" fill="#1677FF" fontSize="12" fontWeight="bold" textAnchor="middle">Y</text>}
          </svg>
        </div>

        <h1 className="launch-title">WeConnect</h1>
        <p className="launch-subtitle">智能消息助手</p>

        {/* Platform Selector */}
        <div className="platform-selector" style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '20px 0' }}>
          <button
            className={`platform-btn ${platform === 'wechat' ? 'active' : ''}`}
            onClick={() => onPlatformChange('wechat')}
            style={{
              padding: '8px 20px',
              borderRadius: 20,
              border: platform === 'wechat' ? '2px solid #07C160' : '2px solid #ddd',
              background: platform === 'wechat' ? '#07C160' : 'white',
              color: platform === 'wechat' ? 'white' : '#666',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14
            }}
          >
            微信网页版
          </button>
          <button
            className={`platform-btn ${platform === 'yunzhijia' ? 'active' : ''}`}
            onClick={() => onPlatformChange('yunzhijia')}
            style={{
              padding: '8px 20px',
              borderRadius: 20,
              border: platform === 'yunzhijia' ? '2px solid #1677FF' : '2px solid #ddd',
              background: platform === 'yunzhijia' ? '#1677FF' : 'white',
              color: platform === 'yunzhijia' ? 'white' : '#666',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14
            }}
          >
            云之家
          </button>
        </div>

        {!launching ? (
          <button className="launch-btn" onClick={handleLaunch} style={{ background: isYzj ? '#1677FF' : undefined }}>
            <span className="launch-btn-icon">▶</span>
            启动{platformLabel}
          </button>
        ) : (
          <div className="launch-status">
            {!status.loggedIn ? (
              <>
                <div className="launch-spinner"></div>
                <p className="launch-message">
                  {message || (isYzj ? '请在云之家浏览器中登录...' : '请在手机上扫描二维码登录...')}
                </p>
                <p className="launch-hint">
                  {isYzj
                    ? '请在弹出的浏览器中登录云之家账号'
                    : '请打开手机微信，扫描浏览器中显示的二维码'}
                </p>
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
        <p>WeConnect v1.1 · 本地运行 · 数据安全 · 支持微信 & 云之家</p>
      </footer>
    </div>
  )
}
