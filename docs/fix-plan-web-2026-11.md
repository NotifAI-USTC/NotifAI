# NotifAI 网页端修复计划（2026-11）

> 状态：已完成（2026-11-08）  
> 适用范围：`NotifAI/src/`、`NotifAI/tests/`、网页端 `README.md` / `AGENTS.md`  
> 配套计划：后端见 `backend/docs/fix-plan-2026-11.md`，手机端见 `NotifAI/mobile/docs/fix-plan-mobile-2026-11.md`  
> 原则：本文件只描述网页端职责；假定后端和手机端已完成配套升级。本文不修改 Flutter 代码。

## 0. 范围与前置契约

### 0.1 本端目标

- 空发布日期不再导致整条通知被丢弃，页面显示“未知”。
- `originUrl` 与后端契约一致：可为空，允许 `ustc.edu.cn` 与 `ustclug.org`。
- 来源旧名通过别名兼容，来源改名后用户订阅仍有效。
- 后端查询语义修复后，网页端筛选、分页、日历不再自行补偿错误语义。
- UTC 时间字段正确显示为本地时间；发布/截止日期仍按本地日历日展示。
- 首页列表引入虚拟滚动；日历加载失败保留旧数据。
- 收藏页和重要列表使用 batch 轻量模式，避免逐条传输完整正文。
- 补齐 CI、契约测试和文档。

### 0.2 后端已完成的假设

网页端可以直接依赖以下 API 行为：

```text
NoticeItem / CalendarItem / DeadlineItem:
  publishDate: string | null
  firstSeen:  UTC ISO8601（Z）
  lastCrawl:  UTC ISO8601（Z）
  originUrl:  "" 或 ustc.edu.cn / ustclug.org 的 HTTPS 地址
  source:     已迁移的当前显示名
  deadline:   YYYY-MM-DD 或 null

POST /notices/batch:
  { ids: string[], light?: boolean }
  light=true 时 cleanContent 为 ""

GET /notices/calendar:
  { items, total, truncated }

GET /notices?hasDeadline=false:
  服务端只返回无截止日期通知
```

网页端不需要实现数据库迁移、UTC 归一化、来源迁移或统计缓存；只需消费新契约。

### 0.3 基线

- 基线单元测试全部通过；lint/type-check 通过。
- 现有 E2E 覆盖首页、详情、收藏、日历、无障碍和 MD3 布局。
- 当前 `Home.vue` 约 1180 行，`Calendar.vue` 约 1170 行；本次不要求整体重构，只在必要处拆出可复用逻辑。

## 1. 工作包总览

| 编号 | 工作包 | 优先级 | 依赖 |
|---|---|---|---|
| W1 | 空发布日期展示“未知” | P0 | 后端已返回 null |
| W2 | originUrl 与后端对齐 | P0 | 后端契约 |
| W3 | 来源旧名/改名兼容 | P0 | 后端已迁移来源 |
| W4 | 查询语义与新 API 字段接入 | P0 | 后端 B4 |
| W5 | UTC 时间展示 | P1 | 后端 B5 |
| W6 | 日历截断与错误边界（含失败保留旧数据） | P1 | 后端 B6 |
| W7 | 首页虚拟滚动 | P1 | W1/W4 |
| W8 | 收藏/重要页 batch light | P1 | 后端 B10 |
| W9 | CI、契约测试、文档 | P1 | 全部 |

建议顺序：W1 → W2 → W3 → W4 → W5 → W8 → W6 → W7 → W9。

---

## W1 空发布日期展示“未知”

### 目标

`publishDate` 为 `null` 或空字符串时，通知仍完整出现在列表、详情、收藏、日历和分享内容中；日期区域显示“未知”，不触发整条数据校验失败。

### 现状

- `src/types/notice.ts` 的 `NoticeItem.publishDate`、`CalendarItem.publishDate`、`DeadlineItem.publishDate` 都是必填 `string`。
- `src/utils/validation.ts:140` 的 `expectDate` 对空字符串抛错；`parseNoticeItem` 用它解析 `publishDate`，非法条目会被整条跳过。
- `src/views/Detail.vue:255` 直接输出 `notice.publishDate`。
- `src/views/Calendar.vue:123-127`、`:152-172` 假定 `publishDate` 是字符串。
- `src/views/Favorites.vue:71` 用 `publishDate.localeCompare` 排序。
- `src/utils/share.ts:83`、`src/utils/ics.ts` 也直接使用发布日期。
- 缓存解析复用 `parseNoticeItem`，旧缓存中的 `""` 也会被拒绝。

