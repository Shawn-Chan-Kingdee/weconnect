/**
 * Simple JSON file-based database
 * Cross-platform (Windows/macOS), no external DB dependencies
 * Each collection is stored as a separate .json file in the data/ directory
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

class JsonDB {
  constructor(collectionName) {
    this.filePath = path.join(DATA_DIR, `${collectionName}.json`)
    this._cache = null
    this._loadSync()
  }

  _loadSync() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        this._cache = JSON.parse(raw)
      } else {
        this._cache = []
        this._saveSync()
      }
    } catch {
      this._cache = []
      this._saveSync()
    }
  }

  _saveSync() {
    fs.writeFileSync(this.filePath, JSON.stringify(this._cache, null, 2), 'utf-8')
  }

  findAll(filter = null) {
    if (!filter) return [...this._cache]
    return this._cache.filter(item => {
      return Object.entries(filter).every(([key, val]) => item[key] === val)
    })
  }

  findById(id) {
    return this._cache.find(item => item.id === id) || null
  }

  findOne(filter) {
    return this._cache.find(item => {
      return Object.entries(filter).every(([key, val]) => item[key] === val)
    }) || null
  }

  insert(doc) {
    const newDoc = { ...doc, createdAt: doc.createdAt || new Date().toISOString() }
    this._cache.push(newDoc)
    this._saveSync()
    return newDoc
  }

  update(id, updates) {
    const idx = this._cache.findIndex(item => item.id === id)
    if (idx === -1) return null
    this._cache[idx] = { ...this._cache[idx], ...updates, updatedAt: new Date().toISOString() }
    this._saveSync()
    return this._cache[idx]
  }

  upsert(filter, doc) {
    const existing = this.findOne(filter)
    if (existing) {
      return this.update(existing.id, doc)
    } else {
      return this.insert(doc)
    }
  }

  remove(id) {
    const idx = this._cache.findIndex(item => item.id === id)
    if (idx === -1) return false
    this._cache.splice(idx, 1)
    this._saveSync()
    return true
  }

  clear() {
    this._cache = []
    this._saveSync()
  }
}

// Collections
export const settingsDB = new JsonDB('settings')
export const sourcesDB = new JsonDB('sources')
export const messagesDB = new JsonDB('messages')
export const todosDB = new JsonDB('todos')
export const modelsDB = new JsonDB('models')

// Initialize default settings if empty
if (settingsDB.findAll().length === 0) {
  settingsDB.insert({
    id: 'app-config',
    initialized: false,
    wechatConnected: false,
    lastStarted: null,
    activeModelId: null
  })
}

// Initialize default model presets if empty
if (modelsDB.findAll().length === 0) {
  const defaults = [
    {
      id: 'claude-default',
      name: 'Claude (Anthropic)',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 1024,
      isActive: false,
      isPreset: true
    },
    {
      id: 'glm-default',
      name: 'GLM-4 (智谱)',
      provider: 'zhipu',
      model: 'glm-4-flash',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 1024,
      isActive: false,
      isPreset: true
    },
    {
      id: 'qwen-default',
      name: 'Qwen (阿里云)',
      provider: 'openai_compat',
      model: 'qwen-plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 1024,
      isActive: false,
      isPreset: true
    },
    {
      id: 'deepseek-default',
      name: 'Deepseek',
      provider: 'openai_compat',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 1024,
      isActive: false,
      isPreset: true
    },
    {
      id: 'openai-default',
      name: 'OpenAI GPT',
      provider: 'openai_compat',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 1024,
      isActive: false,
      isPreset: true
    }
  ]
  defaults.forEach(m => modelsDB.insert({ ...m, createdAt: new Date().toISOString() }))
}

export default { settingsDB, sourcesDB, messagesDB, todosDB, modelsDB }
