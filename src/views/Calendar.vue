<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserSettingsStore } from '../stores/userSettings'
import { ApiConfigurationError, fetchNotices } from '../utils/request'
import {
  formatLocalDate,
  formatPublishDate,
  formatRemaining,
  getLocalToday,
  isUrgent,
  parseLocalDate,
  shiftLocalMonth,
} from '../utils/date'
import { getSourceColor } from '../types/notice'
import { getContrastTextColor } from '../utils/color'
import type { NoticeItem } from '../types/notice'
import { useWindowSize } from '../composables/useWindowSize'
import { isOffsetPageInconsistent } from '../utils/pagination'
import { buildMonthIcs, downloadIcs } from '../utils/ics'

const router = useRouter()
const store = useUserSettingsStore()
const { isMobile } = useWindowSize()
const CALENDAR_PAGE_SIZE = 200
const MAX_CALENDAR_ITEMS = 500
const MAX_CALENDAR_PAGES = Math.ceil(MAX_CALENDAR_ITEMS / CALENDAR_PAGE_SIZE)

interface CalendarEvent {
  name: string
  start: string
  end: string
  color: string
  textColor: string
  timed: boolean
  noticeId: string
  source: string
  type: 'publish' | 'deadline'
  notice: NoticeItem
}

interface CalendarCell {
  dateStr: string
  dayNumber: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  events: CalendarEvent[]
}

const MAX_EVENTS_PER_CELL = 3
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const notices = ref<NoticeItem[]>([])
const loading = ref(true)
const loadError = ref('')
const calendarDate = ref(getLocalToday())
const selectedDate = ref<string | null>(null)
let loadRequestId = 0
let loadController: AbortController | null = null

function getMonthRange(dateStr: string): { start: string; end: string } | null {
  const date = parseLocalDate(dateStr)
  if (!date) return null

  return {
    start: formatLocalDate(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: formatLocalDate(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  }
}

const visibleMonthKey = computed(() => calendarDate.value.substring(0, 7))
const visibleMonthRange = computed(() => getMonthRange(calendarDate.value))

const visibleMonthLabel = computed(() => {
  const date = parseLocalDate(calendarDate.value)
  if (!date) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
})

function noticeTouchesRange(notice: NoticeItem, start: string, end: string): boolean {
  const publishInRange = notice.publishDate >= start && notice.publishDate <= end
  const deadlineInRange = Boolean(
    notice.deadline && notice.deadline >= start && notice.deadline <= end,
  )
  return publishInRange || deadlineInRange
}

function navigateMonth(delta: number) {
  const nextDate = shiftLocalMonth(calendarDate.value, delta)
  if (nextDate) calendarDate.value = nextDate
}

// 将 NoticeItem 转换为 CalendarEvent
const calendarEvents = computed<CalendarEvent[]>(() => {
  const events: CalendarEvent[] = []
  const range = visibleMonthRange.value
  if (!range) return events

  for (const notice of notices.value) {
    // 发布日期事件
    if (notice.publishDate >= range.start && notice.publishDate <= range.end) {
      events.push({
        name: notice.title,
        start: notice.publishDate,
        end: notice.publishDate,
        color: getSourceColor(notice.source),
        textColor: getContrastTextColor(getSourceColor(notice.source)),
        timed: false,
        noticeId: notice.id,
        source: notice.source,
        type: 'publish',
        notice,
      })
    }

    // 截止日期事件（如果不同于发布日期）
    if (
      notice.deadline &&
      notice.deadline !== notice.publishDate &&
      notice.deadline >= range.start &&
      notice.deadline <= range.end
    ) {
      events.push({
        name: notice.title,
        start: notice.deadline,
        end: notice.deadline,
        color: isUrgent(notice.deadline) ? '#ef4444' : '#f59e0b',
        textColor: getContrastTextColor(isUrgent(notice.deadline) ? '#ef4444' : '#f59e0b'),
        timed: false,
        noticeId: notice.id,
        source: notice.source,
        type: 'deadline',
        notice,
      })
    }
  }

  return events
})

const mobileAgendaEvents = computed(() => {
  return [...calendarEvents.value].sort((a, b) => {
    const dateOrder = a.start.localeCompare(b.start)
    if (dateOrder !== 0) return dateOrder
    return a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'deadline' ? -1 : 1
  })
})

// 选中日期的事件
const selectedDateEvents = computed(() => {
  if (!selectedDate.value) return []
  return calendarEvents.value.filter((e) => e.start === selectedDate.value)
})

// 去重后的选中日期通知
const selectedDateNotices = computed(() => {
  const seen = new Set<string>()
  const result: NoticeItem[] = []
  for (const event of selectedDateEvents.value) {
    if (!seen.has(event.noticeId)) {
      seen.add(event.noticeId)
      result.push(event.notice)
    }
  }
  return result
})

const selectedDateLabel = computed(() => {
  if (!selectedDate.value) return ''
  return formatPublishDate(selectedDate.value)
})

function handleDayClick(dateStr: string): void {
  selectedDate.value = selectedDate.value === dateStr ? null : dateStr
}

const todayStr = computed(() => getLocalToday())

/** 42 格（6 周）月网格，周一开头，覆盖所有月份布局。 */
const monthGrid = computed<CalendarCell[][]>(() => {
  const range = visibleMonthRange.value
  if (!range) return []
  const first = parseLocalDate(range.start)
  if (!first) return []

  const year = first.getFullYear()
  const month = first.getMonth()
  const leadingOffset = (first.getDay() + 6) % 7 // 周一=0 ... 周日=6

  const eventsByDate = new Map<string, CalendarEvent[]>()
  for (const event of calendarEvents.value) {
    const list = eventsByDate.get(event.start) ?? []
    list.push(event)
    eventsByDate.set(event.start, list)
  }

  const cells: CalendarCell[] = []
  const startDate = new Date(year, month, 1 - leadingOffset)
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + index,
    )
    const dateStr = formatLocalDate(date)
    cells.push({
      dateStr,
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      isToday: dateStr === todayStr.value,
      isSelected: dateStr === selectedDate.value,
      events: eventsByDate.get(dateStr) ?? [],
    })
  }

  const weeks: CalendarCell[][] = []
  for (let index = 0; index < 42; index += 7) {
    weeks.push(cells.slice(index, index + 7))
  }
  return weeks
})

