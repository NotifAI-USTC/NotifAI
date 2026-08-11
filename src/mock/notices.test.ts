import { describe, expect, it } from 'vitest'
import { DEPARTMENTS } from '../types/notice'
import { calculateRemainingDays, getIsoWeek, getLocalToday } from '../utils/date'
import { parseNoticeItem } from '../utils/validation'
import {
  mockFetchCalendarNotices,
  mockFetchCategories,
  mockFetchDeadlineNotices,
  mockFetchNotices,
  mockFetchNoticesByIds,
  mockFetchSources,
  mockFetchStats,
  mockNotices,
} from './notices'

describe('mock notice API', () => {
  it('provides valid, unique notices from every subscribable department', () => {
    expect(mockNotices).toHaveLength(38)
    expect(new Set(mockNotices.map((notice) => notice.id)).size).toBe(mockNotices.length)

    for (const notice of mockNotices) {
      expect(() => parseNoticeItem(notice)).not.toThrow()
    }

    expect(new Set(mockNotices.map((notice) => notice.source))).toEqual(
      new Set(DEPARTMENTS.map((department) => department.name)),
    )
  })

  it('covers deadline, summary, and attachment display states', () => {
    const remainingDays = mockNotices.map((notice) => calculateRemainingDays(notice.deadline))
    const attachmentCounts = mockNotices.map((notice) => notice.attachments.length)

    expect(remainingDays).toContain(null)
    expect(remainingDays.some((days) => days !== null && days < 0)).toBe(true)
    expect(remainingDays).toContain(0)
    expect(remainingDays).toContain(1)
    expect(remainingDays).toContain(3)
    expect(remainingDays).toContain(4)
    expect(remainingDays.some((days) => days !== null && days >= 30)).toBe(true)
    expect(mockNotices.some((notice) => notice.deadline === notice.publishDate)).toBe(true)
    expect(mockNotices.some((notice) => notice.aiSummary === '')).toBe(true)
    expect(attachmentCounts).toContain(0)
    expect(attachmentCounts).toContain(1)
    expect(attachmentCounts.some((count) => count >= 2)).toBe(true)
  })

  it('returns three stable, newest-first pages at the home page size', () => {
    const pages = [1, 2, 3].map((page) => mockFetchNotices({ page, pageSize: 15 }))
    const items = pages.flatMap((page) => page.items)

    expect(pages.map((page) => page.items.length)).toEqual([15, 15, 8])
    expect(pages.every((page) => page.total === mockNotices.length)).toBe(true)
    expect(new Set(items.map((notice) => notice.id)).size).toBe(mockNotices.length)
    expect(items.map((notice) => notice.id)).toEqual(
      [...items]
        .sort((a, b) => b.publishDate.localeCompare(a.publishDate) || a.id.localeCompare(b.id))
        .map((notice) => notice.id),
    )
  })

  it('applies source, keyword, deadline, and pagination filters before counting', () => {
    const response = mockFetchNotices({
      source: '教务处',
      keyword: '选课',
      hasDeadline: true,
      page: 1,
      pageSize: 1,
    })

    expect(response.total).toBeGreaterThan(0)
    expect(response.items).toHaveLength(1)
    expect(response.items[0]?.source).toBe('教务处')
    expect(response.items[0]?.deadline).not.toBeNull()
    expect(`${response.items[0]?.title} ${response.items[0]?.aiSummary}`).toContain('选课')
  })

  it('matches either publish date or deadline for calendar ranges', () => {
    const target = mockNotices.find(
      (notice) => notice.deadline && notice.deadline !== notice.publishDate,
    )
    expect(target?.deadline).toBeTruthy()

    const response = mockFetchNotices({
      rangeFrom: target?.deadline ?? undefined,
      rangeTo: target?.deadline ?? undefined,
      page: 1,
      pageSize: 1_000,
    })

    expect(response.items.some((notice) => notice.id === target?.id)).toBe(true)
  })

  it('combines source lists and publication date bounds', () => {
    const target = mockNotices[0]
    const response = mockFetchNotices({
      sources: [target.source],
      dateFrom: target.publishDate,
      dateTo: target.publishDate,
      pageSize: 1_000,
    })

    expect(response.items.length).toBeGreaterThan(0)
    expect(response.items.every((notice) => notice.source === target.source)).toBe(true)
    expect(response.items.every((notice) => notice.publishDate === target.publishDate)).toBe(true)
  })

  it('filters by multiple categories with OR semantics', () => {
    const response = mockFetchNotices({
      categories: ['exam', 'graduation'],
      pageSize: 1_000,
    })

    expect(response.items.length).toBeGreaterThan(0)
    expect(
      response.items.every((notice) =>
        notice.categories.some((category) => ['exam', 'graduation'].includes(category)),
      ),
    ).toBe(true)
  })
})

