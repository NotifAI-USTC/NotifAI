# NotifAI-USTC

中国科学技术大学校园通知聚合前端。应用使用 Vue 3、TypeScript 和 Vuetify，提供通知浏览、AI 摘要、截止日期、订阅过滤、收藏夹和通知日历。

当前仓库只包含前端。通知 API、内容抓取、AI 处理、反馈接收和后台推送服务需要独立部署。

## 已实现能力

- 通知流、分页、刷新、服务端关键词、来源、AI 分类与日期筛选
- 通知卡片和详情页展示 AI 分类，高级搜索分类选项由 `GET /categories` 动态提供
- 四步入门引导会根据身份预设自动配置来源与关注分类，分类无需单独选择
- 通知详情、经过净化的原文、官网原文入口和附件链接复制
- 部门订阅、关键词屏蔽、已读、收藏、置顶、重要标记和收藏夹
- 分类订阅：入门引导按身份自动设置，也可在“订阅与屏蔽”中调整关注类别
- 独立"我的收藏"页：与首页一致的卡片网格，支持按收藏夹筛选
- 个人中心 DDL 倒计时基于"重要"标记而非收藏
- 截止日期倒计时、月历/周历视图与 ICS 日历导出
- 自研月/周网格日历（不依赖已弃用的 VCalendar 组件）
- 分享弹窗支持系统分享、复制链接/内容/文本与二维码扫码分享
- 首页统计概览（总数、来源数、近 7 天 DDL）
- 浅色、深色和跟随系统主题
- 偏好保存在浏览器 LocalStorage，无账号依赖，支持一键导出 / 导入 JSON 备份
- 已读记录管理（标记已读、一键清空）
- 前台 DDL 提醒：应用打开期间对近期截止的收藏发浏览器通知（同一通知只提醒一次）
- 明确的加载、空数据、配置错误和网络重试状态
- 首页通知支持 IndexedDB 长效缓存：先展示缓存，再后台同步最新数据，网络失败时保留缓存并提示更新时间

浏览器通知仅在前台触发，不承诺后台推送。真正的后台定时推送需要 Push API、Service Worker 和推送后端。

## 技术栈

| 层   | 技术                               |
| ---- | ---------------------------------- |
| 框架 | Vue 3 `<script setup>`             |
| 语言 | TypeScript 6 strict                |
| UI   | Vuetify 3                          |
| 构建 | Vite 8                             |
| 路由 | Vue Router 4 Hash 模式             |
| 状态 | Pinia + LocalStorage               |
| 网络 | Axios + 运行时响应校验             |
| 测试 | Vitest、Vue Test Utils、Playwright |

## 快速开始

```bash
npm ci
cp .env.example .env.local
npm run dev
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
npm run lint
npm run type-check
npm run test
npm run test:e2e
npm run build
npm run check
```

`npm run lint` 和 `npm run format:check` 是只读检查；使用 `lint:fix` 或 `format` 才会修改文件。完整质量检查可通过 `npm run check` 一次执行（格式、lint、类型检查、单测与构建），端到端测试使用 `npm run test:e2e`。

## 部署

每次 push 到 `main` 分支后，`.github/workflows/deploy-gh-pages.yml` 会自动执行 `npm run build` 并把 `dist/` 产物推送到当前仓库的 `gh-pages` 分支。生产构建必须配置 `VITE_API_BASE_URL`：workflow 会优先读取仓库变量 `VITE_API_BASE_URL`，未配置时回退到 `https://notifai-api.enthusjast.cc`。

在 GitHub 仓库的 Settings → Pages 中选择从 `gh-pages` 分支部署即可启用站点。

## 页面路由

| 路由                   | 页面                                             |
| ---------------------- | ------------------------------------------------ |
| `/#/`                  | 通知流、搜索和高级筛选                           |
| `/#/detail/:id`        | AI 摘要、原文和附件                              |
| `/#/calendar`          | 通知与截止日期月历                               |
| `/#/user/subscription` | 来源订阅、分类偏好和关键词屏蔽（从个人中心进入） |
| `/#/user`              | 收藏、DDL 和本地设置                             |

旧地址 `/#/subscription` 会自动跳转到 `/#/user/subscription`。

## 数据边界

- API 响应在 `src/utils/validation.ts` 做运行时校验，TypeScript 类型不被当作外部数据验证。
- 浏览器在解析前限制 API 响应体：列表 16 MiB、详情 8 MiB；服务端和网关仍应设置更严格的业务上限。
- 通知原文（`cleanContent`）统一先按 Markdown 渲染（`html:true` 保留已存在的 HTML，自动识别链接与换行），再经 DOMPurify 和 DOM 二次过滤；事件属性、表单、iframe、内联样式、非可信图片来源和 `javascript:` 链接会被移除。
- LocalStorage 数据带版本与迁移逻辑；损坏数据会回退到安全默认值。
- 生产部署仍应在服务器设置 CSP、HSTS、CORS 和缓存策略。

