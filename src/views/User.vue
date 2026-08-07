<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from '../stores/userSettings'
import { fetchNoticeById } from '../utils/request'
import { calculateRemainingDays, getLocalToday } from '../utils/date'
import type { DarkMode } from '../stores/userSettings'
import type { NoticeItem } from '../types/notice'
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendNotification,
} from '../utils/notification'
import FolderDialog from '../components/FolderDialog.vue'
import { hapticMedium } from '../utils/haptics'
import { useSnackbar } from '../composables/useSnackbar'

const router = useRouter()
const store = useUserSettingsStore()
const snackbar = useSnackbar()

const IMPORTANT_REQUEST_CONCURRENCY = 4
const IMPORTANT_REQUEST_LIMIT = 100
const FEEDBACK_EMAIL = 'cuijunxi@mail.ustc.edu.cn'

const importantNotices = ref<NoticeItem[]>([])
const importantLoading = ref(true)
const importantLoadError = ref('')
const showFeedbackPopup = ref(false)
const showFolderDialog = ref(false)
const showClearReadConfirm = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const notificationPermission = ref<NotificationPermission | null>(null)
let importantRequestId = 0
let importantRequestController: AbortController | null = null

const darkModeLabels: Record<DarkMode, string> = {
  auto: '跟随系统',
  light: '浅色',
  dark: '深色',
}

const notificationPermissionLabel = computed(() => {
  if (notificationPermission.value === null) return '当前浏览器不支持网页通知'
  if (notificationPermission.value === 'granted') {
    return '仅当前设备已授权；提醒需由打开的页面触发'
  }
  if (notificationPermission.value === 'denied') {
    return '已被浏览器阻止，请在站点设置中修改'
  }
  return '尚未授权，不包含后台定时推送'
})

function refreshNotificationPermission() {
  notificationPermission.value = getNotificationPermission()
  store.setNotificationEnabled(notificationPermission.value === 'granted')
}

async function loadImportantNotices() {
  const requestId = ++importantRequestId
  importantRequestController?.abort()
  const controller = new AbortController()
  importantRequestController = controller
  const allIds = [...store.importantIds]
  const omittedCount = Math.max(0, allIds.length - IMPORTANT_REQUEST_LIMIT)
  const ids = allIds.slice(-IMPORTANT_REQUEST_LIMIT)
  const items: NoticeItem[] = []
  let nextIndex = 0
  let failedCount = 0
  let staleFallbackCount = 0

  importantLoading.value = true
  importantLoadError.value = ''

  async function worker() {
    while (nextIndex < ids.length) {
      const id = ids[nextIndex]
      nextIndex += 1

      const cached = store.getCachedNotice(id)
      try {
        const notice = await fetchNoticeById(id, controller.signal)
        if (controller.signal.aborted || requestId !== importantRequestId) return
        store.cacheNotice(notice)
        if (notice.deadline) items.push(notice)
      } catch {
        if (controller.signal.aborted || requestId !== importantRequestId) return
        if (cached?.deadline) {
          items.push(cached)
          staleFallbackCount += 1
        } else {
          failedCount += 1
        }
      }
    }
  }

  try {
    const workerCount = Math.min(IMPORTANT_REQUEST_CONCURRENCY, ids.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    if (requestId !== importantRequestId) return

    items.sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''))
    importantNotices.value = items

    const warnings: string[] = []
    if (omittedCount > 0) warnings.push(`仅检查最近 ${IMPORTANT_REQUEST_LIMIT} 条重要通知`)
    if (staleFallbackCount > 0) {
      warnings.push(`有 ${staleFallbackCount} 条重要通知使用缓存数据`)
    }
    if (failedCount > 0) warnings.push(`有 ${failedCount} 条重要通知加载失败`)
    importantLoadError.value = warnings.join('；')
  } finally {
    if (importantRequestController === controller) importantRequestController = null
    if (requestId === importantRequestId) importantLoading.value = false
  }
}

