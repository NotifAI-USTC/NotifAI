import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { NOTICE_CATEGORY_DEFINITIONS } from '../../src/types/notice'
import type { NoticeItem } from '../../src/types/notice'

declare global {
  interface Window {
    __reportMigrationError: (message: string) => Promise<void>
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

// The same API fixtures exercise real Axios/validation in both dev and preview.
// Production never enables the application mock module.
const contentTypes: NoticeItem['contentType'][] = [
  'public_notice', 'news', 'notice', 'other', null, 'public_notice', 'notice', null,
]
const notices: NoticeItem[] = Array.from({ length: 8 }, (_, index) => ({
  id: `migration-${index + 1}`,
  title:
    index === 0
      ? '关于本学期本科生课程安排、考试报名和培养计划调整的通知（含多学院联合办理要求及详细说明）'
      : `校园通知 ${index + 1}`,
  source: index % 2 === 0 ? '教务处' : '计算机学院',
  contentType: contentTypes[index],
  categories: index === 0 ? ['exam', 'course_info', 'scholarship'] : index === 2 ? [] : index === 3 ? ['other'] : ['exam'],
  publishDate: '2026-10-12',
  aiSummary: '请核对课程安排与报名时间，按通知要求完成办理。',
  deadline: index < 2 ? `2026-10-${13 + index}` : null,
  targetAudience: '全体本科生',
  coreAction: '登录教务系统办理',
  originUrl: `https://www.teach.ustc.edu.cn/notice/${index + 1}.html`,
  cleanContent:
    '# 通知正文\n\n请在截止日期前完成申请。\n\n| 办理事项 | 地点 |\n| --- | --- |\n| 课程报名 | 教务系统 |',
  attachments: [{ name: '课程安排.pdf', url: 'https://www.teach.ustc.edu.cn/files/courses.pdf' }],
}))

interface ApiState {
  failList: boolean
  pauseList: Promise<void> | null
  resumeList: () => void
  pauseDetail: Promise<void> | null
  resumeDetail: () => void
  listUrls: string[]
  nativeErrors: string[]
}

async function installApi(page: Page): Promise<ApiState> {
  const state: ApiState = {
    failList: false,
    pauseList: null,
    resumeList: () => undefined,
    pauseDetail: null,
    resumeDetail: () => undefined,
    listUrls: [],
    nativeErrors: [],
  }
  // ResizeObserver reports through window.error rather than CDP pageerror.
  // Capture it across navigations as well as regular JavaScript exceptions.
  await page.exposeFunction('__reportMigrationError', (message: string) => {
    state.nativeErrors.push(message)
  })
  await page.addInitScript(() => {
    window.addEventListener('error', (event) => {
      void window.__reportMigrationError(event.message)
    })
  })
  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/api/', '')
    let response: unknown
    if (path === 'sources') {
      response = [
        { name: '教务处', group: '校级部门', noticeCount: 4 },
        { name: '研究生院', group: '校级部门', noticeCount: 0 },
        { name: '计算机学院', group: '二级学院', noticeCount: 4 },
      ]
    } else if (path === 'categories') {
      response = NOTICE_CATEGORY_DEFINITIONS.map((category) => ({ ...category, noticeCount: 8 }))
    } else if (path === 'stats') {
      response = {
        total: 8,
        sourceCount: 2,
        last7DaysDdl: 2,
        last24hNew: 8,
        lastCrawlAt: '2026-10-13T04:00:00Z',
      }
    } else if (path === 'notices/deadlines') {
      response = { items: notices.filter((notice) => notice.deadline), total: 2 }
    } else if (path === 'notices/calendar') {
      response = { items: notices }
    } else if (path === 'notices/batch') {
      const body: { ids: string[] } = route.request().postDataJSON()
      response = { items: notices.filter((notice) => body.ids.includes(notice.id)), missing: [] }
    } else if (path.startsWith('notices/')) {
      if (path === 'notices/migration-3' && state.pauseDetail) await state.pauseDetail
      response = notices.find((notice) => notice.id === path.slice('notices/'.length))
    } else if (path === 'notices') {
      state.listUrls.push(url.href)
      if (state.pauseList) await state.pauseList
      if (state.failList) {
        await route.fulfill({ status: 503, json: { message: '暂时不可用' } })
        return
      }
      const contentType = url.searchParams.get('contentType')
      const categories = url.searchParams.getAll('categories[]')
      const filtered = notices.filter((notice) =>
        (contentType === null || notice.contentType === contentType) &&
        (categories.length === 0 || notice.categories.some((category) => categories.includes(category))),
      )
      response = {
        items: filtered.map((notice) => ({ ...notice, cleanContent: '' })),
        total: filtered.length,
        nextCursor: null,
      }
    } else {
      await route.fulfill({ status: 404, json: {} })
      return
    }
    await route.fulfill({ json: response })
  })
  return state
}

