import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/#/calendar', { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    window.localStorage.clear()
    window.localStorage.setItem('notifai_has_onboarded', 'true')
  })
  await page.reload({ waitUntil: 'networkidle' })
})

test('switches between month and week views with working navigation', async ({ page }) => {
  const isMobile = (page.viewportSize()?.width ?? 1280) < 960
  const monthView = '.month-grid, .mobile-agenda'
  const weekView = isMobile ? '.week-agenda' : '.week-grid'

  // 默认月视图
  await expect(page.locator(monthView).first()).toBeVisible()
  await expect(page.locator('.week-grid, .week-agenda').first()).toHaveCount(0)

  // 切到周视图
  await page.getByRole('button', { name: '周', exact: true }).click()
  await expect(page.locator(weekView)).toBeVisible()
  await expect(page.locator('.month-grid, .mobile-agenda').first()).toHaveCount(0)
  if (isMobile) {
    await expect(page.locator('.week-agenda__day')).toHaveCount(7)
  } else {
    await expect(page.locator('.week-grid__day')).toHaveCount(7)
  }

  const headerBefore = (await page.locator('.header-title').textContent()) ?? ''
  await page.getByRole('button', { name: '下一周' }).click()
  await expect
    .poll(() => page.locator('.header-title').textContent())
    .not.toBe(headerBefore)

  // 回到今天：回到当前周，今天高亮唯一
  await page.getByRole('button', { name: '回到今天' }).click()
  if (isMobile) {
    await expect(page.locator('.week-agenda__header--today')).toHaveCount(1)
  } else {
    await expect(page.locator('.week-grid__day--today')).toHaveCount(1)
  }

  // 切回月视图
  await page.getByRole('button', { name: '月', exact: true }).click()
  await expect(page.locator(monthView).first()).toBeVisible()
})
