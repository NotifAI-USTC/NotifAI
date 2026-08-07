/**
 * 前台 DDL 提醒：应用打开期间定时扫描"近期截止"的收藏通知，
 * 通过浏览器通知提醒一次（同一通知同一截止日只提醒一次）。
 * 不包含后台推送——页面关闭后由浏览器策略决定。
 */

import { onBeforeUnmount, onMounted } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import { fetchNoticeById } from '../utils/request'
import { calculateRemainingDays } from '../utils/date'
import { isNotificationSupported, sendNotification } from '../utils/notification'

const CHECK_INTERVAL_MS = 30 * 60 * 1000
const REMINDER_WINDOW_DAYS = 1
const MAX_STARRED_TO_SCAN = 20
const TRACKING_STORAGE_KEY = 'notifai-ddl-reminders'
const TRACKING_LIMIT = 200

function loadTrackedReminders(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(TRACKING_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((item): item is string => typeof item === 'string' && item.length <= 256),
    )
  } catch {
    return new Set()
  }
}

function trackReminder(key: string): void {
  if (typeof window === 'undefined') return
  try {
    const tracked = loadTrackedReminders()
    tracked.add(key)
    const next = Array.from(tracked).slice(-TRACKING_LIMIT)
    window.localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 跟踪失败不阻塞提醒主流程
  }
}

/** 应用打开期间启动前台 DDL 检查；需授权通知且 store.notificationEnabled 开启。 */
export function useForegroundDdlReminder(): void {
  const store = useUserSettingsStore()
  let timer: ReturnType<typeof setInterval> | null = null

  async function check(): Promise<void> {
    if (!store.notificationEnabled || !isNotificationSupported()) return
    if (Notification.permission !== 'granted') return

    const ids = store.urgentStarredIds.slice(-MAX_STARRED_TO_SCAN)
    if (ids.length === 0) return

    const tracked = loadTrackedReminders()
    for (const id of ids) {
      const cached = store.getCachedNotice(id)
      const notice = cached ?? (await fetchNoticeById(id).catch(() => null))
      if (!notice?.deadline) continue

      const days = calculateRemainingDays(notice.deadline)
      if (days === null || days < 0 || days > REMINDER_WINDOW_DAYS) continue

      const key = `${id}:${notice.deadline}`
      if (tracked.has(key)) continue
      sendNotification('NotifAI · DDL 提醒', {
        body: `${notice.title}\n截止日期：${notice.deadline}`,
      })
      trackReminder(key)
      tracked.add(key)
    }
  }

  onMounted(() => {
    void check()
    timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  })

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    timer = null
  })
}
