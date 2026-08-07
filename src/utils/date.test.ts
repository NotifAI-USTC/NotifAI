import { describe, expect, it } from 'vitest'
import {
  calculateRemainingDays,
  formatLocalDate,
  formatPublishDate,
  formatRemaining,
  getLocalToday,
  isUrgent,
  parseLocalDate,
  shiftLocalMonth,
} from './date'

describe('local calendar date helpers', () => {
  it('parses a date-only value without shifting it through UTC', () => {
    const date = parseLocalDate('2026-07-31')

    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(6)
    expect(date?.getDate()).toBe(31)
  })

  it('rejects malformed and impossible dates', () => {
    expect(parseLocalDate('2026-7-31')).toBeNull()
    expect(parseLocalDate('2023-02-29')).toBeNull()
    expect(parseLocalDate('not-a-date')).toBeNull()
    expect(parseLocalDate('2024-02-29')).not.toBeNull()
    expect(parseLocalDate('0099-01-01')?.getFullYear()).toBe(99)
  })

  it('calculates calendar days from the local date at any time of day', () => {
    const lateOnDeadlineDay = new Date(2026, 6, 31, 23, 59, 59)

    expect(calculateRemainingDays('2026-07-31', lateOnDeadlineDay)).toBe(0)
    expect(calculateRemainingDays('2026-08-01', lateOnDeadlineDay)).toBe(1)
    expect(calculateRemainingDays('2026-07-30', lateOnDeadlineDay)).toBe(-1)
    expect(calculateRemainingDays('invalid', lateOnDeadlineDay)).toBeNull()
  })

  it('moves month navigation to day one instead of overflowing month-end', () => {
    expect(shiftLocalMonth('2026-07-31', 1)).toBe('2026-08-01')
    expect(shiftLocalMonth('2026-01-31', -1)).toBe('2025-12-01')
  })

  it('formats dates using local calendar components', () => {
    const localDate = new Date(2026, 6, 31, 23, 30)

    expect(formatLocalDate(localDate)).toBe('2026-07-31')
    expect(getLocalToday(localDate)).toBe('2026-07-31')
    expect(formatPublishDate('2026-07-31')).toBe('2026年07月31日')
    expect(formatPublishDate('invalid')).toBe('未知日期')
  })
})

describe('isUrgent and formatRemaining with injectable now', () => {
  const now = new Date(2026, 7, 5) // 2026-08-05

  it('classifies urgency within the configured window', () => {
    expect(isUrgent('2026-08-05', 3, now)).toBe(true) // 今天
    expect(isUrgent('2026-08-08', 3, now)).toBe(true) // 第 3 天
    expect(isUrgent('2026-08-09', 3, now)).toBe(false) // 第 4 天
    expect(isUrgent('2026-08-04', 3, now)).toBe(false) // 已过期
    expect(isUrgent(null, 3, now)).toBe(false)
    expect(isUrgent('2026-08-08', 0, now)).toBe(false) // 当天窗口
    expect(isUrgent('2026-08-05', 0, now)).toBe(true)
  })

  it('formats remaining text deterministically', () => {
    expect(formatRemaining('2026-08-05', now)).toBe('今天截止')
    expect(formatRemaining('2026-08-06', now)).toBe('剩 1 天')
    expect(formatRemaining('2026-08-04', now)).toBe('已过期')
    expect(formatRemaining(null, now)).toBe('未提及')
  })
})
