import {
  isNoticeCategoryKey,
  normalizeNoticeSource,
  NOTICE_CATEGORY_DEFINITIONS,
  SOURCE_CATALOG_FALLBACK,
} from '../types/notice'
import type { NoticeCategoryKey } from '../types/notice'
import type { Folder } from '../types/folder'
import { DEFAULT_FOLDERS } from '../types/folder'
import { isValidNoticeId } from '../utils/validation'

export const USER_SETTINGS_STORAGE_KEY = 'notifai-user-settings'
export const USER_SETTINGS_JOURNAL_NAMESPACE = `${USER_SETTINGS_STORAGE_KEY}:journal:`
export const USER_SETTINGS_JOURNAL_PREFIX = `${USER_SETTINGS_STORAGE_KEY}:journal:1:`
export const USER_SETTINGS_SCHEMA_VERSION = 3
export const USER_FOLDER_LIMIT = 100

const SOURCE_GROUP_ORDER = new Map([
  ['校级部门', 0],
  ['二级学院', 1],
  ['其他', 2],
])

export const MAX_STORED_ITEMS = 10_000
export const MAX_TAGS_PER_NOTICE = 50
export const MAX_SYNC_CLIENTS = 1_000
export const MAX_NOTICE_CACHE_ITEMS = 500
export const MAX_JOURNAL_DECISIONS = 50_000
export const MAX_JOURNAL_RECORDS = 10_000
export const MAX_JOURNAL_BYTES = 5_000_000
export const SETTINGS_JOURNAL_SCHEMA_VERSION = 1
export const SETTINGS_WRITE_LOCK_NAME = 'notifai-user-settings-writer'
export const SYNC_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
export const FUTURE_SCHEMA_ERROR = '本机设置由更新版本创建，当前版本已转为只读以避免覆盖'
export const FOLDER_ICON_ALIASES = new Set([
  '$star',
  '$school',
  '$trophy',
  '$flask',
  '$domain',
  '$folder',
])
const LEGACY_FOLDER_ICONS: Readonly<Record<string, string>> = {
  'mdi-star': '$star',
  'mdi-school': '$school',
  'mdi-trophy': '$trophy',
  'mdi-flask': '$flask',
  'mdi-domain': '$domain',
  'mdi-folder': '$folder',
}
export const VALID_DEPARTMENT_ORDER = Array.from(
  new Set(
    [...SOURCE_CATALOG_FALLBACK]
      .map((source, index) => ({ source, index }))
      .sort((first, second) => {
        return (
          (SOURCE_GROUP_ORDER.get(first.source.group) ?? SOURCE_GROUP_ORDER.size) -
            (SOURCE_GROUP_ORDER.get(second.source.group) ?? SOURCE_GROUP_ORDER.size) ||
          first.index - second.index
        )
      })
      .map(({ source }) => normalizeNoticeSource(source.name)),
  ),
)
export const VALID_DEPARTMENT_NAMES = new Set(VALID_DEPARTMENT_ORDER)
export const VALID_CATEGORY_ORDER = NOTICE_CATEGORY_DEFINITIONS.map(({ key }) => key)

/**
 * Source names are supplied by the backend and may change without a frontend
 * release. Keep the same basic safety limits as other persisted strings while
 * allowing sources discovered through GET /sources.
 */
export function normalizeDepartmentName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const department = normalizeNoticeSource(value.trim())
  return department.length > 0 && department.length <= 200 ? department : null
}

function orderDepartmentNames(names: Iterable<string>): string[] {
  const defaultOrder = new Map(VALID_DEPARTMENT_ORDER.map((name, index) => [name, index]))
  return [...new Set(names)].sort((first, second) => {
    const firstIndex = defaultOrder.get(first) ?? Number.MAX_SAFE_INTEGER
    const secondIndex = defaultOrder.get(second) ?? Number.MAX_SAFE_INTEGER
    return firstIndex - secondIndex || first.localeCompare(second)
  })
}

export function normalizeCategoryKey(value: unknown): NoticeCategoryKey | null {
  return isNoticeCategoryKey(value) ? value : null
}

function orderCategoryKeys(names: Iterable<NoticeCategoryKey>): NoticeCategoryKey[] {
  const order = new Map(VALID_CATEGORY_ORDER.map((name, index) => [name, index]))
  return [...new Set(names)].sort(
    (first, second) => (order.get(first) ?? 0) - (order.get(second) ?? 0),
  )
}

export type DarkMode = 'auto' | 'light' | 'dark'
export type SubscriptionMode = 'all' | 'custom'

export interface StoredSettings {
  schemaVersion: typeof USER_SETTINGS_SCHEMA_VERSION
  syncClock: Record<string, number>
  syncWriter: string
  subscriptionMode: SubscriptionMode
  subscribedDepts: string[]
  categoryMode: SubscriptionMode
  subscribedCategories: NoticeCategoryKey[]
  blacklistKeywords: string[]
  starredIds: string[]
  starredFolderMap: Record<string, string>
  readIds: string[]
  pinnedIds: string[]
  importantIds: string[]
  customTags: Record<string, string[]>
  darkMode: DarkMode
  folders: Folder[]
  notificationEnabled: boolean
}

export type StoredSettingsField = Exclude<
  keyof StoredSettings,
  'schemaVersion' | 'syncClock' | 'syncWriter'
>

export interface PendingSettingsOperation {
  sequence: number
  baseline: StoredSettings
  settings: StoredSettings
  dirtyFields: ReadonlySet<StoredSettingsField>
}

export interface SequencedPresenceIntent {
  item: string
  present: boolean
  sequence: number
}

export interface SequencedFolderIntent {
  id: string
  previous: Folder | null
  folder: Folder | null
  sequence: number
}

export interface SequencedFolderMapIntent {
  id: string
  previousFolderId: string | null
  folderId: string | null
  sequence: number
}

export interface SequencedTagIntent {
  id: string
  tag: string
  present: boolean
  sequence: number
}

export interface SequencedValueIntent<T> {
  value: T
  sequence: number
}

export interface SettingsJournal {
  schemaVersion: typeof SETTINGS_JOURNAL_SCHEMA_VERSION
  settingsSchemaVersion: typeof USER_SETTINGS_SCHEMA_VERSION
  clientId: string
  dependencyClock: Record<string, number>
  subscriptions: SequencedPresenceIntent[]
  categorySubscriptions: SequencedPresenceIntent[]
  blacklistKeywords: SequencedPresenceIntent[]
  starredIds: SequencedPresenceIntent[]
  readIds: SequencedPresenceIntent[]
  pinnedIds: SequencedPresenceIntent[]
  importantIds: SequencedPresenceIntent[]
  folders: SequencedFolderIntent[]
  starredFolderMap: SequencedFolderMapIntent[]
  customTags: SequencedTagIntent[]
  darkMode: SequencedValueIntent<DarkMode> | null
  notificationEnabled: SequencedValueIntent<boolean> | null
}

export interface SettingsJournalRecord {
  key: string
  raw: string
  journal: SettingsJournal
}

export interface SettingsJournalScan {
  records: SettingsJournalRecord[]
  invalid: boolean
  future: boolean
}

export class FutureSettingsJournalError extends Error {}

export interface ParsedSettings {
  settings: StoredSettings
  readOnly: boolean
  needsMigration: boolean
}

const STORED_SETTINGS_FIELDS: readonly StoredSettingsField[] = [
  'subscriptionMode',
  'subscribedDepts',
  'categoryMode',
  'subscribedCategories',
  'blacklistKeywords',
  'starredIds',
  'starredFolderMap',
  'readIds',
  'pinnedIds',
  'importantIds',
  'customTags',
  'darkMode',
  'folders',
  'notificationEnabled',
]

