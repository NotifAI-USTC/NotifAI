<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DEPARTMENTS, NOTICE_CATEGORY_DEFINITIONS } from '../types/notice'
import { useUserSettingsStore } from '../stores/userSettings'
import { fetchCategories, fetchSources } from '../utils/request'
import type { NoticeCategoryItem, NoticeCategoryKey, SourceItem } from '../types/notice'
import { clearSearchHistory, loadSearchHistory, recordSearchHistory } from '../utils/searchHistory'

const emit = defineEmits<{
  search: [filters: SearchFilters]
  close: []
}>()

const props = defineProps<{
  initialFilters?: SearchFilters
}>()

export type TriStateFilter = 'any' | 'yes' | 'no'

export interface SearchFilters {
  keyword: string
  source: string
  categories: NoticeCategoryKey[]
  dateFrom: string
  dateTo: string
  hasDeadline: TriStateFilter
  isRead: TriStateFilter
  isStarred: TriStateFilter
  tags: string[]
}

const store = useUserSettingsStore()

function emptyFilters(): SearchFilters {
  return {
    keyword: '',
    source: '',
    categories: [],
    dateFrom: '',
    dateTo: '',
    hasDeadline: 'any',
    isRead: 'any',
    isStarred: 'any',
    tags: [],
  }
}

const filters = ref<SearchFilters>(
  props.initialFilters
    ? {
        ...props.initialFilters,
        categories: [...props.initialFilters.categories],
        tags: [...props.initialFilters.tags],
      }
    : emptyFilters(),
)

const newTag = ref('')

const sourceItems = ref<SourceItem[] | null>(null)
const categoryItems = ref<NoticeCategoryItem[] | null>(null)
let metadataController: AbortController | null = null

/** 来源下拉项：优先使用后端 GET /sources（含分组），加载中/失败时回退到内置部门表 */
const sources = computed(() => {
  if (sourceItems.value) {
    return sourceItems.value.map((item) => ({
      title: item.name,
      value: item.name,
      group: item.group || '其他',
    }))
  }
  return DEPARTMENTS.map((d) => ({ title: d.name, value: d.name, group: d.group }))
})

async function loadSources(signal: AbortSignal): Promise<void> {
  try {
    const loadedSources = await fetchSources(signal)
    if (signal.aborted) return
    store.registerSources(loadedSources.map((source) => source.name))
    sourceItems.value = loadedSources
  } catch {
    // 来源列表失败时回退到内置部门表，不阻塞搜索
    sourceItems.value = null
  }
}

const categories = computed(() => {
  if (categoryItems.value) {
    return categoryItems.value.map((item) => ({
      title: `${item.name}（${item.noticeCount}）`,
      value: item.key,
      subtitle: item.description,
    }))
  }
  return NOTICE_CATEGORY_DEFINITIONS.map((item) => ({
    title: item.name,
    value: item.key,
    subtitle: item.description,
  }))
})

async function loadCategories(signal: AbortSignal): Promise<void> {
  try {
    const loadedCategories = await fetchCategories(signal)
    if (signal.aborted) return
    categoryItems.value = loadedCategories
  } catch {
    // 分类接口失败时保留完整的内置分类表，筛选功能仍可使用。
    categoryItems.value = null
  }
}

onMounted(() => {
  const controller = new AbortController()
  metadataController = controller
  void loadSources(controller.signal)
  void loadCategories(controller.signal)
})

onBeforeUnmount(() => {
  metadataController?.abort()
  metadataController = null
})

// 搜索历史（带校验的 LocalStorage 存储）
const searchHistory = ref<string[]>(loadSearchHistory())

function saveSearchHistory(keyword: string) {
  searchHistory.value = recordSearchHistory(keyword)
}

function applyHistory(keyword: string) {
  filters.value.keyword = keyword
}

function clearHistory() {
  clearSearchHistory()
  searchHistory.value = []
}

function addTag() {
  const tag = newTag.value.trim().slice(0, 50)
  if (tag && filters.value.tags.length < 50 && !filters.value.tags.includes(tag)) {
    filters.value.tags.push(tag)
    newTag.value = ''
  }
}

function removeTag(tag: string) {
  filters.value.tags = filters.value.tags.filter((t) => t !== tag)
}

function handleSearch() {
  saveSearchHistory(filters.value.keyword)
  emit('search', {
    ...filters.value,
    categories: [...filters.value.categories],
    tags: [...filters.value.tags],
  })
}

function resetFilters() {
  filters.value = emptyFilters()
}
</script>

