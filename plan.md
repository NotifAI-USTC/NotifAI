# NotifAI-USTC 前端智能 Agent 开发指南 (Vue 3 + Vant UI)

本指南旨在指导 AI 编程 Agent 独立、规范、高效地完成 **NotifAI-USTC（中国科学技术大学校园通知 AI 智能看板）** 项目的前端部分开发。Agent 需严格遵循以下工程规范、界面设计、交互逻辑及数据契约进行代码编写。

---

## 一、技术栈与底层工程规范

Agent 在初始化与编写代码时，必须严格锁死以下技术栈组合，禁止引入任何未约定的第三方状态库或样式框架。

- **核心框架:** Vue 3（全面采用 `<script setup>` 组合式 API 语法）
- **开发语言:** TypeScript（全严格模式类型检查，禁止滥用 `any`）
- **构建工具:** Vite
- **UI 组件库:** Vant UI（专门针对移动端/Web 响应式设计的组件库）
- **路由管理:** Vue Router（★ **必须采用 Hash 模式** `createWebHashHistory`，以确保后续无缝使用 Capacitor 进行自动化移动端 App 套壳，防止本地 `file://` 协议路由白屏）
- **状态管理:** Pinia（局部核心状态，如用户本地订阅偏好）
- **网络请求:** Axios（统一封装拦截器，处理统一响应结构）

### 代码目录规范

Agent 必须保持代码结构的清爽与模块化，基础骨架如下：

```text
src/
├── assets/          # 静态资源（Logo、全局样式）
├── components/      # 复用业务组件（NoticeCard.vue 等）
├── router/          # 路由配置（index.ts 锁死 hash 模式）
├── stores/          # Pinia 状态仓（userSettings.ts）
├── utils/           # 工具函数（request.ts、date.ts）
├── views/           # 四大核心页面视图
│   ├── Home.vue
│   ├── Detail.vue
│   ├── Subscription.vue
│   └── User.vue
├── App.vue          # 根组件（包裹基础 Tabbar 导航）
└── main.ts          # 入口文件（引入 Vant 样式与注册）
```

---

## 二、全局数据流与架构设计

### 1. 数据隔离契约

- **服务端（云端）：** 负责存储所有爬虫清洗后的通知正文、AI 生成的分类标签、一句话摘要以及结构化三要素（截止时间、面向对象、核心行动）。
- **客户端（本地）：** 核心奉行**免登录机制**。用户个性化的订阅学院清单、黑名单关键词、已读/星标记录，必须**完全存储在浏览器的 LocalStorage 中**。Agent 需利用 Pinia 结合本地持久化插件（或手动双向同步）来管理该状态。

### 2. 标准 API 数据响应格式（TypeScript Interface）

后端返回的通知对象格式必须在前端严格定义：

```ts
export interface NoticeItem {
  id: string;               // 通知唯一 MD5/ID
  title: string;            // 原始标题
  source: string;           // 发布来源，如 "教务处"、"计算机学院"
  publishDate: string;      // 发布日期 YYYY-MM-DD
  aiSummary: string;        // AI 提炼的 40 字以内一句话摘要
  deadline: string | null;  // 格式化截止时间，无则为 null
  targetAudience: string;   // 面向对象，如 "全体本科生"
  coreAction: string;       // 核心行动/地点
  originUrl: string;        // 官网原始链接
  cleanContent: string;     // 清洗后的纯文本/轻量 HTML 正文/Markdown
  attachments: Array<{ name: string; url: string }>; // 附件列表
}
```

---

## 三、核心页面 UI 架构与 Vant 映射指南

Agent 需一页一页严格复现以下 UI 树状结构与业务交互逻辑。界面排版采用类似**知乎移动端**的信息流卡片质感。

### 页面一：首页智能通知看板（`Home.vue`）

