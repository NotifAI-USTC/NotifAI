<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserSettingsStore } from '../stores/userSettings'
import { ApiConfigurationError, fetchNoticeById } from '../utils/request'
import { getNoticeCategoryName } from '../types/notice'
import type { NoticeItem } from '../types/notice'
import ShareDialog from '../components/ShareDialog.vue'
import ImagePreview from '../components/ImagePreview.vue'
import SkeletonLoader from '../components/SkeletonLoader.vue'
import { useSnackbar } from '../composables/useSnackbar'
import { copyText } from '../utils/share'
import { DataValidationError, normalizeHttpUrl } from '../utils/validation'
import { sanitizeNoticeContent } from '../utils/sanitizeNoticeContent'

const route = useRoute()
const router = useRouter()
const store = useUserSettingsStore()
const snackbar = useSnackbar()

const notice = ref<NoticeItem | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const loadError = ref('')
const showShare = ref(false)
const showImagePreview = ref(false)
const previewImages = ref<string[]>([])
const previewIndex = ref(0)
let loadSequence = 0
let loadController: AbortController | null = null

function getLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiConfigurationError) return error.message
  if (error instanceof DataValidationError) return `通知数据校验失败：${error.message}`
  if (error instanceof Error && error.message === '通知不存在') return error.message
  return '加载通知详情失败，请检查网络后重试'
}

function formatCrawlTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadNotice(): Promise<void> {
  const sequence = ++loadSequence
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  loading.value = true
  refreshing.value = false
  notice.value = null
  loadError.value = ''

  try {
    const id = route.params.id
    if (typeof id !== 'string') {
      throw new DataValidationError('通知 ID 格式无效')
    }

    // 详情页优先展示首页、收藏页或其他页面已经写入的内存缓存，
    // 同时在后台请求最新内容。这样从列表进入详情时不会再次等待网络。
    const cachedNotice = store.getCachedNotice(id)
    notice.value = cachedNotice ?? null
    loading.value = cachedNotice === undefined
    refreshing.value = cachedNotice !== undefined
    if (cachedNotice) store.markRead(cachedNotice.id)

    const loadedNotice = await fetchNoticeById(id, controller.signal)
    if (controller.signal.aborted || sequence !== loadSequence) return

    notice.value = loadedNotice
    loadError.value = ''
    store.cacheNotice(loadedNotice)
    store.markRead(loadedNotice.id)
  } catch (error) {
    if (controller.signal.aborted || sequence !== loadSequence) return
    const errorMessage = getLoadErrorMessage(error)
    if (notice.value) {
      // 已有缓存时保留正文，把失败降级为可重试的提示，而不是覆盖整个详情页。
      loadError.value = `${errorMessage}，当前显示缓存数据；可点击重试。`
    } else {
      loadError.value = errorMessage
    }
  } finally {
    if (loadController === controller) loadController = null
    if (sequence === loadSequence) {
      loading.value = false
      refreshing.value = false
    }
  }
}

watch(
  () => route.params.id,
  () => void loadNotice(),
  { immediate: true },
)

onBeforeUnmount(() => {
  loadSequence += 1
  loadController?.abort()
  loadController = null
})

const safeContentBundle = computed(() => {
  return notice.value ? sanitizeNoticeContent(notice.value) : { html: '', images: [] }
})

const safeContent = computed(() => safeContentBundle.value.html)
const contentImages = computed(() => safeContentBundle.value.images)

async function copyAttachmentUrl(url: string): Promise<void> {
  const safeUrl = normalizeHttpUrl(url)
  if (!safeUrl) {
    snackbar.showError('附件链接无效，无法复制')
    return
  }

  if (await copyText(safeUrl)) {
    snackbar.showSuccess('附件链接已复制')
  } else {
    snackbar.showError('复制失败，请检查浏览器剪贴板权限')
  }
}

function goBack(): void {
  router.back()
}

function openImagePreview(src: string): void {
  const index = contentImages.value.indexOf(src)
  if (index < 0) return
  previewIndex.value = index
  previewImages.value = contentImages.value
  showImagePreview.value = true
}

function handleContentClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return
  const image = event.target.closest('img')
  if (!image || !(event.currentTarget instanceof HTMLElement)) return
  if (!event.currentTarget.contains(image)) return

  event.preventDefault()
  event.stopPropagation()
  const src = normalizeHttpUrl(image.getAttribute('src'))
  if (src) openImagePreview(src)
}

