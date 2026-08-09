import type {
  CalendarItem,
  NoticeCategoryItem,
  NoticeBatchResponse,
  NoticeItem,
  NoticeListResponse,
  SourceItem,
  StatsResponse,
} from '../types/notice'
import { isNoticeCategoryKey, NOTICE_CATEGORY_DEFINITIONS } from '../types/notice'

const LIMITS = {
  id: 128,
  title: 500,
  source: 200,
  summary: 10_000,
  detail: 2_000,
  html: 500_000,
  url: 4_096,
  attachmentName: 500,
  attachments: 50,
  categoriesPerNotice: 3,
  notices: 1_000,
  total: 10_000_000,
} as const

const NOTICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MIN_DATE_YEAR = 2000
const MAX_DATE_YEAR = 2100

export class DataValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataValidationError'
  }
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DataValidationError(`${path} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function expectString(value: unknown, path: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new DataValidationError(`${path} 必须是字符串`)
  }
  if ((!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new DataValidationError(`${path} 长度无效`)
  }
  return value
}

function optionalString(value: unknown, maxLength: number, defaultValue = ''): string {
  if (value === undefined || value === null) return defaultValue
  if (typeof value !== 'string') return defaultValue
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function normalizeDateInput(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // 接受 "YYYY-MM-DD" 或 ISO 日期时间（取日期部分）
  const match = DATE_PATTERN.exec(trimmed)
  if (match) return trimmed.slice(0, 10)
  // 尝试从 ISO 字符串中提取日期部分，如 2026-07-31T00:00:00.000Z
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})[T\s]/.exec(trimmed)
  if (isoMatch) return trimmed.slice(0, 10)
  return null
}

function expectDate(value: unknown, path: string): string {
  const date = normalizeDateInput(value)
  if (!date) {
    throw new DataValidationError(`${path} 必须使用 YYYY-MM-DD 格式`)
  }
  const match = DATE_PATTERN.exec(date)
  if (!match) {
    throw new DataValidationError(`${path} 必须使用 YYYY-MM-DD 格式`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < MIN_DATE_YEAR || year > MAX_DATE_YEAR) {
    throw new DataValidationError(`${path} 年份必须在 ${MIN_DATE_YEAR} 到 ${MAX_DATE_YEAR} 之间`)
  }
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new DataValidationError(`${path} 不是有效日期`)
  }
  return date
}

export function assertDateOnly(value: unknown, path = '日期'): string {
  return expectDate(value, path)
}

export function normalizeHttpUrl(value: unknown, baseUrl?: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.url) {
    return null
  }

  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

export function normalizeTrustedNoticeUrl(value: unknown): string | null {
  const href = normalizeHttpUrl(value)
  if (!href) return null

  const url = new URL(href)
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' ||
    (hostname !== 'ustc.edu.cn' && !hostname.endsWith('.ustc.edu.cn'))
  ) {
    return null
  }
  return href
}

function expectHttpUrl(value: unknown, path: string): string {
  const url = normalizeHttpUrl(value)
  if (!url) {
    throw new DataValidationError(`${path} 必须是无凭据的 HTTP(S) URL`)
  }
  return url
}

function expectTrustedNoticeUrl(value: unknown, path: string): string {
  const url = normalizeTrustedNoticeUrl(value)
  if (!url) {
    throw new DataValidationError(`${path} 必须是中国科大 HTTPS 地址`)
  }
  return url
}

export function assertNoticeId(value: unknown, path = '通知 ID'): string {
  if (!isValidNoticeId(value)) {
    throw new DataValidationError(`${path} 格式无效`)
  }
  return value
}

export function isValidNoticeId(value: unknown): value is string {
  return typeof value === 'string' && NOTICE_ID_PATTERN.test(value)
}

function parseNoticeFields(record: Record<string, unknown>, path: string): NoticeItem {
  return {
    id: assertNoticeId(record.id, `${path}.id`),
    title: expectString(record.title, `${path}.title`, LIMITS.title),
    source: expectString(record.source, `${path}.source`, LIMITS.source),
    categories: parseNoticeCategories(record.categories, `${path}.categories`),
    publishDate: expectDate(record.publishDate, `${path}.publishDate`),
    aiSummary: optionalString(record.aiSummary, LIMITS.summary),
    deadline: record.deadline == null ? null : expectDate(record.deadline, `${path}.deadline`),
    targetAudience: optionalString(record.targetAudience, LIMITS.detail),
    coreAction: optionalString(record.coreAction, LIMITS.detail),
    originUrl: expectTrustedNoticeUrl(record.originUrl, `${path}.originUrl`),
    cleanContent: optionalString(record.cleanContent, LIMITS.html),
    attachments: [],
  }
}

function parseNoticeCategories(value: unknown, path: string): NoticeItem['categories'] {
  if (!Array.isArray(value) || value.length > LIMITS.categoriesPerNotice) {
    throw new DataValidationError(`${path} 必须是至多 ${LIMITS.categoriesPerNotice} 项的数组`)
  }

  const categories: NoticeItem['categories'] = []
  const seen = new Set<string>()
  value.forEach((key, index) => {
    if (!isNoticeCategoryKey(key)) {
      throw new DataValidationError(`${path}[${index}] 不是支持的分类 key`)
    }
    if (seen.has(key)) {
      throw new DataValidationError(`${path}[${index}] 存在重复分类`)
    }
    seen.add(key)
    categories.push(key)
  })
  return categories
}

function parseAttachments(
  record: Record<string, unknown>,
  path: string,
): NoticeItem['attachments'] {
  if (record.attachments === undefined || record.attachments === null) {
    return []
  }
  if (!Array.isArray(record.attachments) || record.attachments.length > LIMITS.attachments) {
    throw new DataValidationError(`${path}.attachments 必须是至多 ${LIMITS.attachments} 项的数组`)
  }

  return record.attachments.map((attachment, index) => {
    const item = expectRecord(attachment, `${path}.attachments[${index}]`)
    return {
      name: expectString(item.name, `${path}.attachments[${index}].name`, LIMITS.attachmentName),
      url: expectHttpUrl(item.url, `${path}.attachments[${index}].url`),
    }
  })
}

export function parseNoticeItem(value: unknown, path = 'notice'): NoticeItem {
  const record = expectRecord(value, path)
  const notice = parseNoticeFields(record, path)
  notice.attachments = parseAttachments(record, path)
  return notice
}

/**
 * 解析列表响应。
 *
 * 对于单条非法记录，默认跳过并记录 console.warn，而不是让整页失败，
 * 这样后端个别脏数据不会阻塞整个通知流。
 */
export function parseNoticeListResponse(value: unknown): NoticeListResponse {
  const record = expectRecord(value, 'response')

  if (!Array.isArray(record.items)) {
    throw new DataValidationError('response.items 必须是数组')
  }

  if (record.items.length > LIMITS.notices) {
    throw new DataValidationError(`response.items 长度不能超过 ${LIMITS.notices}`)
  }

  const items: NoticeItem[] = []
  const seenIds = new Set<string>()
  record.items.forEach((item, index) => {
    let parsed: NoticeItem
    try {
      parsed = parseNoticeItem(item, `response.items[${index}]`)
    } catch (error) {
      // 跳过单条非法记录，避免整页失败
      console.warn(
        `[NotifAI] 跳过第 ${index + 1} 条非法通知数据:`,
        error instanceof Error ? error.message : String(error),
      )
      return
    }
    // 重复 ID 属于结构性问题，拒绝整页
    if (seenIds.has(parsed.id)) {
      throw new DataValidationError(`response.items[${index}] 存在重复通知 ID: ${parsed.id}`)
    }
    seenIds.add(parsed.id)
    items.push(parsed)
  })

  if (typeof record.total !== 'number' || record.total < 0 || record.total > LIMITS.total) {
    throw new DataValidationError('response.total 无效')
  }
  if (record.total < items.length) {
    throw new DataValidationError('response.total 小于实际返回的通知数量')
  }

  return {
    items,
    total: record.total,
  }
}

/**
 * 解析日历轻量条目。
 *
 * 与完整 NoticeItem 不同，CalendarItem 只要求 id/title/source/publishDate/deadline，
 * 用于日历渲染（GET /notices/calendar）。
 */
export function parseCalendarItem(value: unknown, path = 'calendarItem'): CalendarItem {
  const record = expectRecord(value, path)
  return {
    id: assertNoticeId(record.id, `${path}.id`),
    title: expectString(record.title, `${path}.title`, LIMITS.title),
    source: expectString(record.source, `${path}.source`, LIMITS.source),
    publishDate: expectDate(record.publishDate, `${path}.publishDate`),
    deadline: record.deadline == null ? null : expectDate(record.deadline, `${path}.deadline`),
  }
}

/** 解析日历轻量列表响应，单条非法记录跳过并告警。 */
export function parseCalendarListResponse(value: unknown): CalendarItem[] {
  const record = expectRecord(value, 'response')
  if (!Array.isArray(record.items)) {
    throw new DataValidationError('response.items 必须是数组')
  }
  if (record.items.length > LIMITS.notices) {
    throw new DataValidationError(`response.items 长度不能超过 ${LIMITS.notices}`)
  }

  const items: CalendarItem[] = []
  const seenIds = new Set<string>()
  record.items.forEach((item, index) => {
    let parsed: CalendarItem
    try {
      parsed = parseCalendarItem(item, `response.items[${index}]`)
    } catch (error) {
      console.warn(
        `[NotifAI] 跳过第 ${index + 1} 条非法日历数据:`,
        error instanceof Error ? error.message : String(error),
      )
      return
    }
    if (seenIds.has(parsed.id)) {
      throw new DataValidationError(`response.items[${index}] 存在重复通知 ID: ${parsed.id}`)
    }
    seenIds.add(parsed.id)
    items.push(parsed)
  })
  return items
}

/** 解析批量详情响应（POST /notices/batch）。 */
export function parseNoticeBatchResponse(value: unknown): NoticeBatchResponse {
  const record = expectRecord(value, 'response')
  if (!Array.isArray(record.items)) {
    throw new DataValidationError('response.items 必须是数组')
  }
  if (record.items.length > LIMITS.notices) {
    throw new DataValidationError(`response.items 长度不能超过 ${LIMITS.notices}`)
  }

  const items: NoticeItem[] = []
  record.items.forEach((item, index) => {
    try {
      items.push(parseNoticeItem(item, `response.items[${index}]`))
    } catch (error) {
      console.warn(
        `[NotifAI] 批量详情跳过第 ${index + 1} 条非法通知数据:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  })

  const missing: string[] = []
  if (record.missing !== undefined && record.missing !== null) {
    if (!Array.isArray(record.missing) || record.missing.length > LIMITS.notices) {
      throw new DataValidationError(`response.missing 必须是至多 ${LIMITS.notices} 项的数组`)
    }
    const seenMissing = new Set<string>()
    record.missing.forEach((id, index) => {
      const validId = assertNoticeId(id, `response.missing[${index}]`)
      if (seenMissing.has(validId)) {
        throw new DataValidationError(`response.missing[${index}] 存在重复 ID`)
      }
      seenMissing.add(validId)
    })
    missing.push(...seenMissing)
  }

  return { items, missing }
}

