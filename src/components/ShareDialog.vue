<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import QRCode from 'qrcode'
import type { NoticeItem } from '../types/notice'
import { buildNoticeUrl } from '../utils/appUrl'
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

const showQr = ref(false)
const qrDataUrl = ref('')
const qrError = ref('')

function noticeUrl(): string {
  return buildNoticeUrl(props.notice.id)
}

async function handleShowQr(): Promise<void> {
  if (showQr.value) {
    showQr.value = false
    return
  }
  if (actionPending.value) return
  actionPending.value = true
  qrError.value = ''
  try {
    qrDataUrl.value = await QRCode.toDataURL(noticeUrl(), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
    showQr.value = true
  } catch {
    qrError.value = '二维码生成失败，请重试'
  } finally {
    actionPending.value = false
  }
}

function handleSaveQr(): void {
  const anchor = document.createElement('a')
  anchor.href = qrDataUrl.value
  anchor.download = `notifai-qr-${props.notice.id}.png`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  snackbarText.value = '二维码图片已保存'
  snackbarColor.value = 'success'
  showSnackbar.value = true
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
          <v-list-item
            prepend-icon="$qrcode"
            title="二维码分享"
            subtitle="生成二维码，扫码打开通知"
            :disabled="actionPending"
            @click="handleShowQr"
          />
        </v-list>

        <!-- 二维码 -->
        <div v-if="qrError" class="text-error mt-2">{{ qrError }}</div>
        <div v-if="showQr" class="qr-block">
          <img :src="qrDataUrl" alt="通知分享二维码" class="qr-image" />
          <div class="text-caption text-medium-emphasis qr-link">{{ noticeUrl() }}</div>
          <v-btn
            size="small"
            color="primary"
            variant="tonal"
            prepend-icon="$fileDownload"
            class="mt-2"
            @click="handleSaveQr"
          >
            保存二维码图片
          </v-btn>
        </div>
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

.qr-block {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qr-image {
  width: 200px;
  height: 200px;
  image-rendering: pixelated;
  border-radius: 8px;
  border: 1px solid rgb(var(--v-theme-surface-variant));
}

.qr-link {
  max-width: 100%;
  word-break: break-all;
  text-align: center;
  margin-top: 8px;
}
</style>