function cellAriaLabel(cell: CalendarCell): string {
  const eventSummary = cell.events.length > 0 ? `，${cell.events.length} 项通知` : ''
  return `${formatPublishDate(cell.dateStr)}${eventSummary}`
}

function goToToday() {
  const today = getLocalToday()
  calendarDate.value = today
  selectedDate.value = today
}

function goToDetail(id: string) {
  void router.push({ name: 'Detail', params: { id } })
}

function handleExportIcs(): void {
  const events = calendarEvents.value.map((event) => ({
    uid: `${event.noticeId}-${event.type}-${event.start}`,
    start: event.start,
    title: `${event.type === 'deadline' ? '截止' : '发布'} · ${event.name}`,
    description: `来源: ${event.source}\n${event.type === 'deadline' ? '截止日期' : '发布日期'}: ${event.start}`,
  }))
  downloadIcs(`notifai-calendar-${visibleMonthKey.value}.ics`, buildMonthIcs(events))
}

function eventAriaLabel(rawEvent: unknown): string {
  const event = rawEvent as CalendarEvent
  const type = event.type === 'deadline' ? '截止' : '发布'
  return `${formatPublishDate(event.start)}${type}：${event.name}`
}

async function loadVisibleMonth() {
  const range = getMonthRange(calendarDate.value)
  if (!range) {
    loadRequestId += 1
    loadController?.abort()
    loadController = null
    loadError.value = '日历日期无效'
    loading.value = false
    return
  }

  const requestId = ++loadRequestId
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  loading.value = true
  loadError.value = ''

  try {
    const loaded = new Map<string, NoticeItem>()
    let expectedTotal: number | null = null
    let page = 1

    while (expectedTotal === null || loaded.size < expectedTotal) {
      if (page > MAX_CALENDAR_PAGES) {
        throw new Error('当月通知分页超过日历加载上限')
      }
      const res = await fetchNotices(
        {
          rangeFrom: range.start,
          rangeTo: range.end,
          page,
          pageSize: CALENDAR_PAGE_SIZE,
        },
        controller.signal,
      )
      if (requestId !== loadRequestId) return

      if (expectedTotal === null) {
        expectedTotal = res.total
        if (expectedTotal > MAX_CALENDAR_ITEMS) {
          throw new Error('当月通知数量超过日历加载上限')
        }
      } else if (res.total !== expectedTotal) {
        throw new Error('通知列表在加载期间发生了变化')
      }
      if (
        isOffsetPageInconsistent({
          itemCount: res.items.length,
          page,
          pageSize: CALENDAR_PAGE_SIZE,
          total: res.total,
        })
      ) {
        throw new Error('通知分页返回数量与总数不一致')
      }

      const previousSize = loaded.size
      for (const notice of res.items) loaded.set(notice.id, notice)
      if (loaded.size === previousSize && loaded.size < expectedTotal) {
        throw new Error('通知分页返回了重复数据')
      }
      if (res.items.length === 0 && loaded.size < expectedTotal) {
        throw new Error('通知分页提前结束')
      }
      page += 1
    }

    const monthNotices = Array.from(loaded.values()).filter((notice) =>
      noticeTouchesRange(notice, range.start, range.end),
    )
    notices.value = monthNotices
    store.cacheNotices(monthNotices)
  } catch (error) {
    if (controller.signal.aborted || requestId !== loadRequestId) return
    notices.value = []
    loadError.value =
      error instanceof ApiConfigurationError ? error.message : '无法加载当月通知，请检查网络后重试'
  } finally {
    if (loadController === controller) loadController = null
    if (requestId === loadRequestId) loading.value = false
  }
}

