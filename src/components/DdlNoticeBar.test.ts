import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeadlineItem } from '../types/notice'
import DdlNoticeBar from './DdlNoticeBar.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

function mountBar(notices: DeadlineItem[]) {
  return mount(DdlNoticeBar, {
    props: { notices },
    global: {
      // 让 v-alert / v-slide-group 渲染 slot，v-chip 保留文本内容便于断言
      stubs: {
        VAlert: { template: '<div class="ddl-notice-bar"><slot /></div>' },
        VSlideGroup: { template: '<div class="v-slide-group"><slot /></div>' },
        VSlideGroupItem: { template: '<div class="v-slide-group-item"><slot /></div>' },
        VBtn: {
          props: ['disabled'],
          emits: ['click'],
          template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')" />',
        },
        VIcon: { template: '<span class="v-icon" />' },
      },
    },
  })
}

/** useWindowSize 是模块级共享状态，测试中通过 resize 事件切换视口。 */
function setViewport(width: number): void {
  window.innerWidth = width
  window.dispatchEvent(new Event('resize'))
}

function makeNotice(overrides: Partial<DeadlineItem> = {}): DeadlineItem {
  return {
    id: 'notice-1',
    title: '测试通知',
    source: '教务处',
    contentType: null,
    publishDate: '2026-08-01',
    aiSummary: '',
    deadline: '2026-08-05',
    targetAudience: '',
    ...overrides,
  }
}

describe('DdlNoticeBar', () => {
  // 固定"今天"为 2026-08-05，使截止日期判定确定且不随真实时间漂移
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 5))
    setViewport(1024)
  })

  afterEach(() => {
    setViewport(1024)
    vi.useRealTimers()
  })

  it('renders nothing when there are no urgent notices', () => {
    const wrapper = mountBar([makeNotice({ id: 'far', deadline: '2026-12-31' })])
    expect(wrapper.find('.ddl-notice-bar').exists()).toBe(false)
  })

  it('shows only urgent notices sorted by nearest deadline', () => {
    const wrapper = mountBar([
      makeNotice({ id: 'far', title: '远期通知', deadline: '2026-12-31' }),
      makeNotice({ id: 'near', title: '明天截止', deadline: '2026-08-06' }),
      makeNotice({ id: 'today', title: '今天截止', deadline: '2026-08-05' }),
    ])

    expect(wrapper.find('.ddl-notice-bar').exists()).toBe(true)
    const titles = wrapper.findAll('.v-slide-group-item').map((item) => item.text())
    // 只有两个紧急通知（today / near），远期通知不显示
    expect(titles.length).toBe(2)
    expect(titles.join()).toContain('今天截止')
    expect(titles.join()).toContain('明天截止')
    expect(titles.join()).not.toContain('远期通知')
  })

  it('keeps the desktop label and slide group', () => {
    const wrapper = mountBar([
      makeNotice({ id: 'today', title: '今天截止', deadline: '2026-08-05' }),
    ])

    expect(wrapper.text()).toContain('紧急 DDL')
    expect(wrapper.findAll('.v-slide-group-item')).toHaveLength(1)
    expect(wrapper.find('.ddl-notice-bar__mobile').exists()).toBe(false)
  })

  it('shows one slide per item on mobile, with title and source/deadline separated', () => {
    setViewport(390)
    const wrapper = mountBar([
      makeNotice({ id: 'near', title: '选课通知', deadline: '2026-08-06' }),
      makeNotice({ id: 'today', title: '今天截止', deadline: '2026-08-05' }),
    ])

    expect(wrapper.find('.ddl-notice-bar__mobile').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('紧急 DDL')
    expect(wrapper.find('.v-slide-group').exists()).toBe(false)

    const slides = wrapper.findAll('.ddl-notice-bar__slide')
    expect(slides).toHaveLength(2)

    // 按截止日期从近到远：今天截止在前
    const firstTitle = slides[0].find('.ddl-notice-bar__slide-title')
    const firstMeta = slides[0].find('.ddl-notice-bar__slide-meta')
    expect(firstTitle.text()).toBe('今天截止')
    expect(firstTitle.text()).not.toContain('教务处')
    expect(firstMeta.text()).toContain('教务处')
    expect(firstMeta.text()).toContain('今天截止')
  })

  it('pages between mobile slides with prev/next controls', async () => {
    setViewport(390)
    const wrapper = mountBar([
      makeNotice({ id: 'near', title: '选课通知', deadline: '2026-08-06' }),
      makeNotice({ id: 'today', title: '今天截止', deadline: '2026-08-05' }),
    ])

    const pager = wrapper.find('.ddl-notice-bar__pager')
    expect(pager.exists()).toBe(true)
    expect(pager.find('.ddl-notice-bar__pager-count').text()).toBe('1/2')

    const buttons = pager.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[1].attributes('disabled')).toBeUndefined()

    await buttons[1].trigger('click')
    expect(pager.find('.ddl-notice-bar__pager-count').text()).toBe('2/2')
    expect(buttons[0].attributes('disabled')).toBeUndefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()

    await buttons[0].trigger('click')
    expect(pager.find('.ddl-notice-bar__pager-count').text()).toBe('1/2')
  })

  it('hides the mobile pager when only one notice is urgent', () => {
    setViewport(390)
    const wrapper = mountBar([
      makeNotice({ id: 'today', title: '今天截止', deadline: '2026-08-05' }),
    ])

    expect(wrapper.findAll('.ddl-notice-bar__slide')).toHaveLength(1)
    expect(wrapper.find('.ddl-notice-bar__pager').exists()).toBe(false)
  })
})
