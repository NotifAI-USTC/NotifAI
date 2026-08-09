import { expect, test } from '@playwright/test'

test('guides first-time users and persists the selected profile', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'networkidle' })

  await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始个性化配置' })).toBeVisible()

  await page.getByRole('button', { name: '开始个性化配置' }).click()
  await page.getByRole('button', { name: /^本科生/ }).click()
  await expect(page.getByText('该身份预设自动关注的通知分类')).toBeVisible()
  await expect(
    page.getByText('选课通知、考试安排、奖学金、竞赛通知、国际交流、实习就业', {
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: '下一步：选择二级学院' }).click()
  await expect(page.getByRole('heading', { name: '选择二级学院订阅' })).toBeVisible()
  const secondaryGroup = page.getByRole('group', { name: '二级学院订阅' })
  await expect(secondaryGroup.getByText('大数据学院', { exact: true })).toBeVisible()
  await secondaryGroup.getByText('大数据学院', { exact: true }).click()
  await page.getByRole('button', { name: '下一步：AI 过滤设置' }).click()
  await expect(page.getByRole('heading', { name: '设置 AI 过滤关键词' })).toBeVisible()
  await page.getByRole('button', { name: '开启我的智能看板' }).click()

  await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toHaveCount(0)
  await expect(page.getByPlaceholder(/搜索通知/)).toBeVisible()
  const categorySettings = await page.evaluate(() => {
    const raw = window.localStorage.getItem('notifai-user-settings')
    if (!raw) return null
    const settings = JSON.parse(raw) as Record<string, unknown>
    return {
      categoryMode: settings.categoryMode,
      subscribedCategories: settings.subscribedCategories,
    }
  })
  expect(categorySettings?.categoryMode).toBe('custom')
  expect(categorySettings?.subscribedCategories).toContain('course_selection')

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toHaveCount(0)
})
