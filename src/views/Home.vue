<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from '../stores/userSettings'
import { fetchNotices } from '../utils/request'
import type { NoticeItem, NoticeCategory } from '../types/notice'
import { HOME_TABS } from '../types/notice'
import NoticeCard from '../components/NoticeCard.vue'
import DdlNoticeBar from '../components/DdlNoticeBar.vue'

const router = useRouter()
const store = useUserSettingsStore()

// ---- 状态 ----
const activeTab = ref<NoticeCategory>('全部')
const notices = ref<NoticeItem[]>([])
const searchActive = ref(false)
const searchQuery = ref('')
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const page = ref(1)
const pageSize = 15

// ---- 客户端过滤 ----
const filteredNotices = computed(() => {
  let result = notices.value

  // 搜索过滤
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter((n) => {
      return (
        n.title.toLowerCase().includes(q) ||
        n.source.toLowerCase().includes(q) ||
        n.aiSummary.toLowerCase().includes(q)
      )
    })
  }

  // 黑名单关键词过滤
  const keywords = store.blacklistKeywords
  if (keywords.length > 0) {
    result = result.filter((n) => {
      const text = n.title + n.aiSummary
      return !keywords.some((kw) => text.includes(kw))
    })
  }

  return result
})

// ---- 数据加载 ----
async function onLoad(): Promise<void> {
  loading.value = true
  try {
    const res = await fetchNotices({
      category: activeTab.value === '全部' ? undefined : activeTab.value,
      page: page.value,
      pageSize,
    })
    notices.value.push(...res.items)
    store.cacheNotices(res.items)
    page.value++
    if (res.items.length < pageSize) {
      finished.value = true
    }
  } catch {
    // 网络错误时停止加载
    finished.value = true
  } finally {
    loading.value = false
  }
}

async function onRefresh(): Promise<void> {
  page.value = 1
  finished.value = false
  notices.value = []
  refreshing.value = true
  try {
    const res = await fetchNotices({
      category: activeTab.value === '全部' ? undefined : activeTab.value,
      page: 1,
      pageSize,
    })
    notices.value = res.items
    store.cacheNotices(res.items)
    page.value = 2
    if (res.items.length < pageSize) {
      finished.value = true
    }
  } catch {
    // 静默处理
  } finally {
    refreshing.value = false
  }
}

function onTabChange(_name: string | number): void {
  onRefresh()
}

// ---- 导航 & 操作 ----
function goToDetail(id: string): void {
  router.push({ name: 'Detail', params: { id } })
}

function handleRead(id: string): void {
  store.markRead(id)
}

function handleStar(id: string): void {
  store.toggleStar(id)
}

function openSearch(): void {
  searchActive.value = true
}

function closeSearch(): void {
  searchActive.value = false
  searchQuery.value = ''
}
</script>

<template>
  <div class="home-page">
    <van-nav-bar fixed placeholder>
      <template #title>
        <span v-if="!searchActive" class="nav-title">NotifAI-USTC</span>
        <van-search
          v-else
          v-model="searchQuery"
          placeholder="搜索通知标题、来源、摘要"
          show-action
          autofocus
          @search="closeSearch"
          @cancel="closeSearch"
        />
      </template>
      <template #right>
        <van-icon
          v-if="!searchActive"
          name="search"
          size="20"
          @click="openSearch"
        />
        <span v-else />
      </template>
    </van-nav-bar>

    <DdlNoticeBar v-if="!searchActive" :notices="notices" />

    <van-tabs
      v-model:active="activeTab"
      swipeable
      sticky
      @change="onTabChange"
    >
      <van-tab
        v-for="tab in HOME_TABS"
        :key="tab"
        :title="tab"
        :name="tab"
      />
    </van-tabs>

    <van-pull-refresh
      v-model="refreshing"
      @refresh="onRefresh"
    >
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="没有更多通知了"
        @load="onLoad"
      >
        <NoticeCard
          v-for="notice in filteredNotices"
          :key="notice.id"
          :notice="notice"
          class="notice-card-item"
          @click="goToDetail"
          @read="handleRead"
          @star="handleStar"
        />
      </van-list>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.home-page {
  padding-bottom: 60px;
  min-height: 100vh;
  background: var(--notifai-bg-page);
}

.nav-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--notifai-text-primary);
}

/* 搜索栏：在 nav-bar 内部全宽 */
.home-page :deep(.van-nav-bar__title) {
  max-width: none;
}

.home-page :deep(.van-search) {
  padding: 0;
  background: transparent;
}

.notice-card-item {
  margin: 8px 12px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--notifai-bg-card);
  box-shadow: 0 1px 3px var(--notifai-shadow);
}
</style>