export function cloneDefaultFolders(): Folder[] {
  return DEFAULT_FOLDERS.map((folder) => ({ ...folder }))
}

export function createDefaultSettings(): StoredSettings {
  return {
    schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    syncClock: Object.create(null) as Record<string, number>,
    syncWriter: '',
    subscriptionMode: 'all',
    subscribedDepts: [],
    categoryMode: 'all',
    subscribedCategories: [],
    blacklistKeywords: [],
    starredIds: [],
    starredFolderMap: Object.create(null) as Record<string, string>,
    readIds: [],
    pinnedIds: [],
    importantIds: [],
    customTags: Object.create(null) as Record<string, string[]>,
    darkMode: 'auto',
    folders: cloneDefaultFolders(),
    notificationEnabled: false,
  }
}

export function cloneStoredSettings(settings: StoredSettings): StoredSettings {
  const starredFolderMap = Object.assign(
    Object.create(null) as Record<string, string>,
    settings.starredFolderMap,
  )
  const customTags = Object.create(null) as Record<string, string[]>
  for (const [id, tags] of Object.entries(settings.customTags)) customTags[id] = [...tags]

  return {
    schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    syncClock: Object.assign(Object.create(null) as Record<string, number>, settings.syncClock),
    syncWriter: settings.syncWriter,
    subscriptionMode: settings.subscriptionMode,
    subscribedDepts: [...settings.subscribedDepts],
    categoryMode: settings.categoryMode,
    subscribedCategories: [...settings.subscribedCategories],
    blacklistKeywords: [...settings.blacklistKeywords],
    starredIds: [...settings.starredIds],
    starredFolderMap,
    readIds: [...settings.readIds],
    pinnedIds: [...settings.pinnedIds],
    importantIds: [...settings.importantIds],
    customTags,
    darkMode: settings.darkMode,
    folders: settings.folders.map((folder) => ({ ...folder })),
    notificationEnabled: settings.notificationEnabled,
  }
}

export function createSyncClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function supportsSettingsWriteLock(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function'
}

export function createSettingsJournal(clientId: string): SettingsJournal {
  return {
    schemaVersion: SETTINGS_JOURNAL_SCHEMA_VERSION,
    settingsSchemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    clientId,
    dependencyClock: Object.create(null) as Record<string, number>,
    subscriptions: [],
    categorySubscriptions: [],
    blacklistKeywords: [],
    starredIds: [],
    readIds: [],
    pinnedIds: [],
    importantIds: [],
    folders: [],
    starredFolderMap: [],
    customTags: [],
    darkMode: null,
    notificationEnabled: null,
  }
}

export function cloneSettingsJournal(journal: SettingsJournal): SettingsJournal {
  return {
    schemaVersion: SETTINGS_JOURNAL_SCHEMA_VERSION,
    settingsSchemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    clientId: journal.clientId,
    dependencyClock: Object.assign(
      Object.create(null) as Record<string, number>,
      journal.dependencyClock,
    ),
    subscriptions: journal.subscriptions.map((intent) => ({ ...intent })),
    categorySubscriptions: journal.categorySubscriptions.map((intent) => ({ ...intent })),
    blacklistKeywords: journal.blacklistKeywords.map((intent) => ({ ...intent })),
    starredIds: journal.starredIds.map((intent) => ({ ...intent })),
    readIds: journal.readIds.map((intent) => ({ ...intent })),
    pinnedIds: journal.pinnedIds.map((intent) => ({ ...intent })),
    importantIds: journal.importantIds.map((intent) => ({ ...intent })),
    folders: journal.folders.map((intent) => ({
      ...intent,
      previous: intent.previous ? { ...intent.previous } : null,
      folder: intent.folder ? { ...intent.folder } : null,
    })),
    starredFolderMap: journal.starredFolderMap.map((intent) => ({ ...intent })),
    customTags: journal.customTags.map((intent) => ({ ...intent })),
    darkMode: journal.darkMode ? { ...journal.darkMode } : null,
    notificationEnabled: journal.notificationEnabled ? { ...journal.notificationEnabled } : null,
  }
}

export function settingsJournalDecisionCount(journal: SettingsJournal): number {
  return (
    journal.subscriptions.length +
    journal.categorySubscriptions.length +
    journal.blacklistKeywords.length +
    journal.starredIds.length +
    journal.readIds.length +
    journal.pinnedIds.length +
    journal.importantIds.length +
    journal.folders.length +
    journal.starredFolderMap.length +
    journal.customTags.length +
    Number(journal.darkMode !== null) +
    Number(journal.notificationEnabled !== null)
  )
}

export function settingsJournalSequence(journal: SettingsJournal): number {
  let sequence = 0
  const updateSequence = (intent: { sequence: number }) => {
    if (intent.sequence > sequence) sequence = intent.sequence
  }
  journal.subscriptions.forEach(updateSequence)
  journal.categorySubscriptions.forEach(updateSequence)
  journal.blacklistKeywords.forEach(updateSequence)
  journal.starredIds.forEach(updateSequence)
  journal.readIds.forEach(updateSequence)
  journal.pinnedIds.forEach(updateSequence)
  journal.importantIds.forEach(updateSequence)
  journal.folders.forEach(updateSequence)
  journal.starredFolderMap.forEach(updateSequence)
  journal.customTags.forEach(updateSequence)
  if (journal.darkMode) updateSequence(journal.darkMode)
  if (journal.notificationEnabled) updateSequence(journal.notificationEnabled)
  return sequence
}

export function isSettingsJournalEmpty(journal: SettingsJournal): boolean {
  return settingsJournalDecisionCount(journal) === 0
}

export function updatePresenceIntents(
  intents: SequencedPresenceIntent[],
  baseline: string[],
  settings: string[],
  sequence: number,
): SequencedPresenceIntent[] {
  const byItem = new Map(intents.map((intent) => [intent.item, intent]))
  const baselineSet = new Set(baseline)
  const settingsSet = new Set(settings)
  for (const item of new Set([...baselineSet, ...settingsSet])) {
    if (baselineSet.has(item) !== settingsSet.has(item)) {
      byItem.set(item, { item, present: settingsSet.has(item), sequence })
    }
  }
  return Array.from(byItem.values())
}

export function updateFolderIntents(
  intents: SequencedFolderIntent[],
  baseline: Folder[],
  settings: Folder[],
  sequence: number,
): SequencedFolderIntent[] {
  const byId = new Map(intents.map((intent) => [intent.id, intent]))
  const baselineById = new Map(baseline.map((folder) => [folder.id, folder]))
  const settingsById = new Map(settings.map((folder) => [folder.id, folder]))
  for (const id of new Set([...baselineById.keys(), ...settingsById.keys()])) {
    const previous = baselineById.get(id) ?? null
    const folder = settingsById.get(id) ?? null
    if (JSON.stringify(previous) !== JSON.stringify(folder)) {
      byId.set(id, {
        id,
        previous: previous ? { ...previous } : null,
        folder: folder ? { ...folder } : null,
        sequence,
      })
    }
  }
  return Array.from(byId.values())
}

export function updateFolderMapIntents(
  intents: SequencedFolderMapIntent[],
  baseline: Record<string, string>,
  settings: Record<string, string>,
  sequence: number,
): SequencedFolderMapIntent[] {
  const byId = new Map(intents.map((intent) => [intent.id, intent]))
  for (const id of new Set([...Object.keys(baseline), ...Object.keys(settings)])) {
    const previousFolderId = recordValue(baseline, id) ?? null
    const folderId = recordValue(settings, id) ?? null
    if (previousFolderId !== folderId) {
      byId.set(id, { id, previousFolderId, folderId, sequence })
    }
  }
  return Array.from(byId.values())
}

