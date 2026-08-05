import axios from 'axios'
import type { NoticeItem, NoticeListResponse } from '../types/notice'
import { useSnackbar } from '../composables/useSnackbar'
import {
  DataValidationError,
  assertDateOnly,
  assertNoticeId,
  parseNoticeItem,
  parseNoticeListResponse,
} from './validation'
import { isValidApiBaseUrl } from './apiBaseUrl'

declare module 'axios' {
  interface AxiosRequestConfig {
    suppressGlobalError?: boolean
  }

  interface InternalAxiosRequestConfig {
    suppressGlobalError?: boolean
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const mockRequested = import.meta.env.VITE_USE_MOCK === 'true'
const MAX_NOTICE_LIST_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_NOTICE_DETAIL_RESPONSE_BYTES = 8 * 1024 * 1024

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiConfigurationError'
  }
}

function shouldUseMock(): boolean {
  if (mockRequested) {
    if (import.meta.env.PROD) {
      throw new ApiConfigurationError('生产环境禁止使用模拟通知数据')
    }
    return true
  }

  if (!apiBaseUrl) {
    throw new ApiConfigurationError(
      '未配置通知 API 地址，请设置 VITE_API_BASE_URL；本地模拟数据需显式设置 VITE_USE_MOCK=true',
    )
  }

  const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  if (!isValidApiBaseUrl(apiBaseUrl, baseUrl)) {
    throw new ApiConfigurationError(
      'VITE_API_BASE_URL 必须是不含凭据、查询参数或片段的 HTTP(S) 地址或根相对路径',
    )
  }
  return false
}

const request = axios.create({
  adapter: 'fetch',
  baseURL: apiBaseUrl,
  timeout: 10000,
})

// 响应拦截器：统一错误处理
const snackbar = useSnackbar()
request.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isCancel(error) ||
      (axios.isAxiosError(error) && error.config?.suppressGlobalError === true)
    ) {
      return Promise.reject(error)
    }

    const message = axios.isAxiosError(error)
      ? error.code === 'ECONNABORTED'
        ? '请求超时，请稍后重试'
        : error.response?.status
          ? `通知服务请求失败（${error.response.status}）`
          : '无法连接通知服务，请检查网络'
      : '网络请求失败'
    console.error('[API Error]', message)
    snackbar.showError(message)
    return Promise.reject(error)
  },
)

export default request

export interface FetchNoticesParams {
  keyword?: string
  source?: string
  sources?: string[]
  dateFrom?: string
  dateTo?: string
  /** Match notices whose publish date or deadline overlaps this date-only range. */
  rangeFrom?: string
  rangeTo?: string
  hasDeadline?: boolean
  page?: number
  pageSize?: number
}

function validateOptionalText(value: unknown, name: string, maxLength = 200): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new DataValidationError(`${name} 必须是长度为 1 到 ${maxLength} 的字符串`)
  }
  return value
}

function waitForMockDelay(delay: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('请求已取消', 'AbortError'))
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, delay)
    const handleAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('请求已取消', 'AbortError'))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

/** 获取通知列表 */
export async function fetchNotices(
  params: FetchNoticesParams = {},
  signal?: AbortSignal,
): Promise<NoticeListResponse> {
  const useMock = shouldUseMock()
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 15
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new DataValidationError('page 必须是正整数')
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new DataValidationError('pageSize 必须是 1 到 1000 之间的整数')
  }
  const keyword = validateOptionalText(params.keyword, 'keyword', 200)
  const source = validateOptionalText(params.source, 'source', 200)
  if (params.sources !== undefined) {
    if (!Array.isArray(params.sources) || params.sources.length > 100) {
      throw new DataValidationError('sources 必须是至多 100 项的字符串数组')
    }
    params.sources.forEach((item, index) => validateOptionalText(item, `sources[${index}]`, 200))
  }
  const dateFrom =
    params.dateFrom === undefined ? undefined : assertDateOnly(params.dateFrom, 'dateFrom')
  const dateTo = params.dateTo === undefined ? undefined : assertDateOnly(params.dateTo, 'dateTo')
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new DataValidationError('dateFrom 不能晚于 dateTo')
  }
  const rangeFrom =
    params.rangeFrom === undefined ? undefined : assertDateOnly(params.rangeFrom, 'rangeFrom')
  const rangeTo =
    params.rangeTo === undefined ? undefined : assertDateOnly(params.rangeTo, 'rangeTo')
  if (rangeFrom && rangeTo && rangeFrom > rangeTo) {
    throw new DataValidationError('rangeFrom 不能晚于 rangeTo')
  }
  if (params.hasDeadline !== undefined && typeof params.hasDeadline !== 'boolean') {
    throw new DataValidationError('hasDeadline 必须是布尔值')
  }

  const validatedParams: FetchNoticesParams = {
    keyword,
    source,
    sources: params.sources ? [...new Set(params.sources)] : undefined,
    dateFrom,
    dateTo,
    rangeFrom,
    rangeTo,
    hasDeadline: params.hasDeadline,
    page,
    pageSize,
  }
  if (import.meta.env.DEV && useMock) {
    const { mockFetchNotices } = await import('../mock/notices')
    // 模拟网络延迟
    await waitForMockDelay(300 + Math.random() * 500, signal)
    return parseNoticeListResponse(mockFetchNotices(validatedParams))
  }

  const res = await request.get<unknown>('/notices', {
    maxContentLength: MAX_NOTICE_LIST_RESPONSE_BYTES,
    params: validatedParams,
    signal,
    suppressGlobalError: true,
  })
  return parseNoticeListResponse(res.data)
}

/** 获取单条通知详情 */
export async function fetchNoticeById(id: string, signal?: AbortSignal): Promise<NoticeItem> {
  const useMock = shouldUseMock()
  const validatedId = assertNoticeId(id)
  if (import.meta.env.DEV && useMock) {
    const { mockFetchNoticeById } = await import('../mock/notices')
    await waitForMockDelay(200 + Math.random() * 300, signal)
    const notice = mockFetchNoticeById(validatedId)
    if (!notice) {
      throw new Error('通知不存在')
    }
    return parseNoticeItem(notice)
  }

  const res = await request.get<unknown>(`/notices/${encodeURIComponent(validatedId)}`, {
    maxContentLength: MAX_NOTICE_DETAIL_RESPONSE_BYTES,
    signal,
    suppressGlobalError: true,
  })
  return parseNoticeItem(res.data)
}
