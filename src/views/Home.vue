<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from '../stores/userSettings'
import {
  ApiConfigurationError,
  fetchDeadlineNotices,
  fetchNotices,
  fetchStats,
} from '../utils/request'
import type { FetchNoticesParams } from '../utils/request'
import type {
  DeadlineItem,
  NoticeCategoryKey,
  NoticeItem,
  NoticePaginationMode,
  StatsResponse,
} from '../types/notice'
import { getNoticeCategoryName, normalizeNoticeSource } from '../types/notice'
import NoticeCard from '../components/NoticeCard.vue'
import DdlNoticeBar from '../components/DdlNoticeBar.vue'
import SkeletonLoader from '../components/SkeletonLoader.vue'
import AdvancedSearch from '../components/AdvancedSearch.vue'
import type { SearchFilters, TriStateFilter } from '../components/AdvancedSearch.vue'
import { useWindowSize } from '../composables/useWindowSize'
import { calculateRemainingDays } from '../utils/date'
import { readNoticeFeedCache, writeNoticeFeedCache } from '../utils/noticeFeedCache'

const PAGE_SIZE = 15
const MAX_PAGES_PER_BATCH = 5
const PULL_THRESHOLD = 72
const URGENT_DDL_DAYS = 3
const URGENT_DDL_LIMIT = 10
const MAX_SERVER_EXCLUDE_IDS = 500

interface QueryContext {
  keyword: string
  source: string
  categories: NoticeCategoryKey[]
  dateFrom: string
  dateTo: string
  hasDeadline?: boolean
  isRead: TriStateFilter
  isStarred: TriStateFilter
  tags: string[]
  subscribedSources?: string[]
  blacklistKeywords: string[]
}

interface FetchBatchResult {
  items: NoticeItem[]
  nextPage: number
  nextCursor: string | null
  paginationMode: NoticePaginationMode
  finished: boolean
  scanPaused: boolean
  stale: boolean
  total: number
  invalidItemCount: number
}

interface FetchPageResult {
  items: NoticeItem[]
  page: number
  nextCursor: string | null
  paginationMode: NoticePaginationMode
  finished: boolean
  stale: boolean
  total: number
  invalidItemCount: number
}

type RetryAction = 'refresh' | 'load'

const router = useRouter()
const store = useUserSettingsStore()
const { isMobile } = useWindowSize()

const notices = ref<NoticeItem[]>([])
const searchQuery = ref('')
const loading = ref(false)
const finished = ref(false)
const scanPaused = ref(false)
const refreshing = ref(false)
const backgroundRefreshing = ref(false)
const nextPage = ref(1)
const nextCursor = ref<string | null>(null)
const paginationMode = ref<NoticePaginationMode>('offset')
const loadedTotal = ref<number | null>(null)
const invalidItemCount = ref(0)
const initialLoading = ref(true)
const requestError = ref('')
const retryAction = ref<RetryAction>('refresh')
const cacheStatusMessage = ref('')
const showAdvancedSearch = ref(false)
const advancedFilters = ref<SearchFilters | null>(null)
const noticeGrid = ref<HTMLElement | null>(null)
const pullDistance = ref(0)

let loadedQueryKey = ''
let pullStartY: number | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let requestController: AbortController | null = null
let statsController: AbortController | null = null
let loadSequence = 0

const serverStats = ref<StatsResponse | null>(null)
const urgentDeadlines = ref<DeadlineItem[]>([])
let deadlinesController: AbortController | null = null
let deadlinesRequestId = 0

function triStateBoolean(value: TriStateFilter): boolean | undefined {
  if (value === 'yes') return true
  if (value === 'no') return false
  return undefined
}

