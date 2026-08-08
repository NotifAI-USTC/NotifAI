import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'
import { clearNoticeFeedCache, readNoticeFeedCache, writeNoticeFeedCache } from './noticeFeedCache'

function makeNotice(overrides: Partial<NoticeItem> = {}): NoticeItem {
  return {
    id: 'notice-1',
    title: '测试通知',
    source: '教务处',
    publishDate: '2026-08-01',
    aiSummary: '测试摘要',
    deadline: null,
    targetAudience: '全体学生',
    coreAction: '查看通知',
    originUrl: 'https://www.ustc.edu.cn/notices/1',
    cleanContent: '通知正文',
    attachments: [],
    ...overrides,
  }
}

describe('noticeFeedCache', () => {
  afterEach(async () => {
    await clearNoticeFeedCache()
    vi.useRealTimers()
  })

  it('round-trips a validated feed entry through the cache', async () => {
    await writeNoticeFeedCache({
      key: 'home-default',
      items: [makeNotice()],
      total: 1,
      nextPage: 2,
      finished: true,
      scanPaused: false,
      fetchedAt: new Date().toISOString(),
    })

    await expect(readNoticeFeedCache('home-default')).resolves.toMatchObject({
      items: [makeNotice()],
      total: 1,
      nextPage: 2,
      finished: true,
      stale: false,
    })
  })

  it('rejects malformed cached notices instead of returning them', async () => {
    await writeNoticeFeedCache({
      key: 'invalid',
      items: [makeNotice({ originUrl: 'javascript:alert(1)' })],
      total: 1,
      nextPage: 2,
      finished: true,
      scanPaused: false,
      fetchedAt: new Date().toISOString(),
    })

    await expect(readNoticeFeedCache('invalid')).resolves.toBeNull()
  })

  it('marks old entries as stale while keeping them available for offline fallback', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-08T08:00:00.000Z'))
    await writeNoticeFeedCache({
      key: 'old',
      items: [makeNotice()],
      total: 1,
      nextPage: 2,
      finished: true,
      scanPaused: false,
      fetchedAt: '2026-06-01T08:00:00.000Z',
    })

    await expect(readNoticeFeedCache('old')).resolves.toMatchObject({ stale: true })
  })
})
