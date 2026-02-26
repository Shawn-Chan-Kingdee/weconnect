import React, { useState, useEffect, useRef, useCallback } from 'react'
import LaunchPage from './pages/LaunchPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'

const API = '/api'

function App() {
  const [step, setStep] = useState(1) // 1=Launch, 2=Settings, 3=Dashboard
  const [wechatStatus, setWechatStatus] = useState({ connected: false, loggedIn: false, monitoring: false })
  const [sources, setSources] = useState([])
  const wsRef = useRef(null)
  const [wsMessages, setWsMessages] = useState([])

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

    // Check wechat status periodically
    const interval = setInterval(checkStatus, 3000)
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

  const checkStatus = async () => {
    try {
      const res = await fetch(`${API}/wechat/status`)
      const data = await res.json()
      setWechatStatus(data)
    } catch {}
  }

  const handleLaunch = async () => {
    try {
      const res = await fetch(`${API}/wechat/launch`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        // Wait for user to login, poll status
        const pollLogin = setInterval(async () => {
          const statusRes = await fetch(`${API}/wechat/status`)
          const status = await statusRes.json()
          setWechatStatus(status)
          if (status.loggedIn) {
            clearInterval(pollLogin)
            setStep(2)
          }
        }, 2000)
        // Timeout after 2 minutes
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
    // Start monitoring
    await fetch(`${API}/wechat/monitor/start`, { method: 'POST' })
    setStep(3)
  }

  const handleGoToSettings = () => setStep(2)

  return (
    <div className="app">
      {step === 1 && (
        <LaunchPage
          onLaunch={handleLaunch}
          status={wechatStatus}
          onSkipToSettings={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <SettingsPage
          sources={sources}
          setSources={setSources}
          onComplete={handleSettingsComplete}
          onBack={() => setStep(wechatStatus.loggedIn ? 3 : 1)}
        />
      )}
      {step === 3 && (
        <DashboardPage
          sources={sources}
          status={wechatStatus}
          wsMessages={wsMessages}
          onGoToSettings={handleGoToSettings}
        />
      )}
    </div>
  )
}

export default App
