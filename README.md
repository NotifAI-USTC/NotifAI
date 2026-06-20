# NotifAI-USTC

中国科学技术大学校园通知 AI 智能看板 — 移动端优先的 Vue 3 前端应用。

学生可浏览经 AI 提炼摘要、DDL 追踪与个性化订阅过滤后的学校通知。免登录，所有偏好存于本地。

## 功能

- **首页通知看板** — 6 分类标签（全部 / 教务 / 讲座 / 竞赛 / 校园 / 迎新），下拉刷新 + 无限滚动加载，左滑卡片标记已读 / 收藏
- **AI 提炼详情** — 科技蓝紫渐变卡片突出三要素（截止时间 / 面向对象 / 核心行动），原文渲染 + 附件一键复制链接
- **订阅与屏蔽** — 校级 / 二级学院开关过滤，AI 黑名单关键词自动隐藏不感兴趣的通知
- **个人 DDL 追踪** — 收藏通知的倒计时列表，剩余天数爆红高亮提醒
- **深色模式** — 跟随系统 / 浅色 / 深色三档，手动选择覆盖系统偏好，持久化记忆
- **搜索** — 导航栏一键呼出搜索框，实时匹配标题、来源、摘要

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Vue 3（`<script setup>`） |
| 语言 | TypeScript 6（strict） |
| 构建 | Vite 8 |
| UI | Vant 4（移动端优先） |
| 路由 | Vue Router 4（Hash 模式） |
| 状态 | Pinia + LocalStorage |
| 网络 | Axios |

## 快速开始

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器（HMR）
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览生产构建
```

## 环境变量

```bash
# .env
VITE_API_BASE_URL=http://localhost:3000/api
```

所有 API 请求经 `src/utils/request.ts` 统一读取该变量，不硬编码地址。

## 页面路由

| 路由 | 视图 | 说明 |
|---|---|---|
| `/#/` | Home | 通知看板（分类标签 + 无限滚动 + 搜索 + 滑动操作） |
| `/#/detail/:id` | Detail | AI 提炼详情（三要素看板 + 原文 + 附件） |
| `/#/subscription` | Subscription | 订阅管理（部门开关 + 关键词黑名单） |
| `/#/user` | User | 个人中心（DDL 倒计时 + 深色模式 + 反馈箱） |

## 目录结构

```
src/
├── components/      # NoticeCard、DdlNoticeBar
├── router/          # index.ts（Hash 模式）
├── stores/          # userSettings.ts（Pinia + LocalStorage）
├── types/           # notice.ts（NoticeItem 等数据契约）
├── utils/           # request.ts（Axios）、date.ts（DDL 计算）
├── views/           # Home.vue、Detail.vue、Subscription.vue、User.vue
├── App.vue          # 底部 Tabbar + 深色模式类挂载
└── main.ts          # 入口（注册 Vant、Pinia、Router）
```
