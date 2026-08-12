import type { NoticeItem, NoticePaginationMode } from '../types/notice'
import { isValidIsoTimestamp, isValidNoticeId, parseNoticeItem } from './validation'

/**
 * 首页通知缓存的持久化版本。
 *
 * 缓存只用于加速首屏和网络失败时的兜底，不替代服务端数据。IndexedDB
 * 不可用、配额不足或缓存损坏时，调用方应继续走正常网络请求。
 */
const CACHE_SCHEMA_VERSION = 2
const DATABASE_NAME = 'notifai-cache'
const DATABASE_VERSION = 2
const STORE_NAME = 'notice-feeds'
const DETAIL_STORE_NAME = 'notice-details'
// 轻量列表项不包含正文，允许缓存更多页，避免“加载更多”后写缓存时整份失效。
const MAX_CACHE_ITEMS = 500
const MAX_CACHE_ENTRIES = 20
const MAX_CACHE_ENTRY_CHARS = 8 * 1024 * 1024
const MAX_DETAIL_CACHE_ENTRIES = 500
const MAX_DETAIL_CACHE_ENTRY_CHARS = 2 * 1024 * 1024

const DETAIL_CACHE_SCHEMA_VERSION = 1

/** 缓存最多保留 30 天；过期缓存仍可作为离线兜底，但会标记为陈旧。 */
export const NOTICE_FEED_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface NoticeFeedCacheEntry {
  key: string
  items: NoticeItem[]
  total: number
  nextPage: number
  nextCursor?: string | null
  paginationMode?: NoticePaginationMode
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

export interface NoticeDetailCacheEntry {
  id: string
  notice: NoticeItem
  fetchedAt: string
}

export interface NoticeDetailCacheSnapshot extends NoticeDetailCacheEntry {
  stale: boolean
}

interface StoredNoticeDetailCacheEntry extends NoticeDetailCacheEntry {
  schemaVersion: number
}

const memoryCache = new Map<string, StoredNoticeFeedCacheEntry>()
const detailMemoryCache = new Map<string, StoredNoticeDetailCacheEntry>()
let databasePromise: Promise<IDBDatabase | null> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  if (
    value.nextCursor !== undefined &&
    value.nextCursor !== null &&
    (typeof value.nextCursor !== 'string' ||
      value.nextCursor.length === 0 ||
      value.nextCursor.length > 4096)
  )
    return null
  if (
    value.paginationMode !== undefined &&
    value.paginationMode !== 'offset' &&
    value.paginationMode !== 'cursor'
  )
    return null
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
    nextCursor: value.nextCursor ?? null,
    paginationMode: value.paginationMode ?? (value.nextCursor ? 'cursor' : 'offset'),
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

function parseDetailCacheEntry(
  value: unknown,
  expectedId?: string,
): StoredNoticeDetailCacheEntry | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion !== DETAIL_CACHE_SCHEMA_VERSION) return null
  if (!isValidNoticeId(value.id) || (expectedId !== undefined && value.id !== expectedId)) {
    return null
  }
  if (!isValidIsoTimestamp(value.fetchedAt)) return null

  let notice: NoticeItem
  try {
    // Details restored from IndexedDB are untrusted just like API responses.
    notice = parseNoticeItem(value.notice, 'cache.notice')
  } catch {
    return null
  }
  if (notice.id !== value.id) return null

  return {
    schemaVersion: DETAIL_CACHE_SCHEMA_VERSION,
    id: value.id,
    notice,
    fetchedAt: value.fetchedAt,
  }
}

function toDetailSnapshot(entry: StoredNoticeDetailCacheEntry): NoticeDetailCacheSnapshot {
  return {
    id: entry.id,
    notice: { ...entry.notice, attachments: [...entry.notice.attachments] },
    fetchedAt: entry.fetchedAt,
    stale: Math.max(0, Date.now() - Date.parse(entry.fetchedAt)) > NOTICE_FEED_CACHE_MAX_AGE_MS,
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
      if (!database.objectStoreNames.contains(DETAIL_STORE_NAME)) {
        database.createObjectStore(DETAIL_STORE_NAME, { keyPath: 'id' })
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

function readDetailFromDatabase(
  database: IDBDatabase,
  id: string,
): Promise<StoredNoticeDetailCacheEntry | null> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(DETAIL_STORE_NAME, 'readonly')
      const request = transaction.objectStore(DETAIL_STORE_NAME).get(id)
      request.onsuccess = () => {
        const entry = parseDetailCacheEntry(request.result, id)
        if (entry) detailMemoryCache.set(id, entry)
        resolve(entry)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function pruneDetailDatabaseStore(store: IDBObjectStore): void {
  const request = store.getAll()
  request.onsuccess = () => {
    const entries = request.result
      .filter((entry) => isRecord(entry) && typeof entry.fetchedAt === 'string')
      .sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))

    for (const entry of entries.slice(MAX_DETAIL_CACHE_ENTRIES)) {
      if (typeof entry.id === 'string') store.delete(entry.id)
    }
  }
}

function writeDetailToDatabase(
  database: IDBDatabase,
  entry: StoredNoticeDetailCacheEntry,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(DETAIL_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(DETAIL_STORE_NAME)
      store.put(entry)
      pruneDetailDatabaseStore(store)
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

/**
 * 读取通知详情的持久化缓存。陈旧详情仍会返回，供详情页离线展示并标记为
 * 可刷新状态；调用方必须继续尝试网络请求。
 */
export async function readNoticeDetailCache(id: string): Promise<NoticeDetailCacheSnapshot | null> {
  if (!isValidNoticeId(id)) return null
  const memoryEntry = detailMemoryCache.get(id)
  if (memoryEntry) return toDetailSnapshot(memoryEntry)

  const database = await openDatabase()
  if (!database) return null
  const entry = await readDetailFromDatabase(database, id)
  return entry ? toDetailSnapshot(entry) : null
}

/** 保存一份完整、已由 API 校验过的通知详情。 */
export async function writeNoticeDetailCache(notice: NoticeItem): Promise<void> {
  const parsed = parseDetailCacheEntry(
    {
      schemaVersion: DETAIL_CACHE_SCHEMA_VERSION,
      id: notice.id,
      notice,
      fetchedAt: new Date().toISOString(),
    },
    notice.id,
  )
  if (!parsed) return

  try {
    if (JSON.stringify(parsed).length > MAX_DETAIL_CACHE_ENTRY_CHARS) return
  } catch {
    return
  }

  detailMemoryCache.delete(parsed.id)
  detailMemoryCache.set(parsed.id, parsed)
  while (detailMemoryCache.size > MAX_DETAIL_CACHE_ENTRIES) {
    const oldestId = detailMemoryCache.keys().next().value
    if (oldestId === undefined) break
    detailMemoryCache.delete(oldestId)
  }

  const database = await openDatabase()
  if (database) await writeDetailToDatabase(database, parsed)
}

/** 清理详情缓存；首页 feed 缓存保持不变。 */
export async function clearNoticeDetailCache(): Promise<void> {
  detailMemoryCache.clear()
  const database = await openDatabase()
  if (!database) return

  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(DETAIL_STORE_NAME, 'readwrite')
      transaction.objectStore(DETAIL_STORE_NAME).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
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
