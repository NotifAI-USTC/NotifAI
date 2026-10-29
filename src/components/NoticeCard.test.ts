import { shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'
import NoticeCard from './NoticeCard.vue'

vi.mock('../stores/userSettings', () => ({
  useUserSettingsStore: () => ({
    isPinned: () => false,
    isImportant: () => false,
    isStarred: () => false,
    customTags: {},
  }),
}))

const notice: NoticeItem = {
  id: 'notice-1', title: '测试通知', source: '教务处', contentType: null, categories: ['other'],
  publishDate: '2026-08-01', aiSummary: '', deadline: null, targetAudience: '', coreAction: '',
  originUrl: 'https://www.ustc.edu.cn/notice/1', cleanContent: '', attachments: [],
}

const slot = { template: '<div><slot /></div>' }

describe('NoticeCard content type', () => {
  it('distinguishes unknown from other and keeps the independent category label', async () => {
    const wrapper = shallowMount(NoticeCard, {
      props: { notice },
      global: { stubs: { VCard: slot, VCardText: slot, VChip: slot } },
    })
    expect(wrapper.find('[aria-label^="内容类型："]').exists()).toBe(false)
    expect(wrapper.text()).toContain('其他通知')
    await wrapper.setProps({ notice: { ...notice, contentType: 'other' } })
    expect(wrapper.find('[aria-label="内容类型：其他"]').text()).toBe('其他')
    expect(wrapper.text()).toContain('其他通知')
    wrapper.unmount()
  })
})
