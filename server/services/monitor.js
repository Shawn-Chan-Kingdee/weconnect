/**
 * WeChat Message Monitor Service
 * Thin wrapper around BaseMonitorService.
 *
 * Working hours: Daily 09:00–21:00 Beijing time (including weekends)
 */
import { BaseMonitorService } from './base-monitor.js'
import browserService from './browser.js'

function isWithinWorkingHours() {
  const nowBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const hour = nowBeijing.getUTCHours()
  return hour >= 9 && hour < 21
}

const monitorService = new BaseMonitorService({
  browserService,
  platform: 'wechat',
  logPrefix: 'Monitor',
  isWithinWorkingHours
})

export default monitorService
