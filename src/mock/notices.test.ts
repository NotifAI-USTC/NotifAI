import { describe, expect, it } from 'vitest'
import { DEPARTMENTS } from '../types/notice'
import { calculateRemainingDays } from '../utils/date'
import { parseNoticeItem } from '../utils/validation'
import { mockFetchNotices, mockNotices } from './notices'

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
})