- **视觉核心：** 顶部的 Ddl 紧迫度警示流，辅以支持左右滑动操作的清爽通知卡片流。
- **UI 布局与 Vant 组件映射规范：**
    1. **顶部导航栏（`<van-nav-bar>`）：** 左侧内嵌 NotifAI-USTC 官方项目图标与文字标识，右侧放置搜索放大镜图标。
    2. **Ddl 滚动提醒栏（`<van-notice-bar>`）：** 启用 `scrollable` 滚动与喇叭图标。前端根据接收到的数据集，过滤出 `deadline` 距离当前时间不多于 3 天的紧急通知，进行循环轮播提醒（例如："🔥 教务处 选课截止还有 24 小时！"）。
    3. **多维度分类标签栏（`<van-tabs>`）：** 绑定当前激活的分类。固定的标签页选项包括：`全部`、`教务通知`、`学术讲座`、`学科竞赛`、`校园生活`、`★ 迎新特辑`（针对 8 月底 9 月初科大新生的专属定制置顶分类）。切换标签时，触发下方信息流列表的带参重新拉取。
    4. **通知卡片流（`<van-list>` + `<van-pull-refresh>`）：** 实现清爽的下拉刷新与触底分页加载。
    5. **滑动操作卡片（`<van-swipe-cell>`）：** 列表内的单条卡片必须包裹在滑动组件中。
        - 向左滑动：右侧露出"已读"（灰色按钮）与"星标收藏"（金色星星按钮）。
    6. **基础卡片组件（`<van-card>`）：**
        - **Title 区域：** 渲染通知原始标题，限制 CSS 为最多展示 2 行，超时自动打上 `...`。
        - **Tags 区域：** 用 `<van-space>` 包裹多个 `<van-tag>`。例如：来源标签 `#计算机学院`（灰色）、属性标签 `#奖学金`（金色）、倒计时标签 `⏳ 剩 2 天`（若临近截止则动态变红）。
        - **Desc 区域：** 渲染 `aiSummary`（AI 提炼的一句话摘要，字数控制在 40 字以内，字体颜色调淡 20%，保证信息流极佳的"扫视性"）。

### 页面二：详情页 AI 秘书核心提炼（`Detail.vue`）

- **视觉核心：** 强化 AI 提炼干货的"视觉上层感"，与下层冗长无序的红头文件原文形成鲜明对比。
- **UI 布局与 Vant 组件映射规范：**
    1. **返回导航栏（`<van-nav-bar>`）：** 带有明确的返回箭头，点击执行路由后退 `router.back()`。
    2. **AI 智能提炼大卡片（科技蓝/紫渐变色背景容器）：**
        - **标题栏：** 显示 `🤖 AI 秘书已为您提炼干货` 拟人化字样。
        - **三要素看板（`<van-cell-group inset>`）：**
            - `<van-cell title="📅 截止时间" :value="notice.deadline || '未提及'" value-class="text-danger-bold" />`（截止日期必须加粗变红）。
            - `<van-cell title="🎯 面向对象" :value="notice.targetAudience" />`
            - `<van-cell title="📍 核心行动/地点" :value="notice.coreAction" />`
        - **深度分段摘要：** 在下方直接用微型段落渲染 `aiDetailSummary`（100 字左右的精简段落，快速解答用户的"做什么、在哪做、谁来做"疑问）。
    3. **视觉分割线（`<van-divider>`）：** 文本标明"通知原文"。
    4. **原文渲染区：** 将爬虫在后端剥离出来的纯净文本/HTML 内容进行标准渲染，彻底阻断原网页乱码、垃圾侧边栏及未做移动端适配的糟糕排版。
    5. **附件处理列表（`<van-cell-group>`）：** 若 `attachments` 有数据，逐行渲染为带下载图标的单元格，点击时触发原生复制并弹出 Toast 提示："已复制附件下载链接，请在外部浏览器中打开"。

### 页面三：订阅与屏蔽配置页（`Subscription.vue`）

