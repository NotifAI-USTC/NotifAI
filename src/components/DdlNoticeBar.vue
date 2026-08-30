<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { DeadlineItem } from '../types/notice'
import { formatRemaining, isUrgent } from '../utils/date'
import AppBanner from './AppBanner.vue'

const props = defineProps<{
  notices: DeadlineItem[]
}>()

const router = useRouter()

/** 3 天内截止的紧急通知，按截止日期从近到远排序 */
const urgentNotices = computed(() =>
  props.notices
    .filter((notice) => isUrgent(notice.deadline))
    .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? '')),
)

function openNotice(id: string): void {
  void router.push({ name: 'Detail', params: { id } })
}
</script>

<template>
  <AppBanner
    v-if="urgentNotices.length > 0"
    type="warning"
    variant="tonal"
    density="compact"
    icon="$clockAlert"
    class="ddl-notice-bar ma-2"
  >
    <div class="d-flex align-center ga-2">
      <span class="ddl-notice-bar__label text-caption font-weight-bold text-medium-emphasis">
        紧急 DDL
      </span>

      <v-slide-group class="ddl-notice-bar__slider" show-arrows mandatory>
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
  </AppBanner>
</template>

<style scoped>
.ddl-notice-bar {
  margin-inline: 8px;
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
  max-width: min(70vw, 440px);
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
</style>
