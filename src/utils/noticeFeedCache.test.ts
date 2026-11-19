import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'
import {
  clearNoticeDetailCache,
  clearNoticeFeedCache,
  readNoticeDetailCache,
  readNoticeFeedCache,
  writeNoticeDetailCache,
  writeNoticeFeedCache,
} from './noticeFeedCache'

function makeNotice(overrides: Partial<NoticeItem> = {}): NoticeItem {
  return {
    id: 'notice-1',
    title: '测试通知',
    source: '教务处',
    contentType: null,
    categories: [],
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
    await clearNoticeDetailCache()
    vi.useRealTimers()
  })

  it('round-trips a validated feed entry through the cache', async () => {
    await writeNoticeFeedCache({
      key: 'home-default',
      items: [makeNotice({ contentType: 'public_notice' })],
      total: 1,
      nextPage: 2,
      finished: true,
      scanPaused: false,
      fetchedAt: new Date().toISOString(),
    })

    await expect(readNoticeFeedCache('home-default')).resolves.toMatchObject({
      items: [makeNotice({ contentType: 'public_notice' })],
      total: 1,
      nextPage: 2,
      finished: true,
      stale: false,
    })
  })

  it('clears unsafe cached origin URLs instead of dropping the entry', async () => {
    await writeNoticeFeedCache({
      key: 'unsafe-origin',
      items: [makeNotice({ originUrl: 'javascript:alert(1)' })],
      total: 1,
      nextPage: 2,
      finished: true,
      scanPaused: false,
      fetchedAt: new Date().toISOString(),
    })

    const entry = await readNoticeFeedCache('unsafe-origin')
    expect(entry?.items[0]?.originUrl).toBe('')
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

  it('persists complete notice details independently from the feed cache', async () => {
    const notice = makeNotice({ cleanContent: '# 完整正文\n\n详情内容', contentType: 'other' })
    await writeNoticeDetailCache(notice)

    await expect(readNoticeDetailCache(notice.id)).resolves.toMatchObject({
      id: notice.id,
      notice,
      stale: false,
    })
  })

  it('clears an unsafe origin URL in detail cache writes', async () => {
    await writeNoticeDetailCache(makeNotice({ originUrl: 'javascript:alert(1)' }))

    const entry = await readNoticeDetailCache('notice-1')
    expect(entry?.notice.originUrl).toBe('')
  })
})