function buildQueryContext(): QueryContext {
  const filters = advancedFilters.value
  const subscribedSources =
    store.subscriptionMode === 'custom' && store.subscribedDepts.length > 0
      ? Array.from(new Set(store.subscribedDepts.map(normalizeNoticeSource)))
      : undefined
  const preferredCategories = store.categoryMode === 'custom' ? [...store.subscribedCategories] : []
  // 打开高级搜索后，其分类选择（包括空数组=全部分类）临时覆盖长期偏好。
  const selectedCategories = filters ? [...filters.categories] : preferredCategories

  return {
    keyword: (filters ? filters.keyword : searchQuery.value).trim().toLocaleLowerCase(),
    source: filters?.source ? normalizeNoticeSource(filters.source) : '',
    categories: selectedCategories,
    dateFrom: filters?.dateFrom || '',
    dateTo: filters?.dateTo || '',
    hasDeadline: triStateBoolean(filters?.hasDeadline ?? 'any'),
    isRead: filters?.isRead ?? 'any',
    isStarred: filters?.isStarred ?? 'any',
    tags: filters ? [...filters.tags] : [],
    subscribedSources,
    blacklistKeywords: [...store.blacklistKeywords],
  }
}

function buildServerParams(
  context: QueryContext,
  cursor: string | null,
  page: number,
  mode: NoticePaginationMode,
): FetchNoticesParams {
  const excludeIds = new Set<string>()
  if (context.isRead === 'no') {
    store.readIds.forEach((id) => excludeIds.add(id))
  }
  if (context.isStarred === 'no') {
    store.starredIds.forEach((id) => excludeIds.add(id))
  }

  return {
    keyword: context.keyword || undefined,
    source: context.source || undefined,
    categories: context.categories.length > 0 ? context.categories : undefined,
    sources: context.subscribedSources,
    dateFrom: context.dateFrom || undefined,
    dateTo: context.dateTo || undefined,
    hasDeadline: context.hasDeadline,
    light: true,
    // 后端最多接受 500 个排除 ID；其余记录仍会在客户端按本地状态二次过滤。
    excludeIds: excludeIds.size > 0 ? [...excludeIds].slice(0, MAX_SERVER_EXCLUDE_IDS) : undefined,
    // cursor 模式的第一页省略游标；后续只传服务端返回的游标。
    // 空字符串不是合法的不透明游标，不能用它代替“第一页”。
    cursor: mode === 'cursor' ? (cursor ?? undefined) : undefined,
    page: mode === 'offset' ? page : undefined,
    pageSize: PAGE_SIZE,
  }
}

function getQueryKey(context: QueryContext): string {
  return JSON.stringify(context)
}

function matchesLocalFilters(notice: NoticeItem, context: QueryContext): boolean {
  const source = normalizeNoticeSource(notice.source)
  if (context.source && source !== context.source) return false
  if (
    context.categories.length > 0 &&
    !notice.categories.some((category) => context.categories.includes(category))
  ) {
    return false
  }
  if (context.dateFrom && notice.publishDate < context.dateFrom) return false
  if (context.dateTo && notice.publishDate > context.dateTo) return false
  if (context.hasDeadline !== undefined && Boolean(notice.deadline) !== context.hasDeadline) {
    return false
  }
  if (context.subscribedSources && !context.subscribedSources.includes(source)) return false

  if (context.keyword) {
    const searchableText = `${notice.title} ${source} ${notice.aiSummary}`.toLocaleLowerCase()
    if (!searchableText.includes(context.keyword)) return false
  }

  if (context.isRead === 'yes' && !store.isRead(notice.id)) return false
  if (context.isRead === 'no' && store.isRead(notice.id)) return false
  if (context.isStarred === 'yes' && !store.isStarred(notice.id)) return false
  if (context.isStarred === 'no' && store.isStarred(notice.id)) return false

  if (context.blacklistKeywords.length > 0) {
    const searchableText = `${notice.title} ${source} ${notice.aiSummary}`.toLocaleLowerCase()
    if (context.blacklistKeywords.some((kw) => searchableText.includes(kw.toLocaleLowerCase()))) {
      return false
    }
  }

  if (context.tags.length > 0) {
    const noticeTags = store.customTags[notice.id] || []
    if (!context.tags.some((tag) => noticeTags.includes(tag))) return false
  }

  return true
}

function applyClientFilters(items: NoticeItem[], context: QueryContext): NoticeItem[] {
  return items.filter((notice) => matchesLocalFilters(notice, context))
}

const visibleUrgentDeadlines = computed(() => {
  if (store.blacklistKeywords.length === 0) return urgentDeadlines.value
  const keywords = store.blacklistKeywords.map((keyword) => keyword.toLocaleLowerCase())
  return urgentDeadlines.value.filter((notice) => {
    const searchableText =
      `${notice.title} ${normalizeNoticeSource(notice.source)} ${notice.aiSummary}`.toLocaleLowerCase()
    return !keywords.some((keyword) => searchableText.includes(keyword))
  })
})