### 改动文件

- `src/types/notice.ts`
- `src/utils/validation.ts`
- `src/utils/date.ts`
- `src/utils/share.ts`、`src/utils/ics.ts`
- `src/utils/noticeFeedCache.ts`
- `src/views/Detail.vue`、`src/views/Calendar.vue`、`src/views/Favorites.vue`、`src/views/Home.vue`
- `src/components/NoticeCard.vue`（如果后续增加日期展示）
- `src/mock/notices.ts`（类型/夹具）
- `tests/validation.test.ts`、`src/utils/date.test.ts`、`src/utils/ics.test.ts`、`src/views/Detail.test.ts`、`src/views/Calendar` 相关测试、`tests/e2e/*`

### 实施步骤

1. 类型：

   - `NoticeItem.publishDate: string | null`
   - `CalendarItem.publishDate: string | null`
   - `DeadlineItem.publishDate: string | null`（`deadline` 仍为非空字符串）
   - `NoticeCard` 如需展示日期，使用 `string | null`。

2. 校验：

   - 新增 `optionalDate(value, path): string | null`：
     - `null` / `undefined` / `""` → `null`
     - 合法 `YYYY-MM-DD` → 原值
     - 非法值 → `DataValidationError`
   - `parseNoticeItem`、`parseCalendarItem`、`parseDeadlineItem` 使用 `optionalDate` 解析 `publishDate`；
   - 保留 `expectDate` 给 `deadline` 等必须有值的字段；
   - 旧缓存中的 `publishDate: ""` 归一化为 `null`，不要求提升缓存 schema 版本（除非字段类型导致旧缓存无法反序列化；优先兼容）。

3. 展示工具：

   - 修改 `formatPublishDate(dateStr: string | null): string`：
     - 空值返回 `"未知"`；
     - 非法值返回 `"未知"`（不再返回“未知日期”或抛错）。
   - 新增 `comparePublishDate(a: string | null, b: string | null): number`：
     - 非空日期正常比较；
     - 空日期排在后面（降序时最后）；
     - 两者都为空时按 ID 稳定排序。

4. 页面：

   - `Detail.vue`：`{{ notice.publishDate ?? '未知' }}`；
   - `ShareDialog`/`share.ts`：分享文本使用 `notice.publishDate ?? '未知'`；
   - `Favorites.vue`：排序改用 `comparePublishDate`，空日期不崩溃；
   - `Home.vue`：
     - `matchesLocalFilters` 中设置 `dateFrom`/`dateTo` 时，`publishDate` 为 `null` 直接返回 false；
     - 本地统计不依赖发布日期；
   - `Calendar.vue`：
     - `noticeTouchesRange`：只有 `notice.publishDate` 非空时才检查发布日；
     - `calendarEvents`：空发布日不生成 `publish` 事件；只要 deadline 有效仍生成 `deadline` 事件；
     - `deadline !== notice.publishDate` 在 null 情况下仍然成立；
     - 选中日期/筛选/aria 文案不出现 `null`；
   - `ics.ts`：空发布日跳过发布事件；有 deadline 时仍导出截止事件；
   - `NoticeCard` 目前不展示发布日期，无需改动；如果新增日期 chip，使用 `formatPublishDate`。

5. 缓存：

   - `noticeFeedCache.parseCacheEntry` 使用更新后的 `parseNoticeItem`；
   - 旧缓存中空字符串日期应正常加载；
   - 测试缓存中 `publishDate: null` 和 `""` 两种形式。

6. 测试：

   - `validation.test.ts`：`null` 和 `""` 均解析成功；非法日期仍拒绝；
   - `Detail.test.ts`：空日期显示“未知”；
   - `Calendar` 事件测试：空发布日不生成发布事件，有 deadline 时仍显示截止事件；
   - `Favorites`：混合 null/有效日期排序稳定；
   - `share`/`ics`：空日期不输出 `null`；
   - E2E 使用包含空日期的 fixture 打开首页/详情，确认没有“数据格式异常”提示。

### 验收标准

