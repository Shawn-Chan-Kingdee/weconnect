/**
 * WeChat Message Monitor Service
 * Thin wrapper around BaseMonitorService.
 *
 * Working hours: Mon–Fri 09:00–20:00 Beijing time
 */
import { BaseMonitorService } from './base-monitor.js'
import browserService from './browser.js'

function isWithinWorkingHours() {
  const nowBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const dayOfWeek = nowBeijing.getUTCDay()    // 0=Sun … 6=Sat
  const hour = nowBeijing.getUTCHours()
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  return isWeekday && hour >= 9 && hour < 20
}

const monitorService = new BaseMonitorService({
  browserService,
  platform: 'wechat',
  logPrefix: 'Monitor',
  isWithinWorkingHours
})

export default monitorService
