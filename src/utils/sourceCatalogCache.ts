import type { SourceItem } from '../types/notice'
import { isValidIsoTimestamp, parseSourceListResponse } from './validation'

/** 来源目录的持久化缓存只用于首屏兜底，不是服务端数据的权威来源。 */
const CACHE_SCHEMA_VERSION = 1
const DATABASE_NAME = 'notifai-source-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'source-catalog'
const CACHE_KEY = 'current'
const MAX_CACHE_CHARS = 256 * 1024

/** 来源变化频率较低；过期后仍可离线展示，但会触发后台刷新。 */
export const SOURCE_CATALOG_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface SourceCatalogCacheEntry {
  items: SourceItem[]
  fetchedAt: string
}

export interface SourceCatalogCacheSnapshot extends SourceCatalogCacheEntry {
  stale: boolean
}

interface StoredSourceCatalogCacheEntry extends SourceCatalogCacheEntry {
  key: string
  schemaVersion: number
}

let databasePromise: Promise<IDBDatabase | null> | null = null
let memoryEntry: StoredSourceCatalogCacheEntry | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneItems(items: readonly SourceItem[]): SourceItem[] {
  return items.map((item) => ({ ...item }))
}

function parseEntry(value: unknown): StoredSourceCatalogCacheEntry | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion !== CACHE_SCHEMA_VERSION || value.key !== CACHE_KEY) return null
  if (!isValidIsoTimestamp(value.fetchedAt)) return null

  let items: SourceItem[]
  try {
    items = parseSourceListResponse(value.items)
  } catch {
    return null
  }

  return {
    key: CACHE_KEY,
    schemaVersion: CACHE_SCHEMA_VERSION,
    items: cloneItems(items),
    fetchedAt: value.fetchedAt,
  }
}

function toSnapshot(entry: StoredSourceCatalogCacheEntry): SourceCatalogCacheSnapshot {
  return {
    items: cloneItems(entry.items),
    fetchedAt: entry.fetchedAt,
    stale: Math.max(0, Date.now() - Date.parse(entry.fetchedAt)) > SOURCE_CATALOG_CACHE_MAX_AGE_MS,
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

function readFromDatabase(database: IDBDatabase): Promise<StoredSourceCatalogCacheEntry | null> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(CACHE_KEY)
      request.onsuccess = () => {
        const entry = parseEntry(request.result)
        if (entry) memoryEntry = entry
        resolve(entry)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function writeToDatabase(
  database: IDBDatabase,
  entry: StoredSourceCatalogCacheEntry,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(entry)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function readSourceCatalogCache(): Promise<SourceCatalogCacheSnapshot | null> {
  if (memoryEntry) return toSnapshot(memoryEntry)
  const database = await openDatabase()
  if (!database) return null
  const entry = await readFromDatabase(database)
  return entry ? toSnapshot(entry) : null
}

export async function writeSourceCatalogCache(entry: SourceCatalogCacheEntry): Promise<void> {
  const parsed = parseEntry({
    key: CACHE_KEY,
    schemaVersion: CACHE_SCHEMA_VERSION,
    items: entry.items,
    fetchedAt: entry.fetchedAt,
  })
  if (!parsed) return

  try {
    if (JSON.stringify(parsed).length > MAX_CACHE_CHARS) return
  } catch {
    return
  }

  memoryEntry = parsed
  const database = await openDatabase()
  if (database) await writeToDatabase(database, parsed)
}

export async function clearSourceCatalogCache(): Promise<void> {
  memoryEntry = null
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
