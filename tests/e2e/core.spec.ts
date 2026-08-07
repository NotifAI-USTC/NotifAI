import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/#/')
  await page.evaluate(() => window.localStorage.clear())
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
  await expect(page.getByText('通知详情', { exact: true })).toBeVisible()
  await expect(page.getByText('AI 秘书已为您提炼干货', { exact: true })).toBeVisible()
  expect(consoleErrors).toEqual([])
})

test('persists a favorite and supports calendar and theme workflows', async ({ page }) => {
  const firstNotice = page.getByRole('link', { name: /^打开通知：/ }).first()
  await expect(firstNotice).toBeVisible()
  const firstCard = firstNotice.locator('xpath=ancestor::*[contains(@class, "notice-card")][1]')
  const noticeLabel = await firstNotice.getAttribute('aria-label')
  expect(noticeLabel).toBeTruthy()

  await firstCard.getByRole('button', { name: '收藏通知' }).click()
  await expect(firstCard.getByRole('button', { name: '取消收藏通知' })).toBeVisible()

  await page.reload()
  const persistedNotice = page.getByRole('link', { name: noticeLabel ?? '' })
  await expect(persistedNotice).toBeVisible()
  const persistedCard = persistedNotice.locator(
    'xpath=ancestor::*[contains(@class, "notice-card")][1]',
  )
  await expect(persistedCard.getByRole('button', { name: '取消收藏通知' })).toBeVisible()

  await page.goto('/#/user')
  await expect(page.getByText('个人中心', { exact: true })).toBeVisible()
  await expect(page.getByText('将已加载通知标为已读', { exact: true })).toBeVisible()
  await page.getByText('深色', { exact: true }).click()
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--dark/)

  await page.goto('/#/calendar')
  await expect(page.getByText('通知日历', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toContainText(/\d{4}年\d{1,2}月/)
  await expect(page.getByText('无法加载当月通知')).toHaveCount(0)
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