- 空日期通知在首页、详情、收藏、日历、分享中可见。
- 日期显示“未知”，不出现 `null`、空字符串或整条跳过。
- 现有单元测试继续通过，新增空日期测试通过。
- `invalidItemCount` 不再因为空日期产生。

---

## W2 originUrl 与后端对齐

### 目标

与后端冻结的契约一致：

- `originUrl` 可以为空字符串；
- 非空时允许 `ustc.edu.cn`、`ustclug.org` 及其子域；
- 不接受 HTTP、凭据、`javascript:`、外部域名；
- 空值时隐藏“查看官网”，但不阻塞通知展示。

### 现状

- `src/utils/validation.ts:187` 的 `normalizeTrustedNoticeUrl` 只允许非空 `*.ustc.edu.cn` HTTPS。
- `validation.ts:241` 的 `expectTrustedNoticeUrl` 对空 URL 抛错，导致整条记录被跳过。
- `src/views/Detail.vue` 已有 `v-if="notice.originUrl"`，但数据层先把空值当成非法。

### 改动文件

- `src/utils/validation.ts`
- `src/utils/sanitizeNoticeContent.ts`
- `src/views/Detail.vue`（确认条件渲染）
- `tests/validation.test.ts`、`src/utils/sanitizeNoticeContent.test.ts`
- `README.md`、`AGENTS.md`

### 实施步骤

1. 定义允许域集合：

   ```ts
   const TRUSTED_NOTICE_HOSTS = ['ustc.edu.cn', 'ustclug.org']
   function isTrustedHost(hostname: string): boolean {
     const host = hostname.toLowerCase()
     return TRUSTED_NOTICE_HOSTS.some(
       (domain) => host === domain || host.endsWith(`.${domain}`),
     )
   }
   ```

2. `normalizeTrustedNoticeUrl(value)`：

   - `null` / `undefined` / `""` → `null`；
   - 非字符串 → `null`；
   - 必须是 `https:`；
   - 无用户名/密码；
   - hostname 属于允许集合；
   - 返回规范化 URL 或 `null`。

3. 字段解析：

   - `originUrl: normalizeTrustedNoticeUrl(record.originUrl) ?? ''`；
   - 删除 `expectTrustedNoticeUrl` 对空值的抛错路径；
   - 保持 `originUrl` 类型为 `string`，`""` 表示无链接，避免大范围类型改动。

4. 正文净化：

   - `sanitizeNoticeContent` 继续以 `originUrl` 作为相对链接/图片的 base；
   - 允许的图片 host 从 `ustc.edu.cn` 扩展为同一组 `TRUSTED_NOTICE_HOSTS`（若产品要求图片只能来自 USTC，可在代码注释中保留更严格策略并只改 originUrl；本计划默认统一）；
   - 任何 `javascript:`、`data:`、带凭据、非 HTTPS 的链接仍被移除；
   - 测试相对链接在空 originUrl 时被移除或保持不可点击，不产生 XSS。

5. 测试：

   - `originUrl: ""`、`null`、`undefined` 解析为 `""`；
   - `https://servers.ustclug.org/...` 保留；
   - `https://www.ustc.edu.cn/...` 保留；
   - `http://...`、`javascript:`、`https://user:pass@...`、`https://attacker.example` 清空；
   - `parseNoticeListResponse` 不再因为空/ustclug originUrl 丢条；
   - E2E：镜像站样例卡片可打开，详情不显示“查看官网”时无空链接。

6. 文档：

   - `README.md` 的 `originUrl` 说明改为“可为空；允许 ustc.edu.cn / ustclug.org”；
   - `AGENTS.md` 的不可信边界规则同步。

### 验收标准

- 空 originUrl 和 ustclug originUrl 的通知完整展示。
- 不安全 URL 仍被清空。
- 详情页官网按钮只在非空时出现。

---

## W3 来源旧名与改名兼容

### 目标

后端迁移旧来源名后，网页端保存的旧订阅、旧缓存和旧链接仍可用；来源展示、筛选和订阅统一到当前名称。

### 前置假设

后端已经把 `admission/招生办公室` 归一为 `zsb/本科招生网`，并把 `oic` 的显示名改为 `国际合作交流`；API `/sources` 返回当前名称。

### 改动文件

