import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'
import { copyText, shareNotice } from './share'

const notice: NoticeItem = {
  id: 'notice-1',
  title: '通知',
  source: '教务处',

  publishDate: '2026-08-01',
  aiSummary: '摘要',
  deadline: null,
  targetAudience: '',
  coreAction: '',
  originUrl: 'https://www.ustc.edu.cn/notices/1',
  cleanContent: '',
  attachments: [],
}

describe('copyText', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
    Reflect.deleteProperty(document, 'execCommand')
  })

  it('reports failure when both clipboard paths fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new DOMException('denied')) },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    })

    await expect(copyText('notice')).resolves.toBe(false)
  })

  it('uses the checked fallback when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    await expect(copyText('notice')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })
})

describe('shareNotice', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share')
  })

  it('distinguishes success, user cancellation, and failure', async () => {
    const share = vi.fn().mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    await expect(shareNotice(notice)).resolves.toBe('shared')

    share.mockRejectedValueOnce(new DOMException('canceled', 'AbortError'))
    await expect(shareNotice(notice)).resolves.toBe('canceled')

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    share.mockRejectedValueOnce(new Error('share failed'))
    await expect(shareNotice(notice)).resolves.toBe('failed')
  })

  it('reports unsupported when the Web Share API is absent', async () => {
    await expect(shareNotice(notice)).resolves.toBe('unsupported')
  })
})