export function updateTagIntents(
  intents: SequencedTagIntent[],
  baseline: Record<string, string[]>,
  settings: Record<string, string[]>,
  sequence: number,
): SequencedTagIntent[] {
  const keyFor = (id: string, tag: string) => `${id}\u0000${tag}`
  const byTag = new Map(intents.map((intent) => [keyFor(intent.id, intent.tag), intent]))
  for (const id of new Set([...Object.keys(baseline), ...Object.keys(settings)])) {
    const baselineTags = new Set(Object.hasOwn(baseline, id) ? baseline[id] : [])
    const settingsTags = new Set(Object.hasOwn(settings, id) ? settings[id] : [])
    for (const tag of new Set([...baselineTags, ...settingsTags])) {
      if (baselineTags.has(tag) !== settingsTags.has(tag)) {
        byTag.set(keyFor(id, tag), { id, tag, present: settingsTags.has(tag), sequence })
      }
    }
  }
  return Array.from(byTag.values())
}

export function journalDependencyClock(
  clock: Record<string, number>,
  clientId: string,
): Record<string, number> {
  const dependencyClock = Object.create(null) as Record<string, number>
  for (const [dependencyClientId, sequence] of Object.entries(clock)) {
    if (dependencyClientId !== clientId) dependencyClock[dependencyClientId] = sequence
  }
  return dependencyClock
}

export function appendOperationToJournal(
  journal: SettingsJournal,
  operation: PendingSettingsOperation,
): SettingsJournal {
  const next = cloneSettingsJournal(journal)
  const { baseline, settings, sequence, dirtyFields } = operation
  next.dependencyClock = mergeSyncClocks(
    next.dependencyClock,
    journalDependencyClock(baseline.syncClock, journal.clientId),
  )

  if (dirtyFields.has('subscriptionMode') || dirtyFields.has('subscribedDepts')) {
    next.subscriptions = updatePresenceIntents(
      next.subscriptions,
      effectiveSubscribedDepartments(baseline),
      effectiveSubscribedDepartments(settings),
      sequence,
    )
  }
  if (dirtyFields.has('categoryMode') || dirtyFields.has('subscribedCategories')) {
    next.categorySubscriptions = updatePresenceIntents(
      next.categorySubscriptions,
      effectiveSubscribedCategories(baseline),
      effectiveSubscribedCategories(settings),
      sequence,
    )
  }
  if (dirtyFields.has('blacklistKeywords')) {
    next.blacklistKeywords = updatePresenceIntents(
      next.blacklistKeywords,
      baseline.blacklistKeywords,
      settings.blacklistKeywords,
      sequence,
    )
  }
  if (dirtyFields.has('starredIds')) {
    next.starredIds = updatePresenceIntents(
      next.starredIds,
      baseline.starredIds,
      settings.starredIds,
      sequence,
    )
  }
  if (dirtyFields.has('readIds')) {
    next.readIds = updatePresenceIntents(next.readIds, baseline.readIds, settings.readIds, sequence)
  }
  if (dirtyFields.has('pinnedIds')) {
    next.pinnedIds = updatePresenceIntents(
      next.pinnedIds,
      baseline.pinnedIds,
      settings.pinnedIds,
      sequence,
    )
  }
  if (dirtyFields.has('importantIds')) {
    next.importantIds = updatePresenceIntents(
      next.importantIds,
      baseline.importantIds,
      settings.importantIds,
      sequence,
    )
  }
  if (dirtyFields.has('folders')) {
    next.folders = updateFolderIntents(next.folders, baseline.folders, settings.folders, sequence)
  }
  if (dirtyFields.has('starredFolderMap')) {
    next.starredFolderMap = updateFolderMapIntents(
      next.starredFolderMap,
      baseline.starredFolderMap,
      settings.starredFolderMap,
      sequence,
    )
  }
  if (dirtyFields.has('customTags')) {
    next.customTags = updateTagIntents(
      next.customTags,
      baseline.customTags,
      settings.customTags,
      sequence,
    )
  }
  if (dirtyFields.has('darkMode')) next.darkMode = { value: settings.darkMode, sequence }
  if (dirtyFields.has('notificationEnabled')) {
    next.notificationEnabled = { value: settings.notificationEnabled, sequence }
  }

  if (settingsJournalDecisionCount(next) > MAX_JOURNAL_DECISIONS) {
    throw new RangeError('待同步的本机设置变更过多')
  }
  return next
}

export function rebaseSettingsJournal(
  journal: SettingsJournal,
  settings: StoredSettings,
  sequence: number,
  dependencyClock: Record<string, number>,
): SettingsJournal {
  const rebased = createSettingsJournal(journal.clientId)
  rebased.dependencyClock = Object.assign(
    Object.create(null) as Record<string, number>,
    dependencyClock,
  )
  const rebasePresence = (
    intents: SequencedPresenceIntent[],
    presentItems: string[],
  ): SequencedPresenceIntent[] => {
    const present = new Set(presentItems)
    return intents.map((intent) => ({
      item: intent.item,
      present: present.has(intent.item),
      sequence,
    }))
  }

  rebased.subscriptions = rebasePresence(
    journal.subscriptions,
    effectiveSubscribedDepartments(settings),
  )
  rebased.categorySubscriptions = rebasePresence(
    journal.categorySubscriptions,
    effectiveSubscribedCategories(settings),
  )
  rebased.blacklistKeywords = rebasePresence(journal.blacklistKeywords, settings.blacklistKeywords)
  rebased.starredIds = rebasePresence(journal.starredIds, settings.starredIds)
  rebased.readIds = rebasePresence(journal.readIds, settings.readIds)
  rebased.pinnedIds = rebasePresence(journal.pinnedIds, settings.pinnedIds)
  rebased.importantIds = rebasePresence(journal.importantIds, settings.importantIds)

  const foldersById = new Map(settings.folders.map((folder) => [folder.id, folder]))
  for (const intent of journal.folders) {
    const folder = foldersById.get(intent.id)
    if (folder) {
      rebased.folders.push({ id: intent.id, previous: null, folder: { ...folder }, sequence })
      continue
    }
    const previous = intent.folder ?? intent.previous
    if (previous) {
      rebased.folders.push({
        id: intent.id,
        previous: { ...previous },
        folder: null,
        sequence,
      })
    }
  }

  rebased.starredFolderMap = journal.starredFolderMap.map((intent) => {
    const folderId = recordValue(settings.starredFolderMap, intent.id) ?? null
    return {
      id: intent.id,
      previousFolderId:
        folderId === null ? (intent.folderId ?? intent.previousFolderId ?? 'default') : null,
      folderId,
      sequence,
    }
  })
  rebased.customTags = journal.customTags.map((intent) => ({
    id: intent.id,
    tag: intent.tag,
    present:
      Object.hasOwn(settings.customTags, intent.id) &&
      settings.customTags[intent.id].includes(intent.tag),
    sequence,
  }))
  if (journal.darkMode) rebased.darkMode = { value: settings.darkMode, sequence }
  if (journal.notificationEnabled) {
    rebased.notificationEnabled = { value: settings.notificationEnabled, sequence }
  }
  return rebased
}

