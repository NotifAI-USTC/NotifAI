import assert from 'node:assert/strict'
import { it } from 'vitest'
import {
  getNoticeContentTypeName,
  isNoticeContentType,
  NOTICE_CONTENT_TYPE_DEFINITIONS,
} from '../src/types/notice.ts'
import {
  DataValidationError,
  assertNoticeId,
  normalizeHttpUrl,
  parseCalendarItem,
  parseCalendarListResponse,
  parseDeadlineItem,
  parseDeadlineListResponse,
  parseNoticeBatchResponse,
  parseNoticeItem,
  parseNoticeListResponse,
  parseSourceListResponse,
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
  assert.equal(parsed.invalidItemCount, 0)
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

it('strictly validates API timestamps without changing local date semantics', () => {
  const valid = {
    ...validNotice(),
    firstSeen: '2026-08-01T12:30:00',
    lastCrawl: '2026-02-28T23:59:59+08:00',
  }
  assert.doesNotThrow(() => parseNoticeItem(valid))

  const invalid = { ...validNotice(), firstSeen: '2026-02-29T12:30:00' }
  assert.throws(() => parseNoticeItem(invalid), DataValidationError)
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

it('preserves only supported content types and normalizes legacy missing values', () => {
  assert.deepEqual(NOTICE_CONTENT_TYPE_DEFINITIONS, [
    { key: 'news', name: '新闻' },
    { key: 'notice', name: '通知/公告' },
    { key: 'public_notice', name: '公示' },
    { key: 'other', name: '其他' },
  ])
  for (const { key, name } of NOTICE_CONTENT_TYPE_DEFINITIONS) {
    assert.equal(isNoticeContentType(key), true)
    assert.equal(getNoticeContentTypeName(key), name)
    assert.equal(parseNoticeItem({ ...validNotice(), contentType: key }).contentType, key)
  }
  assert.equal(parseNoticeItem(validNotice()).contentType, null)
  assert.equal(parseNoticeItem({ ...validNotice(), contentType: null }).contentType, null)
  for (const contentType of ['announcement', 'NEWS', '', ' news', ['news'], 1, false, {}]) {
    assert.equal(isNoticeContentType(contentType), false)
    assert.throws(
      () => parseNoticeItem({ ...validNotice(), contentType }),
      { name: 'DataValidationError', message: 'notice.contentType 必须是支持的内容类型或 null' },
    )
  }
})

it('skips invalid content types in list and batch while retaining valid and legacy items', () => {
  const items = [
    { ...validNotice(), id: 'known', contentType: 'public_notice' },
    { ...validNotice(), id: 'invalid', contentType: 'announcement' },
    { ...validNotice(), id: 'legacy' },
  ]
  const list = parseNoticeListResponse({ items, total: 3 })
  assert.deepEqual(list.items.map(({ id, contentType }) => [id, contentType]), [
    ['known', 'public_notice'],
    ['legacy', null],
  ])
  assert.equal(list.invalidItemCount, 1)
  const batch = parseNoticeBatchResponse({ items, missing: [] })
  assert.deepEqual(batch.items.map(({ id, contentType }) => [id, contentType]), [
    ['known', 'public_notice'],
    ['legacy', null],
  ])
})

it('validates content types in calendar and deadline responses', () => {
  const item = validNotice()
  for (const { key } of NOTICE_CONTENT_TYPE_DEFINITIONS) {
    assert.equal(parseCalendarItem({ ...item, contentType: key }).contentType, key)
    assert.equal(parseDeadlineItem({ ...item, contentType: key }).contentType, key)
  }
  assert.equal(parseCalendarItem(item).contentType, null)
  assert.equal(parseDeadlineItem({ ...item, contentType: null }).contentType, null)
  for (const contentType of ['announcement', 'NEWS', '', ['news'], 1]) {
    assert.throws(() => parseCalendarItem({ ...item, contentType }), {
      name: 'DataValidationError',
      message: 'calendarItem.contentType 必须是支持的内容类型或 null',
    })
    assert.throws(() => parseDeadlineItem({ ...item, contentType }), {
      name: 'DataValidationError',
      message: 'deadlineItem.contentType 必须是支持的内容类型或 null',
    })
  }
  const items = [
    { ...item, id: 'known', contentType: 'notice' },
    { ...item, id: 'invalid', contentType: 'NEWS' },
    { ...item, id: 'legacy' },
  ]
  assert.deepEqual(parseCalendarListResponse({ items }).map(({ id, contentType }) => [id, contentType]), [
    ['known', 'notice'],
    ['legacy', null],
  ])
  assert.deepEqual(parseDeadlineListResponse({ items, total: 3 }).items.map(({ id, contentType }) => [id, contentType]), [
    ['known', 'notice'],
    ['legacy', null],
  ])
})

it('rejects malformed list metadata, oversized result sets, and duplicate IDs', () => {
  for (const total of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(
      () => parseNoticeListResponse({ items: [validNotice()], total }),
      DataValidationError,
    )
  }
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

  const parsed = parseNoticeListResponse({ items: [bad, good], total: 1 })
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.items[0].id, 'notice-002')
  assert.equal(parsed.invalidItemCount, 1)
})

it('rejects duplicate source names at the API boundary', () => {
  assert.throws(
    () =>
      parseSourceListResponse([
        { name: '教务处', group: '校级部门', noticeCount: 1 },
        { name: '教务处', group: '校级部门', noticeCount: 2 },
      ]),
    DataValidationError,
  )
})
