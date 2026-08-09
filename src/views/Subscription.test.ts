import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserSettingsStore } from '../stores/userSettings'
import Subscription from './Subscription.vue'

const mocks = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchSources: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../utils/request', () => ({
  fetchCategories: mocks.fetchCategories,
  fetchSources: mocks.fetchSources,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

const slotStub = { template: '<div><slot /></div>' }
const stubs = {
  VAppBar: slotStub,
  VAppBarTitle: slotStub,
  VBtn: { template: '<button v-bind="$attrs"><slot /></button>' },
  VContainer: slotStub,
  VCard: slotStub,
  VCardTitle: slotStub,
  VCardSubtitle: slotStub,
  VCardText: slotStub,
  VDivider: true,
  VSpacer: true,
  VList: slotStub,
  VListItem: {
    name: 'VListItemStub',
    props: ['title', 'subtitle'],
    template: '<div><span>{{ title }}</span><span>{{ subtitle }}</span><slot name="append" /></div>',
  },
  VSwitch: {
    name: 'VSwitchStub',
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<button :disabled="disabled" />',
  },
  VProgressCircular: true,
  VAlert: slotStub,
  VRow: slotStub,
  VCol: slotStub,
  VTextField: true,
  VChipGroup: slotStub,
  VChip: slotStub,
  VIcon: true,
}

describe('Subscription category preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.fetchSources.mockResolvedValue([
      { name: '教务处', group: '校级部门', noticeCount: 10 },
    ])
    mocks.fetchCategories.mockResolvedValue([
      { key: 'exam', name: '考试安排', description: '考试相关通知', noticeCount: 8 },
      { key: 'research', name: '科研通知', description: '科研相关通知', noticeCount: 4 },
    ])
  })

  it('loads category metadata and persists a category toggle', async () => {
    const wrapper = shallowMount(Subscription, {
      global: { plugins: [createPinia()], stubs },
    })
    await flushPromises()

    expect(mocks.fetchCategories).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(wrapper.text()).toContain('考试安排')
    expect(wrapper.text()).toContain('考试相关通知 · 8 条通知')

    const examItem = wrapper
      .findAllComponents({ name: 'VListItemStub' })
      .find((item) => item.props('title') === '考试安排')
    if (!examItem) throw new Error('未渲染考试分类')
    examItem.findComponent({ name: 'VSwitchStub' }).vm.$emit('update:modelValue', false)
    await flushPromises()

    const store = useUserSettingsStore()
    expect(store.categoryMode).toBe('custom')
    expect(store.isCategorySubscribed('exam')).toBe(false)
  })

  it('falls back to built-in categories when the metadata request fails', async () => {
    mocks.fetchCategories.mockRejectedValue(new Error('network unavailable'))
    const wrapper = shallowMount(Subscription, {
      global: { plugins: [createPinia()], stubs },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('已展示内置分类列表')
    expect(wrapper.text()).toContain('选课通知')
    expect(wrapper.text()).toContain('其他通知')
  })
})
