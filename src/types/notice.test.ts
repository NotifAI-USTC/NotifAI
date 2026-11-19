import { describe, expect, it } from 'vitest'
import { SOURCE_CATALOG_FALLBACK } from './notice'

const LEGACY_SOURCE_NAMES = ['招生办公室', '国际合作与交流部', '计算机科学与技术学院']

describe('source catalog fallback', () => {
  it('contains the full current catalog without legacy or duplicate names', () => {
    const names = SOURCE_CATALOG_FALLBACK.map((source) => source.name)

    expect(names.length).toBeGreaterThanOrEqual(42)
    expect(new Set(names).size).toBe(names.length)
    for (const legacyName of LEGACY_SOURCE_NAMES) {
      expect(names).not.toContain(legacyName)
    }
  })

})
