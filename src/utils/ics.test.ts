import { describe, expect, it } from 'vitest'
import { buildMonthIcs } from './ics'

describe('buildMonthIcs', () => {
  it('emits date-only VEVENTs with escaped summaries', () => {
    const ics = buildMonthIcs([
      { uid: 'a-publish', start: '2026-08-07', title: '选课通知,注意;分隔', description: '来源: 教务处\n截止: 2026-08-10' },
    ])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260807')
    expect(ics).toContain('SUMMARY:选课通知\\,注意\\;分隔')
    expect(ics).toContain('DESCRIPTION:来源: 教务处\\n截止: 2026-08-10')
    expect(ics).toContain('UID:a-publish@notifai')
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
  })
})
