/**
 * Settings & Sources Routes
 * Simplified skill structure: prompt whiteboard replaces templates/keywords
 * Supports multi-platform: wechat | yunzhijia | feishu
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { sourcesDB, settingsDB } from '../db.js'

const router = Router()

const DEFAULT_SKILL = {
  autoReply: false,
  replyTo: ['*'],
  prompt: '',        // System prompt / skill whiteboard — user writes their own instructions
  terminology: {},   // Optional term substitutions
  mcpService: null
}

const VALID_PLATFORMS = ['wechat', 'yunzhijia', 'feishu']

// Get all message sources (optional ?platform=wechat|yunzhijia filter)
router.get('/sources', (req, res) => {
  const { platform } = req.query
  let sources = sourcesDB.findAll()
  if (platform && VALID_PLATFORMS.includes(platform)) {
    sources = sources.filter(s => s.platform === platform)
  }
  res.json(sources)
})

// Add a message source (max 5 per platform)
router.post('/sources', (req, res) => {
  const { name, skill, platform } = req.body
  const plat = VALID_PLATFORMS.includes(platform) ? platform : 'wechat'

  if (!name) {
    return res.status(400).json({ error: '名称不能为空' })
  }

  const existing = sourcesDB.findAll().filter(s => s.platform === plat)
  if (existing.length >= 5) {
    return res.status(400).json({ error: `每个平台最多只能配置5个消息来源` })
  }

  if (existing.find(s => s.name === name)) {
    return res.status(400).json({ error: `消息来源 "${name}" 已存在` })
  }

  const source = sourcesDB.insert({
    id: uuidv4(),
    name,
    platform: plat,
    skill: { ...DEFAULT_SKILL, ...(skill || {}) },
    enabled: true
  })

  res.json(source)
})

// Update a message source
router.put('/sources/:id', (req, res) => {
  const { id } = req.params
  const updates = req.body
  const updated = sourcesDB.update(id, updates)
  if (!updated) {
    return res.status(404).json({ error: '未找到该消息来源' })
  }
  res.json(updated)
})

// Delete a message source
router.delete('/sources/:id', (req, res) => {
  const { id } = req.params
  const removed = sourcesDB.remove(id)
  if (!removed) {
    return res.status(404).json({ error: '未找到该消息来源' })
  }
  res.json({ success: true })
})

// Get app settings
router.get('/config', (req, res) => {
  const config = settingsDB.findById('app-config')
  res.json(config || { initialized: false })
})

// Update app settings
router.put('/config', (req, res) => {
  const updated = settingsDB.update('app-config', req.body)
  res.json(updated)
})

// Mark setup as complete
router.post('/complete-setup', (req, res) => {
  settingsDB.update('app-config', { initialized: true })
  res.json({ success: true })
})

export default router
