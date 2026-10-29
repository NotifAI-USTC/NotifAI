import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarItem, DeadlineItem, NoticeItem } from '../types/notice'

interface MockSettingsStore {
  subscriptionMode: string
  subscribedDepts: string[]
  categoryMode: string
  subscribedCategories: string[]
  blacklistKeywords: string[]
  customTags: Record<string, string[]>
  starredIds: string[]
  importantIds: string[]
  pinnedIds: string[]
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
  fetchNoticesByIds: vi.fn(),
  fetchCalendarNotices: vi.fn(),
  fetchDeadlineNotices: vi.fn(),
  fetchStats: vi.fn(),
  readNoticeFeedCache: vi.fn(),
  writeNoticeFeedCache: vi.fn(),
  writeNoticeDetailCache: vi.fn(),
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
  fetchNoticesByIds: mocks.fetchNoticesByIds,
  fetchCalendarNotices: mocks.fetchCalendarNotices,
  fetchDeadlineNotices: mocks.fetchDeadlineNotices,
  fetchStats: mocks.fetchStats,
}))

vi.mock('../utils/noticeFeedCache', () => ({
  readNoticeFeedCache: mocks.readNoticeFeedCache,
  writeNoticeFeedCache: mocks.writeNoticeFeedCache,
  writeNoticeDetailCache: mocks.writeNoticeDetailCache,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('../stores/userSettings', async () => {
  const { reactive } = await import('vue')
  const storeState = reactive({
    subscriptionMode: 'all',
    subscribedDepts: [] as string[],
    categoryMode: 'all',
    subscribedCategories: [] as string[],
    blacklistKeywords: [] as string[],
    customTags: Object.create(null) as Record<string, string[]>,
    starredIds: ['notice-1'],
    importantIds: ['notice-1'],
    pinnedIds: [] as string[],
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
    contentType: null,
    categories: [],
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

function makeCalendarItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'notice-1',
    title: '测试通知',
    source: '教务处',
    contentType: null,
    publishDate: '2026-07-30',
    deadline: '2026-08-10',
    ...overrides,
  }
}

function makeDeadlineItem(overrides: Partial<DeadlineItem> = {}): DeadlineItem {
  return {
    id: 'notice-1',
    title: '测试通知',
    source: '教务处',
    contentType: null,
    publishDate: '2026-07-30',
    deadline: '2026-08-10',
    aiSummary: '测试摘要',
    targetAudience: '全体本科生',
    ...overrides,
  }
}

const stubs = {
  AppBanner: {
    name: 'AppBanner',
    template: '<div v-bind="$attrs"><slot /><slot name="prepend" /><slot name="append" /></div>',
  },
  AdvancedSearch: true,
  DdlNoticeBar: {
    props: ['notices'],
    template: '<div class="ddl-bar-stub">{{ notices.length }}</div>',
  },
  FolderDialog: true,
  NoticeCard: {
    props: ['notice'],
    template: '<div class="notice-card-stub">{{ notice.title }}</div>',
  },
  SkeletonLoader: true,
  ShareDialog: true,
  VCalendar: true,
}

describe('view request lifecycle', () => {
  const wrappers: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readNoticeFeedCache.mockResolvedValue(null)
    mocks.fetchDeadlineNotices.mockResolvedValue({ items: [], total: 0 })
    const storeState = mocks.storeState!
    storeState.subscriptionMode = 'all'
    storeState.subscribedDepts = []
    storeState.categoryMode = 'all'
    storeState.subscribedCategories = []
    storeState.blacklistKeywords = []
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it.each([
    ['Home', Home, 'notices'],
    ['Calendar', Calendar, 'calendar'],
    ['User', User, 'batch'],
  ] as const)('aborts the pending %s request on unmount', async (_name, component, requestKind) => {
    let signal: AbortSignal | undefined
    if (requestKind === 'notices') {
      mocks.fetchNotices.mockImplementation((_params: unknown, requestSignal?: AbortSignal) => {
        signal = requestSignal
        return pendingPromise()
      })
    } else if (requestKind === 'calendar') {
      mocks.fetchCalendarNotices.mockImplementation(
        (_params: unknown, requestSignal?: AbortSignal) => {
          signal = requestSignal
          return pendingPromise()
        },
      )
    } else {
      mocks.fetchNoticesByIds.mockImplementation((_ids: unknown, requestSignal?: AbortSignal) => {
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

  it('stops calendar loading when a range exceeds its safety limit', async () => {
    mocks.fetchCalendarNotices.mockResolvedValue(
      Array.from({ length: 501 }, (_, index) => makeCalendarItem({ id: `notice-${index}` })),
    )

    const wrapper = shallowMount(Calendar, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchCalendarNotices).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('无法加载当前范围通知')
  })

  it('loads the Home DDL bar from the deadline endpoint using subscribed sources', async () => {
    const storeState = mocks.storeState!
    storeState.subscriptionMode = 'custom'
    storeState.subscribedDepts = ['教务处', '计算机科学与技术学院']
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 15,
      invalidItemCount: 0,
    })
    mocks.fetchDeadlineNotices.mockResolvedValue({
      items: [makeDeadlineItem()],
      total: 1,
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchDeadlineNotices).toHaveBeenCalledWith(
      {
        days: 3,
        sources: ['教务处', '计算机学院'],
        page: 1,
        pageSize: 10,
      },
      expect.any(AbortSignal),
    )
    expect(wrapper.get('.ddl-bar-stub').text()).toBe('1')
  })

  it('aborts the Home deadline request on unmount', async () => {
    let deadlineSignal: AbortSignal | undefined
    mocks.fetchNotices.mockImplementation(() => pendingPromise())
    mocks.fetchDeadlineNotices.mockImplementation((_params: unknown, signal?: AbortSignal) => {
      deadlineSignal = signal
      return pendingPromise()
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(deadlineSignal?.aborted).toBe(false)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(deadlineSignal?.aborted).toBe(true)
  })

  it('accepts a cursor page whose total exceeds the current page', async () => {
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 10 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 30,
      invalidItemCount: 0,
      nextCursor: 'cursor-2',
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledOnce()
    expect(mocks.fetchNotices).toHaveBeenCalledWith(
      expect.objectContaining({
        light: true,
        cursor: undefined,
        page: undefined,
        pageSize: 15,
      }),
      expect.any(AbortSignal),
    )
    expect(wrapper.text()).not.toContain('通知加载失败')
  })

  it('keeps a short offset page eligible for loading more', async () => {
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 14 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 30,
      invalidItemCount: 0,
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain('通知加载失败')
    expect(wrapper.findAll('.notice-card-stub')).toHaveLength(14)

    await wrapper.get('.notice-grid').trigger('scroll')
    await flushPromises()
    expect(mocks.fetchNotices.mock.calls.map(([params]) => params)).toEqual([
      expect.objectContaining({ cursor: undefined, page: undefined }),
      expect.objectContaining({ cursor: undefined, page: 2 }),
    ])
  })

  it('shows a warning when the API skips malformed notice records', async () => {
    mocks.fetchNotices.mockResolvedValue({
      items: [makeNotice()],
      total: 1,
      invalidItemCount: 2,
      nextCursor: null,
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('有 2 条通知数据格式异常，已跳过')
  })

  it('applies persisted category preferences to the Home API request', async () => {
    const storeState = mocks.storeState!
    storeState.categoryMode = 'custom'
    storeState.subscribedCategories = ['exam']
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 15 }, (_, index) =>
        makeNotice({ id: `notice-${index + 1}`, categories: ['exam'] }),
      ),
      total: 15,
      invalidItemCount: 0,
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledWith(
      expect.objectContaining({ categories: ['exam'] }),
      expect.any(AbortSignal),
    )

    await wrapper.find('[title="高级搜索"]').trigger('click')
    wrapper.findComponent({ name: 'AdvancedSearch' }).vm.$emit('search', {
      keyword: '',
      source: '',
      categories: [],
      contentType: null,
      dateFrom: '',
      dateTo: '',
      hasDeadline: 'any',
      isRead: 'any',
      isStarred: 'any',
      tags: [],
    })
    await flushPromises()
    expect(mocks.fetchNotices).toHaveBeenLastCalledWith(
      expect.objectContaining({ categories: undefined }),
      expect.any(AbortSignal),
    )

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    storeState.categoryMode = 'all'
    storeState.subscribedCategories = []
  })

  it('keeps the selected content type through refresh and pagination with separate cache keys', async () => {
    mocks.fetchNotices.mockImplementation(async (params: { contentType?: string; cursor?: string }) => ({
      items: params.contentType === 'other'
        ? [makeNotice({ id: params.cursor ? 'other-2' : 'other-1', title: params.cursor ? '其他第二页' : '其他第一页', contentType: 'other' }), makeNotice({ id: 'unknown', title: '未知类型' })]
        : [makeNotice({ id: 'unknown', title: '未知类型' })],
      total: params.contentType === 'other' ? 2 : 1,
      invalidItemCount: 0,
      nextCursor: params.contentType === 'other' && !params.cursor ? 'other-next' : null,
    }))

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('未知类型')

    const filters = { keyword: '', source: '', categories: [], contentType: 'other', dateFrom: '', dateTo: '', hasDeadline: 'any', isRead: 'any', isStarred: 'any', tags: [] }
    await wrapper.find('[title="高级搜索"]').trigger('click')
    wrapper.findComponent({ name: 'AdvancedSearch' }).vm.$emit('search', filters)
    await flushPromises()
    expect(wrapper.text()).toContain('其他第一页')
    expect(wrapper.text()).not.toContain('未知类型')
    expect(wrapper.text()).toContain('类型: 其他')
    expect(mocks.fetchNotices).toHaveBeenLastCalledWith(expect.objectContaining({ contentType: 'other', cursor: undefined }), expect.any(AbortSignal))

    await wrapper.get('.notice-grid').trigger('scroll')
    await flushPromises()
    expect(mocks.fetchNotices).toHaveBeenLastCalledWith(expect.objectContaining({ contentType: 'other', cursor: 'other-next' }), expect.any(AbortSignal))
    expect(wrapper.text()).toContain('其他第二页')

    await wrapper.find('[title="高级搜索"]').trigger('click')
    wrapper.findComponent({ name: 'AdvancedSearch' }).vm.$emit('search', filters)
    await flushPromises()
    expect(mocks.fetchNotices).toHaveBeenLastCalledWith(expect.objectContaining({ contentType: 'other', cursor: undefined }), expect.any(AbortSignal))
    expect(wrapper.text()).not.toContain('其他第二页')

    const keys = mocks.writeNoticeFeedCache.mock.calls.map(([entry]) => entry.key as string)
    expect(keys).toContain('{"keyword":"","source":"","categories":[],"dateFrom":"","dateTo":"","isRead":"any","isStarred":"any","tags":[],"blacklistKeywords":[]}')
    expect(keys.some((key) => JSON.parse(key).contentType === 'other')).toBe(true)
    expect(new Set(keys).size).toBe(2)
  })

  it('replaces in-flight type searches and ignores stale completions including A to B to A', async () => {
    const pending: Array<{ params: { contentType?: string }; resolve: (value: { items: NoticeItem[]; total: number; invalidItemCount: number; nextCursor: null }) => void; reject: (reason: Error) => void }> = []
    mocks.fetchNotices.mockImplementation((params: { contentType?: string }) => {
      let resolve!: (value: { items: NoticeItem[]; total: number; invalidItemCount: number; nextCursor: null }) => void
      let reject!: (reason: Error) => void
      const promise = new Promise<{ items: NoticeItem[]; total: number; invalidItemCount: number; nextCursor: null }>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      })
      pending.push({ params, resolve, reject })
      return promise
    })
    const response = (title: string, contentType: NoticeItem['contentType']) => ({ items: [makeNotice({ title, contentType })], total: 1, invalidItemCount: 0, nextCursor: null })
    const filters = { keyword: '', source: '', categories: [], contentType: 'news', dateFrom: '', dateTo: '', hasDeadline: 'any', isRead: 'any', isStarred: 'any', tags: [] }
    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()
    pending[0]!.resolve(response('初始未知', null))
    await flushPromises()

    await wrapper.find('[title="高级搜索"]').trigger('click')
    wrapper.findComponent({ name: 'AdvancedSearch' }).vm.$emit('search', filters)
    await flushPromises()
    await wrapper.find('[title="高级搜索"]').trigger('click')
    wrapper.findComponent({ name: 'AdvancedSearch' }).vm.$emit('search', { ...filters, contentType: 'public_notice' })
    await flushPromises()
    await wrapper.find('[title="高级搜索"]').trigger('click')
    wrapper.findComponent({ name: 'AdvancedSearch' }).vm.$emit('search', filters)
    await flushPromises()
    expect(pending.map(({ params }) => params.contentType)).toEqual([undefined, 'news', 'public_notice', 'news'])

    pending[1]!.resolve(response('过期新闻', 'news'))
    pending[2]!.reject(new Error('过期错误'))
    await flushPromises()
    await wrapper.find('[title="高级搜索"]').trigger('click')
    wrapper.findComponent({ name: 'AdvancedSearch' }).vm.$emit('search', filters)
    await flushPromises()
    expect(pending).toHaveLength(4)
    expect(wrapper.text()).not.toContain('过期新闻')
    expect(wrapper.text()).not.toContain('过期错误')
    expect(wrapper.findComponent({ name: 'SkeletonLoader' }).exists()).toBe(true)

    const banner = wrapper.findAllComponents({ name: 'AppBanner' }).find((item) => item.text().includes('高级搜索已启用'))!
    banner.vm.$emit('click:close')
    await flushPromises()
    expect(pending).toHaveLength(5)
    expect(pending[4]!.params.contentType).toBeUndefined()
    pending[4]!.resolve(response('恢复未知', null))
    await flushPromises()
    pending[3]!.resolve(response('过期最新新闻', 'news'))
    await flushPromises()
    expect(wrapper.text()).toContain('恢复未知')
    expect(wrapper.text()).not.toContain('过期最新新闻')
    expect(wrapper.text()).not.toContain('过期错误')
    expect(wrapper.text()).not.toContain('高级搜索已启用')
    expect(wrapper.findComponent({ name: 'SkeletonLoader' }).exists()).toBe(false)
    expect(wrapper.find('v-progress-linear-stub').exists()).toBe(false)
  })

  it('shows a persisted Home cache immediately while refreshing in the background', async () => {
    mocks.readNoticeFeedCache.mockResolvedValue({
      key: 'home-cache-key',
      items: [makeNotice({ title: '缓存通知' })],
      total: 1,
      nextPage: 2,
      finished: true,
      scanPaused: false,
      fetchedAt: '2026-08-01T08:00:00.000Z',
      stale: false,
    })
    mocks.fetchNotices.mockImplementation(() => pendingPromise())

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.readNoticeFeedCache).toHaveBeenCalledOnce()
    expect(mocks.fetchNotices).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('缓存通知')
    expect(wrapper.text()).toContain('正在同步最新通知')
  })

  it('keeps cached Home data visible when the refresh request fails', async () => {
    mocks.readNoticeFeedCache.mockResolvedValue({
      key: 'home-cache-key',
      items: [makeNotice({ title: '离线缓存通知' })],
      total: 1,
      nextPage: 2,
      finished: true,
      scanPaused: false,
      fetchedAt: '2026-08-01T08:00:00.000Z',
      stale: true,
    })
    mocks.fetchNotices.mockRejectedValue(new Error('network unavailable'))

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('离线缓存通知')
    expect(wrapper.text()).toContain('当前显示缓存数据')
    expect(wrapper.text()).toContain('可点击重试')
  })

  it('continues Home pagination from the next unrequested page', async () => {
    mocks.fetchNotices.mockImplementation(async (params: { cursor?: string }) => ({
      items: Array.from({ length: 15 }, (_, index) =>
        makeNotice({ id: `notice-${params.cursor === 'cursor-2' ? 200 + index : 100 + index}` }),
      ),
      total: 45,
      invalidItemCount: 0,
      nextCursor: params.cursor === 'cursor-2' ? null : 'cursor-2',
    }))

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.get('.notice-grid').trigger('scroll')
    await flushPromises()

    expect(mocks.fetchNotices.mock.calls.map(([params]) => params.cursor)).toEqual([
      undefined,
      'cursor-2',
    ])
  })

  it('scans later Home pages when a local blacklist filters out the first page', async () => {
    const storeState = mocks.storeState!
    storeState.blacklistKeywords = ['屏蔽']
    mocks.fetchNotices.mockImplementation(async (params: { cursor?: string }) => ({
      items: Array.from({ length: 15 }, (_, index) =>
        makeNotice({
          id: `notice-${params.cursor === 'cursor-2' ? 200 + index : 100 + index}`,
          title: params.cursor === 'cursor-2' ? '可见通知' : '屏蔽通知',
        }),
      ),
      total: 30,
      invalidItemCount: 0,
      nextCursor: params.cursor === 'cursor-2' ? null : 'cursor-2',
    }))

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNotices.mock.calls.map(([params]) => params.cursor)).toEqual([
      undefined,
      'cursor-2',
    ])
    expect(wrapper.text()).toContain('可见通知')
    expect(wrapper.text()).not.toContain('暂无通知')

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    storeState.blacklistKeywords = []
  })

  it('merges cursor pages without requiring offset overlap checks', async () => {
    mocks.fetchNotices.mockImplementation(async (params: { cursor?: string }) => ({
      items: params.cursor
        ? Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 15}` }))
        : Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 30,
      invalidItemCount: 0,
      nextCursor: params.cursor === 'cursor-2' ? null : 'cursor-2',
    }))

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.get('.notice-grid').trigger('scroll')
    await flushPromises()

    expect(mocks.fetchNotices.mock.calls.map(([params]) => params.cursor)).toEqual([
      undefined,
      'cursor-2',
    ])
    expect(mocks.writeNoticeFeedCache).toHaveBeenCalledTimes(2)
    expect(mocks.writeNoticeFeedCache).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'notice-1' }),
          expect.objectContaining({ id: 'notice-15' }),
        ]),
        nextCursor: null,
        paginationMode: 'cursor',
      }),
    )
    expect(wrapper.text()).not.toContain('更多通知加载失败')
  })

  it('shows an error when the calendar request fails', async () => {
    mocks.fetchCalendarNotices.mockRejectedValue(new Error('network unavailable'))

    const wrapper = shallowMount(Calendar, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchCalendarNotices).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('无法加载当前范围通知')
  })

  it('refreshes an important DDL even when a cached deadline is available', async () => {
    const cachedNotice = makeNotice({ title: '缓存中的通知', deadline: '2026-08-10' })
    const refreshedNotice = makeNotice({ title: '刷新后的通知', deadline: '2026-08-20' })
    mocks.getCachedNotice.mockReturnValue(cachedNotice)
    mocks.fetchNoticesByIds.mockResolvedValue({ items: [refreshedNotice], missing: [] })

    const wrapper = shallowMount(User, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()

    expect(mocks.fetchNoticesByIds).toHaveBeenCalledWith(['notice-1'], expect.any(AbortSignal))
    expect(mocks.cacheNotice).toHaveBeenCalledWith(refreshedNotice)
    expect(wrapper.html()).toContain('刷新后的通知')
  })

  it('falls back to a cached important DDL and warns when refresh fails', async () => {
    const cachedNotice = makeNotice({ title: '缓存中的通知', deadline: '2026-08-10' })
    mocks.getCachedNotice.mockReturnValue(cachedNotice)
    mocks.fetchNoticesByIds.mockRejectedValue(new Error('network unavailable'))

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
      invalidItemCount: 0,
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
    storeState.subscribedCategories = [...storeState.subscribedCategories]
    storeState.blacklistKeywords = [...storeState.blacklistKeywords]
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledOnce()
  })

  it('still reloads Home when subscription content actually changes', async () => {
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 15,
      invalidItemCount: 0,
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

  it('reloads Home when the persisted category selection changes', async () => {
    mocks.fetchNotices.mockResolvedValue({
      items: Array.from({ length: 15 }, (_, index) => makeNotice({ id: `notice-${index + 1}` })),
      total: 15,
      invalidItemCount: 0,
    })

    const wrapper = shallowMount(Home, { global: { stubs } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(mocks.fetchNotices).toHaveBeenCalledOnce()

    const storeState = mocks.storeState!
    storeState.categoryMode = 'custom'
    storeState.subscribedCategories = ['exam']
    await flushPromises()

    expect(mocks.fetchNotices).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    storeState.categoryMode = 'all'
    storeState.subscribedCategories = []
  })
})
