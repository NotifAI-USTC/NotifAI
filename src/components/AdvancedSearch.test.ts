import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEPARTMENTS } from '../types/notice'
import AdvancedSearch from './AdvancedSearch.vue'

const mocks = vi.hoisted(() => ({
  fetchSources: vi.fn(),
}))

vi.mock('../utils/request', () => ({
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
}

function mountDialog() {
  return shallowMount(AdvancedSearch, { global: { stubs } })
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
})