/** 解析来源列表响应（GET /sources）。 */
export function parseSourceListResponse(value: unknown): SourceItem[] {
  if (!Array.isArray(value) || value.length > LIMITS.notices) {
    throw new DataValidationError('sources 必须是数组')
  }
  return value.map((item, index) => {
    const record = expectRecord(item, `sources[${index}]`)
    const name = expectString(record.name, `sources[${index}].name`, LIMITS.source)
    const group = expectString(record.group, `sources[${index}].group`, LIMITS.source)
    const noticeCount = record.noticeCount
    if (typeof noticeCount !== 'number' || !Number.isInteger(noticeCount) || noticeCount < 0) {
      throw new DataValidationError(`sources[${index}].noticeCount 必须是非负整数`)
    }
    return { name, group, noticeCount }
  })
}

/** 解析分类列表响应（GET /categories）。 */
export function parseCategoryListResponse(value: unknown): NoticeCategoryItem[] {
  if (!Array.isArray(value) || value.length !== NOTICE_CATEGORY_DEFINITIONS.length) {
    throw new DataValidationError(
      `categories 必须是包含 ${NOTICE_CATEGORY_DEFINITIONS.length} 项的数组`,
    )
  }

  const categories: NoticeCategoryItem[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const record = expectRecord(item, `categories[${index}]`)
    if (!isNoticeCategoryKey(record.key)) {
      throw new DataValidationError(`categories[${index}].key 不是支持的分类 key`)
    }
    if (seen.has(record.key)) {
      throw new DataValidationError(`categories[${index}].key 存在重复分类`)
    }
    seen.add(record.key)

    const noticeCount = record.noticeCount
    if (typeof noticeCount !== 'number' || !Number.isInteger(noticeCount) || noticeCount < 0) {
      throw new DataValidationError(`categories[${index}].noticeCount 必须是非负整数`)
    }
    categories.push({
      key: record.key,
      name: expectString(record.name, `categories[${index}].name`, LIMITS.source),
      description: expectString(
        record.description,
        `categories[${index}].description`,
        LIMITS.detail,
      ),
      noticeCount,
    })
  })
  return categories
}

/** 解析聚合统计响应（GET /stats）。 */
export function parseStatsResponse(value: unknown): StatsResponse {
  const record = expectRecord(value, 'stats')
  const nonNegativeInt = (field: string, fallback: number): number => {
    const raw = record[field]
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return fallback
    return raw
  }

  const total = nonNegativeInt('total', 0)
  const sourceCount = nonNegativeInt('sourceCount', 0)
  const last7DaysDdl = nonNegativeInt('last7DaysDdl', 0)
  const last24hNew = nonNegativeInt('last24hNew', 0)

  let lastCrawlAt: string | null = null
  if (record.lastCrawlAt != null) {
    if (typeof record.lastCrawlAt !== 'string' || record.lastCrawlAt.length > 100) {
      throw new DataValidationError('stats.lastCrawlAt 必须是字符串')
    }
    if (!Number.isNaN(Date.parse(record.lastCrawlAt))) {
      lastCrawlAt = record.lastCrawlAt
    }
  }

  return { total, sourceCount, last7DaysDdl, last24hNew, lastCrawlAt }
}
