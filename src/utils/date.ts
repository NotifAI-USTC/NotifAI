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