function hasLocalFilters(context: QueryContext): boolean {
  return (
    context.isRead !== 'any' ||
    context.isStarred !== 'any' ||
    context.tags.length > 0 ||
    context.blacklistKeywords.length > 0
  )
}

function mergeUniqueNotices(existing: NoticeItem[], incoming: NoticeItem[]): NoticeItem[] {
  const seen = new Set(existing.map((n) => n.id))
  const merged = [...existing]
  for (const notice of incoming) {
    if (!seen.has(notice.id)) {
      seen.add(notice.id)
      merged.push(notice)
    }
  }
  return merged
}

function staleBatchResult(cursor: string | null, mode: NoticePaginationMode): FetchBatchResult {
  return {
    items: [],
    nextPage: 1,
    nextCursor: cursor,
    paginationMode: mode,
    finished: true,
    scanPaused: false,
    stale: true,
    total: 0,
    invalidItemCount: 0,
  }
}

function stalePageResult(
  cursor: string | null,
  page: number,
  mode: NoticePaginationMode,
): FetchPageResult {
  return {
    items: [],
    page,
    nextCursor: cursor,
    paginationMode: mode,
    finished: true,
    stale: true,
    total: 0,
    invalidItemCount: 0,
  }
}

function hasHttpStatus(error: unknown, status: number): boolean {
  if (typeof error !== 'object' || error === null || !('response' in error)) return false
  const response = (error as { response?: unknown }).response
  return typeof response === 'object' && response !== null && 'status' in response
    ? (response as { status?: unknown }).status === status
    : false
}

async function fetchPage(
  context: QueryContext,
  cursor: string | null,
  page: number,
  mode: NoticePaginationMode,
  signal: AbortSignal,
): Promise<FetchPageResult> {
  try {
    let effectiveMode = mode
    let response
    try {
      response = await fetchNotices(buildServerParams(context, cursor, page, mode), signal)
    } catch (error) {
      // 旧版后端可能要求首个请求显式携带 page。仅对首个请求回退到
      // offset，后续请求的游标错误必须继续暴露，避免静默重复加载错误页面。
      if (mode !== 'cursor' || cursor !== null || !hasHttpStatus(error, 400)) throw error
      effectiveMode = 'offset'
      response = await fetchNotices(buildServerParams(context, cursor, page, effectiveMode), signal)
    }
    if (signal.aborted) {
      return {
        items: [],
        page,
        nextCursor: cursor,
        paginationMode: effectiveMode,
        finished: true,
        stale: true,
        total: 0,
        invalidItemCount: 0,
      }
    }

    const responseNextCursor = response.nextCursor ?? null

    // 若服务端把空游标按旧 offset 请求处理，自动保持兼容；只有拿到
    // nextCursor 才继续使用 cursor 模式。
    if (
      effectiveMode === 'cursor' &&
      cursor === null &&
      responseNextCursor === null &&
      response.items.length > 0 &&
      page * PAGE_SIZE < response.total
    ) {
      effectiveMode = 'offset'
    }

    const filtered = applyClientFilters(response.items, context)
    return {
      items: filtered,
      page,
      nextCursor: effectiveMode === 'cursor' ? responseNextCursor : null,
      paginationMode: effectiveMode,
      finished:
        response.items.length === 0 ||
        (effectiveMode === 'cursor'
          ? responseNextCursor === null
          : page * PAGE_SIZE >= response.total),
      stale: false,
      total: response.total,
      invalidItemCount: response.invalidItemCount ?? 0,
    }
  } catch (error) {
    if (signal.aborted) return stalePageResult(cursor, page, mode)
    throw error
  }
}

/**
 * 读取一批服务端页面。高级搜索中的标签和屏蔽词属于本地状态，不能完全
 * 依赖后端分页结果；当第一页没有匹配项时，继续扫描有限的
 * 后续页面，避免首页误报“暂无通知”。
 */