describe('mock new endpoints', () => {
  it('batch returns matching items (newest first) and reports missing ids', () => {
    const ids = mockNotices.slice(0, 5).map((notice) => notice.id)
    const result = mockFetchNoticesByIds([...ids, 'does-not-exist'])

    expect(result.items.map((notice) => notice.id)).toEqual(
      [...ids].sort(
        (a, b) =>
          mockNotices
            .find((n) => n.id === b)!
            .publishDate.localeCompare(mockNotices.find((n) => n.id === a)!.publishDate) ||
          a.localeCompare(b),
      ),
    )
    expect(result.missing).toEqual(['does-not-exist'])
    // 自动去重
    const dedup = mockFetchNoticesByIds([ids[0], ids[0]])
    expect(dedup.items).toHaveLength(1)
  })

  it('calendar month returns only items touching that month', () => {
    const month = getLocalToday().slice(0, 7)
    const result = mockFetchCalendarNotices({ month })

    for (const item of result.items) {
      const touches = item.publishDate.slice(0, 7) === month || item.deadline?.slice(0, 7) === month
      expect(touches).toBe(true)
    }
    // 与范围查询结果一致
    const rangeResult = mockFetchNotices({
      rangeFrom: `${month}-01`,
      rangeTo: `${month}-31`,
      pageSize: 1000,
    })
    expect(new Set(result.items.map((item) => item.id))).toEqual(
      new Set(rangeResult.items.map((item) => item.id)),
    )
  })

  it('calendar week returns items touching that ISO week', () => {
    const week = getIsoWeek(getLocalToday())!
    const result = mockFetchCalendarNotices({ week })
    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(
        getIsoWeek(item.publishDate) === week || getIsoWeek(item.deadline ?? '') === week,
      ).toBe(true)
    }
  })

  it('deadlines applies its date window, source filter, ordering, and pagination', () => {
    const all = mockFetchDeadlineNotices({ days: 7, pageSize: 500 })
    const source = all.items[0]?.source
    expect(all.items.length).toBeGreaterThan(0)
    expect(all.items.map((item) => item.id)).toEqual(
      [...all.items]
        .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.id.localeCompare(b.id))
        .map((item) => item.id),
    )

    const filtered = mockFetchDeadlineNotices({ days: 7, sources: source ? [source] : [] })
    expect(filtered.items.every((item) => item.source === source)).toBe(true)

    const firstPage = mockFetchDeadlineNotices({ days: 7, page: 1, pageSize: 1 })
    const secondPage = mockFetchDeadlineNotices({ days: 7, page: 2, pageSize: 1 })
    expect(firstPage.total).toBe(all.total)
    expect(firstPage.items).toHaveLength(1)
    expect(secondPage.items[0]?.id).toBe(all.items[1]?.id)
  })

  it('sources covers every department with a positive count', () => {
    const sources = mockFetchSources()
    expect(new Set(sources.map((source) => source.name))).toEqual(
      new Set(mockNotices.map((notice) => notice.source)),
    )
    expect(sources.every((source) => source.noticeCount > 0)).toBe(true)
  })

  it('categories returns all predefined categories with matching counts', () => {
    const categories = mockFetchCategories()
    expect(categories).toHaveLength(17)
    for (const category of categories) {
      expect(category.noticeCount).toBe(
        mockNotices.filter((notice) => notice.categories.includes(category.key)).length,
      )
    }
  })

  it('stats match the mock dataset', () => {
    const stats = mockFetchStats()
    expect(stats.total).toBe(mockNotices.length)
    expect(stats.sourceCount).toBe(new Set(mockNotices.map((notice) => notice.source)).size)
    expect(typeof stats.lastCrawlAt).toBe('string')
  })
})