watch(
  visibleMonthKey,
  () => {
    selectedDate.value = null
    void loadVisibleMonth()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadRequestId += 1
  loadController?.abort()
  loadController = null
})
</script>

<template>
  <div class="calendar-page">
    <v-app-bar color="surface" elevation="1">
      <v-app-bar-title>通知日历</v-app-bar-title>
      <v-spacer />
      <v-btn size="small" variant="tonal" prepend-icon="$calendarToday" @click="goToToday">
        回到今天
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="$fileDownload"
        class="ml-2"
        :disabled="calendarEvents.length === 0"
        aria-label="导出当月日历"
        @click="handleExportIcs"
      >
        导出 ICS
      </v-btn>
    </v-app-bar>

    <!-- 加载状态 -->
    <v-card
      v-if="loading"
      flat
      class="d-flex justify-center pa-8 bg-transparent"
      aria-live="polite"
    >
      <v-progress-circular indeterminate color="primary" />
    </v-card>

    <v-alert v-else-if="loadError" type="error" variant="tonal" class="ma-3" role="alert">
      {{ loadError }}
      <template #append>
        <v-btn prepend-icon="$refresh" variant="text" @click="loadVisibleMonth"> 重试 </v-btn>
      </template>
    </v-alert>

    <template v-else>
      <!-- VCalendar 月视图 -->
      <div class="calendar-wrapper">
        <!-- 月份导航 -->
        <div class="calendar-header">
          <v-btn
            icon
            variant="text"
            size="small"
            aria-label="上一个月"
            title="上一个月"
            @click="navigateMonth(-1)"
          >
            <v-icon>$chevronLeft</v-icon>
          </v-btn>
          <h2 class="header-title">{{ visibleMonthLabel }}</h2>
          <v-btn
            icon
            variant="text"
            size="small"
            aria-label="下一个月"
            title="下一个月"
            @click="navigateMonth(1)"
          >
            <v-icon>$chevronRight</v-icon>
          </v-btn>
        </div>

        <!-- 自研月网格（替代弃用的 v-calendar） -->
        <div v-if="!isMobile" class="month-grid" role="grid" aria-label="月份日历">
          <div class="month-grid__head" role="row">
            <div
              v-for="label in WEEKDAY_LABELS"
              :key="label"
              class="month-grid__weekday"
              role="columnheader"
            >
              {{ label }}
            </div>
          </div>
          <div v-for="(week, weekIndex) in monthGrid" :key="weekIndex" class="month-grid__row" role="row">
            <div
              v-for="cell in week"
              :key="cell.dateStr"
              class="month-grid__cell"
              :class="{
                'month-grid__cell--outside': !cell.inMonth,
                'month-grid__cell--today': cell.isToday,
                'month-grid__cell--selected': cell.isSelected,
              }"
              role="gridcell"
              :aria-label="cellAriaLabel(cell)"
              :aria-selected="cell.isSelected"
              tabindex="0"
              @click="handleDayClick(cell.dateStr)"
              @keydown.enter.prevent="handleDayClick(cell.dateStr)"
              @keydown.space.prevent="handleDayClick(cell.dateStr)"
            >
              <div class="month-grid__date">{{ cell.dayNumber }}</div>
              <div class="month-grid__events">
                <template
                  v-for="event in cell.events.slice(0, MAX_EVENTS_PER_CELL)"
                  :key="`${event.type}-${event.noticeId}`"
                >
                  <button
                    type="button"
                    class="event-chip"
                    :class="{ 'event-chip--deadline': event.type === 'deadline' }"
                    :style="{ backgroundColor: event.color, color: event.textColor }"
                    :aria-label="eventAriaLabel(event)"
                    :title="event.name"
                    @click.stop="goToDetail(event.noticeId)"
                  >
                    <v-icon v-if="event.type === 'deadline'" size="10" class="mr-1">
                      $clockAlert
                    </v-icon>
                    <span class="event-text">{{ event.name }}</span>
                  </button>
                </template>
                <button
                  v-if="cell.events.length > MAX_EVENTS_PER_CELL"
                  type="button"
                  class="month-grid__more"
                  :aria-label="`查看 ${formatPublishDate(cell.dateStr)} 更多通知`"
                  @click.stop="handleDayClick(cell.dateStr)"
                >
                  +{{ cell.events.length - MAX_EVENTS_PER_CELL }} 项
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="mobile-agenda" aria-label="当月议程">
          <v-list v-if="mobileAgendaEvents.length > 0" lines="two">
            <v-list-subheader>当月议程</v-list-subheader>
            <v-list-item
              v-for="event in mobileAgendaEvents"
              :key="`${event.type}-${event.noticeId}-${event.start}`"
              :title="event.name"
              :subtitle="`${formatPublishDate(event.start)} · ${event.source}`"
              @click="goToDetail(event.noticeId)"
            >
              <template #prepend>
                <v-icon :color="event.color">
                  {{ event.type === 'deadline' ? '$clockAlertOutline' : '$bullhornOutline' }}
                </v-icon>
              </template>
              <template #append>
                <v-chip
                  size="x-small"
                  :color="event.type === 'deadline' ? 'warning' : 'primary'"
                  variant="tonal"
                >
                  {{ event.type === 'deadline' ? '截止' : '发布' }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
          <div v-else class="mobile-agenda-empty">
            <v-icon size="36" color="grey">$calendarBlankOutline</v-icon>
            <span>当月暂无通知</span>
          </div>
        </div>
      </div>

      <!-- 图例 -->
      <div class="d-flex justify-center ga-3 pa-3">
        <v-chip size="small" variant="tonal" color="primary">
          <template #prepend>
            <v-icon size="12" start>$circle</v-icon>
          </template>
          发布通知
        </v-chip>
        <v-chip size="small" variant="tonal" color="error">
          <template #prepend>
            <v-icon size="12" start>$circle</v-icon>
          </template>
          紧急截止
        </v-chip>
        <v-chip size="small" variant="tonal" color="warning">
          <template #prepend>
            <v-icon size="12" start>$circle</v-icon>
          </template>
          即将截止
        </v-chip>
      </div>

      <!-- 选中日期的通知面板 -->
      <v-expand-transition>
        <div v-if="selectedDate && selectedDateNotices.length > 0" class="selected-panel">
          <div class="selected-header">
            <span class="selected-label">{{ selectedDateLabel }}</span>
            <v-chip size="small" color="primary" variant="tonal">
              {{ selectedDateNotices.length }} 条通知
            </v-chip>
          </div>
          <v-list density="compact" class="selected-list">
            <v-list-item
              v-for="notice in selectedDateNotices"
              :key="notice.id"
              @click="goToDetail(notice.id)"
              rounded="lg"
              class="selected-item"
            >
              <template #prepend>
                <div class="source-bar" :style="{ background: getSourceColor(notice.source) }" />
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ notice.title }}
              </v-list-item-title>
              <v-list-item-subtitle class="d-flex align-center ga-2 mt-1">
                <span>{{ notice.source }}</span>
                <v-chip
                  v-if="notice.deadline"
                  size="x-small"
                  :color="isUrgent(notice.deadline) ? 'error' : 'default'"
                  variant="flat"
                  density="compact"
                >
                  {{ formatRemaining(notice.deadline) }}
                </v-chip>
              </v-list-item-subtitle>
              <template #append>
                <v-icon size="small" color="grey">$chevronRight</v-icon>
              </template>
            </v-list-item>
          </v-list>
        </div>
      </v-expand-transition>

      <!-- 选中日期无通知 -->
      <v-expand-transition>
        <v-card
          v-if="selectedDate && selectedDateNotices.length === 0"
          flat
          class="mx-3 mt-2 text-center pa-4 bg-transparent"
        >
          <v-icon size="32" color="grey">$calendarCheck</v-icon>
          <v-card-subtitle>{{ selectedDateLabel }} 暂无通知</v-card-subtitle>
        </v-card>
      </v-expand-transition>
    </template>
  </div>
