import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import type { NoticeItem } from '../types/notice'
import { DEPARTMENTS, normalizeNoticeSource } from '../types/notice'
import type { Folder } from '../types/folder'
import { DEFAULT_FOLDERS } from '../types/folder'
import { isValidNoticeId } from '../utils/validation'

export const USER_SETTINGS_STORAGE_KEY = 'notifai-user-settings'
const USER_SETTINGS_JOURNAL_NAMESPACE = `${USER_SETTINGS_STORAGE_KEY}:journal:`
export const USER_SETTINGS_JOURNAL_PREFIX = `${USER_SETTINGS_STORAGE_KEY}:journal:1:`
export const USER_SETTINGS_SCHEMA_VERSION = 2
export const USER_FOLDER_LIMIT = 100

const MAX_STORED_ITEMS = 10_000
const MAX_TAGS_PER_NOTICE = 50
const MAX_SYNC_CLIENTS = 1_000
const MAX_NOTICE_CACHE_ITEMS = 500
const MAX_JOURNAL_DECISIONS = 50_000
const MAX_JOURNAL_RECORDS = 10_000
const MAX_JOURNAL_BYTES = 5_000_000
const SETTINGS_JOURNAL_SCHEMA_VERSION = 1
const SETTINGS_WRITE_LOCK_NAME = 'notifai-user-settings-writer'
const SYNC_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const FUTURE_SCHEMA_ERROR = '本机设置由更新版本创建，当前版本已转为只读以避免覆盖'
const FOLDER_ICON_ALIASES = new Set(['$star', '$school', '$trophy', '$flask', '$domain', '$folder'])
const LEGACY_FOLDER_ICONS: Readonly<Record<string, string>> = {
  'mdi-star': '$star',
  'mdi-school': '$school',
  'mdi-trophy': '$trophy',
  'mdi-flask': '$flask',
  'mdi-domain': '$domain',
  'mdi-folder': '$folder',
}
const VALID_DEPARTMENT_ORDER = Array.from(
  new Set(DEPARTMENTS.map((department) => normalizeNoticeSource(department.name))),
)
const VALID_DEPARTMENT_NAMES = new Set(VALID_DEPARTMENT_ORDER)

export type DarkMode = 'auto' | 'light' | 'dark'
export type SubscriptionMode = 'all' | 'custom'

