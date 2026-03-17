/**
 * Feishu (飞书) Message Monitor Service
 * Thin wrapper around BaseMonitorService.
 *
 * Working hours: daily 08:00–22:00 Beijing time (including weekends)
 */
import { BaseMonitorService } from './base-monitor.js'
import feishuBrowserService from './feishu-browser.js'

function isWithinWorkingHours() {
  const nowBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const hour = nowBeijing.getUTCHours()
  return hour >= 8 && hour < 22
}

const feishuMonitorService = new BaseMonitorService({
  browserService: feishuBrowserService,
  platform: 'feishu',
  logPrefix: 'Feishu-Monitor',
  isWithinWorkingHours
})

export default feishuMonitorService
