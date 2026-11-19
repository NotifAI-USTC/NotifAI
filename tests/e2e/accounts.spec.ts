import { expect, test } from '@playwright/test'

test('shows public notices while session discovery is still pending', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/auth/session', async (route) => {
    await pending
    await route.fulfill({ status: 401, json: { detail: 'AUTH_REQUIRED' } })
  })
  const session = page.waitForRequest('**/api/auth/session')
  await page.goto('/#/', { waitUntil: 'domcontentloaded' })
  await session
  try {
    await expect(page.getByPlaceholder(/搜索通知/)).toBeVisible({ timeout: 2000 })
    await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toHaveCount(0)
  } finally {
    release()
  }
  await expect(page.getByRole('heading', { name: '欢迎使用 NotifAI-USTC' })).toBeVisible()
})

test('resumes SSO signup after reload and keeps guest data separate', async ({ page }) => {
  const user = { id: 'a'.repeat(32), username: null, displayName: '科大同学 🌱', futureField: true }
  const formId = 'a'.repeat(32)
  let hasTicket = false
  let enrolled = false
  let signedIn = false
  let registrations = 0
  await page.addInitScript(() => {
    if (!localStorage.getItem('notifai_has_onboarded')) {
      localStorage.setItem('notifai_has_onboarded', 'true')
      localStorage.setItem('notifai-user-settings', JSON.stringify({
        schemaVersion: 3, blacklistKeywords: ['游客专用'],
      }))
    }
  })
  await page.route('**/api/auth/capabilities', (route) => route.fulfill({ json: { password: true, ssoProviders: ['oidc'] } }))
  await page.route('**/api/auth/session', (route) => signedIn
    ? route.fulfill({ json: user })
    : route.fulfill({ status: 401, json: { detail: 'AUTH_REQUIRED' } }))
  await page.route('**/api/auth/sso/oidc/start', (route) => {
    if (enrolled) {
      signedIn = true
      return route.fulfill({ status: 303, headers: { location: '/#/user?sso=ok' } })
    }
    hasTicket = true
    return route.fulfill({ status: 303, headers: { location: '/#/user?sso=signup' } })
  })
  await page.route('**/api/auth/sso/oidc/signup', async (route) => {
    if (!hasTicket) return route.fulfill({ status: 401, json: { detail: 'SSO_SIGNUP_REQUIRED' } })
    if (route.request().method() === 'GET') return route.fulfill({ json: { formId } })
    expect(route.request().postDataJSON()).toEqual({ formId, nickname: user.displayName })
    registrations++
    enrolled = true
    signedIn = true
    hasTicket = false
    await route.fulfill({ status: 201, json: user })
  })
  await page.route('**/api/auth/logout', (route) => {
    signedIn = false
    return route.fulfill({ status: 204 })
  })
  await page.route('**/api/me/settings', (route) => route.fulfill({
    headers: { etag: '"0"' }, json: { schemaVersion: 1, revision: 0, settings: null },
  }))

  const begin = async () => {
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByText('统一身份认证', { exact: true }).click()
    await expect(nickname).toBeVisible()
  }
  const signup = page.getByRole('dialog', { name: '创建 NotifAI 账号' })
  const nickname = signup.getByRole('textbox', { name: '账号昵称' })
  await page.goto('/#/user')
  await begin()
  await expect(signup.locator('input')).toHaveCount(1)
  await signup.getByRole('button', { name: '取消' }).click()
  await expect(signup).toHaveCount(0)
  expect(registrations).toBe(0)

  await begin()
  await page.reload()
  await expect(nickname).toBeVisible()
  await nickname.fill(`  ${user.displayName}  `)
  await nickname.press('Enter')
  await expect(page.getByText(user.displayName, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/user$/)
  await expect(page.getByText('导入本机偏好', { exact: true })).toHaveCount(0)
  expect(registrations).toBe(1)
  expect(await page.evaluate(() => JSON.parse(
    localStorage.getItem('notifai-user-settings') ?? '{}',
  ).blacklistKeywords)).toEqual(['游客专用'])

  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByText('统一身份认证', { exact: true }).click()
  await expect(page.getByText(user.displayName, { exact: true })).toBeVisible()
  await expect(signup).toHaveCount(0)
  await expect(page).toHaveURL(/#\/user$/)
  expect(registrations).toBe(1)
})

test('does not display guest preferences when an authenticated settings request fails', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('notifai_has_onboarded', 'true')
    localStorage.setItem('notifai-user-settings', JSON.stringify({
      schemaVersion: 3, blacklistKeywords: ['游客专用'],
    }))
  })
  await page.route('**/api/auth/session', (route) => route.fulfill({
    json: { id: 'b'.repeat(32), username: 'alice', displayName: 'Alice' },
  }))
  await page.route('**/api/me/settings', (route) => route.fulfill({
    status: 503, json: { detail: 'ACCOUNT_STORAGE_UNAVAILABLE' },
  }))
  await page.goto('/#/user/subscription')
  await expect(page.getByText(/无法加载 Alice 的云端设置/)).toBeVisible()
  await expect(page.getByText('游客专用', { exact: true })).toHaveCount(0)
})
