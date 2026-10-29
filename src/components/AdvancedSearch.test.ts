import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NOTICE_CATEGORY_DEFINITIONS, SOURCE_CATALOG_FALLBACK } from '../types/notice'
import { resetSourceCatalogStateForTests } from '../composables/useSourceCatalog'
import { clearSourceCatalogCache } from '../utils/sourceCatalogCache'
import AdvancedSearch from './AdvancedSearch.vue'
import type { SearchFilters } from './AdvancedSearch.vue'

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
  VBtn: { template: '<button><slot /></button>' },
  VIcon: true,
  VChip: true,
  VBtnToggle: true,
  VSelect: {
    name: 'VSelectStub',
    props: {
      items: Array,
      modelValue: String,
      label: String,
      placeholder: String,
      hint: String,
      clearable: Boolean,
      persistentHint: Boolean,
    },
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

function mountDialog(initialFilters?: SearchFilters) {
  return shallowMount(AdvancedSearch, {
    props: { initialFilters },
    global: { stubs, plugins: [createPinia()] },
  })
}

describe('AdvancedSearch source options', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    resetSourceCatalogStateForTests()
    await clearSourceCatalogCache()
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

  it('falls back to the checked-in /sources snapshot when the request fails', async () => {
    mocks.fetchSources.mockRejectedValue(new Error('network unavailable'))

    const wrapper = mountDialog()
    await flushPromises()

    const select = wrapper.findComponent({ name: 'VSelectStub' })
    expect(select.props('items')).toEqual(
      SOURCE_CATALOG_FALLBACK.map((source) => ({
        title: source.name,
        value: source.name,
        group: source.group,
      })),
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

  it('offers the four independent single content types and submits the selected value', async () => {
    const wrapper = mountDialog()
    const select = wrapper.findAllComponents({ name: 'VSelectStub' })[1]!

    expect(select.props()).toMatchObject({
      modelValue: null,
      label: '内容类型',
      placeholder: '全部类型',
      clearable: true,
      persistentHint: true,
      items: [
        { title: '新闻', value: 'news' },
        { title: '通知/公告', value: 'notice' },
        { title: '公示', value: 'public_notice' },
        { title: '其他', value: 'other' },
      ],
    })

    select.vm.$emit('update:modelValue', 'public_notice')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('search')).toBeUndefined()
    await wrapper.findAll('button').find((button) => button.text().includes('搜索'))!.trigger('click')
    expect(wrapper.emitted('search')?.[0]?.[0]).toMatchObject({
      contentType: 'public_notice',
      categories: [],
    })
  })

  it('restores applied values after cancel and applies clearing or reset only on search', async () => {
    const applied: SearchFilters = {
      keyword: '奖学金',
      source: '',
      contentType: 'other',
      categories: ['scholarship'],
      dateFrom: '',
      dateTo: '',
      hasDeadline: 'any',
      isRead: 'any',
      isStarred: 'any',
      tags: [],
    }
    const wrapper = mountDialog(applied)
    const select = wrapper.findAllComponents({ name: 'VSelectStub' })[1]!
    expect(select.props('modelValue')).toBe('other')
    select.vm.$emit('update:modelValue', 'news')
    await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('search')).toBeUndefined()
    expect(applied.contentType).toBe('other')
    wrapper.unmount()

    const reopened = mountDialog(applied)
    const reopenedSelect = reopened.findAllComponents({ name: 'VSelectStub' })[1]!
    expect(reopenedSelect.props('modelValue')).toBe('other')
    reopenedSelect.vm.$emit('update:modelValue', null)
    await reopened.vm.$nextTick()
    expect(reopened.emitted('search')).toBeUndefined()
    await reopened.findAll('button').find((button) => button.text().includes('搜索'))!.trigger('click')
    expect(reopened.emitted('search')?.[0]?.[0]).toMatchObject({
      contentType: null,
      categories: ['scholarship'],
    })

    reopenedSelect.vm.$emit('update:modelValue', 'notice')
    await reopened.findAll('button').find((button) => button.text() === '重置')!.trigger('click')
    expect(reopenedSelect.props('modelValue')).toBeNull()
    expect(reopened.emitted('search')).toHaveLength(1)
    await reopened.findAll('button').find((button) => button.text().includes('搜索'))!.trigger('click')
    expect(reopened.emitted('search')?.[1]?.[0]).toMatchObject({
      keyword: '',
      contentType: null,
      categories: [],
    })
  })
})
