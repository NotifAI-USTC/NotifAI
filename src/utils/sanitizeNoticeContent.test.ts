import { describe, expect, it } from 'vitest'
import { sanitizeNoticeContent } from './sanitizeNoticeContent'

describe('sanitizeNoticeContent', () => {
  it('removes active content, event handlers, unsafe links, and untrusted images', () => {
    const result = sanitizeNoticeContent({
      originUrl: 'https://notice.ustc.edu.cn/posts/1',
      cleanContent: `
        <style>body { display: none }</style>
        <iframe src="https://evil.example/embed"></iframe>
        <form action="https://evil.example"><input name="secret"></form>
        <svg onload="alert(1)"><circle></circle></svg>
        <a id="unsafe" href="javascript:alert(1)" onclick="alert(1)">unsafe</a>
        <a id="safe" href="/guide" style="color:red">guide</a>
        <img id="trusted" src="/images/map.png" onerror="alert(1)" style="width:9999px">
        <img id="external" src="https://evil.example/tracker.png">
      `,
    })

    const parsed = new DOMParser().parseFromString(result.html, 'text/html')
    expect(parsed.querySelector('style, iframe, form, input, svg')).toBeNull()
    expect(parsed.querySelector('#unsafe')?.hasAttribute('href')).toBe(false)
    expect(parsed.querySelector('#unsafe')?.hasAttribute('onclick')).toBe(false)
    expect(parsed.querySelector('#safe')?.getAttribute('href')).toBe(
      'https://notice.ustc.edu.cn/guide',
    )
    expect(parsed.querySelector('#safe')?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(parsed.querySelector('#safe')?.hasAttribute('style')).toBe(false)
    expect(parsed.querySelector('#external')).toBeNull()

    const trusted = parsed.querySelector('#trusted')
    expect(trusted?.getAttribute('src')).toBe('https://notice.ustc.edu.cn/images/map.png')
    expect(trusted?.getAttribute('loading')).toBe('lazy')
    expect(trusted?.hasAttribute('onerror')).toBe(false)
    expect(trusted?.hasAttribute('style')).toBe(false)
    expect(result.images).toEqual(['https://notice.ustc.edu.cn/images/map.png'])
  })

  it('drops relative links and images when the source URL is invalid', () => {
    const result = sanitizeNoticeContent({
      originUrl: 'not-a-url',
      cleanContent: '<a href="/relative">link</a><img src="/relative.png">',
    })

    const parsed = new DOMParser().parseFromString(result.html, 'text/html')
    expect(parsed.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(parsed.querySelector('img')).toBeNull()
    expect(result.images).toEqual([])
  })

  it('does not let an arbitrary source URL authorize its own image host', () => {
    const result = sanitizeNoticeContent({
      originUrl: 'https://attacker.example/notices/1',
      cleanContent: '<img src="https://attacker.example/tracker.png">',
    })

    expect(result.html).not.toContain('<img')
    expect(result.images).toEqual([])
  })
})

it('renders Markdown source into sanitized HTML', () => {
  const result = sanitizeNoticeContent({
    originUrl: 'https://notice.ustc.edu.cn/posts/1',
    cleanContent: `
# 标题一

正文段落 **加粗** 与 *斜体*。

- 列表项一
- 列表项二

> 引用内容

[链接](https://notice.ustc.edu.cn/docs) 和自动链接 https://notice.ustc.edu.cn/auto

\`\`\`
代码块
\`\`\`
      `,
  })

  const parsed = new DOMParser().parseFromString(result.html, 'text/html')
  expect(parsed.querySelector('h1')?.textContent).toContain('标题一')
  expect(parsed.querySelector('strong')?.textContent).toBe('加粗')
  expect(parsed.querySelector('em')?.textContent).toBe('斜体')
  expect(parsed.querySelectorAll('li')).toHaveLength(2)
  expect(parsed.querySelector('blockquote')?.textContent).toContain('引用内容')

  const links = Array.from(parsed.querySelectorAll('a'))
  expect(links.some((a) => a.getAttribute('href') === 'https://notice.ustc.edu.cn/docs')).toBe(true)
  // linkify 生成的自动链接也被保留
  expect(links.some((a) => a.getAttribute('href') === 'https://notice.ustc.edu.cn/auto')).toBe(true)
  expect(parsed.querySelector('pre code')?.textContent).toContain('代码块')
})

it('does not emit javascript: links from Markdown or inline HTML', () => {
  // markdown-it 默认拒绝渲染 javascript: 协议链接（保持为普通文本），
  // 内联 <script>/<img> 也会在 DOMPurify 阶段被移除。
  const result = sanitizeNoticeContent({
    originUrl: 'https://notice.ustc.edu.cn/posts/1',
    cleanContent:
      '普通文本 [危险](javascript:alert(2)) 和 <script>alert(1)</script><img src="https://evil.example/x.png">',
  })

  const parsed = new DOMParser().parseFromString(result.html, 'text/html')
  expect(parsed.querySelector('script')).toBeNull()
  expect(parsed.querySelector('img')).toBeNull()
  // javascript: 不被渲染为可点击链接（markdown-it 保留为纯文本）
  expect(parsed.querySelector('a[href^="javascript:"]')).toBeNull()
  expect(result.html).not.toContain('href="javascript:')
  // 正常 HTTPS 链接仍然保留
  const withSafe = sanitizeNoticeContent({
    originUrl: 'https://notice.ustc.edu.cn/posts/1',
    cleanContent: '[正常](https://notice.ustc.edu.cn/doc)',
  })
  expect(withSafe.html).toContain('href="https://notice.ustc.edu.cn/doc"')
})
