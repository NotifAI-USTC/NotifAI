import { describe, expect, it } from 'vitest'
import { buildNoticeUrl, resolveAppAssetUrl } from './appUrl'

describe('application URLs', () => {
  it('preserves a configured deployment subpath', () => {
    const location = 'https://example.edu/NotifAI/#/user'

    expect(buildNoticeUrl('notice 1', '/NotifAI/', location)).toBe(
      'https://example.edu/NotifAI/#/detail/notice%201',
    )
    expect(resolveAppAssetUrl('/icons/icon.svg', '/NotifAI/', location)).toBe(
      'https://example.edu/NotifAI/icons/icon.svg',
    )
  })
})