- `src/types/notice.ts`
- `src/stores/userSettings.ts`（如名称校验需要）
- `src/views/Subscription.vue`、`src/components/OnboardingModal.vue`（如使用静态来源）
- `src/utils/validation.ts`（来源列表解析）
- 测试：`src/types` 相关、`src/views/Subscription.test.ts`、`src/stores/userSettings.test.ts`

### 实施步骤

1. 扩展 `SOURCE_ALIASES`：

   ```ts
   const SOURCE_ALIASES = {
     计算机科学与技术学院: '计算机学院',
     招生办公室: '本科招生网',
     国际合作与交流部: '国际合作交流',
   }
   ```

2. `normalizeNoticeSource` 在展示、筛选、订阅保存前统一调用。

3. `SOURCE_CATALOG_FALLBACK`：

   - 通过最新 `/sources` 重新生成，或删除过时数量字段；
   - 至少加入后端当前 42 个来源；
   - 不再包含 `招生办公室`、`国际合作与交流部` 作为独立来源；
   - 加测试：fallback 中无旧名、无重复名称。

4. 订阅与入门引导：

   - 读取 LocalStorage 中的旧订阅名时，通过 `normalizeNoticeSource` 归一；
   - 保存时写入归一后的名称；
   - 若来源目录中找不到旧名，保留用户偏好但显示“来源已合并/暂不可用”，不要静默删除。

5. 测试：

   - 旧设置 `subscribedDepts: ['招生办公室']` 归一为 `本科招生网`；
   - 旧 `source` 字段筛选命中新数据；
   - `/sources` 返回旧名时前端别名生效；
   - 入门引导预设不产生旧名。

### 验收标准

- 用户历史订阅在来源改名后仍生效。
- 来源筛选、入门引导、订阅页不再出现两个同义来源。
- fallback 快照与当前后端来源一致或明确标注为离线兜底。

---

## W4 查询语义与新 API 字段接入

### 目标

后端修复 `range`/`deadlines`/`hasDeadline` 后，网页端正确使用服务端语义，不再依赖客户端的错误补偿；同时接入新的日历字段。

### 改动文件

- `src/utils/request.ts`
- `src/utils/validation.ts`
- `src/types/notice.ts`
- `src/views/Home.vue`
- `src/views/Calendar.vue`
- `src/components/AdvancedSearch.vue`
- `tests/request`、`requestLifecycle.test.ts`

### 实施步骤

1. `hasDeadline`：

   - 保持 `FetchNoticesParams.hasDeadline?: boolean`；
   - 高级搜索选择“无”时发送 `hasDeadline: false`；
   - 后端已修复为“只返回无截止日期”，网页端保留 `matchesLocalFilters` 的防御性过滤即可；
   - `hasLocalFilters` 不再需要为 `hasDeadline` 扫描后续页面；确认 `hasDeadline` 不在扫描条件中，依靠服务端分页。

2. `rangeFrom/rangeTo`：

   - 网页端目前没有直接使用该参数的页面；在 `FetchNoticesParams` 中保留并补充注释“发布时间或截止日期闭区间命中”；
   - 日期参数继续用 `assertDateOnly` 校验；
   - 不新增客户端日期过滤。

3. 测试：

   - 高级搜索“无截止日期”请求参数为 `hasDeadline=false`；
   - 服务端返回的无截止日期结果不被客户端再次错误过滤；
   - 非法日期参数仍由客户端/服务端校验。

> 日历 `total/truncated` 的类型、解析和 UI 由 W6 统一负责，本节不重复修改日历数据结构。

### 验收标准

- “无截止日期”筛选结果与后端一致，不再出现空页。
- 请求参数与 API 文档一致。

---

## W5 UTC 时间展示

### 目标

后端 `firstSeen` / `lastCrawl` / `lastCrawlAt` 改为 UTC 带 `Z` 后，网页端正确显示为浏览器本地时间；`publishDate` / `deadline` 仍按日期-only 本地解析，不因 UTC 转换错一天。

### 改动文件

- `src/utils/date.ts`
- `src/utils/validation.ts`
- `src/views/Detail.vue`（最近抓取时间）
- `src/views/Home.vue`（如显示统计时间）
- `src/stores` 缓存/备份相关
- 测试：`date.test.ts`、`Detail.test.ts`、`validation.test.ts`

### 实施步骤

