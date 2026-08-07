import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'
import DdlNoticeBar from './DdlNoticeBar.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

function mountBar(notices: NoticeItem[]) {
  return mount(DdlNoticeBar, {
    props: { notices },
    global: {
      // 让 v-alert / v-slide-group 渲染 slot，v-chip 保留文本内容便于断言
      stubs: {
        VAlert: { template: '<div class="ddl-notice-bar"><slot /></div>' },
        VSlideGroup: { template: '<div class="v-slide-group"><slot /></div>' },
        VSlideGroupItem: { template: '<div class="v-slide-group-item"><slot /></div>' },
        VIcon: { template: '<span class="v-icon" />' },
      },
    },
  })
}

function makeNotice(overrides: Partial<NoticeItem> = {}): NoticeItem {
  return {
    id: 'notice-1',
    title: '测试通知',
    source: '教务处',
    publishDate: '2026-08-01',
    aiSummary: '',
    deadline: '2026-08-05',
    targetAudience: '',
    coreAction: '',
    originUrl: 'https://www.ustc.edu.cn/notice/1',
    cleanContent: '',
    attachments: [],
    ...overrides,
  }
}

describe('DdlNoticeBar', () => {
  // 固定"今天"为 2026-08-05，使截止日期判定确定且不随真实时间漂移
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 5))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when there are no urgent notices', () => {
    const wrapper = mountBar([
      makeNotice({ id: 'far', deadline: '2026-12-31' }),
      makeNotice({ id: 'none', deadline: null }),
    ])
    expect(wrapper.find('.ddl-notice-bar').exists()).toBe(false)
  })

  it('shows only urgent notices sorted by nearest deadline', () => {
    const wrapper = mountBar([
      makeNotice({ id: 'far', title: '远期通知', deadline: '2026-12-31' }),
      makeNotice({ id: 'near', title: '明天截止', deadline: '2026-08-06' }),
      makeNotice({ id: 'today', title: '今天截止', deadline: '2026-08-05' }),
      makeNotice({ id: 'none', title: '无截止', deadline: null }),
    ])

    expect(wrapper.find('.ddl-notice-bar').exists()).toBe(true)
    const titles = wrapper.findAll('.v-slide-group-item').map((item) => item.text())
    // 只有两个紧急通知（today / near），远期和无截止的不显示
    expect(titles.length).toBe(2)
    expect(titles.join()).toContain('今天截止')
    expect(titles.join()).toContain('明天截止')
    expect(titles.join()).not.toContain('远期通知')
    expect(titles.join()).not.toContain('无截止')
  })
})
