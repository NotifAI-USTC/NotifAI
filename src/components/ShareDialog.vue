<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { NoticeItem } from '../types/notice'
import {
  copyNoticeContent,
  copyNoticeLink,
  copyText,
  generateShareText,
  isShareSupported,
  shareNotice,
} from '../utils/share'

const props = defineProps<{
  notice: NoticeItem
}>()

const emit = defineEmits<{
  close: []
}>()

const showSnackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref<'success' | 'error'>('success')
const actionPending = ref(false)
let closeTimer: number | null = null

function showCopyResult(success: boolean, message: string) {
  if (closeTimer) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
  snackbarText.value = success ? message : '复制失败，请检查浏览器剪贴板权限'
  snackbarColor.value = success ? 'success' : 'error'
  showSnackbar.value = true
  if (success) {
    closeTimer = window.setTimeout(() => emit('close'), 1500)
  }
}

onBeforeUnmount(() => {
  if (closeTimer) window.clearTimeout(closeTimer)
})

async function handleNativeShare() {
  if (actionPending.value) return
  actionPending.value = true
  try {
    const result = await shareNotice(props.notice)
    if (result === 'shared') {
      emit('close')
    } else if (result === 'failed') {
      showCopyResult(false, '')
      snackbarText.value = '系统分享失败，请改用复制链接'
    }
  } finally {
    actionPending.value = false
  }
}

async function runCopy(action: () => Promise<boolean>, successMessage: string): Promise<void> {
  if (actionPending.value) return
  actionPending.value = true
  try {
    showCopyResult(await action(), successMessage)
  } finally {
    actionPending.value = false
  }
}

function handleCopyLink(): Promise<void> {
  return runCopy(() => copyNoticeLink(props.notice), '链接已复制到剪贴板')
}

function handleCopyContent(): Promise<void> {
  return runCopy(() => copyNoticeContent(props.notice), '内容已复制到剪贴板')
}

function handleCopyShareText(): Promise<void> {
  return runCopy(() => copyText(generateShareText(props.notice)), '分享文本已复制到剪贴板')
}
</script>

<template>
  <v-dialog :model-value="true" @update:model-value="emit('close')" max-width="400">
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <v-card-title class="pa-0">分享通知</v-card-title>
        <v-btn icon variant="text" size="small" aria-label="关闭分享弹窗" @click="emit('close')">
          <v-icon>$close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text>
        <!-- 通知预览 -->
        <div class="share-preview mb-4">
          <div class="text-subtitle-2 mb-1">{{ notice.title }}</div>
          <div class="text-caption text-medium-emphasis">{{ notice.aiSummary }}</div>
        </div>

        <!-- 分享选项 -->
        <v-list>
          <v-list-item
            v-if="isShareSupported()"
            prepend-icon="$shareVariant"
            title="系统分享"
            subtitle="通过系统分享菜单分享"
            :disabled="actionPending"
            @click="handleNativeShare"
          />
          <v-list-item
            prepend-icon="$link"
            title="复制链接"
            subtitle="复制通知链接到剪贴板"
            :disabled="actionPending"
            @click="handleCopyLink"
          />
          <v-list-item
            prepend-icon="$contentCopy"
            title="复制内容"
            subtitle="复制通知标题和摘要"
            :disabled="actionPending"
            @click="handleCopyContent"
          />
          <v-list-item
            prepend-icon="$textBox"
            title="复制分享文本"
            subtitle="生成格式化的分享文本"
            :disabled="actionPending"
            @click="handleCopyShareText"
          />
        </v-list>
      </v-card-text>
    </v-card>

    <!-- 提示消息 -->
    <v-snackbar v-model="showSnackbar" :color="snackbarColor" :timeout="2000" location="bottom">
      {{ snackbarText }}
    </v-snackbar>
  </v-dialog>
</template>

<style scoped>
.share-preview {
  padding: 12px;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
  border-radius: 8px;
}
</style>
