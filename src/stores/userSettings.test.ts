import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'
import {
  USER_SETTINGS_JOURNAL_PREFIX,
  USER_SETTINGS_SCHEMA_VERSION,
  USER_SETTINGS_STORAGE_KEY,
  useUserSettingsStore,
} from './userSettings'

type ThemeListener = (event: MediaQueryListEvent) => void

function createNotice(index: number): NoticeItem {
  return {
    id: `notice-${index}`,
    title: `Notice ${index}`,
    source: '教务处',
    publishDate: '2026-07-31',
    aiSummary: '',
    deadline: null,
    targetAudience: '全体本科生',
    coreAction: '无',
    originUrl: 'https://www.ustc.edu.cn',
    cleanContent: '',
    attachments: [],
  }
}

function storedJournalKeys(): string[] {
  return Array.from({ length: window.localStorage.length }, (_, index) =>
    window.localStorage.key(index),
  ).filter((key): key is string => Boolean(key?.startsWith(USER_SETTINGS_JOURNAL_PREFIX)))
}

function createStoredJournal(
  clientId: string,
  sequence: number,
  options: {
    dependencyClock?: Record<string, number>
    darkMode?: 'auto' | 'light' | 'dark'
  } = {},
) {
  return {
    schemaVersion: 1,
    settingsSchemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    clientId,
    dependencyClock: options.dependencyClock ?? {},
    subscriptions: [],
    blacklistKeywords: [],
    starredIds: [],
    readIds: [],
    pinnedIds: [],
    importantIds: [],
    folders: [],
    starredFolderMap: [],
    customTags: [],
    darkMode: options.darkMode ? { value: options.darkMode, sequence } : null,
    notificationEnabled: null,
  }
}

function installMatchMedia(initialMatches = false) {
  const listeners = new Set<ThemeListener>()
  const mediaQuery = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: ThemeListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: ThemeListener) =>
      listeners.delete(listener),
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mediaQuery),
  )
  return {
    mediaQuery,
    setMatches(matches: boolean) {
      Object.defineProperty(mediaQuery, 'matches', { configurable: true, value: matches })
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent)
    },
  }
}