1. 确认 `isValidIsoTimestamp` 接受 `Z`、`+08:00` 和无时区（用于兼容旧缓存）；新后端返回 `Z`。

2. `formatCrawlTime`：

   - 继续使用 `new Date(value)`；
   - 对 `Z` 正常转本地时区；
   - 对旧无时区值按当前行为处理，不抛错；
   - 测试固定时区（如 `TZ=Asia/Shanghai`）下的显示。

3. `publishDate`/`deadline`：

   - 继续使用 `parseLocalDate`，不要 `new Date(publishDate)`；
   - 测试日期-only 在 UTC+8 / UTC-5 下仍是同一日历日。

4. 统计：

   - `lastCrawlAt` 为 UTC；页面显示“最近同步”时用 `Date` 转本地；
   - 不把 `publishDate` 做 UTC 转换。

5. 测试：

   - `firstSeen: "2026-11-07T16:30:00Z"` 在 Asia/Shanghai 显示 11 月 8 日 00:30；
   - `publishDate: "2026-11-08"` 在任何时区都显示 11 月 8 日（本地日历日）；
   - 旧格式 `"2026-11-08T00:30:00"` 不崩溃。

### 验收标准

- 抓取时间显示与浏览器本地时区一致。
- 发布日期不发生跨日漂移。
- 旧缓存不因时间格式升级而失效。

---

## W6 日历截断与错误边界

### 目标

消费后端 `calendar.total/truncated`；请求失败时不清空已显示数据；区分“无数据”和“加载失败”。

### 改动文件

- `src/utils/request.ts`、`src/utils/validation.ts`、`src/types/notice.ts`
- `src/views/Calendar.vue`
- 相关测试和 E2E

### 实施步骤

1. 更新 `fetchCalendarNotices` 返回值类型，保留 `items`、`total`、`truncated`。

2. 在 `Calendar.vue` 中：

   - `notices` 仍保存当前范围数据；
   - `loadError`、`truncated`、`lastLoadedRange` 分开管理；
   - 请求成功后更新 `lastLoadedRange`；
   - 请求失败时：
     - 如果已有数据，保留数据并显示可重试警告；
     - 如果无数据，显示空错误状态；
   - 不因 abort 把数据清空；
   - 切换月份/周时，旧数据可作为上一范围内容保留，但必须标注当前显示的是哪一范围，避免误认为新范围数据。

3. UI：

   - `truncated`：顶部 AppBanner 提示；
   - `loadError`：可重试 AppBanner，保留日历网格；
   - `loading`：轻量进度条，不遮挡旧内容。

4. 测试：

   - 成功加载后第二次请求失败，仍能看到旧事件；
   - 重试成功后错误消失；
   - 切换范围失败时旧数据标注上一范围；
   - abort 不产生错误横幅。

### 验收标准

- 网络失败不会把已有日历清空。
- 用户能看到失败提示和重试入口。
- 超过 500 条时有明确提示。

---

## W7 首页虚拟滚动

### 目标

首页无限列表只渲染视口附近的行，避免加载数百/数千条后 DOM 过大、滚动与筛选卡顿；不改变现有分页、筛选、置顶、已读/收藏、下拉刷新和返回位置恢复体验。

### 方案选型

采用 `@tanstack/vue-virtual`（动态测量行高、支持滚动容器），按“行”虚拟化：

- 卡片仍是 `NoticeCard`；
- 根据容器宽度把 `filteredNotices` 分组成 1/2/3/4 列的行；
- 每个虚拟项是一行，行内渲染该行的卡片；
- 行高由最高的卡片决定，使用 `measureElement` 动态测量。

不引入 `v-virtual-scroll` 的固定行高限制，避免长标题/标签换行导致裁切。

### 改动文件

- `package.json`、`pnpm-lock.yaml`（新增依赖）
- `src/composables/useVirtualGrid.ts`（新增）
- `src/views/Home.vue`
- `src/components/NoticeCard.vue`（仅必要样式）
- `src/views/requestLifecycle.test.ts`、`tests/e2e/core.spec.ts`、`tests/e2e/md3.spec.ts`
- `src/composables/useVirtualGrid.test.ts`（新增）

### 实施步骤