export function pruneSettingsJournal(
  journal: SettingsJournal,
  acknowledgedSequence: number,
): SettingsJournal {
  const next = cloneSettingsJournal(journal)
  next.subscriptions = next.subscriptions.filter((intent) => intent.sequence > acknowledgedSequence)
  next.categorySubscriptions = next.categorySubscriptions.filter(
    (intent) => intent.sequence > acknowledgedSequence,
  )
  next.blacklistKeywords = next.blacklistKeywords.filter(
    (intent) => intent.sequence > acknowledgedSequence,
  )
  next.starredIds = next.starredIds.filter((intent) => intent.sequence > acknowledgedSequence)
  next.readIds = next.readIds.filter((intent) => intent.sequence > acknowledgedSequence)
  next.pinnedIds = next.pinnedIds.filter((intent) => intent.sequence > acknowledgedSequence)
  next.importantIds = next.importantIds.filter((intent) => intent.sequence > acknowledgedSequence)
  next.folders = next.folders.filter((intent) => intent.sequence > acknowledgedSequence)
  next.starredFolderMap = next.starredFolderMap.filter(
    (intent) => intent.sequence > acknowledgedSequence,
  )
  next.customTags = next.customTags.filter((intent) => intent.sequence > acknowledgedSequence)
  if (next.darkMode && next.darkMode.sequence <= acknowledgedSequence) next.darkMode = null
  if (next.notificationEnabled && next.notificationEnabled.sequence <= acknowledgedSequence) {
    next.notificationEnabled = null
  }
  return next
}

export function materializeSettingsJournal(
  journal: SettingsJournal,
  acknowledgedSequence: number,
): PendingSettingsOperation | null {
  const baseline = createDefaultSettings()
  const settings = createDefaultSettings()
  const dirtyFields = new Set<StoredSettingsField>()
  let sequence = 0
  const isPending = (intent: { sequence: number }) => intent.sequence > acknowledgedSequence
  const updateSequence = (intent: { sequence: number }) => {
    if (intent.sequence > sequence) sequence = intent.sequence
  }
  const assignPresence = (
    field: 'blacklistKeywords' | 'starredIds' | 'readIds' | 'pinnedIds' | 'importantIds',
    intents: SequencedPresenceIntent[],
  ) => {
    const pending = intents.filter(isPending)
    if (pending.length === 0) return
    baseline[field] = pending.filter((intent) => !intent.present).map((intent) => intent.item)
    settings[field] = pending.filter((intent) => intent.present).map((intent) => intent.item)
    pending.forEach(updateSequence)
    dirtyFields.add(field)
  }

  const subscriptions = journal.subscriptions.filter(isPending)
  if (subscriptions.length > 0) {
    baseline.subscriptionMode = 'custom'
    baseline.subscribedDepts = subscriptions
      .filter((intent) => !intent.present)
      .map((intent) => intent.item)
    settings.subscriptionMode = 'custom'
    settings.subscribedDepts = subscriptions
      .filter((intent) => intent.present)
      .map((intent) => intent.item)
    subscriptions.forEach(updateSequence)
    dirtyFields.add('subscriptionMode')
    dirtyFields.add('subscribedDepts')
  }

  const categorySubscriptions = journal.categorySubscriptions.filter(isPending)
  if (categorySubscriptions.length > 0) {
    baseline.categoryMode = 'custom'
    baseline.subscribedCategories = categorySubscriptions
      .filter((intent) => !intent.present)
      .map((intent) => normalizeCategoryKey(intent.item))
      .filter((category): category is NoticeCategoryKey => category !== null)
    settings.categoryMode = 'custom'
    settings.subscribedCategories = categorySubscriptions
      .filter((intent) => intent.present)
      .map((intent) => normalizeCategoryKey(intent.item))
      .filter((category): category is NoticeCategoryKey => category !== null)
    categorySubscriptions.forEach(updateSequence)
    dirtyFields.add('categoryMode')
    dirtyFields.add('subscribedCategories')
  }

  assignPresence('blacklistKeywords', journal.blacklistKeywords)
  assignPresence('starredIds', journal.starredIds)
  assignPresence('readIds', journal.readIds)
  assignPresence('pinnedIds', journal.pinnedIds)
  assignPresence('importantIds', journal.importantIds)

  const folders = journal.folders.filter(isPending)
  if (folders.length > 0) {
    baseline.folders = folders
      .filter((intent) => intent.previous !== null)
      .map((intent) => ({ ...(intent.previous as Folder) }))
    settings.folders = folders
      .filter((intent) => intent.folder !== null)
      .map((intent) => ({ ...(intent.folder as Folder) }))
    folders.forEach(updateSequence)
    dirtyFields.add('folders')
  }

  const folderMap = journal.starredFolderMap.filter(isPending)
  if (folderMap.length > 0) {
    baseline.starredFolderMap = Object.create(null) as Record<string, string>
    settings.starredFolderMap = Object.create(null) as Record<string, string>
    for (const intent of folderMap) {
      if (intent.previousFolderId !== null) {
        baseline.starredFolderMap[intent.id] = intent.previousFolderId
      }
      if (intent.folderId !== null) settings.starredFolderMap[intent.id] = intent.folderId
      updateSequence(intent)
    }
    dirtyFields.add('starredFolderMap')
  }

  const tags = journal.customTags.filter(isPending)
  if (tags.length > 0) {
    baseline.customTags = Object.create(null) as Record<string, string[]>
    settings.customTags = Object.create(null) as Record<string, string[]>
    for (const intent of tags) {
      const target = intent.present ? settings.customTags : baseline.customTags
      if (!Object.hasOwn(target, intent.id)) target[intent.id] = []
      target[intent.id].push(intent.tag)
      updateSequence(intent)
    }
    dirtyFields.add('customTags')
  }

  if (journal.darkMode && isPending(journal.darkMode)) {
    settings.darkMode = journal.darkMode.value
    updateSequence(journal.darkMode)
    dirtyFields.add('darkMode')
  }
  if (journal.notificationEnabled && isPending(journal.notificationEnabled)) {
    settings.notificationEnabled = journal.notificationEnabled.value
    updateSequence(journal.notificationEnabled)
    dirtyFields.add('notificationEnabled')
  }

  if (dirtyFields.size === 0) return null
  if (
    dirtyFields.has('starredIds') ||
    dirtyFields.has('starredFolderMap') ||
    dirtyFields.has('folders')
  ) {
    dirtyFields.add('starredIds')
    dirtyFields.add('starredFolderMap')
    dirtyFields.add('folders')
  }
  settings.syncClock = mergeSyncClocks(settings.syncClock, journal.dependencyClock)
  settings.syncClock[journal.clientId] = sequence
  settings.syncWriter = journal.clientId
  return { sequence, baseline, settings, dirtyFields }
}

export function normalizeSyncClock(value: unknown): Record<string, number> {
  const clock = Object.create(null) as Record<string, number>
  if (!isRecord(value)) return clock

  const validEntries: Array<[string, number]> = []
  const entries = Object.entries(value)
  for (
    let index = entries.length - 1;
    index >= 0 && validEntries.length < MAX_SYNC_CLIENTS;
    index -= 1
  ) {
    const [clientId, sequence] = entries[index]
    if (
      SYNC_CLIENT_ID_PATTERN.test(clientId) &&
      typeof sequence === 'number' &&
      Number.isSafeInteger(sequence) &&
      sequence >= 0
    ) {
      validEntries.push([clientId, sequence])
    }
  }
  for (const [clientId, sequence] of validEntries.reverse()) clock[clientId] = sequence
  return clock
}

export function mergeSyncClocks(
  first: Record<string, number>,
  second: Record<string, number>,
): Record<string, number> {
  const merged = Object.create(null) as Record<string, number>
  for (const source of [first, second]) {
    for (const [clientId, sequence] of Object.entries(source)) {
      const current = Object.hasOwn(merged, clientId) ? merged[clientId] : -1
      if (sequence > current) merged[clientId] = sequence
    }
  }
  return merged
}

