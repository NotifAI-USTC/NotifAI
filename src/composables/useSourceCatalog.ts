import { ref } from 'vue'
import { useUserSettingsStore } from '../stores/userSettings'
import type { SourceItem } from '../types/notice'
import { SOURCE_CATALOG_FALLBACK } from '../types/notice'
import { fetchSources } from '../utils/request'
import {
  readSourceCatalogCache,
  SOURCE_CATALOG_CACHE_MAX_AGE_MS,
  writeSourceCatalogCache,
} from '../utils/sourceCatalogCache'

type SourceCatalogOrigin = 'fallback' | 'cache' | 'network'

const SOURCE_REQUEST_COOLDOWN_MS = 5 * 60 * 1000

function cloneSources(sources: readonly SourceItem[]): SourceItem[] {
  return sources.map((source) => ({ ...source }))
}

// These refs intentionally live at module scope. Advanced search, onboarding
// and subscription settings must share one source snapshot and one request.
const sourceItems = ref<SourceItem[]>(cloneSources(SOURCE_CATALOG_FALLBACK))
const loading = ref(false)
const error = ref('')
const origin = ref<SourceCatalogOrigin>('fallback')

let sourceCacheHydrated = false
let cachedFetchedAt = 0
let lastNetworkSuccessAt = 0
let lastRequestAttemptAt = 0
let loadPromise: Promise<boolean> | null = null
let activeController: AbortController | null = null

function syncSourcesToStore(store: ReturnType<typeof useUserSettingsStore>): void {
  const names = sourceItems.value.map((source) => source.name)
  if (origin.value !== 'network') {
    // Fallback and persisted snapshots are useful for rendering, but neither
    // is fresh enough to prove that a saved dynamic source disappeared.
    store.registerSources(names)
    return
  }
  store.replaceAvailableSources(names)
}

// Keep the timestamp separate from the displayed items; a zero-length but
// valid source response must still be treated as a cache snapshot.
let cacheFetchedAtIso = ''

async function loadCatalog(
  store: ReturnType<typeof useUserSettingsStore>,
  force: boolean,
): Promise<boolean> {
  const now = Date.now()
  if (!force) {
    if (lastNetworkSuccessAt > 0 && now - lastNetworkSuccessAt < SOURCE_CATALOG_CACHE_MAX_AGE_MS) {
      return true
    }
    if (
      sourceCacheHydrated &&
      cachedFetchedAt > 0 &&
      now - cachedFetchedAt < SOURCE_CATALOG_CACHE_MAX_AGE_MS
    ) {
      return true
    }
    if (lastRequestAttemptAt > 0 && now - lastRequestAttemptAt < SOURCE_REQUEST_COOLDOWN_MS) {
      return false
    }
  }

  loading.value = true
  error.value = ''
  lastRequestAttemptAt = now

  try {
    if (!sourceCacheHydrated) {
      sourceCacheHydrated = true
      const cached = await readSourceCatalogCache()
      if (cached) {
        cacheFetchedAtIso = cached.fetchedAt
        cachedFetchedAt = Date.parse(cached.fetchedAt)
        sourceItems.value = cloneSources(cached.items)
        origin.value = 'cache'
        syncSourcesToStore(store)
      }
    }

    const cachedIsFresh =
      origin.value === 'cache' &&
      cachedFetchedAt > 0 &&
      Date.now() - cachedFetchedAt < SOURCE_CATALOG_CACHE_MAX_AGE_MS
    if (!force && (lastNetworkSuccessAt > 0 || cachedIsFresh)) return true

    const controller = new AbortController()
    activeController = controller
    const loadedSources = await fetchSources(controller.signal)
    if (controller.signal.aborted) return false

    sourceItems.value = cloneSources(loadedSources)
    origin.value = 'network'
    lastNetworkSuccessAt = Date.now()
    cacheFetchedAtIso = new Date(lastNetworkSuccessAt).toISOString()
    cachedFetchedAt = lastNetworkSuccessAt
    syncSourcesToStore(store)
    void writeSourceCatalogCache({ items: loadedSources, fetchedAt: cacheFetchedAtIso })
    return true
  } catch (requestError) {
    if (
      requestError instanceof Error &&
      (requestError.name === 'AbortError' || activeController?.signal.aborted)
    ) {
      return false
    }

    // Keep either the persisted snapshot or the checked-in /sources snapshot;
    // a failed refresh must never turn a valid directory into an empty list.
    syncSourcesToStore(store)
    const fallbackLabel = origin.value === 'cache' ? '缓存来源' : '内置来源'
    error.value =
      requestError instanceof Error
        ? `${requestError.message}，已展示${fallbackLabel}`
        : `来源列表加载失败，已展示${fallbackLabel}`
    return false
  } finally {
    activeController = null
    loading.value = false
  }
}

export function useSourceCatalog() {
  const store = useUserSettingsStore()
  // Make the static snapshot available to the settings whitelist immediately,
  // before the asynchronous cache/API step completes.
  syncSourcesToStore(store)

  async function loadSources(force = false): Promise<boolean> {
    if (loadPromise) return loadPromise

    const promise = loadCatalog(store, force)
    loadPromise = promise
    void promise.then(
      () => {
        if (loadPromise === promise) loadPromise = null
      },
      () => {
        if (loadPromise === promise) loadPromise = null
      },
    )
    return promise
  }

  return {
    sourceItems,
    loading,
    error,
    origin,
    loadSources,
  }
}

/** Reset only the module singleton; intended for isolated unit tests. */
export function resetSourceCatalogStateForTests(): void {
  activeController?.abort()
  activeController = null
  loadPromise = null
  sourceCacheHydrated = false
  cachedFetchedAt = 0
  cacheFetchedAtIso = ''
  lastNetworkSuccessAt = 0
  lastRequestAttemptAt = 0
  sourceItems.value = cloneSources(SOURCE_CATALOG_FALLBACK)
  loading.value = false
  error.value = ''
  origin.value = 'fallback'
}
