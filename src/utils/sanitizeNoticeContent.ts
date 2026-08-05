import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import type { NoticeItem } from '../types/notice'
import { normalizeHttpUrl, normalizeTrustedNoticeUrl } from './validation'

// cleanContent 是清洗后的纯文本/轻量 HTML/Markdown。
// 统一先按 Markdown 渲染（html:true 保留已存在 HTML，linkify 自动识别 URL，
// breaks 让单换行生效），再交给 DOMPurify 做净化，保证安全边界不变。
const markdown = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
})

const MAX_CONTENT_IMAGES = 50
const FORBIDDEN_TAGS = [
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'video',
  'audio',
  'source',
  'track',
  'style',
  'base',
  'link',
  'meta',
] as const
const FORBIDDEN_ATTRIBUTES = [
  'style',
  'class',
  'srcset',
  'poster',
  'ping',
  'download',
  'background',
  'action',
  'formaction',
  'xlink:href',
] as const

export interface SanitizedNoticeContent {
  html: string
  images: string[]
}

export function sanitizeNoticeContent(
  notice: Pick<NoticeItem, 'cleanContent' | 'originUrl'>,
): SanitizedNoticeContent {
  if (!notice.cleanContent) return { html: '', images: [] }

  // 以块级 HTML 标签开头的内容按 HTML 处理，避免 markdown-it 把缩进 HTML 误当代码块；
  // 其余内容（Markdown / 纯文本，含内联 HTML）统一走 markdown-it 渲染，
  // 其 html:true 会保留内嵌标签，最终仍由 DOMPurify 统一净化。
  const trimmed = notice.cleanContent.trim()
  const looksLikeHtml =
    /^<\/?(?:h[1-6]|p|div|table|ul|ol|li|blockquote|section|article|pre|style|iframe|form|svg|a|img)\b/i.test(
      trimmed,
    )
  const rendered = looksLikeHtml ? notice.cleanContent : markdown.render(notice.cleanContent)
  const sanitized = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [...FORBIDDEN_TAGS],
    FORBID_ATTR: [...FORBIDDEN_ATTRIBUTES],
  })
  const parsed = new DOMParser().parseFromString(String(sanitized), 'text/html')
  const sourceHref = normalizeTrustedNoticeUrl(notice.originUrl)
  const sourceUrl = sourceHref ? new URL(sourceHref) : null
  const images: string[] = []
  const imageUrls = new Set<string>()

  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    const tagName = element.tagName.toUpperCase()
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (
        FORBIDDEN_ATTRIBUTES.includes(name as (typeof FORBIDDEN_ATTRIBUTES)[number]) ||
        name.startsWith('on') ||
        (name === 'src' && tagName !== 'IMG') ||
        (name === 'href' && tagName !== 'A')
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  for (const anchor of Array.from(parsed.body.querySelectorAll('a'))) {
    const url = normalizeHttpUrl(anchor.getAttribute('href'), sourceUrl?.href)
    if (!url) {
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      anchor.removeAttribute('rel')
      continue
    }
    anchor.setAttribute('href', url)
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
    anchor.setAttribute('referrerpolicy', 'no-referrer')
  }

  for (const image of Array.from(parsed.body.querySelectorAll('img'))) {
    const url = normalizeHttpUrl(image.getAttribute('src'), sourceUrl?.href)
    const hostname = url ? new URL(url).hostname.toLowerCase() : ''
    const isTrustedHost = hostname === 'ustc.edu.cn' || hostname.endsWith('.ustc.edu.cn')
    if (!url || !isTrustedHost || imageUrls.size >= MAX_CONTENT_IMAGES) {
      image.remove()
      continue
    }
    image.setAttribute('src', url)
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')
    image.setAttribute('referrerpolicy', 'no-referrer')
    image.setAttribute('role', 'button')
    image.setAttribute('tabindex', '0')
    image.setAttribute('aria-label', image.getAttribute('alt') || '预览通知图片')
    if (!imageUrls.has(url)) {
      imageUrls.add(url)
      images.push(url)
    }
  }

  return { html: parsed.body.innerHTML, images }
}
