<script setup lang="ts">
import { computed } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import type { NoticeItem } from '../types/notice'
import { isUrgent, formatRemaining } from '../utils/date'

const props = defineProps<{
  notice: NoticeItem
}>()

const emit = defineEmits<{
  click: [id: string]
  read: [id: string]
  star: [id: string]
}>()

const store = useUserSettingsStore()

const urgent = isUrgent(props.notice.deadline)
const remainingText = formatRemaining(props.notice.deadline)

const tagColor = computed(() =>
  store.isDark ? '#8e8e93' : '#7f8490',
)
</script>

<template>
  <van-swipe-cell :right-width="130">
    <van-card
      :title="notice.title"
      :desc="notice.aiSummary || '暂无 AI 摘要'"
      :thumb="''"
      @click="emit('click', notice.id)"
    >
      <template #tags>
        <van-space wrap :size="6">
          <van-tag type="primary" size="medium" :color="tagColor">
            # {{ notice.source }}
          </van-tag>
          <van-tag
            v-if="notice.deadline"
            :type="urgent ? 'danger' : 'default'"
            size="medium"
          >
            ⏳ {{ remainingText }}
          </van-tag>
        </van-space>
      </template>
    </van-card>

    <template #right>
      <van-button
        square
        type="default"
        text="已读"
        class="swipe-btn swipe-btn--read"
        @click="emit('read', notice.id)"
      />
      <van-button
        square
        type="warning"
        text="收藏"
        class="swipe-btn swipe-btn--star"
        @click="emit('star', notice.id)"
      />
    </template>
  </van-swipe-cell>
</template>

<style scoped>
/* 卡片标题最多 2 行 */
:deep(.van-card__title) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  font-size: 15px;
  line-height: 1.4;
}

/* AI 摘要文字淡化 */
:deep(.van-card__desc) {
  font-size: 13px;
  color: var(--notifai-text-muted);
  margin-top: 6px;
}

/* 隐藏缩略图占位 */
:deep(.van-card__thumb) {
  display: none;
}

.swipe-btn {
  height: 100%;
  min-width: 65px;
  font-size: 14px;
}

.swipe-btn--read {
  background: var(--notifai-swipe-read-bg);
  color: var(--notifai-swipe-read-text);
}

.swipe-btn--star {
  background: var(--notifai-swipe-star-bg);
  color: #fff;
}
</style>
