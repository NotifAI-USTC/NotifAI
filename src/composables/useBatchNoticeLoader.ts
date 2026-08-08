import type { NoticeItem } from '../types/notice'
import { useUserSettingsStore } from '../stores/userSettings'
import { fetchNoticesByIds } from '../utils/request'
import { isValidNoticeId } from '../utils/validation'

const MAX_BATCH_SIZE = 500

export interface BatchNoticeLoaderOptions {
  /** 最多读取最近多少个 ID；默认与接口上限一致。 */
  maxIds?: number
  /** 单次 POST /notices/batch 的 ID 数量；不会超过接口上限。 */
  batchSize?: number
  signal?: AbortSignal
  /** 详情已成功加载/从缓存恢复后，是否展示该条通知。 */
  include?: (notice: NoticeItem) => boolean
}

export interface BatchNoticeLoaderResult {
  items: NoticeItem[]
  omittedCount: number
  staleFallbackCount: number
  failedCount: number
}

function createAbortError(): Error {
  return new DOMException('请求已取消', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

/**
 * 统一加载本地 ID 对应的通知详情。
 *
 * 收藏页、重要 DDL 和前台提醒都需要“按 ID 找详情 + 分批请求 + 缓存
 * fallback”。集中在这里可以保证三处都具备相同的去重、取消和离线兜底行为。
 */
export async function loadBatchNotices(
  ids: readonly string[],
  options: BatchNoticeLoaderOptions = {},
): Promise<BatchNoticeLoaderResult> {
  const store = useUserSettingsStore()
  const maxIds = Math.max(1, Math.floor(options.maxIds ?? MAX_BATCH_SIZE))
  const batchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, Math.floor(options.batchSize ?? MAX_BATCH_SIZE)),
  )
  const uniqueIds = Array.from(new Set(ids)).filter(isValidNoticeId)
  const selectedIds = uniqueIds.slice(-maxIds)
  const omittedCount = uniqueIds.length - selectedIds.length
  const items: NoticeItem[] = []
  const seenItems = new Set<string>()
  let staleFallbackCount = 0
  let failedCount = 0

  const appendIfIncluded = (notice: NoticeItem): void => {
    if (seenItems.has(notice.id)) return
    if (options.include && !options.include(notice)) return
    seenItems.add(notice.id)
    items.push(notice)
  }

  const useCachedFallback = (id: string): void => {
    const cached = store.getCachedNotice(id)
    if (!cached || cached.id !== id) {
      failedCount += 1
      return
    }
    const before = seenItems.has(id)
    appendIfIncluded(cached)
    if (!before && seenItems.has(id)) staleFallbackCount += 1
  }

  for (let start = 0; start < selectedIds.length; start += batchSize) {
    throwIfAborted(options.signal)
    const chunk = selectedIds.slice(start, start + batchSize)
    const chunkIds = new Set(chunk)

    try {
      const response = await fetchNoticesByIds(chunk, options.signal)
      throwIfAborted(options.signal)

      const receivedIds = new Set<string>()
      for (const notice of response.items) {
        // 即使后端误返回了请求外的条目，也不能将其混入当前用户列表。
        if (!chunkIds.has(notice.id) || receivedIds.has(notice.id)) continue
        receivedIds.add(notice.id)
        store.cacheNotice(notice)
        appendIfIncluded(notice)
      }

      // 以请求 ID 与响应 ID 的差集为准，而不只依赖 missing 字段；这样
      // 即使后端漏报 missing，也仍能安全地从本地缓存恢复。
      for (const id of chunk) {
        if (!receivedIds.has(id)) useCachedFallback(id)
      }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error
      }

      // 整批网络失败时保留旧详情，避免收藏/DDL 页面因瞬时断网变成空白。
      for (const id of chunk) {
        throwIfAborted(options.signal)
        useCachedFallback(id)
      }
    }
  }

  return { items, omittedCount, staleFallbackCount, failedCount }
}
