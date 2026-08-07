<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from '../stores/userSettings'
import { fetchNoticesByIds } from '../utils/request'
import type { NoticeItem } from '../types/notice'
import NoticeCard from '../components/NoticeCard.vue'
import SkeletonLoader from '../components/SkeletonLoader.vue'
import { useWindowSize } from '../composables/useWindowSize'

const BATCH_SIZE = 500
const REQUEST_LIMIT = 1000

const router = useRouter()
const store = useUserSettingsStore()
const { isMobile } = useWindowSize()

const notices = ref<NoticeItem[]>([])
const loading = ref(true)
const loadError = ref('')
const selectedFolder = ref<string | null>(null)
let requestId = 0
let controller: AbortController | null = null

/** 收藏夹筛选：全部 + 各收藏夹（含默认收藏夹） */
const folderTabs = computed(() => [
  { id: null as string | null, name: '全部' },
  ...store.folders.map((folder) => ({ id: folder.id, name: folder.name })),
])

const filteredNotices = computed(() => {
  if (!selectedFolder.value) return notices.value
  return notices.value.filter(
    (notice) => (store.starredFolderMap[notice.id] ?? 'default') === selectedFolder.value,
  )
})

async function loadFavorites(): Promise<void> {
  const rid = ++requestId
  controller?.abort()
  const ctrl = new AbortController()
  controller = ctrl

  const allIds = [...store.starredIds]
  const omittedCount = Math.max(0, allIds.length - REQUEST_LIMIT)
  const ids = allIds.slice(-REQUEST_LIMIT)
  const items: NoticeItem[] = []
  let failedCount = 0
  let staleFallbackCount = 0

  loading.value = true
  loadError.value = ''

  try {
    // 分批调用批量详情接口（每批 ≤ 500），替代原来的 N+1 逐条请求
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      if (ctrl.signal.aborted || rid !== requestId) return
      const chunk = ids.slice(start, start + BATCH_SIZE)
      try {
        const result = await fetchNoticesByIds(chunk, ctrl.signal)
        if (ctrl.signal.aborted || rid !== requestId) return
        for (const notice of result.items) {
          store.cacheNotice(notice)
          items.push(notice)
        }
        // 后端缺失的 ID 回退到本地缓存
        for (const missingId of result.missing) {
          const cached = store.getCachedNotice(missingId)
          if (cached) {
            items.push(cached)
            staleFallbackCount += 1
          } else {
            failedCount += 1
          }
        }
      } catch {
        if (ctrl.signal.aborted || rid !== requestId) return
        // 整批请求失败时逐条回退到缓存，保持与旧实现一致的重试韧性
        for (const id of chunk) {
          const cached = store.getCachedNotice(id)
          if (cached) {
            items.push(cached)
            staleFallbackCount += 1
          } else {
            failedCount += 1
          }
        }
      }
    }

    // 与首页一致：按发布日期倒序，同日按 ID 稳定排序
    items.sort(
      (a, b) => b.publishDate.localeCompare(a.publishDate) || a.id.localeCompare(b.id),
    )
    notices.value = items

    const warnings: string[] = []
    if (omittedCount > 0) warnings.push(`仅展示最近 ${REQUEST_LIMIT} 条收藏`)
    if (staleFallbackCount > 0) warnings.push(`有 ${staleFallbackCount} 条收藏使用缓存数据`)
    if (failedCount > 0) warnings.push(`有 ${failedCount} 条收藏加载失败`)
    loadError.value = warnings.join('；')
  } catch (error) {
    if (ctrl.signal.aborted || rid !== requestId) return
    loadError.value = error instanceof Error ? error.message : '收藏加载失败'
  } finally {
    if (controller === ctrl) controller = null
    if (rid === requestId) loading.value = false
  }
}

function goToDetail(id: string): void {
  void router.push({ name: 'Detail', params: { id } })
}

function handleRead(id: string): void {
  store.markRead(id)
}

function handleStar(id: string): void {
  store.toggleStar(id)
  // 取消收藏后立即从当前列表移除
  notices.value = notices.value.filter((notice) => notice.id !== id)
}

onMounted(() => {
  void loadFavorites()
})

onBeforeUnmount(() => {
  requestId += 1
  controller?.abort()
  controller = null
})
</script>

<template>
  <div class="favorites-page">
    <h1 class="sr-only">我的收藏</h1>
    <v-app-bar color="surface" elevation="1">
      <v-app-bar-title>我的收藏</v-app-bar-title>
    </v-app-bar>

    <v-container fluid class="pa-0">
      <!-- 收藏夹筛选 -->
      <div
        v-if="!loading && notices.length > 0"
        class="d-flex flex-wrap align-center ga-2 px-4 pt-3"
        role="tablist"
        aria-label="按收藏夹筛选"
      >
        <v-chip
          v-for="tab in folderTabs"
          :key="tab.id ?? 'all'"
          size="small"
          :color="selectedFolder === tab.id ? 'primary' : 'default'"
          variant="tonal"
          role="tab"
          :aria-selected="selectedFolder === tab.id"
          @click="selectedFolder = tab.id"
        >
          {{ tab.name }}
        </v-chip>
      </div>

      <!-- 加载提示 -->
      <v-alert
        v-if="loadError"
        type="warning"
        variant="tonal"
        density="compact"
        class="ma-3"
        role="status"
      >
        {{ loadError }}
        <template #append>
          <v-btn icon="$refresh" variant="text" size="small" aria-label="重试加载收藏" @click="loadFavorites" />
        </template>
      </v-alert>

      <!-- 骨架屏 -->
      <SkeletonLoader v-if="loading" type="card" />

      <!-- 卡片网格（与首页一致） -->
      <div v-else-if="notices.length > 0" class="pa-4">
        <v-row>
          <v-col
            v-for="notice in filteredNotices"
            :key="notice.id"
            cols="12"
            :sm="isMobile ? 12 : 6"
            :md="isMobile ? 12 : 4"
            :lg="isMobile ? 12 : 3"
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

        <!-- 筛选后为空 -->
        <v-card
          v-if="filteredNotices.length === 0"
          flat
          class="text-center pa-8 bg-transparent"
        >
          <v-icon size="48" color="grey" class="mb-2">$folder</v-icon>
          <v-card-title class="text-medium-emphasis">该收藏夹暂无通知</v-card-title>
        </v-card>
      </div>

      <!-- 无任何收藏 -->
      <div v-else class="empty-state">
        <v-icon size="64" color="grey" class="mb-2">$starOutline</v-icon>
        <div class="text-h6 text-medium-emphasis">暂无收藏通知</div>
        <div class="text-caption text-medium-emphasis mt-1">去首页点击星标收藏通知</div>
      </div>
    </v-container>
  </div>
</template>

<style scoped>
.favorites-page {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}
</style>
