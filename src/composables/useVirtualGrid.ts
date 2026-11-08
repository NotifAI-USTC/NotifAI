import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { NoticeItem } from '../types/notice'

export const VIRTUAL_GRID_MIN_ITEMS = 60

/** 按列数把通知切成固定顺序的行；不复制通知对象。 */
export function buildNoticeRows(items: readonly NoticeItem[], columns: number): NoticeItem[][] {
  const safeColumns = Math.max(1, Math.floor(columns))
  const rows: NoticeItem[][] = []
  for (let index = 0; index < items.length; index += safeColumns) {
    rows.push(items.slice(index, index + safeColumns))
  }
  return rows
}

export interface UseVirtualGridOptions {
  items: Ref<NoticeItem[]>
  columns: Ref<number>
  scrollElement: Ref<HTMLElement | null>
  container: Ref<HTMLElement | null>
  estimateRowHeight?: number
  overscan?: number
}

/**
 * 首页长列表的行级虚拟化。只渲染视口附近的行，行内仍保留真实
 * `NoticeCard`，因此键盘、点击和已读状态与普通网格一致。
 */
export function useVirtualGrid(options: UseVirtualGridOptions) {
  const rows = computed(() => buildNoticeRows(options.items.value, options.columns.value))
  const scrollMargin = ref(0)

  const virtualizer = useVirtualizer(
    computed(() => ({
      count: rows.value.length,
      getScrollElement: () => options.scrollElement.value,
      estimateSize: () => options.estimateRowHeight ?? 320,
      overscan: options.overscan ?? 3,
      scrollMargin: scrollMargin.value,
      getItemKey: (index: number) =>
        rows.value[index]?.map((notice) => notice.id).join('|') ?? index,
    })),
  )

  const virtualRows = computed(() => virtualizer.value.getVirtualItems())
  const totalSize = computed(() => virtualizer.value.getTotalSize())

  function measureElement(element: unknown): void {
    if (element instanceof HTMLElement) virtualizer.value.measureElement(element)
  }

  /** 计算虚拟列表相对滚动容器顶部的偏移（工具栏、横幅可能动态变化）。 */
  function updateScrollMargin(): void {
    const scroller = options.scrollElement.value
    const container = options.container.value
    if (!scroller || !container) return
    const margin =
      container.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop
    scrollMargin.value = Math.max(0, margin)
  }

  // 列数变化时按“顶部第一个通知”保持阅读位置。
  watch(options.columns, async (nextColumns, previousColumns) => {
    const topRow = virtualizer.value.getVirtualItems()[0]
    const topItemIndex = topRow ? topRow.index * previousColumns : 0
    await nextTick()
    const nextRowIndex = Math.min(
      Math.max(0, Math.floor(topItemIndex / Math.max(1, nextColumns))),
      Math.max(0, rows.value.length - 1),
    )
    virtualizer.value.scrollToIndex(nextRowIndex, { align: 'start' })
    updateScrollMargin()
  })

  watch(
    [options.scrollElement, options.container, () => rows.value.length],
    async () => {
      await nextTick()
      updateScrollMargin()
    },
    { flush: 'post' },
  )

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          updateScrollMargin()
        })

  watch(
    options.scrollElement,
    (element) => {
      resizeObserver?.disconnect()
      if (element) resizeObserver?.observe(element)
      void nextTick(updateScrollMargin)
    },
    { immediate: true, flush: 'post' },
  )

  onScopeDispose(() => resizeObserver?.disconnect())

  return {
    rows,
    virtualizer,
    virtualRows,
    totalSize,
    scrollMargin,
    measureElement,
    updateScrollMargin,
  }
}
