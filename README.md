# NotifAI-USTC

中国科学技术大学校园通知聚合前端。应用使用 Vue 3、TypeScript 和 Vuetify，提供通知浏览、AI 摘要、截止日期、订阅过滤、收藏夹和通知日历。

当前仓库只包含前端。通知 API、内容抓取、AI 处理、反馈接收和后台推送服务需要独立部署。

## 已实现能力

- 通知流、分页、刷新、服务端关键词、来源、AI 分类与日期筛选
- 首页长列表按行虚拟滚动，只渲染视口附近的通知卡片；可用 `VITE_VIRTUAL_FEED=false` 关闭
- 通知卡片和详情页展示 AI 主题分类及已分析的内容类型；高级搜索支持临时单选内容类型，默认显示全部（含未分析的通知）
- 高级搜索主题分类选项由 `GET /categories` 动态提供；内容类型与主题分类独立，不作为持久化偏好
- 四步入门引导会根据身份预设自动配置来源与关注分类，分类无需单独选择
- 通知详情、经过净化的原文、官网原文入口和附件链接复制
- 部门订阅、关键词屏蔽、已读、收藏、置顶、重要标记和收藏夹
- 分类订阅：入门引导按身份自动设置，也可在“订阅与屏蔽”中调整关注类别
- 独立"我的收藏"页：与首页一致的卡片网格，桌面同排卡片等高、操作区底部对齐，移动端单列自然高度；支持按收藏夹筛选
- 个人中心 DDL 倒计时基于"重要"标记而非收藏
- 截止日期倒计时、月历/周历视图与 ICS 日历导出
- 自研月/周网格日历（不依赖已弃用的 VCalendar 组件）
- 分享弹窗支持系统分享、复制链接/内容/文本与二维码扫码分享
- 首页统计概览（总数、来源数、近 7 天 DDL）
- Material Design 3 控件与字体，保留蓝绿配色；支持浅色、深色和跟随系统主题
- 无需账号即可浏览；游客偏好保存在浏览器 LocalStorage，支持导入已有 JSON 备份
- 可选 NotifAI 账号：由维护者发放，Web 登录后可跨设备同步订阅、屏蔽词、收藏夹、置顶、重要标记和标签
- 浏览通知时记录已读状态
- 前台 DDL 提醒：应用打开期间通过轻量端点轮询订阅来源的近期截止通知（同一通知只提醒一次）
- 明确的加载、空数据、配置错误和网络重试状态
- 首页通知支持 IndexedDB 长效缓存：先展示缓存，再后台同步最新数据，网络失败时保留缓存并提示更新时间
- 首页进入详情后，通过左上角返回或浏览器后退可恢复已加载分页、临时筛选和列表滚动位置；切换到其他栏目或刷新页面后不保留本次浏览位置

浏览器通知仅在前台触发，不承诺后台推送。真正的后台定时推送需要 Push API、Service Worker 和推送后端。

## 技术栈

| 层   | 技术                               |
| ---- | ---------------------------------- |
| 框架 | Vue 3 `<script setup>`             |
| 语言 | TypeScript 6 strict                |
| UI   | Vuetify 4 + Material Design 3      |
| 构建 | Vite 8                             |
| 路由 | Vue Router 4 Hash 模式             |
| 状态 | Pinia + LocalStorage               |
| 网络 | Axios + 运行时响应校验             |
| 测试 | Vitest、Vue Test Utils、Playwright |

Vuetify 配置启用 `md3` blueprint，并保留本项目的蓝绿主题和 MDI SVG 图标。
`public/layers.css` 在页面头部先于构建样式加载：全局 reset 位于 `notifai-base`，业务样式位于 `notifai-components`，Vuetify 的颜色、间距与字体工具类继续优先生效。
所有页面提示使用 `AppBanner`，高度由内容决定；紧急 DDL 的横向列表在小屏上支持滑动，长标题省略时仍显示截止时间。

## 快速开始

