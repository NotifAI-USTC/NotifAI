const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

/** 将 YYYY-MM-DD 严格解析为本地日历日。 */
export function parseLocalDate(dateStr: string): Date | null {
  const match = LOCAL_DATE_PATTERN.exec(dateStr)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(0, 0, 0, 0)

  // Date 会自动进位越界日期，因此需要反向核对。
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return date
}

/** 将 Date 格式化为本地 YYYY-MM-DD，无效日期返回空字符串。 */
export function formatLocalDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''

  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 获取本地时区中的今天。 */
export function getLocalToday(now = new Date()): string {
  return formatLocalDate(now)
}

/** 按月切换日历，固定返回目标月 1 日，避免月末溢出。 */
export function shiftLocalMonth(dateStr: string, delta: number): string | null {
  const date = parseLocalDate(dateStr)
  if (!date || !Number.isSafeInteger(delta)) return null

  return formatLocalDate(new Date(date.getFullYear(), date.getMonth() + delta, 1))
}

/** 按天切换日历，返回加减 delta 天后的本地日期。 */
export function shiftLocalDays(dateStr: string, delta: number): string | null {
  const date = parseLocalDate(dateStr)
  if (!date || !Number.isSafeInteger(delta)) return null

  return formatLocalDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta))
}

function calendarDayNumber(date: Date): number {
  const utcDate = new Date(0)
  utcDate.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate())
  utcDate.setUTCHours(0, 0, 0, 0)
  return utcDate.getTime() / MILLISECONDS_PER_DAY
}

/**
 * 计算距离截止日期的剩余天数
 * @returns 剩余天数（正数=未到期，0=当天，负数=已过期），缺失或无效日期返回 null
 */
export function calculateRemainingDays(deadline: string | null, now = new Date()): number | null {
  if (!deadline || Number.isNaN(now.getTime())) return null

  const deadlineDate = parseLocalDate(deadline)
  if (!deadlineDate) return null

  return calendarDayNumber(deadlineDate) - calendarDayNumber(now)
}

/**
 * 格式化剩余天数显示
 * @returns "剩 X 天" / "今天截止" / "已过期" / "未提及"
 */
export function formatRemaining(deadline: string | null, now = new Date()): string {
  const days = calculateRemainingDays(deadline, now)
  if (days === null) return '未提及'
  if (days < 0) return '已过期'
  if (days === 0) return '今天截止'
  return `剩 ${days} 天`
}

/**
 * 判断截止日期是否紧急（指定天数内）。
 * now 可注入用于确定性测试。
 */
export function isUrgent(deadline: string | null, days = 3, now = new Date()): boolean {
  const remaining = calculateRemainingDays(deadline, now)
  if (remaining === null) return false
  return remaining >= 0 && remaining <= days
}

/**
 * 格式化发布日期为可读字符串
 */
export function formatPublishDate(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  if (!d) return '未知日期'

  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}年${m}月${day}日`
}

/** 计算本地日期所属的 ISO 周序号（1-53）。 */
export function getIsoWeekNumber(dateStr: string): number | null {
  const date = parseLocalDate(dateStr)
  if (!date) return null

  // ISO 8601：周四所在的周为当前周
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayNr = (date.getDay() + 6) % 7 // 周一=0 ... 周日=6
  target.setDate(target.getDate() - dayNr + 3) // 移到本周周四

  const firstThursday = target.valueOf()
  target.setMonth(0, 1)
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7))
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 24 * 60 * 60 * 1000))
}

/** 计算本地日期所属的 ISO 周年（可能与日历年不同）。 */
export function getIsoWeekYear(dateStr: string): number | null {
  const date = parseLocalDate(dateStr)
  if (!date) return null

  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayNr = (date.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3) // 本周周四的年份即 ISO 周年
  return target.getFullYear()
}

/** 返回本地日期所属的 ISO 周字符串，如 "2026-W32"。无效日期返回 null。 */
export function getIsoWeek(dateStr: string): string | null {
  const year = getIsoWeekYear(dateStr)
  const week = getIsoWeekNumber(dateStr)
  if (year === null || week === null) return null
  return `${year}-W${String(week).padStart(2, '0')}`
}
