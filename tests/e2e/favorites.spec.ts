import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    window.localStorage.clear()
    window.localStorage.setItem('notifai_has_onboarded', 'true')
  })
  await page.reload({ waitUntil: 'networkidle' })
})

test('shows starred notices in a card grid and reflects unstar', async ({ page }) => {
  // 收藏第一张卡片
  const firstLink = page.getByRole('link', { name: /^打开通知：/ }).first()
  const firstCard = firstLink.locator('xpath=ancestor::*[contains(@class, "notice-card")][1]')
  await firstCard.getByRole('button', { name: '收藏通知' }).click()
  await page.getByText('默认收藏', { exact: true }).click()
  await expect(firstCard.getByRole('button', { name: '管理通知收藏' })).toBeVisible()

  // 进入收藏页
  await page.goto('/#/favorites', { waitUntil: 'networkidle' })
  await expect(page.locator('.v-app-bar-title', { hasText: '我的收藏' })).toBeVisible()
  await expect(page.locator('.notice-card').first()).toBeVisible()

  // 收藏夹筛选 chips 存在
  await expect(page.getByRole('tab', { name: '全部' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '默认收藏' })).toBeVisible()

  // 取消收藏 → 列表清空并显示空状态
  await page.getByRole('button', { name: '管理通知收藏' }).first().click()
  await page.getByRole('button', { name: '取消收藏' }).click()
  await expect(page.locator('.notice-card')).toHaveCount(0)
  await expect(page.getByText('暂无收藏通知', { exact: true })).toBeVisible()
})

test('side navigation exposes the favorites tab', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'networkidle' })
  if ((page.viewportSize()?.width ?? 1280) < 960) {
    // 移动端：底部导航直接显示文字
    await page.locator('.v-bottom-navigation').getByText('收藏', { exact: true }).click()
  } else {
    // 桌面 rail 抽屉在悬停时展开显示文字
    await page.locator('.v-navigation-drawer').hover()
    await page.getByText('收藏', { exact: true }).first().click()
  }
  await expect(page).toHaveURL(/#\/favorites$/)
  await expect(page.locator('.v-app-bar-title', { hasText: '我的收藏' })).toBeVisible()
})
