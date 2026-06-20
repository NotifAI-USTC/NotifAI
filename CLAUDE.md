# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**NotifAI-USTC** — a mobile-first campus notification AI dashboard for USTC (University of Science and Technology of China). Vue 3 + Vant UI frontend. Students browse school notices enriched with AI summaries, Ddl tracking, and personalized subscription filters. No login — all user preferences live in LocalStorage.

**`plan.md` is the authoritative spec.** Read it first before writing any code. It defines the full UI tree, Vant component mappings, data contracts, and engineering constraints.

## Commands

```bash
npm run dev       # Start Vite dev server (HMR)
npm run build     # Type-check (vue-tsc) then production build
npm run preview   # Preview production build locally
```

No linter or test runner is configured yet.

## Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Vue 3 | `<script setup>` composition API only |
| Language | TypeScript 6 | Strict mode; `noUnusedLocals`, `noUnusedParameters` on |
| Build | Vite 8 | `@vitejs/plugin-vue` |
| UI | Vant 4 | Mobile-first component library |
| Routing | Vue Router (not yet installed) | **Must use hash mode** (`createWebHashHistory`) for Capacitor compatibility |
| State | Pinia (not yet installed) | With LocalStorage persistence for user prefs |
| HTTP | Axios (not yet installed) | Unified interceptors, read base URL from `import.meta.env.VITE_API_BASE_URL` |

## Current project state

The repo is a fresh Vite scaffold — only the default Vue + Vite boilerplate exists (`src/App.vue`, `src/components/HelloWorld.vue`, `src/style.css`, scaffold assets). No router, store, API layer, or Vant setup has been done. The four core views (Home, Detail, Subscription, User) and supporting modules (router, stores, utils) still need to be built per `plan.md`.

## Architecture

### Target directory layout (from plan.md)

```
src/
├── assets/          # Static assets, global styles
├── components/      # Reusable components (NoticeCard, etc.)
├── router/          # index.ts — hash mode, four routes
├── stores/          # Pinia stores (userSettings with LocalStorage sync)
├── utils/           # request.ts (Axios wrapper), date.ts (deadline helpers)
├── views/           # Home.vue, Detail.vue, Subscription.vue, User.vue
├── App.vue          # Root with Tabbar navigation
└── main.ts          # Entry — createApp, register Vant + router + Pinia
```

### Data flow

- **Server** owns all notice data: crawled content, AI summaries, classification tags, structured three-element metadata (deadline, target audience, core action).
- **Client** stores only user preferences in LocalStorage: subscribed departments, blacklist keywords, read/starred notice IDs. No auth token, no user accounts.
- **API response shape** is defined as `NoticeItem` in `plan.md` — every field is typed; `deadline` and `attachments` can be null/empty.

### Routing (must use hash mode)

| Path | View | Purpose |
|---|---|---|
| `/` | Home | Notice feed with tabs, Ddl notice-bar, swipe actions |
| `/detail/:id` | Detail | AI summary card + original content + attachments |
| `/subscription` | Subscription | Department toggles + keyword blacklist |
| `/user` | User | Ddl countdown tracker + settings entry points |

## Critical constraints

1. **Hash mode router** (`createWebHashHistory`) — required for Capacitor `file://` protocol. Never use HTML5 history mode.
2. **All API calls** must read the base URL from `import.meta.env.VITE_API_BASE_URL`. Never hardcode server IPs, student IDs, or API keys.
3. **Null-safe rendering** — when `deadline`, `targetAudience`, or any optional field is null/empty, display "未提及" or "未知"; never guess or fabricate defaults.
4. **Image safety** — all `<img>` in rendered notice content must have `max-width: 100%; height: auto;` to prevent layout breakage from oversized school-site images.
5. **Android back-button** — `<van-popup>` overlays must intercept physical back to close the popup, not exit the app.
