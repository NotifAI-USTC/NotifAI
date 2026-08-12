/** 生成 .ics 日历文件（仅日期事件），供导入系统日历使用。 */

export interface IcsEvent {
  uid: string
  start: string // YYYY-MM-DD
  title: string
  description?: string
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function formatDateOnly(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

export function buildMonthIcs(
  events: IcsEvent[],
  productId = '-//NotifAI//USTC Notices//CN',
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
  ]
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@notifai`,
      `DTSTART;VALUE=DATE:${formatDateOnly(event.start)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
