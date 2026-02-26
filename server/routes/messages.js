/**
 * Message Log Routes
 */
import { Router } from 'express'
import { messagesDB } from '../db.js'

const router = Router()

// Get messages by date and source
router.get('/', (req, res) => {
  const { date, source } = req.query
  let messages = messagesDB.findAll()

  if (date) {
    messages = messages.filter(m => m.date === date)
  }
  if (source) {
    messages = messages.filter(m => m.sourceName === source)
  }

  // Sort by senderTime descending
  messages.sort((a, b) => {
    const ta = new Date(a.senderTime || a.createdAt).getTime()
    const tb = new Date(b.senderTime || b.createdAt).getTime()
    return tb - ta
  })

  res.json(messages)
})

// Get message detail
router.get('/:id', (req, res) => {
  const msg = messagesDB.findById(req.params.id)
  if (!msg) {
    return res.status(404).json({ error: '消息未找到' })
  }
  res.json(msg)
})

// Get date range with message counts
router.get('/stats/dates', (req, res) => {
  const messages = messagesDB.findAll()
  const dateCounts = {}
  messages.forEach(m => {
    const d = m.date || 'unknown'
    dateCounts[d] = (dateCounts[d] || 0) + 1
  })
  res.json(dateCounts)
})

// Get summary stats for dashboard
router.get('/stats/summary', (req, res) => {
  const today = new Date().toISOString().split('T')[0]
  const allMessages = messagesDB.findAll()
  const todayMessages = allMessages.filter(m => m.date === today)

  res.json({
    totalToday: todayMessages.length,
    totalAll: allMessages.length,
    byCategory: {
      daily: todayMessages.filter(m => m.category === '日常沟通').length,
      business: todayMessages.filter(m => m.category === '业务咨询').length,
      followup: todayMessages.filter(m => m.category === '事项跟进').length,
      newItem: todayMessages.filter(m => m.category === '新事项登记').length
    }
  })
})

export default router
