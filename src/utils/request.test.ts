import axios from 'axios'
import type { AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTICE_CATEGORY_DEFINITIONS } from '../types/notice'
import type { NoticeItem } from '../types/notice'

const snackbar = vi.hoisted(() => ({
  showError: vi.fn(),
}))

vi.mock('../composables/useSnackbar', () => ({
  useSnackbar: () => snackbar,
}))

import request, {
  fetchCalendarNotices,
  fetchCategories,
  fetchDeadlineNotices,
  fetchNoticeById,
  fetchNotices,
  fetchNoticesByIds,
  fetchSources,
  fetchStats,
} from './request'

function createNotice(id: string): NoticeItem {
  return {
    id,
    title: `Notice ${id}`,
    source: '教务处',
    categories: [],

    publishDate: '2026-08-01',
    aiSummary: '摘要',
    deadline: null,
    targetAudience: '全体学生',
    coreAction: '查看通知',
    originUrl: 'https://www.ustc.edu.cn/notices/1',
    cleanContent: '<p>Notice content</p>',
    attachments: [],
  }
}

describe('request cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not show the global error snackbar for canceled Axios requests', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      request.get('/canceled', {
        adapter: async () => {
          throw new axios.CanceledError('canceled')
        },
      }),
    ).rejects.toMatchObject({ code: 'ERR_CANCELED' })

    expect(snackbar.showError).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('continues to report genuine network failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      request.get('/failed', {
        adapter: async () => {
          throw new axios.AxiosError('offline', 'ERR_NETWORK')
        },
      }),
    ).rejects.toMatchObject({ code: 'ERR_NETWORK' })

    expect(snackbar.showError).toHaveBeenCalledOnce()
    expect(snackbar.showError).toHaveBeenCalledWith('无法连接通知服务，请检查网络')
  })

  it('lets callers with inline error UI suppress the global snackbar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      request.get('/failed', {
        suppressGlobalError: true,
        adapter: async (config) => {
          throw new axios.AxiosError('offline', 'ERR_NETWORK', config)
        },
      }),
    ).rejects.toMatchObject({ code: 'ERR_NETWORK' })

    expect(snackbar.showError).not.toHaveBeenCalled()
  })

  it('passes AbortSignal through both notice request APIs', async () => {
    const notice = createNotice('notice-1')
    const get = vi
      .spyOn(request, 'get')
      .mockResolvedValueOnce({ data: { items: [notice], total: 1 } } as AxiosResponse<unknown>)
      .mockResolvedValueOnce({ data: notice } as AxiosResponse<unknown>)
    const controller = new AbortController()

    await fetchNotices({ page: 1, pageSize: 15 }, controller.signal)
    await fetchNoticeById('notice-1', controller.signal)

    expect(get).toHaveBeenNthCalledWith(
      1,
      '/notices',
      expect.objectContaining({
        maxContentLength: 16 * 1024 * 1024,
        signal: controller.signal,
      }),
    )
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/notices/notice-1',
      expect.objectContaining({
        maxContentLength: 8 * 1024 * 1024,
        signal: controller.signal,
        suppressGlobalError: true,
      }),
    )
  })

  it('aborts a streamed Fetch response before it exceeds maxContentLength', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ payload: 'x'.repeat(128) }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )

    await expect(
      request.get('/oversized', {
        maxContentLength: 32,
        suppressGlobalError: true,
      }),
    ).rejects.toMatchObject({ code: 'ERR_BAD_RESPONSE' })
    expect(snackbar.showError).not.toHaveBeenCalled()
  })
})

