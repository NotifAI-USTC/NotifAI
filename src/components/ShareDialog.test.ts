import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeItem } from '../types/notice'

const mocks = vi.hoisted(() => ({
  shareNotice: vi.fn(),
  copyNoticeLink: vi.fn(),
  copyNoticeContent: vi.fn(),
  copyText: vi.fn(),
  qrToDataURL: vi.fn(),
}))

vi.mock('../utils/share', () => ({
  shareNotice: mocks.shareNotice,
  copyNoticeLink: mocks.copyNoticeLink,
  copyNoticeContent: mocks.copyNoticeContent,
  copyText: mocks.copyText,
  generateShareText: () => 'share text',
  isShareSupported: () => true,
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: mocks.qrToDataURL },
}))

vi.mock('../utils/appUrl', () => ({
  buildNoticeUrl: (id: string) => `https://notifai.example/#/detail/${id}`,
}))

import ShareDialog from './ShareDialog.vue'

const notice: NoticeItem = {
  id: 'notice-1',
  title: '通知',
  source: '教务处',
  categories: [],

  publishDate: '2026-08-01',
  aiSummary: '摘要',
  deadline: null,
  targetAudience: '',
  coreAction: '',
  originUrl: 'https://www.ustc.edu.cn/notices/1',
  cleanContent: '',
  attachments: [],
}

function mountDialog() {
  return shallowMount(ShareDialog, {
    props: { notice },
    global: {
      stubs: {
        VDialog: { template: '<div><slot /></div>' },
        VCard: { template: '<div><slot /></div>' },
        VCardTitle: { template: '<div><slot /></div>' },
        VCardText: { template: '<div><slot /></div>' },
        VList: { template: '<div><slot /></div>' },
        VSnackbar: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prevents concurrent native share attempts and reports a real failure', async () => {
    let resolveShare!: (result: 'failed') => void
    mocks.shareNotice.mockReturnValue(
      new Promise((resolve) => {
        resolveShare = resolve
      }),
    )
    const wrapper = mountDialog()
    const nativeShare = wrapper.find('[title="系统分享"]')

    await nativeShare.trigger('click')
    await nativeShare.trigger('click')
    expect(mocks.shareNotice).toHaveBeenCalledOnce()

    resolveShare('failed')
    await flushPromises()
    expect(wrapper.text()).toContain('系统分享失败，请改用复制链接')
  })

  it('cancels an earlier auto-close when a later copy action fails', async () => {
    mocks.copyNoticeLink.mockResolvedValue(true)
    mocks.copyNoticeContent.mockResolvedValue(false)
    const wrapper = mountDialog()

    await wrapper.find('[title="复制链接"]').trigger('click')
    await flushPromises()
    await wrapper.find('[title="复制内容"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.text()).toContain('复制失败')
  })

  it('generates a QR code for the notice URL and reveals it', async () => {
    mocks.qrToDataURL.mockResolvedValue('data:image/png;base64,FAKE')
    const wrapper = mountDialog()

    await wrapper.find('[title="二维码分享"]').trigger('click')
    await flushPromises()

    expect(mocks.qrToDataURL).toHaveBeenCalledWith(
      'https://notifai.example/#/detail/notice-1',
      expect.objectContaining({ width: 320 }),
    )
    const img = wrapper.find('.qr-image')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('data:image/png;base64,FAKE')
    expect(wrapper.text()).toContain('https://notifai.example/#/detail/notice-1')
  })

  it('reports a QR generation failure', async () => {
    mocks.qrToDataURL.mockRejectedValue(new Error('boom'))
    const wrapper = mountDialog()

    await wrapper.find('[title="二维码分享"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('二维码生成失败')
  })
})
