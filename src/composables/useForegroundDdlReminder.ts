/**
 * 前台 DDL 提醒：应用打开期间定时拉取订阅来源中近期截止的通知，
 * 通过浏览器通知提醒一次（同一通知同一截止日只提醒一次）。
 * 不包含后台推送——页面关闭后由浏览器策略决定。
 */

import { onBeforeUnmount, onMounted } from 'vue'
import { useAccountStore } from '../stores/account'
import { useUserSettingsStore } from '../stores/userSettings'
import { normalizeNoticeSource } from '../types/notice'
import { calculateRemainingDays } from '../utils/date'
import { isNotificationSupported, sendNotification } from '../utils/notification'
import { fetchDeadlineNotices } from '../utils/request'

const CHECK_INTERVAL_MS = 30 * 60 * 1000
const REMINDER_WINDOW_DAYS = 1
const MAX_DEADLINES_TO_SCAN = 50
const TRACKING_STORAGE_KEY = 'notifai-ddl-reminders'
const TRACKING_LIMIT = 200

function loadTrackedReminders(storageKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey)
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

function trackReminder(storageKey: string, key: string): void {
  if (typeof window === 'undefined') return
  try {
    const tracked = loadTrackedReminders(storageKey)
    tracked.add(key)
    const next = Array.from(tracked).slice(-TRACKING_LIMIT)
    window.localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // 跟踪失败不阻塞提醒主流程
  }
}

/** 应用打开期间启动前台 DDL 检查；需授权通知且 store.notificationEnabled 开启。 */
export function useForegroundDdlReminder(): void {
  const store = useUserSettingsStore()
  const account = useAccountStore()
  const storageKey = store.accountId ? `${TRACKING_STORAGE_KEY}:${store.accountId}` : TRACKING_STORAGE_KEY
  let timer: ReturnType<typeof setInterval> | null = null
  let controller: AbortController | null = null
  let checking = false

  async function check(): Promise<void> {
    if (account.transitioning || (account.user && !account.cloudReady)) return
    if (!store.notificationEnabled || !isNotificationSupported()) return
    if (Notification.permission !== 'granted') return

    const sources =
      store.subscriptionMode === 'custom' && store.subscribedDepts.length > 0
        ? Array.from(new Set(store.subscribedDepts.map(normalizeNoticeSource)))
        : undefined
    if (sources?.length === 0) return

    if (checking) return
    checking = true
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    const tracked = loadTrackedReminders(storageKey)
    try {
      const result = await fetchDeadlineNotices(
        {
          days: REMINDER_WINDOW_DAYS,
          sources,
          page: 1,
          pageSize: MAX_DEADLINES_TO_SCAN,
        },
        requestController.signal,
      )

      for (const notice of result.items) {
        if (requestController.signal.aborted || account.transitioning) return

        const days = calculateRemainingDays(notice.deadline)
        if (days === null || days < 0 || days > REMINDER_WINDOW_DAYS) continue
        const searchableText =
          `${notice.title} ${normalizeNoticeSource(notice.source)} ${notice.aiSummary}`.toLocaleLowerCase()
        if (
          store.blacklistKeywords.some((keyword) =>
            searchableText.includes(keyword.toLocaleLowerCase()),
          )
        ) {
          continue
        }

        const key = `${notice.id}:${notice.deadline}`
        if (tracked.has(key)) continue
        sendNotification('NotifAI · DDL 提醒', {
          body: `${notice.title}\n截止日期：${notice.deadline}`,
        })
        trackReminder(storageKey, key)
        tracked.add(key)
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        // 前台提醒是增强功能，加载失败不应影响主页面。
        console.warn('[NotifAI] 前台 DDL 检查失败', error)
      }
    } finally {
      if (controller === requestController) controller = null
      checking = false
    }
  }

  onMounted(() => {
    void check()
    timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  })

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    timer = null
    controller?.abort()
    controller = null
  })
}
