<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { fetchNoticeById } from '../utils/request'
import type { NoticeItem } from '../types/notice'

const route = useRoute()
const router = useRouter()

const notice = ref<NoticeItem | null>(null)
const loading = ref(true)

onMounted(async () => {
  const id = route.params.id as string
  try {
    notice.value = await fetchNoticeById(id)
  } catch {
    showToast('加载通知详情失败')
  } finally {
    loading.value = false
  }
})

// 对 cleanContent 中的图片做安全约束
const safeContent = computed(() => {
  if (!notice.value?.cleanContent) return ''
  return notice.value.cleanContent
    // 移除可能残留的 script 标签
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // 给所有 img 加内联安全样式
    .replace(/<img\s/gi, '<img style="max-width:100%;height:auto;" ')
})

function copyAttachmentUrl(url: string): void {
  navigator.clipboard.writeText(url).then(
    () => showToast('已复制附件下载链接，请在外部浏览器中打开'),
    () => showToast('复制失败，请手动复制链接'),
  )
}

function goBack(): void {
  router.back()
}
</script>

<template>
  <div class="detail-page">
    <van-nav-bar
      title="通知详情"
      left-arrow
      fixed
      placeholder
      @click-left="goBack"
    />

    <van-loading v-if="loading" class="loading-wrapper" />

    <template v-if="notice">
      <!-- AI 智能提炼卡片 -->
      <div class="ai-summary-card">
        <div class="ai-summary-header">
          <span class="ai-icon">🤖</span>
          <span>AI 秘书已为您提炼干货</span>
        </div>

        <van-cell-group inset>
          <van-cell
            title="📅 截止时间"
            :value="notice.deadline || '未提及'"
            value-class="text-danger-bold"
          />
          <van-cell
            title="🎯 面向对象"
            :value="notice.targetAudience || '未提及'"
          />
          <van-cell
            title="📍 核心行动/地点"
            :value="notice.coreAction || '未提及'"
          />
        </van-cell-group>

        <p class="ai-detail-summary">{{ notice.aiSummary }}</p>
      </div>

      <!-- 视觉分割 -->
      <van-divider content-position="left">通知原文</van-divider>

      <!-- 原文渲染区 -->
      <div
        class="clean-content"
        v-html="safeContent"
      />

      <!-- 附件列表 -->
      <van-cell-group
        v-if="notice.attachments.length > 0"
        title="附件列表"
        class="attachments-group"
      >
        <van-cell
          v-for="(att, idx) in notice.attachments"
          :key="idx"
          :title="att.name"
          icon="description-o"
          is-link
          @click="copyAttachmentUrl(att.url)"
        />
      </van-cell-group>

      <div v-else class="no-attachments">
        <van-divider>暂无附件</van-divider>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  padding-bottom: 60px;
  min-height: 100vh;
  background: var(--notifai-bg-page);
}

.loading-wrapper {
  display: flex;
  justify-content: center;
  padding: 80px 0;
}

/* AI 提炼卡片 */
.ai-summary-card {
  margin: 12px;
  padding: 20px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--notifai-brand) 0%, var(--notifai-brand-2) 100%);
  color: #fff;
}

.ai-summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.ai-icon {
  font-size: 24px;
}

.ai-summary-card :deep(.van-cell-group) {
  margin-bottom: 16px;
}

.ai-summary-card :deep(.van-cell) {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  margin-bottom: 4px;
  color: #fff;
}

.ai-summary-card :deep(.van-cell__title) {
  color: rgba(255, 255, 255, 0.9);
}

.ai-summary-card :deep(.van-cell__value) {
  color: #fff;
}

.ai-summary-card :deep(.text-danger-bold) {
  color: var(--notifai-danger-soft) !important;
  font-weight: bold;
}

.ai-detail-summary {
  font-size: 14px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.95);
  padding: 0 12px;
}

/* 原文渲染区 */
.clean-content {
  margin: 0 12px;
  padding: 16px;
  background: var(--notifai-bg-card);
  border-radius: 10px;
  font-size: 15px;
  line-height: 1.8;
  color: var(--notifai-text-primary);
  overflow-wrap: break-word;
}

.clean-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.clean-content :deep(table) {
  max-width: 100%;
  display: block;
  overflow-x: auto;
}

/* 附件 */
.attachments-group {
  margin: 12px;
}

.no-attachments {
  padding: 24px 0;
}
</style>
