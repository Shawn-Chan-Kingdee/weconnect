/**
 * Yunzhijia (云之家) Message Monitor Service
 * Thin wrapper around BaseMonitorService.
 *
 * Working hours: daily 07:00–22:00 Beijing time (including weekends)
 */
import { BaseMonitorService } from './base-monitor.js'
import yzjBrowserService from './yunzhijia-browser.js'

function isWithinWorkingHours() {
  const nowBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const hour = nowBeijing.getUTCHours()
  return hour >= 7 && hour < 22
}

const yunzhijiaMonitorService = new BaseMonitorService({
  browserService: yzjBrowserService,
  platform: 'yunzhijia',
  logPrefix: 'YZJ-Monitor',
  isWithinWorkingHours
})

export default yunzhijiaMonitorService