1. 新增 `useVirtualGrid`：

   ```ts
   interface VirtualGridOptions {
     items: Ref<NoticeItem[]>
     scrollElement: Ref<HTMLElement | null>
     columns: Ref<number>
     estimateRowHeight?: number
     overscan?: number
   }
   ```

   返回：
   - `rows`：`NoticeItem[][]`
   - `virtualRows`：包含 `index`、`key`、`start`、`size` 的行
   - `totalSize`
   - `measureElement`
   - `scrollToOffset`

2. 列数：

   - 使用容器宽度或 Vuetify 断点：
     - `< 600px`：1 列
     - `600–959px`：2 列
     - `960–1279px`：3 列
     - `>= 1280px`：4 列
   - 与当前 `cols="12/6/4/3"` 保持一致；
   - `ResizeObserver` 监听容器宽度，列数变化时重新分组并保持顶部索引。

3. `Home.vue` 结构：

   - `noticeGrid` 仍是滚动容器，保留 `@scroll`（或改为 virtualizer 的 scroll 监听）与下拉刷新手势；
   - 顶部统计、提示横幅、错误横幅保留在滚动容器内，但虚拟列表区域使用 `scrollMargin` 或独立包裹，确保 `translateY` 偏移正确；
   - 虚拟列表：

     ```text
     <div :style="{ height: `${totalSize}px`, position: 'relative' }">
       <div
         v-for="row in virtualRows"
         :key="row.key"
         :ref="measureElement"
         :style="{ transform: `translateY(${row.start}px)`, position: 'absolute', ... }"
       >
         <NoticeCard v-for="notice in rows[row.index]" ... />
       </div>
     </div>
     ```

   - “没有更多”“加载更多”“暂无通知”仍渲染在虚拟区域之后；
   - 保持 `filteredNotices` 的置顶排序和客户端二次过滤。

4. 无限加载：

   - 监听 `virtualRows` 的 `endIndex`，当接近 `rows.length - 2` 且 `!finished && !loading` 时调用 `loadMore()`，加 200–300ms 节流；
   - 保留“加载更多”按钮作为键盘/无障碍备用；
   - 不用 `scrollHeight` 判断，避免虚拟高度误差。

5. 下拉刷新：

   - 保留 `onTouchStart/Move/End`，判断 `noticeGrid.scrollTop === 0`；
   - 虚拟化不影响 scrollTop 0 判断；
   - 刷新后重置到列表顶部。

6. 返回位置恢复：

   - `onBeforeRouteLeave` 保存 `noticeGrid.scrollTop`；
   - `onActivated` 在 `nextTick` 后调用 `virtualizer.scrollToOffset(savedScrollTop)`；
   - 若列数变化，按比例或顶部索引恢复，避免滚动位置错位；
   - E2E“从详情返回恢复分页与滚动位置”必须继续通过。

7. 动画与样式：

   - 关闭或限制 `notice-col` 的逐项入场动画，避免虚拟复用时闪烁；
   - 每行使用 flex，卡片等高（桌面端）；
   - 移动端 1 列保持自然高度；
   - 卡片 `:key` 使用 notice.id。

8. 无障碍：

   - 虚拟列表容器 `role="list"`；
   - 行/卡片包装 `role="listitem"`；
   - 提供可访问的“加载更多”按钮；
   - 屏幕阅读器无法浏览未渲染项是虚拟滚动的已知限制，需在“加载更多”和帮助文案中说明；
   - 运行 axe E2E。

9. 开关与回退：

   - 增加 `VITE_VIRTUAL_FEED`（默认 `true`）；
   - 关闭时回退到原 `v-row` 渲染，便于线上快速回退；
   - 在 README 记录该变量。

10. 测试：

   - 单元测试 `buildRows`：1/2/3/4 列分组、空列表、余数行；
   - 组件测试：300 条数据时只渲染视口附近卡片；
   - E2E：滚动到底部触发加载更多；返回详情保留滚动；下拉刷新；MD3/无障碍套件继续通过；
   - 性能预算：约 900px 高视口下 DOM 中 `notice-card` 数量不超过 ~40；加载 300 条后滚动帧率不明显下降。

### 验收标准

- 首页加载数百条后 DOM 卡片数量受限。
- 分页、筛选、置顶、已读/收藏、下拉刷新、返回位置均无回归。
- E2E 与 axe 通过；可通过环境变量回退。

---

## W8 收藏/重要页 batch light

### 目标

