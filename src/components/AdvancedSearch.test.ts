import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEPARTMENTS, NOTICE_CATEGORY_DEFINITIONS } from '../types/notice'
import AdvancedSearch from './AdvancedSearch.vue'

const mocks = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchSources: vi.fn(),
}))

vi.mock('../utils/request', () => ({
  fetchCategories: mocks.fetchCategories,
  fetchSources: mocks.fetchSources,
}))

const stubs = {
  VDialog: { template: '<div><slot /></div>' },
  VCard: { template: '<div><slot /></div>' },
  VCardTitle: { template: '<div><slot /></div>' },
  VCardText: { template: '<div><slot /></div>' },
  VCardActions: { template: '<div><slot /></div>' },
  VDivider: true,
  VSpacer: true,
  VTextField: true,
  VBtn: true,
  VIcon: true,
  VChip: true,
  VBtnToggle: true,
  VSelect: {
    name: 'VSelectStub',
    props: ['items'],
    emits: ['update:modelValue'],
    template: '<div class="v-select-stub" />',
  },
  VAutocomplete: {
    name: 'VAutocompleteStub',
    props: ['items'],
    emits: ['update:modelValue'],
    template: '<div class="v-autocomplete-stub" />',
  },
}

function mountDialog() {
  return shallowMount(AdvancedSearch, { global: { stubs, plugins: [createPinia()] } })
}

describe('AdvancedSearch source options', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads source options from GET /sources', async () => {
    mocks.fetchSources.mockResolvedValue([
      { name: '教务处', group: '校级部门', noticeCount: 10 },
      { name: '图书馆', group: '校级部门', noticeCount: 5 },
    ])

    const wrapper = mountDialog()
    await flushPromises()

    expect(mocks.fetchSources).toHaveBeenCalledOnce()
    expect(mocks.fetchSources).toHaveBeenCalledWith(expect.any(AbortSignal))
    const select = wrapper.findComponent({ name: 'VSelectStub' })
    expect(select.exists()).toBe(true)
    expect(select.props('items')).toEqual([
      { title: '教务处', value: '教务处', group: '校级部门' },
      { title: '图书馆', value: '图书馆', group: '校级部门' },
    ])
  })

  it('falls back to built-in departments when the sources request fails', async () => {
    mocks.fetchSources.mockRejectedValue(new Error('network unavailable'))

    const wrapper = mountDialog()
    await flushPromises()

    const select = wrapper.findComponent({ name: 'VSelectStub' })
    expect(select.props('items')).toEqual(
      DEPARTMENTS.map((d) => ({ title: d.name, value: d.name, group: d.group })),
    )
  })

  it('loads category options from GET /categories with notice counts', async () => {
    mocks.fetchSources.mockResolvedValue([])
    mocks.fetchCategories.mockResolvedValue([
      {
        key: 'exam',
        name: '考试安排',
        description: '考试相关通知',
        noticeCount: 17,
      },
      {
        key: 'graduation',
        name: '毕业相关',
        description: '毕业相关通知',
        noticeCount: 0,
      },
    ])

    const wrapper = mountDialog()
    await flushPromises()

    expect(mocks.fetchCategories).toHaveBeenCalledOnce()
    expect(mocks.fetchCategories).toHaveBeenCalledWith(expect.any(AbortSignal))
    const autocomplete = wrapper.findComponent({ name: 'VAutocompleteStub' })
    expect(autocomplete.props('items')).toEqual([
      {
        title: '考试安排（17）',
        value: 'exam',
        subtitle: '考试相关通知',
      },
      {
        title: '毕业相关（0）',
        value: 'graduation',
        subtitle: '毕业相关通知',
      },
    ])
  })

  it('falls back to all built-in categories when GET /categories fails', async () => {
    mocks.fetchSources.mockResolvedValue([])
    mocks.fetchCategories.mockRejectedValue(new Error('network unavailable'))

    const wrapper = mountDialog()
    await flushPromises()

    const autocomplete = wrapper.findComponent({ name: 'VAutocompleteStub' })
    expect(autocomplete.props('items')).toEqual(
      NOTICE_CATEGORY_DEFINITIONS.map((item) => ({
        title: item.name,
        value: item.key,
        subtitle: item.description,
      })),
    )
  })
})
