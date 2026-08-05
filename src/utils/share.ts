/**
 * 分享功能工具
 */

import type { NoticeItem } from '../types/notice'
import { buildNoticeUrl } from './appUrl'

function noticeUrl(id: string): string {
  return buildNoticeUrl(id)
}

function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) {
      return fallbackCopy(text)
    }
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return fallbackCopy(text)
  }
}

// 检查是否支持 Web Share API
export function isShareSupported(): boolean {
  return typeof navigator.share === 'function'
}

export type ShareResult = 'shared' | 'canceled' | 'failed' | 'unsupported'

// 原生分享
export async function shareNotice(notice: NoticeItem): Promise<ShareResult> {
  if (!isShareSupported()) {
    return 'unsupported'
  }

  try {
    await navigator.share({
      title: notice.title,
      text: `${notice.title}\n\n${notice.aiSummary}`,
      url: noticeUrl(notice.id),
    })
    return 'shared'
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError'
    ) {
      return 'canceled'
    }
    console.error('分享失败:', error)
    return 'failed'
  }
}

// 复制链接
export async function copyNoticeLink(notice: NoticeItem): Promise<boolean> {
  return copyText(noticeUrl(notice.id))
}

// 复制通知内容
export async function copyNoticeContent(notice: NoticeItem): Promise<boolean> {
  const content = `${notice.title}\n\n${notice.aiSummary}\n\n来源: ${notice.source}\n发布时间: ${notice.publishDate}`

  return copyText(content)
}

// 生成分享文本（纯文本，复制到剪贴板用；不使用 emoji，改用文字标签保证跨平台可读性）
export function generateShareText(notice: NoticeItem): string {
  let text = `【通知】${notice.title}\n`
  text += `【摘要】${notice.aiSummary}\n`
  text += `【来源】${notice.source}\n`

  if (notice.deadline) {
    text += `【截止】${notice.deadline}\n`
  }

  text += `\n【链接】${noticeUrl(notice.id)}`

  return text
}
