/**
 * AI Model Configuration Routes
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { modelsDB, settingsDB } from '../db.js'
import aiService from '../services/ai.js'

const router = Router()

// Get all model configs (mask API keys)
router.get('/', (req, res) => {
  const models = modelsDB.findAll()
  const config = settingsDB.findById('app-config')

  res.json(models.map(m => ({
    ...m,
    apiKey: m.apiKey ? '•'.repeat(Math.min(m.apiKey.length, 20)) : '',
    apiKeySet: !!m.apiKey,
    isActive: m.id === config?.activeModelId
  })))
})

// Get active model (without masking for internal use)
router.get('/active', (req, res) => {
  const model = aiService.getActiveModel()
  if (!model) return res.json(null)
  res.json({
    id: model.id,
    name: model.name,
    provider: model.provider,
    model: model.model,
    apiKeySet: !!model.apiKey
  })
})

// Create a custom model
router.post('/', (req, res) => {
  const { name, provider, model, baseUrl, apiKey, temperature, maxTokens } = req.body
  if (!name || !provider || !model) {
    return res.status(400).json({ error: '名称、提供商和模型名称不能为空' })
  }

  const newModel = modelsDB.insert({
    id: uuidv4(),
    name,
    provider,
    model,
    baseUrl: baseUrl || '',
    apiKey: apiKey || '',
    temperature: parseFloat(temperature) || 0.7,
    maxTokens: parseInt(maxTokens) || 1024,
    isActive: false,
    isPreset: false
  })

  res.json({ ...newModel, apiKeySet: !!newModel.apiKey, apiKey: apiKey ? '•'.repeat(Math.min(apiKey.length, 20)) : '' })
})

// Update model config (including API key)
router.put('/:id', (req, res) => {
  const { id } = req.params
  const existing = modelsDB.findById(id)
  if (!existing) return res.status(404).json({ error: '模型不存在' })

  const updates = { ...req.body }

  // Only update apiKey if a real value is provided (not the masked version)
  if (updates.apiKey && updates.apiKey.includes('•')) {
    delete updates.apiKey // Keep existing
  }

  const updated = modelsDB.update(id, updates)
  res.json({
    ...updated,
    apiKey: updated.apiKey ? '•'.repeat(Math.min(updated.apiKey.length, 20)) : '',
    apiKeySet: !!updated.apiKey
  })
})

// Set active model
router.post('/:id/activate', (req, res) => {
  const { id } = req.params
  const model = modelsDB.findById(id)
  if (!model) return res.status(404).json({ error: '模型不存在' })

  settingsDB.update('app-config', { activeModelId: id })
  res.json({ success: true, message: `已激活 ${model.name}` })
})

// Deactivate (use template-based reply)
router.post('/deactivate', (req, res) => {
  settingsDB.update('app-config', { activeModelId: null })
  res.json({ success: true, message: '已切换为模板回复模式' })
})

// Test a model connection
router.post('/:id/test', async (req, res) => {
  const { id } = req.params
  const result = await aiService.testModel(id)
  res.json(result)
})

// Delete a custom model
router.delete('/:id', (req, res) => {
  const { id } = req.params
  const model = modelsDB.findById(id)
  if (!model) return res.status(404).json({ error: '模型不存在' })
  if (model.isPreset) return res.status(400).json({ error: '预设模型不可删除，但可以清除 API Key' })

  // If deleting active model, deactivate
  const config = settingsDB.findById('app-config')
  if (config?.activeModelId === id) {
    settingsDB.update('app-config', { activeModelId: null })
  }

  modelsDB.remove(id)
  res.json({ success: true })
})

export default router
