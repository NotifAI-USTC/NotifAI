/**
 * 计算距离截止日期的剩余天数
 * @returns 剩余天数（正数=未到期，0=当天，负数=已过期），deadline 为 null 时返回 null
 */
export function calculateRemainingDays(deadline: string | null): number | null {
  if (!deadline) return null
  const now = new Date()
  // 当天 00:00:00
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const deadlineDate = new Date(deadline)
  const diffTime = deadlineDate.getTime() - today.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * 格式化剩余天数显示
 * @returns "剩 X 天" / "今天截止" / "已过期" / "未提及"
 */
export function formatRemaining(deadline: string | null): string {
  const days = calculateRemainingDays(deadline)
  if (days === null) return '未提及'
  if (days < 0) return '已过期'
  if (days === 0) return '今天截止'
  return `剩 ${days} 天`
}

/**
 * 判断截止日期是否紧急（指定天数内）
 */
export function isUrgent(deadline: string | null, days = 3): boolean {
  const remaining = calculateRemainingDays(deadline)
  if (remaining === null) return false
  return remaining >= 0 && remaining <= days
}

/**
 * 格式化发布日期为可读字符串
 */
export function formatPublishDate(dateStr: string): string {
  const d = new Date(dateStr)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}年${m}月${day}日`
}
