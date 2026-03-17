import React, { useState, useEffect, useRef, useCallback } from 'react'
import LaunchPage from './pages/LaunchPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'

const API = '/api'

function App() {
  const [step, setStep] = useState(1) // 1=Launch, 2=Settings, 3=Dashboard
  const [platform, setPlatform] = useState('wechat') // 'wechat' | 'yunzhijia' | 'feishu'
  const [wechatStatus, setWechatStatus] = useState({ connected: false, loggedIn: false, monitoring: false })
  const [yzjStatus, setYzjStatus] = useState({ connected: false, loggedIn: false, monitoring: false })
  const [feishuStatus, setFeishuStatus] = useState({ connected: false, loggedIn: false, monitoring: false })
  const [sources, setSources] = useState([])
  const wsRef = useRef(null)
  const [wsMessages, setWsMessages] = useState([])

  // Derive current status from active platform
  const currentStatus = platform === 'yunzhijia' ? yzjStatus : platform === 'feishu' ? feishuStatus : wechatStatus
  const apiPrefix = platform === 'yunzhijia' ? 'yunzhijia' : platform === 'feishu' ? 'feishu' : 'wechat'

  // Check initial status
  useEffect(() => {
    fetch(`${API}/settings/config`).then(r => r.json()).then(config => {
      if (config.initialized) {
        fetch(`${API}/settings/sources`).then(r => r.json()).then(s => {
          setSources(s)
          if (s.length > 0) setStep(3)
        })
      }
    }).catch(() => {})

    // Check status for all platforms periodically
    const interval = setInterval(checkAllStatus, 3000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket connection
  useEffect(() => {
    if (step === 3) {
      connectWS()
    }
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [step])

  const connectWS = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    const ws = new WebSocket(wsUrl)
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setWsMessages(prev => [...prev.slice(-100), data])
      } catch {}
    }
    ws.onclose = () => {
      setTimeout(connectWS, 3000)
    }
    wsRef.current = ws
  }, [])

  const checkAllStatus = async () => {
    try {
      const [wxRes, yzjRes, fsRes] = await Promise.allSettled([
        fetch(`${API}/wechat/status`).then(r => r.json()),
        fetch(`${API}/yunzhijia/status`).then(r => r.json()),
        fetch(`${API}/feishu/status`).then(r => r.json())
      ])
      if (wxRes.status === 'fulfilled') setWechatStatus(wxRes.value)
      if (yzjRes.status === 'fulfilled') setYzjStatus(yzjRes.value)
      if (fsRes.status === 'fulfilled') setFeishuStatus(fsRes.value)
    } catch {}
  }

  const handleLaunch = async () => {
    try {
      const res = await fetch(`${API}/${apiPrefix}/launch`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        // Wait for user to login, poll status
        const pollLogin = setInterval(async () => {
          const statusRes = await fetch(`${API}/${apiPrefix}/status`)
          const status = await statusRes.json()
          if (platform === 'yunzhijia') setYzjStatus(status)
          else if (platform === 'feishu') setFeishuStatus(status)
          else setWechatStatus(status)
          if (status.loggedIn) {
            clearInterval(pollLogin)
            setStep(2)
          }
        }, 2000)
        setTimeout(() => clearInterval(pollLogin), 120000)
      }
      return data
    } catch (err) {
      return { success: false, message: err.message }
    }
  }

  const handleSettingsComplete = async (newSources) => {
    setSources(newSources)
    await fetch(`${API}/settings/complete-setup`, { method: 'POST' })
    // Start monitoring for current platform
    await fetch(`${API}/${apiPrefix}/monitor/start`, { method: 'POST' })
    setStep(3)
  }

  const handleGoToSettings = () => setStep(2)

  return (
    <div className="app">
      {step === 1 && (
        <LaunchPage
          onLaunch={handleLaunch}
          status={currentStatus}
          platform={platform}
          onPlatformChange={setPlatform}
          onSkipToSettings={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <SettingsPage
          sources={sources}
          setSources={setSources}
          platform={platform}
          onPlatformChange={setPlatform}
          onComplete={handleSettingsComplete}
          onBack={() => setStep(currentStatus.loggedIn ? 3 : 1)}
        />
      )}
      {step === 3 && (
        <DashboardPage
          sources={sources}
          platform={platform}
          onPlatformChange={setPlatform}
          wechatStatus={wechatStatus}
          yzjStatus={yzjStatus}
          feishuStatus={feishuStatus}
          wsMessages={wsMessages}
          onGoToSettings={handleGoToSettings}
          onLaunch={handleLaunch}
        />
      )}
    </div>
  )
}

export default App
