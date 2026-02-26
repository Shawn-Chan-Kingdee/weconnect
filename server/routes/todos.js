/**
 * Todo List Routes (Enhanced)
 * - Dashboard separates today's new vs historical pending
 * - isHistorical flag from lifecycle migration
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { todosDB } from '../db.js'

const router = Router()

// Get all todos
router.get('/', (req, res) => {
  const { date, completed } = req.query
  let todos = todosDB.findAll()

  if (date) {
    todos = todos.filter(t => t.date === date)
  }
  if (completed !== undefined) {
    todos = todos.filter(t => t.completed === (completed === 'true'))
  }

  // Sort: incomplete first, then by date descending
  todos.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  res.json(todos)
})

// Get today's new todos + historical uncompleted
router.get('/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0]
  const allTodos = todosDB.findAll()

  // Today's new: created today, not marked as historical
  const todayNew = allTodos.filter(t => t.date === today && !t.isHistorical)

  // Historical pending: either marked isHistorical OR from previous days and not completed
  const historicalPending = allTodos.filter(t => {
    if (t.completed) return false
    if (t.isHistorical) return true
    if (t.date < today) return true
    return false
  })

  // Sort each group
  todayNew.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  historicalPending.sort((a, b) => {
    // Sort by original date descending (most recent first)
    const dateA = a.originalDate || a.date
    const dateB = b.originalDate || b.date
    return dateB.localeCompare(dateA)
  })

  res.json({ todayNew, historicalPending, today })
})

// Create a todo manually
router.post('/', (req, res) => {
  const { content, sourceName, category } = req.body
  const todo = todosDB.insert({
    id: uuidv4(),
    sourceName: sourceName || '手动创建',
    messageId: null,
    content,
    category: category || '新事项登记',
    completed: false,
    isHistorical: false,
    date: new Date().toISOString().split('T')[0],
    completedAt: null
  })
  res.json(todo)
})

// Toggle todo completion
router.put('/:id/toggle', (req, res) => {
  const todo = todosDB.findById(req.params.id)
  if (!todo) {
    return res.status(404).json({ error: '待办事项未找到' })
  }

  const today = new Date().toISOString().split('T')[0]

  // If trying to uncomplete a historical completed item, reject
  if (todo.completed && todo.isHistorical) {
    return res.status(400).json({ error: '历史已办结事项不可恢复' })
  }

  const updated = todosDB.update(req.params.id, {
    completed: !todo.completed,
    completedAt: !todo.completed ? new Date().toISOString() : null
  })

  res.json(updated)
})

// Delete a todo
router.delete('/:id', (req, res) => {
  const removed = todosDB.remove(req.params.id)
  if (!removed) {
    return res.status(404).json({ error: '待办事项未找到' })
  }
  res.json({ success: true })
})

export default router