收藏页和个人中心重要列表不再逐条请求完整正文，改用后端 `POST /notices/batch` 的 `light=true`；点击详情时再请求完整正文。

### 前置假设

后端已支持 batch 请求体 `light: boolean`，`light=true` 时 `cleanContent` 为空字符串、其他字段完整。

### 改动文件

- `src/utils/request.ts`
- `src/composables/useBatchNoticeLoader.ts`
- `src/views/Favorites.vue`
- `src/views/User.vue`
- `src/stores/userSettings.ts`（缓存合并）
- `src/utils/noticeFeedCache.ts`（避免用轻量数据覆盖完整详情）
- 测试：`useBatchNoticeLoader.test.ts`、`Favorites`/`User` 测试、`request.test.ts`

### 实施步骤

1. `fetchNoticesByIds`：

   - 增加选项 `{ light?: boolean; signal?: AbortSignal }`；
   - body 发送 `{ ids, light: true }`；
   - 保持 500 ID 上限、去重、取消和响应校验。

2. `loadBatchNotices`：

   - 增加 `light?: boolean`；
   - 传给 `fetchNoticesByIds`；
   - light 响应**不写入** `writeNoticeDetailCache`，避免把完整缓存覆盖为空正文；
   - 提供 `cacheSummary` 或直接不缓存 light 结果：
     - 推荐不写入持久详情缓存；
     - 内存中如需展示，可只更新 `Favorites/User` 组件本地数据；
     - 若更新 store，需实现“不覆盖已有非空 `cleanContent`”的合并函数。

3. `Favorites.vue`：

   - `loadBatchNotices(ids, { maxIds: 1000, light: true })`；
   - 排序改为 `comparePublishDate`，空日期最后；
   - 点击卡片仍走 `Detail`，由详情页请求完整数据；
   - 缓存 fallback 逻辑保留：如果 light 请求失败，使用已有完整详情缓存。

4. `User.vue` 重要列表：

   - 同样使用 `light: true`；
   - 该页只展示 DDL/摘要，不需要正文；
   - 点击进入详情获取完整正文。

5. 测试：

   - 请求体含 `light: true`；
   - light 响应不触发 `writeNoticeDetailCache`；
   - 已有完整详情缓存不会被空正文覆盖；
   - 收藏/重要卡片正常展示；
   - 打开详情仍请求 `GET /notices/{id}` 并展示正文；
   - 离线时仍能使用完整详情缓存。

### 验收标准

- 收藏和重要列表的网络传输量明显下降。
- 详情页正文不因列表轻量请求而丢失。
- 离线兜底行为不退化。

---

## W9 CI、契约测试与文档

### 目标

网页端的质量检查在 PR 阶段自动执行，API 契约变化能及早发现，README/AGENTS 与实际实现一致。

### 改动文件

- `.github/workflows/ci.yml`（新增）
- `.github/workflows/deploy-gh-pages.yml`（保持现有部署）
- `package.json`（必要时增加脚本）
- `tests/contract.test.ts`（新增）
- `README.md`、`AGENTS.md`

### 实施步骤

1. CI：

   - 在 `pull_request` 和 `push`（非部署分支）触发；
   - 步骤：
     - `pnpm install --frozen-lockfile`
     - `pnpm run lint`
     - `pnpm run type-check`
     - `pnpm run test`
     - `pnpm run build`
   - E2E 可单独 job（Playwright 浏览器安装较慢），至少覆盖 `tests/e2e/core.spec.ts`、`calendar.spec.ts`、`accessibility.spec.ts`；
   - 现有 `deploy-gh-pages.yml` 保留，部署仍只在 main。

2. 契约测试：

   - 新增 `tests/contract.test.ts`，加载后端提供的契约样例（JSON fixture）：
     - `publishDate: null`；
     - `originUrl: ""`；
     - `originUrl: "https://servers.ustclug.org/..."`；
     - `calendar` 的 `total/truncated`；
     - batch light 的 `cleanContent: ""`；
   - 这些样例可复制自后端 `contracts/` 或手写等价 JSON；
   - 断言 `parseNoticeItem`、`parseCalendarListResponse`、`parseNoticeBatchResponse` 均接受；
   - 契约 fixture 变更时测试失败，提示同步。

