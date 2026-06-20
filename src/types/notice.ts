/** 通知唯一对象 */
export interface NoticeItem {
  id: string
  title: string
  source: string
  publishDate: string // YYYY-MM-DD
  aiSummary: string
  deadline: string | null
  targetAudience: string
  coreAction: string
  originUrl: string
  cleanContent: string
  attachments: Array<{ name: string; url: string }>
}

/** 通知列表 API 响应 */
export interface NoticeListResponse {
  items: NoticeItem[]
  total: number
}

/** 首页分类标签 */
export type NoticeCategory =
  | '全部'
  | '教务通知'
  | '学术讲座'
  | '学科竞赛'
  | '校园生活'
  | '迎新特辑'

/** 本地用户偏好（LocalStorage 存储） */
export interface UserPreferences {
  subscribedDepts: string[]
  blacklistKeywords: string[]
  starredIds: string[]
  readIds: string[]
}

/** 部门常量 */
export interface Department {
  id: string
  name: string
  group: string
}

export const DEPARTMENTS: Department[] = [
  // 校级部门
  { id: 'jwc', name: '教务处', group: '校级部门' },
  { id: 'bksy', name: '本科生院', group: '校级部门' },
  { id: 'xgb', name: '学工部', group: '校级部门' },
  { id: 'tw', name: '校团委', group: '校级部门' },
  { id: 'kyb', name: '科研部', group: '校级部门' },
  { id: 'gjjl', name: '国际合作与交流部', group: '校级部门' },
  // 二级学院
  { id: 'cs', name: '计算机科学与技术学院', group: '二级学院' },
  { id: 'dsj', name: '大数据学院', group: '二级学院' },
  { id: 'wl', name: '物理学院', group: '二级学院' },
  { id: 'sx', name: '数学科学学院', group: '二级学院' },
  { id: 'hx', name: '化学与材料科学学院', group: '二级学院' },
  { id: 'sm', name: '生命科学与医学部', group: '二级学院' },
  { id: 'gx', name: '信息科学技术学院', group: '二级学院' },
  { id: 'dx', name: '地球与空间科学学院', group: '二级学院' },
]

export const HOME_TABS: NoticeCategory[] = [
  '全部',
  '教务通知',
  '学术讲座',
  '学科竞赛',
  '校园生活',
  '迎新特辑',
]
