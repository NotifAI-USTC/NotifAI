import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '../utils/accountApi'
import { defaultCloudSettings, type CloudSettings } from '../utils/cloudSettings'
import { useAccountStore } from './account'

vi.mock('../utils/accountApi', async (importOriginal) => ({
  ...await importOriginal<typeof api>(),
  getSession: vi.fn(),
  login: vi.fn(),
  completeOidcSignup: vi.fn(),
  getCloudSettings: vi.fn(),
  putCloudSettings: vi.fn(),
  logout: vi.fn(),
}))

const USER = { id: 'a'.repeat(32), username: 'alice', displayName: 'alice' }
const SSO_USER = { id: 'b'.repeat(32), username: null, displayName: '新同学' }
const LEFT = { ...defaultCloudSettings(), blacklistKeywords: ['left'] }
const RIGHT = { ...defaultCloudSettings(), blacklistKeywords: ['right'] }
const IMPORT_KEY = 'notifai-account-import'

function snapshot(revision: number, settings: CloudSettings | null): api.CloudSnapshot {
  return { schemaVersion: 1, revision, settings }
}

function stubAccountWindow() {
  const browserWindow = window
  const reload = vi.fn()
  const replaceState = vi.fn()
  const broadcast = vi.fn()
  vi.stubGlobal('window', {
    addEventListener: browserWindow.addEventListener.bind(browserWindow),
    removeEventListener: browserWindow.removeEventListener.bind(browserWindow),
    location: { reload, href: 'https://example.test/#/user?sso=signup&keep=1' },
    history: { replaceState },
    localStorage: { setItem: broadcast },
    sessionStorage: browserWindow.sessionStorage,
  })
  return { reload, replaceState, broadcast }
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

it('keeps the verified account on a startup settings identity error without reloading', async () => {
  const { reload } = stubAccountWindow()
  const account = useAccountStore()
  vi.mocked(api.getCloudSettings).mockReset()
  vi.mocked(api.getCloudSettings).mockRejectedValue(new api.AccountApiError('ACCOUNT_CHANGED'))
  await account.bootstrap()

  expect(account.user).toEqual(USER)
  expect(account.startupUnavailable).toBe(true)
  expect(account.cloudReady).toBe(false)
  expect(reload).not.toHaveBeenCalled()
})

it('awaits a queued session recheck even if the preceding request fails', async () => {
  const { reload } = stubAccountWindow()
  const account = useAccountStore()
  let failFirst!: (error: Error) => void
  let completeSecond!: (current: api.AccountUser) => void
  vi.mocked(api.getSession)
    .mockReturnValueOnce(new Promise((_, reject) => { failFirst = reject }))
    .mockReturnValueOnce(new Promise((resolve) => { completeSecond = resolve }))

  const first = account.checkSession()
  await vi.advanceTimersByTimeAsync(0)
  expect(api.getSession).toHaveBeenCalledTimes(1)
  const settled = vi.fn()
  const second = account.checkSession().then(settled)
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  failFirst(new api.AccountApiError('NETWORK'))
  await vi.advanceTimersByTimeAsync(0)
  expect(api.getSession).toHaveBeenCalledTimes(2)
  expect(settled).not.toHaveBeenCalled()

  completeSecond(USER)
  await Promise.all([first, second])
  expect(account.transitioning).toBe(true)
  expect(reload).toHaveBeenCalledOnce()
  expect(settled).toHaveBeenCalledOnce()
})

it.each(['password', 'oidc'])('serializes password and signup in two tabs when %s writes first', async (winner) => {
  const { reload, replaceState, broadcast } = stubAccountWindow()
  const peer = createPinia()
  try {
    const passwordTab = useAccountStore(pinia)
    const signupTab = useAccountStore(peer)
    let queue: Promise<void> = Promise.resolve()
    const request = vi.fn((_name: string, { signal }: LockOptions, write: () => Promise<void>) => {
      const acquired = queue.then(() => {
        if (signal?.aborted) throw signal.reason
        return write()
      })
      queue = acquired.catch(() => undefined)
      return acquired
    })
    vi.stubGlobal('navigator', { locks: { request } })

    let current: api.AccountUser | null = null
    const winningUser = winner === 'password' ? USER : SSO_USER
    const winningWrite = winner === 'password' ? api.login : api.completeOidcSignup
    const blockedWrite = winner === 'password' ? api.completeOidcSignup : api.login
    let finishWrite!: () => void
    const response = new Promise<void>((resolve) => { finishWrite = resolve })
    vi.mocked(api.getSession).mockImplementation(async () => current)
    vi.mocked(winningWrite).mockImplementation(async () => {
      await response
      current = winningUser
      return winningUser
    })

    const password = () => passwordTab.signIn('alice', 'password', LEFT)
    const signup = () => signupTab.registerWithOidc('form-id', SSO_USER.displayName)
    const first = (winner === 'password' ? password : signup)()
    await vi.advanceTimersByTimeAsync(0)
    const second = (winner === 'password' ? signup : password)()
    await vi.advanceTimersByTimeAsync(0)

    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0]?.[0]).toBe(request.mock.calls[1]?.[0])
    expect(api.getSession).toHaveBeenCalledTimes(1)
    expect(winningWrite).toHaveBeenCalledOnce()
    expect(blockedWrite).not.toHaveBeenCalled()
    expect(vi.mocked(winningWrite).mock.calls[0]?.[2]).toBe(request.mock.calls[0]?.[1].signal)

    finishWrite()
    await Promise.all([first, second])

    expect(api.getSession).toHaveBeenCalledTimes(2)
    expect(blockedWrite).not.toHaveBeenCalled()
    expect(request.mock.calls.every(([, { signal }]) => signal?.aborted)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
    expect(broadcast).toHaveBeenCalledWith(passwordTab.sessionChangeKey, expect.any(String))
    expect(broadcast).toHaveBeenCalledOnce()
    const candidate = window.sessionStorage.getItem(IMPORT_KEY)
    if (winner === 'password') {
      expect(candidate && JSON.parse(candidate)).toEqual({ userId: USER.id, settings: LEFT })
      expect(replaceState).not.toHaveBeenCalled()
    } else {
      expect(candidate).toBeNull()
      expect(replaceState).toHaveBeenCalledWith(undefined, '', expect.objectContaining({ hash: '#/user?keep=1' }))
    }
  } finally {
    disposePinia(peer)
  }
})