</template>

<style scoped>
.calendar-page {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
  padding-bottom: 24px;
}

.calendar-wrapper {
  margin: 0 12px;
  border-radius: 8px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

/* ---- 自研月网格 ---- */
.month-grid {
  display: block;
  user-select: none;
}

.month-grid__head,
.month-grid__row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.month-grid__head {
  background: rgba(var(--v-theme-primary), 0.04);
  border-bottom: 1px solid rgb(var(--v-theme-surface-variant));
}

.month-grid__weekday {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
  padding: 8px 0;
  text-align: center;
}

.month-grid__cell {
  min-height: 84px;
  border-right: 1px solid rgb(var(--v-theme-surface-variant));
  border-bottom: 1px solid rgb(var(--v-theme-surface-variant));
  padding: 2px;
  cursor: pointer;
  outline: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.month-grid__cell:nth-child(7n) {
  border-right: none;
}

.month-grid__cell--outside {
  background: rgba(var(--v-theme-surface-variant), 0.3);
}

.month-grid__cell--selected {
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

.month-grid__cell:focus-visible {
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

.month-grid__date {
  width: 24px;
  height: 24px;
  margin: 2px 0 2px 2px;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  align-items: center;
  justify-content: center;
}

.month-grid__cell--today .month-grid__date {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border-radius: 50%;
}

.month-grid__cell--outside .month-grid__date {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.6;
}

.month-grid__events {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow: hidden;
}

.month-grid__more {
  border: none;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font-size: 11px;
  text-align: left;
  padding: 0 4px;
  cursor: pointer;
  font-family: inherit;
}

/* ---- 事件条 ---- */
.event-chip {
  display: flex;
  align-items: center;
  width: 100%;
  border: 0;
  font-family: inherit;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 1px;
  line-height: 1.5;
  transition: opacity 0.15s;
}

.event-chip:hover {
  opacity: 0.85;
}

.event-chip--deadline {
  font-weight: 600;
}

.event-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- 头部导航 ---- */
.calendar-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 12px 16px;
  background: rgb(var(--v-theme-surface));
}

.header-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  min-width: 120px;
  text-align: center;
}

.mobile-agenda {
  display: block;
}

.mobile-agenda-empty {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 14px;
}

/* ---- 选中日期面板 ---- */
.selected-panel {
  margin: 8px 12px 0;
  padding: 12px;
  background: rgb(var(--v-theme-surface));
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.selected-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 4px;
}

.selected-label {
  font-size: 14px;
  font-weight: 600;
}

.selected-list {
  background: transparent;
}

.selected-item {
  margin-bottom: 2px;
}

.source-bar {
  width: 3px;
  height: 28px;
  border-radius: 2px;
  margin-right: 8px;
  flex-shrink: 0;
}

/* ---- 移动端适配 ---- */
@media (max-width: 600px) {
  .calendar-wrapper {
    margin: 0 8px;
  }

  .calendar-header {
    justify-content: space-between;
    padding: 10px 8px;
  }

  .selected-panel {
    margin-inline: 8px;
  }
}
</style>
