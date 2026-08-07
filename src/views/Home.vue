<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from '../stores/userSettings'
import { ApiConfigurationError, fetchNotices } from '../utils/request'
import type { FetchNoticesParams } from '../utils/request'
import type { NoticeItem } from '../types/notice'
import { normalizeNoticeSource } from '../types/notice'
import NoticeCard from '../components/NoticeCard.vue'
import DdlNoticeBar from '../components/DdlNoticeBar.vue'
import SkeletonLoader from '../components/SkeletonLoader.vue'
import AdvancedSearch from '../components/AdvancedSearch.vue'
import type { SearchFilters, TriStateFilter } from '../components/AdvancedSearch.vue'
import { useWindowSize } from '../composables/useWindowSize'
import { isOffsetPageExhausted, isOffsetPageInconsistent } from '../utils/pagination'
import { calculateRemainingDays } from '../utils/date'

const PAGE_SIZE = 15
const MAX_PAGES_PER_BATCH = 5
const PULL_THRESHOLD = 72

interface QueryContext {
  keyword: string
  source: string
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
  rawCount: number
  nextPage: number
  finished: boolean
  scanPaused: boolean
  stale: boolean
  total: number
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
const nextPage = ref(1)
const loadedTotal = ref<number | null>(null)
const initialLoading = ref(true)
const requestError = ref('')
const retryAction = ref<RetryAction>('refresh')
const showAdvancedSearch = ref(false)
const advancedFilters = ref<SearchFilters | null>(null)
const noticeGrid = ref<HTMLElement | null>(null)
const pullDistance = ref(0)

let loadedQueryKey = ''
let pullStartY: number | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let requestController: AbortController | null = null

function triStateBoolean(value: TriStateFilter): boolean | undefined {
  if (value === 'yes') return true
  if (value === 'no') return false
  return undefined
}

function buildQueryContext(): QueryContext {
  const filters = advancedFilters.value
  const subscribedSources =
    store.subscriptionMode === 'custom'
      ? Array.from(new Set(store.subscribedDepts.map(normalizeNoticeSource)))
      : undefined

  return {
    keyword: (filters ? filters.keyword : searchQuery.value).trim().toLocaleLowerCase(),
    source: filters?.source ? normalizeNoticeSource(filters.source) : '',
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

function buildServerParams(context: QueryContext, page: number): FetchNoticesParams {
  return {
    keyword: context.keyword || undefined,
    source: context.source || undefined,
    sources: context.subscribedSources,
    dateFrom: context.dateFrom || undefined,
    dateTo: context.dateTo || undefined,
    hasDeadline: context.hasDeadline,
    page,
    pageSize: PAGE_SIZE,
  }
}

function getQueryKey(context: QueryContext): string {
  return JSON.stringify(context)
}

function matchesLocalFilters(notice: NoticeItem, context: QueryContext): boolean {
  const source = normalizeNoticeSource(notice.source)
  if (context.source && source !== context.source) return false
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

async function fetchBatch(context: QueryContext, page: number): Promise<FetchBatchResult> {
  const params = buildServerParams(context, page)
  const controller = new AbortController()
  requestController?.abort()
  requestController = controller

  try {
    const response = await fetchNotices(params, controller.signal)
    if (controller.signal.aborted) {
      return {
        items: [],
        rawCount: 0,
        nextPage: page,
        finished: true,
        scanPaused: false,
        stale: true,
        total: 0,
      }
    }

    const filtered = applyClientFilters(response.items, context)
    const total = response.total
    const exhausted = isOffsetPageExhausted({
      itemCount: response.items.length,
      page,
      pageSize: PAGE_SIZE,
      total,
    })

    return {
      items: filtered,
      rawCount: response.items.length,
      nextPage: page + 1,
      finished: exhausted,
      scanPaused: false,
      stale: false,
      total,
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        items: [],
        rawCount: 0,
        nextPage: page,
        finished: true,
        scanPaused: false,
        stale: true,
        total: 0,
      }
    }
    throw error
  }
}

async function loadInitial(): Promise<void> {
  const context = buildQueryContext()
  const queryKey = getQueryKey(context)

  if (queryKey === loadedQueryKey && notices.value.length > 0) {
    return
  }

  loading.value = true
  requestError.value = ''
  nextPage.value = 1
  finished.value = false
  scanPaused.value = false
  notices.value = []

  try {
    const result = await fetchBatch(context, 1)
    if (result.stale) return

    // 分页一致性：非最后一页必须返回满页，否则视为数据源异常
    if (
      isOffsetPageInconsistent({
        itemCount: result.rawCount,
        page: 1,
        pageSize: PAGE_SIZE,
        total: result.total,
      })
    ) {
      requestError.value = '通知加载失败'
      retryAction.value = 'refresh'
      return
    }

    notices.value = result.items
    nextPage.value = result.nextPage
    finished.value = result.finished
    scanPaused.value = result.scanPaused
    loadedTotal.value = result.total
    loadedQueryKey = queryKey
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      requestError.value = error.message
    } else if (error instanceof Error && error.name !== 'AbortError') {
      requestError.value = error.message || '加载失败，请重试'
      console.error('[NotifAI] 通知加载失败:', error)
      retryAction.value = 'refresh'
    }
  } finally {
    loading.value = false
    initialLoading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loading.value || finished.value) return

  const context = buildQueryContext()
  loading.value = true
  requestError.value = ''

  try {
    const result = await fetchBatch(context, nextPage.value)
    if (result.stale) return

    // 分页一致性：新页与已加载记录重叠，说明数据源排序不稳定
    const existingIds = new Set(notices.value.map((n) => n.id))
    const overlap = result.items.some((n) => existingIds.has(n.id))
    if (overlap) {
      requestError.value = '更多通知加载失败'
      retryAction.value = 'load'
      return
    }

    notices.value = mergeUniqueNotices(notices.value, result.items)
    nextPage.value = result.nextPage
    finished.value = result.finished
    scanPaused.value = result.scanPaused
    loadedTotal.value = result.total
  } catch (error) {
    if (error instanceof ApiConfigurationError) {
      requestError.value = error.message
    } else if (error instanceof Error && error.name !== 'AbortError') {
      requestError.value = error.message || '加载失败，请重试'
      console.error('[NotifAI] 更多通知加载失败:', error)
      retryAction.value = 'load'
    }
  } finally {
    loading.value = false
  }
}

async function refresh(): Promise<void> {
  if (refreshing.value) return

  refreshing.value = true
  requestError.value = ''
  loadedQueryKey = ''

  try {
    await loadInitial()
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
  // 已经在 fetchBatch 中过滤了
  return notices.value
})

/** 基于已加载数据的轻量统计（诚实标注口径）。 */
const stats = computed(() => {
  const loaded = filteredNotices.value
  const sources = new Set(loaded.map((notice) => normalizeNoticeSource(notice.source))).size
  let ddlSoon = 0
  for (const notice of loaded) {
    if (!notice.deadline) continue
    const days = calculateRemainingDays(notice.deadline)
    if (days !== null && days >= 0 && days <= 7) ddlSoon += 1
  }
  return { loaded: loaded.length, total: loadedTotal.value, sources, ddlSoon }
})

watch(
  () => store.subscriptionMode,
  () => {
    loadedQueryKey = ''
    refresh()
  },
)

// 监听订阅内容的快照而非数组引用：store.applySettings 在每次持久化时都会重建
// subscribedDepts / blacklistKeywords 的数组引用（内容相同），若直接监听引用，
// 收藏/置顶/加标签等无关操作也会触发 refresh 导致首页重新加载。
watch(
  () => store.subscribedDepts.join('\u0000'),
  () => {
    loadedQueryKey = ''
    refresh()
  },
)

watch(
  () => store.blacklistKeywords.join('\u0000'),
  () => {
    loadedQueryKey = ''
    refresh()
  },
)

onMounted(() => {
  initialLoading.value = true
  loadInitial()
})

onBeforeUnmount(() => {
  requestController?.abort()
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div class="home-page">
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
        @click="showAdvancedSearch = !showAdvancedSearch"
      >
        <v-icon>$filterVariant</v-icon>
      </v-btn>
    </v-toolbar>

    <!-- 紧急 DDL 提示条：仅在实际数据加载完成后显示 -->
    <DdlNoticeBar v-if="!initialLoading && filteredNotices.length > 0" :notices="filteredNotices" />

    <!-- 已加载数据统计概览 -->
    <div
      v-if="!initialLoading && !requestError && stats.loaded > 0"
      class="d-flex flex-wrap align-center ga-2 px-4 pt-2"
      role="status"
      aria-label="通知统计概览"
    >
      <v-chip size="x-small" variant="tonal" class="stats-chip">
        <v-icon start size="14">$fileDocumentOutline</v-icon>
        共 {{ stats.total }} 条 · 已加载 {{ stats.loaded }}
      </v-chip>
      <v-chip size="x-small" variant="tonal" class="stats-chip">
        <v-icon start size="14">$accountGroup</v-icon>
        {{ stats.sources }} 个来源
      </v-chip>
      <v-chip
        size="x-small"
        variant="tonal"
        :color="stats.ddlSoon > 0 ? 'error' : 'default'"
        class="stats-chip"
      >
        <v-icon start size="14">$clockAlert</v-icon>
        近 7 天 DDL {{ stats.ddlSoon }} 个
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
      </span>
    </v-alert>

    <v-progress-linear v-if="refreshing && !initialLoading" indeterminate color="primary" />

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
        v-if="filteredNotices.length === 0 && !loading && !requestError"
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
