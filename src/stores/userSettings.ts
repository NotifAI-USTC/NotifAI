import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import type { NoticeItem } from '../types/notice'
import { DEPARTMENTS } from '../types/notice'
import { isValidNoticeId } from '../utils/validation'
import type { Folder } from '../types/folder'
import {
  FUTURE_SCHEMA_ERROR,
  MAX_JOURNAL_BYTES,
  MAX_JOURNAL_RECORDS,
  MAX_NOTICE_CACHE_ITEMS,
  MAX_STORED_ITEMS,
  MAX_TAGS_PER_NOTICE,
  SETTINGS_WRITE_LOCK_NAME,
  USER_FOLDER_LIMIT,
  USER_SETTINGS_JOURNAL_NAMESPACE,
  USER_SETTINGS_JOURNAL_PREFIX,
  USER_SETTINGS_SCHEMA_VERSION,
  USER_SETTINGS_STORAGE_KEY,
  appendOperationToJournal,
  clockStrictlyDominates,
  clocksEqual,
  cloneSettingsJournal,
  cloneStoredSettings,
  compareCheckpointCandidates,
  compareSyncClientIds,
  createDefaultSettings,
  createSettingsJournal,
  createSyncClientId,
  getDirtyFields,
  isSettingsJournalEmpty,
  journalDependencyClock,
  loadSettings,
  materializeSettingsJournal,
  mergeStoredSettings,
  mergeSyncClocks,
  normalizeDepartmentName,
  normalizeFolderIcon,
  parseSettingsValue,
  pruneSettingsJournal,
  readStoredSettingsJournals,
  rebaseSettingsJournal,
  settingsJournalKey,
  settingsJournalSequence,
  settingsSnapshotAcknowledges,
  supportsSettingsWriteLock,
  syncSequence,
} from './settingsPersistence'
import type {
  DarkMode,
  ParsedSettings,
  PendingSettingsOperation,
  SettingsJournalRecord,
  SettingsJournalScan,
  StoredSettings,
  SubscriptionMode,
} from './settingsPersistence'

// 对外兼容导出（由 settingsPersistence 提供实现）
export {
  USER_FOLDER_LIMIT,
  USER_SETTINGS_JOURNAL_PREFIX,
  USER_SETTINGS_SCHEMA_VERSION,
  USER_SETTINGS_STORAGE_KEY,
}
export type { DarkMode } from './settingsPersistence'

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

  // Static departments are a fallback. Keep runtime sources discovered from
  // GET /sources so switching one of them can build a complete custom list.
  const availableSourceNames = new Set([
    ...DEPARTMENTS.map((department) => department.name),
    ...saved.subscribedDepts,
  ])

  /** 已拉取通知的内存缓存 */
  const noticeCache = ref<Map<string, NoticeItem>>(new Map())

  // ---- 查询 ----
  const isSubscribed = computed(() => (dept: string) => {
    const normalizedDept = normalizeDepartmentName(dept)
    return (
      subscriptionMode.value === 'all' ||
      (normalizedDept !== null && subscribedDepts.value.includes(normalizedDept))
    )
  })
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
  function registerSources(sourceNames: readonly string[]): void {
    for (const sourceName of sourceNames) {
      const normalized = normalizeDepartmentName(sourceName)
      if (normalized) availableSourceNames.add(normalized)
    }
  }

  function toggleDepartment(dept: string): void {
    const normalizedDept = normalizeDepartmentName(dept)
    if (!normalizedDept || !availableSourceNames.has(normalizedDept)) return
    if (subscriptionMode.value === 'all') {
      subscriptionMode.value = 'custom'
      subscribedDepts.value = [...availableSourceNames].filter(
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

  /** 导出全部用户偏好为 JSON 字符串（含版本号，便于重新导入）。 */
  function exportSettings(): string {
    const payload: Record<string, unknown> = {
      schemaVersion: USER_SETTINGS_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      subscriptionMode: subscriptionMode.value,
      subscribedDepts: [...subscribedDepts.value],
      blacklistKeywords: [...blacklistKeywords.value],
      starredIds: [...starredIds.value],
      starredFolderMap: Object.assign({}, starredFolderMap.value),
      readIds: [...readIds.value],
      pinnedIds: [...pinnedIds.value],
      importantIds: [...importantIds.value],
      customTags: Object.fromEntries(
        Object.entries(customTags.value).map(([id, tags]) => [id, [...tags]]),
      ),
      darkMode: darkMode.value,
      folders: folders.value.map((folder) => ({ ...folder })),
      notificationEnabled: notificationEnabled.value,
    }
    return JSON.stringify(payload, null, 2)
  }

  /** 导入偏好 JSON：校验后作为新的本地基线快照写入并应用。 */
  function importSettings(json: string): { ok: boolean; message: string } {
    try {
      const parsed = parseSettingsValue(json)
      if (parsed.readOnly) return { ok: false, message: FUTURE_SCHEMA_ERROR }
      if (storageReadOnly || typeof window === 'undefined') {
        return { ok: false, message: FUTURE_SCHEMA_ERROR }
      }
      const settings = parsed.settings
      window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
      applySettings(settings)
      // 重置本地同步状态，使导入内容成为新的基线
      localSequence = syncSequence(settings.syncClock, syncClientId)
      lastSyncedSettings = cloneStoredSettings(settings)
      stableViewSettings = cloneStoredSettings(settings)
      currentSyncClock = Object.assign(
        Object.create(null) as Record<string, number>,
        settings.syncClock,
      )
      currentSyncWriter = settings.syncWriter
      localJournal = createSettingsJournal(syncClientId)
      localJournalNeedsWrite = false
      persistedLocalJournalKey = null
      persistedLocalJournalRaw = null
      supersededLocalJournalKeys.clear()
      unflushedBaseline = null
      needsMigration = false
      return { ok: true, message: parsed.needsMigration ? '已导入并迁移到当前版本' : '偏好设置已导入' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '偏好导入失败',
      }
    }
  }

  /** 清空全部已读记录。 */
  function clearReadHistory(): void {
    if (readIds.value.length === 0) return
    readIds.value = []
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
    registerSources,
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
    exportSettings,
    importSettings,
    clearReadHistory,
    persistImmediate,
    cacheNotice,
    cacheNotices,
    getCachedNotice,
    clearPersistenceError,
  }
})
