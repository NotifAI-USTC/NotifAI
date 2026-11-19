import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '../utils/accountApi'
import { defaultCloudSettings, type CloudSettings } from '../utils/cloudSettings'
import { useAccountStore } from './account'

vi.mock('../utils/accountApi', async (importOriginal) => ({
  ...await importOriginal<typeof api>(),
  getSession: vi.fn(),
  getCloudSettings: vi.fn(),
  putCloudSettings: vi.fn(),
  logout: vi.fn(),
}))

const USER = { id: 'a'.repeat(32), username: 'alice' }
const LEFT = { ...defaultCloudSettings(), blacklistKeywords: ['left'] }
const RIGHT = { ...defaultCloudSettings(), blacklistKeywords: ['right'] }
const IMPORT_KEY = 'notifai-account-import'

function snapshot(revision: number, settings: CloudSettings | null): api.CloudSnapshot {
  return { schemaVersion: 1, revision, settings }
}

let pinia: Pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.useFakeTimers()
  vi.mocked(api.getSession).mockResolvedValue(USER)
  vi.mocked(api.getCloudSettings).mockResolvedValueOnce(snapshot(0, null))
})

afterEach(() => {
  disposePinia(pinia)
  window.sessionStorage.clear()
  vi.resetAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('serializes saves against the acknowledged revision without losing a later draft', async () => {
  const account = useAccountStore()
  await account.bootstrap()
  let completeFirst!: (result: api.CloudSnapshot) => void
  const first = new Promise<api.CloudSnapshot>((resolve) => { completeFirst = resolve })
  vi.mocked(api.putCloudSettings)
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce(snapshot(2, RIGHT))

  account.scheduleSave(LEFT)
  await vi.advanceTimersByTimeAsync(300)
  account.scheduleSave(RIGHT)
  await vi.advanceTimersByTimeAsync(300)
  expect(api.putCloudSettings).toHaveBeenCalledTimes(1)
  completeFirst(snapshot(1, LEFT))
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.mocked(api.putCloudSettings).mock.calls.map((call) => call.slice(0, 3))).toEqual([
    [USER.id, 0, LEFT], [USER.id, 1, RIGHT],
  ])
  expect(account.revision).toBe(2)
  expect(account.unsynced).toBe(false)
})

it('keeps a conflict draft and never overwrites with an unconfirmed revision', async () => {
  const account = useAccountStore()
  await account.bootstrap()
  vi.mocked(api.getCloudSettings).mockRejectedValueOnce(new api.AccountApiError('NETWORK'))
  vi.mocked(api.putCloudSettings).mockRejectedValueOnce(new api.AccountApiError('REVISION_CONFLICT'))
  account.scheduleSave(RIGHT)
  await vi.advanceTimersByTimeAsync(300)
  expect(account.syncStatus).toBe('conflict')
  expect(account.unsynced).toBe(true)
  expect(account.conflictReadable).toBe(false)
  await account.overwriteCloud()
  expect(api.putCloudSettings).toHaveBeenCalledTimes(1)

  vi.mocked(api.getCloudSettings).mockResolvedValueOnce(snapshot(1, LEFT))
  await account.fetchConflict()
  expect(account.conflictReadable).toBe(true)
  vi.mocked(api.putCloudSettings).mockResolvedValueOnce(snapshot(2, RIGHT))
  await account.overwriteCloud()
  expect(api.putCloudSettings).toHaveBeenLastCalledWith(USER.id, 1, RIGHT, expect.any(AbortSignal))
  expect(account.syncStatus).toBe('synced')
})

it('aborts the old scope and never retries against a changed account', async () => {
  const account = useAccountStore()
  await account.bootstrap()
  const browserWindow = window
  const reload = vi.fn()
  vi.stubGlobal('window', {
    setTimeout,
    removeEventListener: browserWindow.removeEventListener.bind(browserWindow),
    location: { reload },
    sessionStorage: browserWindow.sessionStorage,
  })
  vi.mocked(api.putCloudSettings).mockRejectedValueOnce(new api.AccountApiError('ACCOUNT_CHANGED'))
  account.scheduleSave(LEFT)
  await vi.advanceTimersByTimeAsync(300)
  expect(reload).toHaveBeenCalledOnce()
  expect(vi.mocked(api.putCloudSettings).mock.calls[0]?.[3]?.aborted).toBe(true)
  account.scheduleSave(RIGHT)
  await account.retrySave()
  await vi.advanceTimersByTimeAsync(300)
  expect(api.putCloudSettings).toHaveBeenCalledTimes(1)
})

it('leaves the account and import candidate intact when logout or an import fails', async () => {
  window.sessionStorage.setItem(IMPORT_KEY, JSON.stringify({ userId: USER.id, settings: RIGHT }))
  const account = useAccountStore()
  await account.bootstrap()
  vi.mocked(api.putCloudSettings).mockRejectedValueOnce(new api.AccountApiError('NETWORK'))
  await account.importLocal(RIGHT)
  expect(account.syncStatus).toBe('dirty')
  expect(account.importCandidate).toEqual(RIGHT)
  vi.mocked(api.logout).mockRejectedValueOnce(new api.AccountApiError('NETWORK'))
  await expect(account.signOut()).rejects.toThrow('NETWORK')
  expect(account.user).toEqual(USER)
  expect(account.unsynced).toBe(true)
  expect(window.sessionStorage.getItem(IMPORT_KEY)).not.toBeNull()

  vi.mocked(api.putCloudSettings).mockResolvedValueOnce(snapshot(1, RIGHT))
  await account.retrySave()
  expect(account.syncStatus).toBe('synced')
  expect(window.sessionStorage.getItem(IMPORT_KEY)).toBeNull()
})
