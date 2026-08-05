import axios from 'axios'
import type { AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'

const snackbar = vi.hoisted(() => ({
  showError: vi.fn(),
}))

vi.mock('../composables/useSnackbar', () => ({
  useSnackbar: () => snackbar,
}))

import request, { fetchNoticeById, fetchNotices } from './request'

function createNotice(id: string): NoticeItem {
  return {
    id,
    title: `Notice ${id}`,
    source: '教务处',

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
