<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ApiConfigurationError, fetchCalendarNotices, type FetchCalendarParams } from '../utils/request'
import {
  formatLocalDate,
  formatPublishDate,
  formatRemaining,
  getIsoWeek,
  getLocalToday,
  isUrgent,
  parseLocalDate,
  shiftLocalDays,
  shiftLocalMonth,
} from '../utils/date'
import { getSourceColor } from '../types/notice'
import { getContrastTextColor } from '../utils/color'
import type { CalendarItem } from '../types/notice'
import { useWindowSize } from '../composables/useWindowSize'
import { buildMonthIcs, downloadIcs } from '../utils/ics'

const router = useRouter()
const { isMobile } = useWindowSize()
const MAX_CALENDAR_ITEMS = 500

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
  notice: CalendarItem
}

interface CalendarCell {
  dateStr: string
  dayNumber: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  events: CalendarEvent[]
}

interface WeekDay {
  dateStr: string
  dayNumber: number
  weekdayLabel: string
  isToday: boolean
  isSelected: boolean
  events: CalendarEvent[]
}

const MAX_EVENTS_PER_CELL = 3
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const notices = ref<CalendarItem[]>([])
const loading = ref(true)
const loadError = ref('')
const calendarDate = ref(getLocalToday())
const selectedDate = ref<string | null>(null)
let loadRequestId = 0
let loadController: AbortController | null = null

const viewMode = ref<'month' | 'week'>('month')

