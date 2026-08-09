import type { NoticeItem } from '../types/notice'
import { parseNoticeItem } from './validation'

/**
 * 首页通知缓存的持久化版本。
 *
 * 缓存只用于加速首屏和网络失败时的兜底，不替代服务端数据。IndexedDB
 * 不可用、配额不足或缓存损坏时，调用方应继续走正常网络请求。
 */
const CACHE_SCHEMA_VERSION = 2
const DATABASE_NAME = 'notifai-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'notice-feeds'
const MAX_CACHE_ITEMS = 100
const MAX_CACHE_ENTRIES = 20
const MAX_CACHE_ENTRY_CHARS = 8 * 1024 * 1024

/** 缓存最多保留 30 天；过期缓存仍可作为离线兜底，但会标记为陈旧。 */
export const NOTICE_FEED_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface NoticeFeedCacheEntry {
  key: string
  items: NoticeItem[]
  total: number
  nextPage: number
  finished: boolean
  scanPaused: boolean
  fetchedAt: string
}

export interface NoticeFeedCacheSnapshot extends NoticeFeedCacheEntry {
  stale: boolean
}

interface StoredNoticeFeedCacheEntry extends NoticeFeedCacheEntry {
  schemaVersion: number
}

const memoryCache = new Map<string, StoredNoticeFeedCacheEntry>()
let databasePromise: Promise<IDBDatabase | null> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && !Number.isNaN(Date.parse(value))
}

function parseCacheEntry(value: unknown, expectedKey?: string): StoredNoticeFeedCacheEntry | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion !== CACHE_SCHEMA_VERSION) return null
  if (typeof value.key !== 'string' || value.key.length === 0 || value.key.length > 20_000) {
    return null
  }
  if (expectedKey !== undefined && value.key !== expectedKey) return null
  if (!Array.isArray(value.items) || value.items.length > MAX_CACHE_ITEMS) return null
  if (typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0) {
    return null
  }
  if (
    typeof value.nextPage !== 'number' ||
    !Number.isSafeInteger(value.nextPage) ||
    value.nextPage < 1
  ) {
    return null
  }
  if (typeof value.finished !== 'boolean' || typeof value.scanPaused !== 'boolean') return null
  if (!isValidIsoTimestamp(value.fetchedAt)) return null

  const items: NoticeItem[] = []
  const seenIds = new Set<string>()
  for (const [index, rawItem] of value.items.entries()) {
    let item: NoticeItem
    try {
      // IndexedDB 内容也属于外部边界，不能直接断言为 NoticeItem。
      item = parseNoticeItem(rawItem, `cache.items[${index}]`)
    } catch {
      return null
    }
    if (seenIds.has(item.id)) return null
    seenIds.add(item.id)
    items.push(item)
  }

  if (value.total < items.length) return null

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    key: value.key,
    items,
    total: value.total,
    nextPage: value.nextPage,
    finished: value.finished,
    scanPaused: value.scanPaused,
    fetchedAt: value.fetchedAt,
  }
}

function toSnapshot(entry: StoredNoticeFeedCacheEntry): NoticeFeedCacheSnapshot {
  const age = Math.max(0, Date.now() - Date.parse(entry.fetchedAt))
  return {
    ...entry,
    items: entry.items.map((item) => ({ ...item, attachments: [...item.attachments] })),
    stale: age > NOTICE_FEED_CACHE_MAX_AGE_MS,
  }
}

function remember(entry: StoredNoticeFeedCacheEntry): void {
  memoryCache.delete(entry.key)
  memoryCache.set(entry.key, entry)
  while (memoryCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value
    if (oldestKey === undefined) break
    memoryCache.delete(oldestKey)
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    } catch {
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return databasePromise
}

function readFromDatabase(
  database: IDBDatabase,
  key: string,
): Promise<StoredNoticeFeedCacheEntry | null> {
  return new Promise((resolve) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => {
        const entry = parseCacheEntry(request.result, key)
        if (entry) remember(entry)
        resolve(entry)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function pruneDatabaseStore(store: IDBObjectStore): void {
  const request = store.getAll()
  request.onsuccess = () => {
    const entries = request.result
      .filter((entry) => isRecord(entry) && typeof entry.fetchedAt === 'string')
      .sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))

    for (const entry of entries.slice(MAX_CACHE_ENTRIES)) {
      if (typeof entry.key === 'string') store.delete(entry.key)
    }
  }
}

function writeToDatabase(database: IDBDatabase, entry: StoredNoticeFeedCacheEntry): Promise<void> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      store.put(entry)
      pruneDatabaseStore(store)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * 读取指定查询条件的首页缓存。缓存解析失败会被视为未命中，不影响正常请求。
 */
export async function readNoticeFeedCache(key: string): Promise<NoticeFeedCacheSnapshot | null> {
  const memoryEntry = memoryCache.get(key)
  if (memoryEntry) {
    remember(memoryEntry)
    return toSnapshot(memoryEntry)
  }

  const database = await openDatabase()
  if (!database) return null
  const entry = await readFromDatabase(database, key)
  return entry ? toSnapshot(entry) : null
}

/** 保存一份已由 API 校验过的首页首批通知。失败时静默降级为无缓存。 */
export async function writeNoticeFeedCache(entry: NoticeFeedCacheEntry): Promise<void> {
  const parsed = parseCacheEntry({ schemaVersion: CACHE_SCHEMA_VERSION, ...entry }, entry.key)
  if (!parsed) return

  try {
    if (JSON.stringify(parsed).length > MAX_CACHE_ENTRY_CHARS) return
  } catch {
    return
  }

  remember(parsed)
  const database = await openDatabase()
  if (database) await writeToDatabase(database, parsed)
}

/** 主要用于设置页或调试场景，清理全部持久化首页缓存。 */
export async function clearNoticeFeedCache(): Promise<void> {
  memoryCache.clear()
  const database = await openDatabase()
  if (!database) return

  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