## 后端 API 契约

`GET /notices` 返回 `{ items: NoticeItem[], total: number }`。列表项与详情均为同一 `NoticeItem` 结构，字段如下：

```ts
interface NoticeItem {
  id: string // 通知唯一 MD5/ID
  title: string // 原始标题
  source: string // 发布来源，如 "教务处"、"计算机学院"
  categories: string[] // 0~3 个 AI 分类英文 key
  publishDate: string // 发布日期 YYYY-MM-DD
  aiSummary: string // AI 提炼的一句话摘要，可为空字符串
  deadline: string | null // 截止日期 YYYY-MM-DD，无则为 null
  targetAudience: string // 面向对象，如 "全体本科生"，可为空字符串
  coreAction: string // 核心行动/地点，可为空字符串
  originUrl: string // 官网原始链接（仅 ustc.edu.cn 或其子域的无凭据 HTTPS）
  cleanContent: string // 通知原文：Markdown / 轻量 HTML / 纯文本，可为空字符串（前端按 Markdown 渲染）
  attachments: Array<{ name: string; url: string }> // 附件列表，可为空数组
}
```

接口支持以下查询参数：

| 参数                    | 语义                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `keyword`               | 标题、来源和摘要关键词                                                      |
| `source` / `sources[]`  | 单个或多个来源                                                              |
| `categories[]`          | 一个或多个 AI 分类 key；多项为 OR 语义                                      |
| `dateFrom` / `dateTo`   | 发布日期范围，格式为 `YYYY-MM-DD`                                           |
| `rangeFrom` / `rangeTo` | 日历范围；发布日或截止日任一命中即返回                                      |
| `hasDeadline`           | 是否具有截止日期                                                            |
| `since`                 | ISO8601 增量查询：仅返回 `first_seen >= since` 的通知，用于「有新通知」轮询 |
| `page` / `pageSize`     | 从 1 开始的分页，`pageSize` 最大 1000                                       |

`GET /notices/:id` 返回完整 `NoticeItem`。`aiSummary`、`targetAudience`、`coreAction`、`cleanContent` 和 `attachments` 为可选字段，缺失时前端按空值处理；日期使用本地日历日字符串；`originUrl` 只接受 `ustc.edu.cn` 或其子域的无凭据 HTTPS 地址，附件 URL 接受无凭据的 HTTP(S) 地址。详细边界见 `src/utils/validation.ts`。

分页结果必须使用稳定排序。除最后一页外，每页必须返回请求的 `pageSize` 条记录，同一轮分页的 `total` 必须保持一致；如果数据源无法提供稳定快照，应改用 cursor 分页，避免插入或删除造成 offset 位移漏项。

### 扩展端点

以下端点已由前端使用：

| 端点                    | 用途                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `POST /notices/batch`   | 批量详情：收藏页与个人中心 DDL，替代 N+1 逐条请求，最多 500 个 ID            |
| `GET /notices/calendar` | 日历轻量视图：`month=YYYY-MM` 或 `week=YYYY-Www`，返回精简字段，替代分页循环 |
| `GET /sources`          | 来源列表：个人中心订阅页与首页来源下拉动态化，含分组与通知数                 |
| `GET /categories`       | 17 个 AI 分类及通知数：高级搜索分类多选和分类名称展示                        |
| `GET /stats`            | 聚合统计：首页统计条与数据新鲜度提示                                         |

- 批量详情请求体为 `{ "ids": string[] }`，响应 `{ "items": NoticeItem[], "missing": string[] }`，`items` 按发布日期倒序，重复 ID 自动去重。
- 日历轻量条目仅含 `id` / `title` / `source` / `publishDate` / `deadline`，发布日或截止日命中即返回，上限 500 条。
- 来源条目为 `{ name, group, noticeCount }`，`group` 如「校级部门」「二级学院」「其他」。
- 分类条目为 `{ key, name, description, noticeCount }`；通知中的 `categories` 只保存英文 key，前端映射为中文名称。
- 统计响应为 `{ total, sourceCount, last7DaysDdl, last24hNew, lastCrawlAt }`，`lastCrawlAt` 可为 `null`。
- 首页使用 `since` 每 60 秒轮询一次，有新通知时显示「有 N 条新通知，点击刷新」提示条。

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
