import {
  createDefaultSettings,
  FOLDER_ICON_ALIASES,
  isRecord,
  MAX_STORED_ITEMS,
  MAX_TAGS_PER_NOTICE,
  normalizeStoredSettings,
  USER_FOLDER_LIMIT,
  VALID_CATEGORY_ORDER,
  type StoredSettings,
} from '../stores/settingsPersistence'
import { isNoticeCategoryKey } from '../types/notice'
import { isValidNoticeId } from './validation'

const CLOUD_FIELDS = [
  'subscriptionMode',
  'subscribedDepts',
  'categoryMode',
  'subscribedCategories',
  'blacklistKeywords',
  'starredIds',
  'starredFolderMap',
  'pinnedIds',
  'importantIds',
  'customTags',
  'folders',
] as const

export type CloudSettings = Pick<StoredSettings, (typeof CLOUD_FIELDS)[number]>

function pickCloudSettings(settings: StoredSettings): CloudSettings {
  return {
    subscriptionMode: settings.subscriptionMode,
    subscribedDepts: settings.subscribedDepts,
    categoryMode: settings.categoryMode,
    subscribedCategories: settings.subscribedCategories,
    blacklistKeywords: settings.blacklistKeywords,
    starredIds: settings.starredIds,
    starredFolderMap: settings.starredFolderMap,
    pinnedIds: settings.pinnedIds,
    importantIds: settings.importantIds,
    customTags: settings.customTags,
    folders: settings.folders,
  }
}

export function projectCloudSettings(settings: StoredSettings): CloudSettings {
  return pickCloudSettings(normalizeStoredSettings(pickCloudSettings(settings)))
}

export function defaultCloudSettings(): CloudSettings {
  return pickCloudSettings(createDefaultSettings())
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isText(value: unknown, limit: number): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= limit &&
    value.trim() === value &&
    !/[\uD800-\uDFFF]/u.test(value)
  )
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && isValidNoticeId(value)
}

function validList(
  value: unknown,
  limit: number,
  validate: (item: unknown) => boolean,
  minimum = 0,
): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= limit &&
    value.every(validate) &&
    new Set(value).size === value.length
  )
}

function isMode(value: unknown, values: unknown): boolean {
  return value === 'all' || (value === 'custom' && Array.isArray(values) && values.length > 0)
}

export function parseCloudSettings(value: unknown): CloudSettings {
  const invalid = () => new TypeError('Invalid cloud settings')
  const categories = (item: unknown) => typeof item === 'string' && isNoticeCategoryKey(item)
  if (
    !isRecord(value) ||
    !exactKeys(value, CLOUD_FIELDS) ||
    !isMode(value.subscriptionMode, value.subscribedDepts) ||
    !isMode(value.categoryMode, value.subscribedCategories) ||
    !validList(value.subscribedDepts, MAX_STORED_ITEMS, (item) => isText(item, 200)) ||
    !validList(value.subscribedCategories, VALID_CATEGORY_ORDER.length, categories) ||
    !validList(value.blacklistKeywords, MAX_STORED_ITEMS, (item) => isText(item, 200)) ||
    !validList(value.starredIds, MAX_STORED_ITEMS, isId) ||
    !validList(value.pinnedIds, MAX_STORED_ITEMS, isId) ||
    !validList(value.importantIds, MAX_STORED_ITEMS, isId) ||
    !isRecord(value.starredFolderMap) ||
    !isRecord(value.customTags) ||
    !Array.isArray(value.folders) ||
    value.folders.length > USER_FOLDER_LIMIT
  ) {
    throw invalid()
  }

  const folderIds = new Set<string>()
  for (const folder of value.folders) {
    if (
      !isRecord(folder) ||
      !exactKeys(folder, ['id', 'name', 'icon', 'createdAt']) ||
      !isId(folder.id) ||
      folderIds.has(folder.id) ||
      !isText(folder.name, 100) ||
      typeof folder.icon !== 'string' ||
      !FOLDER_ICON_ALIASES.has(folder.icon) ||
      typeof folder.createdAt !== 'number' ||
      !Number.isSafeInteger(folder.createdAt) ||
      folder.createdAt < 0
    ) {
      throw invalid()
    }
    folderIds.add(folder.id)
  }
  if (!folderIds.has('default') || Object.keys(value.starredFolderMap).length !== value.starredIds.length) {
    throw invalid()
  }
  for (const id of value.starredIds) {
    if (!isId(id) || !Object.hasOwn(value.starredFolderMap, id)) throw invalid()
    const folder = value.starredFolderMap[id]
    if (typeof folder !== 'string' || !folderIds.has(folder)) throw invalid()
  }
  const tags = Object.entries(value.customTags)
  if (tags.length > MAX_STORED_ITEMS || tags.some(([id, list]) =>
    !isId(id) || !validList(list, MAX_TAGS_PER_NOTICE, (tag) => isText(tag, 50), 1),
  )) {
    throw invalid()
  }
  return pickCloudSettings(normalizeStoredSettings(value))
}
