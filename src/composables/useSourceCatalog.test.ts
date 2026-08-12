import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SOURCE_CATALOG_FALLBACK } from '../types/notice'

const mocks = vi.hoisted(() => ({
  fetchSources: vi.fn(),
}))

vi.mock('../utils/request', () => ({
  fetchSources: mocks.fetchSources,
}))

import { resetSourceCatalogStateForTests, useSourceCatalog } from './useSourceCatalog'
import { clearSourceCatalogCache } from '../utils/sourceCatalogCache'

describe('useSourceCatalog', () => {
  afterEach(async () => {
    resetSourceCatalogStateForTests()
    await clearSourceCatalogCache()
    vi.clearAllMocks()
  })

  it('shares one in-flight request between consumers', async () => {
    let resolveRequest!: (sources: typeof SOURCE_CATALOG_FALLBACK) => void
    mocks.fetchSources.mockImplementation(
      () => new Promise((resolve) => (resolveRequest = resolve)),
    )
    setActivePinia(createPinia())

    const first = useSourceCatalog()
    const second = useSourceCatalog()
    const firstLoad = first.loadSources()
    const secondLoad = second.loadSources()

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(mocks.fetchSources).toHaveBeenCalledOnce()
    resolveRequest([{ name: '教务处', group: '校级部门', noticeCount: 20 }])
    await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual([true, true])
    expect(first.sourceItems.value).toEqual([
      { name: '教务处', group: '校级部门', noticeCount: 20 },
    ])
  })

  it('uses the checked-in /sources snapshot when the API is unavailable', async () => {
    mocks.fetchSources.mockRejectedValue(new Error('network unavailable'))
    setActivePinia(createPinia())

    const catalog = useSourceCatalog()
    await expect(catalog.loadSources()).resolves.toBe(false)

    expect(catalog.sourceItems.value).toEqual(SOURCE_CATALOG_FALLBACK)
    expect(catalog.error.value).toContain('已展示内置来源')
  })

  it('does not refetch a fresh source snapshot on every page mount', async () => {
    mocks.fetchSources.mockResolvedValue([{ name: '教务处', group: '校级部门', noticeCount: 20 }])
    setActivePinia(createPinia())

    const first = useSourceCatalog()
    await first.loadSources()
    const second = useSourceCatalog()
    await second.loadSources()

    expect(mocks.fetchSources).toHaveBeenCalledOnce()
  })
})