interface StoredSettings {
  schemaVersion: typeof USER_SETTINGS_SCHEMA_VERSION
  syncClock: Record<string, number>
  syncWriter: string
  subscriptionMode: SubscriptionMode
  subscribedDepts: string[]
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

type StoredSettingsField = Exclude<
  keyof StoredSettings,
  'schemaVersion' | 'syncClock' | 'syncWriter'
>

interface PendingSettingsOperation {
  sequence: number
  baseline: StoredSettings
  settings: StoredSettings
  dirtyFields: ReadonlySet<StoredSettingsField>
}

interface SequencedPresenceIntent {
  item: string
  present: boolean
  sequence: number
}

interface SequencedFolderIntent {
  id: string
  previous: Folder | null
  folder: Folder | null
  sequence: number
}

interface SequencedFolderMapIntent {
  id: string
  previousFolderId: string | null
  folderId: string | null
  sequence: number
}

interface SequencedTagIntent {
  id: string
  tag: string
  present: boolean
  sequence: number
}

interface SequencedValueIntent<T> {
  value: T
  sequence: number
}

interface SettingsJournal {
  schemaVersion: typeof SETTINGS_JOURNAL_SCHEMA_VERSION
  settingsSchemaVersion: typeof USER_SETTINGS_SCHEMA_VERSION
  clientId: string
  dependencyClock: Record<string, number>
  subscriptions: SequencedPresenceIntent[]
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

interface SettingsJournalRecord {
  key: string
  raw: string
  journal: SettingsJournal
}

interface SettingsJournalScan {
  records: SettingsJournalRecord[]
  invalid: boolean
  future: boolean
}

class FutureSettingsJournalError extends Error {}

interface ParsedSettings {
  settings: StoredSettings
  readOnly: boolean
  needsMigration: boolean
}

const STORED_SETTINGS_FIELDS: readonly StoredSettingsField[] = [
  'subscriptionMode',
  'subscribedDepts',
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

function cloneDefaultFolders(): Folder[] {
  return DEFAULT_FOLDERS.map((folder) => ({ ...folder }))
}

function createDefaultSettings(): StoredSettings {
  return {
    schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    syncClock: Object.create(null) as Record<string, number>,
    syncWriter: '',
    subscriptionMode: 'all',
    subscribedDepts: [],
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

function cloneStoredSettings(settings: StoredSettings): StoredSettings {
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

function createSyncClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function supportsSettingsWriteLock(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function'
}

function createSettingsJournal(clientId: string): SettingsJournal {
  return {
    schemaVersion: SETTINGS_JOURNAL_SCHEMA_VERSION,
    settingsSchemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    clientId,
    dependencyClock: Object.create(null) as Record<string, number>,
    subscriptions: [],
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

function cloneSettingsJournal(journal: SettingsJournal): SettingsJournal {
  return {
    schemaVersion: SETTINGS_JOURNAL_SCHEMA_VERSION,
    settingsSchemaVersion: USER_SETTINGS_SCHEMA_VERSION,
    clientId: journal.clientId,
    dependencyClock: Object.assign(
      Object.create(null) as Record<string, number>,
      journal.dependencyClock,
    ),
    subscriptions: journal.subscriptions.map((intent) => ({ ...intent })),
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

function settingsJournalDecisionCount(journal: SettingsJournal): number {
  return (
    journal.subscriptions.length +
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

function settingsJournalSequence(journal: SettingsJournal): number {
  let sequence = 0
  const updateSequence = (intent: { sequence: number }) => {
    if (intent.sequence > sequence) sequence = intent.sequence
  }
  journal.subscriptions.forEach(updateSequence)
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

function isSettingsJournalEmpty(journal: SettingsJournal): boolean {
  return settingsJournalDecisionCount(journal) === 0
}

function updatePresenceIntents(
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

function updateFolderIntents(
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

function updateFolderMapIntents(
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

function updateTagIntents(
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

function journalDependencyClock(
  clock: Record<string, number>,
  clientId: string,
): Record<string, number> {
  const dependencyClock = Object.create(null) as Record<string, number>
  for (const [dependencyClientId, sequence] of Object.entries(clock)) {
    if (dependencyClientId !== clientId) dependencyClock[dependencyClientId] = sequence
  }
  return dependencyClock
}

function appendOperationToJournal(
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

function rebaseSettingsJournal(
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

function pruneSettingsJournal(
  journal: SettingsJournal,
  acknowledgedSequence: number,
): SettingsJournal {
  const next = cloneSettingsJournal(journal)
  next.subscriptions = next.subscriptions.filter((intent) => intent.sequence > acknowledgedSequence)
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

function materializeSettingsJournal(
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

function normalizeSyncClock(value: unknown): Record<string, number> {
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

function mergeSyncClocks(
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

function syncSequence(clock: Record<string, number>, clientId: string): number {
  return Object.hasOwn(clock, clientId) ? clock[clientId] : 0
}

function compareSyncClientIds(first: string, second: string): number {
  if (first === second) return 0
  return first < second ? -1 : 1
}

function clockStrictlyDominates(
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

function clocksEqual(first: Record<string, number>, second: Record<string, number>): boolean {
  const clientIds = new Set([...Object.keys(first), ...Object.keys(second)])
  for (const clientId of clientIds) {
    if (syncSequence(first, clientId) !== syncSequence(second, clientId)) return false
  }
  return true
}

function checkpointCandidateKey(settings: StoredSettings): string {
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

function compareCheckpointCandidates(first: StoredSettings, second: StoredSettings): number {
  if (clockStrictlyDominates(first.syncClock, second.syncClock)) return 1
  if (clockStrictlyDominates(second.syncClock, first.syncClock)) return -1
  const writerOrder = compareSyncClientIds(first.syncWriter, second.syncWriter)
  if (writerOrder !== 0) return writerOrder
  const firstKey = checkpointCandidateKey(first)
  const secondKey = checkpointCandidateKey(second)
  return compareSyncClientIds(firstKey, secondKey)
}

function settingsSnapshotAcknowledges(
  snapshot: StoredSettings,
  candidate: StoredSettings,
): boolean {
  return (
    clockStrictlyDominates(snapshot.syncClock, candidate.syncClock) ||
    (clocksEqual(snapshot.syncClock, candidate.syncClock) &&
      compareCheckpointCandidates(snapshot, candidate) >= 0)
  )
}

function getDirtyFields(
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
  if (dirty.has('starredIds') || dirty.has('starredFolderMap') || dirty.has('folders')) {
    dirty.add('starredIds')
    dirty.add('starredFolderMap')
    dirty.add('folders')
  }
  return dirty
}

function mergeStringSet(baseline: string[], local: string[], remote: string[]): string[] {
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

function effectiveSubscribedDepartments(
  settings: Pick<StoredSettings, 'subscriptionMode' | 'subscribedDepts'>,
): string[] {
  if (settings.subscriptionMode === 'all') return [...VALID_DEPARTMENT_ORDER]
  const selected = new Set(settings.subscribedDepts)
  return VALID_DEPARTMENT_ORDER.filter((department) => selected.has(department))
}

function mergeSubscriptions(
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
  const selected = new Set(merged)
  const subscribedDepts = VALID_DEPARTMENT_ORDER.filter((department) => selected.has(department))
  if (subscribedDepts.length === VALID_DEPARTMENT_ORDER.length) {
    return { subscriptionMode: 'all', subscribedDepts: [] }
  }
  return { subscriptionMode: 'custom', subscribedDepts }
}

function mergeFolders(baseline: Folder[], local: Folder[], remote: Folder[]): Folder[] {
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

function recordValue(record: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function mergeFolderMap(
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

function mergeCustomTags(
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

function mergeStoredSettings(
  remote: StoredSettings,
  local: StoredSettings,
  baseline: StoredSettings,
  dirty: ReadonlySet<StoredSettingsField>,
): StoredSettings {
  const subscriptionChanged = dirty.has('subscriptionMode') || dirty.has('subscribedDepts')
  const subscription = mergeSubscriptions(baseline, local, remote, subscriptionChanged)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeStringArray(
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

function normalizeNoticeIds(value: unknown, keepLatest = false): string[] {
  return normalizeStringArray(value, {
    maxLength: 128,
    keepLatest,
    validate: isValidNoticeId,
  })
}

function normalizeFolderIcon(value: unknown): string {
  if (typeof value !== 'string') return '$folder'
  const icon = value.trim()
  if (FOLDER_ICON_ALIASES.has(icon)) return icon
  return Object.hasOwn(LEGACY_FOLDER_ICONS, icon) ? LEGACY_FOLDER_ICONS[icon] : '$folder'
}

function normalizeFolders(value: unknown): Folder[] {
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

function normalizeCustomTags(value: unknown): Record<string, string[]> {
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

function normalizeStoredSettings(parsed: Record<string, unknown>): StoredSettings {
  const subscribedDepts = normalizeStringArray(parsed.subscribedDepts, {
    maxLength: 200,
  })
    .map(normalizeNoticeSource)
    .filter((department) => VALID_DEPARTMENT_NAMES.has(department))
  const subscriptionMode: SubscriptionMode =
    parsed.subscriptionMode === 'all' || parsed.subscriptionMode === 'custom'
      ? parsed.subscriptionMode
      : subscribedDepts.length === 0
        ? 'all'
        : 'custom'
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

function parseSettingsValue(raw: string): ParsedSettings {
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

function settingsJournalKey(clientId: string, sequence: number): string {
  return `${USER_SETTINGS_JOURNAL_PREFIX}${clientId}:${sequence}`
}

function classifySettingsJournalKey(key: string): 'current' | 'future' | 'invalid' {
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

function parseSettingsJournalKey(key: string): { clientId: string; sequence: number } | null {
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

function isValidJournalSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function normalizeJournalPresenceIntents(
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

function normalizeJournalFolder(value: unknown, expectedId: string): Folder | null {
  if (value === null) return null
  const folder = normalizeFolders([value]).find((candidate) => candidate.id === expectedId)
  return folder ? { ...folder } : null
}

function parseSettingsJournal(
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
    parsed.settingsSchemaVersion !== USER_SETTINGS_SCHEMA_VERSION ||
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
    if (typeof value !== 'string') return null
    const department = normalizeNoticeSource(value)
    return VALID_DEPARTMENT_NAMES.has(department) ? department : null
  }

  const journal = createSettingsJournal(expectedClientId)
  journal.dependencyClock = normalizeSyncClock(parsed.dependencyClock)
  journal.subscriptions = normalizeJournalPresenceIntents(parsed.subscriptions, normalizeDepartment)
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

function readStoredSettingsJournals(): SettingsJournalScan {
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

function loadSettings(): {
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

export const useUserSettingsStore = defineStore('userSettings', () => {
  const loaded = loadSettings()
  const saved = loaded.settings
  const syncClientId = createSyncClientId()
  let lastSyncedSettings = cloneStoredSettings(saved)
  let stableViewSettings = cloneStoredSettings(saved)
  let currentSyncClock = Object.assign(
    Object.create(null) as Record<string, number>,
    saved.syncClock,
  )
  let currentSyncWriter = saved.syncWriter
  let localSequence = syncSequence(saved.syncClock, syncClientId)
  let localJournal = createSettingsJournal(syncClientId)
  let localJournalNeedsWrite = false
  let persistedLocalJournalKey: string | null = null
  let persistedLocalJournalRaw: string | null = null
  const supersededLocalJournalKeys = new Map<string, string>()
  let unflushedBaseline: StoredSettings | null = null
  let storageReadOnly = loaded.readOnly
  let needsMigration = loaded.needsMigration
  let folderIdSequence = 0
  let holdsSettingsWriteLock = false
  let checkpointRequested = false
  let checkpointRevision = 0
  let checkpointAttemptedRevision = 0
  let storeDisposed = false
  let journalCleanupBlocked = false
  let pendingCheckpointCandidate: StoredSettings | null = null

  // ---- 状态 ----
  const subscriptionMode = ref<SubscriptionMode>(saved.subscriptionMode)
  const subscribedDepts = ref<string[]>(saved.subscribedDepts)
  const blacklistKeywords = ref<string[]>(saved.blacklistKeywords)
  const starredIds = ref<string[]>(saved.starredIds)
  const starredFolderMap = ref<Record<string, string>>(saved.starredFolderMap)
  const readIds = ref<string[]>(saved.readIds)
  const pinnedIds = ref<string[]>(saved.pinnedIds)
  const importantIds = ref<string[]>(saved.importantIds)
  const customTags = ref<Record<string, string[]>>(saved.customTags)
  const darkMode = ref<DarkMode>(saved.darkMode)
  const folders = ref<Folder[]>(saved.folders)
  const notificationEnabled = ref<boolean>(saved.notificationEnabled)
  const persistenceError = ref(loaded.error)
  const systemPrefersDark = ref(false)

  /** 已拉取通知的内存缓存 */
  const noticeCache = ref<Map<string, NoticeItem>>(new Map())

  // ---- 查询 ----
  const isSubscribed = computed(
    () => (dept: string) =>
      subscriptionMode.value === 'all' ||
      subscribedDepts.value.includes(normalizeNoticeSource(dept)),
  )
  const isStarred = computed(() => (id: string) => starredIds.value.includes(id))
  const isRead = computed(() => (id: string) => readIds.value.includes(id))
  const isPinned = computed(() => (id: string) => pinnedIds.value.includes(id))
  const isImportant = computed(() => (id: string) => importantIds.value.includes(id))

  /** 实际是否处于深色模式 */
  const isDark = computed(() => {
    if (darkMode.value === 'dark') return true
    if (darkMode.value === 'light') return false
    return systemPrefersDark.value
  })

  /** 用户主动收藏且未过期的通知 */
  const urgentStarredIds = computed(() => starredIds.value)

  /** 所有自定义标签 */
  const allCustomTags = computed(() => {
    const tags = new Set<string>()
    Object.values(customTags.value).forEach((tagList) => {
      tagList.forEach((tag) => tags.add(tag))
    })
    return Array.from(tags)
  })

  // ---- 内部：持久化（debounce 300ms）----
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  function createSnapshot(): StoredSettings {
    return cloneStoredSettings({
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
      syncClock: currentSyncClock,
      syncWriter: currentSyncWriter,
      subscriptionMode: subscriptionMode.value,
      subscribedDepts: subscribedDepts.value,
      blacklistKeywords: blacklistKeywords.value,
      starredIds: starredIds.value,
      starredFolderMap: starredFolderMap.value,
      readIds: readIds.value,
      pinnedIds: pinnedIds.value,
      importantIds: importantIds.value,
      customTags: customTags.value,
      darkMode: darkMode.value,
      folders: folders.value,
      notificationEnabled: notificationEnabled.value,
    })
  }

  function stageUnflushedOperation(): void {
    if (!unflushedBaseline) return

    const baseline = unflushedBaseline
    const localSettings = createSnapshot()
    const dirtyFields = getDirtyFields(localSettings, baseline)
    if (dirtyFields.size === 0) {
      unflushedBaseline = null
      stableViewSettings = cloneStoredSettings(localSettings)
      return
    }

    const nextSequence = Math.max(localSequence, syncSequence(currentSyncClock, syncClientId)) + 1
    localSettings.syncClock = mergeSyncClocks(localSettings.syncClock, currentSyncClock)
    localSettings.syncClock[syncClientId] = nextSequence
    localSettings.syncWriter = syncClientId
    const dependencyClock = journalDependencyClock(baseline.syncClock, syncClientId)
    if (
      !isSettingsJournalEmpty(localJournal) &&
      !clocksEqual(localJournal.dependencyClock, dependencyClock)
    ) {
      localJournal = rebaseSettingsJournal(localJournal, baseline, nextSequence, dependencyClock)
    }
    localJournal = appendOperationToJournal(localJournal, {
      sequence: nextSequence,
      baseline: cloneStoredSettings(baseline),
      settings: cloneStoredSettings(localSettings),
      dirtyFields,
    })
    localJournalNeedsWrite = true
    localSequence = nextSequence
    unflushedBaseline = null
    currentSyncClock = Object.assign(
      Object.create(null) as Record<string, number>,
      localSettings.syncClock,
    )
    currentSyncWriter = syncClientId
    stableViewSettings = cloneStoredSettings(localSettings)
  }

  function inspectStorageForWrite(preserveCleanupBlock = false): {
    parsed: ParsedSettings
    scan: SettingsJournalScan
  } | null {
    const parsed = readSettingsForWrite()
    if (parsed.readOnly) {
      enterReadOnly(parsed.settings)
      return null
    }
    const scan = readStoredSettingsJournals()
    journalCleanupBlocked = (preserveCleanupBlock && journalCleanupBlocked) || scan.invalid
    if (scan.future) {
      enterReadOnly(parsed.settings)
      return null
    }
    return { parsed, scan }
  }

  function cleanupSupersededLocalJournals(): boolean {
    if (supersededLocalJournalKeys.size === 0) return true
    if (!inspectStorageForWrite(true)) return false

    for (const [key, expectedRaw] of supersededLocalJournalKeys) {
      try {
        if (window.localStorage.getItem(key) !== expectedRaw) {
          supersededLocalJournalKeys.delete(key)
          continue
        }
        window.localStorage.removeItem(key)
        supersededLocalJournalKeys.delete(key)
      } catch {
        // The replacement is already durable; a later persistence attempt retries cleanup.
      }
    }
    return true
  }

  function persistLocalJournal(): boolean {
    if (!localJournalNeedsWrite) return cleanupSupersededLocalJournals()
    if (isSettingsJournalEmpty(localJournal)) {
      localJournalNeedsWrite = false
      return cleanupSupersededLocalJournals()
    }

    const inspection = inspectStorageForWrite(true)
    if (!inspection) return false
    const serialized = JSON.stringify(localJournal)
    if (serialized.length > MAX_JOURNAL_BYTES) throw new RangeError('设置同步日志过大')
    const key = settingsJournalKey(syncClientId, settingsJournalSequence(localJournal))
    const supersededKey = persistedLocalJournalKey
    const supersededRaw = persistedLocalJournalRaw
    const canSupersedeCurrent = Boolean(
      supersededKey &&
      supersededRaw &&
      window.localStorage.getItem(supersededKey) === supersededRaw,
    )
    if (inspection.scan.records.length >= MAX_JOURNAL_RECORDS && !canSupersedeCurrent) {
      throw new RangeError('设置同步日志已满，已停止写入以保留现有恢复记录')
    }

    window.localStorage.setItem(key, serialized)
    if (window.localStorage.getItem(key) !== serialized) {
      throw new Error('设置同步日志写入后校验失败')
    }
    if (supersededKey && supersededRaw && supersededKey !== key) {
      supersededLocalJournalKeys.set(supersededKey, supersededRaw)
    }
    persistedLocalJournalKey = key
    persistedLocalJournalRaw = serialized
    localJournalNeedsWrite = false
    return cleanupSupersededLocalJournals()
  }

  function availableSettingsJournals(): SettingsJournalScan {
    const scan = readStoredSettingsJournals()
    const { records } = scan
    const storedLocalJournalRaw = persistedLocalJournalKey
      ? window.localStorage.getItem(persistedLocalJournalKey)
      : null
    const localJournalIsPersisted = Boolean(
      persistedLocalJournalKey &&
      persistedLocalJournalRaw &&
      records.some(
        (record) =>
          record.key === persistedLocalJournalKey && record.raw === persistedLocalJournalRaw,
      ),
    )
    if (
      persistedLocalJournalKey &&
      storedLocalJournalRaw !== null &&
      storedLocalJournalRaw !== persistedLocalJournalRaw
    ) {
      scan.invalid = true
    }
    if (!isSettingsJournalEmpty(localJournal) && !localJournalIsPersisted) {
      const journal = cloneSettingsJournal(localJournal)
      records.push({
        key: settingsJournalKey(syncClientId, settingsJournalSequence(journal)),
        raw: JSON.stringify(journal),
        journal,
      })
    }
    records.sort((first, second) => {
      const clientOrder = compareSyncClientIds(first.journal.clientId, second.journal.clientId)
      if (clientOrder !== 0) return clientOrder
      return settingsJournalSequence(first.journal) - settingsJournalSequence(second.journal)
    })
    return scan
  }

  function supportedSettingsJournals(settings: StoredSettings): SettingsJournalScan | null {
    const scan = availableSettingsJournals()
    journalCleanupBlocked = scan.invalid
    if (scan.future) {
      enterReadOnly(settings)
      return null
    }
    return scan
  }

  function replaySettingsJournals(
    remoteSettings: StoredSettings,
    journals: SettingsJournalRecord[],
  ): { settings: StoredSettings; applied: SettingsJournalRecord[]; blocked: boolean } {
    const remoteClock = Object.assign(
      Object.create(null) as Record<string, number>,
      remoteSettings.syncClock,
    )
    let mergedSettings = cloneStoredSettings(remoteSettings)
    const applied: SettingsJournalRecord[] = []
    let blocked = false
    const pending = journals
      .map((record) => ({
        record,
        operation: materializeSettingsJournal(
          record.journal,
          syncSequence(remoteClock, record.journal.clientId),
        ),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          record: SettingsJournalRecord
          operation: PendingSettingsOperation
        } => candidate.operation !== null,
      )

    while (pending.length > 0) {
      const readyIndex = pending.findIndex(({ record }) =>
        Object.entries(record.journal.dependencyClock).every(
          ([clientId, sequence]) =>
            clientId === record.journal.clientId ||
            syncSequence(mergedSettings.syncClock, clientId) >= sequence,
        ),
      )
      if (readyIndex < 0) {
        journalCleanupBlocked = true
        blocked = true
        const acknowledgedClock = Object.assign(
          Object.create(null) as Record<string, number>,
          mergedSettings.syncClock,
        )
        const acknowledgedWriter = mergedSettings.syncWriter
        for (const { operation } of pending) {
          mergedSettings = mergeStoredSettings(
            mergedSettings,
            operation.settings,
            operation.baseline,
            operation.dirtyFields,
          )
          mergedSettings.syncClock = Object.assign(
            Object.create(null) as Record<string, number>,
            acknowledgedClock,
          )
          mergedSettings.syncWriter = acknowledgedWriter
        }
        break
      }

      const candidate = pending.splice(readyIndex, 1)[0]
      const { record, operation } = candidate
      mergedSettings = mergeStoredSettings(
        mergedSettings,
        operation.settings,
        operation.baseline,
        operation.dirtyFields,
      )
      applied.push(record)
    }
    return { settings: mergedSettings, applied, blocked }
  }

  function replaySettingsJournalsWithLocalCheckpoint(
    remoteSettings: StoredSettings,
    initialScan: SettingsJournalScan,
  ): {
    scan: SettingsJournalScan
    replayed: ReturnType<typeof replaySettingsJournals>
  } | null {
    let scan = initialScan
    let replayed = replaySettingsJournals(remoteSettings, scan.records)
    if (!replayed.blocked && !isSettingsJournalEmpty(localJournal)) {
      const dependencyClock = journalDependencyClock(replayed.settings.syncClock, syncClientId)
      if (!clocksEqual(localJournal.dependencyClock, dependencyClock)) {
        const nextSequence =
          Math.max(localSequence, syncSequence(replayed.settings.syncClock, syncClientId)) + 1
        localJournal = rebaseSettingsJournal(
          localJournal,
          replayed.settings,
          nextSequence,
          dependencyClock,
        )
        localSequence = nextSequence
        localJournalNeedsWrite = true
        replayed.settings.syncClock[syncClientId] = nextSequence
        replayed.settings.syncWriter = syncClientId
        if (!persistLocalJournal()) return null

        const rescanned = supportedSettingsJournals(remoteSettings)
        if (!rescanned) return null
        scan = rescanned
        replayed = replaySettingsJournals(remoteSettings, scan.records)
      }
    }
    return { scan, replayed }
  }

  function cleanupAcknowledgedJournals(settings: StoredSettings): boolean {
    const inspection = inspectStorageForWrite(true)
    if (!inspection) return false
    if (journalCleanupBlocked) return true

    for (const record of inspection.scan.records) {
      const { journal } = record
      if (settingsJournalSequence(journal) > syncSequence(settings.syncClock, journal.clientId)) {
        continue
      }
      const dependenciesSatisfied = Object.entries(journal.dependencyClock).every(
        ([clientId, sequence]) => syncSequence(settings.syncClock, clientId) >= sequence,
      )
      if (!dependenciesSatisfied) {
        journalCleanupBlocked = true
        return true
      }
    }

    for (const record of inspection.scan.records) {
      const { journal } = record
      if (settingsJournalSequence(journal) > syncSequence(settings.syncClock, journal.clientId)) {
        continue
      }
      try {
        if (window.localStorage.getItem(record.key) === record.raw) {
          window.localStorage.removeItem(record.key)
          supersededLocalJournalKeys.delete(record.key)
          if (record.key === persistedLocalJournalKey) {
            persistedLocalJournalKey = null
            persistedLocalJournalRaw = null
          }
        }
      } catch {
        // A stale acknowledged journal is harmless because its sequence is already in the snapshot.
      }
    }
    const localAcknowledgedSequence = syncSequence(settings.syncClock, syncClientId)
    if (localAcknowledgedSequence > 0) {
      localJournal = pruneSettingsJournal(localJournal, localAcknowledgedSequence)
      if (isSettingsJournalEmpty(localJournal)) localJournalNeedsWrite = false
    }
    return true
  }

  function enterReadOnly(settings: StoredSettings): void {
    storageReadOnly = true
    needsMigration = false
    localJournal = createSettingsJournal(syncClientId)
    localJournalNeedsWrite = false
    persistedLocalJournalKey = null
    persistedLocalJournalRaw = null
    supersededLocalJournalKeys.clear()
    pendingCheckpointCandidate = null
    unflushedBaseline = null
    lastSyncedSettings = cloneStoredSettings(settings)
    applySettings(settings)
    stableViewSettings = cloneStoredSettings(settings)
    persistenceError.value = FUTURE_SCHEMA_ERROR
  }

  function readSettingsForWrite(): ParsedSettings {
    const raw = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)
    if (!raw) {
      return { settings: createDefaultSettings(), readOnly: false, needsMigration: false }
    }
    try {
      return parseSettingsValue(raw)
    } catch {
      return {
        settings: cloneStoredSettings(lastSyncedSettings),
        readOnly: false,
        needsMigration: false,
      }
    }
  }

  function writeSnapshot(settings: StoredSettings): boolean {
    let snapshot = cloneStoredSettings(settings)
    if (supportsSettingsWriteLock() && !holdsSettingsWriteLock) {
      if (
        pendingCheckpointCandidate &&
        compareCheckpointCandidates(pendingCheckpointCandidate, snapshot) >= 0
      ) {
        snapshot = cloneStoredSettings(pendingCheckpointCandidate)
      }
      pendingCheckpointCandidate = cloneStoredSettings(snapshot)
      applySettings(snapshot)
      stableViewSettings = cloneStoredSettings(snapshot)
      persistenceError.value = journalCleanupBlocked
        ? '设置同步日志损坏或依赖不完整，已停止清理并保留最后合法状态'
        : ''
      scheduleSettingsCheckpoint()
      return true
    }

    const serialized = JSON.stringify(snapshot)
    if (!inspectStorageForWrite(true)) return false
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, serialized)
    const snapshotReadBack = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) === serialized
    if (!snapshotReadBack) throw new Error('设置主快照写入后校验失败')
    if (!inspectStorageForWrite(true)) return false
    lastSyncedSettings = cloneStoredSettings(snapshot)
    applySettings(snapshot)
    stableViewSettings = cloneStoredSettings(snapshot)
    if (holdsSettingsWriteLock && !journalCleanupBlocked && snapshotReadBack) {
      if (!cleanupAcknowledgedJournals(snapshot)) return false
    }
    if (
      snapshotReadBack &&
      pendingCheckpointCandidate &&
      settingsSnapshotAcknowledges(snapshot, pendingCheckpointCandidate)
    ) {
      pendingCheckpointCandidate = null
    }
    needsMigration = false
    persistenceError.value = journalCleanupBlocked
      ? '设置同步日志损坏或依赖不完整，已停止清理并保留最后合法状态'
      : ''
    return true
  }

  function scheduleSettingsCheckpoint(): void {
    if (!supportsSettingsWriteLock() || storageReadOnly || storeDisposed) return
    checkpointRevision += 1
    requestSettingsCheckpoint()
  }

  function requestSettingsCheckpoint(): void {
    if (!supportsSettingsWriteLock() || checkpointRequested || storageReadOnly || storeDisposed) {
      return
    }
    checkpointRequested = true
    let callbackStarted = false
    void navigator.locks
      .request(SETTINGS_WRITE_LOCK_NAME, async () => {
        callbackStarted = true
        const attemptedRevision = checkpointRevision
        if (storageReadOnly) {
          checkpointAttemptedRevision = attemptedRevision
          return
        }
        holdsSettingsWriteLock = true
        try {
          writeSettings()
        } finally {
          checkpointAttemptedRevision = attemptedRevision
          holdsSettingsWriteLock = false
        }
      })
      .catch(() => {
        persistenceError.value = '本机设置已写入恢复日志，主快照将在下次操作时重试'
      })
      .finally(() => {
        checkpointRequested = false
        if (
          callbackStarted &&
          !storeDisposed &&
          !storageReadOnly &&
          checkpointRevision > checkpointAttemptedRevision
        ) {
          requestSettingsCheckpoint()
        }
      })
  }

  function writeSettings(): boolean {
    if (typeof window === 'undefined') return true
    if (storageReadOnly) {
      persistenceError.value = FUTURE_SCHEMA_ERROR
      return false
    }
    try {
      const initialParsed = readSettingsForWrite()
      if (initialParsed.readOnly) {
        enterReadOnly(initialParsed.settings)
        return false
      }
      const initialJournalScan = readStoredSettingsJournals()
      journalCleanupBlocked = initialJournalScan.invalid
      if (initialJournalScan.future) {
        enterReadOnly(initialParsed.settings)
        return false
      }

      stageUnflushedOperation()
      if (!persistLocalJournal()) return false

      const parsed = readSettingsForWrite()
      if (parsed.readOnly) {
        enterReadOnly(parsed.settings)
        return false
      }
      const checkpointCandidate = holdsSettingsWriteLock ? pendingCheckpointCandidate : null
      const candidateWinsCheckpoint = Boolean(
        checkpointCandidate &&
        (clockStrictlyDominates(checkpointCandidate.syncClock, parsed.settings.syncClock) ||
          (clocksEqual(checkpointCandidate.syncClock, parsed.settings.syncClock) &&
            compareCheckpointCandidates(checkpointCandidate, parsed.settings) > 0)),
      )
      const settingsForReplay =
        checkpointCandidate && candidateWinsCheckpoint
          ? cloneStoredSettings(checkpointCandidate)
          : parsed.settings
      const initialScan = supportedSettingsJournals(settingsForReplay)
      if (!initialScan) return false
      const reconciliation = replaySettingsJournalsWithLocalCheckpoint(
        settingsForReplay,
        initialScan,
      )
      if (!reconciliation) return false
      const { scan, replayed } = reconciliation
      if (replayed.applied.length === 0 && !needsMigration) {
        if (
          holdsSettingsWriteLock &&
          !replayed.blocked &&
          (scan.records.length > 0 || candidateWinsCheckpoint)
        ) {
          return writeSnapshot(settingsForReplay)
        }
        lastSyncedSettings = cloneStoredSettings(parsed.settings)
        applySettings(replayed.settings)
        stableViewSettings = cloneStoredSettings(replayed.settings)
        persistenceError.value = journalCleanupBlocked
          ? '设置同步日志损坏或依赖不完整，已停止清理并保留最后合法状态'
          : ''
        if (scan.records.length > 0) scheduleSettingsCheckpoint()
        if (
          holdsSettingsWriteLock &&
          pendingCheckpointCandidate &&
          settingsSnapshotAcknowledges(parsed.settings, pendingCheckpointCandidate)
        ) {
          pendingCheckpointCandidate = null
        }
        return true
      }

      return writeSnapshot(replayed.settings)
    } catch {
      if (storageReadOnly) return false
      persistenceError.value = '本机存储写入失败，本次设置变更可能无法保留'
      return false
    }
  }

  function persist(): void {
    if (storageReadOnly) {
      applySettings(stableViewSettings)
      persistenceError.value = FUTURE_SCHEMA_ERROR
      return
    }
    if (!unflushedBaseline) unflushedBaseline = cloneStoredSettings(stableViewSettings)
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      writeSettings()
    }, 300)
  }

  /** 立即持久化（页面卸载前调用） */
  function persistImmediate(): boolean {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    if (storageReadOnly) {
      persistenceError.value = FUTURE_SCHEMA_ERROR
      return false
    }
    if (
      !unflushedBaseline &&
      !needsMigration &&
      materializeSettingsJournal(
        localJournal,
        syncSequence(lastSyncedSettings.syncClock, syncClientId),
      ) === null &&
      supersededLocalJournalKeys.size === 0
    ) {
      if (pendingCheckpointCandidate && supportsSettingsWriteLock()) {
        scheduleSettingsCheckpoint()
      }
      return true
    }
    return writeSettings()
  }

  function applySettings(settings: StoredSettings): void {
    currentSyncClock = Object.assign(
      Object.create(null) as Record<string, number>,
      settings.syncClock,
    )
    currentSyncWriter = settings.syncWriter
    subscriptionMode.value = settings.subscriptionMode
    subscribedDepts.value = [...settings.subscribedDepts]
    blacklistKeywords.value = [...settings.blacklistKeywords]
    starredIds.value = [...settings.starredIds]
    starredFolderMap.value = Object.assign(Object.create(null), settings.starredFolderMap)
    readIds.value = [...settings.readIds]
    pinnedIds.value = [...settings.pinnedIds]
    importantIds.value = [...settings.importantIds]
    customTags.value = Object.assign(Object.create(null), settings.customTags)
    darkMode.value = settings.darkMode
    folders.value = settings.folders.map((folder) => ({ ...folder }))
    notificationEnabled.value = settings.notificationEnabled
  }

  let mediaQuery: MediaQueryList | null = null
  const onSystemThemeChange = (event: MediaQueryListEvent) => {
    systemPrefersDark.value = event.matches
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(USER_SETTINGS_JOURNAL_NAMESPACE)) {
      if (storageReadOnly) return
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      writeSettings()
      return
    }
    if (event.key !== USER_SETTINGS_STORAGE_KEY) return
    try {
      const parsed =
        event.newValue === null
          ? { settings: createDefaultSettings(), readOnly: false, needsMigration: false }
          : parseSettingsValue(event.newValue)
      if (parsed.readOnly) {
        if (persistTimer) {
          clearTimeout(persistTimer)
          persistTimer = null
        }
        enterReadOnly(parsed.settings)
        return
      }

      const remoteSettings = parsed.settings
      const compatibilityScan = readStoredSettingsJournals()
      journalCleanupBlocked = compatibilityScan.invalid
      if (compatibilityScan.future) {
        enterReadOnly(remoteSettings)
        return
      }
      if (
        event.newValue !== null &&
        clockStrictlyDominates(currentSyncClock, remoteSettings.syncClock)
      ) {
        const currentRaw = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)
        if (currentRaw === event.newValue) {
          stageUnflushedOperation()
          if (!persistLocalJournal()) return
          const currentSettings = createSnapshot()
          const initialScan = supportedSettingsJournals(currentSettings)
          if (!initialScan) return
          const reconciliation = replaySettingsJournalsWithLocalCheckpoint(
            currentSettings,
            initialScan,
          )
          if (!reconciliation) return
          writeSnapshot(reconciliation.replayed.settings)
        }
        return
      }
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      storageReadOnly = false
      needsMigration = parsed.needsMigration
      stageUnflushedOperation()
      if (!persistLocalJournal()) return
      const initialScan = supportedSettingsJournals(remoteSettings)
      if (!initialScan) return
      const reconciliation = replaySettingsJournalsWithLocalCheckpoint(remoteSettings, initialScan)
      if (!reconciliation) return
      const { replayed } = reconciliation

      if (
        replayed.applied.length === 0 &&
        clocksEqual(currentSyncClock, remoteSettings.syncClock) &&
        compareSyncClientIds(currentSyncWriter, remoteSettings.syncWriter) > 0
      ) {
        const currentRaw = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)
        if (currentRaw === event.newValue) writeSnapshot(createSnapshot())
        return
      }

      lastSyncedSettings = cloneStoredSettings(remoteSettings)
      applySettings(replayed.settings)
      stableViewSettings = cloneStoredSettings(replayed.settings)
      persistenceError.value = replayed.blocked
        ? '设置同步日志损坏或依赖不完整，已停止清理并保留最后合法状态'
        : ''
      if (replayed.applied.length > 0 || needsMigration) {
        writeSnapshot(replayed.settings)
      }
    } catch {
      if (storageReadOnly) return
      if (!inspectStorageForWrite()) return
      const currentRaw = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY)
      try {
        stageUnflushedOperation()
        if (!persistLocalJournal()) return
        const initialScan = supportedSettingsJournals(lastSyncedSettings)
        if (!initialScan) return
        const reconciliation = replaySettingsJournalsWithLocalCheckpoint(
          lastSyncedSettings,
          initialScan,
        )
        if (!reconciliation) return
        const { replayed: repaired } = reconciliation
        const localSaved = currentRaw === event.newValue ? writeSnapshot(repaired.settings) : true
        if (localSaved) {
          persistenceError.value = '其他页签传来的设置无效，已保留当前设置并修复本机存储'
        }
      } catch {
        if (storageReadOnly) return
        persistenceError.value = '本机存储写入失败，本次设置变更可能无法保留'
      }
    }
  }

  if (typeof window !== 'undefined') {
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      systemPrefersDark.value = mediaQuery.matches
      mediaQuery.addEventListener('change', onSystemThemeChange)
    }
    window.addEventListener('beforeunload', persistImmediate)
    window.addEventListener('storage', onStorage)

    if (!storageReadOnly) {
      try {
        const scan = supportedSettingsJournals(saved)
        if (scan) {
          const recovered = replaySettingsJournals(saved, scan.records)
          if (recovered.blocked) {
            persistenceError.value = '设置同步日志损坏或依赖不完整，已停止清理并保留最后合法状态'
            applySettings(recovered.settings)
            stableViewSettings = cloneStoredSettings(recovered.settings)
          }
          if (recovered.applied.length > 0 || needsMigration) {
            writeSnapshot(recovered.settings)
          }
        }
      } catch {
        if (!storageReadOnly) {
          persistenceError.value = '本机设置恢复失败，部分未同步变更可能无法保留'
        }
      }
    }
  }

  onScopeDispose(() => {
    storeDisposed = true
    if (persistTimer) clearTimeout(persistTimer)
    mediaQuery?.removeEventListener('change', onSystemThemeChange)
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', persistImmediate)
      window.removeEventListener('storage', onStorage)
    }
  })

  // ---- 操作 ----
  function toggleDepartment(dept: string): void {
    const normalizedDept = normalizeNoticeSource(dept)
    if (!VALID_DEPARTMENT_NAMES.has(normalizedDept)) return
    if (subscriptionMode.value === 'all') {
      subscriptionMode.value = 'custom'
      subscribedDepts.value = DEPARTMENTS.map((item) => item.name).filter(
        (name) => name !== normalizedDept,
      )
      persist()
      return
    }

    const idx = subscribedDepts.value.indexOf(normalizedDept)
    if (idx >= 0) {
      subscribedDepts.value.splice(idx, 1)
    } else {
      subscribedDepts.value.push(normalizedDept)
    }
    persist()
  }

  function addKeyword(keyword: string): void {
    const kw = keyword.trim()
    if (!kw || kw.length > 200 || blacklistKeywords.value.includes(kw)) return
    if (blacklistKeywords.value.length >= MAX_STORED_ITEMS) {
      persistenceError.value = `关键词最多保存 ${MAX_STORED_ITEMS} 项`
      return
    }
    if (kw) {
      blacklistKeywords.value.push(kw)
      persist()
    }
  }

  function removeKeyword(keyword: string): void {
    const idx = blacklistKeywords.value.indexOf(keyword)
    if (idx >= 0) {
      blacklistKeywords.value.splice(idx, 1)
      persist()
    }
  }

  function toggleStar(id: string, folderId?: string): void {
    if (!isValidNoticeId(id)) return
    const idx = starredIds.value.indexOf(id)
    if (idx >= 0) {
      starredIds.value.splice(idx, 1)
      delete starredFolderMap.value[id]
    } else {
      if (starredIds.value.length >= MAX_STORED_ITEMS) {
        persistenceError.value = `收藏最多保存 ${MAX_STORED_ITEMS} 条`
        return
      }
      starredIds.value.push(id)
      starredFolderMap.value[id] =
        folderId && folders.value.some((folder) => folder.id === folderId) ? folderId : 'default'
    }
    persist()
  }

  function togglePin(id: string): void {
    if (!isValidNoticeId(id)) return
    const idx = pinnedIds.value.indexOf(id)
    if (idx >= 0) {
      pinnedIds.value.splice(idx, 1)
    } else {
      if (pinnedIds.value.length >= MAX_STORED_ITEMS) {
        persistenceError.value = `置顶最多保存 ${MAX_STORED_ITEMS} 条`
        return
      }
      pinnedIds.value.push(id)
    }
    persist()
  }

  function toggleImportant(id: string): void {
    if (!isValidNoticeId(id)) return
    const idx = importantIds.value.indexOf(id)
    if (idx >= 0) {
      importantIds.value.splice(idx, 1)
    } else {
      if (importantIds.value.length >= MAX_STORED_ITEMS) {
        persistenceError.value = `重要通知最多保存 ${MAX_STORED_ITEMS} 条`
        return
      }
      importantIds.value.push(id)
    }
    persist()
  }

  function addCustomTag(id: string, tag: string): void {
    const normalizedTag = tag.trim()
    if (!isValidNoticeId(id) || normalizedTag.length === 0 || normalizedTag.length > 50) {
      return
    }
    if (!Object.hasOwn(customTags.value, id)) {
      if (Object.keys(customTags.value).length >= MAX_STORED_ITEMS) {
        persistenceError.value = `自定义标签最多关联 ${MAX_STORED_ITEMS} 条通知`
        return
      }
      customTags.value[id] = []
    }
    if (
      customTags.value[id].length < MAX_TAGS_PER_NOTICE &&
      !customTags.value[id].includes(normalizedTag)
    ) {
      customTags.value[id].push(normalizedTag)
      persist()
    }
  }

  function removeCustomTag(id: string, tag: string): void {
    const tags = Object.hasOwn(customTags.value, id) ? customTags.value[id] : undefined
    if (tags) {
      const idx = tags.indexOf(tag)
      if (idx >= 0) {
        tags.splice(idx, 1)
        if (tags.length === 0) {
          delete customTags.value[id]
        }
        persist()
      }
    }
  }

  function moveToFolder(id: string, folderId: string): void {
    if (!isValidNoticeId(id)) return
    const targetFolderId = folders.value.some((folder) => folder.id === folderId)
      ? folderId
      : 'default'
    if (!starredIds.value.includes(id)) {
      if (starredIds.value.length >= MAX_STORED_ITEMS) {
        persistenceError.value = `收藏最多保存 ${MAX_STORED_ITEMS} 条`
        return
      }
      starredIds.value.push(id)
    }
    starredFolderMap.value[id] = targetFolderId
    persist()
  }

  function getStarredInFolder(folderId: string): string[] {
    return starredIds.value.filter((id) => starredFolderMap.value[id] === folderId)
  }

  function addFolder(name: string, icon: string): Folder | null {
    if (storageReadOnly) {
      persistenceError.value = FUTURE_SCHEMA_ERROR
      return null
    }
    if (folders.value.length >= USER_FOLDER_LIMIT) {
      persistenceError.value = `最多只能创建 ${USER_FOLDER_LIMIT} 个收藏夹`
      return null
    }
    const createdAt = Date.now()
    folderIdSequence += 1
    let id = `folder-${syncClientId}-${folderIdSequence.toString(36)}`
    while (folders.value.some((folder) => folder.id === id)) {
      folderIdSequence += 1
      id = `folder-${syncClientId}-${folderIdSequence.toString(36)}`
    }
    const folder: Folder = {
      id,
      name: name.trim().slice(0, 100) || '未命名收藏夹',
      icon: normalizeFolderIcon(icon),
      createdAt,
    }
    folders.value.push(folder)
    persist()
    return folder
  }

  function removeFolder(folderId: string): void {
    if (folderId === 'default') return
    starredIds.value.forEach((id) => {
      if (starredFolderMap.value[id] === folderId) {
        starredFolderMap.value[id] = 'default'
      }
    })
    folders.value = folders.value.filter((f) => f.id !== folderId)
    persist()
  }

  function renameFolder(folderId: string, newName: string): void {
    const folder = folders.value.find((f) => f.id === folderId)
    const normalizedName = newName.trim().slice(0, 100)
    if (folder && normalizedName) {
      folder.name = normalizedName
      persist()
    }
  }

  function markRead(id: string): void {
    if (isValidNoticeId(id) && !readIds.value.includes(id)) {
      readIds.value.push(id)
      if (readIds.value.length > MAX_STORED_ITEMS) readIds.value.shift()
      persist()
    }
  }

  function markCachedNoticesRead(): void {
    const cachedIds = Array.from(noticeCache.value.keys())
    let changed = false
    cachedIds.forEach((id) => {
      if (!readIds.value.includes(id)) {
        readIds.value.push(id)
        changed = true
      }
    })
    if (readIds.value.length > MAX_STORED_ITEMS) {
      readIds.value = readIds.value.slice(-MAX_STORED_ITEMS)
    }
    if (changed) persist()
  }

  function setDarkMode(mode: DarkMode): void {
    if (darkMode.value === mode) return
    darkMode.value = mode
    persist()
  }

  function setNotificationEnabled(enabled: boolean): void {
    if (notificationEnabled.value === enabled) return
    notificationEnabled.value = enabled
    persist()
  }

  /** 缓存通知数据供跨页面使用 */
  function cacheNotice(notice: NoticeItem): void {
    noticeCache.value.delete(notice.id)
    noticeCache.value.set(notice.id, notice)
    if (noticeCache.value.size > MAX_NOTICE_CACHE_ITEMS) {
      const oldestId = noticeCache.value.keys().next().value
      if (oldestId !== undefined) noticeCache.value.delete(oldestId)
    }
  }

  function cacheNotices(notices: NoticeItem[]): void {
    for (const notice of notices) cacheNotice(notice)
  }

  function getCachedNotice(id: string): NoticeItem | undefined {
    const notice = noticeCache.value.get(id)
    if (notice) {
      noticeCache.value.delete(id)
      noticeCache.value.set(id, notice)
    }
    return notice
  }

  function clearPersistenceError(): void {
    persistenceError.value = storageReadOnly ? FUTURE_SCHEMA_ERROR : ''
  }

  return {
    // 状态
    subscriptionMode,
    subscribedDepts,
    blacklistKeywords,
    starredIds,
    starredFolderMap,
    readIds,
    pinnedIds,
    importantIds,
    customTags,
    darkMode,
    folders,
    notificationEnabled,
    persistenceError,
    noticeCache,
    // 查询
    isSubscribed,
    isStarred,
    isRead,
    isPinned,
    isImportant,
    isDark,
    urgentStarredIds,
    allCustomTags,
    // 操作
    toggleDepartment,
    addKeyword,
    removeKeyword,
    toggleStar,
    togglePin,
    toggleImportant,
    addCustomTag,
    removeCustomTag,
    moveToFolder,
    getStarredInFolder,
    addFolder,
    removeFolder,
    renameFolder,
    markRead,
    markCachedNoticesRead,
    setDarkMode,
    setNotificationEnabled,
    persistImmediate,
    cacheNotice,
    cacheNotices,
    getCachedNotice,
    clearPersistenceError,
  }
})