3. 文档：

   - `README.md`：
     - `publishDate` 可为 null，空值显示“未知”；
     - `originUrl` 允许域名；
     - batch light；
     - UTC 时间字段与北京日期字段；
     - 虚拟滚动环境变量；
     - 测试计数改为“以命令输出为准”，避免再次漂移；
   - `AGENTS.md`：
     - Vuetify 4（当前脚本写的是 Vuetify 3）；
     - 新增不可信边界：nullable 日期、空 originUrl、light batch；
     - 保留既有安全规则。

4. 测试计数/文档：

   - 移除硬编码的测试数量，或者更新为当前实际值；
   - 运行 `pnpm run check`，确保 `README` 描述的脚本与实际一致。

### 验收标准

- PR 上 lint/type-check/unit/build 全部自动执行。
- 空日期、空/ustclug originUrl、light batch、calendar truncated 契约测试通过。
- README/AGENTS 与代码、脚本一致。

---

## 2. 测试矩阵

| 场景 | 测试层 | 断言 |
|---|---|---|
| `publishDate: null` | 单元 + 组件 | 解析成功，显示“未知”，不丢条 |
| `publishDate: ""` 旧缓存 | 单元 | 归一化为 null |
| 日期筛选 | Home 测试 | 空日期在设置 dateFrom/dateTo 时被排除 |
| 日历空发布日期 | 组件/E2E | 无发布事件，有截止事件仍显示 |
| originUrl 空/ustclug | 单元 + E2E | 保留记录；空值隐藏按钮 |
| 不安全 originUrl | 单元 | 清空，不渲染 |
| 旧来源名 | store/Subscription 测试 | 归一到当前名称 |
| hasDeadline=false | request 测试 | 发送 false，结果正确 |
| calendar total/truncated | 解析 + 组件 | 显示截断提示 |
| UTC 抓取时间 | date/Detail 测试 | 本地时区正确 |
| 虚拟滚动 300 条 | 组件/E2E | DOM 数量受限、可加载更多 |
| 滚动恢复 | E2E | 返回详情后位置正确 |
| 日历失败 | 组件/E2E | 保留旧事件、显示重试 |
| Favorites light | request/组件 | 请求 light，正文不覆盖详情缓存 |
| 契约 fixture | contract 测试 | 新字段可解析 |

## 3. 里程碑

| 里程碑 | 内容 | 预估 |
|---|---|---|
| 阶段 1 | W1 + W2 + W3 | 2-3 人日 |
| 阶段 2 | W4 + W5 + W6 | 2-3 人日 |
| 阶段 3 | W7 虚拟滚动 | 3-4 人日 |
| 阶段 4 | W8 + W9 + 回归 | 2-3 人日 |

## 4. 验收清单（DoD）

- [x] 空发布日期通知在网页端可见，显示“未知”。
- [x] 空 originUrl / ustclug originUrl 不再丢通知。
- [x] 旧来源名订阅仍生效，来源展示统一。
- [x] `hasDeadline=false` 与日历 total/truncated 正确消费。
- [x] UTC 抓取时间显示为本地时间，发布日期不漂移。
- [x] 首页虚拟滚动生效，DOM 数量受限，分页/筛选/返回恢复/下拉刷新无回归。
- [x] 日历失败保留旧数据并提供重试。
- [x] 收藏/重要页使用 light batch，详情正文不被覆盖。
- [x] PR CI、契约测试、README/AGENTS 更新完成。
- [x] `pnpm run lint`、`pnpm run type-check`、`pnpm run test`、`pnpm run build`、E2E 全部通过。

## 5. 风险与回退

| 风险 | 缓解 |
|---|---|
| 虚拟滚动破坏返回位置/下拉刷新 | `VITE_VIRTUAL_FEED=false` 回退；E2E 覆盖 |
| 虚拟滚动影响屏幕阅读器 | 保留加载更多按钮、role/list、axe 检查 |
| light batch 覆盖完整详情缓存 | 禁止写详情缓存或做字段合并 |
| 空日期变更导致旧缓存失效 | 校验器兼容 `""`，不清空缓存 |
| 来源别名导致重复计数/展示 | `normalizeNoticeSource` 统一入口，加测试 |
| 日历保留旧数据但范围已变 | 标注“显示的是上一范围数据”，避免误导 |
| 后端契约未按预期上线 | 契约 fixture 与集成测试在联调环境先验证 |
