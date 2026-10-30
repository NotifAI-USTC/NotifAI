<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { DeadlineItem } from '../types/notice'
import { formatRemaining, isUrgent } from '../utils/date'
import AppBanner from './AppBanner.vue'
import { useWindowSize } from '../composables/useWindowSize'

const props = defineProps<{
  notices: DeadlineItem[]
}>()

const router = useRouter()
const { isMobile, width } = useWindowSize()

const activeIndex = ref(0)
const slidesRef = ref<HTMLElement | null>(null)

/** 3 天内截止的紧急通知，按截止日期从近到远排序 */
const urgentNotices = computed(() =>
  props.notices
    .filter((notice) => isUrgent(notice.deadline))
    .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? '')),
)

function openNotice(id: string): void {
  void router.push({ name: 'Detail', params: { id } })
}

/**
 * 移动端一次只展示一条通知：横向滚动容器负责触摸滑动，
 * 翻页按钮只更新选中下标并对齐滚动位置。
 */
function scrollToIndex(index: number): void {
  const total = urgentNotices.value.length
  if (total === 0) return

  const target = Math.min(Math.max(index, 0), total - 1)
  activeIndex.value = target

  const el = slidesRef.value
  if (!el) return

  // 直接对齐而不是平滑滚动：避免滚动事件把页码短暂回退到中间位置。
  const left = target * el.clientWidth
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ left, behavior: 'auto' })
  } else {
    el.scrollLeft = left
  }
}

function handleSlidesScroll(): void {
  const el = slidesRef.value
  if (!el || el.clientWidth <= 0) return

  const next = Math.round(el.scrollLeft / el.clientWidth)
  const clamped = Math.min(Math.max(next, 0), urgentNotices.value.length - 1)
  if (clamped !== activeIndex.value) activeIndex.value = clamped
}

function showPrev(): void {
  scrollToIndex(activeIndex.value - 1)
}

function showNext(): void {
  scrollToIndex(activeIndex.value + 1)
}

// 列表长度变化后避免下标越界。
watch(
  () => urgentNotices.value.length,
  (length) => {
    if (length === 0) {
      activeIndex.value = 0
      return
    }
    if (activeIndex.value > length - 1) {
      activeIndex.value = length - 1
      void nextTick(() => scrollToIndex(length - 1))
    }
  },
)

// 窗口尺寸或横竖屏变化后重新对齐当前条目。
watch(width, () => {
  if (!isMobile.value) return
  void nextTick(() => scrollToIndex(activeIndex.value))
})
</script>

