import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'

const mocks = vi.hoisted(() => ({
  loadBatchNotices: vi.fn(),
  push: vi.fn(),
  store: {
    folders: [] as Array<{ id: string; name: string }>,
    starredFolderMap: {} as Record<string, string>,
    pinnedIds: [] as string[],
    starredIds: ['new', 'null-b', 'old', 'null-a'],
    isRead: () => false,
    markRead: vi.fn(),
    toggleStar: vi.fn(),
  },
}))

vi.mock('../stores/userSettings', () => ({
  useUserSettingsStore: () => mocks.store,
}))

vi.mock('../composables/useBatchNoticeLoader', () => ({
  loadBatchNotices: mocks.loadBatchNotices,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

import NoticeCard from '../components/NoticeCard.vue'
import Favorites from './Favorites.vue'

function makeNotice(id: string, publishDate: string | null): NoticeItem {
  return {
    id,
    title: `通知 ${id}`,
    source: '教务处',
    categories: [],
    contentType: null,
    publishDate,
    aiSummary: '',
    deadline: null,
    targetAudience: '',
    coreAction: '',
    originUrl: '',
    cleanContent: '',
    attachments: [],
  }
}

describe('Favorites ordering', () => {
  beforeEach(() => {
    mocks.loadBatchNotices.mockReset()
    mocks.push.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('puts missing publication dates last and ties them by ID stably', async () => {
    mocks.loadBatchNotices.mockResolvedValue({
      items: [
        makeNotice('null-b', null),
        makeNotice('old', '2026-10-10'),
        makeNotice('new', '2026-10-20'),
        makeNotice('null-a', null),
      ],
      omittedCount: 0,
      staleFallbackCount: 0,
      failedCount: 0,
    })

    const wrapper = shallowMount(Favorites)
    await flushPromises()

    const renderedIds = wrapper
      .findAllComponents(NoticeCard)
      .map((card) => (card.props('notice') as NoticeItem).id)
    expect(renderedIds).toEqual(['new', 'old', 'null-a', 'null-b'])
  })
})