使用 Node.js 22 和 Corepack（启用后自动使用 `package.json` 中固定的 pnpm 版本）。

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm run dev
```

前端默认运行在 `http://localhost:5173`。

连接真实后端：

```dotenv
VITE_API_BASE_URL=http://localhost:3000/api
VITE_USE_MOCK=false
```

仅在本地使用模拟数据：

```dotenv
VITE_USE_MOCK=true
```

模拟数据必须显式启用，并且生产构建拒绝模拟模式。`VITE_API_BASE_URL` 只接受不含凭据、查询参数或 URL 片段的 HTTP(S) 地址或根相对路径。不要把密钥、学号或服务端凭据放进任何 `VITE_*` 变量，它们会进入浏览器产物。

## 质量检查

```bash
pnpm run lint
pnpm run type-check
pnpm run test
pnpm run test:e2e
pnpm run test:e2e:md3
pnpm run test:e2e:preview
pnpm run build
pnpm run check
```

`pnpm run lint` 和 `pnpm run format:check` 是只读检查；使用 `lint:fix` 或 `format` 才会修改文件。完整质量检查可通过 `pnpm run check` 一次执行（lint、类型检查、单测与构建），端到端测试使用 `pnpm run test:e2e`。

`test:e2e:md3` 和 `test:e2e:preview` 使用相同的浏览器 API 响应夹具，分别验证开发服务器和生产构建。覆盖六种屏幕宽度、深浅主题、横幅高度、弹窗和无障碍；生产预览构建使用 `/api` 基地址，不启用应用内模拟数据。

## 部署

每次 push 到 `main` 分支后，`.github/workflows/deploy-gh-pages.yml` 会自动执行 `pnpm run build` 并把 `dist/` 产物推送到当前仓库的 `gh-pages` 分支。生产构建必须配置 `VITE_API_BASE_URL`：workflow 会读取仓库变量 `API_BASE_URL`。

在 GitHub 仓库的 Settings → Pages 中选择从 `gh-pages` 分支部署即可启用站点。

### 可选账号与跨设备同步

