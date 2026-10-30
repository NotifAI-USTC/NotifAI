import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/#/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.localStorage.setItem('notifai_has_onboarded', 'true')
  })
  await page.reload()
})

test('loads the notice feed and opens a detail without runtime or layout errors', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await expect(page.getByPlaceholder(/搜索通知/)).toBeVisible()
  const firstNotice = page.getByRole('link', { name: /^打开通知：/ }).first()
  await expect(firstNotice).toBeVisible()

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(hasHorizontalOverflow).toBe(false)

  await firstNotice.click()
  await expect(page).toHaveURL(/#\/detail\/[A-Za-z0-9_-]+$/)
  await expect(page.locator('.v-app-bar-title', { hasText: '通知详情' })).toBeVisible()
  await expect(page.getByText('AI 秘书已为您提炼干货', { exact: true })).toBeVisible()
  expect(consoleErrors).toEqual([])
})

test('restores loaded pages and scroll position when returning from a notice', async ({ page }) => {
  const grid = page.locator('.notice-grid')
  await expect(page.locator('.notice-card')).toHaveCount(15)
  await grid.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(page.locator('.notice-card')).toHaveCount(30)
  const link = page.getByRole('link', { name: /^打开通知：/ }).nth(20)
  await link.scrollIntoViewIfNeeded()
  const label = await link.getAttribute('aria-label')
  const position = await grid.evaluate((element) => element.scrollTop)
  expect(position).toBeGreaterThan(0)
  await link.click()
  await expect(page).toHaveURL(/#\/detail\//)
  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(page).toHaveURL(/\/#\/$/)
  await expect(page.locator('.notice-card')).toHaveCount(30)
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeCloseTo(position, 0)
  await expect(page.getByRole('link', { name: label!, exact: true })).toBeInViewport()
  await page.getByRole('link', { name: label!, exact: true }).click()
  await expect(page).toHaveURL(/#\/detail\//)
  await page.goBack()
  await expect(page.locator('.notice-card')).toHaveCount(30)
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeCloseTo(position, 0)
})

test('persists a favorite and supports calendar and theme workflows', async ({ page }) => {
  const firstNotice = page.getByRole('link', { name: /^打开通知：/ }).first()
  await expect(firstNotice).toBeVisible()
  const firstCard = firstNotice.locator('xpath=ancestor::*[contains(@class, "notice-card")][1]')
  const noticeLabel = await firstNotice.getAttribute('aria-label')
  expect(noticeLabel).toBeTruthy()

  await firstCard.getByRole('button', { name: '收藏通知' }).click()
  await expect(page.getByText('选择收藏夹', { exact: true })).toBeVisible()
  await page.getByText('默认收藏', { exact: true }).click()
  await expect(firstCard.getByRole('button', { name: '管理通知收藏' })).toBeVisible()

  await page.reload()
  const persistedNotice = page.getByRole('link', { name: noticeLabel ?? '' })
  await expect(persistedNotice).toBeVisible()
  const persistedCard = persistedNotice.locator(
    'xpath=ancestor::*[contains(@class, "notice-card")][1]',
  )
  await expect(persistedCard.getByRole('button', { name: '管理通知收藏' })).toBeVisible()

  await page.goto('/#/user')
  await expect(page.locator('.v-app-bar-title', { hasText: '个人中心' })).toBeVisible()
  await expect(page.getByText('将已加载通知标为已读', { exact: true })).toBeVisible()
  await page.getByText('订阅与屏蔽', { exact: true }).click()
  await expect(page).toHaveURL(/#\/user\/subscription$/)
  await expect(page.locator('.v-app-bar-title', { hasText: '订阅与屏蔽' })).toBeVisible()
  await expect(page.getByText('通知分类', { exact: true })).toBeVisible()
  await expect(page.getByText('考试安排', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回个人中心' }).click()
  await expect(page).toHaveURL(/#\/user$/)

  await page.getByText('深色', { exact: true }).click()
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--dark/)

  await page.goto('/#/calendar')
  await expect(page.locator('.v-app-bar-title', { hasText: '通知日历' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toContainText(/\d{4}年\d{1,2}月/)
  await expect(page.getByText('无法加载当月通知')).toHaveCount(0)
})

test('reopens onboarding from the user center', async ({ page }) => {
  const desktopNavigation = page.locator('.v-navigation-drawer')
  if (await desktopNavigation.isVisible()) {
    await desktopNavigation.locator('.v-list-item').nth(3).click()
  } else {
    await page.getByText('我的', { exact: true }).click()
  }
  await expect(page.locator('.v-app-bar-title', { hasText: '个人中心' })).toBeVisible()

  await page.getByText('重新进行入门引导', { exact: true }).click()
  await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toBeVisible()
  await expect(page.getByText('1 / 4', { exact: true })).toBeVisible()
})

test('redirects an unknown route to the notice feed', async ({ page }) => {
  const consoleProblems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleProblems.push(message.text())
    }
  })
  await page.goto('/#/not-a-real-page')

  await expect(page).toHaveURL(/\/#\/$/)
  await expect(page.getByPlaceholder(/搜索通知/)).toBeVisible()
  expect(consoleProblems).toEqual([])
})