export function syncSequence(clock: Record<string, number>, clientId: string): number {
  return Object.hasOwn(clock, clientId) ? clock[clientId] : 0
}

export function compareSyncClientIds(first: string, second: string): number {
  if (first === second) return 0
  return first < second ? -1 : 1
}

export function clockStrictlyDominates(
  candidate: Record<string, number>,
  other: Record<string, number>,
): boolean {
  let strictlyNewer = false
  const clientIds = new Set([...Object.keys(candidate), ...Object.keys(other)])
  for (const clientId of clientIds) {
    const candidateSequence = syncSequence(candidate, clientId)
    const otherSequence = syncSequence(other, clientId)
    if (candidateSequence < otherSequence) return false
    if (candidateSequence > otherSequence) strictlyNewer = true
  }
  return strictlyNewer
}

export function clocksEqual(
  first: Record<string, number>,
  second: Record<string, number>,
): boolean {
  const clientIds = new Set([...Object.keys(first), ...Object.keys(second)])
  for (const clientId of clientIds) {
    if (syncSequence(first, clientId) !== syncSequence(second, clientId)) return false
  }
  return true
}

export function checkpointCandidateKey(settings: StoredSettings): string {
  const canonical = cloneStoredSettings(settings)
  canonical.syncClock = Object.fromEntries(
    Object.entries(canonical.syncClock).sort(([first], [second]) =>
      compareSyncClientIds(first, second),
    ),
  )
  canonical.starredFolderMap = Object.fromEntries(
    Object.entries(canonical.starredFolderMap).sort(([first], [second]) =>
      compareSyncClientIds(first, second),
    ),
  )
  canonical.customTags = Object.fromEntries(
    Object.entries(canonical.customTags).sort(([first], [second]) =>
      compareSyncClientIds(first, second),
    ),
  )
  return JSON.stringify(canonical)
}

export function compareCheckpointCandidates(first: StoredSettings, second: StoredSettings): number {
  if (clockStrictlyDominates(first.syncClock, second.syncClock)) return 1
  if (clockStrictlyDominates(second.syncClock, first.syncClock)) return -1
  const writerOrder = compareSyncClientIds(first.syncWriter, second.syncWriter)
  if (writerOrder !== 0) return writerOrder
  const firstKey = checkpointCandidateKey(first)
  const secondKey = checkpointCandidateKey(second)
  return compareSyncClientIds(firstKey, secondKey)
}

export function settingsSnapshotAcknowledges(
  snapshot: StoredSettings,
  candidate: StoredSettings,
): boolean {
  return (
    clockStrictlyDominates(snapshot.syncClock, candidate.syncClock) ||
    (clocksEqual(snapshot.syncClock, candidate.syncClock) &&
      compareCheckpointCandidates(snapshot, candidate) >= 0)
  )
}

export function getDirtyFields(
  current: StoredSettings,
  baseline: StoredSettings,
): Set<StoredSettingsField> {
  const dirty = new Set<StoredSettingsField>()
  for (const field of STORED_SETTINGS_FIELDS) {
    if (JSON.stringify(current[field]) !== JSON.stringify(baseline[field])) dirty.add(field)
  }

  if (dirty.has('subscriptionMode') || dirty.has('subscribedDepts')) {
    dirty.add('subscriptionMode')
    dirty.add('subscribedDepts')
  }
  if (dirty.has('categoryMode') || dirty.has('subscribedCategories')) {
    dirty.add('categoryMode')
    dirty.add('subscribedCategories')
  }
  if (dirty.has('starredIds') || dirty.has('starredFolderMap') || dirty.has('folders')) {
    dirty.add('starredIds')
    dirty.add('starredFolderMap')
    dirty.add('folders')
  }
  return dirty
}

export function mergeStringSet(baseline: string[], local: string[], remote: string[]): string[] {
  const baselineSet = new Set(baseline)
  const localSet = new Set(local)
  const locallyRemoved = new Set(baseline.filter((item) => !localSet.has(item)))
  const merged = remote.filter((item) => !locallyRemoved.has(item))
  const mergedSet = new Set(merged)

  for (const item of local) {
    if (!baselineSet.has(item) && !mergedSet.has(item)) {
      mergedSet.add(item)
      merged.push(item)
    }
  }
  return merged
}

export function effectiveSubscribedDepartments(
  settings: Pick<StoredSettings, 'subscriptionMode' | 'subscribedDepts'>,
): string[] {
  if (settings.subscriptionMode === 'all') return [...VALID_DEPARTMENT_ORDER]
  return orderDepartmentNames(
    settings.subscribedDepts
      .map(normalizeDepartmentName)
      .filter((department): department is string => department !== null),
  )
}

export function effectiveSubscribedCategories(
  settings: Pick<StoredSettings, 'categoryMode' | 'subscribedCategories'>,
): NoticeCategoryKey[] {
  if (settings.categoryMode === 'all') return [...VALID_CATEGORY_ORDER]
  return orderCategoryKeys(
    settings.subscribedCategories
      .map(normalizeCategoryKey)
      .filter((category): category is NoticeCategoryKey => category !== null),
  )
}

export function mergeSubscriptions(
  baseline: StoredSettings,
  local: StoredSettings,
  remote: StoredSettings,
  changed: boolean,
): Pick<StoredSettings, 'subscriptionMode' | 'subscribedDepts'> {
  if (!changed) {
    return {
      subscriptionMode: remote.subscriptionMode,
      subscribedDepts: [...remote.subscribedDepts],
    }
  }

  const merged = mergeStringSet(
    effectiveSubscribedDepartments(baseline),
    effectiveSubscribedDepartments(local),
    effectiveSubscribedDepartments(remote),
  )
  const subscribedDepts = orderDepartmentNames(merged)
  const selected = new Set(subscribedDepts)
  const hasAllDefaultDepartments = VALID_DEPARTMENT_ORDER.every((department) =>
    selected.has(department),
  )
  // Keep an explicitly custom mode even when it currently contains every
  // static department. Otherwise a dynamic source excluded by the user from
  // an "all" subscription cannot be represented by the merged set.
  if (
    local.subscriptionMode !== 'custom' &&
    remote.subscriptionMode !== 'custom' &&
    hasAllDefaultDepartments &&
    subscribedDepts.length === VALID_DEPARTMENT_ORDER.length
  ) {
    return { subscriptionMode: 'all', subscribedDepts: [] }
  }
  return { subscriptionMode: 'custom', subscribedDepts }
}

export function mergeCategorySubscriptions(
  baseline: StoredSettings,
  local: StoredSettings,
  remote: StoredSettings,
  changed: boolean,
): Pick<StoredSettings, 'categoryMode' | 'subscribedCategories'> {
  if (!changed) {
    return {
      categoryMode: remote.categoryMode,
      subscribedCategories: [...remote.subscribedCategories],
    }
  }

  const subscribedCategories = orderCategoryKeys(
    mergeStringSet(
      effectiveSubscribedCategories(baseline),
      effectiveSubscribedCategories(local),
      effectiveSubscribedCategories(remote),
    ).filter((category): category is NoticeCategoryKey => isNoticeCategoryKey(category)),
  )
  if (subscribedCategories.length === VALID_CATEGORY_ORDER.length) {
    return { categoryMode: 'all', subscribedCategories: [] }
  }
  return { categoryMode: 'custom', subscribedCategories }
}

