<script setup lang="ts">
import { computed } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import type { NoticeItem } from '../types/notice'
import { isUrgent, formatRemaining } from '../utils/date'

const props = defineProps<{
  notices: NoticeItem[]
}>()

const store = useUserSettingsStore()

const urgentNotices = computed(() =>
  props.notices.filter((n) => isUrgent(n.deadline)),
)

const scrollText = computed(() => {
  if (urgentNotices.value.length === 0) return ''
  return urgentNotices.value
    .map(
      (n) =>
        `🔥 ${n.source} 《${n.title}》 ${formatRemaining(n.deadline)}！`,
    )
    .join('    ')
})

const barColor = computed(() =>
  store.isDark ? '#ff8a7a' : '#ee0a24',
)

const barBackground = computed(() =>
  store.isDark ? '#2c1f14' : '#fff7f0',
)
</script>

<template>
  <van-notice-bar
    v-if="scrollText"
    :text="scrollText"
    scrollable
    left-icon="volume-o"
    :color="barColor"
    :background="barBackground"
    class="ddl-notice-bar"
  />
</template>

<style scoped>
.ddl-notice-bar {
  margin: 8px 12px;
  border-radius: 8px;
}
</style>
