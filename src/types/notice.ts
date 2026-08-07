/** 通知对象 */
export interface NoticeItem {
  id: string // 通知唯一MD5/ID
  title: string // 原始标题
  source: string // 发布来源,如 "教务处", "计算机学院"
  publishDate: string // 发布日期 YYYY-MM-DD
  aiSummary: string // AI 提炼的 40 字以内一句话摘要
  deadline: string | null // 格式化截止时间,无则为 null
  targetAudience: string // 面向对象,如 "全体本科生"
  coreAction: string // 核心行动/地点
  originUrl: string // 官网原始链接
  cleanContent: string // 通知原文：Markdown/轻量HTML/纯文本，详情页按 Markdown 渲染
  attachments: Array<{ name: string; url: string }> // 附件列表
}

/** 通知列表 API 响应 */
export interface NoticeListResponse {
  items: NoticeItem[]
  total: number
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