<template>
  <v-dialog :model-value="true" @update:model-value="emit('close')" max-width="600" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>高级搜索</span>
        <v-btn icon variant="text" size="small" aria-label="关闭高级搜索" @click="emit('close')">
          <v-icon>$close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text class="search-form">
        <!-- 关键词 -->
        <v-text-field
          v-model="filters.keyword"
          label="关键词"
          prepend-inner-icon="$magnify"
          clearable
          maxlength="200"
          @keyup.enter="handleSearch"
        />

        <!-- 来源 -->
        <v-select v-model="filters.source" :items="sources" label="来源" clearable />

        <!-- AI 分类（多选为 OR 语义） -->
        <v-autocomplete
          v-model="filters.categories"
          :items="categories"
          label="通知分类"
          hint="可多选，命中任一分类即显示；不选则临时查看全部分类"
          persistent-hint
          multiple
          chips
          closable-chips
          clearable
        />

        <!-- 日期范围 -->
        <div class="d-flex ga-4">
          <v-text-field v-model="filters.dateFrom" label="开始日期" type="date" clearable />
          <v-text-field v-model="filters.dateTo" label="结束日期" type="date" clearable />
        </div>

        <!-- 筛选条件 -->
        <div class="tri-state-filters mb-4">
          <div class="tri-state-filter">
            <span class="text-caption text-medium-emphasis">截止日期</span>
            <v-btn-toggle
              v-model="filters.hasDeadline"
              mandatory
              divided
              density="compact"
              variant="outlined"
              aria-label="截止日期筛选"
            >
              <v-btn value="any">不限</v-btn>
              <v-btn value="yes">有</v-btn>
              <v-btn value="no">无</v-btn>
            </v-btn-toggle>
          </div>
          <div class="tri-state-filter">
            <span class="text-caption text-medium-emphasis">阅读状态</span>
            <v-btn-toggle
              v-model="filters.isRead"
              mandatory
              divided
              density="compact"
              variant="outlined"
              aria-label="阅读状态筛选"
            >
              <v-btn value="any">不限</v-btn>
              <v-btn value="yes">已读</v-btn>
              <v-btn value="no">未读</v-btn>
            </v-btn-toggle>
          </div>
          <div class="tri-state-filter">
            <span class="text-caption text-medium-emphasis">收藏状态</span>
            <v-btn-toggle
              v-model="filters.isStarred"
              mandatory
              divided
              density="compact"
              variant="outlined"
              aria-label="收藏状态筛选"
            >
              <v-btn value="any">不限</v-btn>
              <v-btn value="yes">已收藏</v-btn>
              <v-btn value="no">未收藏</v-btn>
            </v-btn-toggle>
          </div>
        </div>

        <!-- 标签筛选 -->
        <div class="mb-4">
          <div class="text-caption text-medium-emphasis mb-2">标签筛选</div>
          <div class="d-flex ga-2">
            <v-text-field
              v-model="newTag"
              label="添加标签"
              density="compact"
              hide-details
              maxlength="50"
              @keyup.enter="addTag"
            />
            <v-btn @click="addTag">添加</v-btn>
          </div>
          <div v-if="filters.tags.length > 0" class="d-flex flex-wrap ga-2 mt-2">
            <v-chip v-for="tag in filters.tags" :key="tag" closable @click:close="removeTag(tag)">
              {{ tag }}
            </v-chip>
          </div>
        </div>

        <!-- 搜索历史 -->
        <div v-if="searchHistory.length > 0 && !filters.keyword">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-caption text-medium-emphasis">搜索历史</span>
            <v-btn variant="text" size="x-small" @click="clearHistory">清空</v-btn>
          </div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="item in searchHistory"
              :key="item"
              size="small"
              variant="outlined"
              @click="applyHistory(item)"
            >
              {{ item }}
            </v-chip>
          </div>
        </div>
      </v-card-text>

      <v-divider />
      <v-card-actions>
        <v-btn variant="text" @click="resetFilters">重置</v-btn>
        <v-spacer />
        <v-btn variant="text" @click="emit('close')">取消</v-btn>
        <v-btn color="primary" @click="handleSearch">
          <v-icon start>$magnify</v-icon>
          搜索
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.search-form {
  max-height: 60vh;
}

.tri-state-filters {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.tri-state-filter {
  display: grid;
  gap: 6px;
}

.tri-state-filter :deep(.v-btn-toggle) {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: 100%;
}

.tri-state-filter :deep(.v-btn) {
  min-width: 0;
  padding-inline: 8px;
}

@media (max-width: 720px) {
  .tri-state-filters {
    grid-template-columns: 1fr;
  }
}
</style>
