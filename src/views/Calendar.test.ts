import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarItem } from '../types/notice'
import { getLocalToday } from '../utils/date'

const mocks = vi.hoisted(() => ({
  fetchCalendarNotices: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../utils/request', () => ({
  ApiConfigurationError: class ApiConfigurationError extends Error {},
  fetchCalendarNotices: mocks.fetchCalendarNotices,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

import Calendar from './Calendar.vue'

function makeItem(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    id: 'notice-1',
    title: '测试通知',
    source: '教务处',
    contentType: null,
    publishDate: null,
    deadline: null,
    ...overrides,
  }
}

describe('Calendar events', () => {
  beforeEach(() => {
    window.innerWidth = 1280
    mocks.fetchCalendarNotices.mockReset()
    mocks.push.mockReset()
  })

  afterEach(() => {
    window.innerWidth = 1024
  })

  it('skips a missing publication date but keeps the deadline event', async () => {
    const today = getLocalToday()
    mocks.fetchCalendarNotices.mockResolvedValue({
      items: [
        makeItem({ id: 'no-publish', title: '无发布日期但有截止', deadline: today }),
        makeItem({ id: 'no-deadline', title: '有发布日期但无截止', publishDate: today }),
        makeItem({ id: 'no-dates', title: '日期均未知' }),
      ],
      total: 3,
      truncated: false,
    })

    const wrapper = shallowMount(Calendar, {
      global: {
        stubs: {
          'v-app-bar': true,
          'v-app-bar-title': true,
          'v-spacer': true,
          'v-btn': true,
          'v-btn-toggle': true,
          'v-progress-circular': true,
          'v-progress-linear': true,
          'v-card': true,
          'v-card-title': true,
          'v-card-subtitle': true,
          'v-icon': true,
          'v-chip': true,
          'v-list': true,
          'v-list-subheader': true,
          'v-list-item': true,
          'v-list-item-title': true,
          'v-list-item-subtitle': true,
          'v-expand-transition': true,
        },
      },
    })
    await flushPromises()

    const eventTitles = wrapper.findAll('.event-text').map((event) => event.text())
    expect(eventTitles).toEqual(['无发布日期但有截止', '有发布日期但无截止'])
    expect(wrapper.text()).not.toContain('日期均未知')
  })
})