describe('user settings store', () => {
  let store: ReturnType<typeof useUserSettingsStore> | null = null

  beforeEach(() => {
    installMatchMedia()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    store?.$dispose()
    store = null
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('migrates unversioned settings and rebuilds untrusted records safely', () => {
    window.localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        subscribedDepts: ['计算机科学与技术学院', '计算机学院', '不存在的部门'],
        starredIds: ['notice-1', 'constructor', '../invalid'],
        starredFolderMap: { 'notice-1': 'missing', constructor: 'default' },
        customTags: { 'notice-1': [' 竞赛 ', '竞赛', 42], constructor: ['安全'] },
        folders: [{ id: 'custom', name: ' 自定义 ', icon: 'mdi-star', createdAt: 2 }],
      }),
    )

    store = useUserSettingsStore()

    expect(store.subscriptionMode).toBe('custom')
    expect(store.subscribedDepts).toEqual(['计算机学院'])
    expect(store.starredIds).toEqual(['notice-1', 'constructor'])
    expect(store.starredFolderMap['notice-1']).toBe('default')
    expect(store.customTags['notice-1']).toEqual(['竞赛'])
    expect(store.customTags.constructor).toEqual(['安全'])
    expect(store.folders.map((folder) => folder.id)).toEqual(['default', 'custom'])
    expect(store.folders[1]?.icon).toBe('$star')

    expect(store.persistImmediate()).toBe(true)
    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.schemaVersion).toBe(USER_SETTINGS_SCHEMA_VERSION)
  })

  it('falls back from corrupt storage and reports the recovery', () => {
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, '{broken-json')

    store = useUserSettingsStore()

    expect(store.subscriptionMode).toBe('all')
    expect(store.starredIds).toEqual([])
    expect(store.folders[0]?.id).toBe('default')
    expect(store.persistenceError).toContain('已使用默认值')
  })

  it('keeps settings from a future schema read-only without rewriting them', () => {
    const futureSettings = JSON.stringify({
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION + 1,
      darkMode: 'dark',
      starredIds: ['future-notice'],
      futureSetting: { enabled: true },
    })
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, futureSettings)
    const setItem = vi.spyOn(window.localStorage, 'setItem')

    store = useUserSettingsStore()
    expect(store.darkMode).toBe('dark')
    expect(store.persistenceError).toContain('只读')

    store.toggleStar('local-notice')
    expect(store.starredIds).toEqual(['future-notice'])
    expect(store.persistImmediate()).toBe(false)
    store.clearPersistenceError()
    expect(store.persistenceError).toContain('只读')
    expect(store.addFolder('不能创建', '$folder')).toBeNull()
    expect(store.persistenceError).toContain('只读')
    window.dispatchEvent(new Event('beforeunload'))

    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).toBe(futureSettings)
  })

  it('reports localStorage write failures without throwing', () => {
    vi.useFakeTimers()
    store = useUserSettingsStore()
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(() => store?.toggleStar('notice-1')).not.toThrow()
    vi.advanceTimersByTime(300)

    expect(store.persistenceError).toContain('写入失败')
  })

  it('applies valid updates from another tab and ignores corrupt events', () => {
    store = useUserSettingsStore()
    const remoteSettings = {
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
      subscriptionMode: 'custom',
      subscribedDepts: ['教务处'],
      blacklistKeywords: [],
      starredIds: ['notice-2'],
      starredFolderMap: { 'notice-2': 'default' },
      readIds: ['notice-2'],
      pinnedIds: [],
      importantIds: [],
      customTags: {},
      darkMode: 'dark',
      folders: [{ id: 'default', name: '默认收藏', icon: '$star', createdAt: 0 }],
      notificationEnabled: false,
    }

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: JSON.stringify(remoteSettings),
      }),
    )

    expect(store.darkMode).toBe('dark')
    expect(store.starredIds).toEqual(['notice-2'])
    expect(store.readIds).toEqual(['notice-2'])

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: '{bad',
      }),
    )
    expect(store.starredIds).toEqual(['notice-2'])
    expect(store.persistenceError).toContain('已保留当前设置')
  })

  it('merges remote updates with local changes that are still waiting to persist', () => {
    vi.useFakeTimers()
    store = useUserSettingsStore()
    store.toggleStar('local-notice')

    const remoteSettings = {
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
      subscriptionMode: 'all',
      subscribedDepts: [],
      blacklistKeywords: ['已取消'],
      starredIds: ['remote-notice'],
      starredFolderMap: { 'remote-notice': 'default' },
      readIds: ['remote-notice'],
      pinnedIds: [],
      importantIds: [],
      customTags: {},
      darkMode: 'auto',
      folders: [{ id: 'default', name: '默认收藏', icon: '$star', createdAt: 0 }],
      notificationEnabled: false,
    }
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: JSON.stringify(remoteSettings),
      }),
    )

    expect(store.starredIds).toEqual(['remote-notice', 'local-notice'])
    expect(store.readIds).toEqual(['remote-notice'])
    expect(store.blacklistKeywords).toEqual(['已取消'])
    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.starredIds).toEqual(['remote-notice', 'local-notice'])

    vi.advanceTimersByTime(300)
    expect(store.starredIds).toEqual(['remote-notice', 'local-notice'])
  })

  it('converges when two tabs finish writing before either storage event is delivered', () => {
    const storageListeners: Array<(event: StorageEvent) => void> = []
    const originalAddEventListener = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'storage' && typeof listener === 'function') {
        storageListeners.push(listener as (event: StorageEvent) => void)
        return
      }
      originalAddEventListener(type, listener, options)
    })

    const firstStore = useUserSettingsStore(createPinia())
    const secondStore = useUserSettingsStore(createPinia())
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage)
    let forcedBaselineReads = 2
    vi.spyOn(window.localStorage, 'getItem').mockImplementation((key) => {
      if (key === USER_SETTINGS_STORAGE_KEY && forcedBaselineReads > 0) {
        forcedBaselineReads -= 1
        return null
      }
      return originalGetItem(key)
    })
    const writes: string[] = []
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      originalSetItem(key, value)
      if (key === USER_SETTINGS_STORAGE_KEY) writes.push(value)
    })

    try {
      expect(firstStore.persistImmediate()).toBe(true)
      expect(writes).toHaveLength(0)
      firstStore.toggleStar('from-first-tab')
      expect(firstStore.persistImmediate()).toBe(true)
      secondStore.togglePin('from-second-tab')
      expect(secondStore.persistImmediate()).toBe(true)
      expect(writes).toHaveLength(2)
      expect(storageListeners).toHaveLength(2)
      expect(JSON.parse(writes[0] ?? '{}').starredIds).toEqual(['from-first-tab'])
      expect(JSON.parse(writes[0] ?? '{}').pinnedIds).toEqual([])
      expect(JSON.parse(writes[1] ?? '{}').starredIds).toEqual(['from-first-tab'])
      expect(JSON.parse(writes[1] ?? '{}').pinnedIds).toEqual(['from-second-tab'])

      storageListeners[0]?.(
        new StorageEvent('storage', {
          key: USER_SETTINGS_STORAGE_KEY,
          newValue: writes[1],
        }),
      )
      storageListeners[1]?.(
        new StorageEvent('storage', {
          key: USER_SETTINGS_STORAGE_KEY,
          newValue: writes[0],
        }),
      )

      expect(firstStore.starredIds).toEqual(['from-first-tab'])
      expect(firstStore.pinnedIds).toEqual(['from-second-tab'])
      expect(secondStore.starredIds).toEqual(['from-first-tab'])
      expect(secondStore.pinnedIds).toEqual(['from-second-tab'])
      const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
      expect(persisted.starredIds).toEqual(['from-first-tab'])
      expect(persisted.pinnedIds).toEqual(['from-second-tab'])

      const acknowledgedWriteCount = writes.length
      expect(firstStore.persistImmediate()).toBe(true)
      expect(secondStore.persistImmediate()).toBe(true)
      expect(writes).toHaveLength(acknowledgedWriteCount)
    } finally {
      firstStore.$dispose()
      secondStore.$dispose()
    }
  })

  it('recovers an overwritten concurrent write after both tabs close without storage events', () => {
    const firstStore = useUserSettingsStore(createPinia())
    const secondStore = useUserSettingsStore(createPinia())

    firstStore.toggleStar('from-closed-first-tab')
    expect(firstStore.persistImmediate()).toBe(true)
    const staleFirstSnapshot = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)

    secondStore.togglePin('from-closed-second-tab')
    expect(secondStore.persistImmediate()).toBe(true)
    expect(
      JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({
      starredIds: ['from-closed-first-tab'],
      pinnedIds: ['from-closed-second-tab'],
    })

    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, staleFirstSnapshot ?? '')
    firstStore.$dispose()
    secondStore.$dispose()

    const journalKeys = storedJournalKeys()
    expect(journalKeys.length).toBeGreaterThan(0)

    store = useUserSettingsStore(createPinia())
    expect(store.starredIds).toContain('from-closed-first-tab')
    expect(store.pinnedIds).toContain('from-closed-second-tab')
    const recovered = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(recovered.starredIds).toContain('from-closed-first-tab')
    expect(recovered.pinnedIds).toContain('from-closed-second-tab')
  })

  it('does not replay an acknowledged addition when a later local change is journaled', () => {
    store = useUserSettingsStore()
    store.toggleStar('acknowledged-before-delete')
    expect(store.persistImmediate()).toBe(true)
    const firstJournalKey = storedJournalKeys()[0]

    const firstSnapshot = JSON.parse(
      window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}',
    ) as Record<string, unknown>
    const localClientId = Object.keys(firstSnapshot.syncClock as Record<string, number>)[0]
    const remoteDeletion = {
      ...firstSnapshot,
      syncClock: {
        ...(firstSnapshot.syncClock as Record<string, number>),
        'remote-client': 1,
      },
      syncWriter: 'remote-client',
      starredIds: [],
      starredFolderMap: {},
    }
    expect(localClientId).toBeTruthy()
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(remoteDeletion))

    store.togglePin('later-local-pin')
    expect(store.persistImmediate()).toBe(true)

    expect(store.starredIds).not.toContain('acknowledged-before-delete')
    expect(store.pinnedIds).toContain('later-local-pin')
    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.starredIds).not.toContain('acknowledged-before-delete')
    expect(persisted.pinnedIds).toContain('later-local-pin')
    expect(firstJournalKey).toBeTruthy()
    expect(window.localStorage.getItem(firstJournalKey ?? '')).toBeNull()
    expect(storedJournalKeys()).toHaveLength(1)
  })

  it('does not revive an acknowledged deletion after a stale snapshot overwrites mixed pending work', () => {
    vi.useFakeTimers()
    store = useUserSettingsStore()
    store.toggleStar('deleted-before-stale-overwrite')
    expect(store.persistImmediate()).toBe(true)
    const acknowledgedSnapshot = JSON.parse(
      window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}',
    ) as Record<string, unknown>

    store.togglePin('unrelated-pending-pin')
    const remoteDeletion = {
      ...acknowledgedSnapshot,
      syncClock: {
        ...(acknowledgedSnapshot.syncClock as Record<string, number>),
        'remote-delete-client': 1,
      },
      syncWriter: 'remote-delete-client',
      starredIds: [],
      starredFolderMap: {},
    }
    const remoteValue = JSON.stringify(remoteDeletion)
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, remoteValue)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: remoteValue,
      }),
    )

    expect(store.starredIds).not.toContain('deleted-before-stale-overwrite')
    expect(store.pinnedIds).toContain('unrelated-pending-pin')

    window.localStorage.removeItem(USER_SETTINGS_STORAGE_KEY)
    store.$dispose()
    setActivePinia(createPinia())
    store = useUserSettingsStore()

    expect(store.starredIds).not.toContain('deleted-before-stale-overwrite')
    expect(store.pinnedIds).toContain('unrelated-pending-pin')
  })

  it('checkpoints and removes exact journals only while holding the shared Web Lock', async () => {
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      await Promise.resolve()
      return callback()
    })
    vi.stubGlobal('navigator', {
      ...window.navigator,
      locks: { request },
    })
    store = useUserSettingsStore()

    store.toggleStar('locked-checkpoint')
    expect(store.persistImmediate()).toBe(true)
    expect(storedJournalKeys()).toHaveLength(1)

    await vi.waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
      expect(persisted.starredIds).toContain('locked-checkpoint')
      expect(storedJournalKeys()).toHaveLength(0)
    })
    expect(request).toHaveBeenCalledWith('notifai-user-settings-writer', expect.any(Function))
  })

  it('carries a superior repair candidate into the deferred Web Lock checkpoint', async () => {
    let releaseLock: () => void = () => undefined
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      await lockGate
      return callback()
    })
    vi.stubGlobal('navigator', {
      ...window.navigator,
      locks: { request },
    })
    const current = {
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
      syncClock: { 'a-client': 2 },
      syncWriter: 'a-client',
      darkMode: 'dark',
    }
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(current))
    store = useUserSettingsStore()
    const stale = {
      ...current,
      syncClock: { 'a-client': 1 },
      darkMode: 'light',
    }
    const staleValue = JSON.stringify(stale)
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, staleValue)

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: staleValue,
      }),
    )
    expect(store.darkMode).toBe('dark')
    expect(request).toHaveBeenCalledOnce()

    releaseLock()
    await vi.waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
      expect(persisted.darkMode).toBe('dark')
      expect(persisted.syncClock).toEqual({ 'a-client': 2 })
      expect(persisted.syncWriter).toBe('a-client')
      expect(store?.darkMode).toBe('dark')
    })
  })

  it('merges an incomparable candidate into the snapshot committed by the current lock holder', async () => {
    let releaseLock: () => void = () => undefined
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      await lockGate
      return callback()
    })
    vi.stubGlobal('navigator', {
      ...window.navigator,
      locks: { request },
    })
    store = useUserSettingsStore()
    store.toggleStar('candidate-star')
    expect(store.persistImmediate()).toBe(true)
    expect(request).toHaveBeenCalledOnce()

    window.localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
        syncClock: { 'b-client': 1 },
        syncWriter: 'b-client',
        pinnedIds: ['must-survive-lock'],
      }),
    )
    releaseLock()

    await vi.waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
      expect(persisted.starredIds).toContain('candidate-star')
      expect(persisted.pinnedIds).toContain('must-survive-lock')
      expect(persisted.syncClock['b-client']).toBe(1)
      expect(store?.starredIds).toContain('candidate-star')
      expect(store?.pinnedIds).toContain('must-survive-lock')
    })
  })

  it('includes a second candidate queued while the Web Lock request is waiting', async () => {
    let releaseLock: () => void = () => undefined
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      await lockGate
      return callback()
    })
    vi.stubGlobal('navigator', {
      ...window.navigator,
      locks: { request },
    })
    store = useUserSettingsStore()

    store.toggleStar('first-waiting-candidate')
    expect(store.persistImmediate()).toBe(true)
    store.togglePin('second-waiting-candidate')
    expect(store.persistImmediate()).toBe(true)
    expect(request).toHaveBeenCalledOnce()
    releaseLock()

    await vi.waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
      expect(persisted.starredIds).toContain('first-waiting-candidate')
      expect(persisted.pinnedIds).toContain('second-waiting-candidate')
      expect(storedJournalKeys()).toHaveLength(0)
    })
  })

  it('retains acknowledged journals when a future journal appears before checkpoint cleanup', async () => {
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback())
    vi.stubGlobal('navigator', {
      ...window.navigator,
      locks: { request },
    })
    const futureKey = `${USER_SETTINGS_STORAGE_KEY}:journal:2:future-during-cleanup:1`
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage)
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    let mainWritten = false
    let futureInjected = false
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      originalSetItem(key, value)
      if (key === USER_SETTINGS_STORAGE_KEY) mainWritten = true
    })
    vi.spyOn(window.localStorage, 'getItem').mockImplementation((key) => {
      const value = originalGetItem(key)
      if (key === USER_SETTINGS_STORAGE_KEY && mainWritten && !futureInjected) {
        futureInjected = true
        originalSetItem(futureKey, JSON.stringify({ schemaVersion: 2 }))
      }
      return value
    })
    store = useUserSettingsStore()

    store.toggleStar('journal-must-survive')
    expect(store.persistImmediate()).toBe(true)

    await vi.waitFor(() => {
      expect(futureInjected).toBe(true)
      expect(store?.persistenceError).toContain('只读')
      expect(storedJournalKeys()).toHaveLength(1)
      expect(window.localStorage.getItem(futureKey)).not.toBeNull()
    })
  })

  it('preserves the logical writer when relaying an equal-clock winner', () => {
    const winner = {
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
      syncClock: { 'source-client': 1 },
      syncWriter: 'z-winner',
      darkMode: 'dark',
    }
    const loser = {
      ...winner,
      syncWriter: 'y-loser',
      darkMode: 'light',
    }
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(winner))
    store = useUserSettingsStore()
    const loserValue = JSON.stringify(loser)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, loserValue)
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: USER_SETTINGS_STORAGE_KEY,
          newValue: loserValue,
        }),
      )
    }

    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(store.darkMode).toBe('dark')
    expect(persisted.darkMode).toBe('dark')
    expect(persisted.syncWriter).toBe('z-winner')
  })

  it('replaces superseded local journal keys without weakening stale-snapshot recovery', () => {
    store = useUserSettingsStore()
    for (let index = 0; index < 20; index += 1) {
      store.togglePin(`compacted-${index}`)
      expect(store.persistImmediate()).toBe(true)
      expect(storedJournalKeys()).toHaveLength(1)
    }

    window.localStorage.removeItem(USER_SETTINGS_STORAGE_KEY)
    store.$dispose()
    setActivePinia(createPinia())
    store = useUserSettingsStore()

    expect(store.pinnedIds).toEqual(Array.from({ length: 20 }, (_, index) => `compacted-${index}`))
  })

  it('retries cleanup when removing a superseded local journal fails', () => {
    store = useUserSettingsStore()
    store.togglePin('cleanup-0')
    expect(store.persistImmediate()).toBe(true)
    const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage)
    let failNextJournalRemoval = false
    vi.spyOn(window.localStorage, 'removeItem').mockImplementation((key) => {
      if (failNextJournalRemoval && key.startsWith(USER_SETTINGS_JOURNAL_PREFIX)) {
        failNextJournalRemoval = false
        throw new DOMException('transient removal failure', 'UnknownError')
      }
      originalRemoveItem(key)
    })

    for (let index = 1; index < 6; index += 1) {
      failNextJournalRemoval = true
      store.togglePin(`cleanup-${index}`)
      expect(store.persistImmediate()).toBe(true)
      expect(storedJournalKeys()).toHaveLength(2)
      expect(store.persistImmediate()).toBe(true)
      expect(storedJournalKeys()).toHaveLength(1)
    }

    window.localStorage.removeItem(USER_SETTINGS_STORAGE_KEY)
    store.$dispose()
    setActivePinia(createPinia())
    store = useUserSettingsStore()
    expect(store.pinnedIds).toEqual(Array.from({ length: 6 }, (_, index) => `cleanup-${index}`))
  })

  it('keeps the previous journal until its replacement passes an exact readback', () => {
    store = useUserSettingsStore()
    store.togglePin('before-readback-failure')
    expect(store.persistImmediate()).toBe(true)
    const previousKey = storedJournalKeys()[0]
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage)
    let failReplacementReadback = true
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation((key) => {
      const value = originalGetItem(key)
      if (
        failReplacementReadback &&
        key.startsWith(USER_SETTINGS_JOURNAL_PREFIX) &&
        key !== previousKey &&
        value !== null
      ) {
        failReplacementReadback = false
        return null
      }
      return value
    })

    store.togglePin('after-readback-failure')
    expect(store.persistImmediate()).toBe(false)
    expect(window.localStorage.getItem(previousKey ?? '')).not.toBeNull()

    getItem.mockRestore()
    expect(store.persistImmediate()).toBe(true)
    expect(window.localStorage.getItem(previousKey ?? '')).toBeNull()
    expect(storedJournalKeys()).toHaveLength(1)
  })

  it('keeps future journal schemas globally read-only without writes or cleanup', () => {
    window.localStorage.setItem(
      `${USER_SETTINGS_STORAGE_KEY}:journal:2:future-client:1`,
      JSON.stringify({ schemaVersion: 2, clientId: 'future-client' }),
    )
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const removeItem = vi.spyOn(window.localStorage, 'removeItem')

    store = useUserSettingsStore()
    store.toggleStar('must-not-write')

    expect(store.persistImmediate()).toBe(false)
    expect(store.starredIds).toEqual([])
    expect(store.persistenceError).toContain('只读')
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('detects a future journal event before flushing a pending local change', () => {
    vi.useFakeTimers()
    store = useUserSettingsStore()
    store.toggleStar('pending-before-future')
    const futureKey = `${USER_SETTINGS_STORAGE_KEY}:journal:2:future-client:1`
    const futureValue = JSON.stringify({ schemaVersion: 2, clientId: 'future-client' })
    window.localStorage.setItem(futureKey, futureValue)
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const removeItem = vi.spyOn(window.localStorage, 'removeItem')

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: futureKey,
        newValue: futureValue,
      }),
    )

    expect(store.starredIds).toEqual([])
    expect(store.persistenceError).toContain('只读')
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('detects future journals before repairing a corrupt main-storage event', () => {
    vi.useFakeTimers()
    store = useUserSettingsStore()
    store.toggleStar('pending-before-corrupt-event')
    const futureKey = `${USER_SETTINGS_STORAGE_KEY}:journal:2:future-before-repair:1`
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    originalSetItem(futureKey, JSON.stringify({ schemaVersion: 2 }))
    originalSetItem(USER_SETTINGS_STORAGE_KEY, '{corrupt')
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const removeItem = vi.spyOn(window.localStorage, 'removeItem')

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: '{corrupt',
      }),
    )

    expect(store.starredIds).toEqual([])
    expect(store.persistenceError).toContain('只读')
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('isolates malformed journal namespace keys without entering future-schema read-only mode', () => {
    const malformedKey = `${USER_SETTINGS_STORAGE_KEY}:journal:not-a-version:client:1`
    window.localStorage.setItem(malformedKey, '{}')

    store = useUserSettingsStore()
    store.toggleStar('valid-alongside-malformed-key')

    expect(store.persistImmediate()).toBe(true)
    expect(store.starredIds).toContain('valid-alongside-malformed-key')
    expect(store.persistenceError).toContain('损坏')
    expect(window.localStorage.getItem(malformedKey)).toBe('{}')
  })

  it('compacts the local journal while preserving malformed journal keys', () => {
    const malformedKey = `${USER_SETTINGS_JOURNAL_PREFIX}damaged-client:1`
    window.localStorage.setItem(malformedKey, '{bad')
    store = useUserSettingsStore()

    for (let index = 0; index < 5; index += 1) {
      store.togglePin(`beside-malformed-${index}`)
      expect(store.persistImmediate()).toBe(true)
    }

    expect(window.localStorage.getItem(malformedKey)).toBe('{bad')
    expect(storedJournalKeys().filter((key) => key !== malformedKey)).toHaveLength(1)
    expect(store.persistenceError).toContain('损坏')
  })

  it('replays causally dependent journals after their dependencies regardless of key order', () => {
    const causeClient = 'z-cause-client'
    const effectClient = 'a-effect-client'
    window.localStorage.setItem(
      `${USER_SETTINGS_JOURNAL_PREFIX}${causeClient}:1`,
      JSON.stringify(createStoredJournal(causeClient, 1, { darkMode: 'dark' })),
    )
    window.localStorage.setItem(
      `${USER_SETTINGS_JOURNAL_PREFIX}${effectClient}:1`,
      JSON.stringify(
        createStoredJournal(effectClient, 1, {
          dependencyClock: { [causeClient]: 1 },
          darkMode: 'light',
        }),
      ),
    )

    store = useUserSettingsStore()

    expect(store.darkMode).toBe('light')
    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.darkMode).toBe('light')
    expect(persisted.syncClock[causeClient]).toBe(1)
    expect(persisted.syncClock[effectClient]).toBe(1)
  })

  it('retains a journal whose causal dependency is missing', () => {
    const clientId = 'dependent-client'
    const journalKey = `${USER_SETTINGS_JOURNAL_PREFIX}${clientId}:1`
    window.localStorage.setItem(
      journalKey,
      JSON.stringify(
        createStoredJournal(clientId, 1, {
          dependencyClock: { 'missing-client': 1 },
          darkMode: 'dark',
        }),
      ),
    )

    store = useUserSettingsStore()

    expect(store.darkMode).toBe('dark')
    expect(store.persistenceError).toContain('依赖不完整')
    expect(window.localStorage.getItem(journalKey)).not.toBeNull()
    expect(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).toBeNull()

    store.$dispose()
    window.localStorage.setItem(
      `${USER_SETTINGS_JOURNAL_PREFIX}missing-client:1`,
      JSON.stringify({
        ...createStoredJournal('missing-client', 1),
        starredIds: [{ item: 'late-cause', present: true, sequence: 1 }],
      }),
    )
    setActivePinia(createPinia())
    store = useUserSettingsStore()

    expect(store.starredIds).toContain('late-cause')
    expect(store.darkMode).toBe('dark')
    expect(store.persistenceError).toBe('')
  })

  it('preserves damaged journals and disables garbage collection', () => {
    const damagedKey = `${USER_SETTINGS_JOURNAL_PREFIX}damaged-client:1`
    window.localStorage.setItem(damagedKey, '{bad')
    const removeItem = vi.spyOn(window.localStorage, 'removeItem')

    store = useUserSettingsStore()
    store.togglePin('saved-beside-damaged-journal')
    expect(store.persistImmediate()).toBe(true)

    expect(window.localStorage.getItem(damagedKey)).toBe('{bad')
    expect(removeItem).not.toHaveBeenCalledWith(damagedKey)
    expect(store.persistenceError).toContain('损坏')
  })

  it('does not let malformed journal keys starve a valid recovery record', () => {
    for (let index = 0; index < 1_000; index += 1) {
      window.localStorage.setItem(
        `${USER_SETTINGS_JOURNAL_PREFIX}malformed-${index}:not-a-sequence`,
        '{}',
      )
    }
    const clientId = 'valid-recovery-client'
    const validJournal = {
      ...createStoredJournal(clientId, 1),
      starredIds: [{ item: 'valid-after-malformed-keys', present: true, sequence: 1 }],
    }
    window.localStorage.setItem(
      `${USER_SETTINGS_JOURNAL_PREFIX}${clientId}:1`,
      JSON.stringify(validJournal),
    )

    store = useUserSettingsStore()

    expect(store.starredIds).toContain('valid-after-malformed-keys')
    expect(store.persistenceError).toContain('损坏')
  })

  it('fails closed when the journal record limit is already full', () => {
    store = useUserSettingsStore()
    for (let index = 0; index < 10_000; index += 1) {
      const clientId = `cap-client-${index}`
      window.localStorage.setItem(
        `${USER_SETTINGS_JOURNAL_PREFIX}${clientId}:1`,
        JSON.stringify(createStoredJournal(clientId, 1, { darkMode: 'dark' })),
      )
    }
    const setItem = vi.spyOn(window.localStorage, 'setItem')

    store.togglePin('must-not-write-past-journal-cap')
    expect(store.persistImmediate()).toBe(false)

    expect(setItem).not.toHaveBeenCalled()
    expect(storedJournalKeys()).toHaveLength(10_000)
    expect(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).toBeNull()
    expect(store.persistenceError).toContain('写入失败')
  }, 20_000)

  it('merges concurrent department removals from the subscribe-all state', () => {
    const storageListeners: Array<(event: StorageEvent) => void> = []
    const originalAddEventListener = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'storage' && typeof listener === 'function') {
        storageListeners.push(listener as (event: StorageEvent) => void)
        return
      }
      originalAddEventListener(type, listener, options)
    })

    const firstStore = useUserSettingsStore(createPinia())
    const secondStore = useUserSettingsStore(createPinia())
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage)
    let forcedBaselineReads = 2
    vi.spyOn(window.localStorage, 'getItem').mockImplementation((key) => {
      if (key === USER_SETTINGS_STORAGE_KEY && forcedBaselineReads > 0) {
        forcedBaselineReads -= 1
        return null
      }
      return originalGetItem(key)
    })
    const writes: string[] = []
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      originalSetItem(key, value)
      if (key === USER_SETTINGS_STORAGE_KEY) writes.push(value)
    })

    try {
      firstStore.toggleDepartment('教务处')
      expect(firstStore.persistImmediate()).toBe(true)
      secondStore.toggleDepartment('本科生院')
      expect(secondStore.persistImmediate()).toBe(true)

      storageListeners[0]?.(
        new StorageEvent('storage', {
          key: USER_SETTINGS_STORAGE_KEY,
          newValue: writes[1],
        }),
      )
      storageListeners[1]?.(
        new StorageEvent('storage', {
          key: USER_SETTINGS_STORAGE_KEY,
          newValue: writes[0],
        }),
      )

      expect(firstStore.isSubscribed('教务处')).toBe(false)
      expect(firstStore.isSubscribed('本科生院')).toBe(false)
      expect(secondStore.isSubscribed('教务处')).toBe(false)
      expect(secondStore.isSubscribed('本科生院')).toBe(false)
      const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
      expect(persisted.subscribedDepts).not.toContain('教务处')
      expect(persisted.subscribedDepts).not.toContain('本科生院')
    } finally {
      firstStore.$dispose()
      secondStore.$dispose()
    }
  })

  it('does not revive a remotely deleted item after compacting pending local writes', () => {
    store = useUserSettingsStore()
    store.togglePin('local-pin')
    expect(store.persistImmediate()).toBe(true)

    const remoteWithStar = JSON.stringify({
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
      syncClock: { 'remote-client': 1 },
      syncWriter: 'remote-client',
      starredIds: ['remote-star'],
      starredFolderMap: { 'remote-star': 'default' },
    })
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, remoteWithStar)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: remoteWithStar,
      }),
    )
    expect(store.starredIds).toContain('remote-star')

    store.toggleImportant('local-important')
    expect(store.persistImmediate()).toBe(true)

    const remoteDeletion = JSON.stringify({
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
      syncClock: { 'remote-client': 2 },
      syncWriter: 'remote-client',
      starredIds: [],
      starredFolderMap: {},
    })
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, remoteDeletion)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: remoteDeletion,
      }),
    )

    expect(store.starredIds).not.toContain('remote-star')
    expect(store.pinnedIds).toContain('local-pin')
    expect(store.importantIds).toContain('local-important')
    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.starredIds).not.toContain('remote-star')
  })

  it('persists a local removal that supersedes an unacknowledged local addition', () => {
    store = useUserSettingsStore()
    store.toggleStar('add-then-remove')
    expect(store.persistImmediate()).toBe(true)
    expect(store.starredIds).toContain('add-then-remove')

    store.toggleStar('add-then-remove')
    expect(store.persistImmediate()).toBe(true)

    expect(store.starredIds).not.toContain('add-then-remove')
    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.starredIds).not.toContain('add-then-remove')
  })

  it('compacts add-then-remove intent for keywords, tags, and folders', () => {
    store = useUserSettingsStore()

    store.addKeyword('temporary-keyword')
    expect(store.persistImmediate()).toBe(true)
    store.removeKeyword('temporary-keyword')
    expect(store.persistImmediate()).toBe(true)

    store.addCustomTag('notice-1', 'temporary-tag')
    expect(store.persistImmediate()).toBe(true)
    store.removeCustomTag('notice-1', 'temporary-tag')
    expect(store.persistImmediate()).toBe(true)

    const folder = store.addFolder('Temporary', '$folder')
    expect(folder).not.toBeNull()
    expect(store.persistImmediate()).toBe(true)
    if (folder) store.removeFolder(folder.id)
    expect(store.persistImmediate()).toBe(true)

    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.blacklistKeywords).not.toContain('temporary-keyword')
    expect(persisted.customTags['notice-1']).toBeUndefined()
    expect(persisted.folders.map((item: { id: string }) => item.id)).not.toContain(folder?.id)
  })

  it('keeps pending replay work bounded across repeated storage failures', () => {
    store = useUserSettingsStore()
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    for (let index = 0; index < 20; index += 1) {
      store.toggleStar(`failed-write-${index}`)
      expect(store.persistImmediate()).toBe(false)
    }

    setItem.mockImplementation(originalSetItem)
    const stringify = vi.spyOn(JSON, 'stringify')
    expect(store.persistImmediate()).toBe(true)

    expect(stringify.mock.calls.length).toBeLessThan(20)
    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.starredIds).toHaveLength(20)
  })

  it('repairs corrupt cross-tab storage so settings survive a reload', () => {
    store = useUserSettingsStore()
    store.toggleStar('survives-corruption')
    expect(store.persistImmediate()).toBe(true)

    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, '{bad')
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: '{bad',
      }),
    )

    const repaired = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(repaired.starredIds).toContain('survives-corruption')
    expect(store.persistenceError).toContain('已保留当前设置并修复')

    store.$dispose()
    setActivePinia(createPinia())
    store = useUserSettingsStore()
    expect(store.starredIds).toContain('survives-corruption')
  })

  it('replays compacted local writes when a remote tab only observed the first sequence', () => {
    store = useUserSettingsStore()
    store.toggleStar('local-star')
    expect(store.persistImmediate()).toBe(true)
    const firstWrite = JSON.parse(
      window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}',
    ) as Record<string, unknown>

    store.togglePin('local-pin')
    expect(store.persistImmediate()).toBe(true)
    store.markRead('local-read')
    expect(store.persistImmediate()).toBe(true)

    const remoteSettings = {
      ...firstWrite,
      syncClock: {
        ...(firstWrite.syncClock as Record<string, number>),
        'remote-client': 1,
      },
      syncWriter: 'remote-client',
      importantIds: ['remote-important'],
    }
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: USER_SETTINGS_STORAGE_KEY,
        newValue: JSON.stringify(remoteSettings),
      }),
    )

    expect(store.starredIds).toContain('local-star')
    expect(store.pinnedIds).toContain('local-pin')
    expect(store.readIds).toContain('local-read')
    expect(store.importantIds).toContain('remote-important')
  })

  it('reacts to operating-system theme changes in auto mode', () => {
    const theme = installMatchMedia(false)
    store = useUserSettingsStore()

    expect(store.isDark).toBe(false)
    theme.setMatches(true)
    expect(store.isDark).toBe(true)

    store.setDarkMode('light')
    expect(store.isDark).toBe(false)
    expect(theme.mediaQuery.removeEventListener).not.toHaveBeenCalled()
  })

  it('preserves subscription and folder invariants during mutations', () => {
    store = useUserSettingsStore()
    store.toggleDepartment('教务处')

    expect(store.subscriptionMode).toBe('custom')
    expect(store.subscribedDepts).not.toContain('教务处')
    const subscribedBeforeInvalidToggle = [...store.subscribedDepts]
    store.toggleDepartment('不存在的部门')
    expect(store.subscribedDepts).toEqual(subscribedBeforeInvalidToggle)

    const folder = store.addFolder('竞赛', '$folder')
    expect(folder).not.toBeNull()
    if (!folder) throw new Error('收藏夹创建失败')
    store.moveToFolder('notice-3', folder.id)
    expect(store.getStarredInFolder(folder.id)).toEqual(['notice-3'])

    store.removeFolder(folder.id)
    expect(store.starredFolderMap['notice-3']).toBe('default')
  })

  it('does not add more than 100 folders', () => {
    store = useUserSettingsStore()
    const remainingCapacity = 100 - store.folders.length
    for (let index = 0; index < remainingCapacity; index += 1) {
      expect(store.addFolder(`folder-${index}`, '$folder')).not.toBeNull()
    }

    expect(store.folders).toHaveLength(100)
    expect(store.addFolder('overflow', '$folder')).toBeNull()
    expect(store.folders).toHaveLength(100)
    expect(store.persistImmediate()).toBe(true)

    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.folders).toHaveLength(100)
  })

  it('creates collision-resistant folder ids across tabs in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_785_528_000_000)
    const firstStore = useUserSettingsStore(createPinia())
    const secondStore = useUserSettingsStore(createPinia())

    try {
      const firstFolder = firstStore.addFolder('First', '$folder')
      const secondFolder = secondStore.addFolder('Second', '$folder')

      expect(firstFolder).not.toBeNull()
      expect(secondFolder).not.toBeNull()
      expect(firstFolder?.createdAt).toBe(secondFolder?.createdAt)
      expect(firstFolder?.id).not.toBe(secondFolder?.id)
    } finally {
      firstStore.$dispose()
      secondStore.$dispose()
    }
  })

  it('keeps the default folder within the 100-folder limit when stored data omits it', () => {
    window.localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
        folders: Array.from({ length: 100 }, (_, index) => ({
          id: `folder-${index}`,
          name: `Folder ${index}`,
          icon: '$folder',
          createdAt: index + 1,
        })),
      }),
    )

    store = useUserSettingsStore()

    expect(store.folders).toHaveLength(100)
    expect(store.folders[0]?.id).toBe('default')
    expect(store.folders.some((folder) => folder.id === 'folder-99')).toBe(false)
  })

  it('retains the current writer when pruning a full synchronization clock', () => {
    const syncClock = Object.fromEntries(
      Array.from({ length: 1_001 }, (_, index) => [`client-${index}`, 1]),
    )
    window.localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
        syncClock,
        syncWriter: 'client-1000',
      }),
    )

    store = useUserSettingsStore()
    store.toggleStar('clock-test')
    expect(store.persistImmediate()).toBe(true)

    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(Object.keys(persisted.syncClock)).toHaveLength(1_000)
    expect(Object.hasOwn(persisted.syncClock, persisted.syncWriter)).toBe(true)
    expect(Object.hasOwn(persisted.syncClock, 'client-0')).toBe(false)
  })

  it('keeps at most 500 cached notices and refreshes recency on access', () => {
    store = useUserSettingsStore()
    for (let index = 0; index < 500; index += 1) store.cacheNotice(createNotice(index))

    expect(store.getCachedNotice('notice-0')?.id).toBe('notice-0')
    store.cacheNotice(createNotice(500))

    expect(store.noticeCache.size).toBe(500)
    expect(store.getCachedNotice('notice-0')?.id).toBe('notice-0')
    expect(store.getCachedNotice('notice-1')).toBeUndefined()
    expect(store.getCachedNotice('notice-500')?.id).toBe('notice-500')
  })

  it('keeps the newest read id when the bounded history reaches capacity', () => {
    vi.useFakeTimers()
    store = useUserSettingsStore()
    for (let index = 0; index <= 10_000; index += 1) store.markRead(`read-${index}`)
    expect(store.persistImmediate()).toBe(true)

    expect(store.readIds).toHaveLength(10_000)
    expect(store.readIds).not.toContain('read-0')
    expect(store.readIds).toContain('read-10000')
    const persisted = JSON.parse(window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? '{}')
    expect(persisted.readIds).not.toContain('read-0')
    expect(persisted.readIds).toContain('read-10000')
  })

  it('caches the full notice object for cross-page reuse', () => {
    store = useUserSettingsStore()
    const detail = {
      ...createNotice(1),
      targetAudience: '全体学生',
      coreAction: '查看通知',
      originUrl: 'https://www.ustc.edu.cn/notices/1',
      cleanContent: 'x'.repeat(500_000),
      attachments: [{ name: '附件', url: 'https://www.ustc.edu.cn/file.pdf' }],
    }

    store.cacheNotice(detail)

    const cached = store.getCachedNotice(detail.id)
    expect(cached).toEqual(detail)
    expect(cached).toHaveProperty('cleanContent')
    expect(cached).toHaveProperty('attachments')
  })
})