it.each([undefined, 'SecurityError'])('rechecks before a write when Web Locks are unavailable (%s)', async (blocked) => {
  const { reload } = stubAccountWindow()
  const account = useAccountStore()
  const locks = blocked ? {
    request: vi.fn().mockRejectedValue(new DOMException('unavailable', blocked)),
  } : undefined
  vi.stubGlobal('navigator', { locks })

  await account.registerWithOidc('form-id', SSO_USER.displayName)

  expect(api.getSession).toHaveBeenCalledWith(expect.any(AbortSignal))
  expect(api.completeOidcSignup).not.toHaveBeenCalled()
  expect(reload).toHaveBeenCalledOnce()
})

it('aborts a queued account write when its store is disposed', async () => {
  const account = useAccountStore()
  const request = vi.fn((_name: string, { signal }: LockOptions) => new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  vi.stubGlobal('navigator', { locks: { request } })

  const attempt = account.signIn('alice', 'password', LEFT)
  const aborted = expect(attempt).rejects.toHaveProperty('name', 'AbortError')
  await vi.advanceTimersByTimeAsync(0)
  expect(request).toHaveBeenCalledOnce()
  disposePinia(pinia)
  await aborted

  expect(api.getSession).not.toHaveBeenCalled()
  expect(api.login).not.toHaveBeenCalled()
})
