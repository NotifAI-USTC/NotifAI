import { expect, test } from '@playwright/test'

test('guides first-time users and persists the selected profile', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'networkidle' })

  await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始个性化配置' })).toBeVisible()

  await page.getByRole('button', { name: '开始个性化配置' }).click()
  await page.getByRole('button', { name: /^本科生/ }).click()
  await page.getByRole('button', { name: '下一步：选择二级学院' }).click()
  await expect(page.getByRole('heading', { name: '选择二级学院订阅' })).toBeVisible()
  const secondaryGroup = page.getByRole('group', { name: '二级学院订阅' })
  await expect(secondaryGroup.getByText('大数据学院', { exact: true })).toBeVisible()
  await secondaryGroup.getByText('大数据学院', { exact: true }).click()
  await page.getByRole('button', { name: '下一步：AI 过滤设置' }).click()
  await page.getByRole('button', { name: '开启我的智能看板' }).click()

  await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toHaveCount(0)
  await expect(page.getByPlaceholder(/搜索通知/)).toBeVisible()

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toHaveCount(0)
})
