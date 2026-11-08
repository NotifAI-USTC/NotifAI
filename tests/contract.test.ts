import assert from 'node:assert/strict'
import { it } from 'vitest'
import {
  parseCalendarListResponse,
  parseNoticeBatchResponse,
  parseNoticeItem,
} from '../src/utils/validation.ts'

/**
 * 手工契约样例对应后端 contracts/ 中的 2026-11 升级。
 * 后端字段变化时更新这份样例，并同步前端解析器，避免线上静默丢条。
 */
const notice = {
  id: 'contract-notice-1',
  title: '关于校园网维护的通知',
  source: '网络信息中心',
  categories: ['other'],
  contentType: 'notice',
  publishDate: null,
  aiSummary: '校园网将于周末维护。',
  deadline: null,
  targetAudience: '全体师生',
  coreAction: '提前保存资料',
  originUrl: '',
  cleanContent: '',
  attachments: [],
  firstSeen: '2026-11-07T16:30:00Z',
  lastCrawl: '2026-11-08T01:05:00Z',
}

it('accepts the upgraded notice contract with nullable dates and empty origin URLs', () => {
  const parsed = parseNoticeItem(notice)
  assert.equal(parsed.publishDate, null)
  assert.equal(parsed.originUrl, '')
  assert.equal(parsed.firstSeen, '2026-11-07T16:30:00Z')
  assert.equal(parsed.lastCrawl, '2026-11-08T01:05:00Z')
})

it('accepts ustclug origins and normalizes migrated sources', () => {
  const parsed = parseNoticeItem({
    ...notice,
    source: '招生办公室',
    originUrl: 'https://servers.ustclug.org/notices/1',
  })
  assert.equal(parsed.source, '本科招生网')
  assert.equal(parsed.originUrl, 'https://servers.ustclug.org/notices/1')
})

it('accepts the calendar response pagination fields', () => {
  const response = parseCalendarListResponse({
    items: [
      {
        id: 'contract-calendar-1',
        title: '日历条目',
        source: '教务处',
        contentType: null,
        publishDate: null,
        deadline: '2026-11-20',
      },
    ],
    total: 500,
    truncated: true,
  })
  assert.equal(response.items[0]?.publishDate, null)
  assert.equal(response.total, 500)
  assert.equal(response.truncated, true)
})

it('accepts light batch responses without bodies', () => {
  const response = parseNoticeBatchResponse({
    items: [{ ...notice, cleanContent: '' }],
    missing: ['contract-notice-2'],
  })
  assert.equal(response.items[0]?.cleanContent, '')
  assert.deepEqual(response.missing, ['contract-notice-2'])
})
