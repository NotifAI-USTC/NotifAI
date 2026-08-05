import { describe, expect, it } from 'vitest'
import { isOffsetPageExhausted, isOffsetPageInconsistent } from './pagination'

describe('isOffsetPageExhausted', () => {
  it('continues after a full page even when every item duplicates an earlier page', () => {
    const knownIds = new Set(Array.from({ length: 15 }, (_, index) => `notice-${index}`))
    const duplicatePage = Array.from({ length: 15 }, (_, index) => ({ id: `notice-${index}` }))
    const addedCount = duplicatePage.filter((notice) => !knownIds.has(notice.id)).length

    expect(addedCount).toBe(0)
    expect(
      isOffsetPageExhausted({
        itemCount: duplicatePage.length,
        page: 2,
        pageSize: 15,
        total: 45,
      }),
    ).toBe(false)
  })

  it('stops only when the returned items account for the reported total', () => {
    expect(isOffsetPageExhausted({ itemCount: 0, page: 1, pageSize: 15, total: 0 })).toBe(true)
    expect(isOffsetPageExhausted({ itemCount: 10, page: 3, pageSize: 15, total: 40 })).toBe(true)
    expect(isOffsetPageExhausted({ itemCount: 15, page: 3, pageSize: 15, total: 45 })).toBe(true)
  })

  it('detects short or oversized pages that contradict the reported total', () => {
    expect(isOffsetPageInconsistent({ itemCount: 10, page: 2, pageSize: 15, total: 45 })).toBe(true)
    expect(isOffsetPageInconsistent({ itemCount: 15, page: 2, pageSize: 15, total: 45 })).toBe(
      false,
    )
    expect(isOffsetPageInconsistent({ itemCount: 10, page: 3, pageSize: 15, total: 40 })).toBe(
      false,
    )
  })
})