async function fetchBatch(
  context: QueryContext,
  startCursor: string | null,
  startPage: number,
  startMode: NoticePaginationMode,
  signal: AbortSignal,
): Promise<FetchBatchResult> {
  const shouldScan = hasLocalFilters(context)
  const maxPages = shouldScan ? MAX_PAGES_PER_BATCH : 1
  let cursor = startCursor
  let page = startPage
  let mode = startMode
  let total = 0
  let finished = false
  let scanPaused = false
  let invalidItemCount = 0
  let pagesFetched = 0
  let items: NoticeItem[] = []

  for (; pagesFetched < maxPages; pagesFetched += 1) {
    const result = await fetchPage(context, cursor, page, mode, signal)
    if (result.stale) return staleBatchResult(cursor, mode)

    items = mergeUniqueNotices(items, result.items)
    finished = result.finished
    cursor = result.nextCursor
    mode = result.paginationMode
    page = result.page + 1
    total = result.total
    invalidItemCount += result.invalidItemCount

    if (finished || !shouldScan || items.length > 0) break
  }

  if (shouldScan && items.length === 0 && !finished) {
    scanPaused = pagesFetched >= maxPages
  }

  return {
    items,
    nextPage: page,
    nextCursor: mode === 'cursor' ? cursor : null,
    paginationMode: mode,
    finished,
    scanPaused,
    stale: false,
    total,
    invalidItemCount,
  }
}

function startNoticeRequest(): AbortController {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  return controller
}

interface LoadInitialOptions {
  allowCache?: boolean
  force?: boolean
}

function formatCacheTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadInitial(options: LoadInitialOptions = {}): Promise<void> {
  const sequence = ++loadSequence
  const context = buildQueryContext()
  const queryKey = getQueryKey(context)
  const force = options.force === true
  const hasCurrentData = queryKey === loadedQueryKey && loadedTotal.value !== null

  if (!force && hasCurrentData) {
    return
  }

  const controller = startNoticeRequest()

  requestError.value = ''
  let hasVisibleData = hasCurrentData
  let showingCachedData = false
  let cachedFetchedAt: string | null = null

  if (!hasVisibleData && options.allowCache) {
    try {
      const cached = await readNoticeFeedCache(queryKey)
      if (sequence !== loadSequence) return
      if (cached) {
        notices.value = cached.items
        nextPage.value = cached.nextPage
        nextCursor.value = cached.nextCursor ?? null
        paginationMode.value = cached.paginationMode ?? 'offset'
        finished.value = cached.finished
        scanPaused.value = cached.scanPaused
        loadedTotal.value = cached.total
        invalidItemCount.value = 0
        loadedQueryKey = queryKey
        hasVisibleData = true
        showingCachedData = true
        cachedFetchedAt = cached.fetchedAt
        cacheStatusMessage.value = cached.stale
          ? `当前显示的是较旧缓存（${formatCacheTimestamp(cached.fetchedAt)}），正在同步最新通知。`
          : `已显示缓存数据（${formatCacheTimestamp(cached.fetchedAt)}），正在同步最新通知。`
        store.cacheNotices(cached.items)
      }
    } catch {
      // IndexedDB 不可用或缓存损坏时，继续正常请求最新数据。
    }
  }

  if (sequence !== loadSequence) return

  if (!hasVisibleData) {
    loading.value = true
    initialLoading.value = true
    nextPage.value = 1
    nextCursor.value = null
    paginationMode.value = 'cursor'
    finished.value = false
    scanPaused.value = false
    loadedTotal.value = null
    invalidItemCount.value = 0
    notices.value = []
    cacheStatusMessage.value = ''
  } else {
    // 有缓存或当前数据时保留卡片，网络请求只显示顶部的轻量进度条。
    loading.value = false
    initialLoading.value = false
    if (force) cacheStatusMessage.value = ''
  }
  backgroundRefreshing.value = hasVisibleData

  try {
    const result = await fetchBatch(context, null, 1, 'cursor', controller.signal)
    if (result.stale || sequence !== loadSequence) return

    notices.value = result.items
    nextPage.value = result.nextPage
    nextCursor.value = result.nextCursor
    paginationMode.value = result.paginationMode
    finished.value = result.finished
    scanPaused.value = result.scanPaused
    loadedTotal.value = result.total
    invalidItemCount.value = result.invalidItemCount
    loadedQueryKey = queryKey
    store.cacheNotices(result.items)
    cacheStatusMessage.value = ''
    cachedFetchedAt = null
    void writeNoticeFeedCache({
      key: queryKey,
      items: result.items,
      total: result.total,
      nextPage: result.nextPage,
      nextCursor: result.nextCursor,
      paginationMode: result.paginationMode,
      finished: result.finished,
      scanPaused: result.scanPaused,
      fetchedAt: new Date().toISOString(),
    })
    void loadServerStats()
  } catch (error) {
    if (sequence !== loadSequence || (error instanceof Error && error.name === 'AbortError')) return

    const errorMessage =
      error instanceof ApiConfigurationError
        ? error.message
        : error instanceof Error
          ? error.message || '加载失败，请重试'
          : '加载失败，请重试'

    if (hasVisibleData) {
      cacheStatusMessage.value = ''
      const dataSourceMessage = showingCachedData
        ? `当前显示缓存数据（最后更新于 ${cachedFetchedAt ? formatCacheTimestamp(cachedFetchedAt) : '未知时间'}）`
        : '当前继续显示上一次加载的数据'
      requestError.value = `${errorMessage}，${dataSourceMessage}；可点击重试。`
      retryAction.value = 'refresh'
    } else if (error instanceof ApiConfigurationError) {
      requestError.value = error.message
    } else if (error instanceof Error) {
      requestError.value = error.message || '加载失败，请重试'
      console.error('[NotifAI] 通知加载失败:', error)
      retryAction.value = 'refresh'
    } else {
      requestError.value = '加载失败，请重试'
      retryAction.value = 'refresh'
    }
  } finally {
    if (requestController === controller) requestController = null
    if (sequence === loadSequence) {
      loading.value = false
      backgroundRefreshing.value = false
      initialLoading.value = false
    }
  }
}