async function openApp(page: Page, width: number, theme: 'light' | 'dark', onboarded = true) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date('2026-10-13T04:00:00Z'))
  if (onboarded) {
    await page.addInitScript(() => localStorage.setItem('notifai_has_onboarded', 'true'))
  }
  await page.goto('/#/')
  await expect(page.locator('.v-application')).toHaveClass(new RegExp(`v-theme--${theme}`))
}

async function expectNaturalBannerHeight(banner: Locator) {
  await expect(banner).toBeVisible()
  const dimensions = await banner.evaluate((element) => {
    const style = getComputedStyle(element)
    const rowHeight = Math.max(
      ...Array.from(element.children)
        .filter((child) =>
          ['v-alert__content', 'v-alert__prepend', 'v-alert__append', 'v-alert__close'].some(
            (name) => child.classList.contains(name),
          ),
        )
        .map((child) => child.getBoundingClientRect().height),
    )
    return {
      height: element.getBoundingClientRect().height,
      expectedHeight:
        rowHeight +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth),
      flexGrow: style.flexGrow,
    }
  })
  expect(dimensions.flexGrow).toBe('0')
  expect(dimensions.height).toBeLessThanOrEqual(dimensions.expectedHeight + 2)
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    ),
  ).toBe(false)
}

for (const width of [320, 390, 768, 960, 1280, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`MD3 layout and DDL stay compact at ${width}px in ${theme} theme`, async ({ page }) => {
      const problems: string[] = []
      page.on('pageerror', (error) => problems.push(error.message))
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type())) problems.push(message.text())
      })
      const state = await installApi(page)
      await openApp(page, width, theme)
      await expect(page.getByRole('link', { name: /^打开通知：/ })).toHaveCount(8)
      const banner = page.locator('.ddl-notice-bar')
      await expectNaturalBannerHeight(banner)
      expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(72)
      const deadline = await banner.locator('.ddl-notice-bar__chip-deadline').first().boundingBox()
      const slider = await banner.locator('.v-slide-group__container').boundingBox()
      expect(deadline!.x + deadline!.width).toBeLessThanOrEqual(slider!.x + slider!.width)
      await expect
        .poll(() =>
          page.locator('.notice-col').evaluateAll((cols) => {
            const top = cols[0].getBoundingClientRect().top
            return cols.filter((col) => Math.abs(col.getBoundingClientRect().top - top) < 1).length
          }),
        )
        .toBe(width < 960 ? 1 : width < 1145 ? 3 : 4)
      await expect(page.locator('.v-bottom-navigation')).toHaveCount(width < 960 ? 1 : 0)
      await expect(page.locator('.v-navigation-drawer')).toHaveCount(width < 960 ? 0 : 1)
      const card = page.locator('.notice-card').first()
      expect(
        await card.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius)),
      ).toBeGreaterThanOrEqual(8)
      await expectNoOverflow(page)
      await page
        .getByRole('link', { name: /^打开通知：/ })
        .first()
        .click()
      await expect(page.locator('.clean-content')).toContainText('通知正文')
      await expectNoOverflow(page)
      expect(problems).toEqual([])
      expect(state.nativeErrors).toEqual([])
    })
  }
}