describe('new API endpoints', () => {
  it('fetches notices in batch via POST /notices/batch', async () => {
    const notice = createNotice('notice-1')
    const post = vi.spyOn(request, 'post').mockResolvedValueOnce({
      data: { items: [notice], missing: ['missing-1'] },
    } as AxiosResponse<unknown>)

    const result = await fetchNoticesByIds(['notice-1', 'missing-1'])

    expect(post).toHaveBeenCalledWith(
      '/notices/batch',
      { ids: ['notice-1', 'missing-1'] },
      expect.objectContaining({ suppressGlobalError: true }),
    )
    expect(result.items).toEqual([{ ...notice, firstSeen: null, lastCrawl: null }])
    expect(result.missing).toEqual(['missing-1'])
  })

  it('deduplicates and validates batch ids', async () => {
    const post = vi.spyOn(request, 'post').mockResolvedValueOnce({
      data: { items: [], missing: [] },
    } as AxiosResponse<unknown>)
    await fetchNoticesByIds(['a', 'a', 'b'])
    expect(post).toHaveBeenCalledWith('/notices/batch', { ids: ['a', 'b'] }, expect.anything())

    await expect(fetchNoticesByIds([])).rejects.toThrow(/ids/)
    await expect(fetchNoticesByIds(['bad id!'])).rejects.toThrow(/格式无效/)
    await expect(
      fetchNoticesByIds(Array.from({ length: 501 }, (_, index) => `n-${index}`)),
    ).rejects.toThrow(/ids/)
  })

  it('fetches calendar items by month and week', async () => {
    const get = vi.spyOn(request, 'get').mockResolvedValue({
      data: {
        items: [
          {
            id: 'notice-1',
            title: '标题',
            source: '教务处',
            publishDate: '2026-08-01',
            deadline: null,
          },
        ],
      },
    } as AxiosResponse<unknown>)

    const items = await fetchCalendarNotices({ month: '2026-08' })
    expect(get).toHaveBeenCalledWith(
      '/notices/calendar',
      expect.objectContaining({ params: { month: '2026-08' } }),
    )
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('notice-1')

    await fetchCalendarNotices({ week: '2026-W32' })
    expect(get).toHaveBeenLastCalledWith(
      '/notices/calendar',
      expect.objectContaining({ params: { week: '2026-W32' } }),
    )
  })

  it('requires exactly one of month or week with valid formats', async () => {
    vi.spyOn(request, 'get').mockResolvedValue({ data: { items: [] } } as AxiosResponse<unknown>)

    await expect(fetchCalendarNotices({})).rejects.toThrow(/二选一/)
    await expect(fetchCalendarNotices({ month: '2026-08', week: '2026-W32' })).rejects.toThrow(
      /二选一/,
    )
    await expect(fetchCalendarNotices({ month: '2026/08' })).rejects.toThrow(/YYYY-MM/)
    await expect(fetchCalendarNotices({ week: '2026-08' })).rejects.toThrow(/YYYY-W/)
  })

  it('fetches upcoming deadlines with repeated source parameters', async () => {
    const get = vi.spyOn(request, 'get').mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'notice-1',
            title: '标题',
            source: '教务处',
            publishDate: '2026-08-01',
            deadline: '2026-08-12',
            aiSummary: '摘要',
            targetAudience: '全体学生',
          },
        ],
        total: 1,
      },
    } as AxiosResponse<unknown>)

    const result = await fetchDeadlineNotices({
      days: 14,
      sources: ['教务处', '研究生院'],
      page: 1,
      pageSize: 50,
    })

    expect(result.items[0]?.deadline).toBe('2026-08-12')
    expect(get).toHaveBeenCalledWith(
      '/notices/deadlines',
      expect.objectContaining({
        params: {
          days: 14,
          sources: ['教务处', '研究生院'],
          page: 1,
          pageSize: 50,
        },
        paramsSerializer: { indexes: false },
      }),
    )
    const requestConfig = get.mock.calls[0]?.[1]
    expect(
      request.getUri({
        url: '/notices/deadlines',
        params: requestConfig?.params,
        paramsSerializer: requestConfig?.paramsSerializer,
      }),
    ).toContain('sources%5B%5D=%E6%95%99%E5%8A%A1%E5%A4%84')
  })

  it('validates deadline query limits and payloads', async () => {
    await expect(fetchDeadlineNotices({ days: 0 })).rejects.toThrow(/days/)
    await expect(fetchDeadlineNotices({ days: 366 })).rejects.toThrow(/days/)
    await expect(fetchDeadlineNotices({ page: 0 })).rejects.toThrow(/page/)
    await expect(fetchDeadlineNotices({ pageSize: 501 })).rejects.toThrow(/pageSize/)
    await expect(fetchDeadlineNotices({ sources: [] })).rejects.toThrow(/sources/)
    await expect(fetchDeadlineNotices({ sources: [''] })).rejects.toThrow(/sources/)

    vi.spyOn(request, 'get').mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'notice-1',
            title: '标题',
            source: '教务处',
            publishDate: '2026-08-01',
            deadline: null,
            aiSummary: '',
            targetAudience: '',
          },
        ],
        total: 1,
      },
    } as AxiosResponse<unknown>)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await fetchDeadlineNotices()
    expect(result.items).toEqual([])
    expect(consoleWarn).toHaveBeenCalledOnce()
  })

  it('fetches sources, categories, and stats', async () => {
    const get = vi
      .spyOn(request, 'get')
      .mockResolvedValueOnce({
        data: [{ name: '教务处', group: '校级部门', noticeCount: 10 }],
      } as AxiosResponse<unknown>)
      .mockResolvedValueOnce({
        data: NOTICE_CATEGORY_DEFINITIONS.map((category) => ({
          ...category,
          noticeCount: category.key === 'exam' ? 17 : 0,
        })),
      } as AxiosResponse<unknown>)
      .mockResolvedValueOnce({
        data: {
          total: 73,
          sourceCount: 12,
          last7DaysDdl: 5,
          last24hNew: 2,
          lastCrawlAt: '2026-08-07T08:00:00Z',
        },
      } as AxiosResponse<unknown>)

    const sources = await fetchSources()
    expect(sources).toEqual([{ name: '教务处', group: '校级部门', noticeCount: 10 }])
    expect(get).toHaveBeenCalledWith('/sources', expect.anything())

    const categories = await fetchCategories()
    expect(categories).toHaveLength(17)
    expect(categories.find((category) => category.key === 'exam')?.noticeCount).toBe(17)
    expect(get).toHaveBeenCalledWith('/categories', expect.anything())

    const stats = await fetchStats()
    expect(stats.total).toBe(73)
    expect(stats.sourceCount).toBe(12)
    expect(stats.lastCrawlAt).toBe('2026-08-07T08:00:00Z')
    expect(get).toHaveBeenCalledWith('/stats', expect.anything())
  })

  it('forwards and validates the since parameter', async () => {
    const get = vi.spyOn(request, 'get').mockResolvedValueOnce({
      data: { items: [], total: 0 },
    } as AxiosResponse<unknown>)

    await fetchNotices({ since: '2026-08-07T08:00:00+08:00', pageSize: 1 })
    expect(get).toHaveBeenCalledWith(
      '/notices',
      expect.objectContaining({
        params: expect.objectContaining({
          since: '2026-08-07T08:00:00+08:00',
          pageSize: 1,
        }),
      }),
    )

    await expect(fetchNotices({ since: 'not-a-date' })).rejects.toThrow(/ISO8601/)
  })

  it('forwards category filters using repeated bracket parameters', async () => {
    const get = vi.spyOn(request, 'get').mockResolvedValueOnce({
      data: { items: [], total: 0 },
    } as AxiosResponse<unknown>)

    await fetchNotices({ categories: ['exam', 'graduation'], pageSize: 20 })

    expect(get).toHaveBeenCalledWith(
      '/notices',
      expect.objectContaining({
        params: expect.objectContaining({ categories: ['exam', 'graduation'] }),
        paramsSerializer: { indexes: false },
      }),
    )
    const requestConfig = get.mock.calls[0]?.[1]
    expect(
      request.getUri({
        url: '/notices',
        params: requestConfig?.params,
        paramsSerializer: requestConfig?.paramsSerializer,
      }),
    ).toContain('categories%5B%5D=exam&categories%5B%5D=graduation')
    await expect(fetchNotices({ categories: ['not-a-category'] as never[] })).rejects.toThrow(
      /分类 key/,
    )
  })

  it('rejects malformed category metadata and notice category payloads', async () => {
    vi.spyOn(request, 'get')
      .mockResolvedValueOnce({
        data: NOTICE_CATEGORY_DEFINITIONS.map((category, index) => ({
          ...category,
          key: index === 0 ? 'invalid' : category.key,
          noticeCount: 0,
        })),
      } as AxiosResponse<unknown>)
      .mockResolvedValueOnce({
        data: { ...createNotice('notice-1'), categories: ['exam', 'exam'] },
      } as AxiosResponse<unknown>)

    await expect(fetchCategories()).rejects.toThrow(/分类 key/)
    await expect(fetchNoticeById('notice-1')).rejects.toThrow(/重复分类/)
  })
})
