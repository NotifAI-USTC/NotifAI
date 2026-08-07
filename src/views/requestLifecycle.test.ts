import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'

interface MockSettingsStore {
  subscriptionMode: string
  subscribedDepts: string[]
  blacklistKeywords: string[]
  customTags: Record<string, string[]>
  starredIds: string[]
  urgentStarredIds: string[]
  darkMode: string
  readIds: string[]
  isRead: () => boolean
  isStarred: () => boolean
  isPinned: () => boolean
  isImportant: () => boolean
  toggleStar: ReturnType<typeof vi.fn>
  markRead: ReturnType<typeof vi.fn>
  cacheNotices: ReturnType<typeof vi.fn>
  cacheNotice: ReturnType<typeof vi.fn>
  getCachedNotice: ReturnType<typeof vi.fn>
  setNotificationEnabled: ReturnType<typeof vi.fn>
  setDarkMode: ReturnType<typeof vi.fn>
  markCachedNoticesRead: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  fetchNotices: vi.fn(),
  fetchNoticeById: vi.fn(),
  push: vi.fn(),
  cacheNotices: vi.fn(),
  cacheNotice: vi.fn(),
  getCachedNotice: vi.fn(),
  storeState: undefined as MockSettingsStore | undefined,
}))

vi.mock('../utils/request', () => ({
  ApiConfigurationError: class ApiConfigurationError extends Error {},
  fetchNotices: mocks.fetchNotices,
  fetchNoticeById: mocks.fetchNoticeById,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('../stores/userSettings', async () => {
  const { reactive } = await import('vue')
  const storeState = reactive({
    subscriptionMode: 'all',
    subscribedDepts: [] as string[],
    blacklistKeywords: [] as string[],
    customTags: Object.create(null) as Record<string, string[]>,
    starredIds: ['notice-1'],
    urgentStarredIds: ['notice-1'],
    darkMode: 'auto',
    readIds: [] as string[],
    isRead: () => false,
    isStarred: () => false,
    isPinned: () => false,
    isImportant: () => false,
    toggleStar: vi.fn(),
    markRead: vi.fn(),
    cacheNotices: mocks.cacheNotices,
    cacheNotice: mocks.cacheNotice,
    getCachedNotice: mocks.getCachedNotice,
    setNotificationEnabled: vi.fn(),
    setDarkMode: vi.fn(),
    markCachedNoticesRead: vi.fn(),
  })
  mocks.storeState = storeState
  return { useUserSettingsStore: () => storeState }
})

vi.mock('../utils/notification', () => ({
  getNotificationPermission: () => null,
  requestNotificationPermission: vi.fn().mockResolvedValue(null),
  sendNotification: vi.fn(() => null),
}))

import Calendar from './Calendar.vue'
import Home from './Home.vue'
import User from './User.vue'

function pendingPromise<T>(): Promise<T> {
  return new Promise(() => undefined)
}

function makeNotice(overrides: Partial<NoticeItem> = {}): NoticeItem {
  return {
    id: 'notice-1',
    title: '测试通知',
    source: '教务处',
    publishDate: '2026-07-30',
    aiSummary: '测试摘要',
    deadline: '2026-08-10',
    targetAudience: '全体本科生',
    coreAction: '无',
    originUrl: 'https://www.ustc.edu.cn',
    cleanContent: '',
    attachments: [],
    ...overrides,
  }
}

const stubs = {
  AdvancedSearch: true,
  DdlNoticeBar: true,
  FolderDialog: true,
  NoticeCard: true,
  SkeletonLoader: true,
  ShareDialog: true,
  VCalendar: true,
}

describe('view request lifecycle', () => {
  const wrappers: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it.each([
    ['Home', Home, 'list'],
    ['Calendar', Calendar, 'list'],
    ['User', User, 'detail'],
  ] as const)('aborts the pending %s request on unmount', async (_name, component, requestKind) => {
    let signal: AbortSignal | undefined
    if (requestKind === 'list') {
      mocks.fetchNotices.mockImplementation((_params: unknown, requestSignal?: AbortSignal) => {
        signal = requestSignal
        return pendingPromise()
      })
    } else {
      mocks.fetchNoticeById.mockImplementation((_id: string, requestSignal?: AbortSignal) => {
        signal = requestSignal
        return pendingPromise()
      })
    }

    const wrapper = shallowMount(component, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(signal?.aborted).toBe(true)
  })

  it('stops calendar pagination when the reported month exceeds its safety limit', async () => {
    mocks.fetchNotices.mockResolvedValue({ items: [], total: 501 })

    const wrapper = shallowMount(Calendar, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('无法加载当前范围通知')
  })

  it('rejects a short Home page that claims more results remain', async () => {
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 10 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 30,
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('通知加载失败')
  })

  it('continues Home pagination from the next unrequested page', async () => {
    mocks.fetchNotices.mockImplementation(async (params: { page?: number }) => ({
      items: Array.from({ length: 15 }, (_, index) =>
        makeNotice({ id: `notice-${(params.page ?? 1) * 100 + index}` }),
      ),
      total: 45,
    }))

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.get('.notice-grid').trigger('scroll')
    await flushPromises()

    expect(mocks.fetchNotices.mock.calls.map(([params]) => params.page)).toEqual([1, 2])
  })

  it('rejects a final Home page that overlaps an earlier page', async () => {
    mocks.fetchNotices.mockImplementation(async (params: { page?: number }) => ({
      items:
        params.page === 2
          ? Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 15}` }))
          : Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 30,
    }))

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.get('.notice-grid').trigger('scroll')
    await flushPromises()

    expect(mocks.fetchNotices.mock.calls.map(([params]) => params.page)).toEqual([1, 2])
    expect(wrapper.text()).toContain('更多通知加载失败')
  })

  it('rejects a short calendar page that claims more results remain', async () => {
    mocks.fetchNotices.mockResolvedValue({ items: [makeNotice()], total: 500 })

    const wrapper = shallowMount(Calendar, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('无法加载当前范围通知')
  })

  it('refreshes a starred DDL even when a cached deadline is available', async () => {
    const cachedNotice = makeNotice({ title: '缓存中的通知', deadline: '2026-08-10' })
    const refreshedNotice = makeNotice({ title: '刷新后的通知', deadline: '2026-08-20' })
    mocks.getCachedNotice.mockReturnValue(cachedNotice)
    mocks.fetchNoticeById.mockResolvedValue(refreshedNotice)

    const wrapper = shallowMount(User, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNoticeById).toHaveBeenCalledWith('notice-1', expect.any(AbortSignal))
    expect(mocks.cacheNotice).toHaveBeenCalledWith(refreshedNotice)
    expect(wrapper.html()).toContain('刷新后的通知')
  })

  it('falls back to a cached starred DDL and warns when refresh fails', async () => {
    const cachedNotice = makeNotice({ title: '缓存中的通知', deadline: '2026-08-10' })
    mocks.getCachedNotice.mockReturnValue(cachedNotice)
    mocks.fetchNoticeById.mockRejectedValue(new Error('network unavailable'))

    const wrapper = shallowMount(User, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.html()).toContain('缓存中的通知')
    expect(wrapper.text()).toContain('使用缓存数据')
  })

  it('does not reload Home when unrelated store arrays are re-created with identical content', async () => {
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 15,
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(mocks.fetchNotices).toHaveBeenCalledOnce()

    // 模拟 store.applySettings：收藏/置顶/加标签后持久化会重建
    // subscribedDepts / blacklistKeywords 数组引用（内容相同），
    // 修复前这会触发 deep watch 导致 refresh() 重新加载首页。
    const storeState = mocks.storeState!
    storeState.subscribedDepts = [...storeState.subscribedDepts]
    storeState.blacklistKeywords = [...storeState.blacklistKeywords]
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledOnce()
  })

  it('still reloads Home when subscription content actually changes', async () => {
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 15,
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(mocks.fetchNotices).toHaveBeenCalledOnce()

    const storeState = mocks.storeState!
    storeState.subscribedDepts = ['教务处']
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledTimes(2)
  })
})
