import React, { useState } from 'react'

const PLATFORM_CONFIG = {
  wechat:    { label: '微信网页版', color: '#07C160', short: '微信' },
  yunzhijia: { label: '云之家',     color: '#1677FF', short: '云之家' },
  feishu:    { label: '飞书',       color: '#3370FF', short: '飞书' }
}

export default function LaunchPage({ onLaunch, status, platform, onPlatformChange, onSkipToSettings }) {
  const [launching, setLaunching] = useState(false)
  const [message, setMessage] = useState('')

  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.wechat
  const platformLabel = cfg.label

  const handleLaunch = async () => {
    setLaunching(true)
    setMessage(`正在启动${platformLabel}...`)
    const result = await onLaunch()
    setMessage(result.message)
    if (!result.success) {
      setLaunching(false)
    }
  }

  const loginHint = platform === 'yunzhijia'
    ? '请在弹出的浏览器中登录云之家账号'
    : platform === 'feishu'
    ? '请在弹出的浏览器中登录飞书账号'
    : '请打开手机微信，扫描浏览器中显示的二维码'

  const waitingMsg = platform === 'yunzhijia'
    ? '请在云之家浏览器中登录...'
    : platform === 'feishu'
    ? '请在飞书浏览器中登录...'
    : '请在手机上扫描二维码登录...'

  return (
    <div className="launch-page">
      <div className="launch-container">
        <div className="launch-logo">
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
            <rect width="80" height="80" rx="20" fill={cfg.color}/>
            <path d="M28 30C28 26 31 23 35 23H45C49 23 52 26 52 30V38C52 42 49 45 45 45H42L36 51V45H35C31 45 28 42 28 38V30Z" fill="white"/>
            {platform === 'wechat' && <>
              <circle cx="37" cy="34" r="2" fill={cfg.color}/>
              <circle cx="43" cy="34" r="2" fill={cfg.color}/>
            </>}
            {platform === 'yunzhijia' && <text x="36" y="38" fill={cfg.color} fontSize="12" fontWeight="bold" textAnchor="middle">Y</text>}
            {platform === 'feishu' && <text x="36" y="38" fill={cfg.color} fontSize="12" fontWeight="bold" textAnchor="middle">F</text>}
          </svg>
        </div>

        <h1 className="launch-title">WeConnect</h1>
        <p className="launch-subtitle">智能消息助手</p>

        {/* Platform Selector */}
        <div className="platform-selector" style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '20px 0', flexWrap: 'wrap' }}>
          {Object.entries(PLATFORM_CONFIG).map(([key, pcfg]) => (
            <button
              key={key}
              className={`platform-btn ${platform === key ? 'active' : ''}`}
              onClick={() => onPlatformChange(key)}
              style={{
                padding: '8px 20px',
                borderRadius: 20,
                border: platform === key ? `2px solid ${pcfg.color}` : '2px solid #ddd',
                background: platform === key ? pcfg.color : 'white',
                color: platform === key ? 'white' : '#666',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14
              }}
            >
              {pcfg.label}
            </button>
          ))}
        </div>

        {!launching ? (
          <button className="launch-btn" onClick={handleLaunch} style={{ background: cfg.color }}>
            <span className="launch-btn-icon">▶</span>
            启动{platformLabel}
          </button>
        ) : (
          <div className="launch-status">
            {!status.loggedIn ? (
              <>
                <div className="launch-spinner"></div>
                <p className="launch-message">
                  {message || waitingMsg}
                </p>
                <p className="launch-hint">{loginHint}</p>
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
        <p>WeConnect v1.2 · 本地运行 · 数据安全 · 支持微信 & 云之家 & 飞书</p>
      </footer>
    </div>
  )
}