function handleExportSettings() {
  const json = store.exportSettings()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `notifai-preferences-${getLocalToday()}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  snackbar.showSuccess('偏好设置已导出')
}

function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const json = typeof reader.result === 'string' ? reader.result : ''
    const result = store.importSettings(json)
    if (result.ok) {
      snackbar.showSuccess(result.message)
    } else {
      snackbar.showError(result.message)
    }
    input.value = ''
  }
  reader.onerror = () => snackbar.showError('读取文件失败')
  reader.readAsText(file)
}

function handleClearReadHistory() {
  store.clearReadHistory()
  showClearReadConfirm.value = false
  snackbar.showSuccess('已清空已读记录')
}

onMounted(() => {
  refreshNotificationPermission()
  window.addEventListener('focus', refreshNotificationPermission)
  void loadImportantNotices()
})

watch(
  () => store.importantIds.join('\u0000'),
  () => {
    void loadImportantNotices()
  },
)

onBeforeUnmount(() => {
  importantRequestId += 1
  importantRequestController?.abort()
  importantRequestController = null
  window.removeEventListener('focus', refreshNotificationPermission)
})

function remainingDays(deadline: string | null): string {
  const d = calculateRemainingDays(deadline)
  if (d === null) return '未知'
  if (d < 0) return '已过期'
  if (d === 0) return '今天'
  return `剩 ${d} 天`
}

function deadlineColor(deadline: string | null): string {
  const days = calculateRemainingDays(deadline)
  if (days === null || days < 0) return 'default'
  return days <= 3 ? 'error' : 'primary'
}

function goToDetail(id: string): void {
  router.push({ name: 'Detail', params: { id } })
}

async function enableNotifications() {
  hapticMedium()
  const permission = await requestNotificationPermission()
  notificationPermission.value = permission ?? getNotificationPermission()
  store.setNotificationEnabled(permission === 'granted')

  if (permission === null) {
    snackbar.showError('无法请求浏览器通知权限')
  }
}

function sendTestNotification() {
  hapticMedium()
  const notification = sendNotification('NotifAI 测试通知', {
    body: '当前设备的浏览器通知已可用。',
    tag: 'notifai-permission-test',
  })

  if (notification) {
    snackbar.showSuccess('测试通知已触发')
  } else {
    refreshNotificationPermission()
    snackbar.showError('测试通知发送失败，请检查浏览器权限')
  }
}

async function copyFeedbackEmail(): Promise<void> {
  const { copyText } = await import('../utils/share')
  if (await copyText(FEEDBACK_EMAIL)) {
    snackbar.showSuccess('邮箱已复制')
  } else {
    snackbar.showError('复制失败，请检查浏览器剪贴板权限')
  }
}

function markCachedNoticesRead() {
  hapticMedium()
  store.markCachedNoticesRead()
}
</script>

<template>
  <div class="user-page">
    <h1 class="sr-only">个人中心</h1>
    <v-app-bar color="surface" elevation="1">
      <v-app-bar-title>个人中心</v-app-bar-title>
    </v-app-bar>

    <v-container>
      <!-- 用户简况 -->
      <v-card class="mb-4">
        <v-card-text class="text-center pa-6">
          <v-avatar size="80" color="primary" class="mb-4">
            <span class="text-h5 text-white font-weight-bold">USTC</span>
          </v-avatar>
          <v-card-title class="pa-0">科大新同学</v-card-title>
          <v-card-subtitle class="pa-0"> 已读 {{ store.readIds.length }} 条通知 </v-card-subtitle>
        </v-card-text>
      </v-card>

      <!-- DDL 追踪列表 -->
      <v-card class="mb-4">
        <v-card-title class="d-flex align-center ga-2">
          <v-icon color="error">$clockAlert</v-icon>
          <span>我的 DDL 倒计时</span>
        </v-card-title>
        <v-divider />

        <v-card-text v-if="importantLoading" class="d-flex justify-center pa-6" aria-live="polite">
          <v-progress-circular indeterminate color="primary" size="28" />
        </v-card-text>

        <template v-else>
          <v-alert
            v-if="importantLoadError"
            type="warning"
            variant="tonal"
            density="compact"
            class="ma-3 mb-0"
            role="status"
          >
            {{ importantLoadError }}
            <template #append>
              <v-btn
                icon="$refresh"
                variant="text"
                size="small"
                aria-label="重试加载重要通知"
                title="重试加载"
                @click="loadImportantNotices"
              />
            </template>
          </v-alert>

          <v-list v-if="importantNotices.length > 0">
            <v-list-item
              v-for="item in importantNotices"
              :key="item.id"
              :title="item.title"
              :subtitle="`截止: ${item.deadline || '未提及'}`"
              @click="goToDetail(item.id)"
            >
              <template #append>
                <v-chip :color="deadlineColor(item.deadline)" size="small">
                  {{ remainingDays(item.deadline) }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>

          <v-card-text v-else-if="!importantLoadError" class="text-center pa-6">
            <v-icon size="48" color="grey" class="mb-2">$clockOutline</v-icon>
            <div class="text-medium-emphasis">暂无重要的 DDL 通知</div>
            <div class="text-caption text-medium-emphasis mt-1">去首页将通知标记为重要</div>
          </v-card-text>
        </template>
      </v-card>

      <!-- 快捷操作 -->
      <v-card class="mb-4">
        <v-list>
          <v-list-item
            title="将已加载通知标为已读"
            prepend-icon="$checkAll"
            @click="markCachedNoticesRead"
          />
          <v-list-item
            title="清空已读记录"
            prepend-icon="$delete"
            @click="showClearReadConfirm = true"
          />
          <v-list-item
            title="导出偏好设置"
            prepend-icon="$contentSaveOutline"
            @click="handleExportSettings"
          />
          <v-list-item
            title="导入偏好设置"
            prepend-icon="$trayArrowUp"
            @click="importInput?.click()"
          />
          <v-list-item
            title="管理收藏夹"
            prepend-icon="$folderCog"
            append-icon="$chevronRight"
            @click="showFolderDialog = true"
          />
        </v-list>
      </v-card>

      <!-- 隐藏的文件选择器（导入偏好） -->
      <input
        ref="importInput"
        type="file"
        accept="application/json,.json"
        class="d-none"
        aria-label="选择偏好设置 JSON 文件"
        @change="handleImportFile"
      />

      <!-- 通知设置 -->
      <v-card class="mb-4">
        <v-card-title>通知设置</v-card-title>
        <v-divider />
        <v-list>
          <v-list-item>
            <template #prepend>
              <v-icon>$bell</v-icon>
            </template>
            <v-list-item-title>浏览器通知权限</v-list-item-title>
            <v-list-item-subtitle>
              {{ notificationPermissionLabel }}
            </v-list-item-subtitle>
            <template #append>
              <v-btn
                v-if="notificationPermission === 'default'"
                size="small"
                color="primary"
                prepend-icon="$bellPlusOutline"
                @click="enableNotifications"
              >
                授权
              </v-btn>
              <div
                v-else-if="notificationPermission === 'granted'"
                class="d-flex align-center ga-2"
              >
                <v-chip color="success" size="small">本设备已授权</v-chip>
                <v-btn
                  icon="$bellRingOutline"
                  variant="text"
                  size="small"
                  aria-label="发送测试通知"
                  title="发送测试通知"
                  @click="sendTestNotification"
                />
              </div>
              <v-chip v-else-if="notificationPermission === 'denied'" color="error" size="small">
                已阻止
              </v-chip>
              <v-chip v-else size="small">不支持</v-chip>
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <!-- 设置入口 -->
      <v-card class="mb-4">
        <v-list>
          <v-list-item
            title="意见反馈"
            prepend-icon="$emailOutline"
            append-icon="$chevronRight"
            @click="showFeedbackPopup = true"
          />
        </v-list>
      </v-card>

      <!-- 深色模式 -->
      <v-card>
        <v-card-title>外观</v-card-title>
        <v-divider />
        <v-card-text>
          <v-row align="center">
            <v-col>深色模式</v-col>
            <v-col cols="auto">
              <v-chip-group
                :model-value="store.darkMode"
                @update:model-value="store.setDarkMode($event as DarkMode)"
                mandatory
              >
                <v-chip
                  v-for="mode in ['auto', 'light', 'dark'] as DarkMode[]"
                  :key="mode"
                  :value="mode"
                  filter
                  variant="elevated"
                >
                  {{ darkModeLabels[mode] }}
                </v-chip>
              </v-chip-group>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-container>

    <!-- 清空已读确认 -->
    <v-dialog v-model="showClearReadConfirm" max-width="400">
      <v-card>
        <v-card-title class="text-center">
          <v-icon class="mr-1">$delete</v-icon>
          清空已读记录
        </v-card-title>
        <v-divider />
        <v-card-text class="text-center pa-6">
          <div class="text-body-2 text-medium-emphasis">
            将清除全部已读标记，此操作不可撤销。确定继续吗？
          </div>
        </v-card-text>
        <v-card-actions class="justify-center pa-4">
          <v-btn variant="tonal" @click="showClearReadConfirm = false">取消</v-btn>
          <v-btn color="error" prepend-icon="$delete" @click="handleClearReadHistory">
            清空
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 反馈弹窗 -->
    <v-dialog v-model="showFeedbackPopup" max-width="400">
      <v-card>
        <v-card-title class="text-center">
          <v-icon class="mr-1">$emailOutline</v-icon>
          意见反馈
        </v-card-title>
        <v-divider />
        <v-card-text class="text-center pa-6">
          <div class="text-body-2 text-medium-emphasis mb-2">欢迎通过邮件反馈你的想法或建议</div>
          <a
            :href="`mailto:${FEEDBACK_EMAIL}`"
            class="feedback-email text-h6 font-weight-bold text-primary text-decoration-none"
          >
            {{ FEEDBACK_EMAIL }}
          </a>
        </v-card-text>
        <v-card-actions class="justify-center pa-4">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="$contentCopy"
            @click="copyFeedbackEmail"
          >
            复制邮箱
          </v-btn>
          <v-btn color="primary" :href="`mailto:${FEEDBACK_EMAIL}`" prepend-icon="$emailOutline">
            发邮件
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 收藏夹管理对话框 -->
    <FolderDialog v-if="showFolderDialog" mode="manage" @close="showFolderDialog = false" />
  </div>
</template>

<style scoped>
.user-page {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
}

.feedback-email {
  word-break: break-all;
}
</style>