export function mergeFolders(baseline: Folder[], local: Folder[], remote: Folder[]): Folder[] {
  const baselineById = new Map(baseline.map((folder) => [folder.id, folder]))
  const localById = new Map(local.map((folder) => [folder.id, folder]))
  const mergedById = new Map(remote.map((folder) => [folder.id, { ...folder }]))

  for (const [id, baselineFolder] of baselineById) {
    const localFolder = localById.get(id)
    if (!localFolder) {
      mergedById.delete(id)
    } else if (JSON.stringify(localFolder) !== JSON.stringify(baselineFolder)) {
      mergedById.set(id, { ...localFolder })
    }
  }
  for (const [id, localFolder] of localById) {
    if (!baselineById.has(id)) mergedById.set(id, { ...localFolder })
  }
  return Array.from(mergedById.values())
}

export function recordValue(record: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

export function mergeFolderMap(
  baseline: Record<string, string>,
  local: Record<string, string>,
  remote: Record<string, string>,
  starredIds: string[],
): Record<string, string> {
  const merged = Object.create(null) as Record<string, string>
  for (const id of starredIds) {
    const baselineFolder = recordValue(baseline, id)
    const localFolder = recordValue(local, id)
    const remoteFolder = recordValue(remote, id)
    merged[id] =
      localFolder !== baselineFolder ? (localFolder ?? 'default') : (remoteFolder ?? 'default')
  }
  return merged
}

export function mergeCustomTags(
  baseline: Record<string, string[]>,
  local: Record<string, string[]>,
  remote: Record<string, string[]>,
): Record<string, string[]> {
  const merged = Object.create(null) as Record<string, string[]>
  const ids = new Set([...Object.keys(baseline), ...Object.keys(local), ...Object.keys(remote)])
  for (const id of ids) {
    const baselineTags = Object.hasOwn(baseline, id) ? baseline[id] : []
    const localTags = Object.hasOwn(local, id) ? local[id] : []
    const remoteTags = Object.hasOwn(remote, id) ? remote[id] : []
    const tags = mergeStringSet(baselineTags, localTags, remoteTags)
    if (tags.length > 0) merged[id] = tags
  }
  return merged
}

export function mergeStoredSettings(
  remote: StoredSettings,
  local: StoredSettings,
  baseline: StoredSettings,
  dirty: ReadonlySet<StoredSettingsField>,
): StoredSettings {
  const subscriptionChanged = dirty.has('subscriptionMode') || dirty.has('subscribedDepts')
  const subscription = mergeSubscriptions(baseline, local, remote, subscriptionChanged)
  const categorySubscriptionChanged = dirty.has('categoryMode') || dirty.has('subscribedCategories')
  const categorySubscription = mergeCategorySubscriptions(
    baseline,
    local,
    remote,
    categorySubscriptionChanged,
  )
  const starredChanged =
    dirty.has('starredIds') || dirty.has('starredFolderMap') || dirty.has('folders')
  const folders = starredChanged
    ? mergeFolders(baseline.folders, local.folders, remote.folders)
    : remote.folders
  const starredIds = starredChanged
    ? mergeStringSet(baseline.starredIds, local.starredIds, remote.starredIds)
    : remote.starredIds
  const starredFolderMap = starredChanged
    ? mergeFolderMap(
        baseline.starredFolderMap,
        local.starredFolderMap,
        remote.starredFolderMap,
        starredIds,
      )
    : remote.starredFolderMap

  return normalizeStoredSettings({
    syncClock: mergeSyncClocks(remote.syncClock, local.syncClock),
    syncWriter: local.syncWriter,
    subscriptionMode: subscription.subscriptionMode,
    subscribedDepts: subscription.subscribedDepts,
    categoryMode: categorySubscription.categoryMode,
    subscribedCategories: categorySubscription.subscribedCategories,
    blacklistKeywords: dirty.has('blacklistKeywords')
      ? mergeStringSet(
          baseline.blacklistKeywords,
          local.blacklistKeywords,
          remote.blacklistKeywords,
        )
      : remote.blacklistKeywords,
    starredIds,
    starredFolderMap,
    readIds: dirty.has('readIds')
      ? mergeStringSet(baseline.readIds, local.readIds, remote.readIds)
      : remote.readIds,
    pinnedIds: dirty.has('pinnedIds')
      ? mergeStringSet(baseline.pinnedIds, local.pinnedIds, remote.pinnedIds)
      : remote.pinnedIds,
    importantIds: dirty.has('importantIds')
      ? mergeStringSet(baseline.importantIds, local.importantIds, remote.importantIds)
      : remote.importantIds,
    customTags: dirty.has('customTags')
      ? mergeCustomTags(baseline.customTags, local.customTags, remote.customTags)
      : remote.customTags,
    darkMode: dirty.has('darkMode') ? local.darkMode : remote.darkMode,
    folders,
    notificationEnabled: dirty.has('notificationEnabled')
      ? local.notificationEnabled
      : remote.notificationEnabled,
  })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeStringArray(
  value: unknown,
  options: {
    maxLength: number
    maxItems?: number
    keepLatest?: boolean
    validate?: (item: string) => boolean
  },
): string[] {
  if (!Array.isArray(value)) return []

  const result: string[] = []
  const seen = new Set<string>()
  const maxItems = options.maxItems ?? MAX_STORED_ITEMS
  const candidates = options.keepLatest ? value.slice(-maxItems) : value.slice(0, maxItems)
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const item = candidate.trim()
    if (
      item.length === 0 ||
      item.length > options.maxLength ||
      (options.validate && !options.validate(item)) ||
      seen.has(item)
    ) {
      continue
    }
    seen.add(item)
    result.push(item)
  }
  return result
}

export function normalizeNoticeIds(value: unknown, keepLatest = false): string[] {
  return normalizeStringArray(value, {
    maxLength: 128,
    keepLatest,
    validate: isValidNoticeId,
  })
}

export function normalizeFolderIcon(value: unknown): string {
  if (typeof value !== 'string') return '$folder'
  const icon = value.trim()
  if (FOLDER_ICON_ALIASES.has(icon)) return icon
  return Object.hasOwn(LEGACY_FOLDER_ICONS, icon) ? LEGACY_FOLDER_ICONS[icon] : '$folder'
}

export function normalizeFolders(value: unknown): Folder[] {
  if (!Array.isArray(value)) return cloneDefaultFolders()

  const folders: Folder[] = []
  const seenIds = new Set<string>()
  for (const candidate of value.slice(0, USER_FOLDER_LIMIT)) {
    if (!isRecord(candidate)) continue
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const icon = normalizeFolderIcon(candidate.icon)
    const createdAt = candidate.createdAt
    if (
      !isValidNoticeId(id) ||
      name.length === 0 ||
      name.length > 100 ||
      typeof createdAt !== 'number' ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0 ||
      seenIds.has(id)
    ) {
      continue
    }
    seenIds.add(id)
    folders.push({ id, name, icon, createdAt })
  }

  if (!seenIds.has('default')) {
    if (folders.length >= USER_FOLDER_LIMIT) folders.pop()
    folders.unshift({ ...DEFAULT_FOLDERS[0] })
  }
  return folders
}

export function normalizeCustomTags(value: unknown): Record<string, string[]> {
  const tagsByNotice = Object.create(null) as Record<string, string[]>
  if (!isRecord(value)) return tagsByNotice

  for (const [id, tags] of Object.entries(value).slice(0, MAX_STORED_ITEMS)) {
    if (!isValidNoticeId(id)) continue
    const normalizedTags = normalizeStringArray(tags, {
      maxLength: 50,
      maxItems: MAX_TAGS_PER_NOTICE,
    })
    if (normalizedTags.length > 0) tagsByNotice[id] = normalizedTags
  }
  return tagsByNotice
}

export function normalizeStoredSettings(parsed: Record<string, unknown>): StoredSettings {
  const subscribedDepts = normalizeStringArray(parsed.subscribedDepts, {
    maxLength: 200,
  })
    .map(normalizeDepartmentName)
    .filter((department): department is string => department !== null)
  const requestedSubscriptionMode: SubscriptionMode =
    parsed.subscriptionMode === 'all' || parsed.subscriptionMode === 'custom'
      ? parsed.subscriptionMode
      : subscribedDepts.length === 0
        ? 'all'
        : 'custom'
  const subscriptionMode: SubscriptionMode =
    requestedSubscriptionMode === 'custom' && subscribedDepts.length === 0
      ? 'all'
      : requestedSubscriptionMode
  const subscribedCategories = normalizeStringArray(parsed.subscribedCategories, {
    maxLength: 100,
    maxItems: VALID_CATEGORY_ORDER.length,
    validate: isNoticeCategoryKey,
  })
    .map(normalizeCategoryKey)
    .filter((category): category is NoticeCategoryKey => category !== null)
  const requestedCategoryMode: SubscriptionMode =
    parsed.categoryMode === 'all' || parsed.categoryMode === 'custom'
      ? parsed.categoryMode
      : subscribedCategories.length === 0
        ? 'all'
        : 'custom'
  const categoryMode: SubscriptionMode =
    requestedCategoryMode === 'custom' && subscribedCategories.length === 0
      ? 'all'
      : requestedCategoryMode
  const starredIds = normalizeNoticeIds(parsed.starredIds)
  const folders = normalizeFolders(parsed.folders)
  const validFolderIds = new Set(folders.map((folder) => folder.id))
  const storedFolderMap = isRecord(parsed.starredFolderMap) ? parsed.starredFolderMap : {}
  const starredFolderMap = Object.create(null) as Record<string, string>
  for (const id of starredIds) {
    const folderId = Object.hasOwn(storedFolderMap, id) ? storedFolderMap[id] : undefined
    starredFolderMap[id] =
      typeof folderId === 'string' && validFolderIds.has(folderId) ? folderId : 'default'
  }

  return {
    schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    syncClock: normalizeSyncClock(parsed.syncClock),
    syncWriter:
      typeof parsed.syncWriter === 'string' && SYNC_CLIENT_ID_PATTERN.test(parsed.syncWriter)
        ? parsed.syncWriter
        : '',
    subscriptionMode,
    subscribedDepts: Array.from(new Set(subscribedDepts)),
    categoryMode,
    subscribedCategories: orderCategoryKeys(subscribedCategories),
    blacklistKeywords: normalizeStringArray(parsed.blacklistKeywords, { maxLength: 200 }),
    starredIds,
    starredFolderMap,
    readIds: normalizeNoticeIds(parsed.readIds, true),
    pinnedIds: normalizeNoticeIds(parsed.pinnedIds),
    importantIds: normalizeNoticeIds(parsed.importantIds),
    customTags: normalizeCustomTags(parsed.customTags),
    darkMode:
      parsed.darkMode === 'light' || parsed.darkMode === 'dark' || parsed.darkMode === 'auto'
        ? parsed.darkMode
        : 'auto',
    folders,
    notificationEnabled: parsed.notificationEnabled === true,
  }
}

export function parseSettingsValue(raw: string): ParsedSettings {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) throw new TypeError('设置根节点必须是对象')

  const version = parsed.schemaVersion
  if (version === undefined) {
    return { settings: normalizeStoredSettings(parsed), readOnly: false, needsMigration: true }
  }
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('设置版本无效')
  }
  return {
    settings: normalizeStoredSettings(parsed),
    readOnly: version > USER_SETTINGS_SCHEMA_VERSION,
    needsMigration: version < USER_SETTINGS_SCHEMA_VERSION,
  }
}

