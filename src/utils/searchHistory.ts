/** 高级搜索关键词历史的校验存储（LocalStorage）。 */

const SEARCH_HISTORY_STORAGE_KEY = 'notifai-search-history'
const SEARCH_HISTORY_LIMIT = 10
const SEARCH_HISTORY_ITEM_MAX_LENGTH = 200

function isValidHistoryItem(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= SEARCH_HISTORY_ITEM_MAX_LENGTH
}

/** 读取搜索历史，损坏数据回退为空列表。 */
export function loadSearchHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const items: string[] = []
    for (const candidate of parsed) {
      if (!isValidHistoryItem(candidate) || seen.has(candidate)) continue
      seen.add(candidate)
      items.push(candidate)
      if (items.length >= SEARCH_HISTORY_LIMIT) break
    }
    return items
  } catch {
    return []
  }
}

/** 记录一条关键词并返回更新后的历史（最近的在最前，去重）。 */
export function recordSearchHistory(keyword: string): string[] {
  const trimmed = keyword.trim()
  if (!trimmed) return loadSearchHistory()
  const history = loadSearchHistory().filter((item) => item !== trimmed)
  history.unshift(trimmed)
  const next = history.slice(0, SEARCH_HISTORY_LIMIT)
  try {
    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存储不可用时搜索仍可用
  }
  return next
}

/** 清空搜索历史。 */
export function clearSearchHistory(): void {
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY)
  } catch {
    // 存储不可用时忽略
  }
}
