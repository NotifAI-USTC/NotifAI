import { flushPromises, shallowMount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'

const mocks = vi.hoisted(() => ({
  fetchNoticeById: vi.fn(),
  cacheNotice: vi.fn(),
  markRead: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}))

vi.mock('../utils/request', () => ({
  ApiConfigurationError: class ApiConfigurationError extends Error {},
  fetchNoticeById: mocks.fetchNoticeById,
}))

vi.mock('../stores/userSettings', () => ({
  useUserSettingsStore: () => ({
    cacheNotice: mocks.cacheNotice,
    markRead: mocks.markRead,
  }),
}))

vi.mock('../composables/useSnackbar', () => ({
  useSnackbar: () => ({
    showError: mocks.showError,
    showSuccess: mocks.showSuccess,
  }),
}))

import Detail from './Detail.vue'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

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

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/detail/:id', component: Detail },
    ],
  })
}

const componentStubs = {
  VAppBar: true,
  VAppBarTitle: true,
  VBtn: true,
  VIcon: true,
  VSpacer: true,
  VContainer: true,
  VRow: true,
  VCol: true,
  VCard: true,
  VCardTitle: true,
  VCardText: true,
  VCardActions: true,
  VList: true,
  VListItem: true,
  VListItemTitle: true,
  VListItemSubtitle: true,
  VDivider: true,
  ShareDialog: true,
  ImagePreview: true,
  SkeletonLoader: true,
}

describe('Detail request lifecycle', () => {
  const wrappers: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it('aborts and ignores a pending detail response after unmount', async () => {
    const pending = createDeferred<NoticeItem>()
    let signal: AbortSignal | undefined
    mocks.fetchNoticeById.mockImplementation((_id: string, requestSignal?: AbortSignal) => {
      signal = requestSignal
      return pending.promise
    })
    const router = createTestRouter()
    await router.push('/detail/notice-1')

    const wrapper = shallowMount(Detail, {
      global: { plugins: [router], stubs: componentStubs },
    })
    wrappers.push(wrapper)
    await flushPromises()

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(signal?.aborted).toBe(true)

    pending.resolve(createNotice('notice-1'))
    await flushPromises()

    expect(mocks.cacheNotice).not.toHaveBeenCalled()
    expect(mocks.markRead).not.toHaveBeenCalled()
  })

  it('aborts the previous route request and applies only the latest response', async () => {
    const first = createDeferred<NoticeItem>()
    const second = createDeferred<NoticeItem>()
    const signals = new Map<string, AbortSignal | undefined>()
    mocks.fetchNoticeById.mockImplementation((id: string, signal?: AbortSignal) => {
      signals.set(id, signal)
      return id === 'notice-1' ? first.promise : second.promise
    })
    const router = createTestRouter()
    await router.push('/detail/notice-1')

    const wrapper = shallowMount(Detail, {
      global: { plugins: [router], stubs: componentStubs },
    })
    wrappers.push(wrapper)
    await flushPromises()

    await router.push('/detail/notice-2')
    await flushPromises()

    expect(signals.get('notice-1')?.aborted).toBe(true)
    expect(signals.get('notice-2')?.aborted).toBe(false)

    first.resolve(createNotice('notice-1'))
    await flushPromises()
    expect(mocks.cacheNotice).not.toHaveBeenCalled()
    expect(mocks.markRead).not.toHaveBeenCalled()

    const latestNotice = createNotice('notice-2')
    second.resolve(latestNotice)
    await flushPromises()

    expect(mocks.cacheNotice).toHaveBeenCalledOnce()
    expect(mocks.cacheNotice).toHaveBeenCalledWith(latestNotice)
    expect(mocks.markRead).toHaveBeenCalledOnce()
    expect(mocks.markRead).toHaveBeenCalledWith('notice-2')
  })
})
