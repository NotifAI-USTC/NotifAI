import { createApp, h, nextTick, ref } from 'vue'
import type { App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'
import { buildNoticeRows, useVirtualGrid, VIRTUAL_GRID_MIN_ITEMS } from './useVirtualGrid'

function makeNotice(index: number): NoticeItem {
  return {
    id: `notice-${index}`,
    title: `通知 ${index}`,
    source: '教务处',
    categories: [],
    contentType: null,
    publishDate: '2026-11-01',
    aiSummary: '摘要',
    deadline: null,
    targetAudience: '全体学生',
    coreAction: '查看',
    originUrl: '',
    cleanContent: '',
    attachments: [],
  }
}

describe('buildNoticeRows', () => {
  it.each([1, 2, 3, 4])('keeps server order when grouping %i column(s)', (columns) => {
    const items = Array.from({ length: VIRTUAL_GRID_MIN_ITEMS + 1 }, (_, index) =>
      makeNotice(index),
    )
    const rows = buildNoticeRows(items, columns)

    expect(rows).toHaveLength(Math.ceil(items.length / columns))
    expect(rows.flat().map((notice) => notice.id)).toEqual(items.map((notice) => notice.id))
    expect(rows.at(-1)).toHaveLength(1)
    for (const row of rows.slice(0, -1)) expect(row).toHaveLength(columns)
  })

  it('returns no rows for an empty list and preserves the remainder row', () => {
    expect(buildNoticeRows([], 3)).toEqual([])
    const rows = buildNoticeRows([makeNotice(1), makeNotice(2), makeNotice(3), makeNotice(4)], 3)
    expect(rows.map((row) => row.length)).toEqual([3, 1])
  })
})

describe('useVirtualGrid', () => {
  let app: App | null = null

  afterEach(() => {
    app?.unmount()
    app = null
    vi.restoreAllMocks()
  })

  it('renders only the visible row range for 300 notices', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = this.classList.contains('virtual-container') ? 120 : 0
      const height = this.classList.contains('virtual-scroller') ? 600 : 320
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + height,
        right: 1200,
        width: 1200,
        height,
        toJSON: () => ({}),
      } as DOMRect
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('virtual-scroller') ? 600 : 320
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 1200
      },
    })

    const items = ref(Array.from({ length: 300 }, (_, index) => makeNotice(index)))
    const columns = ref(4)
    const scrollElement = ref<HTMLElement | null>(null)
    const container = ref<HTMLElement | null>(null)
    let renderedRows = 0

    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({
      setup() {
        const grid = useVirtualGrid({
          items,
          columns,
          scrollElement,
          container,
          estimateRowHeight: 320,
        })
        return () =>
          h('div', { ref: scrollElement, class: 'virtual-scroller' }, [
            h(
              'div',
              {
                ref: container,
                class: 'virtual-container',
                style: { height: `${grid.totalSize.value}px` },
              },
              grid.virtualRows.value.map((row) => {
                renderedRows += 1
                return h(
                  'div',
                  {
                    key: String(row.key),
                    class: 'virtual-row',
                    'data-index': row.index,
                  },
                  grid.rows.value[row.index]?.map((notice) => h('span', notice.id)),
                )
              }),
            ),
          ])
      },
    })
    app.mount(root)
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await nextTick()

    expect(renderedRows).toBeGreaterThan(0)
    expect(renderedRows).toBeLessThan(75)
    expect(root.querySelectorAll('.virtual-row').length).toBe(renderedRows)
    expect(root.querySelector('.virtual-row span')?.textContent).toBe('notice-0')
  })
})
