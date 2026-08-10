import { shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'

const store = vi.hoisted(() => ({
  folders: [] as Array<{ id: string; name: string; icon: string; createdAt: number }>,
  starredFolderMap: Object.create(null) as Record<string, string>,
  persistenceError: '',
  addFolder: vi.fn(),
  getStarredInFolder: vi.fn(() => [] as string[]),
  isStarred: vi.fn(() => false),
  moveToFolder: vi.fn(),
  renameFolder: vi.fn(),
  removeFolder: vi.fn(),
}))

vi.mock('../stores/userSettings', () => ({
  USER_FOLDER_LIMIT: 100,
  useUserSettingsStore: () => store,
}))

import FolderDialog from './FolderDialog.vue'

const containerStub = { template: '<div><slot /><slot name="append" /></div>' }
const notice: NoticeItem = {
  id: 'notice-1',
  title: '测试通知',
  source: '教务处',
  categories: ['other'],
  publishDate: '2026-08-10',
  aiSummary: '测试摘要',
  deadline: null,
  targetAudience: '',
  coreAction: '',
  originUrl: 'https://example.com/notice-1',
  cleanContent: '测试正文',
  attachments: [],
}

function mountDialog(
  props: { mode: 'select' | 'manage'; notice?: NoticeItem } = { mode: 'manage' },
) {
  return shallowMount(FolderDialog, {
    props,
    global: {
      stubs: {
        VDialog: containerStub,
        VCard: containerStub,
        VCardTitle: containerStub,
        VCardText: containerStub,
        VCardActions: containerStub,
        VList: containerStub,
        VListItem: containerStub,
        VListItemTitle: containerStub,
        VListItemSubtitle: containerStub,
        VRow: containerStub,
        VCol: containerStub,
        VAlert: { template: '<div role="alert"><slot /></div>' },
        VDivider: true,
        VIcon: true,
        VSpacer: true,
        VBtn: {
          props: ['disabled'],
          emits: ['click'],
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        VTextField: {
          props: ['modelValue', 'label'],
          emits: ['update:modelValue'],
          template:
            '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
      },
    },
  })
}

describe('FolderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.folders = [{ id: 'default', name: '默认收藏', icon: '$star', createdAt: 0 }]
    store.persistenceError = ''
    store.isStarred.mockReturnValue(false)
  })

  it('shows the folder limit and disables creation at capacity', () => {
    store.folders = Array.from({ length: 100 }, (_, index) => ({
      id: index === 0 ? 'default' : `folder-${index}`,
      name: `Folder ${index}`,
      icon: '$folder',
      createdAt: index,
    }))

    const wrapper = mountDialog()
    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建收藏夹')

    expect(wrapper.text()).toContain('已达到 100 个收藏夹上限')
    expect(createButton?.attributes('disabled')).toBeDefined()
  })

  it('keeps the form open and displays the store error when creation fails', async () => {
    store.persistenceError = '本机设置为只读'
    store.addFolder.mockReturnValue(null)
    const wrapper = mountDialog()

    const openButton = wrapper.findAll('button').find((button) => button.text() === '新建收藏夹')
    await openButton?.trigger('click')
    await wrapper.get('input[aria-label="收藏夹名称"]').setValue('课程')
    const createButton = wrapper.findAll('button').find((button) => button.text() === '创建')
    await createButton?.trigger('click')

    expect(store.addFolder).toHaveBeenCalledWith('课程', '$folder')
    expect(wrapper.get('[role="alert"]').text()).toContain('本机设置为只读')
    expect(wrapper.find('input[aria-label="收藏夹名称"]').exists()).toBe(true)
  })

  it('offers removal when managing an already starred notice', async () => {
    store.isStarred.mockReturnValue(true)
    const wrapper = mountDialog({ mode: 'select', notice })
    const removeButton = wrapper.findAll('button').find((button) => button.text() === '取消收藏')

    expect(removeButton).toBeDefined()
    await removeButton?.trigger('click')

    expect(wrapper.emitted('remove')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