async function loadMore(): Promise<void> {
  if (loading.value || backgroundRefreshing.value || finished.value) return

  const sequence = loadSequence
  const context = buildQueryContext()
  const queryKey = getQueryKey(context)
  const controller = startNoticeRequest()
  loading.value = true
  requestError.value = ''

  try {
    const result = await fetchBatch(
      context,
      nextCursor.value,
      nextPage.value,
      paginationMode.value,
      controller.signal,
    )
    if (result.stale || sequence !== loadSequence || queryKey !== loadedQueryKey) return

    const mergedNotices = mergeUniqueNotices(notices.value, result.items)
    notices.value = mergedNotices
    nextPage.value = result.nextPage
    nextCursor.value = result.nextCursor
    paginationMode.value = result.paginationMode
    finished.value = result.finished
    scanPaused.value = result.scanPaused
    loadedTotal.value = result.total
    invalidItemCount.value += result.invalidItemCount
    store.cacheNotices(result.items)
    void writeNoticeFeedCache({
      key: queryKey,
      items: mergedNotices,
      total: result.total,
      nextPage: result.nextPage,
      nextCursor: result.nextCursor,
      paginationMode: result.paginationMode,
      finished: result.finished,
      scanPaused: result.scanPaused,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      requestError.value = error.message
    } else if (error instanceof Error && error.name !== 'AbortError') {
      requestError.value = error.message || '加载失败，请重试'
      console.error('[NotifAI] 更多通知加载失败:', error)
      retryAction.value = 'load'
    }
  } finally {
    if (requestController === controller) requestController = null
    if (sequence === loadSequence) loading.value = false
  }
}

async function refresh(): Promise<void> {
  if (refreshing.value) return

  refreshing.value = true
  requestError.value = ''

  try {
    await loadInitial({ force: true })
  } finally {
    refreshing.value = false
  }
}

function retryRequest(): void {
  if (retryAction.value === 'refresh') {
    refresh()
  } else {
    loadMore()
  }
}

function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    refresh()
  }, 300)
}

function onSearchClear(): void {
  searchQuery.value = ''
  refresh()
}

function handleAdvancedSearch(filters: SearchFilters): void {
  advancedFilters.value = filters
  showAdvancedSearch.value = false
  refresh()
}

function clearAdvancedSearch(): void {
  advancedFilters.value = null
  refresh()
}

function goToDetail(id: string): void {
  router.push({ name: 'Detail', params: { id } })
}

function handleRead(id: string): void {
  store.markRead(id)
}