function handleContentKeydown(event: KeyboardEvent): void {
  if (!['Enter', ' '].includes(event.key) || !(event.target instanceof HTMLImageElement)) return
  event.preventDefault()
  event.stopPropagation()
  const src = normalizeHttpUrl(event.target.getAttribute('src'))
  if (src) openImagePreview(src)
}
</script>

<template>
  <div class="detail-page">
    <h1 class="sr-only">通知详情</h1>
    <!-- 顶部导航 -->
    <v-app-bar color="surface" elevation="1">
      <v-btn icon aria-label="返回上一页" @click="goBack">
        <v-icon>$arrowLeft</v-icon>
      </v-btn>
      <v-app-bar-title>通知详情</v-app-bar-title>
      <v-spacer />
      <v-btn v-if="notice" icon aria-label="分享通知" @click="showShare = true">
        <v-icon>$shareVariant</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- 加载状态 -->
    <SkeletonLoader v-if="loading && !notice" type="detail" />

    <!-- 错误状态 -->
    <v-container v-else-if="loadError && !notice" fluid>
      <v-row justify="center">
        <v-col :cols="12" :md="8" :lg="6">
          <v-card class="pa-4 text-center">
            <v-icon size="48" color="error" class="mb-2">$alertCircleOutline</v-icon>
            <v-card-title>无法加载通知</v-card-title>
            <v-card-text>{{ loadError }}</v-card-text>
            <v-card-actions class="justify-center">
              <v-btn color="primary" prepend-icon="$refresh" @click="loadNotice"> 重试 </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
    </v-container>

    <!-- 内容区 -->
    <v-container v-else-if="notice" fluid>
      <v-row justify="center">
        <v-col :cols="12" :md="8" :lg="6">
          <v-progress-linear v-if="refreshing" indeterminate color="primary" class="mb-4" />

          <v-alert
            v-if="loadError"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
            role="status"
          >
            {{ loadError }}
            <template #append>
              <v-btn variant="text" size="small" prepend-icon="$refresh" @click="loadNotice">
                重试
              </v-btn>
            </template>
          </v-alert>

          <v-card class="mb-6" variant="flat">
            <v-card-title class="detail-title text-h5 text-wrap">{{ notice.title }}</v-card-title>
            <v-card-subtitle class="pb-2">
              {{ notice.source }} · {{ notice.publishDate }}
              <span v-if="formatCrawlTime(notice.lastCrawl)" class="text-medium-emphasis">
                · 最近抓取于 {{ formatCrawlTime(notice.lastCrawl) }}
              </span>
            </v-card-subtitle>
            <v-card-text v-if="notice.categories.length" class="d-flex flex-wrap ga-2 pt-2">
              <v-chip
                v-for="category in notice.categories"
                :key="category"
                color="secondary"
                variant="tonal"
                size="small"
              >
                {{ getNoticeCategoryName(category) }}
              </v-chip>
            </v-card-text>
          </v-card>

          <!-- AI 智能提炼卡片 -->
          <v-card class="mb-6 ai-card" variant="outlined">
            <v-card-title class="d-flex align-center ga-2">
              <v-icon>$robot</v-icon>
              <span>AI 秘书已为您提炼干货</span>
            </v-card-title>

            <v-card-text>
              <v-list bg-color="transparent">
                <v-list-item prepend-icon="$calendarClock">
                  <v-list-item-title>截止时间</v-list-item-title>
                  <v-list-item-subtitle class="text-error font-weight-bold">
                    {{ notice.deadline || '未提及' }}
                  </v-list-item-subtitle>
                </v-list-item>

                <v-list-item prepend-icon="$accountGroup">
                  <v-list-item-title>面向对象</v-list-item-title>
                  <v-list-item-subtitle>
                    {{ notice.targetAudience || '未提及' }}
                  </v-list-item-subtitle>
                </v-list-item>

                <v-list-item prepend-icon="$mapMarker">
                  <v-list-item-title>核心行动/地点</v-list-item-title>
                  <v-list-item-subtitle>
                    {{ notice.coreAction || '未提及' }}
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list>

              <v-card-text class="summary-text text-body-1 mt-4" tag="p">
                {{ notice.aiSummary }}
              </v-card-text>
            </v-card-text>
          </v-card>

          <!-- 原文渲染区 -->
          <v-card class="mb-6">
            <v-card-title class="d-flex align-center">
              <v-icon class="mr-2">$fileDocumentOutline</v-icon>
              通知原文
              <v-spacer />
              <v-btn
                :href="notice.originUrl"
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                variant="text"
              >
                查看来源页面
              </v-btn>
            </v-card-title>
            <v-divider />
            <v-card-text>
              <div
                v-if="safeContent"
                class="clean-content"
                @click="handleContentClick"
                @keydown="handleContentKeydown"
                v-html="safeContent"
              />
              <div v-else class="text-center text-medium-emphasis pa-4">
                <v-icon size="32" color="grey" class="mb-2">$fileDocumentOutline</v-icon>
                <div>暂无原文内容，可前往官网查看</div>
              </div>
            </v-card-text>
          </v-card>

          <!-- 附件列表 -->
          <v-card v-if="notice.attachments.length > 0" class="mb-6">
            <v-card-title>
              <v-icon class="mr-2">$attachment</v-icon>
              附件列表
            </v-card-title>
            <v-divider />
            <v-list>
              <v-list-item
                v-for="(att, idx) in notice.attachments"
                :key="idx"
                :title="att.name"
                prepend-icon="$fileDownload"
                @click="copyAttachmentUrl(att.url)"
              >
                <template #append>
                  <v-btn
                    icon
                    variant="text"
                    size="small"
                    :aria-label="`复制附件链接：${att.name}`"
                    @click.stop="copyAttachmentUrl(att.url)"
                  >
                    <v-icon>$contentCopy</v-icon>
                    <v-tooltip activator="parent" location="top">复制链接</v-tooltip>
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
          </v-card>

          <v-card v-else flat class="text-center pa-4 bg-transparent">
            <v-icon size="32" color="grey" class="mb-2">$attachment</v-icon>
            <v-card-subtitle>暂无附件</v-card-subtitle>
          </v-card>
        </v-col>
      </v-row>
    </v-container>

    <!-- 分享对话框 -->
    <ShareDialog v-if="showShare && notice" :notice="notice" @close="showShare = false" />

    <!-- 图片预览 -->
    <ImagePreview
      v-if="showImagePreview"
      :images="previewImages"
      :initial-index="previewIndex"
      @close="showImagePreview = false"
    />
  </div>
