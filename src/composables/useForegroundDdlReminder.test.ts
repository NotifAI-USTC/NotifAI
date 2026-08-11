import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeadlineItem } from '../types/notice'

const mocks = vi.hoisted(() => ({
  fetchDeadlineNotices: vi.fn(),
  sendNotification: vi.fn(),
  store: {
    notificationEnabled: true,
    subscriptionMode: 'custom',
    subscribedDepts: ['教务处', '计算机科学与技术学院'],
    blacklistKeywords: ['屏蔽'],
  },
}))

vi.mock('../utils/request', () => ({
  fetchDeadlineNotices: mocks.fetchDeadlineNotices,
}))

vi.mock('../utils/notification', () => ({
  isNotificationSupported: () => true,
  sendNotification: mocks.sendNotification,
}))

vi.mock('../stores/userSettings', () => ({
  useUserSettingsStore: () => mocks.store,
}))

import { useForegroundDdlReminder } from './useForegroundDdlReminder'

const Harness = defineComponent({
  setup() {
    useForegroundDdlReminder()
    return () => h('div')
  },
})

function deadline(overrides: Partial<DeadlineItem> = {}): DeadlineItem {
  return {
    id: 'notice-1',
    title: '明天截止',
    source: '教务处',
    publishDate: '2026-08-01',
    deadline: '2026-08-12',
    aiSummary: '请及时办理',
    targetAudience: '全体学生',
    ...overrides,
  }
}

describe('useForegroundDdlReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchDeadlineNotices.mockReset()
    mocks.sendNotification.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 11))
    vi.stubGlobal('Notification', { permission: 'granted' })
    mocks.store.notificationEnabled = true
    mocks.store.subscriptionMode = 'custom'
    mocks.store.subscribedDepts = ['教务处', '计算机科学与技术学院']
    mocks.store.blacklistKeywords = ['屏蔽']
    mocks.fetchDeadlineNotices.mockResolvedValue({
      items: [deadline(), deadline({ id: 'notice-2', title: '屏蔽通知', aiSummary: '屏蔽内容' })],
      total: 2,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('polls the lightweight endpoint for subscribed sources and deduplicates reminders', async () => {
    const wrapper = mount(Harness)
    await flushPromises()

    expect(mocks.fetchDeadlineNotices).toHaveBeenCalledWith(
      {
        days: 1,
        sources: ['教务处', '计算机学院'],
        page: 1,
        pageSize: 50,
      },
      expect.any(AbortSignal),
    )
    expect(mocks.sendNotification).toHaveBeenCalledOnce()
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'NotifAI · DDL 提醒',
      expect.objectContaining({ body: expect.stringContaining('明天截止') }),
    )

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    await flushPromises()
    expect(mocks.fetchDeadlineNotices).toHaveBeenCalledTimes(2)
    expect(mocks.sendNotification).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('does not request all sources when a custom subscription is empty', async () => {
    mocks.store.subscribedDepts = []
    const wrapper = mount(Harness)
    await flushPromises()

    expect(mocks.fetchDeadlineNotices).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('aborts an in-flight deadline poll on unmount', async () => {
    let signal: AbortSignal | undefined
    mocks.fetchDeadlineNotices.mockImplementation(
      (_params: unknown, requestSignal?: AbortSignal) => {
        signal = requestSignal
        return new Promise(() => undefined)
      },
    )
    const wrapper = mount(Harness)
    await flushPromises()
    expect(signal?.aborted).toBe(false)

    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