function handleStar(id: string): void {
  store.toggleStar(id)
}

function onScroll(): void {
  const el = noticeGrid.value
  if (!el || loading.value || finished.value || requestError.value) return
  // 滚动到距底部 240px 内时加载下一页
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
    loadMore()
  }
}

function onTouchStart(e: TouchEvent): void {
  pullStartY = e.touches[0]?.clientY ?? null
}

function onTouchMove(e: TouchEvent): void {
  if (pullStartY === null) return
  const currentY = e.touches[0]?.clientY ?? 0
  const distance = currentY - pullStartY

  if (distance > 0 && noticeGrid.value && noticeGrid.value.scrollTop === 0) {
    pullDistance.value = Math.min(distance, PULL_THRESHOLD * 1.5)
  }
}

function onTouchEnd(): void {
  if (pullDistance.value >= PULL_THRESHOLD) {
    refresh()
  }
  pullDistance.value = 0
  pullStartY = null
}

const pullReady = computed(() => pullDistance.value >= PULL_THRESHOLD)

const filteredNotices = computed(() => {
  // fetchBatch 会提前过滤以决定是否继续扫描分页；这里再过滤一次，
  // 让用户在当前页直接标记已读、收藏、加标签或修改屏蔽词后，列表能
  // 立即反映本地状态，而不必重新请求首页。
  const visibleNotices = applyClientFilters(notices.value, buildQueryContext())

  // 置顶通知浮动到列表顶部：
  // 最近置顶的排最前，非置顶项保留服务端顺序（发布日期倒序）。
  // 仅在 computed 内排序，不改动 notices.value，避免破坏分页一致性 / 重叠检测。
  const pinnedSet = new Set(store.pinnedIds)
  if (pinnedSet.size === 0) return visibleNotices
  const pinnedOrder = new Map(store.pinnedIds.map((id, i) => [id, i]))
  return [...visibleNotices].sort((a, b) => {
    const pa = pinnedSet.has(a.id)
    const pb = pinnedSet.has(b.id)
    if (pa && pb) {
      return (pinnedOrder.get(b.id) ?? 0) - (pinnedOrder.get(a.id) ?? 0)
    }
    if (pa) return -1
    if (pb) return 1
    return 0
  })
})

/** 基于已加载数据的轻量统计（本地兜底，诚实标注口径）。 */
const localStats = computed(() => {
  const loaded = filteredNotices.value
  const sources = new Set(loaded.map((notice) => normalizeNoticeSource(notice.source))).size
  let ddlSoon = 0
  for (const notice of loaded) {
    if (!notice.deadline) continue
    const days = calculateRemainingDays(notice.deadline)
    if (days !== null && days >= 0 && days <= 7) ddlSoon += 1
  }
  return { loaded: loaded.length, sources, ddlSoon }
})

/** 展示统计：当前列表的数字只来自当前已加载、已筛选的数据。 */
const displayStats = computed(() => {
  return localStats.value
})

/** 拉取全局统计，失败时静默保留本地兜底。 */
async function loadServerStats(): Promise<void> {
  statsController?.abort()
  const controller = new AbortController()
  statsController = controller
  try {
    serverStats.value = await fetchStats(controller.signal)
  } catch {
    // 统计失败不影响通知流，保留本地统计兜底
  } finally {
    if (statsController === controller) statsController = null
  }
}

/** 使用轻量截止日期端点加载全局紧急 DDL，并按用户订阅来源约束结果。 */
async function loadUrgentDeadlines(): Promise<void> {
  const requestId = ++deadlinesRequestId
  deadlinesController?.abort()

  const sources =
    store.subscriptionMode === 'custom' && store.subscribedDepts.length > 0
      ? Array.from(new Set(store.subscribedDepts.map(normalizeNoticeSource)))
      : undefined
  if (sources?.length === 0) {
    deadlinesController = null
    urgentDeadlines.value = []
    return
  }

  const controller = new AbortController()
  deadlinesController = controller
  try {
    const result = await fetchDeadlineNotices(
      {
        days: URGENT_DDL_DAYS,
        sources,
        page: 1,
        pageSize: URGENT_DDL_LIMIT,
      },
      controller.signal,
    )
    if (controller.signal.aborted || requestId !== deadlinesRequestId) return
    urgentDeadlines.value = [...result.items].sort(
      (a, b) => a.deadline.localeCompare(b.deadline) || a.id.localeCompare(b.id),
    )
  } catch {
    if (controller.signal.aborted || requestId !== deadlinesRequestId) return
    // DDL 横幅是增强信息；失败时保留上一批结果，不影响通知主列表。
  } finally {
    if (deadlinesController === controller) deadlinesController = null
  }
}