function getMonthRange(dateStr: string): { start: string; end: string } | null {
  const date = parseLocalDate(dateStr)
  if (!date) return null

  return {
    start: formatLocalDate(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: formatLocalDate(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  }
}

/** 返回 dateStr 所在周的周一 ~ 周日（周一开头）。 */
function getWeekRange(dateStr: string): { start: string; end: string } | null {
  const date = parseLocalDate(dateStr)
  if (!date) return null
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return {
    start: formatLocalDate(monday),
    end: formatLocalDate(sunday),
  }
}

const visibleRange = computed(() =>
  viewMode.value === 'week'
    ? getWeekRange(calendarDate.value)
    : getMonthRange(calendarDate.value),
)
const visibleRangeKey = computed(() => {
  const range = visibleRange.value
  return range ? `${viewMode.value}:${range.start}` : ''
})

const visibleLabel = computed(() => {
  const range = visibleRange.value
  if (!range) return ''
  const start = parseLocalDate(range.start)
  const end = parseLocalDate(range.end)
  if (!start || !end) return ''
  if (viewMode.value === 'week') {
    const endShort = `${end.getMonth() + 1}月${end.getDate()}日`
    return `${formatPublishDate(range.start)} - ${endShort}`
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月`
})

function noticeTouchesRange(notice: CalendarItem, start: string, end: string): boolean {
  const publishInRange = notice.publishDate >= start && notice.publishDate <= end
  const deadlineInRange = Boolean(
    notice.deadline && notice.deadline >= start && notice.deadline <= end,
  )
  return publishInRange || deadlineInRange
}

function navigate(delta: number): void {
  const nextDate =
    viewMode.value === 'week'
      ? shiftLocalDays(calendarDate.value, delta * 7)
      : shiftLocalMonth(calendarDate.value, delta)
  if (nextDate) calendarDate.value = nextDate
}

function switchView(mode: 'month' | 'week'): void {
  if (viewMode.value === mode) return
  viewMode.value = mode
  selectedDate.value = null
}

// 将 CalendarItem 转换为 CalendarEvent
const calendarEvents = computed<CalendarEvent[]>(() => {
  const events: CalendarEvent[] = []
  const range = visibleRange.value
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
  const result: CalendarItem[] = []
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
  const range = visibleRange.value
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

/** 当前周的 7 天数据（周一开头）。 */
const weekGrid = computed<WeekDay[]>(() => {
  const range = visibleRange.value
  if (!range) return []
  const start = parseLocalDate(range.start)
  if (!start) return []

  const eventsByDate = new Map<string, CalendarEvent[]>()
  for (const event of calendarEvents.value) {
    const list = eventsByDate.get(event.start) ?? []
    list.push(event)
    eventsByDate.set(event.start, list)
  }

  const days: WeekDay[] = []
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    const dateStr = formatLocalDate(date)
    days.push({
      dateStr,
      dayNumber: date.getDate(),
      weekdayLabel: WEEKDAY_LABELS[index],
      isToday: dateStr === todayStr.value,
      isSelected: dateStr === selectedDate.value,
      events: eventsByDate.get(dateStr) ?? [],
    })
  }
  return days
})

function dayAriaLabel(day: WeekDay): string {
  const eventSummary = day.events.length > 0 ? `，${day.events.length} 项通知` : ''
  return `${formatPublishDate(day.dateStr)}${eventSummary}`
}

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
  const rangeKey = visibleRange.value?.start ?? getLocalToday()
  downloadIcs(`notifai-calendar-${rangeKey}.ics`, buildMonthIcs(events))
}

function eventAriaLabel(rawEvent: unknown): string {
  const event = rawEvent as CalendarEvent
  const type = event.type === 'deadline' ? '截止' : '发布'
  return `${formatPublishDate(event.start)}${type}：${event.name}`
}

async function loadVisibleRange() {
  const range = visibleRange.value
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
    // 使用轻量日历接口（GET /notices/calendar），一次请求获取整个月/周
    let params: FetchCalendarParams
    if (viewMode.value === 'week') {
      const week = getIsoWeek(calendarDate.value)
      if (!week) throw new Error('日历周无效')
      params = { week }
    } else {
      params = { month: range.start.slice(0, 7) }
    }

    const items = await fetchCalendarNotices(params, controller.signal)
    if (requestId !== loadRequestId) return

    if (items.length > MAX_CALENDAR_ITEMS) {
      throw new Error('通知数量超过日历加载上限')
    }
    // 后端按发布日/截止日命中范围返回，这里再做一次防御性过滤
    const rangeNotices = items.filter((notice) =>
      noticeTouchesRange(notice, range.start, range.end),
    )
    notices.value = rangeNotices
  } catch (error) {
    if (controller.signal.aborted || requestId !== loadRequestId) return
    notices.value = []
    loadError.value =
      error instanceof ApiConfigurationError ? error.message : '无法加载当前范围通知，请检查网络后重试'
  } finally {
    if (loadController === controller) loadController = null
    if (requestId === loadRequestId) loading.value = false
  }
}

watch(
  visibleRangeKey,
  () => {
    selectedDate.value = null
    void loadVisibleRange()
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
    <h1 class="sr-only">通知日历</h1>
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
        <v-btn prepend-icon="$refresh" variant="text" @click="loadVisibleRange"> 重试 </v-btn>
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
            :aria-label="viewMode === 'week' ? '上一周' : '上一个月'"
            :title="viewMode === 'week' ? '上一周' : '上一个月'"
            @click="navigate(-1)"
          >
            <v-icon>$chevronLeft</v-icon>
          </v-btn>
          <div class="calendar-header__center">
            <h2 class="header-title">{{ visibleLabel }}</h2>
            <v-btn-toggle
              :model-value="viewMode"
              mandatory
              density="compact"
              variant="tonal"
              aria-label="日历视图切换"
              @update:model-value="switchView($event as 'month' | 'week')"
            >
              <v-btn value="month">月</v-btn>
              <v-btn value="week">周</v-btn>
            </v-btn-toggle>
          </div>
          <v-btn
            icon
            variant="text"
            size="small"
            :aria-label="viewMode === 'week' ? '下一周' : '下一个月'"
            :title="viewMode === 'week' ? '下一周' : '下一个月'"
            @click="navigate(1)"
          >
            <v-icon>$chevronRight</v-icon>
          </v-btn>
        </div>

        <template v-if="viewMode === 'month'">
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
        </template>

        <!-- 周视图 -->
        <template v-else>
          <div v-if="!isMobile" class="week-grid" role="grid" aria-label="周历">
            <div
              v-for="day in weekGrid"
              :key="day.dateStr"
              class="week-grid__day"
              :class="{
                'week-grid__day--today': day.isToday,
                'week-grid__day--selected': day.isSelected,
              }"
              role="gridcell"
              :aria-label="dayAriaLabel(day)"
              :aria-selected="day.isSelected"
              tabindex="0"
              @click="handleDayClick(day.dateStr)"
              @keydown.enter.prevent="handleDayClick(day.dateStr)"
              @keydown.space.prevent="handleDayClick(day.dateStr)"
            >
              <div class="week-grid__date">
                <span class="week-grid__weekday">{{ day.weekdayLabel }}</span>
                <span
                  class="week-grid__daynum"
                  :class="{ 'week-grid__daynum--today': day.isToday }"
                >
                  {{ day.dayNumber }}
                </span>
              </div>
              <div class="week-grid__events">
                <template v-if="day.events.length > 0">
                  <button
                    v-for="event in day.events"
                    :key="`${event.type}-${event.noticeId}`"
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
                <div v-else class="week-grid__empty">—</div>
              </div>
            </div>
          </div>

          <div v-else class="week-agenda" aria-label="本周议程">
            <div v-for="day in weekGrid" :key="day.dateStr" class="week-agenda__day">
              <div
                class="week-agenda__header"
                :class="{ 'week-agenda__header--today': day.isToday }"
                role="button"
                tabindex="0"
                :aria-label="`选择 ${formatPublishDate(day.dateStr)}`"
                @click="handleDayClick(day.dateStr)"
                @keydown.enter.prevent="handleDayClick(day.dateStr)"
                @keydown.space.prevent="handleDayClick(day.dateStr)"
              >
                <span class="week-agenda__weekday">{{ day.weekdayLabel }}</span>
                <span class="week-agenda__date">{{ formatPublishDate(day.dateStr) }}</span>
                <v-chip
                  v-if="day.events.length > 0"
                  size="x-small"
                  color="primary"
                  variant="tonal"
                >
                  {{ day.events.length }} 项
                </v-chip>
              </div>
              <div v-if="day.events.length > 0" class="week-agenda__events">
                <div
                  v-for="event in day.events"
                  :key="`${event.type}-${event.noticeId}`"
                  class="week-agenda__event"
                  role="button"
                  tabindex="0"
                  :aria-label="eventAriaLabel(event)"
                  @click="goToDetail(event.noticeId)"
                  @keydown.enter.prevent="goToDetail(event.noticeId)"
                  @keydown.space.prevent="goToDetail(event.noticeId)"
                >
                  <v-icon size="14" :color="event.color">
                    {{ event.type === 'deadline' ? '$clockAlert' : '$bullhornOutline' }}
                  </v-icon>
                  <span class="week-agenda__event-title">{{ event.name }}</span>
                  <v-chip
                    size="x-small"
                    :color="event.type === 'deadline' ? 'warning' : 'primary'"
                    variant="tonal"
                  >
                    {{ event.type === 'deadline' ? '截止' : '发布' }}
                  </v-chip>
                </div>
              </div>
              <div v-else class="week-agenda__empty">暂无通知</div>
            </div>
          </div>
        </template>
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
  background: rgba(var(--v-theme-surface-variant), 0.45);
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
  color: rgb(var(--v-theme-on-surface));
  opacity: 1;
  background: transparent;
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
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  padding: 0 4px;
  cursor: pointer;
  font-family: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
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
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  background: rgb(var(--v-theme-surface));
}

.calendar-header__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
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

/* ---- 周视图：桌面 7 列 ---- */
.week-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.week-grid__day {
  min-height: 320px;
  border-right: 1px solid rgb(var(--v-theme-surface-variant));
  border-bottom: 1px solid rgb(var(--v-theme-surface-variant));
  padding: 4px;
  cursor: pointer;
  outline: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.week-grid__day:nth-child(7n) {
  border-right: none;
}

.week-grid__day--selected {
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

.week-grid__day:focus-visible {
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

.week-grid__date {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-bottom: 1px solid rgb(var(--v-theme-surface-variant));
  margin-bottom: 4px;
}

.week-grid__weekday {
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
}

.week-grid__daynum {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  border-radius: 50%;
}

.week-grid__daynum--today {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.week-grid__events {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow: hidden;
}

.week-grid__empty {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  text-align: center;
  padding: 8px 0;
}

/* ---- 周视图：移动端按天分组列表 ---- */
.week-agenda {
  display: block;
}

.week-agenda__day {
  border-bottom: 1px solid rgb(var(--v-theme-surface-variant));
  padding: 8px 12px;
}

.week-agenda__header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
}

.week-agenda__header--today .week-agenda__date {
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
}

.week-agenda__weekday {
  width: 20px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
}

.week-agenda__date {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
}

.week-agenda__events {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.week-agenda__event {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-surface-variant), 0.4);
}

.week-agenda__event-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.week-agenda__empty {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  padding: 6px 8px;
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