export function settingsJournalKey(clientId: string, sequence: number): string {
  return `${USER_SETTINGS_JOURNAL_PREFIX}${clientId}:${sequence}`
}

export function classifySettingsJournalKey(key: string): 'current' | 'future' | 'invalid' {
  if (!key.startsWith(USER_SETTINGS_JOURNAL_NAMESPACE)) return 'invalid'
  const suffix = key.slice(USER_SETTINGS_JOURNAL_NAMESPACE.length)
  const separatorIndex = suffix.indexOf(':')
  if (separatorIndex <= 0) return 'invalid'
  const versionText = suffix.slice(0, separatorIndex)
  const version = Number(versionText)
  if (!Number.isSafeInteger(version) || version < 1 || String(version) !== versionText) {
    return 'invalid'
  }
  if (version > SETTINGS_JOURNAL_SCHEMA_VERSION) return 'future'
  return version === SETTINGS_JOURNAL_SCHEMA_VERSION ? 'current' : 'invalid'
}

export function parseSettingsJournalKey(
  key: string,
): { clientId: string; sequence: number } | null {
  if (!key.startsWith(USER_SETTINGS_JOURNAL_PREFIX)) return null
  const suffix = key.slice(USER_SETTINGS_JOURNAL_PREFIX.length)
  const separatorIndex = suffix.lastIndexOf(':')
  if (separatorIndex <= 0) return null
  const clientId = suffix.slice(0, separatorIndex)
  const sequenceText = suffix.slice(separatorIndex + 1)
  const sequence = Number(sequenceText)
  if (
    !SYNC_CLIENT_ID_PATTERN.test(clientId) ||
    !isValidJournalSequence(sequence) ||
    String(sequence) !== sequenceText
  ) {
    return null
  }
  return { clientId, sequence }
}

export function isValidJournalSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function normalizeJournalPresenceIntents(
  value: unknown,
  normalizeItem: (value: unknown) => string | null,
): SequencedPresenceIntent[] {
  if (!Array.isArray(value)) return []
  const byItem = new Map<string, SequencedPresenceIntent>()
  for (const candidate of value) {
    if (!isRecord(candidate) || !isValidJournalSequence(candidate.sequence)) continue
    const item = normalizeItem(candidate.item)
    if (item === null || typeof candidate.present !== 'boolean') continue
    const previous = byItem.get(item)
    if (!previous || candidate.sequence >= previous.sequence) {
      byItem.set(item, { item, present: candidate.present, sequence: candidate.sequence })
    }
  }
  return Array.from(byItem.values())
}

export function normalizeJournalFolder(value: unknown, expectedId: string): Folder | null {
  if (value === null) return null
  const folder = normalizeFolders([value]).find((candidate) => candidate.id === expectedId)
  return folder ? { ...folder } : null
}

