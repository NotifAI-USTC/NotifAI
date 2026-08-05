import { describe, expect, it } from 'vitest'
import type { NoticeItem } from '../types/notice'
import { getTagColor, recommendTags } from './tags'

function notice(overrides: Partial<NoticeItem> = {}): NoticeItem {
  return {
    id: 'notice-1',
    title: '普通公告',
    source: '教务处',

    publishDate: '2026-07-31',
    aiSummary: '',
    deadline: null,
    targetAudience: '',
    coreAction: '',
    originUrl: 'https://www.ustc.edu.cn/notice/1',
    cleanContent: '',
    attachments: [],
    ...overrides,
  }
}

describe('notice tag helpers', () => {
  it('does not read inherited properties for API-controlled sources or tags', () => {
    expect(() => recommendTags(notice({ source: 'constructor' }))).not.toThrow()
    expect(recommendTags(notice({ source: 'constructor' }))).toEqual(['通知'])
    expect(getTagColor('constructor')).toBe('#6b7280')
  })
})
