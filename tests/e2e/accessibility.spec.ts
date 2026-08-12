import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * 自动化无障碍回归测试。
 *
 * 规则说明：
 * - `aria-tooltip-name` 被禁用：Vuetify 的 tooltip 在未激活的隐藏态下
 *   会被 axe 误报为“无名称的 tooltip”，这是框架已知的假阳性，页面文字
 *   在激活时始终存在。
 */
const DISABLED_RULES = ['aria-tooltip-name']

const PAGES = [
  { route: '/#/', name: '首页' },
  { route: '/#/calendar', name: '通知日历' },
  { route: '/#/user/subscription', name: '订阅与屏蔽' },
  { route: '/#/favorites', name: '我的收藏' },
  { route: '/#/user', name: '个人中心' },
] as const

for (const pageDef of PAGES) {
  test(`无严重无障碍违规: ${pageDef.name}`, async ({ page }) => {
    await page.goto('/#/', { waitUntil: 'networkidle' })
    await page.evaluate(() => window.localStorage.setItem('notifai_has_onboarded', 'true'))
    await page.goto(pageDef.route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)

    const results = await new AxeBuilder({ page }).disableRules(DISABLED_RULES).analyze()

    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })
}
