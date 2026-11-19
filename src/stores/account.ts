import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import * as api from '../utils/accountApi'
import { defaultCloudSettings, parseCloudSettings, type CloudSettings } from '../utils/cloudSettings'
import { isRecord } from './settingsPersistence'

type SyncStatus = 'idle' | 'saving' | 'synced' | 'dirty' | 'conflict'

const IMPORT_KEY = 'notifai-account-import'
const SESSION_CHANGE_KEY = 'notifai-account-session-change'
const SESSION_WRITE_LOCK = 'notifai-account-session-write'
const PAGE_NOTICE_KEY = 'notifai-account-page-notice'
type PageNotice = 'discarded' | 'import-unavailable'

function takePageNotice(): PageNotice | null {
  const state: unknown = window.history.state
  if (!isRecord(state)) return null
  const notice = state[PAGE_NOTICE_KEY]
  if (notice !== 'discarded' && notice !== 'import-unavailable') return null
  const next = { ...state }
  delete next[PAGE_NOTICE_KEY]
  window.history.replaceState(next, '')
  return notice
}

export const useAccountStore = defineStore('account', () => {
  const user = shallowRef<api.AccountUser | null>(null)
  const cloudReady = ref(false)
  const initialSettings = shallowRef<CloudSettings | null>(null)
  const revision = ref(0)
  const startupUnavailable = ref(false)
  const transitioning = ref(false)
  const pageNotice = ref<PageNotice | null>(null)
  const importCandidate = shallowRef<CloudSettings | null>(null)
  const loginDialogOpen = ref(false)
  const syncStatus = ref<SyncStatus>('idle')
  const saving = ref(false)
  const loadingCloud = ref(false)
  const loggingOut = ref(false)
  const draft = shallowRef<{ settings: CloudSettings; key: string } | null>(null)
  const unsynced = computed(() => draft.value !== null)
  const conflictVersion = shallowRef<api.CloudSnapshot | null>(null)
  const conflictReadable = computed(() => conflictVersion.value !== null)
  const lifetime = new AbortController()
  let timer: number | undefined
  let baseline = ''
  let bypassUnload = false
  let sessionCheck: Promise<void> | undefined
  let sessionCheckRequested = false
  let sessionMutation: Promise<void> | undefined

  function dismissImport(): void {
    importCandidate.value = null
    try {
      window.sessionStorage.removeItem(IMPORT_KEY)
    } catch {
      // The current tab still dismisses the prompt.
    }
  }

  function loadImportCandidate(): void {
    try {
      const raw = window.sessionStorage.getItem(IMPORT_KEY)
      if (!raw) return
      const value: unknown = JSON.parse(raw)
      if (revision.value === 0 && isRecord(value) && value.userId === user.value?.id) {
        importCandidate.value = parseCloudSettings(value.settings)
        return
      }
    } catch {
      // A damaged or inaccessible candidate cannot be imported.
    }
    dismissImport()
  }

  function notifySessionChange(): void {
    try {
      window.localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID())
    } catch {
      // Other tabs recheck the account when they return to the foreground.
    }
  }

  function retire({ broadcast = false, notice }: { broadcast?: boolean; notice?: PageNotice } = {}) {
    if (lifetime.signal.aborted) return
    if (!broadcast && unsynced.value) notice = 'discarded'
    if (notice) {
      try {
        window.sessionStorage.setItem(PAGE_NOTICE_KEY, notice)
      } catch {
        try {
          window.history.replaceState({ ...window.history.state, [PAGE_NOTICE_KEY]: notice }, '')
        } catch {
          // Neither browser storage mechanism is available.
        }
      }
    }
    if (broadcast) notifySessionChange()
    bypassUnload = true
    transitioning.value = true
    lifetime.abort()
    clearTimeout(timer)
    window.location.reload()
  }

  function handleIdentityError(error: unknown): boolean {
    if (error instanceof api.AccountApiError && (error.code === 'AUTH_REQUIRED' || error.code === 'ACCOUNT_CHANGED')) {
      if (!lifetime.signal.aborted) retire()
      return true
    }
    return false
  }

  function accept(snapshot: api.CloudSnapshot): void {
    revision.value = snapshot.revision
    baseline = JSON.stringify(snapshot.settings ?? defaultCloudSettings())
    initialSettings.value = snapshot.settings
    cloudReady.value = true
  }

  async function bootstrap(): Promise<void> {
    try {
      const notice = window.sessionStorage.getItem(PAGE_NOTICE_KEY)
      if (notice === 'discarded' || notice === 'import-unavailable') {
        pageNotice.value = notice
        window.sessionStorage.removeItem(PAGE_NOTICE_KEY)
      }
    } catch {
      // A refused sessionStorage write can still leave a notice in history state.
    }
    try {
      pageNotice.value ??= takePageNotice()
    } catch {
      // Notices are best effort when the browser disables storage.
    }
    try {
      user.value = await api.getSession(lifetime.signal)
      if (user.value) {
        const snapshot = await api.getCloudSettings(user.value.id, lifetime.signal)
        if (lifetime.signal.aborted) return
        accept(snapshot)
        loadImportCandidate()
        syncStatus.value = 'synced'
      }
    } catch {
      if (lifetime.signal.aborted) return
      startupUnavailable.value = true
    }
  }

  async function drainSessionChecks(): Promise<void> {
    const signal = lifetime.signal
    try {
      while (sessionCheckRequested && !signal.aborted) {
        if (sessionMutation) {
          await sessionMutation.catch(() => undefined)
          continue
        }
        sessionCheckRequested = false
        // Connectivity failures do not change the account or discard a draft.
        const current = await api.getSession(signal).catch(() => undefined)
        if (signal.aborted) return
        if (sessionMutation) {
          sessionCheckRequested = true
        } else if (current !== undefined && current?.id !== user.value?.id) {
          retire()
          return
        }
      }
    } finally {
      sessionCheck = undefined
    }
  }

  async function checkSession(): Promise<void> {
    if (lifetime.signal.aborted) return
    sessionCheckRequested = true
    sessionCheck ??= Promise.resolve().then(drainSessionChecks)
    return sessionCheck
  }

  function changeSession(change: () => Promise<void>): Promise<void> {
    sessionMutation = Promise.resolve().then(change).finally(() => { sessionMutation = undefined })
    return sessionMutation
  }

  async function withSessionWriteLock(write: () => Promise<void>): Promise<void> {
    const signal = lifetime.signal
    let acquired = false
    try {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
      if (typeof locks?.request === 'function') {
        return await locks.request(SESSION_WRITE_LOCK, { signal }, () => {
          acquired = true
          return write()
        })
      }
    } catch (error) {
      if (acquired || signal.aborted || !(error instanceof DOMException) ||
        (error.name !== 'SecurityError' && error.name !== 'NotSupportedError')) throw error
    }
    // Older or restricted contexts still recheck before writing, without cross-tab exclusion.
    await write()
  }

  async function establishSession(write: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const signal = lifetime.signal
    if (user.value || sessionMutation || signal.aborted) throw new api.AccountApiError('ACCOUNT_CHANGED')
    await changeSession(() => withSessionWriteLock(async () => {
      if (signal.aborted) return
      // The preceding writer's Set-Cookie is now visible to this session check.
      const current = await api.getSession(signal)
      if (signal.aborted) return
      if (current) {
        retire()
        return
      }
      await write(signal)
    }))
  }

  async function signIn(username: string, password: string, candidate: CloudSettings): Promise<void> {
    await establishSession(async (signal) => {
      const loggedIn = await api.login(username, password, signal)
      if (signal.aborted) return
      let notice: PageNotice | undefined
      try {
        if (JSON.stringify(candidate) !== JSON.stringify(defaultCloudSettings())) {
          const settings = parseCloudSettings(candidate)
          window.sessionStorage.setItem(IMPORT_KEY, JSON.stringify({ userId: loggedIn.id, settings }))
        } else {
          dismissImport()
        }
      } catch {
        notice = 'import-unavailable'
      }
      retire({ broadcast: true, notice })
    })
  }

  async function registerWithOidc(formId: string, nickname: string): Promise<void> {
    await establishSession(async (signal) => {
      await api.completeOidcSignup(formId, nickname, signal)
      if (signal.aborted) return
      try {
        const url = new URL(window.location.href)
        const index = url.hash.indexOf('?')
        if (index !== -1) {
          const anchor = url.hash.indexOf('#', index + 1)
          const end = anchor === -1 ? url.hash.length : anchor
          const search = url.hash.slice(index + 1, end).split('&')
            .filter((part) => part && !new URLSearchParams(part).has('sso')).join('&')
          url.hash = url.hash.slice(0, index) + (search ? `?${search}` : '') + url.hash.slice(end)
          window.history.replaceState(window.history.state, '', url)
        }
      } catch {
        // The authenticated page clears the stale return marker after reload.
      }
      retire({ broadcast: true })
    })
  }

  async function signOut(): Promise<void> {
    const current = user.value
    if (!current || loggingOut.value || sessionMutation || lifetime.signal.aborted) return
    loggingOut.value = true
    await changeSession(async () => {
      try {
        await api.logout(current.id, lifetime.signal)
      } catch (error) {
        if (lifetime.signal.aborted) return
        if (error instanceof api.AccountApiError && error.code === 'ACCOUNT_CHANGED') {
          handleIdentityError(error)
          return
        }
        if (!(error instanceof api.AccountApiError && error.code === 'AUTH_REQUIRED')) throw error
      }
      if (lifetime.signal.aborted) return
      dismissImport()
      retire({ broadcast: true })
    }).finally(() => {
      loggingOut.value = false
      if (syncStatus.value === 'saving') void flush()
    })
  }

  function scheduleSave(settings: CloudSettings): void {
    if (!cloudReady.value || lifetime.signal.aborted) return
    const key = JSON.stringify(settings)
    if (draft.value?.key === key) return
    const stopped = syncStatus.value === 'dirty' || syncStatus.value === 'conflict'
    if (!saving.value && !stopped && key === baseline) {
      draft.value = null
      clearTimeout(timer)
      timer = undefined
      syncStatus.value = 'synced'
      return
    }
    draft.value = { settings, key }
    if (stopped) return
    syncStatus.value = 'saving'
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      void flush()
    }, 300)
  }

  async function importLocal(settings: CloudSettings): Promise<void> {
    if (!importCandidate.value || revision.value !== 0 || unsynced.value || loadingCloud.value || loggingOut.value) return
    scheduleSave(settings)
    clearTimeout(timer)
    timer = undefined
    await flush()
  }

  async function readCloud(): Promise<api.CloudSnapshot> {
    if (loadingCloud.value || loggingOut.value || lifetime.signal.aborted || !user.value) {
      throw new api.AccountApiError('NETWORK')
    }
    loadingCloud.value = true
    try {
      const result = await api.getCloudSettings(user.value.id, lifetime.signal)
      if (lifetime.signal.aborted || loggingOut.value) throw new api.AccountApiError('NETWORK')
      return result
    } catch (error) {
      handleIdentityError(error)
      throw error
    } finally {
      loadingCloud.value = false
    }
  }

  async function fetchConflict(): Promise<void> {
    if (syncStatus.value !== 'conflict' || loadingCloud.value) return
    try {
      conflictVersion.value = await readCloud()
    } catch {
      // Keep the draft, and do not enable overwrite without a confirmed revision.
      conflictVersion.value = null
    }
  }

  async function flush(): Promise<void> {
    const pending = draft.value
    if (
      !pending || !user.value || timer !== undefined || saving.value || loggingOut.value ||
      lifetime.signal.aborted || syncStatus.value === 'conflict' || syncStatus.value === 'dirty'
    ) return
    const expected = revision.value
    syncStatus.value = 'saving'
    saving.value = true
    try {
      const result = await api.putCloudSettings(user.value.id, expected, pending.settings, lifetime.signal)
      if (lifetime.signal.aborted) return
      if (!result.settings || JSON.stringify(result.settings) !== pending.key) {
        throw new api.AccountApiError('INVALID_RESPONSE')
      }
      revision.value = result.revision
      baseline = pending.key
      if (importCandidate.value) dismissImport()
      if (draft.value?.key === pending.key) {
        draft.value = null
        syncStatus.value = 'synced'
      }
    } catch (error) {
      if (lifetime.signal.aborted || handleIdentityError(error)) return
      clearTimeout(timer)
      timer = undefined
      if (error instanceof api.AccountApiError && error.code === 'REVISION_CONFLICT') {
        syncStatus.value = 'conflict'
        await fetchConflict()
      } else {
        syncStatus.value = 'dirty'
      }
    } finally {
      saving.value = false
      if (syncStatus.value === 'saving') void flush()
    }
  }

  async function retrySave(): Promise<void> {
    if (syncStatus.value !== 'dirty' || loggingOut.value) return
    syncStatus.value = 'saving'
    await flush()
  }

  async function useCloudVersion(): Promise<CloudSettings | null> {
    if (syncStatus.value !== 'conflict') throw new api.AccountApiError('NETWORK')
    const currentDraft = draft.value
    const snapshot = await readCloud()
    if (currentDraft !== draft.value) throw new api.AccountApiError('NETWORK')
    accept(snapshot)
    if (importCandidate.value) dismissImport()
    conflictVersion.value = null
    draft.value = null
    syncStatus.value = 'synced'
    return snapshot.settings
  }

  async function overwriteCloud(): Promise<void> {
    if (syncStatus.value !== 'conflict' || !conflictVersion.value || loadingCloud.value || saving.value || loggingOut.value) return
    revision.value = conflictVersion.value.revision
    conflictVersion.value = null
    syncStatus.value = 'saving'
    await flush()
  }

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!bypassUnload && unsynced.value) {
      event.preventDefault()
      event.returnValue = true
    }
  }

  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload)
  onScopeDispose(() => {
    lifetime.abort()
    clearTimeout(timer)
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload)
  })

  return {
    user, cloudReady, initialSettings, revision, startupUnavailable, loginDialogOpen,
    syncStatus, unsynced, loadingCloud, loggingOut, conflictReadable, transitioning, pageNotice,
    importCandidate, dismissImport, importLocal, signIn, signOut, checkSession, notifySessionChange,
    registerWithOidc,
    sessionChangeKey: SESSION_CHANGE_KEY,
    bootstrap, scheduleSave, retrySave, useCloudVersion, fetchConflict, overwriteCloud,
  }
})
