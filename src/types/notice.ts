/** 通知对象 */
export interface NoticeItem {
  id: string // 通知唯一MD5/ID
  title: string // 原始标题
  source: string // 发布来源,如 "教务处", "计算机学院"
  categories: NoticeCategoryKey[] // AI 分类，最多 3 项
  publishDate: string // 发布日期 YYYY-MM-DD
  aiSummary: string // AI 提炼的 40 字以内一句话摘要
  deadline: string | null // 格式化截止时间,无则为 null
  targetAudience: string // 面向对象,如 "全体本科生"
  coreAction: string // 核心行动/地点
  originUrl: string // 官网原始链接
  cleanContent: string // 通知原文：Markdown/轻量HTML/纯文本，详情页按 Markdown 渲染
  attachments: Array<{ name: string; url: string }> // 附件列表
  /** 首次抓取时间；旧缓存或旧服务端响应可能没有该字段。 */
  firstSeen?: string | null
  /** 最近抓取时间；旧缓存或旧服务端响应可能没有该字段。 */
  lastCrawl?: string | null
}

/** 后端 AI 流水线使用的固定分类 key。 */
export const NOTICE_CATEGORY_DEFINITIONS = [
  { key: 'course_selection', name: '选课通知', description: '选课、退课、补选、重修选课' },
  { key: 'exam', name: '考试安排', description: '期末、补考、缓考、四六级' },
  { key: 'scholarship', name: '奖学金', description: '申请、评审、公示、助学金' },
  { key: 'academic_lecture', name: '学术讲座', description: '报告、讲座、研讨会' },
  { key: 'campus_event', name: '校园活动', description: '文化活动、社团、文体赛事' },
  { key: 'enrollment', name: '招生信息', description: '本科生、研究生、留学生招生' },
  { key: 'course_info', name: '教学安排', description: '教学计划、调停课、教室借用' },
  { key: 'graduation', name: '毕业相关', description: '论文、答辩、学位授予、离校' },
  { key: 'internship_job', name: '实习就业', description: '实习、招聘、宣讲会' },
  { key: 'library', name: '图书馆通知', description: '服务、资源、开放时间' },
  { key: 'admin', name: '行政通知', description: '综合行政、办公室、院系管理' },
  { key: 'research', name: '科研通知', description: '科研项目、基金申请' },
  { key: 'competition', name: '竞赛通知', description: '学科竞赛、挑战杯' },
  { key: 'abroad', name: '国际交流', description: '交换生、留学项目' },
  { key: 'party', name: '党建团学', description: '党建、团组织、思政' },
  { key: 'logistics', name: '后勤服务', description: '食堂、宿舍、班车、医疗' },
  { key: 'other', name: '其他通知', description: '其他校园通知' },
] as const

export type NoticeCategoryKey = (typeof NOTICE_CATEGORY_DEFINITIONS)[number]['key']

const NOTICE_CATEGORY_NAME_MAP = Object.fromEntries(
  NOTICE_CATEGORY_DEFINITIONS.map(({ key, name }) => [key, name]),
) as Readonly<Record<NoticeCategoryKey, string>>

export const NOTICE_CATEGORY_KEYS = new Set<NoticeCategoryKey>(
  NOTICE_CATEGORY_DEFINITIONS.map(({ key }) => key),
)

export function isNoticeCategoryKey(value: unknown): value is NoticeCategoryKey {
  return typeof value === 'string' && NOTICE_CATEGORY_KEYS.has(value as NoticeCategoryKey)
}

export function getNoticeCategoryName(key: NoticeCategoryKey): string {
  return NOTICE_CATEGORY_NAME_MAP[key]
}

/** 通知列表 API 响应 */
export interface NoticeListResponse {
  items: NoticeItem[]
  total: number
  nextCursor: string | null
}

/** 部门常量 */
export interface Department {
  id: string
  name: string
  group: string
}

const SOURCE_ALIASES: Readonly<Record<string, string>> = {
  计算机科学与技术学院: '计算机学院',
}

export function normalizeNoticeSource(source: string): string {
  return Object.hasOwn(SOURCE_ALIASES, source) ? SOURCE_ALIASES[source] : source
}

