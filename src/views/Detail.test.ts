import { flushPromises, shallowMount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'

const mocks = vi.hoisted(() => ({
  fetchNoticeById: vi.fn(),
  getCachedNotice: vi.fn(),
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
    getCachedNotice: mocks.getCachedNotice,
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

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/detail/:id', component: Detail },
    ],
  })
}

const slotStub = { template: '<div><slot /></div>' }

const componentStubs = {
  VAppBar: true,
  VAppBarTitle: true,
  VBtn: true,
  VIcon: true,
  VSpacer: true,
  VContainer: slotStub,
  VRow: slotStub,
  VCol: slotStub,
  VCard: slotStub,
  VCardTitle: slotStub,
  VCardText: slotStub,
  VCardActions: slotStub,
  VCardSubtitle: slotStub,
  VChip: slotStub,
  VAlert: slotStub,
  VProgressLinear: true,
  VList: slotStub,
  VListItem: slotStub,
  VListItemTitle: slotStub,
  VListItemSubtitle: slotStub,
  VDivider: true,
  ShareDialog: true,
  ImagePreview: true,
  SkeletonLoader: true,
}

describe('Detail request lifecycle', () => {
  const wrappers: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCachedNotice.mockReturnValue(undefined)
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

  it('renders a cached detail immediately and replaces it with the fresh response', async () => {
    const cachedNotice = createNotice('notice-1')
    const freshNotice = createNotice('notice-1')
    freshNotice.aiSummary = '新摘要'
    const pending = createDeferred<NoticeItem>()
    mocks.getCachedNotice.mockReturnValue(cachedNotice)
    mocks.fetchNoticeById.mockReturnValue(pending.promise)

    const router = createTestRouter()
    await router.push('/detail/notice-1')
    const wrapper = shallowMount(Detail, {
      global: { plugins: [router], stubs: componentStubs },
    })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.getCachedNotice).toHaveBeenCalledWith('notice-1')
    expect(wrapper.text()).toContain('摘要')
    expect(wrapper.text()).not.toContain('无法加载通知')

    pending.resolve(freshNotice)
    await flushPromises()

    expect(wrapper.text()).toContain('新摘要')
    expect(mocks.cacheNotice).toHaveBeenCalledWith(freshNotice)
  })

  it('keeps cached detail visible and shows a retry warning when refresh fails', async () => {
    const cachedNotice = createNotice('notice-1')
    mocks.getCachedNotice.mockReturnValue(cachedNotice)
    mocks.fetchNoticeById.mockRejectedValue(new Error('network unavailable'))

    const router = createTestRouter()
    await router.push('/detail/notice-1')
    const wrapper = shallowMount(Detail, {
      global: { plugins: [router], stubs: componentStubs },
    })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('摘要')
    expect(wrapper.text()).toContain('当前显示缓存数据')
    expect(wrapper.text()).not.toContain('通知数据校验失败')
  })

  it('renders the notice title, source, date, and category names', async () => {
    const loadedNotice = createNotice('notice-1')
    loadedNotice.categories = ['exam', 'course_info']
    mocks.fetchNoticeById.mockResolvedValue(loadedNotice)

    const router = createTestRouter()
    await router.push('/detail/notice-1')
    const wrapper = shallowMount(Detail, {
      global: { plugins: [router], stubs: componentStubs },
    })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('Notice notice-1')
    expect(wrapper.text()).toContain('教务处 · 2026-08-01')
    expect(wrapper.text()).toContain('考试安排')
    expect(wrapper.text()).toContain('教学安排')
  })
})
