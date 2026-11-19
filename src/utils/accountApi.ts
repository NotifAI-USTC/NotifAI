import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { isRecord } from '../stores/settingsPersistence'
import { isValidApiBaseUrl } from './apiBaseUrl'
import { parseCloudSettings, type CloudSettings } from './cloudSettings'

export interface AccountUser {
  id: string
  username: string
}

export interface CloudSnapshot {
  schemaVersion: 1
  revision: number
  settings: CloudSettings | null
}

const ERRORS = {
  ORIGIN_NOT_ALLOWED: 403,
  ACCOUNTS_DISABLED: 404,
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  LOGIN_RATE_LIMITED: 429,
  ACCOUNT_CHANGED: 409,
  REVISION_EXHAUSTED: 409,
  REVISION_CONFLICT: 412,
  BODY_TOO_LARGE: 413,
  INVALID_INPUT: 422,
  ACCOUNT_STORAGE_UNAVAILABLE: 503,
} as const

type AccountApiCode = keyof typeof ERRORS | 'INVALID_RESPONSE' | 'NETWORK' | 'CONFIGURATION'

export class AccountApiError extends Error {
  readonly code: AccountApiCode

  constructor(code: AccountApiCode) {
    super(code)
    this.name = 'AccountApiError'
    this.code = code
  }
}

let client: AxiosInstance | undefined

function accountClient(): AxiosInstance {
  if (client) return client
  const raw = import.meta.env.VITE_API_BASE_URL
  const { origin, hostname, protocol } = window.location
  if (!isValidApiBaseUrl(raw, origin) || /[?#\\]/.test(raw)) {
    throw new AccountApiError('CONFIGURATION')
  }
  const url = new URL(raw.trim(), origin)
  if (
    url.protocol !== 'https:' &&
    !(protocol === 'http:' && url.hostname === hostname &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'))
  ) {
    throw new AccountApiError('CONFIGURATION')
  }
  client = axios.create({
    baseURL: url.href.replace(/\/+$/, ''),
    withCredentials: true,
    timeout: 3000,
    validateStatus: () => true,
  })
  return client
}

async function send(config: AxiosRequestConfig, status: number): Promise<AxiosResponse<unknown>> {
  const connection = accountClient()
  let response: AxiosResponse<unknown>
  try {
    response = await connection.request(config)
  } catch {
    // Never surface an AxiosError, whose request config may contain a password.
    throw new AccountApiError('NETWORK')
  }
  if (response.status === status) return response
  const code = isRecord(response.data) ? response.data.detail : undefined
  if (typeof code === 'string' && Object.hasOwn(ERRORS, code)) {
    const known = code as keyof typeof ERRORS
    if (response.status === ERRORS[known]) throw new AccountApiError(known)
  }
  throw new AccountApiError('INVALID_RESPONSE')
}

function parseUser(value: unknown): AccountUser {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.id !== 'string' ||
    value.id.length !== 32 ||
    !/^[a-f0-9]{32}$/.test(value.id) ||
    typeof value.username !== 'string' ||
    value.username.trim() !== value.username ||
    !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(value.username)
  ) {
    throw new AccountApiError('INVALID_RESPONSE')
  }
  return { id: value.id, username: value.username }
}

function parseSnapshot(response: AxiosResponse<unknown>): CloudSnapshot {
  const value = response.data
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    value.schemaVersion !== 1 ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    response.headers.etag !== `"${value.revision}"` ||
    (value.revision === 0) !== (value.settings === null)
  ) {
    throw new AccountApiError('INVALID_RESPONSE')
  }
  try {
    return {
      schemaVersion: 1,
      revision: value.revision,
      settings: value.settings === null ? null : parseCloudSettings(value.settings),
    }
  } catch {
    throw new AccountApiError('INVALID_RESPONSE')
  }
}

export async function getCapabilities(signal?: AbortSignal): Promise<{ password: true; ssoProviders: string[] }> {
  const { data } = await send({ url: '/auth/capabilities', signal }, 200)
  if (
    !isRecord(data) || Object.keys(data).length !== 2 || data.password !== true ||
    !Array.isArray(data.ssoProviders) || data.ssoProviders.length !== 0
  ) {
    throw new AccountApiError('INVALID_RESPONSE')
  }
  return { password: true, ssoProviders: [] }
}

export async function getSession(signal?: AbortSignal): Promise<AccountUser | null> {
  try {
    return parseUser((await send({ url: '/auth/session', signal }, 200)).data)
  } catch (error) {
    if (error instanceof AccountApiError && error.code === 'AUTH_REQUIRED') return null
    throw error
  }
}

export async function login(username: string, password: string, signal?: AbortSignal): Promise<AccountUser> {
  return parseUser((await send({ method: 'POST', url: '/auth/login', data: { username, password }, signal }, 200)).data)
}

export async function logout(userId: string, signal?: AbortSignal): Promise<void> {
  await send({ method: 'POST', url: '/auth/logout', headers: { 'X-NotifAI-Account': userId }, signal }, 204)
}

export async function getCloudSettings(userId: string, signal?: AbortSignal): Promise<CloudSnapshot> {
  return parseSnapshot(await send({ url: '/me/settings', headers: { 'X-NotifAI-Account': userId }, signal }, 200))
}

export async function putCloudSettings(
  userId: string, revision: number, settings: CloudSettings, signal?: AbortSignal,
): Promise<CloudSnapshot> {
  const snapshot = parseSnapshot(await send({
    method: 'PUT',
    url: '/me/settings',
    headers: { 'X-NotifAI-Account': userId, 'If-Match': `"${revision}"` },
    data: { schemaVersion: 1, settings },
    signal,
  }, 200))
  if (snapshot.revision !== revision + 1) throw new AccountApiError('INVALID_RESPONSE')
  return snapshot
}
