import { beforeEach, describe, expect, it } from 'vitest'
import { clearSearchHistory, loadSearchHistory, recordSearchHistory } from './searchHistory'

beforeEach(() => {
  window.localStorage.clear()
})

describe('searchHistory', () => {
  it('records keywords most-recent-first with deduplication', () => {
    expect(recordSearchHistory('选课')).toEqual(['选课'])
    expect(recordSearchHistory('考试')).toEqual(['考试', '选课'])
    expect(recordSearchHistory('选课')).toEqual(['选课', '考试'])
    expect(loadSearchHistory()).toEqual(['选课', '考试'])
  })

  it('ignores blank keywords and caps history size', () => {
    recordSearchHistory('  ')
    expect(loadSearchHistory()).toEqual([])
    for (let i = 0; i < 15; i += 1) recordSearchHistory(`kw-${i}`)
    const history = loadSearchHistory()
    expect(history).toHaveLength(10)
    expect(history[0]).toBe('kw-14')
  })

  it('falls back to empty list on corrupted payload', () => {
    window.localStorage.setItem('notifai-search-history', '{not-json')
    expect(loadSearchHistory()).toEqual([])
    window.localStorage.setItem('notifai-search-history', JSON.stringify(['ok', 42, 'ok']))
    expect(loadSearchHistory()).toEqual(['ok'])
  })

  it('clears the history', () => {
    recordSearchHistory('选课')
    clearSearchHistory()
    expect(loadSearchHistory()).toEqual([])
  })
})
