import { describe, expect, it } from 'vitest'
import {
  calculateRemainingDays,
  formatLocalDate,
  formatPublishDate,
  getLocalToday,
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