export function parseSettingsJournal(
  raw: string,
  expectedClientId: string,
  expectedSequence: number,
): SettingsJournal {
  if (raw.length > MAX_JOURNAL_BYTES) throw new RangeError('设置同步日志过大')
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) throw new TypeError('设置同步日志根节点必须是对象')
  if (
    (typeof parsed.schemaVersion === 'number' &&
      parsed.schemaVersion > SETTINGS_JOURNAL_SCHEMA_VERSION) ||
    (typeof parsed.settingsSchemaVersion === 'number' &&
      parsed.settingsSchemaVersion > USER_SETTINGS_SCHEMA_VERSION)
  ) {
    throw new FutureSettingsJournalError('设置同步日志由更新版本创建')
  }
  if (
    parsed.schemaVersion !== SETTINGS_JOURNAL_SCHEMA_VERSION ||
    typeof parsed.settingsSchemaVersion !== 'number' ||
    !Number.isSafeInteger(parsed.settingsSchemaVersion) ||
    parsed.settingsSchemaVersion < 1 ||
    parsed.clientId !== expectedClientId ||
    !SYNC_CLIENT_ID_PATTERN.test(expectedClientId)
  ) {
    throw new TypeError('设置同步日志版本或客户端标识无效')
  }

  const normalizeNoticeId = (value: unknown) =>
    typeof value === 'string' && isValidNoticeId(value) ? value : null
  const normalizeKeyword = (value: unknown) => {
    if (typeof value !== 'string') return null
    const keyword = value.trim()
    return keyword.length > 0 && keyword.length <= 200 ? keyword : null
  }
  const normalizeDepartment = (value: unknown) => {
    return normalizeDepartmentName(value)
  }
  const normalizeCategory = (value: unknown) => normalizeCategoryKey(value)

  const journal = createSettingsJournal(expectedClientId)
  journal.dependencyClock = normalizeSyncClock(parsed.dependencyClock)
  journal.subscriptions = normalizeJournalPresenceIntents(parsed.subscriptions, normalizeDepartment)
  journal.categorySubscriptions = normalizeJournalPresenceIntents(
    parsed.categorySubscriptions,
    normalizeCategory,
  )
  journal.blacklistKeywords = normalizeJournalPresenceIntents(
    parsed.blacklistKeywords,
    normalizeKeyword,
  )
  journal.starredIds = normalizeJournalPresenceIntents(parsed.starredIds, normalizeNoticeId)
  journal.readIds = normalizeJournalPresenceIntents(parsed.readIds, normalizeNoticeId)
  journal.pinnedIds = normalizeJournalPresenceIntents(parsed.pinnedIds, normalizeNoticeId)
  journal.importantIds = normalizeJournalPresenceIntents(parsed.importantIds, normalizeNoticeId)

  if (Array.isArray(parsed.folders)) {
    const byId = new Map<string, SequencedFolderIntent>()
    for (const candidate of parsed.folders) {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== 'string' ||
        !isValidNoticeId(candidate.id) ||
        !isValidJournalSequence(candidate.sequence)
      ) {
        continue
      }
      const previous = normalizeJournalFolder(candidate.previous, candidate.id)
      const folder = normalizeJournalFolder(candidate.folder, candidate.id)
      if (previous === null && folder === null) continue
      const existing = byId.get(candidate.id)
      if (!existing || candidate.sequence >= existing.sequence) {
        byId.set(candidate.id, {
          id: candidate.id,
          previous,
          folder,
          sequence: candidate.sequence,
        })
      }
    }
    journal.folders = Array.from(byId.values())
  }

  if (Array.isArray(parsed.starredFolderMap)) {
    const byId = new Map<string, SequencedFolderMapIntent>()
    for (const candidate of parsed.starredFolderMap) {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== 'string' ||
        !isValidNoticeId(candidate.id) ||
        !isValidJournalSequence(candidate.sequence)
      ) {
        continue
      }
      const normalizeFolderId = (value: unknown) =>
        typeof value === 'string' && isValidNoticeId(value) ? value : null
      const previousFolderId = normalizeFolderId(candidate.previousFolderId)
      const folderId = normalizeFolderId(candidate.folderId)
      if (candidate.previousFolderId !== null && previousFolderId === null) continue
      if (candidate.folderId !== null && folderId === null) continue
      if (previousFolderId === folderId) continue
      const existing = byId.get(candidate.id)
      if (!existing || candidate.sequence >= existing.sequence) {
        byId.set(candidate.id, {
          id: candidate.id,
          previousFolderId,
          folderId,
          sequence: candidate.sequence,
        })
      }
    }
    journal.starredFolderMap = Array.from(byId.values())
  }

  if (Array.isArray(parsed.customTags)) {
    const byTag = new Map<string, SequencedTagIntent>()
    for (const candidate of parsed.customTags) {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== 'string' ||
        !isValidNoticeId(candidate.id) ||
        typeof candidate.tag !== 'string' ||
        typeof candidate.present !== 'boolean' ||
        !isValidJournalSequence(candidate.sequence)
      ) {
        continue
      }
      const tag = candidate.tag.trim()
      if (tag.length === 0 || tag.length > 50) continue
      const key = `${candidate.id}\u0000${tag}`
      const existing = byTag.get(key)
      if (!existing || candidate.sequence >= existing.sequence) {
        byTag.set(key, {
          id: candidate.id,
          tag,
          present: candidate.present,
          sequence: candidate.sequence,
        })
      }
    }
    journal.customTags = Array.from(byTag.values())
  }

  if (isRecord(parsed.darkMode) && isValidJournalSequence(parsed.darkMode.sequence)) {
    const value = parsed.darkMode.value
    if (value === 'auto' || value === 'light' || value === 'dark') {
      journal.darkMode = { value, sequence: parsed.darkMode.sequence }
    }
  }
  if (
    isRecord(parsed.notificationEnabled) &&
    typeof parsed.notificationEnabled.value === 'boolean' &&
    isValidJournalSequence(parsed.notificationEnabled.sequence)
  ) {
    journal.notificationEnabled = {
      value: parsed.notificationEnabled.value,
      sequence: parsed.notificationEnabled.sequence,
    }
  }

  if (settingsJournalDecisionCount(journal) > MAX_JOURNAL_DECISIONS) {
    throw new RangeError('设置同步日志包含过多变更')
  }
  if (settingsJournalSequence(journal) !== expectedSequence) {
    throw new TypeError('设置同步日志序号与存储 key 不一致')
  }
  return journal
}

export function readStoredSettingsJournals(): SettingsJournalScan {
  if (typeof window === 'undefined') return { records: [], invalid: false, future: false }
  const keys: string[] = []
  let invalid = false
  let future = false
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(USER_SETTINGS_JOURNAL_NAMESPACE)) {
      keys.push(key)
      const classification = classifySettingsJournalKey(key)
      if (classification === 'future') future = true
      else if (classification === 'invalid') invalid = true
    }
  }

  const journals: SettingsJournalRecord[] = []
  for (const key of keys.sort()) {
    if (!key.startsWith(USER_SETTINGS_JOURNAL_PREFIX)) continue
    const identity = parseSettingsJournalKey(key)
    if (!identity) {
      invalid = true
      continue
    }
    const raw = window.localStorage.getItem(key)
    if (!raw) continue
    try {
      const journal = parseSettingsJournal(raw, identity.clientId, identity.sequence)
      if (!isSettingsJournalEmpty(journal)) {
        if (journals.length >= MAX_JOURNAL_RECORDS) invalid = true
        else journals.push({ key, raw, journal })
      }
    } catch (error) {
      if (error instanceof FutureSettingsJournalError) future = true
      else invalid = true
    }
  }
  return { records: journals, invalid, future }
}

export function loadSettings(): {
  settings: StoredSettings
  error: string
  readOnly: boolean
  needsMigration: boolean
} {
  if (typeof window === 'undefined') {
    return {
      settings: createDefaultSettings(),
      error: '',
      readOnly: false,
      needsMigration: false,
    }
  }

  try {
    const raw = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)
    if (!raw) {
      return {
        settings: createDefaultSettings(),
        error: '',
        readOnly: false,
        needsMigration: false,
      }
    }
    const parsed = parseSettingsValue(raw)
    return {
      ...parsed,
      error: parsed.readOnly ? FUTURE_SCHEMA_ERROR : '',
    }
  } catch {
    return {
      settings: createDefaultSettings(),
      error: '本机设置无法读取，已使用默认值',
      readOnly: false,
      needsMigration: false,
    }
  }
}