- **视觉核心：** 给予用户极高的无噪音自治权。
- **UI 布局与 Vant 组件映射规范：**
    1. **渠道分类关注列表：** 使用多个 `<van-cell-group>` 对校园部门进行清晰分块。
        - _校级部门分组：_ 教务处、本科生院、学工部等，每行右侧嵌入 `<van-switch>` 或 `<van-checkbox>`。
        - _二级学院分组：_ 计算机学院、大数据学院、物理学院等。
        - _业务逻辑：_ 当用户关闭某个部门的开关，该偏好即刻写入本地 LocalStorage，首页信息流列表拉取时，会自动把这些未关注渠道的通知在前端做 Filter 拦截（或传给后端过滤）。
    2. **AI 黑名单关键词屏蔽栏：**
        - 提供一个输入框 `<van-field placeholder="输入不关心的关键词，如'考研'" />`，点击添加。
        - 下方平铺展示已添加的屏蔽词，采用带可关闭图标的 `<van-tag closeable>`。用户一旦添加某些黑名单关键词，AI 将在前端渲染时自动隐藏标题或摘要中包含该词的通知。

### 页面四：个人中心与 Ddl 追踪表（`User.vue`）

- **视觉核心：** 完全砍掉传统且复杂的日历格子视图，转为高效、高落地性的 **"Todo 式倒计时列表"**。
- **UI 布局与 Vant 组件映射规范：**
    1. **用户基础简况区：** 顶部放置圆形的 `<van-image round>` 头像，下方辅以"科大新同学"或"USTC 独立开发者"的文案。
    2. **我的 Ddl 追踪列表（`<van-cell-group inset>`）：**
        - 上方通过带有时间沙漏图标 `<van-icon name="clock-o" color="#ee0a24" />` 的单元格带出大标题："⏳ 我的 Ddl 倒计时"。
        - 内部遍历所有用户主动标星收藏或系统识别处于紧急状态的通知对象。
        - 单行元素：`<van-cell :title="item.title" :label="'截止时间: ' + item.deadline" :value="'剩 ' + calculateRemainingDays(item.deadline) + ' 天'" value-class="text-highlight" is-link @click="goToDetail(item.id)" />`。数值（Value）一列根据时间差值直接高亮爆红，提醒效果拉满。
    3. **系统级入口列表：**
        - `<van-cell title="偏好与渠道管理" icon="setting-o" is-link to="/subscription" />`
        - `<van-cell title="用户意见反馈箱" icon="comment-o" is-link @click="showFeedbackPopup = true" />`

---

## 四、Agent 编码约束与防坑防爆防漏指令

在开始写代码前，Agent 必须强制记忆以下工程防御指令，违反以下任何一条，即视为代码交付不合格：

1. **防幻觉兜底：** 在解析 `deadline`、`targetAudience` 等字段时，当前端获得的值为 `null`、"未提及"或空字符串时，UI 必须优雅展示为"未提及"或"未知"，**绝对不可由前端随意猜测或填充默认时间**。
2. **环境变量解耦（★ 安全防爆）：** Agent 编写的所有网络请求必须通过 `import.meta.env.VITE_API_BASE_URL` 读取后端接口基地址。**绝对禁止**将阿里云服务器的 IP 地址、测试用的个人学号或大模型 API Key 硬编码在任何 `.vue` 或 `.ts` 文件中。
3. **移动端返回劫持：** 详情页或配置页中的弹出层（`<van-popup>`）出现时，必须妥善处理 Android 手机物理返回键的监听，防止用户按返回键时直接导致整个系统退出或路由错乱。
4. **图片与附件安全过滤：** 考虑到学校很多早期通知中的图片无法外网正常访问或尺寸过大，Agent 在渲染 `cleanContent` 时，需编写全局样式将所有图片 `max-width: 100%; height: auto;` 锁死，或者默认用清爽的占位图替换。

---

请 Agent 严格参照此架构，立即在本地环境中执行目录建立并开始 Vue 3 核心代码的按页编写。
