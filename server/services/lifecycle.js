/**
 * Lifecycle Service
 * Runs on server startup:
 * 1. Migrate yesterday's pending + historical pending todos → today's historical pending
 * 2. Purge messages/todos older than 10 days
 */
import { messagesDB, todosDB } from '../db.js'

/**
 * Get date string N days ago from today
 */
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

/**
 * Migrate incomplete todos from previous days into today's "historical pending"
 * - Find all todos where date < today AND completed === false
 * - Mark them as isHistorical = true (keep their original date for reference)
 */
function migratePendingTodos() {
  const today = new Date().toISOString().split('T')[0]
  const allTodos = todosDB.findAll()
  let migratedCount = 0

  for (const todo of allTodos) {
    if (todo.date < today && !todo.completed && !todo.isHistorical) {
      todosDB.update(todo.id, {
        isHistorical: true,
        originalDate: todo.originalDate || todo.date
      })
      migratedCount++
    }
  }

  if (migratedCount > 0) {
    console.log(`[Lifecycle] Migrated ${migratedCount} pending todo(s) to historical.`)
  }
}

/**
 * Purge records older than 10 days
 * - Remove messages with date < 10 days ago
 * - Remove completed todos with date < 10 days ago
 * - Keep incomplete historical todos (they still need attention)
 */
function purgeOldRecords() {
  const cutoffDate = daysAgo(10)
  const allMessages = messagesDB.findAll()
  const allTodos = todosDB.findAll()
  let msgPurged = 0
  let todoPurged = 0

  // Purge old messages
  for (const msg of allMessages) {
    if (msg.date && msg.date < cutoffDate) {
      messagesDB.remove(msg.id)
      msgPurged++
    }
  }

  // Purge old completed todos (keep old incomplete ones - they still need attention)
  for (const todo of allTodos) {
    const todoDate = todo.originalDate || todo.date
    if (todoDate && todoDate < cutoffDate && todo.completed) {
      todosDB.remove(todo.id)
      todoPurged++
    }
  }

  if (msgPurged > 0 || todoPurged > 0) {
    console.log(`[Lifecycle] Purged ${msgPurged} message(s) and ${todoPurged} completed todo(s) older than 10 days.`)
  }
}

/**
 * Run all startup lifecycle tasks
 */
export function runStartupTasks() {
  console.log('[Lifecycle] Running startup tasks...')

  try {
    migratePendingTodos()
    purgeOldRecords()
    console.log('[Lifecycle] Startup tasks completed.')
  } catch (err) {
    console.error('[Lifecycle] Startup task error:', err)
  }
}

export default { runStartupTasks }