Web 默认提供登录入口，游客仍可浏览通知。维护者按 [后端部署说明](https://github.com/NotifAI-USTC/backend#账号服务) 配置 Web Origin，并按需创建密码账号。后端配置 OIDC 时，登录框显示「使用单点登录」。首次使用未绑定的身份时只需填写昵称，提交后自动创建账号并登录；这类账号没有用户名或密码。第三方密码只在身份提供方页面输入。

生产应将 Web 和 API 放在同一个 HTTPS 站点下。推荐由反向代理在 Web 同源转发 `/api`，此时使用 `API_BASE_URL=/api`。若使用同站点不同子域，保留 API 绝对地址，并在后端设置精确的 Web Origin；OIDC 回调必须配置在发起登录的 API 主机上，而不是未代理 `/api` 的 Web 主机。公共公告不等待账号服务；会话检查失败时可使用游客偏好，已确认登录但云端偏好不可用时不会显示或写入游客偏好。本机开发可使用同一 loopback 主机的两个端口，如 Web `http://127.0.0.1:5173` 与 API `http://127.0.0.1:8080/api`。

游客偏好和账号偏好分开保存。使用 NotifAI 密码登录且云端为空时，可主动选择「导入本机偏好」，不会删除游客数据；SSO 注册不导入游客偏好。已读记录、主题及浏览器提醒授权和开关不跨设备同步；账号模式不提供 JSON 导入。另一设备先保存时不会自动合并或覆盖；到个人中心选择使用云端版本或明确确认覆盖。网络失败时未同步草稿留在当前页面，可重试；关闭页面可能丢失草稿。

## 页面路由

| 路由                   | 页面                                             |
| ---------------------- | ------------------------------------------------ |
| `/#/`                  | 通知流、搜索和高级筛选                           |
| `/#/detail/:id`        | AI 摘要、原文和附件                              |
| `/#/calendar`          | 通知与截止日期月历                               |
| `/#/user/subscription` | 来源订阅、分类偏好和关键词屏蔽（从个人中心进入） |
| `/#/user`              | 收藏、DDL、设备设置和可选账号同步                |

旧地址 `/#/subscription` 会自动跳转到 `/#/user/subscription`。

## 数据边界

- API 响应在 `src/utils/validation.ts` 做运行时校验，TypeScript 类型不被当作外部数据验证。
- 浏览器在解析前限制 API 响应体：列表 16 MiB、详情 8 MiB；服务端和网关仍应设置更严格的业务上限。
- 通知原文（`cleanContent`）统一先按 Markdown 渲染（`html:true` 保留已存在的 HTML，自动识别链接与换行），再经 DOMPurify 和 DOM 二次过滤；事件属性、表单、iframe、内联样式、机构域名（`ustc.edu.cn` / `ustclug.org` 及其子域）之外的图片来源和 `javascript:` 链接会被移除。
- LocalStorage 数据带版本与迁移逻辑；损坏数据会回退到安全默认值。
- 账号云设置只保存偏好，不包含通知正文、已读记录、主题、浏览器推送权限、游客引导身份或本机多标签页日志。
- 生产部署仍应在服务器设置 CSP、HSTS、CORS 和缓存策略。

## 后端 API 契约

`GET /notices` 返回 `{ items: NoticeItem[], total: number, nextCursor: string | null }`。列表项与详情均为同一 `NoticeItem` 结构，字段如下：

```ts
interface NoticeItem {
  id: string // 通知唯一 MD5/ID
  title: string // 原始标题
  source: string // 发布来源，如 "教务处"、"计算机学院"
  contentType: 'news' | 'notice' | 'public_notice' | 'other' | null // 内容文体；null 表示尚无有效分析
  categories: string[] // 0~3 个 AI 分类英文 key
  publishDate: string | null // 发布日期 YYYY-MM-DD；未知时为 null（页面显示“未知”）
  aiSummary: string // AI 提炼的一句话摘要，可为空字符串
  deadline: string | null // 截止日期 YYYY-MM-DD，无则为 null
  targetAudience: string // 面向对象，如 "全体本科生"，可为空字符串
  coreAction: string // 核心行动/地点，可为空字符串
  originUrl: string // 可为空；仅接受 ustc.edu.cn / ustclug.org 及其子域的无凭据 HTTPS
  cleanContent: string // 通知原文：Markdown / 轻量 HTML / 纯文本，可为空字符串（前端按 Markdown 渲染）
  attachments: Array<{ name: string; url: string }> // 附件列表，可为空数组
  firstSeen: string | null // 首次抓取时间 ISO8601
  lastCrawl: string | null // 最近抓取时间 ISO8601
}
```

接口支持以下查询参数：

| 参数                    | 语义                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `keyword`               | 标题、来源和摘要关键词                                                      |
| `source` / `sources[]`  | 单个或多个来源                                                              |
| `categories[]`          | 一个或多个 AI 分类 key；多项为 OR 语义                                      |
| `contentType`           | 单个内容类型精确筛选，仅 `GET /notices` 支持；省略时包含未知类型            |
| `dateFrom` / `dateTo`   | 发布日期范围，格式为 `YYYY-MM-DD`                                           |
| `rangeFrom` / `rangeTo` | 日历范围；发布日或截止日任一命中即返回                                      |
| `hasDeadline`           | `true` 仅有截止日期，`false` 仅无截止日期                                   |
| `since`                 | ISO8601 增量查询：仅返回 `first_seen >= since` 的通知，用于「有新通知」轮询 |
| `light`                 | 轻量列表模式；为 `true` 时 `cleanContent` 保留字段但为空字符串              |
| `excludeIds[]`          | 服务端排除通知 ID，最多 500 项，并参与 `total` 统计                         |
| `cursor`                | 不透明游标；传入后忽略 `page`                                               |
| `page` / `pageSize`     | 偏移分页；`page` 从 1 开始，`pageSize` 最大 1000                            |

`GET /notices/:id` 返回完整 `NoticeItem`。`contentType` 缺失或为 `null` 时按未知类型处理，不等同于 `other`；非法非空值会被拒绝。类型分别显示为新闻、通知/公告、公示和其他，与多值主题分类独立，组合筛选时为 AND。`aiSummary`、`targetAudience`、`coreAction`、`cleanContent` 和 `attachments` 为可选字段，缺失时前端按空值处理；`publishDate` 可为 `null` 或空字符串，前端归一化为 `null` 并显示“未知”；`firstSeen` / `lastCrawl` / `lastCrawlAt` 是 UTC ISO8601，展示时转为浏览器本地时间，而 `publishDate` / `deadline` 始终按本地日历日解析；`originUrl` 可为空，只接受 `ustc.edu.cn` / `ustclug.org` 及其子域的无凭据 HTTPS 地址，附件 URL 接受无凭据的 HTTP(S) 地址。来源旧名在 API 边界统一迁移为当前名称。详细边界见 `src/utils/validation.ts`。

偏移分页的响应 `nextCursor` 固定为 `null`。游标分页在页面满 `pageSize` 时返回下一枚不透明游标，末页返回 `null`；数据量恰好为整页时，最后一个游标请求可以返回空数组后结束。首页使用 `light=true`、游标分页和 `excludeIds[]`，详情页再请求完整正文。

### 扩展端点

以下端点已由前端使用：

| 端点                     | 用途                                                                         |
| ------------------------ | ---------------------------------------------------------------------------- |
| `POST /notices/batch`    | 批量详情：收藏页与个人中心 DDL，替代 N+1 逐条请求，最多 500 个 ID            |
| `GET /notices/calendar`  | 日历轻量视图：`month=YYYY-MM` 或 `week=YYYY-Www`，返回精简字段，替代分页循环 |
| `GET /notices/deadlines` | 即将截止轻量列表：首页紧急 DDL 横幅与前台提醒                                |
| `GET /sources`           | 来源列表：个人中心订阅页与首页来源下拉动态化，含分组与通知数                 |
| `GET /categories`        | 17 个 AI 分类及通知数：高级搜索分类多选和分类名称展示                        |
| `GET /stats`             | 聚合统计：首页统计条与数据新鲜度提示                                         |

- 批量详情请求体为 `{ "ids": string[], "light"?: boolean }`，响应 `{ "items": NoticeItem[], "missing": string[] }`，`items` 按发布日期倒序，重复 ID 自动去重。收藏页和重要 DDL 使用 `light: true`，只取列表字段并合并已有正文缓存，避免用空正文覆盖详情。
- 日历响应为 `{ "items": CalendarItem[], "total": number, "truncated": boolean }`。轻量条目含 `id` / `title` / `source` / `contentType` / `publishDate` / `deadline`，发布日或截止日命中即返回，上限 500 条；`truncated` 为真时页面提示服务端截断。
- 截止日期端点支持 `days=1..365`、`sources[]` 和分页，按截止日升序返回 `{ items, total }`；轻量条目含 `id` / `title` / `source` / `contentType` / `publishDate` / `deadline` / `aiSummary` / `targetAudience`。日历和截止日期端点不使用首页临时内容类型筛选。
- 来源条目为 `{ name, group, noticeCount }`，`group` 如「校级部门」「二级学院」「其他」。
- 分类条目为 `{ key, name, description, noticeCount }`；通知中的 `categories` 只保存英文 key，前端映射为中文名称。
- 统计响应为 `{ total, sourceCount, last7DaysDdl, last24hNew, lastCrawlAt }`，`lastCrawlAt` 可为 `null`。

## 目录

```text
src/
├── components/   业务组件与弹窗
├── composables/  跨组件浏览器状态
├── mock/         显式启用的开发数据
├── plugins/      Vuetify 配置
├── router/       Hash 路由与页面标题
├── stores/       本地偏好和缓存
├── types/        数据契约
├── utils/        API、校验、日期、分享
└── views/        Home、Detail、Calendar、Subscription、User
```