for (const width of [390, 1280]) {
  test(`cache, retry and close banners size to their content at ${width}px`, async ({ page }) => {
    const state = await installApi(page)
    await openApp(page, width, 'light')
    await expect(page.getByRole('link', { name: /^打开通知：/ })).toHaveCount(8)
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('notifai-cache')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          try {
            return await new Promise<number>((resolve) => {
              const request = database
                .transaction('notice-feeds', 'readonly')
                .objectStore('notice-feeds')
                .count()
              request.onsuccess = () => resolve(request.result)
            })
          } finally {
            database.close()
          }
        }),
      )
      .toBeGreaterThan(0)

    state.pauseList = new Promise<void>((resolve) => {
      state.resumeList = resolve
    })
    try {
      await page.reload()
      const cacheBanner = page.locator('.app-banner').filter({ hasText: '正在同步最新通知' })
      await expectNaturalBannerHeight(cacheBanner)
      await expect(page.getByRole('link', { name: /^打开通知：/ })).toHaveCount(8)
      state.failList = true
      state.resumeList()
      state.pauseList = null
      const errorBanner = page.locator('.app-banner').filter({ hasText: '可点击重试' })
      await expectNaturalBannerHeight(errorBanner)
      await expect(errorBanner.getByRole('button', { name: '重试', exact: true })).toBeVisible()
      state.failList = false
      await errorBanner.getByRole('button', { name: '重试', exact: true }).click()
      await expect(errorBanner).toHaveCount(0)
      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      const filterBanner = page.locator('.app-banner').filter({ hasText: '高级搜索已启用' })
      await expectNaturalBannerHeight(filterBanner)
      await filterBanner.locator('.v-alert__close button').click()
      await expect(filterBanner).toHaveCount(0)
      await expectNoOverflow(page)
      expect(state.nativeErrors).toEqual([])
    } finally {
      state.resumeList()
    }
  })
}

test('wrapping notice labels stay stable through route changes with animations enabled', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const state = await installApi(page)
  await openApp(page, 1280, 'light')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByRole('link', { name: /^打开通知：/ })).toHaveCount(8)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0)
  await page
    .getByRole('link', { name: /^打开通知：/ })
    .first()
    .click()
  await expect(page.locator('.clean-content')).toContainText('通知正文')
  await page.goto('/#/')
  await expect(page.getByRole('link', { name: /^打开通知：/ })).toHaveCount(8)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0)
  expect(errors).toEqual([])
  expect(state.nativeErrors).toEqual([])
})