watch(
  () => store.subscriptionMode,
  () => {
    refresh()
    void loadUrgentDeadlines()
  },
)

// 监听订阅内容的快照而非数组引用：store.applySettings 在每次持久化时都会重建
// subscribedDepts / blacklistKeywords 的数组引用（内容相同），若直接监听引用，
// 收藏/置顶/加标签等无关操作也会触发 refresh 导致首页重新加载。
watch(
  () => store.subscribedDepts.join('\u0000'),
  () => {
    refresh()
    void loadUrgentDeadlines()
  },
)

watch(
  () => store.blacklistKeywords.join('\u0000'),
  () => {
    refresh()
  },
)

watch(
  () => store.categoryMode,
  () => {
    refresh()
  },
)

watch(
  () => store.subscribedCategories.join('\u0000'),
  () => {
    refresh()
  },
)

onMounted(() => {
  initialLoading.value = true
  void loadInitial({ allowCache: true })
  void loadUrgentDeadlines()
})

onBeforeUnmount(() => {
  loadSequence += 1
  requestController?.abort()
  statsController?.abort()
  deadlinesRequestId += 1
  deadlinesController?.abort()
  deadlinesController = null
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div class="home-page">
    <h1 class="sr-only">通知看板</h1>
    <!-- 搜索栏 -->
    <v-toolbar density="compact" color="surface">
      <v-text-field
        v-model="searchQuery"
        prepend-inner-icon="$magnify"
        placeholder="搜索通知..."
        hide-details
        density="compact"
        variant="outlined"
        clearable
        @update:model-value="onSearch"
        @click:clear="onSearchClear"
      />
      <v-btn
        icon
        :color="showAdvancedSearch ? 'primary' : 'default'"
        :aria-label="showAdvancedSearch ? '关闭高级搜索' : '打开高级搜索'"
        title="高级搜索"
        @click="showAdvancedSearch = !showAdvancedSearch"
      >
        <v-icon>$filterVariant</v-icon>
      </v-btn>
    </v-toolbar>

    <!-- 紧急 DDL 提示条：由轻量截止日期端点独立加载 -->
    <DdlNoticeBar :notices="visibleUrgentDeadlines" />

    <!-- 已加载数据统计概览 -->
    <div
      v-if="!initialLoading && !requestError"
      class="d-flex flex-wrap align-center ga-2 px-4 pt-2"
      role="status"
      aria-label="通知统计概览"
    >
      <v-chip size="x-small" variant="tonal" class="stats-chip">
        <v-icon start size="14">$fileDocumentOutline</v-icon>
        当前列表已加载 {{ displayStats.loaded }} 条
      </v-chip>
      <v-chip size="x-small" variant="tonal" class="stats-chip">
        <v-icon start size="14">$accountGroup</v-icon>
        当前列表覆盖 {{ displayStats.sources }} 个来源
      </v-chip>
      <v-chip
        size="x-small"
        variant="tonal"
        :color="displayStats.ddlSoon > 0 ? 'error' : 'default'"
        class="stats-chip"
      >
        <v-icon start size="14">$clockAlert</v-icon>
        当前列表近 7 天 DDL {{ displayStats.ddlSoon }} 个
      </v-chip>
      <v-chip v-if="serverStats" size="x-small" variant="outlined" class="stats-chip">
        <v-icon start size="14">$database</v-icon>
        全站共 {{ serverStats.total }} 条通知
      </v-chip>
    </div>

    <!-- 高级搜索提示 -->
    <v-alert
      v-if="advancedFilters"
      type="info"
      variant="tonal"
      density="compact"
      class="ma-2"
      rounded="0"
      closable
      @click:close="clearAdvancedSearch"
    >
      <span class="text-caption">
        高级搜索已启用
        <span v-if="advancedFilters.keyword">· 关键词: {{ advancedFilters.keyword }}</span>
        <span v-if="advancedFilters.categories.length">
          · 分类:
          {{ advancedFilters.categories.map(getNoticeCategoryName).join('、') }}
        </span>
      </span>
    </v-alert>

    <v-progress-linear
      v-if="(refreshing || backgroundRefreshing) && !initialLoading"
      indeterminate
      color="primary"
    />

    <!-- 初始加载骨架屏 -->
    <SkeletonLoader v-if="initialLoading" type="card" />

    <!-- 通知卡片网格 -->
    <div
      v-else
      ref="noticeGrid"
      class="notice-grid pa-4"
      @scroll="onScroll"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div
        v-if="pullDistance > 0"
        class="pull-indicator"
        :style="{ height: `${pullDistance}px` }"
        :aria-label="pullReady ? '松开即可刷新' : '继续下拉以刷新'"
        role="status"
      >
        <v-icon color="primary" :class="{ 'pull-indicator__icon--ready': pullReady }">
          $refresh
        </v-icon>
      </div>

      <v-alert
        v-if="cacheStatusMessage"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
        role="status"
      >
        {{ cacheStatusMessage }}
      </v-alert>

      <v-alert
        v-if="requestError"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4"
        role="alert"
      >
        {{ requestError }}
        <template #append>
          <v-btn variant="text" size="small" @click="retryRequest">重试</v-btn>
        </template>
      </v-alert>

      <v-alert
        v-if="invalidItemCount > 0 && !requestError"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4"
        role="status"
      >
        有 {{ invalidItemCount }} 条通知数据格式异常，已跳过；可刷新后重试。
      </v-alert>

      <v-alert
        v-if="scanPaused && !requestError"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
        role="status"
      >
        当前筛选在本批 {{ PAGE_SIZE * MAX_PAGES_PER_BATCH }} 条通知中暂无匹配，可继续查找后续页面。
      </v-alert>

      <v-row>
        <v-col
          v-for="(notice, index) in filteredNotices"
          :key="notice.id"
          cols="12"
          :sm="isMobile ? 12 : 6"
          :md="isMobile ? 12 : 4"
          :lg="isMobile ? 12 : 3"
          class="notice-col"
          :style="{ animationDelay: `${(index % 10) * 50}ms` }"
        >
          <NoticeCard
            :notice="notice"
            :is-read="store.isRead(notice.id)"
            @click="goToDetail"
            @read="handleRead"
            @star="handleStar"
          />
        </v-col>
      </v-row>

      <!-- 加载状态 -->
      <v-card v-if="loading" flat class="text-center pa-8 bg-transparent">
        <v-progress-circular indeterminate color="primary" />
        <div class="text-caption mt-2">加载中...</div>
      </v-card>

      <div v-else-if="!finished && !requestError" class="d-flex justify-center pa-4">
        <v-btn variant="tonal" color="primary" @click="loadMore">
          {{ scanPaused ? '继续查找' : '加载更多' }}
        </v-btn>
      </div>

      <v-alert
        v-if="finished && filteredNotices.length > 0 && !requestError"
        type="info"
        variant="tonal"
        density="compact"
        class="mx-4"
        icon="$checkCircleOutline"
      >
        没有更多通知了
      </v-alert>

      <v-card
        v-if="
          filteredNotices.length === 0 &&
          !loading &&
          !requestError &&
          !scanPaused &&
          invalidItemCount === 0
        "
        flat
        class="text-center pa-8 bg-transparent"
      >
        <v-icon size="64" color="grey">$inboxOutline</v-icon>
        <v-card-title class="text-medium-emphasis">暂无通知</v-card-title>
      </v-card>
    </div>

    <!-- 高级搜索对话框 -->
    <AdvancedSearch
      v-if="showAdvancedSearch"
      :initial-filters="advancedFilters ?? undefined"
      @search="handleAdvancedSearch"
      @close="showAdvancedSearch = false"
    />
  </div>
</template>

<style scoped>
.home-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-background));
}

.notice-grid {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.pull-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.pull-indicator :deep(.v-icon) {
  transition: transform 0.2s ease;
}

.pull-indicator__icon--ready {
  transform: rotate(180deg);
}

/* 卡片入场动画 */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.notice-col {
  animation: fadeInUp 0.4s ease-out both;
}
</style>