</template>

<style scoped>
.summary-text {
  line-height: 1.8;
}

.detail-title {
  line-height: 1.45;
}

.detail-page {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
}

.ai-card {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.clean-content {
  font-size: 15px;
  line-height: 1.8;
  color: rgb(var(--v-theme-on-surface));
  overflow-wrap: break-word;
}

.clean-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 8px 0;
  cursor: pointer;
  transition: transform 0.2s;
}

.clean-content :deep(img:hover) {
  transform: scale(1.02);
}

.clean-content :deep(table) {
  max-width: 100%;
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 16px 0;
}

.clean-content :deep(td),
.clean-content :deep(th) {
  border: 1px solid rgb(var(--v-border-color));
  padding: 8px 12px;
}

.clean-content :deep(a) {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.clean-content :deep(a:hover) {
  text-decoration: underline;
}

/* ---- Markdown 渲染样式 ---- */
.clean-content :deep(h1),
.clean-content :deep(h2),
.clean-content :deep(h3),
.clean-content :deep(h4) {
  margin: 20px 0 10px;
  font-weight: 600;
  line-height: 1.4;
}

.clean-content :deep(h1) {
  font-size: 22px;
}

.clean-content :deep(h2) {
  font-size: 19px;
}

.clean-content :deep(h3) {
  font-size: 17px;
}

.clean-content :deep(h4) {
  font-size: 15px;
}

.clean-content :deep(p) {
  margin: 10px 0;
}

.clean-content :deep(ul),
.clean-content :deep(ol) {
  margin: 10px 0;
  padding-left: 24px;
}

.clean-content :deep(li) {
  margin: 4px 0;
}

.clean-content :deep(blockquote) {
  margin: 12px 0;
  padding: 4px 16px;
  border-left: 4px solid rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-on-surface-variant));
}

.clean-content :deep(pre) {
  margin: 12px 0;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}

.clean-content :deep(code) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  background: rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 0.92em;
}

.clean-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.clean-content :deep(hr) {
  border: none;
  border-top: 1px solid rgb(var(--v-theme-surface-variant));
  margin: 16px 0;
}
</style>