<template>
  <AppBanner
    v-if="urgentNotices.length > 0"
    type="warning"
    variant="tonal"
    density="compact"
    :icon="isMobile ? false : '$clockAlert'"
    class="ddl-notice-bar ma-2"
  >
    <div v-if="!isMobile" class="d-flex align-center ga-2">
      <span class="ddl-notice-bar__label text-body-small font-weight-bold text-medium-emphasis">
        紧急 DDL
      </span>

      <v-slide-group class="ddl-notice-bar__slider" :show-arrows="!isMobile" mandatory>
        <v-slide-group-item v-for="notice in urgentNotices" :key="notice.id">
          <v-chip
            class="ddl-notice-bar__chip ma-1"
            size="small"
            :color="isUrgent(notice.deadline, 0) ? 'error' : 'warning'"
            variant="flat"
            :aria-label="`查看紧急通知：${notice.title}，${formatRemaining(notice.deadline)}`"
            :title="notice.title"
            @click="openNotice(notice.id)"
          >
            <v-icon start size="small">$clockAlert</v-icon>
            <span class="ddl-notice-bar__chip-title">
              {{ notice.source }} · {{ notice.title }}
            </span>
            <span class="ddl-notice-bar__chip-deadline">
              {{ formatRemaining(notice.deadline) }}
            </span>
          </v-chip>
        </v-slide-group-item>
      </v-slide-group>
    </div>

    <div v-else class="ddl-notice-bar__mobile">
      <div
        ref="slidesRef"
        class="ddl-notice-bar__slides"
        role="group"
        aria-label="紧急 DDL 列表"
        @scroll.passive="handleSlidesScroll"
      >
        <button
          v-for="(notice, index) in urgentNotices"
          :key="notice.id"
          type="button"
          class="ddl-notice-bar__slide"
          :aria-label="`查看紧急通知：${notice.title}，${notice.source}，${formatRemaining(notice.deadline)}`"
          :title="notice.title"
          :aria-current="index === activeIndex ? 'true' : undefined"
          @click="openNotice(notice.id)"
        >
          <v-icon size="16" class="ddl-notice-bar__slide-icon" aria-hidden="true">
            $clockAlert
          </v-icon>
          <span class="ddl-notice-bar__slide-body">
            <span class="ddl-notice-bar__slide-title text-body-small font-weight-medium">
              {{ notice.title }}
            </span>
            <span class="ddl-notice-bar__slide-meta text-body-small">
              <span class="ddl-notice-bar__slide-source text-medium-emphasis">
                {{ notice.source }}
              </span>
              <span class="text-medium-emphasis" aria-hidden="true">·</span>
              <span
                class="ddl-notice-bar__slide-remaining font-weight-medium"
                :class="{ 'text-error': isUrgent(notice.deadline, 0) }"
              >
                {{ formatRemaining(notice.deadline) }}
              </span>
            </span>
          </span>
        </button>
      </div>

      <div
        v-if="urgentNotices.length > 1"
        class="ddl-notice-bar__pager"
        role="group"
        aria-label="切换紧急 DDL"
      >
        <v-btn
          icon="$chevronLeft"
          size="small"
          variant="text"
          density="compact"
          :disabled="activeIndex === 0"
          aria-label="上一条紧急 DDL"
          @click="showPrev"
        />
        <span
          class="ddl-notice-bar__pager-count text-body-small font-weight-medium"
          aria-live="polite"
        >
          {{ activeIndex + 1 }}/{{ urgentNotices.length }}
        </span>
        <v-btn
          icon="$chevronRight"
          size="small"
          variant="text"
          density="compact"
          :disabled="activeIndex >= urgentNotices.length - 1"
          aria-label="下一条紧急 DDL"
          @click="showNext"
        />
      </div>
    </div>
  </AppBanner>
</template>

<style scoped>
@layer notifai-components {
  .ddl-notice-bar {
    margin-inline: 8px;
  }

  /* Vuetify 默认将 prepend 图标顶对齐（非 prominent 告警），
     桌面端内容比图标高时需要垂直居中 */
  .ddl-notice-bar :deep(.v-alert__prepend) {
    align-self: center;
  }

  .ddl-notice-bar__label {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .ddl-notice-bar__slider {
    min-width: 0;
    flex: 1 1 auto;
  }

  .ddl-notice-bar__chip {
    max-width: min(calc(100cqw - 8px), 440px);
  }

  .ddl-notice-bar__slider :deep(.v-slide-group__container) {
    container-type: inline-size;
  }

  .ddl-notice-bar__chip :deep(.v-chip__content) {
    min-width: 0;
    max-width: 100%;
  }

  .ddl-notice-bar__chip-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ddl-notice-bar__chip-deadline {
    flex: 0 0 auto;
    margin-inline-start: 4px;
  }

  /* 移动端：单条展示 + 底部翻页，整体高度与桌面单行横幅接近 */
  .ddl-notice-bar__mobile {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    width: 100%;
    min-width: 0;
  }

  .ddl-notice-bar__slides {
    display: flex;
    flex: 1 1 0;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }

  .ddl-notice-bar__slides::-webkit-scrollbar {
    display: none;
  }

  .ddl-notice-bar__slide {
    display: flex;
    flex: 0 0 100%;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
    scroll-snap-align: start;
    scroll-snap-stop: always;
  }

  .ddl-notice-bar__slide:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: -2px;
    border-radius: 2px;
  }

  .ddl-notice-bar__slide-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
  }

  .ddl-notice-bar__slide-icon {
    flex: 0 0 auto;
    align-self: center;
  }

  .ddl-notice-bar__slide-title {
    display: block;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ddl-notice-bar__slide-meta {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
  }

  .ddl-notice-bar__slide-source {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ddl-notice-bar__slide-remaining {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .ddl-notice-bar__pager {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
  }

  .ddl-notice-bar__pager :deep(.v-btn) {
    color: inherit;
  }

  .ddl-notice-bar__pager-count {
    min-width: 2.4em;
    text-align: center;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
}
</style>
