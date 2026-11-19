import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'

const mocks = vi.hoisted(() => ({
  fetchNoticesByIds: vi.fn(),
  cacheNotice: vi.fn(),
  getCachedNotice: vi.fn(),
  writeNoticeDetailCache: vi.fn(),
}))

vi.mock('../utils/noticeFeedCache', () => ({
  writeNoticeDetailCache: mocks.writeNoticeDetailCache,
}))

vi.mock('../utils/request', () => ({
  fetchNoticesByIds: mocks.fetchNoticesByIds,
}))

vi.mock('../stores/userSettings', () => ({
  useUserSettingsStore: () => ({
    cacheNotice: mocks.cacheNotice,
    getCachedNotice: mocks.getCachedNotice,
  }),
}))

import { loadBatchNotices } from './useBatchNoticeLoader'

function makeNotice(id: string, deadline: string | null = null): NoticeItem {
  return {
    id,
    title: id,
    source: '教务处',
    contentType: null,
    categories: [],
    publishDate: '2026-08-01',
    aiSummary: '',
    deadline,
    targetAudience: '全体学生',
    coreAction: '',
    originUrl: 'https://www.ustc.edu.cn',
    cleanContent: '',
    attachments: [],
  }
}

describe('loadBatchNotices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCachedNotice.mockReturnValue(undefined)
  })

  it('deduplicates IDs, chunks requests, and falls back for missing details', async () => {
    const cached = makeNotice('notice-2', '2026-08-20')
    mocks.fetchNoticesByIds
      .mockResolvedValueOnce({ items: [makeNotice('notice-3')], missing: [] })
      .mockResolvedValueOnce({ items: [makeNotice('notice-4')], missing: [] })
    mocks.getCachedNotice.mockImplementation((id: string) =>
      id === 'notice-2' ? cached : undefined,
    )

    const result = await loadBatchNotices(
      ['notice-1', 'notice-2', 'notice-3', 'notice-3', 'notice-4'],
      { maxIds: 3, batchSize: 2 },
    )

    expect(mocks.fetchNoticesByIds.mock.calls.map(([ids]) => ids)).toEqual([
      ['notice-2', 'notice-3'],
      ['notice-4'],
    ])
    expect(result.items.map((notice) => notice.id)).toEqual(['notice-3', 'notice-2', 'notice-4'])
    expect(result.omittedCount).toBe(1)
    expect(result.staleFallbackCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(mocks.cacheNotice).toHaveBeenCalledWith(expect.objectContaining({ id: 'notice-3' }))
  })

  it('requests light fields and keeps a cached body out of the response', async () => {
    const cached = makeNotice('notice-1')
    cached.cleanContent = '# 完整正文'
    cached.attachments = [{ name: '附件.pdf', url: 'https://www.ustc.edu.cn/a.pdf' }]
    mocks.getCachedNotice.mockReturnValue(cached)
    mocks.fetchNoticesByIds.mockResolvedValue({
      items: [makeNotice('notice-1')],
      missing: [],
    })

    const result = await loadBatchNotices(['notice-1'])

    expect(mocks.fetchNoticesByIds).toHaveBeenCalledWith(['notice-1'], undefined, {
      light: true,
    })
    expect(result.items[0]?.cleanContent).toBe('# 完整正文')
    expect(result.items[0]?.attachments).toEqual(cached.attachments)
    expect(mocks.cacheNotice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notice-1', cleanContent: '# 完整正文' }),
    )
    expect(mocks.writeNoticeDetailCache).not.toHaveBeenCalled()
  })

  it('persists full responses for offline detail fallback', async () => {
    mocks.fetchNoticesByIds.mockResolvedValue({
      items: [makeNotice('notice-1')],
      missing: [],
    })

    await loadBatchNotices(['notice-1'], { light: false })

    expect(mocks.fetchNoticesByIds).toHaveBeenCalledWith(['notice-1'], undefined, {
      light: false,
    })
    expect(mocks.writeNoticeDetailCache).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notice-1' }),
    )
  })

  it('keeps cached details when a whole batch request fails', async () => {
    mocks.fetchNoticesByIds.mockRejectedValue(new Error('network unavailable'))
    mocks.getCachedNotice.mockImplementation((id: string) => makeNotice(id, '2026-08-10'))

    const result = await loadBatchNotices(['notice-1', 'notice-2'])

    expect(result.items.map((notice) => notice.id)).toEqual(['notice-1', 'notice-2'])
    expect(result.staleFallbackCount).toBe(2)
    expect(result.failedCount).toBe(0)
  })

  it('stops with AbortError when the request is cancelled', async () => {
    const controller = new AbortController()
    mocks.fetchNoticesByIds.mockImplementation(async () => {
      controller.abort()
      throw new DOMException('请求已取消', 'AbortError')
    })

    await expect(
      loadBatchNotices(['notice-1'], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
