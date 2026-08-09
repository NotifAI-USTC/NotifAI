import assert from 'node:assert/strict'
import { it } from 'vitest'
import {
  DataValidationError,
  assertNoticeId,
  normalizeHttpUrl,
  parseNoticeItem,
  parseNoticeListResponse,
} from '../src/utils/validation.ts'

function validNotice() {
  return {
    id: 'notice-001',
    title: '选课通知',
    source: '教务处',
    categories: ['course_selection'] as const,
    publishDate: '2026-07-31',
    aiSummary: '请按时完成选课。',
    deadline: '2026-08-05',
    targetAudience: '全体学生',
    coreAction: '登录教务系统',
    originUrl: 'https://www.ustc.edu.cn/notice/1',
    cleanContent: '<p>通知正文</p>',
    attachments: [{ name: '说明.pdf', url: 'https://www.ustc.edu.cn/files/guide.pdf' }],
  }
}

it('accepts a bounded notice response and returns a fresh object', () => {
  const source = validNotice()
  const parsed = parseNoticeListResponse({ items: [source], total: 1 })

  assert.equal(parsed.items[0].id, source.id)
  assert.notEqual(parsed.items[0], source)
  assert.equal('cleanContent' in parsed.items[0], true)
  assert.equal('attachments' in parsed.items[0], true)
})

it('rejects route traversal and reserved characters in notice IDs', () => {
  assert.throws(() => assertNoticeId('../admin'), DataValidationError)
  assert.throws(() => assertNoticeId('notice/1'), DataValidationError)
  assert.throws(() => assertNoticeId('notice?admin=true'), DataValidationError)
  assert.equal(assertNoticeId('lecture-001'), 'lecture-001')
})

it('accepts only HTTP(S) URLs without embedded credentials', () => {
  assert.equal(
    normalizeHttpUrl('/image.png', 'https://notice.example/'),
    'https://notice.example/image.png',
  )
  assert.equal(normalizeHttpUrl('javascript:alert(1)'), null)
  assert.equal(normalizeHttpUrl('data:text/html,test'), null)
  assert.equal(normalizeHttpUrl('https://user:pass@example.com/file'), null)

  const notice = validNotice()
  notice.attachments[0].url = 'javascript:alert(1)'
  assert.throws(() => parseNoticeItem(notice), DataValidationError)

  const untrustedSource = validNotice()
  untrustedSource.originUrl = 'https://attacker.example/notices/1'
  assert.throws(() => parseNoticeItem(untrustedSource), DataValidationError)
})

it('rejects impossible dates and oversized strings or arrays', () => {
  const invalidDate = validNotice()
  invalidDate.deadline = '2026-02-31'
  assert.throws(() => parseNoticeItem(invalidDate), DataValidationError)

  const implausibleDate = validNotice()
  implausibleDate.publishDate = '2200-01-01'
  assert.throws(() => parseNoticeItem(implausibleDate), DataValidationError)

  const oversizedTitle = validNotice()
  oversizedTitle.title = 'x'.repeat(501)
  assert.throws(() => parseNoticeItem(oversizedTitle), DataValidationError)

  const tooManyAttachments = validNotice()
  tooManyAttachments.attachments = Array.from({ length: 51 }, (_, index) => ({
    name: `${index}.pdf`,
    url: `https://www.ustc.edu.cn/files/${index}.pdf`,
  }))
  assert.throws(() => parseNoticeItem(tooManyAttachments), DataValidationError)

  // 过长的可选摘要会被截断而不是拒绝，保证单条脏数据不阻塞整个列表
  const oversizedSummary = validNotice()
  oversizedSummary.aiSummary = 'x'.repeat(20_000)
  const parsed = parseNoticeListResponse({ items: [oversizedSummary], total: 1 })
  assert.equal(parsed.items[0].aiSummary.length, 10_000)
})

it('validates notice category keys, limits, and duplicates', () => {
  const unknownCategory = { ...validNotice(), categories: ['not-a-category'] }
  assert.throws(() => parseNoticeItem(unknownCategory), DataValidationError)

  const duplicateCategory = { ...validNotice(), categories: ['exam', 'exam'] }
  assert.throws(() => parseNoticeItem(duplicateCategory), DataValidationError)

  const tooManyCategories = {
    ...validNotice(),
    categories: ['exam', 'course_info', 'admin', 'other'],
  }
  assert.throws(() => parseNoticeItem(tooManyCategories), DataValidationError)
})

it('rejects malformed list metadata, oversized result sets, and duplicate IDs', () => {
  assert.throws(
    () => parseNoticeListResponse({ items: [validNotice()], total: 0 }),
    DataValidationError,
  )
  assert.throws(
    () =>
      parseNoticeListResponse({
        items: Array.from({ length: 1001 }, () => validNotice()),
        total: 1001,
      }),
    DataValidationError,
  )
  assert.throws(
    () => parseNoticeListResponse({ items: [validNotice(), validNotice()], total: 2 }),
    DataValidationError,
  )
})

it('skips a single malformed item without failing the whole page', () => {
  const bad = validNotice()
  bad.originUrl = 'https://attacker.example/notices/1'
  const good = validNotice()
  good.id = 'notice-002'

  const parsed = parseNoticeListResponse({ items: [bad, good], total: 2 })
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.items[0].id, 'notice-002')
})