for (const theme of ['light', 'dark'] as const) {
  test(`MD3 pages, overlays and keyboard focus work in ${theme} theme`, async ({ page }) => {
    const problems: string[] = []
    page.on('pageerror', (error) => problems.push(error.message))
    const state = await installApi(page)
    await openApp(page, 390, theme)
    const firstLink = page.getByRole('link', { name: /^打开通知：/ }).first()
    await expect(firstLink).toBeVisible()
    await firstLink.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.clean-content')).toContainText('通知正文')
    await expect(page.getByText('课程安排.pdf', { exact: true })).toBeVisible()
    await expectNoOverflow(page)
    await page.goto('/#/')
    const firstCard = page.locator('.notice-card').first()
    await expect(firstCard).toBeVisible()
    await firstCard.getByRole('button', { name: '分享通知', exact: true }).click()
    await expect(page.getByText('二维码分享', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('二维码分享', { exact: true })).toHaveCount(0)
    await expect(firstCard.getByRole('button', { name: '分享通知', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '打开高级搜索' }).click()
    const sourceSelect = page.getByRole('combobox', { name: '来源', exact: true })
    await sourceSelect.focus()
    await sourceSelect.press('ArrowDown')
    await expect(page.getByRole('option', { name: '教务处', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option', { name: '教务处', exact: true })).toHaveCount(0)
    const closeSearch = page.getByRole('dialog').getByRole('button', { name: '关闭高级搜索' })
    await expect(closeSearch).toBeVisible()
    await closeSearch.click()
    await expect(page.getByRole('combobox', { name: '来源', exact: true })).toHaveCount(0)

    for (const path of ['/favorites', '/calendar', '/user', '/user/subscription']) {
      await page.goto(`/#${path}`)
      await expect(page.locator('.v-app-bar-title')).toBeVisible()
      if (path === '/calendar') {
        await expect(page.locator('.mobile-agenda')).toBeVisible()
        await page.getByRole('button', { name: '周', exact: true }).click()
        await expect(page.locator('.week-agenda')).toBeVisible()
      }
      if (path === '/user/subscription') {
        await expect(page.getByText('考试安排', { exact: true })).toBeVisible()
      }
      await expectNoOverflow(page)
      const results = await new AxeBuilder({ page }).disableRules(['aria-tooltip-name']).analyze()
      expect(
        results.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
      ).toEqual([])
    }
    await page.goto('/#/user')
    await page.getByText('意见反馈', { exact: true }).click()
    await page.getByRole('button', { name: '复制邮箱', exact: true }).click()
    const snackbar = page.locator('.v-snackbar').filter({ hasText: '邮箱已复制' })
    await expect(snackbar).toBeVisible()
    await snackbar.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(snackbar).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 320, height: 900 })
    await page.getByText('重新进行入门引导', { exact: true }).click()
    await expect
      .poll(() =>
        page
          .locator('.onboarding-header')
          .evaluate((header) => header.scrollWidth - header.clientWidth),
      )
      .toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: '开始个性化配置' }).click()
    const choices = page.locator('.identity-option')
    await expect(choices).toHaveCount(4)
    await page.getByRole('button', { name: /^本科生/ }).click()
    await expect(page.getByRole('button', { name: /^本科生/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      await choices.evaluateAll(
        (buttons) =>
          buttons.filter(
            (button) =>
              button.classList.contains('text-primary') || button.classList.contains('bg-primary'),
          ).length,
      ),
    ).toBe(1)
    await expectNoOverflow(page)
    expect(problems).toEqual([])
    expect(state.nativeErrors).toEqual([])
  })
}

function cardFor(page: Page, index: number) {
  return page.locator('.notice-card').filter({ has: page.getByRole('link', { name: `打开通知：${notices[index - 1].title}` }) })
}

async function expectCards(page: Page, indices: number[]) {
  await expect(page.locator('.notice-card')).toHaveCount(indices.length)
  for (let index = 1; index <= notices.length; index++) {
    await expect(cardFor(page, index)).toHaveCount(indices.includes(index) ? 1 : 0)
  }
}

async function selectContentType(page: Page, name: string) {
  const select = page.getByRole('combobox', { name: '内容类型', exact: true })
  await select.focus()
  await select.press('ArrowDown')
  await page.getByRole('option', { name, exact: true }).click()
}

async function clearSelect(page: Page, name: string) {
  const input = page.locator('.v-input').filter({ has: page.getByRole('combobox', { name, exact: true }) })
  await input.locator('.v-field__clearable').click()
}

for (const width of [320, 1280]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`temporary content type filters at ${width}px in ${theme} theme`, async ({ page }, testInfo) => {
      test.setTimeout(90_000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const state = await installApi(page)
      await openApp(page, width, theme)
      await expectCards(page, [1, 2, 3, 4, 5, 6, 7, 8])
      expect(new URL(state.listUrls.at(-1)!).searchParams.has('contentType')).toBe(false)
      for (const [index, label] of [[1, '公示'], [2, '新闻'], [3, '通知/公告'], [4, '其他']] as const) {
        await expect(cardFor(page, index).getByLabel(`内容类型：${label}`)).toBeVisible()
      }
      for (const index of [5, 8]) await expect(cardFor(page, index).locator('[aria-label^="内容类型："]')).toHaveCount(0)

      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await page.getByRole('combobox', { name: '内容类型', exact: true }).focus()
      await expectNoOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`type-selector-${width}-${theme}.png`) })
      await selectContentType(page, '公示')
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expectCards(page, [1, 6])
      let params = new URL(state.listUrls.at(-1)!).searchParams
      expect(params.getAll('contentType')).toEqual(['public_notice'])
      await expect(page.locator('.app-banner').filter({ hasText: '高级搜索已启用' })).toContainText('类型: 公示')
      await expectNoOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`type-results-${width}-${theme}.png`) })

      await page.getByRole('button', { name: '打开高级搜索' }).click()
      const category = page.getByRole('combobox', { name: '通知分类', exact: true })
      await category.click()
      await page.getByRole('option', { name: /^奖学金(?:（8）)?$/ }).click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expectCards(page, [1])
      params = new URL(state.listUrls.at(-1)!).searchParams
      expect(params.getAll('contentType')).toEqual(['public_notice'])
      expect(params.getAll('categories[]')).toContain('scholarship')

      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await clearSelect(page, '通知分类')
      await selectContentType(page, '新闻')
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expectCards(page, [2])
      for (const [label, indices] of [['通知/公告', [3, 7]], ['其他', [4]]] as const) {
        await page.getByRole('button', { name: '打开高级搜索' }).click()
        await selectContentType(page, label)
        await page.getByRole('button', { name: '搜索', exact: true }).click()
        await expectCards(page, [...indices])
      }
      await expect(cardFor(page, 4).getByLabel('内容类型：其他')).toBeVisible()
      await expect(cardFor(page, 4)).toContainText('其他通知')

      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await expect(page.getByRole('dialog').getByText('其他', { exact: true })).toBeVisible()
      await selectContentType(page, '新闻')
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expectCards(page, [4])
      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await clearSelect(page, '内容类型')
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expectCards(page, [1, 2, 3, 4, 5, 6, 7, 8])
      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await selectContentType(page, '新闻')
      await page.getByRole('button', { name: '重置', exact: true }).click()
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expectCards(page, [1, 2, 3, 4, 5, 6, 7, 8])
      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await selectContentType(page, '新闻')
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expectCards(page, [2])
      await page.locator('.app-banner').filter({ hasText: '高级搜索已启用' }).locator('.v-alert__close button').click()
      await expectCards(page, [1, 2, 3, 4, 5, 6, 7, 8])
      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await selectContentType(page, '新闻')
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expectCards(page, [2])
      await page.reload()
      await expectCards(page, [1, 2, 3, 4, 5, 6, 7, 8])
      await expect.poll(() => new URL(state.listUrls.at(-1)!).searchParams.has('contentType')).toBe(false)

      await cardFor(page, 3).getByRole('link').click()
      await expect(page.locator('.clean-content')).toContainText('通知正文')
      await expect(page.getByLabel('内容类型：通知/公告')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`type-detail-${width}-${theme}.png`) })
      await page.goto('/#/')
      await cardFor(page, 1).getByRole('button', { name: '收藏通知' }).click()
      await page.getByRole('dialog').getByText('默认收藏', { exact: true }).click()
      await page.goto('/#/favorites')
      await expect(cardFor(page, 1).getByLabel('内容类型：公示')).toBeVisible()
      await page.goto('/#/')
      await page.getByRole('button', { name: '打开高级搜索' }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expectNoOverflow(page)
      expect(errors).toEqual([])
      expect(state.nativeErrors).toEqual([])
    })
  }
}