export const DEPARTMENTS: Department[] = [
  // 校级部门
  { id: 'jwc', name: '教务处', group: '校级部门' },
  { id: 'bksy', name: '本科生院', group: '校级部门' },
  { id: 'xgb', name: '学工部', group: '校级部门' },
  { id: 'tw', name: '校团委', group: '校级部门' },
  { id: 'kyb', name: '科研部', group: '校级部门' },
  { id: 'gjjl', name: '国际合作与交流部', group: '校级部门' },
  { id: 'lib', name: '图书馆', group: '校级部门' },
  { id: 'hqbzc', name: '后勤保障处', group: '校级部门' },
  { id: 'bwc', name: '保卫处', group: '校级部门' },
  { id: 'jyzd', name: '就业指导中心', group: '校级部门' },
  // 二级学院
  { id: 'cs', name: '计算机学院', group: '二级学院' },
  { id: 'dsj', name: '大数据学院', group: '二级学院' },
  { id: 'wl', name: '物理学院', group: '二级学院' },
  { id: 'sx', name: '数学科学学院', group: '二级学院' },
  { id: 'hx', name: '化学与材料科学学院', group: '二级学院' },
  { id: 'sm', name: '生命科学与医学部', group: '二级学院' },
  { id: 'gx', name: '信息科学技术学院', group: '二级学院' },
  { id: 'dx', name: '地球与空间科学学院', group: '二级学院' },
]

/** 来源展示颜色（与部门表保持同一处维护，避免多处漂移） */
export const SOURCE_COLORS: Readonly<Record<string, string>> = {
  教务处: '#4a6cf7',
  本科生院: '#6366f1',
  学工部: '#8b5cf6',
  校团委: '#ec4899',
  科研部: '#06b6d4',
  国际合作与交流部: '#14b8a6',
  图书馆: '#f59e0b',
  后勤保障处: '#f97316',
  保卫处: '#64748b',
  就业指导中心: '#10b981',
  计算机学院: '#10b981',
  大数据学院: '#f97316',
  物理学院: '#a855f7',
  数学科学学院: '#3b82f6',
  化学与材料科学学院: '#ef4444',
  生命科学与医学部: '#84cc16',
  信息科学技术学院: '#0ea5e9',
  地球与空间科学学院: '#78716c',
}

export const DEFAULT_SOURCE_COLOR = '#6b7280'

/** 获取通知来源的展示颜色，未知来源回退到默认灰色。 */
export function getSourceColor(source: string): string {
  const normalized = normalizeNoticeSource(source)
  return Object.hasOwn(SOURCE_COLORS, normalized) ? SOURCE_COLORS[normalized] : DEFAULT_SOURCE_COLOR
}

/** 日历轻量视图条目（GET /notices/calendar） */
export interface CalendarItem {
  id: string
  title: string
  source: string
  publishDate: string
  deadline: string | null
}

/** 日历轻量视图 API 响应 */
export interface CalendarListResponse {
  items: CalendarItem[]
}

/** 即将截止轻量视图条目（GET /notices/deadlines） */
export interface DeadlineItem {
  id: string
  title: string
  source: string
  publishDate: string
  deadline: string
  aiSummary: string
  targetAudience: string
}

/** 即将截止轻量视图 API 响应 */
export interface DeadlineListResponse {
  items: DeadlineItem[]
  total: number
}

/** 批量详情 API 响应（POST /notices/batch） */
export interface NoticeBatchResponse {
  items: NoticeItem[]
  missing: string[]
}

/** 来源列表条目（GET /sources） */
export interface SourceItem {
  name: string
  group: string
  noticeCount: number
}

/** 通知分类条目（GET /categories） */
export interface NoticeCategoryItem {
  key: NoticeCategoryKey
  name: string
  description: string
  noticeCount: number
}

/** 聚合统计 API 响应（GET /stats） */
export interface StatsResponse {
  total: number
  sourceCount: number
  last7DaysDdl: number
  last24hNew: number
  lastCrawlAt: string | null
}