test('legacy IndexedDB feed and detail without content type update from the network', async ({ page }) => {
  const state = await installApi(page)
  await openApp(page, 1280, 'light')
  await expectCards(page, [1, 2, 3, 4, 5, 6, 7, 8])
  const key = '{"keyword":"","source":"","categories":[],"dateFrom":"","dateTo":"","isRead":"any","isStarred":"any","tags":[],"blacklistKeywords":[]}'
  await expect.poll(() => page.evaluate(async (cacheKey) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('notifai-cache')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const request = db.transaction('notice-feeds').objectStore('notice-feeds').get(cacheKey)
        request.onsuccess = () => resolve(request.result?.schemaVersion === 2)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  }, key)).toBe(true)
  await page.evaluate(async ({ cacheKey, notice }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('notifai-cache')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['notice-feeds', 'notice-details'], 'readwrite')
        const feeds = transaction.objectStore('notice-feeds')
        const request = feeds.get(cacheKey)
        request.onsuccess = () => {
          const entry = request.result
          for (const item of entry.items) delete item.contentType
          feeds.put(entry)
          const oldNotice: Partial<typeof notice> = { ...notice }
          delete oldNotice.contentType
          transaction.objectStore('notice-details').put({ schemaVersion: 1, id: notice.id, notice: oldNotice, fetchedAt: new Date().toISOString() })
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally { db.close() }
  }, { cacheKey: key, notice: notices[2] })
  const listGate = deferred()
  const detailGate = deferred()
  state.pauseList = listGate.promise
  state.resumeList = listGate.resolve
  state.pauseDetail = detailGate.promise
  state.resumeDetail = detailGate.resolve
  try {
    await page.reload()
    await expectCards(page, [1, 2, 3, 4, 5, 6, 7, 8])
    await expect(page.locator('.app-banner').filter({ hasText: '正在同步最新通知' })).toBeVisible()
    await expect(page.locator('.notice-card [aria-label^="内容类型："]')).toHaveCount(0)
    state.resumeList()
    state.pauseList = null
    await expect(cardFor(page, 3).getByLabel('内容类型：通知/公告')).toBeVisible()
    await cardFor(page, 3).getByRole('link').click()
    await expect(page.locator('.clean-content')).toContainText('通知正文')
    await expect(page.locator('[aria-label^="内容类型："]')).toHaveCount(0)
    state.resumeDetail()
    state.pauseDetail = null
    await expect(page.getByLabel('内容类型：通知/公告')).toBeVisible()
    expect(state.nativeErrors).toEqual([])
  } finally {
    state.resumeList()
    state.resumeDetail()
  }
})
